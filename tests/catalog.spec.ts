import { describe, expect, it } from 'vitest'
import { appendSchemaSearchText, toolSearchText } from '../src/catalog.ts'

describe('Codex-aligned search documents', () => {
  it('indexes the exact required fields and recursively nested descriptions', () => {
    const text = toolSearchText({
      name: 'browser_take_screenshot',
      description: 'Capture the active browser page.',
      parameters: {
        type: 'object',
        description: 'Screenshot request.',
        properties: {
          target: {
            type: 'object',
            description: 'Optional element target.',
            properties: {
              selector: { type: 'string', description: 'Unique CSS selector.' },
            },
          },
          formats: {
            type: 'array',
            description: 'Requested encodings.',
            items: { type: 'string', description: 'One image encoding.' },
          },
          destination: {
            anyOf: [
              { type: 'string', description: 'Output filename.' },
              {
                type: 'object',
                properties: {
                  artifact: { type: 'boolean', description: 'Return an artifact.' },
                },
              },
            ],
          },
        },
      },
    })

    expect(text).toContain('browser_take_screenshot browser take screenshot')
    expect(text).toContain('Capture the active browser page.')
    expect(text).toContain('Screenshot request.')
    expect(text).toContain('destination')
    expect(text).toContain('formats Requested encodings. One image encoding.')
    expect(text).toContain('target Optional element target. selector Unique CSS selector.')
    expect(text).toContain('Output filename.')
    expect(text).toContain('artifact Return an artifact.')
    expect(text.indexOf('destination')).toBeLessThan(text.indexOf('formats'))
    expect(text.indexOf('formats')).toBeLessThan(text.indexOf('target'))
  })

  it('ignores unsupported schema annotations and malformed nodes', () => {
    const parts: string[] = []
    appendSchemaSearchText({
      title: 'Not indexed',
      examples: ['Not indexed'],
      properties: null,
      items: 'not-a-schema',
      anyOf: [{ description: 'Indexed branch' }, null],
    }, parts)
    expect(parts).toEqual(['Indexed branch'])
  })
})
