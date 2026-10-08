# AI Narration Implementation Plan

Goal: deliver a usable page-aware narration editor with bounded model requests.
Architecture: shared contracts/material normalization, local demo HTTP adapter, React draft workflow, existing timeline commit chain.
Spec: ../specs/2026-09-21-ai-narration-design.md

- [x] Shared narration material builder and strict result validation. Test text/table/group extraction, filtering, budgets, invalid IDs and reordered nodes.
- [x] Server adapter with bounded single upstream request, config status, timeout/cancel/error handling and no fake fallback. Test with local mock transport.
- [x] Draft workspace and session configuration; current/all queue, cancellation, cache, user-edit locks and explicit application through existing shot updater.
- [x] Replace misleading legacy fallback button with new workspace entry; invalidate changed audio previews; verify save/reopen and animation binding preservation.
- [x] Targeted tests/typechecks and browser workflow; document real-provider limitation if no key.

Ruling: implement the explicitly requested testable version in the existing local checkout; no Git metadata exists and no branch/commit is created. Use existing shots as first-release node IDs to preserve saved projects and export compatibility. Arbitrary node split/merge and word-level alignment are later stages.

Validation ledger (2026-09-21):

- Shared material/contracts: 4 tests passed, including group visibility and target expansion.
- Core embedded Word extraction: 2 tests passed, including unsupported math gaps.
- Server adapter: 2 tests passed; explicit client settings do not inherit server secrets.
- React narration and existing animation binding suites: 59 tests passed across 4 files.
- Core/shared builds, React typecheck, and React demo production build passed. Existing bundle-size warnings remain.
- Browser with local mock provider: generation gated without key; draft generation/edit/application succeeded; manually edited draft locked; narration and lock survived reload. Test sample text restored afterwards.
- Review: fixed unsupported OMML silently losing symbols and manually edited drafts failing to lock.
- Real-provider quality and latency remain unverified because no API key is configured. No external model call made.
- Ruling: React storyboard is the existing demo-specific product surface; shared extraction/contracts live in shared/core, without adding unrelated storyboard UIs to other bindings.

- Actual 43-page user deck passed local mock queue end-to-end without applying drafts; page 10 produced its two existing event nodes and reused cache on the all-pages run. Mock provider stopped after testing; UI reset to default real-provider configuration.
