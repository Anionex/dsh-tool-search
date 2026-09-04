# dsh-tool-search

面向 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/DeepSeek-Harness) 的 Codex 风格延迟工具加载插件。

`dsh-tool-search` 保留真实的 DSH 工具注册表，只缩小模型可见的工具集合。新 Agent 起初只看到维护中的核心工具和 `tool_search`。调用 `tool_search` 后，插件在本地延迟工具元数据上运行确定性 BM25，将 Top-K 结果加入该 Agent 的已选集合，并在下一次模型调用中暴露它们的完整原生 schema。模型随后用真实工具名调用，仍经过 DSH 原有执行链。

## 安装

```bash
dsh plugin --profile web add @anionex/dsh-tool-search
```

需要时可把 `web` 换成 `headless` 或其他 DSH profile。安装后应重启运行中的 profile，并新建会话。

部分 Node.js 24+ 版本的 DSH 独立启动器无法解析 Profile 中的裸包名。若启动时报 `Cannot find package '@anionex/dsh-tool-search'`，请使用 `node --expose-internals "$(command -v dsh)" --profile <name> ...`；这是 DSH 上游 loader 的限制，不是插件通过其他路径加载。

要求：

- DSH `0.1.1-rc.1` 至当前 `0.1.2-rc.1` 预发布版本线
- Node.js `^22.19.0 || >=24.0.0`
- 原生工具展示模式

## 行为

初始原生 schema 集合包含：

- `tool_search`
- `apply_patch`
- `DEFAULT_CORE_TOOLS` 中维护的 DSH 核心工具
- `alwaysVisible` 中配置的精确名称

`0.1.0` 把以下名称视为核心工具：

```text
apply_patch, ask_user_question, bash, create_goal, dsh_im_return_file,
exit_plan_mode, get_goal, interrupt_agent, job_kill, job_list, job_output,
list_agents, ralph, report, send_message, skill, subagent, subagent_fork,
todo_write, update_goal, workflow
```

其他已注册工具都可搜索，但默认不显示。`neverSearch` 同时从初始集合和搜索语料中隐藏名称，并在与 `alwaysVisible` 冲突时优先。`tool_search` 自身不能被拉黑，避免配置后无工具可发现。

已选集合具备以下语义：

- 每个活跃 Agent 相互隔离；
- 一个 Agent 生命周期内只增长；
- resume 时从成功的 `tool_search` 结果恢复；
- fork 时从复制的历史前缀恢复；
- 设置变化只改变当前有效可见性，不删除已选历史。

工具或提示词注册表变化会让全部缓存目录失效。下一次 assembly 或搜索按当前作用域 schema 重建索引。

## 设置

DSH Web 设置页提供：

- 默认结果数，范围 `1-20`，默认 `5`；
- 精确工具名常驻白名单；
- 精确工具名搜索黑名单；
- 可筛选的实时工具目录及逐工具策略选择。

等价配置：

```yaml
- id: dsh-tool-search
  config:
    defaultLimit: 5
    alwaysVisible:
      - my_frequent_tool
    neverSearch:
      - internal_debug_tool
```

## 搜索合同

每个函数工具的搜索文档按顺序包含：

1. `tool.name`
2. `tool.name.replaceAll("_", " ")`
3. `tool.description`
4. 递归遍历 schema：先输出当前节点描述，再按排序后的属性名逐项输出“属性名 + 该属性的嵌套描述”；随后处理 `items` 和 `anyOf`

本地索引使用 `k1=1.2`、`b=0.75` 的 BM25，包含英语停用词移除和 Porter2 词干化。精确原始名称命中固定排第一；其他结果先按 BM25 分数降序，再按工具名 Unicode 码点字典序稳定处理同分。搜索结果只有名称、短描述和分数，不重复参数 schema。

## Codex 对齐

