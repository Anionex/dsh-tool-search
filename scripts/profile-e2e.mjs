import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packageVersion = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version
const dsh = process.env.DSH_BIN ?? 'dsh'
const keepTemp = process.argv.includes('--keep-temp')
const timeoutMs = Number(process.env.DSH_TOOL_SEARCH_E2E_TIMEOUT_MS ?? 180_000)

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)))
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)))
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', code => {
      clearTimeout(timer)
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      })
    })
  })
}

async function checked(command, args, options) {
  const result = await run(command, args, options)
  if (result.code !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.code})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }
  return result
}

async function pack(directory, destination) {
  const result = await checked('npm', ['pack', '--ignore-scripts', '--pack-destination', destination, '--json'], {
    cwd: directory,
  })
  const filename = JSON.parse(result.stdout)[0]?.filename
  if (typeof filename !== 'string') throw new Error(`npm pack returned no filename: ${result.stdout}`)
  return join(destination, filename)
}

async function fixturePackage(directory) {
  await mkdir(join(directory, 'lib'), { recursive: true })
  await writeFile(join(directory, 'package.json'), `${JSON.stringify({
    name: '@dsh-tool-search/e2e-fixture',
    version: '1.0.0',
    type: 'module',
    main: './lib/index.js',
    files: ['lib', 'cordis.patch.yml'],
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    peerDependencies: {
      '@deepseek-ai/dsh-tools': '^0.1.0-rc.8',
    },
  }, null, 2)}\n`)
  await writeFile(join(directory, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: tool-search-e2e-fixture',
    "      name: '@dsh-tool-search/e2e-fixture'",
    '',
  ].join('\n'))
  await writeFile(join(directory, 'lib', 'index.js'), [
    "import { defineTool } from '@deepseek-ai/dsh-tools'",
    "export const name = '@dsh-tool-search/e2e-fixture'",
    "export const inject = ['tools']",
    'export function apply(ctx) {',
    '  ctx.tools.register(defineTool({',
    "    name: 'fixture_echo',",
    "    description: 'Echo a text value for deferred tool Agent acceptance.',",
    "    parameters: { value: { type: 'string', required: true, description: 'Text value to echo.' } },",
    '    output: {',
    "      schema: { type: 'object', additionalProperties: false, properties: { echo: { type: 'string', required: true } } },",
    "      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],",
    '    },',
    '    execute: args => Promise.resolve({ echo: args.value }),',
    '  }))',
    '  ctx.tools.register(defineTool({',
    "    name: 'dsh_im_return_file',",
    "    description: 'Send a readable file to the user through the conversation.',",
    "    parameters: { path: { type: 'string', required: true, description: 'Readable file path.' } },",
    '    output: {',
    "      schema: { type: 'object', additionalProperties: false, properties: { sent: { type: 'boolean', required: true } } },",
    "      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],",
    '    },',
    '    execute: () => Promise.resolve({ sent: true }),',
    '  }))',
    '}',
    '',
  ].join('\n'))
}

async function startLlm(script = [
  { kind: 'tool', name: 'tool_search', arguments: '{"query":"dsh_im_return_file","limit":1}' },
  { kind: 'tool', name: 'dsh_im_return_file', arguments: '{"path":"/tmp/tool-search-e2e.txt"}' },
  { kind: 'text', text: 'tool search e2e done' },
]) {
  const requests = []
  let index = 0
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end('{"error":"not-found"}')
      return
    }
    const chunks = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      let body
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end('{"error":"invalid-json"}')
        return
      }
      requests.push(body)
      const step = script[index++]
      if (step === undefined) {
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end('{"error":{"message":"script-exhausted"}}')
        return
      }
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      const send = payload => response.write(`data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`)
      if (step.kind === 'tool') {
        send({
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index: 0,
                id: `tool-search-e2e-${index}`,
                type: 'function',
                function: { name: step.name, arguments: step.arguments },
              }],
            },
            finish_reason: null,
          }],
        })
        send({
          choices: [{ index: 0, delta: { content: '' }, finish_reason: 'tool_calls' }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        })
      } else {
        send({ choices: [{ index: 0, delta: { content: step.text }, finish_reason: null }] })
        send({
          choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        })
      }
      send('[DONE]')
      response.end()
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('mock LLM did not bind a TCP port')
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error === undefined ? resolve() : reject(error))
      server.closeAllConnections()
    }),
  }
}

