/** Codex-compatible tool search document construction. */
function pushPart(parts, value) {
    if (typeof value !== 'string')
        return;
    const part = value.trim();
    if (part.length > 0)
        parts.push(part);
}
/**
 * Append descriptions and property names in the same recursive shape used by
 * Codex: description, sorted object properties, array items, then anyOf.
 */
export function appendSchemaSearchText(schema, parts) {
    if (typeof schema !== 'object' || schema === null || Array.isArray(schema))
        return;
    const node = schema;
    pushPart(parts, node.description);
    if (typeof node.properties === 'object' && node.properties !== null && !Array.isArray(node.properties)) {
        const properties = node.properties;
        for (const name of Object.keys(properties).sort()) {
            pushPart(parts, name);
            appendSchemaSearchText(properties[name], parts);
        }
    }
    appendSchemaSearchText(node.items, parts);
    if (Array.isArray(node.anyOf)) {
        for (const variant of node.anyOf)
            appendSchemaSearchText(variant, parts);
    }
}
export function toolSearchText(tool) {
    const parts = [];
    pushPart(parts, tool.name);
    pushPart(parts, tool.name.replaceAll('_', ' '));
    pushPart(parts, tool.description);
    appendSchemaSearchText(tool.parameters, parts);
    return parts.join(' ');
}
export function buildCatalog(tools) {
    const byName = new Map();
    for (const tool of tools) {
        if (byName.has(tool.name))
            continue;
        byName.set(tool.name, {
            name: tool.name,
            description: tool.description?.trim() ?? '',
            parameters: structuredClone(tool.parameters),
            searchText: toolSearchText(tool),
        });
    }
    return [...byName.values()].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
}
//# sourceMappingURL=catalog.js.map