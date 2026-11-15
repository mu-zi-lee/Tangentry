# B implementation · Phase 2 report — source loading and content version

- **Date:** 2026-11-14
- **Branch:** `owner/b-implementation`
- **Phase status:** complete (awaiting human confirmation before Phase 3)
- **Session:** B-AI-010 (continuous session `ses_e27efbad7ffeY2pIG6EzRIOgOQ`)
- **Precondition:** Phase 1 confirmed by human ("Proceed to Phase 2").

## 1. What was built (VERIFIED)

| Change | Detail |
| --- | --- |
| Migration **084** `084_content_revision.sql` + Go step `addContentVersion` | Adds `content_revision INTEGER NOT NULL DEFAULT 1` and `content_hash TEXT NOT NULL DEFAULT ''` to `saved_content`; backfills legacy rows with revision 1 + computed normalized-snapshot hash. Pragma-checked columns; only empty hashes backfilled → idempotent. Comment-only SQL body (hash cannot be computed in SQL); the Go step runs in the same transaction. B owns the column set. |
| `content.Item` | New server-owned `ContentRevision int64` / `ContentHash string` (`json:",omitempty"`), exposed via Get/List/Page and the library JSON API. |
| `Store.Save` | Ignores client revision/hash; INSERT sets revision 1; ON CONFLICT increments `content_revision` and replaces `content_hash`; fields never embedded in the payload (columns authoritative). |
| `Store.Get/List/Page` | Read and set the version columns (consistent exposure across full reads and card projection). |
| `retrieval.SnapshotHash` | Canonical normalized-snapshot SHA-256: whitespace/line-ending normalized, case preserved, structure included, version/contentID excluded (no circularity). |
| `retrieval.SnapshotRange` | Pure domain exact-range re-read with matching source version; forged/out-of-range → `ErrSourceNotFound`. |
| `sqlite.RetrievalSource` | Implements `retrieval.PassageSource`: article/discussion snapshots (stable array indices), saved subtitle tracks (cue IDs = deterministic `language:index`; saved cues have no DB ID), fresh re-read per `ReadRange` (INV-05). PDF pages arrive in Phase 3. |

## 2. Test-first evidence (VERIFIED)

- **Red retained:** `b-impl-phase2-red.log` (missing fields/functions; 3
  existing-test expectations surfaced by the additive change).
- **New tests (11):** B-T03, B-T19 storage half, B-T28 revision part, B-T38
  (×4: migration/backfill, fresh versioning, single column owner, fixture
  sanity), domain `SnapshotHash`/`SnapshotRange`, discussion/ReadRange.
- **Existing-test updates (no assertion weakened):** `progress_test.go` and
  `subscriptions_test.go` now assert the backfill (`revision==1`, hash
  non-empty) then zero the new fields and `reflect.DeepEqual` every original
  field — the no-loss guarantee is preserved and the new behavior is
  explicitly checked. `library_test.go` needed no change once Page exposed
  the fields consistently.

B-Txx mapping:

| B-Txx | Test | Assertion |
| --- | --- | --- |
| B-T03 | `TestBT03_SubtitleMiddleCue` | 144,011-rune fixture, gold cue 2,999; `source=subtitle`, locator `subtitle:zh:2992-2999`, 8 cue IDs incl `zh:2999`, version `content-revision:1`, exact gold text once; INV-05 re-read verifies |
| B-T19 | `TestBT19_StaleAfterUpdate` (+ domain `TestBT19_StaleVersion`) | update → revision 2; old reference `stale_source`; fresh selection revision 2; old text never current |
| B-T28 (revision part) | `TestBT28_RevisionInvalidation` | revision increments, hash changes; old reference dropped stale, new verifies (PDF hash part = Phase 3) |
| B-T38 | `TestBT38_ContentRevisionMigration`, `_FreshDatabaseVersioning`, `_SingleColumnOwner`, `_OldDumpFixtureSanity` | old-DB upgrade backfill rev 1 + computed hash; save increments + replaces hash; client values ignored; payload clean; idempotent re-open; migration recorded once; exactly one column owner; API JSON shape |

## 3. Gate results (VERIFIED, raw logs + exit codes)

| Command | Exit | Summary | Evidence |
| --- | --- | --- | --- |
| `go test ./internal/retrieval/... ./internal/ai/... ./internal/transport/http/... -count=1` | 0 | 3 ok | `b-impl-phase2-focused.log` |
| `go test ./... -count=1` | 0 | 44 ok / 11 no-test | `b-impl-phase2-go-full.log` |
| `go test ./internal/layering -count=1` | 0 | ok | `b-impl-phase2-layering.log` |
| `npm test -- --run` | 0 | 62 files / 251 tests | `b-impl-phase2-web.log` |
| `npm run build` | 0 | built | `b-impl-phase2-web.log` |
| `go vet` (retrieval/sqlite/content) | 0 | clean | `b-impl-phase2-layering.log` |
| two-run determinism diff | 0 | identical (11 PASS/run) | `b-impl-phase2-determinism.log` |
| `git diff main` A budget files | 0 | empty | `b-impl-phase2-layering.log` |
| published migrations | — | unchanged; only 084 added | `b-impl-phase2-layering.log` |
| gofmt / secret scan | 0 / 1 | clean | session output |

