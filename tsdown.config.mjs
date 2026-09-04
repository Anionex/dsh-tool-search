import { defineConfig } from 'tsdown'

const id = '@anionex/dsh-tool-search'
const platformModules = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-ui-settings/client',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-locale/client',
]

export default defineConfig({
  entry: { client: 'src/client/index.tsx' },
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  outDir: 'lib',
  clean: false,
  sourcemap: true,
  dts: false,
  minify: false,
  deps: {
    neverBundle: platformModules,
    alwaysBundle: dependency => platformModules.includes(dependency) ? undefined : true,
    onlyBundle: false,
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
