import { describe, expect, it } from 'vitest'
import { Bm25Index, tokenize } from '../src/bm25.ts'
import { toolSearchText, type ToolSchemaLike } from '../src/catalog.ts'

const tools: ToolSchemaLike[] = [
  {
    name: 'browser_take_screenshot',
    description: 'Capture a screenshot of a web page or selected element.',
    parameters: { properties: { target: { description: 'Element to capture.' } } },
  },
  {
    name: 'web_search',
    description: 'Search the public web for current information and sources.',
    parameters: { properties: { queries: { description: 'Search queries.' } } },
  },
  {
    name: 'read_image',
    description: 'Inspect a local PNG JPEG WebP or GIF image.',
    parameters: { properties: { file_path: { description: 'Image path.' } } },
  },
  {
    name: 'browser_file_upload',
    description: 'Upload one or more local files through a browser file chooser.',
    parameters: { properties: { paths: { description: 'Absolute file paths.' } } },
  },
  {
    name: 'browser_network_requests',
    description: 'List HTTP network requests made by the current browser page.',
    parameters: { properties: { filter: { description: 'URL regular expression.' } } },
  },
  {
    name: 'dsh_im_return_file',
    description: 'Send an existing local file to the user.',
    parameters: { properties: { path: { description: 'File to deliver.' } } },
  },
  {
    name: 'browser_navigate',
    description: 'Navigate the browser to a URL.',
    parameters: { properties: { url: { description: 'Destination URL.' } } },
  },
]

function index() {
  return new Bm25Index(tools.map(tool => ({ id: tool.name, name: tool.name, text: toolSearchText(tool) })))
}

describe('deterministic BM25', () => {
  it('guarantees exact-name Recall@1 even for a weak lexical score', () => {
    expect(index().search('browser_network_requests', 1)[0]?.name).toBe('browser_network_requests')
  })

  it.each([
    ['take a screenshot of this page', 'browser_take_screenshot'],
    ['search online for recent sources', 'web_search'],
    ['inspect this png image', 'read_image'],
    ['upload a file in the web page', 'browser_file_upload'],
    ['send this local file to the user', 'dsh_im_return_file'],
  ])('places capability query %j within Top-5', (query, expected) => {
    expect(index().search(query, 5).map(result => result.name)).toContain(expected)
  })

  it('uses lexical tool name as the stable equal-score tie-break', () => {
    const tied = new Bm25Index([
      { id: 2, name: 'zeta_tool', text: 'shared capability' },
      { id: 1, name: 'alpha_tool', text: 'shared capability' },
    ])
    const first = tied.search('shared capability', 2)
    for (let run = 0; run < 20; run += 1) expect(tied.search('shared capability', 2)).toEqual(first)
    expect(first.map(result => result.name)).toEqual(['alpha_tool', 'zeta_tool'])
  })

  it('normalizes, removes English stop words, and stems terms', () => {
    expect(tokenize('The uploaded files are RUNNING')).toEqual(['upload', 'file', 'run'])
  })
})
