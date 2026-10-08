# AI narration first testable release

User goal: generate coherent spoken teaching scripts from slide content and animation order, then edit/bind narration in the existing timeline. Pure text models must work with low concurrency and bounded context.

Architecture: shared typed material/result contracts, local extraction and filtering, one request per slide, a single active upstream request, compact structured output referring to stable shot/content IDs. Generate drafts, never auto-apply. Existing narration/animation binding and TTS/export paths remain the playback authority. First release uses existing shots as editable nodes, with multiple sentences allowed and silent animation shots allowed. No word-level timing claims.

UI: AI narration workspace accessible from storyboard. Current/all pages; audience and detail controls; supplementary description; connection base URL/model/key. Key stays in component memory and is not persisted. Show material warnings, generated drafts, per-shot protection, progress, cancel, retry and apply. Preserve manually edited or changed-since-request scripts. In-session cache excludes keys and includes generation options/materials/model endpoint. Explicit rerun bypasses cache.

Input: native text, grouped text, table cell text, speaker notes, compact animation groups, adjacent page text. Filter known template navigation and URLs locally. Unsupported pictures/OLE are marked as missing context rather than guessed. Add local embedded DOCX extraction if supported by the existing dependencies; do not flatten unknown formulas silently.

Server: new versioned page-plan endpoint under existing local-origin protections. OpenAI-compatible chat completions, server environment defaults or explicit session configuration, request length limits, timeout, disconnect abort, response validation. No fake fallback presented as AI. No credential logging. Do not send server environment credentials to a client-selected URL.

Scope: storyboard exists only in the React local demo. Framework-independent planning contracts live in shared; do not invent unrelated storyboard UIs for other bindings.

Verification: material deduplication/limits, response IDs and order, cancellation/serialization, cache, manual edit protection, error retention, UI workflow with mocked provider. Actual third-party generation is only verified when credentials are configured.