function requestToolNames(body) {
  return body?.tools?.map(tool => tool?.function?.name).filter(name => typeof name === 'string') ?? []
}

function toolResultTexts(body) {
  return body?.messages
    ?.filter(message => message?.role === 'tool')
    .map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)) ?? []
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function exposedDshScript(command) {
  if (process.env.DSH_BIN === undefined) {
    return join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  }
  const profileCandidate = join(dirname(dirname(command)), '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  try {
    await access(profileCandidate)
    return profileCandidate
  } catch {
    return await realpath(command)
  }
}

const home = await mkdtemp(join(tmpdir(), 'dsh-tool-search-e2e-'))
const packageDirectory = join(home, 'packages')
const fixtureDirectory = join(home, 'fixture')
const workspaceDirectory = join(home, 'workspace')
await mkdir(packageDirectory)
await mkdir(workspaceDirectory)
const llm = await startLlm()

try {
  const dshVersion = (await checked(dsh, ['--version'])).stdout.trim()
  const profileModulePrefix = dshVersion.startsWith('0.1.1-')
    ? './node_modules'
    : './profiles/headless/node_modules'
  const dshExecutable = dsh.includes('/')
    ? dsh
    : (await checked('/usr/bin/which', [dsh])).stdout.trim()
  const dshScript = await exposedDshScript(dshExecutable)
  const nodeExecutable = (await checked('/usr/bin/which', ['node'])).stdout.trim()
  const runDshExposed = (args, options) => checked(
    nodeExecutable,
    ['--expose-internals', dshScript, ...args],
    options,
  )
  let runDsh = (args, options) => checked(dsh, args, options)
  if (dshVersion.startsWith('0.1.1-')) {
    runDsh = runDshExposed
  }
  await fixturePackage(fixtureDirectory)
  const pluginTarball = await pack(root, packageDirectory)
  const fixtureTarball = await pack(fixtureDirectory, packageDirectory)
  await runDsh(['plugin', '--profile', 'headless', 'add', pluginTarball], {
    env: { DSH_HOME: home },
  })
  await runDsh(['plugin', '--profile', 'headless', 'add', fixtureTarball], {
    env: { DSH_HOME: home },
  })
  const dump = await runDsh(['--profile', 'headless', '--dump-config'], {
    env: { DSH_HOME: home },
  })
  assert(
    dump.stdout.includes('@anionex/dsh-tool-search'),
    `installed profile omits dsh-tool-search\nstdout:\n${dump.stdout}\nstderr:\n${dump.stderr}`,
  )
  assert(
    dump.stdout.includes('@dsh-tool-search/e2e-fixture'),
    `installed profile omits E2E fixture\nstdout:\n${dump.stdout}\nstderr:\n${dump.stderr}`,
  )

  let entryMode = dshVersion.startsWith('0.1.1-') ? 'bare-exposed-internals' : 'bare'
  let bareFailure
  const bareLlm = await startLlm([{ kind: 'text', text: 'bare package boot ok' }])
  const bareArgs = [
    '--profile', 'headless',
    'Verify standard package loading.',
  ]
  const bareOptions = {
    cwd: workspaceDirectory,
    env: {
      DSH_HOME: home,
      DSH_TELEMETRY_DISABLED: '1',
      DSH_PERMISSION_MODE: 'danger-full-access',
      DEEPSEEK_API_KEY: 'tool-search-e2e-key',
      DEEPSEEK_BASE_URL: bareLlm.baseUrl,
    },
  }
  try {
    const bareResult = await runDsh(bareArgs, bareOptions)
    assert(bareResult.stdout.trim() === 'bare package boot ok', `unexpected bare-load smoke output: ${bareResult.stdout}`)
  } catch (error) {
    if (!String(error).includes('Cannot find package')) throw error
    bareFailure = /Cannot find package '[^']+'/u.exec(String(error))?.[0]
    if (bareLlm.requests.length === 0 && runDsh !== runDshExposed) {
      try {
        const exposedResult = await runDshExposed(bareArgs, bareOptions)
        assert(exposedResult.stdout.trim() === 'bare package boot ok', `unexpected exposed-internals smoke output: ${exposedResult.stdout}`)
        runDsh = runDshExposed
        entryMode = 'bare-exposed-internals'
      } catch {
        entryMode = 'relative-compat'
      }
    } else {
      entryMode = 'relative-compat'
    }
    if (entryMode !== 'bare' && process.env.DSH_TOOL_SEARCH_REQUIRE_BARE === '1') {
      throw new Error(`standard installed package loading is required\n${String(error)}`)
    }
    if (entryMode === 'relative-compat' && process.env.DSH_TOOL_SEARCH_ALLOW_RELATIVE_COMPAT !== '1') {
      throw new Error(`installed package loading failed even with Node internals exposed\n${String(error)}`)
    }
  } finally {
    await bareLlm.close()
  }

  const patch = join(home, 'e2e.patch.yml')
  const patchLines = [
    '# Disable unrelated title generation for deterministic model-call accounting.',
    '- id: session-title-llm',
    '  disabled: true',
  ]
  if (entryMode === 'relative-compat') {
    patchLines.unshift(
      '# CLI-only relative paths work around bare-specifier resolution in standalone dsh launchers.',
      '- id: dsh-tool-search',
      "  name: '@anionex/dsh-tool-search'",
      '  disabled: true',
      '- id: tool-search-e2e-fixture',
      "  name: '@dsh-tool-search/e2e-fixture'",
      '  disabled: true',
      '- insert:',
      '    - id: dsh-tool-search-e2e-relative',
      `      name: ${profileModulePrefix}/@anionex/dsh-tool-search/lib/index.js`,
      '    - id: tool-search-e2e-fixture-relative',
      `      name: ${profileModulePrefix}/@dsh-tool-search/e2e-fixture/lib/index.js`,
    )
  }
  patchLines.push('')
  await writeFile(patch, patchLines.join('\n'))
  const runResult = await runDsh([
    '--profile', 'headless',
    '--patch', patch,
    'Find and call the tool that returns a file through the conversation.',
  ], {
    cwd: workspaceDirectory,
    env: {
      DSH_HOME: home,
      DSH_TELEMETRY_DISABLED: '1',
      DSH_PERMISSION_MODE: 'danger-full-access',
      DEEPSEEK_API_KEY: 'tool-search-e2e-key',
      DEEPSEEK_BASE_URL: llm.baseUrl,
    },
  })

  assert(runResult.stdout.trim() === 'tool search e2e done', `unexpected Agent output: ${runResult.stdout}`)
  assert(llm.requests.length === 3, `expected 3 model calls, received ${llm.requests.length}`)
  const initialNames = requestToolNames(llm.requests[0])
  const searchedNames = requestToolNames(llm.requests[1])
  assert(initialNames.includes('tool_search'), 'initial model call omits tool_search')
  assert(!initialNames.includes('fixture_echo'), 'initial model call exposes deferred fixture_echo')
  assert(!initialNames.includes('dsh_im_return_file'), 'initial model call exposes plugin-provided dsh_im_return_file')
  assert(!searchedNames.includes('fixture_echo'), 'searching dsh_im_return_file exposes unrelated fixture_echo')
  assert(searchedNames.includes('dsh_im_return_file'), 'next model call omits selected dsh_im_return_file')
  const searchResult = toolResultTexts(llm.requests[1]).at(-1) ?? ''
  assert(searchResult.includes('dsh_im_return_file'), 'tool_search result omits dsh_im_return_file summary')
  assert(!searchResult.includes('"parameters"'), 'tool_search result duplicates a full schema')
  const returnFileResult = toolResultTexts(llm.requests[2]).at(-1) ?? ''
  assert(returnFileResult.includes('"sent":true'), 'dsh_im_return_file did not execute through the real Agent loop')

  process.stdout.write(`${JSON.stringify({
    ok: true,
    dsh: dshVersion,
    entryMode,
    bareFailure,
    modelCalls: llm.requests.length,
    initialToolCount: initialNames.length,
    selectedToolCount: searchedNames.length,
    selectedOnNextCall: searchedNames.includes('dsh_im_return_file'),
    package: `@anionex/dsh-tool-search@${packageVersion}`,
    temporaryHome: keepTemp ? home : undefined,
  }, null, 2)}\n`)
} finally {
  await llm.close()
  if (!keepTemp) await rm(home, { recursive: true, force: true })
}
