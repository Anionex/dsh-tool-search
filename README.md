# dsh-tool-search

Codex-style deferred tool loading for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/DeepSeek-Harness).

`dsh-tool-search` keeps the real DSH tool registry intact while reducing the model-visible tool surface. A new Agent initially sees the maintained core tool set plus `tool_search`. Calling `tool_search` runs deterministic local BM25 over deferred metadata, adds the Top-K matches to that Agent's selected set, and exposes their complete native schemas on the next model call. The model then calls each tool by its real name through the normal DSH execution pipeline.

## Install

```bash
dsh plugin --profile web add @anionex/dsh-tool-search
```

Use `--profile headless` or another DSH profile name when appropriate. Restart a running profile and create a new session after installation.

On affected Node.js 24+ standalone DSH launchers, a bare external Profile package can fail to resolve. If startup reports `Cannot find package '@anionex/dsh-tool-search'`, use `node --expose-internals "$(command -v dsh)" --profile <name> ...`; this is an upstream DSH loader limitation rather than a plugin resolution fallback.

Requirements:

- DSH `0.1.1-rc.1` through the current `0.1.2-rc.1` prerelease line
- Node.js `^22.19.0 || >=24.0.0`
- Native tool presentation mode

## Behavior

The initial native schema surface contains:

- `tool_search`
- `apply_patch`
- DSH core tools maintained in `DEFAULT_CORE_TOOLS`
- exact names added to `alwaysVisible`

Version `0.1.0` treats these names as core:

```text
apply_patch, ask_user_question, bash, create_goal, dsh_im_return_file,
exit_plan_mode, get_goal, interrupt_agent, job_kill, job_list, job_output,
list_agents, ralph, report, send_message, skill, subagent, subagent_fork,
todo_write, update_goal, workflow
```

Every other registered tool is searchable but initially omitted. `neverSearch` hides a name from both the initial surface and the search corpus; it wins a conflict with `alwaysVisible`. `tool_search` itself cannot be blacklisted, preventing a configuration dead end.

The selected set is:

- isolated per live Agent;
- monotonic during that Agent lifecycle;
- reconstructed from successful `tool_search` results on resume;
- reconstructed from the copied history prefix on fork;
- re-evaluated against live settings without deleting its history.

Tool and prompt registry changes invalidate every cached catalog. The next assembly or search rebuilds from current scoped schemas.

## Settings

The DSH Web settings page exposes:

- default result count, `1-20` and `5` by default;
- an exact-name always-visible allowlist;
- an exact-name never-search denylist;
- a live, filterable registry table with per-tool policy controls.

Equivalent settings:

```yaml
- id: dsh-tool-search
  config:
    defaultLimit: 5
    alwaysVisible:
      - my_frequent_tool
    neverSearch:
      - internal_debug_tool
```

## Search Contract

Each function search document contains, in order:

1. `tool.name`
2. `tool.name.replaceAll("_", " ")`
3. `tool.description`
4. a recursive schema traversal that emits each node description, then each sorted property name immediately before that property's nested descriptions; `items` and `anyOf` follow

The local index uses BM25 with `k1=1.2` and `b=0.75`, English stop-word removal, and Porter2 stemming. Exact raw-name matches are always ranked first. Remaining results use descending BM25 score, then code-point lexical tool name as a stable tie-break. Search results contain only names, short descriptions, and scores; they never duplicate parameter schemas.

## Codex Alignment

