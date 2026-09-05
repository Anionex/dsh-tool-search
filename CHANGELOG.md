# Changelog

## Unreleased

- Defer the plugin-provided `dsh_im_return_file` tool instead of treating it as a maintained DSH core tool.

## 0.1.0 - 2026-09-05

- Add deterministic local BM25 discovery for deferred DSH tools.
- Add per-Agent monotonic selection with resume and fork recovery.
- Commit selections only after a successful final result and persist the same canonical recovery payload.
- Keep the real registry and approval, guard, event, and execution semantics intact.
- Keep maintained DSH control-plane tools, including `report`, visible by default and reject unsupported code/PTC presentation modes.
- Add live Web settings for Top-K, always-visible names, and never-search names.
- Add responsive container-based settings layout and compatibility with DSH through `0.1.2-rc.1`.
- Add Recall@1/Recall@5, lifecycle, pipeline, UI, package, token, and real Agent E2E acceptance.
