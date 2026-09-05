/** Values shared by the Host runtime and Web settings client. */
export const TOOL_SEARCH_NAME = 'tool_search';
export const TOOL_SEARCH_SETTINGS_NAMESPACE = 'tool-search';
export const TOOL_SEARCH_CATALOG_ROUTE = '/_dsh/tool-search/catalog';
export const DEFAULT_RESULT_LIMIT = 5;
export const MAX_RESULT_LIMIT = 20;
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