import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encode } from 'gpt-tokenizer'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const generator = 'scripts/benchmark.mjs'
const generatorSource = await readFile(fileURLToPath(import.meta.url))
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const sizes = [10, 30, 50, 100]

function generatedTool(index) {
  const id = String(index + 1).padStart(3, '0')
  return {
    name: `integration_${id}_search_records`,
    description: `Search integration ${id} records with account, date, status, ownership, and pagination filters.`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        account_id: {
          type: 'string',
          description: 'Exact customer account identifier.',
        },
        filters: {
          type: 'object',
          description: 'Optional structured record filters.',
          additionalProperties: false,
          properties: {
            created_after: {
              type: 'string',
              description: 'ISO 8601 lower date boundary.',
            },
            owner: {
              type: 'string',
              description: 'Owner email address or stable identifier.',
            },
            statuses: {
              type: 'array',
              description: 'Accepted workflow states.',
              items: {
                type: 'string',
                description: 'One workflow status.',
              },
            },
          },
        },
        limit: {
          type: 'integer',
          description: 'Maximum records to return.',
        },
        cursor: {
          type: 'string',
          description: 'Opaque pagination cursor from the previous result.',
        },
      },
      required: ['account_id'],
    },
  }
}

const searchTool = {
  name: 'tool_search',
  description: 'Search deferred tool metadata with deterministic local BM25. Matching tools become available by their real names on the next model call. Results contain summaries, not full schemas.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: { type: 'string', description: 'Search query for deferred tools.' },
      limit: { type: 'integer', description: 'Maximum number of tools to return. Defaults to 5.' },
    },
    required: ['query'],
  },
}

function wire(tools) {
  return JSON.stringify(tools.map(tool => ({
    type: 'function',
    function: tool,
  })))
}

function tokenCount(tools) {
  return encode(wire(tools)).length
}

const allTools = Array.from({ length: Math.max(...sizes) }, (_value, index) => generatedTool(index))
const rows = sizes.map(size => {
  const corpus = allTools.slice(0, size)
  const fullTokens = tokenCount(corpus)
  const deferredInitialTokens = tokenCount([searchTool])
  const afterTop5Tokens = tokenCount([searchTool, ...corpus.slice(0, 5)])
  return {
    tools: size,
    fullTokens,
    deferredInitialTokens,
    initialTokensSaved: fullTokens - deferredInitialTokens,
    initialReductionPercent: Number(((1 - deferredInitialTokens / fullTokens) * 100).toFixed(1)),
    afterTop5Tokens,
  }
})

const report = {
  schemaVersion: 2,
  packageVersion: packageJson.version,
  tokenizer: 'gpt-tokenizer 4.0.0 (o200k_base default encode)',
  fixture: {
    description: 'Deterministic nested function schemas; full surface versus tool_search-only initial surface.',
    generator,
    generatorSha256: createHash('sha256').update(generatorSource).digest('hex'),
    corpusSha256: createHash('sha256').update(wire(allTools)).digest('hex'),
    sizes,
  },
  rows,
}

if (process.argv.includes('--write')) {
  const output = join(root, 'docs', 'benchmark-results.json')
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