## 4. Design decisions recorded (INFERRED within spec latitude)

1. **Hash normalization:** whitespace/line-ending collapse, case preserved
   (case-only edits change the hash); structure (indices/kinds/levels/cue
   IDs/timings) included; version/contentID excluded. Matches "SHA-256 of the
   normalized source snapshot"; NFC still deferred (stdlib-only).
2. **Revision increments on every successful update**, even identical
   re-saves (monotonic per update, documented); hash stays equal for
   identical content.
3. **Source priority (v1):** PDF kind → pdf; discussion posts → discussion;
   article blocks → article; else saved subtitle tracks. A content item with
   both article blocks and subtitles uses the article in v1.
4. **Cue IDs:** deterministic `language:index` (saved cues have no DB ID,
   ADR-002 locator rule). Subtitle version uses the existing saved-track
   revision (`content-revision:<n>`), not the new column.
5. **`content_hash` scope:** the `saved_content` article/discussion snapshot;
   subtitle/PDF versions use their own mechanisms per plan.
6. **Migration number:** 084 free today (latest published 081; 082/083
   reserved for B's later phases). Re-check at merge; renumber if taken.

## 5. Structured report

```json
{
  "phase": "2-source-version",
  "status": "complete",
  "branch": "owner/b-implementation",
  "commits": ["<phase-2 commit> feat(retrieval): add source loading and content version (migration 084)"],
  "files_changed": [
    "src/internal/retrieval/snapshot_hash.go (+test)",
    "src/internal/content/content_types.go",
    "src/internal/adapters/sqlite/migrations/084_content_revision.sql",
    "src/internal/adapters/sqlite/content_version.go (+test)",
    "src/internal/adapters/sqlite/retrieval_source.go (+test)",
    "src/internal/adapters/sqlite/migrations.go, store.go, library.go",
    "src/internal/adapters/sqlite/progress_test.go, subscriptions_test.go"
  ],
  "tests_added": ["B-T03","B-T19 (storage half)","B-T28 (revision part)","B-T38 (x4)","SnapshotHash/SnapshotRange","discussion/ReadRange"],
  "test_results": [
    {"command": "cd src && go test ./internal/retrieval/... ./internal/ai/... ./internal/transport/http/... -count=1", "exit_code": 0, "summary": "3 ok", "evidence": "docs/evidence/b-impl-phase2-focused.log"},
    {"command": "cd src && go test ./... -count=1", "exit_code": 0, "summary": "44 ok / 11 no-test", "evidence": "docs/evidence/b-impl-phase2-go-full.log"},
    {"command": "cd src && go test ./internal/layering -count=1", "exit_code": 0, "summary": "ok", "evidence": "docs/evidence/b-impl-phase2-layering.log"},
    {"command": "cd src/web && npm test -- --run", "exit_code": 0, "summary": "62 files / 251 tests", "evidence": "docs/evidence/b-impl-phase2-web.log"},
    {"command": "cd src/web && npm run build", "exit_code": 0, "summary": "built", "evidence": "docs/evidence/b-impl-phase2-web.log"}
  ],
  "invariants_verified": [
    "INV-05 re-read through the adapter; stale version dropped stale_source (B-T19/B-T28)",
    "content_revision monotonic + hash replaced on update; legacy backfill rev 1 + computed hash; idempotent (B-T38)",
    "single column owner; server-owned fields ignore client values and stay out of the payload"
  ],
  "constraints_checked": [
    "layering green; retrieval still stdlib-only; adapter imports domain (allowed direction)",
    "A ledger untouched (git diff main empty)",
    "no published migration edited; 084 additive/idempotent; 082/083 still free",
    "no secrets/credentials/user data; temporary SQLite fixtures only",
    "offline determinism: two-run diff identical; hash determinism asserted",
    "-count=1 everywhere; gofmt + vet clean; no push/force-push"
  ],
  "ai_use_log_entry": "B-AI-010",
  "deviations_from_spec": [
    "Two existing upgrade tests updated to assert backfill then compare original fields (no weakening; documented)",
    "NFC still deferred (stdlib-only); hash uses whitespace normalization with case preserved"
  ],
  "open_questions": [
    "Phase-7 evaluation set still in progress (re-ask at Phase 6/7)",
    "C/E must consume content_revision/content_hash without a duplicate migration (coordination note for merge)"
  ],
  "next_phase": "3-pdf-extraction",
  "claim_tags": "all factual claims VERIFIED via cited evidence logs/commands; section 4 items are INFERRED design decisions within spec latitude"
}
```

## 6. Stop condition

Phase 2 ends here. Waiting for human confirmation before Phase 3 (PDF
extraction: `pdf_page_text` migration 082, native pure-Go text-layer
extractor, local PaddleOCR default adapter, feature-flagged cloud job adapter;
tests B-T04, B-T27, B-T28 PDF part, B-T34, B-T37 OCR part — all with fake
runtime/fake job API, no real network/token).