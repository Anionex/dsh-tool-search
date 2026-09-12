/** Values shared by the Host runtime and Web settings client. */
export const TOOL_SEARCH_NAME = 'tool_search';
export const TOOL_SEARCH_SETTINGS_NAMESPACE = 'tool-search';
export const TOOL_SEARCH_CATALOG_ROUTE = '/_dsh/tool-search/catalog';
export const DEFAULT_RESULT_LIMIT = 5;
export const MAX_RESULT_LIMIT = 20;
/** Prompt section carrying the generated PTC tool SDK (`ptc` and `both` modes). */
export const TOOL_SDK_SECTION_NAME = 'tools:sdk';
/**
 * Markers identifying which renderer produced an SDK section we did not
 * assemble ourselves. Used only when the code runtime cannot be read from the
 * context, because the renderer must match the flavor the model was told to
 * program against.
 */
export const TOOL_SDK_LANGUAGE_MARKERS = Object.freeze({
    typescript: 'interface ToolArgsMap',
    python: 'class Tools(Protocol)',
});
/**
 * Stable bootstrap surface for current DSH releases. Unknown future first-party
 * names are deferred until this list or the user allowlist is updated because
 * ToolDefinition does not expose package provenance.
 */
export const DEFAULT_CORE_TOOLS = Object.freeze([
    'apply_patch',
    'ask_user_question',
    'bash',
    'create_goal',
    'exit_plan_mode',
    'get_goal',
    'interrupt_agent',
    'job_kill',
    'job_list',
    'job_output',
    'list_agents',
    'ralph',
    'report',
    'send_message',
    'skill',
    'subagent',
    'subagent_fork',
    'todo_write',
    'update_goal',
    'workflow',
]);
export const DEFAULT_SETTINGS = Object.freeze({
    defaultLimit: DEFAULT_RESULT_LIMIT,
    alwaysVisible: [],
    neverSearch: [],
});
//# sourceMappingURL=shared.js.map