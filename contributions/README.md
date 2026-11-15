# Contribution records

Records start with this fork's first group commit. Each entry states the actual changes, their value, verification, and limits so the team can explain the work during the presentation.

| No. | Commit | Owner | Scope |
| --- | --- | --- | --- |
| [001](001-group-scope.md) | `docs: restore group scope and contribution log` | Kefan CHEN | Project scope, five-part task list, contribution format |
| [002](002-owner-a-review-package.md) | `docs: prepare owner A review package` | Kefan CHEN | A baseline, candidate requirements, ADR, and test design |
| [003](003-two-provider-protocol.md) | `docs: scope usage measurement to two providers` | Kefan CHEN | A measurement protocol scope |
| [004](004-owner-a-review-response.md) | `docs: address owner A review findings` | Kefan CHEN | Invariants, streaming design, test plan, review response |
| [005](005-owner-a-follow-up.md) | `docs: reconcile main and review follow-ups` | Kefan CHEN | Main synchronization and non-blocking review follow-ups |
| [006](006-owner-a-live-measurement.md) | `docs: record owner A live usage measurement` | Kefan CHEN | Two-provider evidence, neutral test fixture, and A review gate |
| [007](007-owner-a-adr-alignment.md) | `docs: align A decision record with live evidence` | Kefan CHEN | ADR status, streaming evidence, and review gate |
| [008](008-owner-a-integration-inventory.md) | `docs: map A provider-call integration boundaries` | Kefan CHEN | HTTP, service and provider call map for shared budget review |
| [009](009-owner-a-readme-status.md) | `docs: mark completed owner A work in README` | Kefan CHEN | Evidence-based A checklist status and pending PR labels |
| [010](010-owner-b-review-package.md) | `docs: prepare owner B retrieval review package` | WANG Jiaqi | B baseline, hybrid retrieval with configurable embedding/rerank and budget, PDF/PaddleOCR design, test plan, evaluation protocol, course test layout, and AI-use disclosure |
| [011](011-owner-a-budget-implementation.md) | `feat: add per-invocation AI provider call budgets` | Kefan CHEN | Invocation ledger, adapter/service/HTTP/UI integration, tests and measured comparison |
| [012](012-owner-a-stream-review-fixes.md) | `fix: preserve AI stream and summary terminal states` | Kefan CHEN | Strict limited-stream completion, usage-only chunks and summary failure snapshots |
| [013](013-owner-b-implementation.md) | `docs: record B retrieval approval and phase-0 gate` (phase 0; later phases append) | WANG Jiaqi | B implementation of FR-02/NFR-02/INV-04/INV-05: approval gate, baselines, then phased retrieval implementation |

The upstream history predates this group record and is not reconstructed here.
Numbering is append-only and shared by all owners; a new owner takes the next free
number after the records already merged into `main`.
