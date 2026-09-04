/** Codex-compatible tool search document construction. */

export interface JsonSchemaLike {
  description?: unknown
  properties?: unknown
  items?: unknown
  anyOf?: unknown
}

export interface ToolSchemaLike {
  name: string
  description?: string
  parameters: unknown
}

export interface ToolCatalogEntry {
  name: string
  description: string
  parameters: unknown
  searchText: string
}

function pushPart(parts: string[], value: unknown): void {
  if (typeof value !== 'string') return
  const part = value.trim()
  if (part.length > 0) parts.push(part)
}

/**
 * Append descriptions and property names in the same recursive shape used by
 * Codex: description, sorted object properties, array items, then anyOf.
 */
export function appendSchemaSearchText(schema: unknown, parts: string[]): void {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return
  const node = schema as JsonSchemaLike
  pushPart(parts, node.description)

  if (typeof node.properties === 'object' && node.properties !== null && !Array.isArray(node.properties)) {
    const properties = node.properties as Record<string, unknown>
    for (const name of Object.keys(properties).sort()) {
      pushPart(parts, name)
      appendSchemaSearchText(properties[name], parts)
    }
  }
  appendSchemaSearchText(node.items, parts)
  if (Array.isArray(node.anyOf)) {
    for (const variant of node.anyOf) appendSchemaSearchText(variant, parts)
  }
}

export function toolSearchText(tool: ToolSchemaLike): string {
  const parts: string[] = []
  pushPart(parts, tool.name)
  pushPart(parts, tool.name.replaceAll('_', ' '))
  pushPart(parts, tool.description)
  appendSchemaSearchText(tool.parameters, parts)
  return parts.join(' ')
}

export function buildCatalog(tools: readonly ToolSchemaLike[]): ToolCatalogEntry[] {
  const byName = new Map<string, ToolCatalogEntry>()
  for (const tool of tools) {
    if (byName.has(tool.name)) continue
    byName.set(tool.name, {
      name: tool.name,
      description: tool.description?.trim() ?? '',
      parameters: structuredClone(tool.parameters),
      searchText: toolSearchText(tool),
    })
  }
  return [...byName.values()].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
}
