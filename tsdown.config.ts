/**
 * Standalone build config for the taskboard plugin (single-package repo, so
 * the dsh-web family's shared preset is vendored here instead of imported).
 *
 * Emits two artifacts:
 * - lib/index.js — the node half (ESM, host routes) from src/index.ts.
 * - lib/client.js — the browser half as a closure factory for the GUI's
 *   `window.__ModuleLoader__` (styles and the React view inlined; the
 *   platform module table entries stay external and resolve through the
 *   loader's injected require).
 *
 * Types ship from lib/types via `tsc -b tsconfig.build.json`.
 */
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

/** Package name, stamped into the module-loader handoff and the style tags. */
const ID = '@linxin666/dsh-client-ui-taskboard'

/** Package root (this config lives at the repo root). */
const REPOSITORY_ROOT = fileURLToPath(new URL('.', import.meta.url))

/**
 * The module specifiers the shell shares into its frozen module table
 * (mirrors dsh-web shared/web-platform.ts, 0.2.2-rc.1 cohort). Everything
 * else inlines into the bundle — a require() the table cannot answer is a
 * guaranteed runtime throw.
 */
const PLATFORM_MODULES: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

/** Wire/type layers a client bundle may inline (no shared runtime identity). */
const INLINE_SAFE = /^@deepseek-ai\/dsh-(session|llm|tools|brand)(\/|$)/

/** Generated descriptor/codec contribution with no shared runtime identity. */
const GENERATED_REMOTE = /^@deepseek-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*\/remote$/

/**
 * Virtual-id wrapper keeping stylesheet imports away from tsdown's own css
 * pipeline (which requires @tsdown/css). The suffix matters: tsdown's guard
 * matches ids ending in `.css`, so the virtual id must not.
 */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** The building package's own version, baked in for diagnostics. */
function buildPackageVersion(): string {
  try {
    const manifest = JSON.parse(readFileSync(resolvePath(REPOSITORY_ROOT, 'package.json'), 'utf8')) as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : ''
  } catch {
    return ''
  }
}

/** Rebase a physical path onto a package-relative id when it lives under the package. */
function packageRelativePath(physical: string): string {
  if (!isAbsolute(physical)) return physical
  const packagePath = relative(REPOSITORY_ROOT, physical).split(sep).join('/')
  return packagePath.startsWith('../') ? physical : packagePath
}

/** Node-half build: the host plugin entry as one ESM file. */
const lib: UserConfig = {
  name: ID,
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  // The cordis framework resolves at runtime from the dsh profile tree, never
  // from this repo's install; keep it external (same stance as the family).
  external: ['@deepseek-ai/cordis'],
}

/** Browser-half build: the closure-factory client bundle. */
const client: UserConfig = {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  external: [...PLATFORM_MODULES],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    __DSH_PKG_VERSION__: JSON.stringify(buildPackageVersion()),
  },
  // tsdown auto-externalizes package dependencies; anything NOT in the loader
  // module table must inline instead. A require() the table cannot answer is a
  // guaranteed runtime throw, so the rule is the table list itself.
  noExternal: (id: string) => (PLATFORM_MODULES.includes(id) ? undefined : true),
  plugins: [
    {
      // Bundle purity gate: platform seed entries stay external, inline-safe
      // wire layers inline, and every other @deepseek-ai value import is a
      // build error. Cross-plugin collaboration goes through cordis services.
      name: 'dsh-client-bundle-purity',
      resolveId(source: string) {
        if (!source.startsWith('@deepseek-ai/')) return null
        if (PLATFORM_MODULES.includes(source)) return null
        if (INLINE_SAFE.test(source) || GENERATED_REMOTE.test(source)) return null
        throw new Error(
          `client bundle purity: "${source}" is not a platform module (PLATFORM_MODULES), an inline-safe wire layer, or a generated /remote contribution`,
        )
      },
    },
    {
      // Stylesheets compile with lightningcss and auto-inject one
      // <style data-plugin> tag per file at factory execution (the loader
      // removes plugin-owned tags on unload). Handles both CSS Modules and
      // the plain generated Tailwind stylesheet.
      name: 'dsh-css-inline',
      async resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.css')) return null
        const abs = importer !== undefined ? resolvePath(dirname(importer), source) : source
        return CSS_VIRTUAL_PREFIX + packageRelativePath(abs) + CSS_VIRTUAL_SUFFIX
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
        const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
        const physical = isAbsolute(fileId) ? fileId : resolvePath(REPOSITORY_ROOT, fileId)
        this.addWatchFile(physical)
        const source = await readFile(physical)
        const isModule = fileId.endsWith('.module.css')
        const { code, exports: namedExports } = transform({
          filename: fileId,
          code: source,
          cssModules: isModule ? { pattern: '[hash]_[local]' } : false,
          minify: true,
        })
        const classMap: Record<string, string> = {}
        // Sort deterministically: lightningcss's export iteration order is
        // process-dependent, which would otherwise churn the bundle output.
        for (const [local, exp] of Object.entries(namedExports ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
          classMap[local] = exp.name
        }
        return [
          `const css = ${JSON.stringify(code.toString())};`,
          `const tagId = ${JSON.stringify(`${ID}/${fileId}`)};`,
          'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
          '  const tag = document.createElement(\'style\');',
          `  tag.dataset.plugin = ${JSON.stringify(ID)};`,
          '  tag.dataset.pluginCss = tagId;',
          '  tag.textContent = css;',
          '  document.head.appendChild(tag);',
          '}',
          `export default ${JSON.stringify(classMap)};`,
        ].join('\n')
      },
    },
  ],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [lib, client]
