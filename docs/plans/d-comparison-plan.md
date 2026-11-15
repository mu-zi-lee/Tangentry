# D · Multi-content comparison: requirements, implementation, and evaluation plan

- **Owner:** Wenlong Lu
- **Status:** Proposed, pending independent review and approval.
- **Implementation baseline:** `83c7726fab2dd06006df12db4a2f8e01bae9d2cc`
- **Upstream comparison baseline:** `45611ad0e214a2d9de6f0ec5a5aa84fc493d76f2`

This plan covers FR-04 and NFR-04. Both entries follow the project schema in the [requirements registry](../req/requirements.yaml). The [acceptance dataset](../evidence/d-comparison-fixtures.json) contains the source texts, questions, expected relationships, per-source annotations, and fault conditions for D-01 through D-20.

## 1. Functional requirement FR-04

A reader selects **two or three distinct saved items** in the library, opens the comparison panel, and asks a question. Version 1 handles one factual dimension per question, such as a date, amount, scope, eligibility condition, or applicability of a rule. If a question only asks whether a field is present, the comparison checks presence and can still show the field value under each source. The result shows an overall relationship, a finding and evidence status for each source, and verified citations that link to the original material.

The proposed first release supports saved article text and the currently selected, saved original-language subtitle track for a video. PDF support, multi-turn comparison history, and automatic transcription are deferred. Each submission produces one result. A user-initiated retry starts a new invocation.

Upstream chat takes input and stores history under a single `contentId`. D adds selection of multiple items, comparison on a common question, source attribution, and partial failure handling. B provides passages and locators, C verifies citations, and A limits generation requests. E can reuse source-version information. The evaluation uses upstream single-content chat as its baseline.

### User workflow

1. Select items in the library. The interface displays the selected count and titles and enables **Compare** when two or three items are selected. The comparison panel shows the items, the question field, and an optional AI call limit.
2. On submission, the server checks the number and uniqueness of IDs, the question, access to each source, and the current invocation's model settings. It loads source text and versions from saved items. The request carries the selected IDs, the question, the required model configuration identifiers, and the optional call limit.
3. The result displays the overall relationship and a card for each source. A verified citation opens the original article paragraph or subtitle timestamp. If a source fails, its card keeps its place in the result, shows the reason that can be disclosed to the current user, and leaves other verified findings available.
4. Initial validation returns a generic source-unavailable error for missing or inaccessible IDs and starts zero generation requests. Read or verification failures after access validation follow the partial failure rules below. For videos, the server uses the currently selected, saved original-language track. If multiple tracks exist and none is selected, the interface prompts the reader to select one. A new submission reloads the status and version of every source.

### Relationship and evidence states

- **`same` (Same)** means every source provides direct, verified evidence for compatible findings about the same subject, time frame, conditions, and units.
- **`conflict` (Conflict)** means at least two sources give verified, mutually incompatible findings on the same basis for comparison, and every source has a determinable evidence state. The result shows differences by source and retains minority findings. Another source can be marked **Not mentioned** if complete coverage establishes that the field is absent.
- **`not_mentioned` (Not mentioned)** means every source has a determinable result and at least one lacks the field under a complete coverage check. The result identifies each source where the field is absent. Version 1 applies this check to structured documents that explicitly declare their field lists complete. The server reads the complete version, parses each field-value entry, and checks the field name and aliases established for the question. An ambiguous field, truncated input, or a structure the server cannot fully parse yields **Insufficient evidence**.
- **`insufficient_evidence` (Insufficient evidence)** means at least one source cannot be verified. Causes include limited retrieval coverage, missing readable text, a version change, or a read failure. The result retains verified facts from the remaining sources. This overall relationship applies even when the remaining sources disagree, because verification of the selected set is incomplete.

Assign the overall relationship in this order:

1. If any source has insufficient evidence or fails, return `insufficient_evidence`.
2. Otherwise, return `conflict` if the verified findings directly conflict.
3. Otherwise, return `not_mentioned` if a source lacks the field under a complete coverage check.
4. Otherwise, return `same` when every source supports compatible facts.

If complete coverage confirms that every source lacks the field, the system can return **Not mentioned** directly. If it has neither verified facts nor verifiable proof of absence, it returns **Insufficient evidence** or indicates that all sources are unavailable. The relationship and the execution status have separate fields. The execution status uses `budget_exhausted` for a reached call limit and `usage_unknown` for unknown usage. It also reports cancellation and generation failure. Verified facts can still appear as partial results.

