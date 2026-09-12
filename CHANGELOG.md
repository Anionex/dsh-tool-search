# Changelog

## 0.1.2 - 2026-09-12

- Support every DSH tool presentation mode: `native`, `ptc` (the `code` mode of DSH `0.1.1` and earlier), and `both`. The plugin no longer aborts an Agent whose assembly carries a generated `tools:sdk` section.
- Rebuild the search catalog from the Agent's scoped registry view instead of the assembly, so deferred tools stay searchable when the assembly collapses to the reserved `run_code` transport.
- Regenerate the `tools:sdk` section with DSH's own renderers (`renderToolsSdk`, `renderToolsSdkPy`, selected by the mounted code runtime language) so the SDK advertises exactly the visible tool set, and keep an empty SDK section (an Agent-scoped native override) untouched.
- Extend compatibility to DSH `0.1.5-rc.1` and cover PTC in the profile E2E: reserved-transport-only assembly, filtered SDK before selection, SDK exposure after selection, and real dispatch of the selected tool through `run_code`.
- Add unit coverage for PTC, `both`, Python-flavored SDK rendering, renderer fallback, and unchanged-assembly passthrough.

## 0.1.1 - 2026-09-05

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