The implementation was checked against `openai/codex` commit [`3fde89f`](https://github.com/openai/codex/commit/3fde89f628281b9b049376fb0cec4d1577bfeaec), the latest observed `main` commit during the source review. Codex's generic function document builder is the source for the field order and recursive schema traversal. Codex also uses `bm25` `2.3.2` with its English tokenizer and the same BM25 defaults.

Intentional DSH adaptations:

| Area | Codex | This plugin |
| --- | --- | --- |
| Default Top-K | 8 in current upstream | 5 |
| Loading protocol | Responses API `tool_search_output` carries loadable definitions in history | ordinary DSH `tool_search` returns summaries; native schemas appear in the next request |
| Loaded state | definitions remain usable while retained in model history | per-Agent monotonic selected set recovered from DSH session events |
| Equal-score order | upstream candidate order can be unstable | lexical name tie-break |
| Exact name | ordinary BM25 ranking | explicit Recall@1 guarantee |
| Transliteration | Rust `deunicode` | Unicode NFKD diacritic folding |
| Result payload | definitions, no scores | summaries and scores, no schemas |

These differences are deliberate. DSH has no Responses API `tool_search_output` history item, while the requested behavior requires stable selected-set recovery and schema injection on the next model turn.

## Execution Semantics

This plugin filters only `PromptAssembly.tools` and matching `tool:<name>` guidance sections. It does not unregister tools and does not call `ctx.tools.restrict()`.

After discovery, a real tool call still follows DSH's standard chain:

```text
tool/call
  -> tools/pre-execute
  -> user approval
  -> guards
  -> tools/execute
  -> ToolDefinition.execute
  -> tools/post-execute
  -> finalizer
  -> tools/result
  -> tool/result
```

Deferred visibility is a context and token optimization, not an authorization boundary. A model or caller that already knows a hidden real name can still attempt it, and approval, guards, sandboxing, and tool-owned validation remain responsible for enforcement.

Selection is committed only from a successful final `tools/result`, after post-execute policy. The finalizer persists the same compact, schema-free JSON result that drove the live commit, so resume and fork replay cannot diverge from the in-memory selected set.

## Token Benchmark

`pnpm benchmark` tokenizes deterministic nested OpenAI function-tool wire schemas using `gpt-tokenizer`'s default `o200k_base` encoder:

| Deferred tools | Full initial schemas | `tool_search` initial | Initial reduction | After Top-5 |
| ---: | ---: | ---: | ---: | ---: |
| 10 | 1,822 | 103 | 94.3% | 1,013 |
| 30 | 5,462 | 103 | 98.1% | 1,013 |
| 50 | 9,102 | 103 | 98.9% | 1,013 |
| 100 | 18,202 | 103 | 99.4% | 1,013 |

The shipped generator and exact fixture construction are in [`scripts/benchmark.mjs`](scripts/benchmark.mjs). [`docs/benchmark-results.json`](docs/benchmark-results.json) records the package version, generator and corpus SHA-256 hashes, fixture sizes, tokenizer, and machine-readable results. Application totals also include core schemas and system prompt tokens, so production percentage savings depend on the installed tool mix.

## Verification

```bash
pnpm install --frozen-lockfile
pnpm validate
pnpm run e2e:profile
```

The test suite covers document construction, exact-name Recall@1, capability Recall@5, stable ties, per-Agent isolation, monotonic growth, registry refresh, result shape, final-success commit, post-execute rejection and rewrite, one-turn loading, resume/fork recovery, live settings, Web controls, and the real DSH approval/guard/event/execution pipeline. The profile E2E installs the packed plugin into a clean `DSH_HOME` and drives a scripted real Agent through search, next-turn schema exposure, and a real-name tool call. Release validation runs this E2E on DSH `0.1.1-rc.1` and `0.1.2-rc.1`.

## Known Limits

- Native mode is required. DSH code/PTC and `both` modes independently render a `tools:sdk` prompt section; the stable plugin API does not expose a filtered SDK renderer. The plugin rejects those assemblies with a clear error instead of leaving search unavailable while leaking the unfiltered SDK.
- On some Node.js 24+ builds, the DSH `0.1.2-rc.1` standalone launcher cannot access Node's internal ESM loader and therefore cannot resolve any bare external Profile package. If startup reports `Cannot find package '@anionex/dsh-tool-search'`, launch with `node --expose-internals "$(command -v dsh)" --profile <name> ...`. CI requires standard bare-package loading on Node 22; the Profile E2E records whether a local run needed this launcher workaround.
- Tool definitions do not expose package provenance. Newly introduced DSH core names default to deferred until this package updates `DEFAULT_CORE_TOOLS` or the user adds an allowlist entry.
- Exact `tool:<name>` guidance is filtered with a hidden schema. Arbitrary third-party prompt sections have no tool provenance and cannot be safely rewritten.
- English stemming and NFKD folding are not semantic or multilingual retrieval. There is no reranker or embedding fallback.
- Cooperative prompt waterfalls are not a hostile-plugin security boundary.

## License

MIT
