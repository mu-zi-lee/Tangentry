# ADR-002 · Hybrid question-relevant retrieval for long-content chat

- **Status:** approved. PR #2 (`owner/b-retrieval`) review
  [5897467590](https://github.com/orangesummertime/CS5351_SE_Group2/pull/2#pullrequestreview-5897467590)
  by orangesummertime (non-author), APPROVED at `2026-11-13T20:19:58Z` on commit
  `da21804`, merged into `main` as merge commit `83c7726` (2026-11-14).
  Implementation is authorized under this approval; no retrieval code exists yet.
- **Owner:** WANG Jiaqi (B).
- **Related:** [FR-02, NFR-02, INV-04 and INV-05](../../req/requirements.yaml), [implementation plan](../../plans/b-retrieval-preimplementation.md), [context audit](../../evidence/b-context-audit.md), [baseline](../../evidence/b-baseline.md), [evaluation protocol](../../evidence/b-eval-protocol.md), [debt register](../../debt-register.md).
- **Baseline:** `45611ad0e214a2d9de6f0ec5a5aa84fc493d76f2`.
- **Date:** 2026-11-12.

## Context

Long-content chat currently truncates on the frontend. `buildChatContext` uses a
120,000-character default, gives up to 35% of the limit to summary material, and
splits the rest between the head and tail of the source
([chatContext.ts:1-13](../../../src/web/src/features/ai/chatContext.ts#L1-L13)).
`AIInsights` builds this string from the summary document, overview and points
([AIInsights.tsx:474-478](../../../src/web/src/features/ai/AIInsights.tsx#L474-L478))
and posts it as the free-form `context` field
([AIInsights.tsx:391](../../../src/web/src/features/ai/AIInsights.tsx#L391)).

The backend does not verify that `context` belongs to `contentId`. The chat
service validates only length and NUL bytes ([chat.go:46-49](../../../src/internal/ai/chat.go#L46-L49)),
uses `contentId` for the history key ([chat.go:14-16](../../../src/internal/ai/chat.go#L14-L16),
[chat.go:68](../../../src/internal/ai/chat.go#L68)), and injects the supplied text
into the provider's system message ([protocol.go:100-110](../../../src/internal/adapters/aichat/protocol.go#L100-L110),
[protocol.go:169-175](../../../src/internal/adapters/aichat/protocol.go#L169-L175)).
There is no server-side read of the source before chat. Therefore retrieval
cannot be trusted if it remains a frontend-only transformation.

Two concrete constraints shape the design:

1. The frontend budget is counted in JavaScript UTF-16 code units, while the
   backend rejects contexts longer than 200,000 **UTF-8 bytes**
   ([chat.go:138-141](../../../src/internal/ai/chat.go#L138-L141)). A 120,000
   Chinese-character context is 360,000 UTF-8 bytes in the probe, so the current
   default can be rejected before the provider sees it. See
   [B-context audit §2](../../evidence/b-context-audit.md).
2. Article blocks and subtitle cues have no stable database ID. Article blocks
   are an ordered array of `ArticleBlock` values
   ([content_types.go:86-98](../../../src/internal/content/content_types.go#L86-L98));
   cues live inside a saved `Track` ([subtitles.go:24-39](../../../src/internal/subtitles/subtitles.go#L24-L39),
   [saved.go:22-28](../../../src/internal/subtitles/saved.go#L22-L28)).
   A passage locator must therefore be derived from the content ID, source kind,
   sentence/segment index and text range.

The baseline evidence in [b-baseline.md](../../evidence/b-baseline.md) shows the
failure mode on four fixed long documents: the only answer is in the middle and
the original head/tail output omits it. In all four 120k cases the truncated
output is also larger than the backend's 200,000-byte cap. This is the behavior
FR-02 and NFR-02 must beat.

The full-chain audit also records two concrete gaps that shape the decision:

- `AIInsights` currently does retrieval-shaped work in the browser
  ([AIInsights.tsx:474-478](../../../src/web/src/features/ai/AIInsights.tsx#L474-L478));
  moving selection to the server is the only way to verify the source.
- PDF text is extracted by pdf.js in the browser
  ([PDFReader.tsx:34](../../../src/web/src/features/documents/PDFReader.tsx#L34),
  [PDFReader.tsx:51-57](../../../src/web/src/features/documents/PDFReader.tsx#L51-L57),
  [PDFReader.tsx:148](../../../src/web/src/features/documents/PDFReader.tsx#L148));
  a server-authoritative PDF passage needs a server-side extractor and a
  page-text store.

## Decision (approved via PR #2 review 5897467590; see Status header)

Use **server-side hybrid retrieval** at **sentence/segment granularity**:

1. **Lexical candidate generation** runs locally over the normalized source.
   It is deterministic, fast and makes no provider call. It returns the top-K
   candidate sentences/segments.
1b. **Bounded semantic sweep — unconditional.** A lexical shortlist cannot
   contain a passage that shares no query term with the question, so a
   paraphrase or a cross-language question would never reach the embedding
   stage. A conditional sweep does not close this gap either: a long document
   with many lexical distractors fills the shortlist with query-term matches, so
   any "shortlist too small / no coverage" trigger stays silent while the
   zero-overlap answer is still excluded. The sweep therefore runs **whenever an
   embedder is configured**, with no trigger condition other than that the
   candidate budget is non-zero.
   The selector unions the lexical shortlist with a **deterministic,
   position-stratified sample of the whole document**: every ⌈N/S⌉-th
   sentence/segment in source order, where S is the effective sweep quota. The
   quota comes from a proportional split of both the request-slot and character
   budgets, capped at the configured `sweepCandidates` (see "Semantic sweep
   share" below), so it is always nonnegative, never exceeds `sweepCandidates` or
   the derived budget, and is reserved before lexical candidates rather
   than taken from what the lexical stage leaves over. Every selection reports
   `sweepCoverage = S / N`; when `S < N` the status reports
   `semantic_sweep_limited`, and when the sweep share cannot hold one passage it
   reports `sweep_zero_slots` with `sweepCoverage = 0`. The zero-overlap recall claim is therefore bounded
   by that coverage and is never stated as a guarantee: the requirement, the
   evaluation report and the user-facing copy must present `sweepCoverage`
   instead of claiming that any paraphrase is recoverable. With no embedder
   configured the path stays `lexical_only` and no paraphrase claim is made.
2. **Embedding rerank** embeds the question and the unioned candidate set with a
   user-selected embedder, then scores cosine similarity. The user can choose a
   local OpenAI-compatible server, a custom remote endpoint/key/model, or an
   Aliyun Bailian preset; dimensions, batch size, `text_type`, `instruct`,
   encoding format and timeout are configurable. The provider/API details are
   recorded in [embedding provider notes](../../evidence/b-embedding-provider-notes.md).
3. **Optional text rerank** can call a user-selected Bailian or custom
   OpenAI-compatible rerank model. It is off by default; failure degrades to
   embedding/lexical ranking with an explicit status.
4. The final hybrid score combines normalized lexical, embedding and optional
   rerank scores. The weights are user-configurable (with validation and
   normalization), and candidates are deduplicated, sorted with a stable
   tie-break, and assembled under the char/byte budget.
   **Ordering:** the budget is validated and the assembly is checked for
   preflight feasibility **before** step 1, so a request that can never fit
   starts no embedding, rerank or chat POST. A request that only fails during
   assembly (after embedding/rerank already ran) is rejected without any chat
   POST; the embedding/rerank requests already spent stay counted.
5. If the embedder/reranker is unavailable, times out, returns a wrong dimension
   or an invalid vector, the path degrades to `lexical_only` (or
   `embedding_only`/`rerank_unavailable`) with an explicit status. It never
   silently presents a degraded result as a full hybrid result.
6. PDF is supported by a **server-side page-text extractor** with a
   **PaddleOCR fallback** for pages without a usable text layer. Page text,
   source hash, extractor version and OCR job provenance are stored. If OCR
   finds no text, the result is `pdf_no_text`; OCR failure is
   `pdf_extract_failed`, never a fabricated passage.

The frontend keeps the legacy `buildChatContext` path when retrieval is off and
otherwise displays the selected passage references and the explicit status. It
must not be the authority for retrieval, embeddings or locators.

## Alternatives

| Option | Middle-answer recall | Offline testability | Extra credentials / network | Token / embedding cost | Complexity | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| Original head/tail baseline ([chatContext.ts:8-12](../../../src/web/src/features/ai/chatContext.ts#L8-L12)) | Structurally zero for a middle-only answer; four fixtures reproduce it | Deterministic | None | Same budget | None | Reject: fails the core FR-02 case and can exceed the byte cap |
| Existing content-level FTS5 + BM25 ([063_unified_search.sql:10-18](../../../src/internal/adapters/sqlite/migrations/063_unified_search.sql#L10-L18)) | Can identify that a content item contains terms, but the index stores one concatenated row per content ID ([063_unified_search.sql:20-28](../../../src/internal/adapters/sqlite/migrations/063_unified_search.sql#L20-L28)) | Deterministic | None | Local only | Low if used only as a prefilter | Not enough: no passage offsets, cue ranges or per-passage BM25 |
| Lexical-only sentence/segment scoring | Good for literal terms; weak for paraphrase and cross-language | Deterministic | None | Local only | Medium | Keep as the candidate generator and fallback, not the only ranker |
| Embedding-only retrieval | Good semantic recall; can miss exact names, numbers and rare terms | Hard unless vectors are frozen | Needs a pinned local model or approved embedding provider | Embedding calls and storage | High | Reject as the only ranker: exact-match and citation stability suffer |
| Hybrid lexical + embedding + optional text rerank (proposed v1) | Lexical preserves exact terms; a bounded semantic sweep lets a zero-overlap paraphrase reach the embedder, so paraphrases are recoverable within the sampled budget | Deterministic with a pinned/frozen embedder and fixed rerank; fake vectors/scores only for unit tests | Same as embedding-only when remote; local model option possible | Candidate generation local; top-K embeddings + bounded sweep + optional rerank | High | **Proposed v1** |
| Hybrid + LLM reranker or query expansion | Potentially best semantic quality | Hard: extra generation and nondeterminism | Extra provider calls and credentials | Highest | Highest | Defer to [B-D06](../../debt-register.md) |

The existing FTS table is **not** reused for passage scoring. It is an FTS5
trigram table with one row per content item; `body` is a concatenation of all
article blocks and `subtitles` is a concatenation of all saved cues
([063_unified_search.sql:10-28](../../../src/internal/adapters/sqlite/migrations/063_unified_search.sql#L10-L28)).
The application currently uses only `MATCH` for candidate filtering
([library.go:98-100](../../../src/internal/adapters/sqlite/library.go#L98-L100));
no `bm25()` call exists in the Go sources. A probe against the pinned SQLite
3.53.4 build confirmed that FTS5 trigram and `bm25()` are available, but the
score is per content row, not per passage. See
[the FTS probe log](../../evidence/b-fts-probe.log).

## Hybrid scoring and model pinning

- **Batching mode.** The embedder reports `BatchingMode()`. `shared`: the question
  and passages use the same request-level configuration (e.g. a local
  OpenAI-compatible server without `text_type`) and can share a batch. `split`:
  the question uses `text_type=query` and passages `text_type=document`
  (DashScope/Bailian); these are different request-level configurations and cannot
  share a batch, so one request is reserved for the query. `Embed` takes an
  `EmbedRole` (`query`/`document`) and the caller never mixes roles in one request.
- **Candidate budget (request slots), mode-specific:** with `R =
  maxEmbeddingRequests`, `B = batchSize`,
  `embeddingSlotBudget = shared ? max(0, R*B - 1) : max(0, (R-1)*B)`. In `shared`
  the question occupies one slot of the shared batch; in `split` one whole request
  is reserved for the query and the rest carry document batches. A slot budget of 0
  means no candidate capacity, so no query or document request is made and the path
  falls back to `lexical_only`. Cold-cache request count for `C` embedded
  candidates: `shared` `ceil((1+C)/B)`, `split` `1 + ceil(C/B)`.
- **Candidate budget (characters):** `embeddingCharBudget = max(0,
  maxEmbeddingChars - questionChars)`, mode-independent. This is a real second
  limit: the slot budget is a request-count ceiling, and passage lengths can bind
  first at `maxEmbeddingChars=100000`.
- **Proportional, nonnegative, capped shares.** The sweep share is a **ratio**,
  not a subtraction, because subtracting can go negative; and the result is
  **capped at the configured quota**, because a pure proportional split can
  exceed it when the request budget is large:
  `sweepRatio = sweepCandidates / (topK + sweepCandidates)`, `0` when the
  denominator is 0. Then
  `sweepSlots = min(sweepCandidates, floor(embeddingSlotBudget * sweepRatio))` and
  `lexicalSlots = min(topK, embeddingSlotBudget - sweepSlots)`; likewise
  `sweepChars = floor(embeddingCharBudget * sweepRatio)` and
  `lexicalChars = embeddingCharBudget - sweepChars`. The invariants are:
  `sweepSlots >= 0`, `lexicalSlots >= 0`, `sweepSlots <= sweepCandidates`,
  `lexicalSlots <= topK`, `sweepSlots + lexicalSlots <= embeddingSlotBudget`, and
  `sweepChars + lexicalChars == embeddingCharBudget` with both `>= 0`.
  `sweepCandidates` and `topK` are hard candidate-count ceilings: a larger
  request budget can never force more candidates than configured. **Unused slots
  stay spare** (`embeddingSlotBudget - sweepSlots - lexicalSlots`); they are not
  redistributed into extra sweep or lexical candidates beyond the configured
  caps. The sweep's character allowance is an upper bound it may not fully use
  once its count cap binds. This holds for every configuration: in `shared` mode
  at `maxEmbeddingRequests=1` the budget is 7 slots and the shares are 3 sweep / 4
  lexical; at `maxEmbeddingRequests=25` the budget is 199 slots and the sweep is
  capped at 90 (not the uncapped `floor(199*90/190)=94`), lexical at 100, leaving
  9 spare slots. In `split` mode the same limits give 0 and 192 slots respectively
  (one request reserved for the query).
- **Both limits protect the sweep.** Each side selects up to its own slot count
  and stops when its own character allowance is used. Character pressure
  therefore shrinks both sides proportionally instead of consuming the sweep
  first; lexical distractors can never take the sweep's reserved slots.
- **Explicit zero-coverage outcome.** If `sweepCandidates=0`, or the computed
  `sweepSlots` or `sweepChars` cannot hold at least one passage, then `S=0` and
  `sweepCoverage=0`. The result must carry `semantic_sweep_limited` with the
  `sweep_zero_slots` reason and must not claim zero-overlap recall at all. A
  configured `sweepCandidates=0` is a deliberate opt-out and is labelled as such,
  not silently merged into the same status as a budget-starved run.
- **With the defaults** (`batchSize=8`, `topK=100`, `sweepCandidates=90`,
  `maxEmbeddingChars=100000`, `sweepRatio = 90/190`), the request limit is
  mode-specific so the 90 sweep + 100 lexical quota is delivered in both modes:
  `shared` `maxEmbeddingRequests=24` → slot budget 191, sweep 90 / lexical 100
  (190 used, 1 spare), cold-cache requests `ceil(191/8)=24`; `split`
  `maxEmbeddingRequests=25` → slot budget 192, sweep 90 / lexical 100 (190 used,
  2 spare), requests `1+ceil(190/8)=25`. A user-lowered `split` limit of 24 gives
  slot budget 184 and sweep 87 / lexical 97, reported rather than promised at
  90/100. The character split is about 47,300 sweep and 52,600 lexical, which holds
  90 passages of roughly 500 runes. A document longer than the sampled sweep
  reports `semantic_sweep_limited`.
- The sweep is a deterministic position-stratified sample, not a random one, so
  a frozen-vector replay stays byte-identical.
- **What the claim is:** recall for a zero-overlap paraphrase is bounded by
  `sweepCoverage = S/N`. The design guarantees a bounded, deterministic path
  into the candidate set and reports how much of the document that path covered;
  it does not guarantee that any given zero-overlap passage is sampled, and it
  reports `sweepCoverage=0` rather than implying support when the shares collapse.
- **Score:** `hybrid = lexicalWeight * lexical_norm + embeddingWeight * cosine
  + rerankWeight * rerank_norm`. Weights are user-configurable, each in `[0,1]`;
  at least one is positive; they are normalized to sum 1. Defaults: 0.35/0.65/0
  when rerank is off, 0.25/0.55/0.20 when rerank is on. Changing the weights
  reopens the evaluation because it changes the ranking contract.
- **Tie-break:** hybrid score descending, then lexical score descending, then
  rerank score descending (if present), then source order, then sentence/segment
  index. This is deterministic given the same vectors and scores.
- **Embedding identity:** provider kind, model ID, dimension, endpoint family
  and a hash of the model file/provider model name are stored with every vector.
  Vectors from a different identity or dimension are never mixed.
- **Vector cache:** vectors are keyed by `(contentId, sourceVersion,
  sentenceSegmentId, embeddingModelId, dimensions)`. A persistent cache is
  proposed as a new SQLite table; if the reviewer prefers a smaller v1, the
  cache can be process-local, but the evaluation must record the recomputation
  cost.
- **Offline tests:** use a deterministic fake embedder/reranker with fixed
  vectors/scores for pipeline tests. The NFR-02 recall claim uses a pinned local
  model or precomputed frozen vectors, not hash/fake vectors.

### Embedding and rerank settings

The default is **local-first**: a local OpenAI-compatible server, recommended
`bge-m3` at 1024 dimensions, batch 8, top-K 100, sweep 90 candidates, weights
0.35 lexical / 0.65 embedding / 0 rerank. The default B budget is 24 embedding
requests, 100,000 embedding characters and 0 rerank requests, which covers the
100 lexical + 90 sweep + 1 question candidate set; the user can override every value
and switch to a custom remote or Aliyun Bailian provider. No model is silently downloaded; if the local
server/model is unavailable, the status is `embedding_unavailable` and retrieval
falls back to `lexical_only`.

| Setting | Local OpenAI-compatible | Custom remote | Aliyun Bailian |
| --- | --- | --- | --- |
| Provider kind | `local` | `remote` | `bailian` |
| Base URL | loopback URL, for example `http://127.0.0.1:11434/v1` | user-supplied | workspace URL, for example `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` |
| API key | none, or local server key | user-supplied; stored locally/masked | user-supplied; stored locally/masked |
| Model | user-supplied local model | user-supplied | preset list or custom string |
| Dimensions | user-supplied; validated against the returned vector | user-supplied; validated | per-model choices from the provider notes |
| Batch size | user-supplied, bounded | user-supplied, bounded | per-model limits from the provider notes |
| `text_type` | optional | optional | `query` for the question, `document` for passages |
| `instruct` | optional | optional | optional, query-only |
| Encoding | float (default) | float/base64 | float/base64 when supported |

The settings surface also exposes an optional rerank provider: `off`,
`bailian` or `custom`; rerank `model`, `baseUrl`, `apiKey`, `topN`, `instruct`
and `returnDocuments` are user-configurable. A "test connection" action embeds
or reranks a fixed harmless string, validates the vector length/model identity
and reports usage; it never sends a user document.

The API key is written only to the local settings file with the existing
0600-style handling or read from an environment variable; it is never returned
by the settings API, logged, or committed. Provider error bodies are redacted.
The full public API facts and limits are recorded in
[embedding provider notes](../../evidence/b-embedding-provider-notes.md).

Remote embedding/rerank calls are provider POSTs to `/embeddings` or a rerank
endpoint, not completion POSTs. B uses its **own** retrieval budget, separate
from A's completion budget:

- maximum embedding requests per retrieval operation;
- maximum rerank requests per retrieval operation;
- maximum characters/tokens sent to embeddings when known;
- statuses `completed`, `embedding_budget_limited`,
  `embedding_budget_exhausted`, `rerank_budget_exhausted`,
  `embedding_usage_unknown`, `embedding_unavailable`, `rerank_unavailable`;
- no mutation of A's ledger or counters.

Every remote embedding/rerank POST reserves a B-budget slot before it starts.
Local embedding/rerank consumes no provider request budget but still consumes
CPU/memory and a model artifact; the model hash is recorded. If rerank is
enabled while `maxRerankRequests=0`, the UI must require a positive rerank
budget (suggest 2) or keep rerank off; it must not silently ignore the setting.

## Server-side PDF extraction (text layer + PaddleOCR fallback)

PDF cannot remain browser-only if C is to verify a passage. The proposed v1
design:

1. A `PDFTextExtractor` domain port extracts per-page text from the stored PDF
   file. The primary path is a local text-layer extractor; pages with no usable
   text fall back to **local PaddleOCR** first.
2. The default OCR provider is **local PaddleOCR**, user-installed by default
   (bundling is a later packaging/license decision). The user selects the local
   runtime/binary path and model path; the recommended model ID is
   `PaddleOCR-VL-1.6`, but it is not silently downloaded. Local OCR requires no
   token and must not upload the PDF. If the local runtime/model is unavailable,
   the status is `pdf_ocr_unavailable`; B must not silently call a cloud API.
3. Cloud PaddleOCR is an explicit opt-in: the user selects `paddleocr_cloud`,
   supplies the job endpoint (`https://paddleocr.aistudio-app.com/api/v2/ocr/jobs`
   by default), token and model. The token is read from local settings or an
   environment variable; it is never hardcoded, returned by an API, logged or
   committed. A token pasted into chat or docs must be treated as compromised
   and rotated. Cloud is off by default; before enabling, the UI must show that
   the PDF pages leave the device, the configured endpoint/region, the
   data-retention/terms link and a consent checkbox; store
   `ocrCloudConsentVersion`/timestamp. The option stays feature-flagged off if
   legal/terms review is not complete.
4. The local/cloud flow is: extract or submit → poll/report progress → parse
   per-page text/markdown → validate page count. For cloud, download the JSONL
   `resultUrl.jsonUrl` and parse
   `result.layoutParsingResults[].markdown.text`. A page-count mismatch or
   timeout is `pdf_extract_failed`, not a partial success.
5. Extraction runs on PDF save or first retrieval request, idempotently for the
   same document hash. It stores `contentId`, document SHA-256, page number,
   page text, text hash, extractor name/version (`local-paddleocr` or
   `paddleocr-cloud`), OCR job ID/state and extraction timestamp in a new
   `pdf_page_text` table (proposed migration 082). Images are optional and not
   needed for retrieval.
6. Retrieval reads only this stored text. It never trusts page text sent by the
   browser.
7. Statuses: `pdf_extracting`, `pdf_ocr_unavailable`, `pdf_no_text`,
   `pdf_extract_failed`. No passage is fabricated.
8. OCR job policy: at most one active job per document hash; bounded poll
   timeout/backoff; no unbounded automatic retries; job status and errors are
   user-visible. OCR jobs are separate from the B embedding/rerank budget and
   must not block a chat request indefinitely.
9. A new document hash invalidates old page rows and old passage references;
   C sees `stale_source`.
10. The frontend may keep pdf.js for rendering, selection and note anchors, but
    chat no longer sends page text as the authoritative context.

PaddleOCR/PaddleOCR-VL is the requested OCR path. The implementation review must
still confirm the model license, the cloud API terms, data-retention/region
terms and whether a local PaddleOCR runtime is bundled or left as a user setup.
A local runtime is preferred for privacy; the cloud job API is the fallback when
the user explicitly configures a token. The design does not claim that OCR is
free, offline or always accurate.

The job flow, token redaction and test cases are recorded in
[PaddleOCR notes](../../evidence/b-paddleocr-notes.md). This is more work than
declaring PDF unsupported, but it is the only design that satisfies the "server
verifies the actual source" task in
[README.md:64-69](../../../README.md#L64-L69) for PDF.

## D2.2 layered context structure

The assembled context has six layers, in this order. The order is stable so a
compressed context still preserves identity and safety constraints before source
data.

| Layer | Content | Budget (default 120,000 runes) | Compression / handling |
| --- | --- | --- | --- |
| 1. Identity | Product role, language, answer style: "Tangentry reading assistant" | 1,000 | Fixed; never dropped |
| 2. Standing constraints | Source text is untrusted data, not instructions; cite only listed passage IDs; no evidence means say insufficient; no secrets; answer in the user's language | 3,000 | Fixed; never compressed; re-injected after compression |
| 3. Retrieved knowledge | Selected sentence/segment passages with passage ID, source kind, locator, range and exact text; or an explicit no-match marker; optional summary material | 84,000: passages 60,000 + optional summary 24,000 | Drop lowest-scored whole passage until fit; never emit a partial locator |
| 4. Conversation history | Prior user/assistant turns, bounded by whole turns | 24,000 | Drop oldest whole turns first; keep the current user turn |
| 5. Resumable state | Stored chat key, source version, retrieval mode/status, selected passage IDs; no hidden model memory | 4,000 | Keep status and IDs; drop verbose diagnostics first |
| 6. Current task | The user's question and the required answer/citation format | 4,000 | Fixed; never dropped |

The layer budgets sum to 120,000: 1,000 + 3,000 + 84,000 + 24,000 + 4,000 +
4,000. The 84,000 retrieved-knowledge layer contains a 60,000 passage sub-cap and
a 24,000 optional-summary sub-cap. If no summary material exists, the passage
sub-cap remains 60,000 in v1; the unused summary share is not silently
reallocated. The compression threshold is the cap itself: any layer over its
allocation, or any total over 120,000 runes / 200,000 bytes, triggers the
compression order in step 7 below. The accepted budget range is 1–1,000,000
runes (proposed); 0, negative, non-integer, NaN/Inf and values above 1,000,000
are rejected before retrieval, embedding or provider work.

At the 8,000-character stress budget, summary material and conversation history
are disabled and the result is labelled `degraded_budget`: identity 500,
constraints 1,000, passages 5,500, current task 1,000. The same char and byte
checks apply. The user-visible status must say which layers were omitted; it
must not silently pretend the full context was used.

### Assembly pipeline

1. **Normalize:** Unicode NFC where safe, normalize line endings and whitespace
   for matching; keep the original text for the locator and quote. Reject NUL.
2. **Sentence/segment split:** article block → sentences → adjacent sentence
   segments; subtitle cues → cue groups (preserving cue IDs and time range);
   discussion post block → sentences → segments; PDF page → sentences →
   segments. Proposed segment size 1–3 sentences or 200–800 runes, with no
   overlap in v1.
3. **Lexical candidates:** score exact normalized phrase, distinct query-term
   coverage, saturating term frequency and proximity; keep the configured top-K
   (default 100, accepted range 20–1,000). This is the lexical shortlist that
   step 3b may extend; it is a different knob from `sweepCandidates`.
4. **Embedding/rerank:** embed the question and candidates; validate dimension
   and model identity; compute cosine; optionally call the rerank provider;
   combine with the configured/normalized weights.
5. **Deduplicate:** normalize whitespace and hash the exact text; keep the
   highest score and the first stable locator; merge duplicate IDs
   deterministically.
6. **Priority sort:** hybrid score descending, lexical score descending, source
   priority (article, saved subtitle, PDF, discussion), then source order.
7. **Budget/compress:** reserve fixed layers and current task; add optional
   summary up to 24,000; add whole passages up to 60,000; if over, drop the
   lowest-scored whole passage and recompute; then truncate summary at a
   sentence boundary; then drop the oldest whole history turn; if still over,
   return `context_budget_exceeded`.
8. **Validate:** re-read every selected source range and compare exact text,
   range and source version/hash; drop mismatches as `source_unverified`; if
   none remain, return `no_verified_passages`.
9. **Assemble:** write layers in order with explicit separators and passage IDs.
10. **Re-inject constraints:** after compression, append a short constraint
    reminder immediately before the current task: untrusted data, only cite the
    listed IDs, no evidence means insufficient, never reveal secrets. This block
    is mandatory and counts inside the 3,000-character constraint budget.

The provider still receives a system message built from the chat template
([protocol.go:169-175](../../../src/internal/adapters/aichat/protocol.go#L169-L175)).
The retrieval layers are inserted into that system message, while conversation
history remains separate messages. This preserves the existing provider
contract. The existing default already marks source content as untrusted data
([prompts.go:27](../../../src/internal/ai/prompts.go#L27)); the standing
constraint layer makes that explicit again after any compression.

## Passage contract for C

A passage reference must be verifiable without trusting the model. Proposed
shape:

```json
{
  "passageId": "bilibili:BV1xx#article:12:s3:120-260",
  "contentId": "bilibili:BV1xx",
  "source": "article",
  "locator": "article:12:s3",
  "startRune": 120,
  "endRune": 260,
  "textSha256": "<64 lowercase hex characters>",
  "sourceVersion": "content-revision:7 or text-sha256:<hex>",
  "cueIds": []
}
```

- Ranges are zero-based, half-open Unicode code-point offsets within the named
  sentence/segment unit. This avoids Go byte slicing and JavaScript UTF-16
  disagreement.
- Article ID: `<contentId>#article:<blockIndex>:s<sentenceIndex>:<start>-<end>`;
  a multi-sentence segment adds the sentence range, for example
  `article:12:s3-s5`.
- Discussion ID:
  `<contentId>#discussion:<postIndex>:<blockIndex>:s<sentenceIndex>:<start>-<end>`.
- Subtitle ID:
  `<contentId>#subtitle:<language>:<cueStart>-<cueEnd>`; the reference also
  carries `cueIds` so C can verify each cue rather than only the joined string.
- PDF ID:
  `<contentId>#pdf:<documentSha256>:<page>:s<sentenceIndex>:<start>-<end>`.
- `sourceVersion` is the monotonic `content_revision` adopted in v1. For
  subtitles it is the saved row revision; for PDF it is the document hash plus
  extractor version/OCR job provenance. C must re-read the source and compare
  the version/hash; it must not treat a model-produced ID or quote as verified.
  This is the interface B promises; the final C schema still requires C's
  review.

### Wire envelope (B-owned, namespaced)

To avoid top-level collisions with A's `usage`/`budget`, C's future `citations`
and D's comparison fields, B puts all new fields under one optional `retrieval`
object. This is the recommended spelling:

```json
{
  "retrieval": {
    "schemaVersion": 1,
    "status": "ok",
    "mode": "hybrid",
    "passages": [
      {
        "passageId": "bilibili:BV1xx#article:12:s3:120-260",
        "contentId": "bilibili:BV1xx",
        "source": "article",
        "locator": "article:12:s3",
        "sentenceStart": 3,
        "sentenceEnd": 4,
        "startRune": 120,
        "endRune": 260,
        "textSha256": "<64 lowercase hex characters>",
        "sourceVersion": "content-revision:7",
        "cueIds": []
      }
    ],
    "embedding": {
      "model": "user-selected-model",
      "dimensions": 1024,
      "budgetStatus": "completed",
      "requests": 2
    },
    "rerank": {
      "enabled": false,
      "model": "",
      "budgetStatus": "disabled",
      "requests": 0
    }
  }
}
```

The request uses the same `retrieval` object with `enabled`, `mode`, `maxChars`,
`embeddingBudget` and `rerankBudget`; the response uses `status`, `mode`,
`passages` and the provider budget summaries. Omitting `retrieval` means the
legacy path. C consumes `retrieval.passages` and may add its own top-level
`citations` without touching B's object. This is a proposal; C must still confirm
the final spelling.

## Invariants

| Statement | Source requirement | Enforcing component | Verification | Runtime fallback action |
| --- | --- | --- | --- | --- |
| **INV-04 (preflight):** an assembly that is impossible before retrieval starts **zero** chat completion POSTs, **zero** embedding requests and **zero** rerank requests. | [NFR-02 / FR-02](../../req/requirements.yaml), [chat.go:138-141](../../../src/internal/ai/chat.go#L138-L141) | Preflight feasibility check in the domain layer, run before the selector and before any adapter; transport passes the budget | B-T16 property cases, B-T10 invalid budgets, B-T17 byte cap, B-T21 preflight half, B-T24 zero-POST assertion | Reject with `invalid_budget` or `context_budget_exceeded` before candidate generation, embedding, rerank or chat. Preflight-detectable means: invalid budget value; rune or byte budget below the mandatory minimum (the constraint reminder plus one minimum viable passage and its locator); or a source that cannot yield any passage within the byte cap. |
| **INV-04 (post-embedding):** if the drop sequence cannot fit after embedding/rerank already ran, the assembly is rejected and starts **zero** chat completion POSTs; already-spent embedding/rerank requests are counted and reported, never retried. | [NFR-02 / FR-02](../../req/requirements.yaml), [chat.go:138-141](../../../src/internal/ai/chat.go#L138-L141) | Retrieval assembler in the domain layer | B-T21 post-embedding half, B-T24 | Drop lowest-scored whole passage and recompute; then drop summary material; then drop oldest whole history turn; if still over, return `context_budget_exceeded` with the observed embedding/rerank request count. Never send an over-budget string and never start a hidden retry. |
| **INV-05:** every selected passage maps to a real source index and exact text; forged, out-of-range, text-mismatched or stale locators are rejected. | [FR-02 / README B tasks](../../../README.md#L64-L69), [content_types.go:86-98](../../../src/internal/content/content_types.go#L86-L98), [subtitles.go:24-39](../../../src/internal/subtitles/subtitles.go#L24-L39) | Source normalizer + locator verifier; repository re-read through a domain port; PDF extractor store | B-T14 exact mapping, B-T15 forged/out-of-range, B-T19 stale version | Drop the invalid passage and mark `source_unverified`; if no verified passage remains, return `no_verified_passages`; never synthesize or repair a passage from a summary, embedding vector or model output. |
| **INV-04 (wire sub-limit):** the sent context is at most 200,000 UTF-8 bytes even when the rune budget is satisfied. | [chat.go:138-141](../../../src/internal/ai/chat.go#L138-L141) | Assembler byte counter, plus the same preflight byte estimate | B-T17 | Apply the same preflight rejection when the mandatory layers alone exceed the byte cap; otherwise apply the post-embedding drop sequence. Report the byte cap in the error, not a generic provider failure. |

## Compatibility, A and C interfaces

### Retrieval off

The existing request shape `{contentId, context, messages, model, revision}`
([translation_types.go:32-39](../../../src/internal/ai/translation_types.go#L32-L39))
and the existing `buildChatContext` output stay unchanged. The transport rejects
unknown fields ([ai_common.go:34-44](../../../src/internal/transport/http/ai_common.go#L34-L44)),
so any new retrieval field must be added to both sides in one coordinated
change. With retrieval off, the new path must not run; the context string and
the response field set must match the recorded fixture after normalizing the
wall-clock `updatedAt` (B-T01).

### Retrieval on

The backend loads the source by `contentId` through a domain port; it does not
trust `context`. The existing `content.Service.Get` is available
([content.go:37-38](../../../src/internal/content/content.go#L37-L38),
[library.go:38-45](../../../src/internal/transport/http/library.go#L38-L45)) and
saved subtitles are available through `SavedService.List`
([saved.go:29-44](../../../src/internal/subtitles/saved.go#L29-L44)). PDF page
text comes from the new `pdf_page_text` store. The composition root wires the
concrete repositories ([feature_services.go:75-76](../../../src/internal/app/feature_services.go#L75-L76)).
The AI domain should receive small `PassageSource`, `Embedder` and `PDFText`
ports rather than importing SQLite or an HTTP adapter. This keeps the dependency
direction inward as required by
[ARCHITECTURE.md:32-45](../../ARCHITECTURE.md#L32-L45) and the executable rule in
[layering_test.go:65-96](../../../src/internal/layering/layering_test.go#L65-L96).

### A's budget and B's separate retrieval budget

Local candidate generation makes **zero completion POSTs**. Hybrid rerank adds
`/embeddings` POSTs when a remote embedder is used. A's proposed INV-01 counts
started `/chat/completions` and `/responses` requests; the provider adapter has
four such POST sites
([protocol.go:127](../../../src/internal/adapters/aichat/protocol.go#L127),
[protocol.go:181](../../../src/internal/adapters/aichat/protocol.go#L181),
[protocol.go:250](../../../src/internal/adapters/aichat/protocol.go#L250),
[protocol.go:356](../../../src/internal/adapters/aichat/protocol.go#L356)).
Embeddings are **not** covered by that invariant.

B deliberately keeps a **separate retrieval budget** so it does not modify A's
reservation boundary or counters. The B budget covers embedding and optional
rerank POSTs, with its own max-request/max-character limits, statuses, UI and
tests. A's completion ledger is untouched. B must not enable a remote
embedder/reranker until its own budget is approved and covered by tests (B-T24,
B-T33).

### C's citations

C currently receives only `role`, `content` and optional `model` on each chat
message ([translation_types.go:27-31](../../../src/internal/ai/translation_types.go#L27-L31));
there is no citation field. B's passage reference object above is the proposed
stable input to C. C should treat the model's textual citation as untrusted and
re-read the source; the passage ID is a locator, not proof.

## Content version (for C)

A citation must say which version of the source it references. The current
`content.Item` has no revision field, and the SQLite upsert updates only
`payload`, not `saved_at`
([store.go:91-103](../../../src/internal/adapters/sqlite/store.go#L91-L103)).
An edited article therefore keeps the same ID and an old passage text can be
mistaken for current evidence.

v1 adopts the recommended method: add a monotonic `content_revision` column and
a `content_hash` column to `saved_content`, increment the revision and replace
the hash on every successful update, backfill legacy rows with revision 1, and
expose both in `content.Item` for B and C. A text hash remains only as a
legacy/PDF/OCR fallback. This is a cross-owner migration with C and E; B
implements the storage/version plumbing and C/E consume it.

Migration coordination: migration numbers are file ordering, not a runtime
contract. B owns the `content_revision`/`content_hash` migration (proposed 084);
C/E must not add a duplicate column migration. B's schema/backfill should land
before or together with C/E code that reads the field; if C/E merge first, their
code must be behind an interface/feature flag until B lands. If `main` already
has B's proposed numbers (082/083/084), renumber B's files at merge; never edit
a migration that has already run. B-T38 covers the old-DB upgrade/backfill.

## Consequences

### Positive

- Hybrid retrieval recovers literal middle answers and, as far as the reported
  `sweepCoverage` reaches, semantic paraphrases that the head/tail baseline and
  lexical-only paths miss.
- The unconditional sweep is what makes a zero-overlap paraphrase reachable at
  all, including in a document that is full of lexical distractors. The claim is
  explicitly bounded by `sweepCoverage`; `semantic_sweep_limited` reports when
  the sample could not cover the whole document, so a miss caused by sampling is
  visible instead of being reported as a semantic failure.
- The cost is a larger default embedding budget (24 requests / 100,000
  characters instead of 16 / 60,000), because the sweep quota is protected
  rather than taken from whatever the lexical stage leaves over.
- Sentence/segment granularity gives C a precise locator and avoids dumping
  whole article blocks into the context.
- Server-side PDF extraction makes PDF chat compatible with the same verification
  contract instead of declaring it unsupported.
- The lexical stage bounds embedding cost to top-K candidates and provides a
  deterministic fallback.
- Local-first defaults mean no cloud upload/token is required out of the box;
  users can opt into custom/Bailian embeddings or cloud PaddleOCR and customize
  dimensions, batch, text type, weights and budgets.
- PaddleOCR fallback extends PDF chat to scanned documents without making the
  browser text authoritative; local OCR is the default, cloud OCR is explicit.
- Local candidate generation and the compatibility path are offline testable;
  the provider/embedding boundary is explicit.

### Negative / risks

- A remote embedder adds credentials, cost, latency, a `/embeddings` budget
  dependency and model-version nondeterminism.
- A local embedder/OCR runtime adds a model artifact, runtime dependency and
  platform packaging work; local-first defaults may not work until the user
  installs the runtime/model.
- Sentence splitting can cut a thought across boundaries; gold labels and the
  splitter must use the same granularity.
- PDF extraction adds a native extractor, a migration and a PaddleOCR job path;
  scanned pages can still return `pdf_no_text`, and OCR adds cost, latency,
  token handling and license/terms review.
- The 20-question evaluation set is small and can be overfitted; per-question
  results and model/vector hashes are mandatory.
- Content revision is a cross-owner migration; legacy rows need backfill, and a
  text hash is only a fallback.

## Reopen conditions

Reopen this ADR before implementation or before claiming success if any of the
following occurs:

1. Fixed-set hybrid recall is below 0.80, or below the baseline at the same
   budget.
2. Hybrid does not improve over lexical-only on the fixed set; report the
   negative result instead of claiming hybrid benefit.
3. The embedding model cannot be pinned, its vectors are nondeterministic across
   runs, or its cost/latency exceeds the approved budget.
4. B's separate embedding/rerank budget is not approved, or its limits/status
   cannot prevent runaway calls without touching A's ledger.
5. C requires a different passage identity, version or quote-verification
   contract.
6. PDF extraction/OCR quality is inadequate, the native library or local
   PaddleOCR runtime/model license is not approved, cloud terms are unacceptable
   for users who opt in, or page-text storage cannot be versioned.
7. Content revision is rejected by C/E, or the migration/backfill cannot be
   rolled out.
8. In-memory candidate generation or vector caching becomes too slow or too
   large for the tested content limits.
9. The user-configurable embedding/rerank settings cannot be validated safely
   (dimension/model/weights), or provider error bodies/keys leak.
10. The local-first default is unusable for most users because the local
    embedding/OCR runtime/model is unavailable; improve onboarding/bundling
    rather than silently switching to cloud.

## Review gate

This ADR is a proposal, not an approval. The retrieval implementation, test
suite and evaluation may start only after a non-author reviewer records a
decision on: the hybrid scoring/weights, the embedding/rerank provider settings
and B budget, sentence/segment granularity, the PDF text-layer/PaddleOCR design,
the content-revision migration, the namespaced `retrieval` wire envelope, and
the server-authoritative split. No approval from another branch or repository is
carried forward.

**Approval recorded (2026-11-14, Phase 0):** the gate above was satisfied by PR #2
(`owner/b-retrieval`) review
[5897467590](https://github.com/orangesummertime/CS5351_SE_Group2/pull/2#pullrequestreview-5897467590):
orangesummertime (non-author; the PR author is Wjq1024) submitted an APPROVED
review at `2026-11-13T20:19:58Z` on head `da21804bbc7154ebb60d1c1769294b2dea56da43`,
and the PR merged into `main` as `83c7726fab2dd06006df12db4a2f8e01bae9d2cc` on
2026-11-14. The approval covers this ADR, the implementation plan and the B
requirement entries (FR-02, NFR-02, INV-04, INV-05). It does not constitute final
implementation acceptance; that remains a human non-author review after the
implementation PR. Verification evidence:
`docs/evidence/b-impl-phase0-approval.log` and `b-impl-phase0-approval.json`.