Each source has an evidence state of `supported`, `not_mentioned`, or `insufficient_evidence`. A separate reason distinguishes conditions such as `read_failed`, `no_text`, `limited_search`, and `stale_source`. If retrieval finds no matching passage in free text, use `insufficient_evidence`. An absence finding in structured material requires a coverage record containing the source version, the range of blocks inspected, and the field name.

The model can cite only passage IDs supplied by the server for this comparison. The server uses C to verify the selected source, version, location, and original text before exposing a citation. If a source version changes, E supplies the status displayed for an older citation.

### Example result with three sources

**Question:** Do all three sources give the same refund deadline?

- **Overall result — Conflict.** The comparison uses the time since payment. Sources A and C agree. Source B allows a longer period.
- **A, Store Help — 14 days.** “You can request a refund within 14 days of payment.” Link to the original article paragraph.
- **B, Updated Terms — 30 days.** “The refund request deadline is 30 days after payment.” Link to the original terms paragraph.
- **C, Customer Service Guide — 14 days.** “Refund requests are accepted within 14 days of payment.” Link to the subtitle timestamp.

This example renders the D-08 gold result in English. The fixture contains the original Chinese passages for exact citation checks. If source C fails to load, the overall result becomes **Insufficient evidence**. The verified difference between A and B remains visible as partial evidence, and C displays **Read failed**.

## 2. Proposed implementation interfaces

The proposed entry points are the library comparison panel and `POST /api/ai/compare`. A dedicated server-side comparison use case reuses the existing authentication entry point, the saved-content reader, and the AI provider adapter. Version 1 returns a single JSON response with the verified result. Review the following fields with A, B, and C before finalizing their names.

- The request includes `contentIds`, `question`, the current configuration `revision`, and optional `model` and `maxProviderCalls` fields. It follows A's input semantics. An omitted call limit allows unlimited calls, and an explicit limit must be an integer from 1 through 100. IDs resolve only to items saved on the server.
- The response includes the execution status, overall relationship, per-source results in request order, C's citations or coverage records, and A's budget report. Each source retains its real `contentId` and version. A citation must resolve to at least a passage ID, source type, locator, and text hash. The service rejects citations outside the selected set, passages attributed to the wrong source, and evidence with a mismatched version.
- Following B's proposal, measure context in both Unicode code points and UTF-8 bytes. Reserve space for the question, output contract, and source identifiers before dividing the remainder equally among the selected sources. Try to keep at least one complete, verifiable unit per source. Redistribute unused space in a fixed input order to sources with additional eligible passages. Use complete passages and mark sources with inadequate space as having limited coverage. When there is no verifiable positive evidence, use the available coverage records and source statuses to return an absence or insufficient-evidence result with zero generation POSTs.
- One user submission has one A generation-call ledger. Retries and compatibility fallbacks share it. Embedding and reranking calls use B's separate retrieval budget. D reports their counts separately from A's generation counts. A's terminal status for a limited invocation takes precedence over the comparison result. Stale text, incomplete quotations, and model output that fails to parse cannot support verified findings.
- Test doubles can implement B and C's public contracts for early integration. Formal acceptance uses the real implementations. B supplies corpus coverage, passages, and version information. C returns verifiable citations. E consumes stored evidence versions. For immediate results in version 1, read the sources before generation and verify the results before returning them. Future persistence shares version fields with E.