实现对照了源码调研期间 `openai/codex` 最新 `main` 提交 [`3fde89f`](https://github.com/openai/codex/commit/3fde89f628281b9b049376fb0cec4d1577bfeaec)。Codex 的通用函数文档构造器是字段顺序和递归 schema 遍历的依据；Codex 同样使用 `bm25` `2.3.2` 的英语 tokenizer 与相同 BM25 默认参数。

DSH 适配差异：

| 范围 | Codex | 本插件 |
| --- | --- | --- |
| 默认 Top-K | 当前上游为 8 | 5 |
| 加载协议 | Responses API 的 `tool_search_output` 在历史中携带可加载定义 | 普通 DSH `tool_search` 返回摘要，下一请求加入原生 schema |
| 已加载状态 | 定义保留在模型历史时可用 | 每 Agent 单调已选集合，并从 DSH session 事件恢复 |
| 同分排序 | 上游候选顺序可能不稳定 | 工具名字典序 tie-break |
| 精确名称 | 普通 BM25 排名 | 显式保证 Recall@1 |
| 字符转写 | Rust `deunicode` | Unicode NFKD 变音符号折叠 |
| 结果载荷 | 定义，无分数 | 摘要和分数，无 schema |

这些差异是有意设计。DSH 没有 Responses API 的 `tool_search_output` 历史类型，而需求要求下一模型轮注入 schema、稳定恢复已选集合。

## 执行语义

插件只过滤 `PromptAssembly.tools` 和匹配的 `tool:<name>` 指引段，不注销工具，也不调用 `ctx.tools.restrict()`。

发现后的真实工具调用仍经过 DSH 标准链：

```text
tool/call
  -> tools/pre-execute
  -> 用户审批
  -> guards
  -> tools/execute
  -> ToolDefinition.execute
  -> tools/post-execute
  -> finalizer
  -> tools/result
  -> tool/result
```

延迟可见性是上下文与 token 优化，不是授权边界。模型或调用方若已知隐藏工具的真实名称，仍可尝试调用；审批、guard、sandbox 和工具自身校验继续承担安全职责。

已选集合只在 post-execute 策略之后、最终 `tools/result` 成功时提交。finalizer 会持久化驱动实时提交的同一份紧凑、无 schema JSON 结果，因此 resume/fork 重放不会与内存中的已选集合分叉。

## Token 基准

`pnpm benchmark` 使用 `gpt-tokenizer` 默认的 `o200k_base` 编码器，对确定性的嵌套 OpenAI function-tool wire schema 计数：

| 延迟工具数 | 完整初始 schema | 仅 `tool_search` | 初始减少 | 加载 Top-5 后 |
| ---: | ---: | ---: | ---: | ---: |
| 10 | 1,822 | 103 | 94.3% | 1,013 |
| 30 | 5,462 | 103 | 98.1% | 1,013 |
| 50 | 9,102 | 103 | 98.9% | 1,013 |
| 100 | 18,202 | 103 | 99.4% | 1,013 |

随包发布的生成器和完整 fixture 构造位于 [`scripts/benchmark.mjs`](scripts/benchmark.mjs)。[`docs/benchmark-results.json`](docs/benchmark-results.json) 记录包版本、生成器与语料 SHA-256、fixture 规模、tokenizer 和机器可读结果。应用总量还包含核心 schema 和系统提示词 token，生产环境的百分比取决于实际安装工具集合。

## 验证

```bash
pnpm install --frozen-lockfile
pnpm validate
pnpm run e2e:profile
```

测试覆盖文档构造、精确名称 Recall@1、能力 Recall@5、同分稳定性、Agent 隔离、集合单调增长、注册表刷新、结果形状、最终成功后提交、post-execute 拒绝与改写、只多一轮加载、resume/fork 恢复、实时设置、Web 控件，以及真实 DSH approval/guard/event/execute 链。Profile E2E 会把打包产物安装到全新 `DSH_HOME`，再驱动一个脚本化真实 Agent 完成搜索、下一轮 schema 可见和真实名称调用。发布验收会在 DSH `0.1.1-rc.1` 和 `0.1.2-rc.1` 上分别运行该 E2E。

## 已知限制

- 必须使用原生模式。DSH code/PTC 和 `both` 模式会独立渲染 `tools:sdk` 提示词段；稳定插件 API 没有过滤 SDK 的渲染钩子。插件会用明确错误拒绝这些 assembly，避免搜索不可用时仍泄露未过滤 SDK。
- 部分 Node.js 24+ 版本下，DSH `0.1.2-rc.1` 独立启动器无法访问 Node 内部 ESM loader，因而不能解析任何 Profile 中以裸包名安装的外部插件。若启动时报 `Cannot find package '@anionex/dsh-tool-search'`，请改用 `node --expose-internals "$(command -v dsh)" --profile <name> ...`。CI 会在 Node 22 上强制验证标准裸包名加载；Profile E2E 也会记录本地运行是否用到了这一启动器兼容方案。
- 工具定义不提供包来源。新加入的 DSH 核心工具默认延迟，直到本包更新 `DEFAULT_CORE_TOOLS`，或用户加入白名单。
- 插件会随隐藏 schema 一起过滤精确 `tool:<name>` 指引。任意第三方提示词段没有工具来源，无法可靠改写。
- 英语词干化和 NFKD 折叠不是语义或多语言检索；没有 reranker 或 embedding fallback。
- 协作式 prompt waterfall 不是抵御恶意插件的安全边界。

## 许可证

MIT
