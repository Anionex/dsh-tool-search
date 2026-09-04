/** Codex-compatible tool search document construction. */
export interface JsonSchemaLike {
    description?: unknown;
    properties?: unknown;
    items?: unknown;
    anyOf?: unknown;
}
export interface ToolSchemaLike {
    name: string;
    description?: string;
    parameters: unknown;
}
export interface ToolCatalogEntry {
    name: string;
    description: string;
    parameters: unknown;
    searchText: string;
}
/**
 * Append descriptions and property names in the same recursive shape used by
 * Codex: description, sorted object properties, array items, then anyOf.
 */
export declare function appendSchemaSearchText(schema: unknown, parts: string[]): void;
export declare function toolSearchText(tool: ToolSchemaLike): string;
export declare function buildCatalog(tools: readonly ToolSchemaLike[]): ToolCatalogEntry[];
//# sourceMappingURL=catalog.d.ts.map