[D scope and draft acceptance criteria](https://github.com/orangesummertime/CS5351_SE_Group2/blob/83c7726fab2dd06006df12db4a2f8e01bae9d2cc/README.md#L29-L43) · [A budget contract](https://github.com/orangesummertime/CS5351_SE_Group2/blob/83c7726fab2dd06006df12db4a2f8e01bae9d2cc/docs/plans/a-integration-contract.md#L19-L25) · [B/C passage reference contract](https://github.com/orangesummertime/CS5351_SE_Group2/blob/83c7726fab2dd06006df12db4a2f8e01bae9d2cc/docs/architecture/adr/002-question-relevant-retrieval.md#L429-L466)

## 3. Nonfunctional requirement NFR-04

On the fixed set of **20 pre-annotated cases**, the integrated D workflow must achieve **at least 80% relationship classification accuracy** and **at least 80% case-level source attribution accuracy**, or 16 correct cases out of 20 for each metric. Every partial source failure must appear on the corresponding source card. Any partial failure reported as an overall match blocks acceptance. Record the rerun date, implementation commit, dataset hash, configuration, numerators and denominators, per-case results, and failure reasons.

### Fixed dataset

- Include five cases for each overall relationship. The set covers two- and three-source comparisons, mixed article and subtitle inputs, questions in Chinese and English, unit conversions, conditions that qualify a finding, truncation under a small context budget, and partial read failures.
- Each case records stable source IDs, source types, text segments or subtitle cues, gold facts, evidence states, and exact evidence segment IDs. Absence cases specify the segments the coverage check must encompass. Insufficient-evidence cases specify a reason. Generate long inputs from fixed templates and record the target segment position, length, and hash.
- D and a non-author reviewer freeze the dataset and scoring rules and record the SHA-256 hash before seeing model output. The runner sends the question, selected IDs, selected source text, and the necessary fault controls to the system under test. Gold labels and answers go only to the scoring step. Use separate fixtures for debugging. Record the reason for any acceptance dataset revision and rerun all comparisons.

### Scoring rules

1. **Relationship classification accuracy** = cases whose overall relationship matches the gold label ÷ 20. Each case scores 0 or 1. A missing output, ambiguous reasoning, relationship without a unique label, or failed invocation scores 0.
2. **Case-level source attribution accuracy** = cases where every selected source passes attribution ÷ 20. Each case scores 0 or 1. Each selected source must appear exactly once with the correct ID, state, and fact. Score the two metrics independently, so a wrong overall label can still earn the attribution point. A supported fact needs the correct locator and a verifiable quotation. Equivalent values or wording are acceptable for the finding, including unit conversions. The quotation must match the original. An absence finding requires reviewable coverage information. Insufficient evidence requires the correct reason, with no unsupported fact supplied for that source. Swapped sources, fabricated claims, omissions, or hidden partial failures result in an attribution score of 0.
3. **Diagnostic measures.** Score individual sources and report the number of fully correct citations, omitted expected sources, and correctly disclosed partial failures. Record generation POSTs, retrieval calls, known and unknown token usage, median latency, and maximum latency. The denominator for both primary metrics stays at 20. List findings outside the gold annotations and reviewer disagreements separately to support analysis of failures.
4. **Independent review.** D and a non-author score outputs independently using randomized run IDs. Record initial disagreements and final decisions. Automated checks can compare relationship labels and source IDs. Reviewers assess unit conversions, equivalent wording, and whether the evidence supports the finding. They resolve disagreements by checking the original source, with a third group member deciding unresolved cases.

### Baseline and experiment procedure

**1 · Upstream baseline.** At the pinned upstream commit, ask the same question separately for each available selected item using the original `buildChatContext` and chat service. Each input contains only that source and starts with an empty chat history. Keep the actual output and failure state. Use a common instruction asking each single-source chat to return the relevant fact and an original quotation or to report insufficient information. A reviewer combines the answers under the fixed relationship rules using only the outputs and mechanically collected statuses. Scorers then check those results against the original sources.

The reviewer combining answers may use the coverage metadata both workflows record to distinguish fully checked structured fields from partial excerpts. The baseline's single-source answer must still support an absence finding. If the evaluation harness supplies an absence record or verifies a citation, report that as assistance to the baseline and record native upstream capabilities separately. For D-20, change the upstream source snapshot after collecting evidence, keep the actual upstream response, and use the experiment log to score outdated citations. Label the combined result **Upstream single-content chat with manual aggregation**. Separately report whether upstream natively provides an overall relationship, valid citation links, and partial failure notices.

**2 · Controlled D integration.** Use fixed B passages or controlled retrieval statuses, a C verifier test double, and a local fake provider that records requests. Cover valid output, a citation assigned to the wrong source, read failure, unknown usage, budget exhaustion, and cancellation. This stage checks the workflow and invariants. The next stage evaluates generated output against the quality thresholds.

**3 · Integrated D quality evaluation.** Run the same 20 cases with real B retrieval, C verification, D comparison, and A budgeting. Use an approved, fixed generation configuration that returns valid usage data. Use non-streaming generation at temperature 0. Fix and record a seed where the provider supports one. Pin the model ID or version, configuration version, prompt hash, source snapshots, embedding and reranking settings, context budgets, and fault injection points. Clear chat state for each case and follow the same predefined cold-cache policy. Schedule one primary run and one complete repeat in advance. Report both scores and retain any differences. Each run must meet the thresholds. Use the same fixed synthetic texts and follow the group's provider review process for network calls.

**4 · Fairness and stress testing.** Use the same generation model, language, and output-length settings for both workflows. For ordinary cases, cap source text per question at 120,000 Unicode code points and 200,000 UTF-8 bytes. Give each upstream `buildChatContext` call an equal share of the same budget, conservatively reducing its input limit based on a preliminary size calculation to meet the aggregate byte cap. Record actual UTF-16 code units, Unicode code points, and bytes. D may redistribute unused shares under its stated rules. For D-16, apply the 8,000-code-point context budget to both workflows and record actual coverage per source.

Each workflow keeps its native calling sequence. D uses a shared limit of three generation calls per question. Upstream makes a separate call for each source, and the report records the total actual requests per question. Use the fake provider in a separate test to verify the one-call hard limit and compatibility fallback so the quality comparison can account for differences in calling sequence or budget. Use the same static snapshots, questions, fault timing, and accessible sources.

**5 · Reporting.** For each run, record the implementation commit, model, prompt and fixture hashes, and budgets. For each case, record the expected relationship, both actual classifications, attribution and evidence rationale per source, gold-answer checks, initial scores and adjudication, actual calls, and usage. Report the numerators and denominators for both primary metrics, incorrect cases grouped by relationship, misclassified partial failures, and acceptance blockers. Use the baseline to explain what D adds and why cases fail. Apply the thresholds in §3 and the functional test criteria to acceptance.

## 4. Acceptance traceability

- **D-T01 · FR-04 input validation.** Cover selection of two or three accessible items, empty selection, one or four items, a blank question, duplicate IDs, malformed IDs, and unavailable IDs in the UI and HTTP layers. Valid input can be submitted. Invalid input receives an actionable error and starts zero generation requests.
- **D-T02 · FR-04 per-source display.** Use D-01, D-08, D-11, and D-16 to verify the four overall relationships. D-08 checks a two-against-one conflict and a source link for each finding. D-11 checks proof of absence in a completely inspected record. D-16 checks insufficient evidence under partial retrieval coverage.
- **D-T03 · FR-04 failure isolation.** Use D-17 through D-20 to check a read failure, a single failed source out of three, missing subtitles, and a version change. Also test failure of every source. Keep the reason per source and verify zero generation POSTs when every source fails.
- **D-T04 · FR-04 citation validation.** Inject quotations attributed to the wrong source, altered quotations, stale versions, out-of-range locators, duplicate findings for one source, and invalid JSON. Affected citations must remain unverified. The result shows an explicit error or insufficient evidence. The UI offers source navigation only for verified citations.
- **D-T05 · FR-04 budget integration with A and B.** Set A's limit to 1 and verify that fallback starts a request only if the ledger allows it. Check that missing usage and cancellation retain their respective A statuses. Record B's calls and A's POSTs separately. Verify context counts, behavior near character limits, the share used by the longest source, and the attempt to reserve at least one complete passage per source. Test limits of 0, 101, a fractional value, and an omitted value. Invalid limits result in zero POSTs. An omitted limit follows A's existing behavior.
- **D-T06 · NFR-04 integrated quality evaluation.** Run D-01 through D-20 and apply the scoring rules in §3. The integrated workflow must reach at least 80% for each primary metric and explicitly disclose every injected partial failure.
- **D-T07 · FR-04 upstream regression.** Cover the original single-content chat UI and HTTP API, including loading and clearing history. Run Go regression tests, frontend unit tests, and the frontend build. Verify in a browser that a reader can select sources, compare them, jump to evidence, and see partial failures. Record existing and newly introduced failures.

## 5. Review and delivery

A non-author reviewer confirms the version 1 content types, the absence rule, precedence when a source fails, the B/C interfaces, and the scoring denominators. Record the reviewed commit and decision. After approval, implement the server comparison contract and negative tests, then add the frontend entry point and citation navigation. Integrate A, B, and C, run the full quality evaluation, and archive the report. FR-04 and NFR-04 are registered as pending review, and the acceptance dataset accompanies this plan.

This draft draws on the repository README, the registered A and B requirements, and the existing implementation contracts. D-01 through D-20 are pre-annotated synthetic cases. Record experiment results, NFR-04 acceptance, and independent approval after the corresponding runs and review.

The dataset SHA-256 for this review version is `2b888ce31cea0faee06733e7ebbb01bca5896321cb56d9d05ff417f8ffdea33a`. Verify it again when the review is approved.
