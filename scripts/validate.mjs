import { readFile, stat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
const errors = []

function check(condition, message) {
  if (!condition) errors.push(message)
}

async function exists(path) {
  try {
    return (await stat(join(root, path))).isFile()
  } catch {
    return false
  }
}

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
check(pkg.name === '@anionex/dsh-tool-search', 'package name is incorrect')
check(pkg.version === '0.1.1', 'release version is incorrect')
check(pkg.main === './lib/index.js', 'main entrypoint is incorrect')
check(pkg.types === './lib/types/index.d.ts', 'types entrypoint is incorrect')
check(pkg.exports?.['./client']?.default === './lib/client.js', 'client export is incorrect')
check(pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'bundle patch is not declared')
check(pkg.dsh?.client?.platform === 'web', 'Web client is not declared')
for (const edge of [
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-settings',
]) {
  check(pkg.dsh?.client?.inject?.includes(edge), `Web client injection edge is missing: ${edge}`)
}
check(pkg.dependencies?.['wink-porter2-stemmer'] === '^2.0.1', 'runtime stemmer dependency is missing')
check(pkg.peerDependenciesMeta?.['@deepseek-ai/dsh-host-webserver']?.optional === true, 'Web server peer must remain optional')

for (const group of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
  for (const [name, spec] of Object.entries(pkg[group] ?? {})) {
    check(typeof spec === 'string', `${group}.${name} must be a string`)
    if (typeof spec !== 'string') continue
    check(!/^(?:file:|link:|workspace:|\/|[A-Za-z]:[\\/])/u.test(spec), `${group}.${name} is machine-local: ${spec}`)
  }
}

for (const path of [
  'LICENSE',
  'README.md',
  'README.zh.md',
  'cordis.patch.yml',
  'pnpm-lock.yaml',
  'lib/index.js',
  'lib/types/index.d.ts',
  'lib/client.js',
  'lib/types/client/index.d.ts',
  'docs/benchmark-results.json',
  'scripts/benchmark.mjs',
  'scripts/profile-e2e.mjs',
  'scripts/validate.mjs',
  'tests/runtime.spec.ts',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'tsconfig.client.json',
  'tsconfig.test.json',
  'tsdown.config.mjs',
]) check(await exists(path), `required package file is missing: ${path}`)

if (await exists('docs/benchmark-results.json')) {
  try {
    const benchmark = JSON.parse(await readFile(join(root, 'docs/benchmark-results.json'), 'utf8'))
    const generatorPath = join(root, benchmark.fixture?.generator ?? '')
    const generatorHash = createHash('sha256').update(await readFile(generatorPath)).digest('hex')
    check(benchmark.schemaVersion === 2, 'benchmark schema version is incorrect')
    check(benchmark.packageVersion === pkg.version, 'benchmark package version is stale')
    check(benchmark.fixture?.generatorSha256 === generatorHash, 'benchmark generator hash is stale')
    check(JSON.stringify(benchmark.fixture?.sizes) === JSON.stringify([10, 30, 50, 100]), 'benchmark fixture sizes are incorrect')
    const rows = benchmark.rows.map(row => (
      `| ${row.tools} | ${row.fullTokens.toLocaleString('en-US')} | ${row.deferredInitialTokens.toLocaleString('en-US')} | ${row.initialReductionPercent}% | ${row.afterTop5Tokens.toLocaleString('en-US')} |`
    ))
    for (const readme of ['README.md', 'README.zh.md']) {
      const text = await readFile(join(root, readme), 'utf8')
      for (const row of rows) check(text.includes(row), `${readme} benchmark table is stale: ${row}`)
    }
  } catch (error) {
    errors.push(`benchmark artifact validation failed: ${String(error)}`)
  }
}

if (await exists('lib/client.js')) {
  const client = await readFile(join(root, 'lib/client.js'), 'utf8')
  check(client.startsWith('window.__ModuleLoader__.load('), 'client artifact is not wrapped for the DSH module loader')
  check(client.includes('@anionex/dsh-tool-search'), 'client artifact is missing its plugin id')
  let descriptor
  try {
    runInNewContext(client, {
      window: {
        __ModuleLoader__: {
          load(value) { descriptor = value },
        },
      },
    })
    check(descriptor?.id === '@anionex/dsh-tool-search', 'client loader descriptor id is incorrect')
    check(typeof descriptor?.factory === 'function', 'client loader descriptor has no factory')
    const exports = descriptor?.factory(name => require(name))
    check(typeof exports?.apply === 'function', 'client loader factory has no apply() export')
  } catch (error) {
    errors.push(`client loader execution failed: ${String(error)}`)
  }
}

if (await exists('cordis.patch.yml')) {
  const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
  check(patch.includes('id: dsh-tool-search'), 'bundle patch does not declare dsh-tool-search')
  check(patch.includes("name: '@anionex/dsh-tool-search'"), 'bundle patch package name is incorrect')
}

if (await exists('lib/index.js')) {
  const runtime = await import(`${pathToFileURL(join(root, 'lib/index.js')).href}?validate=${Date.now()}`)
  check(runtime.name === '@anionex/dsh-tool-search', 'built Host plugin id is incorrect')
  check(typeof runtime.apply === 'function', 'built Host plugin has no apply()')
  check(typeof runtime.Bm25Index === 'function', 'built Host plugin has no BM25 export')
}

const packed = spawnSync('npm', ['pack', '--ignore-scripts', '--dry-run', '--json'], {
  cwd: root,
  encoding: 'utf8',
  timeout: 120_000,
})
check(packed.status === 0, `npm pack --dry-run failed: ${packed.stderr}`)
if (packed.status === 0) {
  let rows
  try {
    rows = JSON.parse(packed.stdout)
  } catch {
    errors.push('npm pack --dry-run did not return JSON')
  }
  const files = new Set(rows?.[0]?.files?.map(file => file.path) ?? [])
  for (const path of [
    'lib/index.js',
    'lib/client.js',
    'lib/types/index.d.ts',
    'src/runtime.ts',
    'scripts/benchmark.mjs',
    'tests/runtime.spec.ts',
    'tsconfig.json',
    'docs/benchmark-results.json',
    'cordis.patch.yml',
  ]) {
    check(files.has(path), `packed tarball is missing ${path}`)
  }
  check(!files.has('node_modules'), 'packed tarball includes node_modules')
  check(![...files].some(path => path.endsWith('.env')), 'packed tarball includes an .env file')
}

if (errors.length > 0) {
  process.stderr.write(`${errors.map(error => `- ${error}`).join('\n')}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(JSON.stringify({
    ok: true,
    package: `${pkg.name}@${pkg.version}`,
    packedFiles: packed.status === 0 ? JSON.parse(packed.stdout)[0].files.length : 0,
  }, null, 2) + '\n')
}
