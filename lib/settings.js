/** Validated Host settings and policy resolution. */
import z from '@deepseek-ai/schemastery';
import { DEFAULT_CORE_TOOLS, DEFAULT_RESULT_LIMIT, MAX_RESULT_LIMIT, TOOL_SEARCH_NAME, TOOL_SEARCH_SETTINGS_NAMESPACE, } from "./shared.js";
export const TOOL_SEARCH_SETTINGS_NS = TOOL_SEARCH_SETTINGS_NAMESPACE;
export const Config = z.object({
    defaultLimit: z.number().step(1).min(1).max(MAX_RESULT_LIMIT).default(DEFAULT_RESULT_LIMIT),
    alwaysVisible: z.array(z.string()).default([]),
    neverSearch: z.array(z.string()).default([]),
});
function normalizeNames(names) {
    const normalized = new Set();
    for (const value of names) {
        const name = value.trim();
        if (name.length > 0)
            normalized.add(name);
    }
    return [...normalized].sort();
}
export function normalizeSettings(value) {
    const defaultLimit = Number.isSafeInteger(value.defaultLimit)
        ? Math.min(MAX_RESULT_LIMIT, Math.max(1, value.defaultLimit))
        : DEFAULT_RESULT_LIMIT;
    return {
        defaultLimit,
        alwaysVisible: normalizeNames(value.alwaysVisible),
        neverSearch: normalizeNames(value.neverSearch).filter(name => name !== TOOL_SEARCH_NAME),
    };
}
export class ToolPolicyResolver {
    core = new Set(DEFAULT_CORE_TOOLS);
    always = new Set();
    blocked = new Set();
    constructor(settings) {
        this.update(settings);
    }
    update(settings) {
        this.always = new Set(settings.alwaysVisible);
        this.blocked = new Set(settings.neverSearch);
    }
    classify(name, selected) {
        if (name === TOOL_SEARCH_NAME)
            return 'always';
        if (this.blocked.has(name))
            return 'blocked';
        if (this.core.has(name) || this.always.has(name) || selected?.has(name) === true)
            return 'always';
        return 'deferred';
    }
}
//# sourceMappingURL=settings.js.map