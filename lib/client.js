window.__ModuleLoader__.load({ id: "@anionex/dsh-tool-search", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
let react = require("react");
let react_jsx_runtime = require("react/jsx-runtime");

//#region src/shared.ts
/** Values shared by the Host runtime and Web settings client. */
const TOOL_SEARCH_NAME = "tool_search";
const TOOL_SEARCH_SETTINGS_NAMESPACE = "tool-search";
const TOOL_SEARCH_CATALOG_ROUTE = "/_dsh/tool-search/catalog";
const DEFAULT_RESULT_LIMIT = 5;
/**
* Stable bootstrap surface for current DSH releases. Unknown future first-party
* names are deferred until this list or the user allowlist is updated because
* ToolDefinition does not expose package provenance.
*/
const DEFAULT_CORE_TOOLS = Object.freeze([
	"apply_patch",
	"ask_user_question",
	"bash",
	"create_goal",
	"dsh_im_return_file",
	"exit_plan_mode",
	"get_goal",
	"interrupt_agent",
	"job_kill",
	"job_list",
	"job_output",
	"list_agents",
	"ralph",
	"report",
	"send_message",
	"skill",
	"subagent",
	"subagent_fork",
	"todo_write",
	"update_goal",
	"workflow"
]);
const DEFAULT_SETTINGS = Object.freeze({
	defaultLimit: 5,
	alwaysVisible: [],
	neverSearch: []
});

//#endregion
//#region src/client/index.tsx
/** DSH Web settings surface for deferred tool policy. */
const en = {
	nav: "Tool Search",
	topK: "Default results",
	alwaysVisible: "Always visible",
	neverSearch: "Never searchable",
	catalog: "Tool catalog",
	filter: "Filter tools",
	refresh: "Refresh",
	tool: "Tool",
	policy: "Policy",
	selected: "Live agents",
	defaultPolicy: "Default",
	alwaysPolicy: "Always",
	blockedPolicy: "Blocked",
	loading: "Loading...",
	empty: "No matching tools",
	saved: "Saved",
	onePerLine: "One exact tool name per line"
};
const zh = {
	nav: "工具搜索",
	topK: "默认结果数",
	alwaysVisible: "常驻白名单",
	neverSearch: "搜索黑名单",
	catalog: "工具目录",
	filter: "筛选工具",
	refresh: "刷新",
	tool: "工具",
	policy: "策略",
	selected: "活跃 Agent",
	defaultPolicy: "默认",
	alwaysPolicy: "常驻",
	blockedPolicy: "禁用",
	loading: "加载中...",
	empty: "没有匹配工具",
	saved: "已保存",
	onePerLine: "每行一个精确工具名"
};
const EMPTY_SETTINGS = {
	status: "unavailable",
	value: void 0,
	writable: false
};
const styles = `
.dts-settings{container-type:inline-size;display:flex;flex-direction:column;gap:20px;width:100%;min-width:0;color:var(--dsw-alias-label-primary)}
.dts-toolbar{display:grid;grid-template-columns:minmax(160px,220px) minmax(220px,1fr) auto;align-items:end;gap:12px}
.dts-field{display:flex;flex-direction:column;gap:6px;min-width:0}
.dts-field>span,.dts-section-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dts-input,.dts-textarea,.dts-select{box-sizing:border-box;width:100%;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit}
.dts-input,.dts-select{height:34px;padding:0 9px}.dts-textarea{min-height:104px;padding:8px 9px;resize:vertical;line-height:20px}
.dts-input:focus,.dts-textarea:focus,.dts-select:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.dts-lists{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.dts-hint{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dts-button{height:34px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer}
.dts-button:hover{background:var(--dsw-alias-interactive-bg-hover)}.dts-button:disabled{opacity:.5;cursor:not-allowed}
.dts-status{min-height:18px;font-size:12px;color:var(--dsw-alias-label-secondary)}.dts-status[data-error=true]{color:var(--dsw-alias-state-error-primary)}
.dts-table-wrap{min-width:0;overflow:auto;border-top:1px solid var(--dsw-alias-border-l2);border-bottom:1px solid var(--dsw-alias-border-l2)}
.dts-table{width:100%;min-width:620px;border-collapse:collapse;table-layout:fixed}
.dts-table th,.dts-table td{box-sizing:border-box;padding:9px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);text-align:left;vertical-align:middle;font-size:12px}
.dts-table th{position:sticky;top:0;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-weight:600}
.dts-table tr:last-child td{border-bottom:0}.dts-tool{width:52%}.dts-tool code{display:block;overflow:hidden;text-overflow:ellipsis;overflow-wrap:anywhere;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.dts-description{display:block;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary)}
.dts-policy{width:26%}.dts-selected{width:22%;color:var(--dsw-alias-label-secondary)}
@container(max-width:620px){.dts-toolbar{grid-template-columns:1fr auto}.dts-toolbar .dts-limit{grid-column:1/-1}.dts-lists{grid-template-columns:1fr}.dts-table{min-width:0}.dts-table thead{display:none}.dts-table tr{display:grid;grid-template-columns:minmax(0,1fr) 132px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}.dts-table td{padding:4px 0;border:0}.dts-table .dts-tool,.dts-table .dts-policy{width:auto}.dts-table .dts-selected{grid-column:1/-1;width:auto;font-size:11px}.dts-table .dts-selected::before{content:attr(data-label) ": ";color:var(--dsw-alias-label-tertiary);font-weight:600}}
`;
function namesFromText(value) {
	return [...new Set(value.split(/\r?\n/u).map((name) => name.trim()).filter(Boolean))].sort();
}
function overrideFor(name, settings) {
	if (settings.neverSearch.includes(name)) return "blocked";
	if (settings.alwaysVisible.includes(name)) return "always";
	return "default";
}
function decodeCatalog(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid catalog response");
	const record = value;
	if (record["schemaVersion"] !== 1 || !Array.isArray(record["tools"]) || typeof record["generation"] !== "number") throw new Error("Invalid catalog response");
	return value;
}
function ToolSearchSettingsSection({ scope, t }) {
	const snapshot = (0, react.useSyncExternalStore)((0, react.useCallback)((notify) => scope?.subscribe(notify) ?? (() => {}), [scope]), (0, react.useCallback)(() => scope?.getSnapshot() ?? EMPTY_SETTINGS, [scope]));
	const [catalog, setCatalog] = (0, react.useState)();
	const [filter, setFilter] = (0, react.useState)("");
	const [alwaysText, setAlwaysText] = (0, react.useState)("");
	const [blockedText, setBlockedText] = (0, react.useState)("");
	const [limitText, setLimitText] = (0, react.useState)(String(5));
	const [status, setStatus] = (0, react.useState)();
	const translate = t ?? ((key) => en[key]);
	const settings = snapshot.value;
	const refresh = (0, react.useCallback)(async () => {
		try {
			const response = await fetch(TOOL_SEARCH_CATALOG_ROUTE, { cache: "no-store" });
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			setCatalog(decodeCatalog(await response.json()));
			setStatus(void 0);
		} catch (error) {
			setStatus({
				text: error instanceof Error ? error.message : String(error),
				error: true
			});
		}
	}, []);
	(0, react.useEffect)(() => {
		refresh();
	}, [refresh]);
	(0, react.useEffect)(() => {
		if (settings === void 0) return;
		setAlwaysText(settings.alwaysVisible.join("\n"));
		setBlockedText(settings.neverSearch.join("\n"));
		setLimitText(String(settings.defaultLimit));
	}, [settings]);
	const commit = (0, react.useCallback)((field, value) => {
		if (scope === void 0 || !snapshot.writable) return;
		setStatus(void 0);
		scope.set(field, value).then(() => {
			setStatus({
				text: translate("saved"),
				error: false
			});
			refresh();
		}, (error) => {
			setStatus({
				text: error instanceof Error ? error.message : String(error),
				error: true
			});
		});
	}, [
		refresh,
		scope,
		snapshot.writable,
		translate
	]);
	const visibleTools = (0, react.useMemo)(() => {
		const query = filter.trim().toLowerCase();
		if (query.length === 0) return catalog?.tools ?? [];
		return (catalog?.tools ?? []).filter((tool) => tool.name.toLowerCase().includes(query) || tool.description.toLowerCase().includes(query));
	}, [catalog, filter]);
	const changePolicy = (name, next) => {
		if (settings === void 0 || name === "tool_search") return;
		const always = new Set(settings.alwaysVisible);
		const blocked = new Set(settings.neverSearch);
		always.delete(name);
		blocked.delete(name);
		if (next === "always") always.add(name);
		if (next === "blocked") blocked.add(name);
		commit("alwaysVisible", [...always].sort());
		commit("neverSearch", [...blocked].sort());
	};
	const core = new Set(DEFAULT_CORE_TOOLS);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "dts-settings",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dts-toolbar",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "dts-field dts-limit",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: translate("topK") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: "dts-input",
							type: "number",
							min: 1,
							max: 20,
							value: limitText,
							disabled: !snapshot.writable,
							onChange: (event) => setLimitText(event.target.value),
							onBlur: () => {
								const value = Number.parseInt(limitText, 10);
								if (Number.isSafeInteger(value) && value >= 1 && value <= 20) commit("defaultLimit", value);
								else setLimitText(String(settings?.defaultLimit ?? 5));
							}
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "dts-field",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: translate("filter") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: "dts-input",
							type: "search",
							value: filter,
							onChange: (event) => setFilter(event.target.value)
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: "dts-button",
						type: "button",
						onClick: () => {
							refresh();
						},
						children: translate("refresh")
					})
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dts-lists",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: "dts-field",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: translate("alwaysVisible") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
						className: "dts-textarea",
						value: alwaysText,
						disabled: !snapshot.writable,
						placeholder: translate("onePerLine"),
						onChange: (event) => setAlwaysText(event.target.value),
						onBlur: () => commit("alwaysVisible", namesFromText(alwaysText))
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: "dts-field",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: translate("neverSearch") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
						className: "dts-textarea",
						value: blockedText,
						disabled: !snapshot.writable,
						placeholder: translate("onePerLine"),
						onChange: (event) => setBlockedText(event.target.value),
						onBlur: () => commit("neverSearch", namesFromText(blockedText).filter((name) => name !== TOOL_SEARCH_NAME))
					})]
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dts-field",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dts-section-title",
						children: translate("catalog")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dts-table-wrap",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
							className: "dts-table",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
									className: "dts-tool",
									children: translate("tool")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
									className: "dts-policy",
									children: translate("policy")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
									className: "dts-selected",
									children: translate("selected")
								})
							] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tbody", { children: [visibleTools.map((tool) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("td", {
									className: "dts-tool",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
										title: tool.name,
										children: tool.name
									}), tool.description.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dts-description",
										title: tool.description,
										children: tool.description
									}) : null]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
									className: "dts-policy",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
										className: "dts-select",
										"aria-label": `${translate("policy")}: ${tool.name}`,
										value: tool.name === "tool_search" ? "always" : overrideFor(tool.name, settings ?? {
											defaultLimit: 5,
											alwaysVisible: [],
											neverSearch: []
										}),
										disabled: !snapshot.writable || tool.name === "tool_search",
										onChange: (event) => changePolicy(tool.name, event.target.value),
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "default",
												children: core.has(tool.name) ? `${translate("defaultPolicy")} (${translate("alwaysPolicy")})` : translate("defaultPolicy")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "always",
												children: translate("alwaysPolicy")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "blocked",
												children: translate("blockedPolicy")
											})
										]
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
									className: "dts-selected",
									"data-label": translate("selected"),
									"aria-label": `${translate("selected")}: ${tool.selectedBy.length}`,
									children: tool.selectedBy.length
								})
							] }, tool.name)), catalog !== void 0 && visibleTools.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tr", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
								colSpan: 3,
								children: translate("empty")
							}) }) : null] })]
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dts-status",
						"data-error": status?.error || void 0,
						children: status?.text ?? (catalog === void 0 ? translate("loading") : "")
					})
				]
			})
		]
	});
}
const inject = [
	"slots",
	"locale",
	"settingsScope"
];
function apply(ctx) {
	ctx.effect(() => {
		if (document.querySelector("style[data-plugin-css=\"@anionex/dsh-tool-search\"]") !== null) return () => {};
		const tag = document.createElement("style");
		tag.dataset.pluginCss = "@anionex/dsh-tool-search";
		tag.textContent = styles;
		document.head.append(tag);
		return () => tag.remove();
	}, "dsh-tool-search: styles");
	ctx.effect(() => ctx.locale.register("settings.toolSearch", {
		en,
		zh
	}), "dsh-tool-search: locale");
	const t = ctx.locale.bind("settings.toolSearch");
	const scope = ctx.settingsScope.bind({ namespace: TOOL_SEARCH_SETTINGS_NAMESPACE });
	ctx.slots.inject("settings.section", () => ctx.slots.register({
		name: "settings.section",
		id: "tool-search",
		order: 34,
		label: () => t("nav"),
		inject: () => ({
			scope,
			t
		})
	}, ToolSearchSettingsSection));
}

//#endregion
exports.ToolSearchSettingsSection = ToolSearchSettingsSection;
exports.apply = apply;
exports.inject = inject;
return module.exports; } });
//# sourceMappingURL=client.js.map