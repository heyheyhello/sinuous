import path from 'path';
import replace from './rollup-plugin-replace.js';
import nodeResolve from '@rollup/plugin-node-resolve';
import bundleSize from 'rollup-plugin-size';
import babel from '@rollup/plugin-babel';
import { terser } from 'rollup-plugin-terser';

/**
 * @typedef {import("rollup").ModuleFormat} ModuleFormat
 * @typedef {import("rollup").InputOptions} InputOptions
 * @typedef {import("rollup").OutputOptions} OutputOptions
 * @typedef {import("rollup").Plugin} Plugin
 * @typedef {InputOptions & { output: OutputOptions }} RollupOptions
 */

/** @type {{ [key: string]: ModuleFormat }} */
const bundleFormatVariables = {
  CJS:  'cjs',
  ESM:  'esm',
  IIFE: 'iife',
  UMD:  'umd',
};

const { CJS, ESM, IIFE, UMD } = bundleFormatVariables;

// Format extensions
const ext = {
  [CJS ]: 'js',
  [ESM ]: 'js',
  [IIFE]: 'min.js',
  [UMD ]: 'js',
};

const src = 'packages/sinuous';
const dest = (name, format) => `${src}/dist/${format}/${name}.${ext[format]}`;

/**
 * For filtering by CLI, as names are dissolved into the config
 * @type {string[]}
 */
const bundleNames = [];

/** @type {RollupOptions[]} */
const bundleSnippets = [
  // `htm` has to come before `babel-plugin-htm`
  mk('htm',
    [ESM, UMD, IIFE],
    {
      input: `${src}/htm/src/index.js`,
      output: { name: 'htm' },
    }),
  mk('hydrate',
    [ESM, UMD, IIFE],
    {
      input: `${src}/hydrate/src/index.js`,
      external: ['sinuous', 'sinuous/htm'],
      output: { name: 'hydrate' },
    }),
  mk('observable',
    [ESM, UMD, IIFE],
    {
      input: `${src}/observable/src/observable.js`,
      output: { name: 'observable' },
    }),
  mk('h',
    [ESM, UMD, IIFE],
    {
      input: `${src}/h/src/index.js`,
      output: { name: 'h' },
    }),
  mk('template',
    [ESM, UMD, IIFE],
    {
      input: `${src}/template/src/template.js`,
      external: ['sinuous'],
      output: { name: 'template' },
    }),
  mk('data',
    [ESM, UMD, IIFE],
    {
      input: `${src}/data/src/data.js`,
      external: ['sinuous', 'sinuous/template'],
      output: { name: 'data' },
    }),
  mk('memo',
    [ESM, UMD, IIFE],
    {
      input: `${src}/memo/src/memo.js`,
      output: { name: 'memo' },
    }),
  mk('render',
    [ESM, UMD, IIFE],
    {
      input: `${src}/render/src/index.js`,
      external: ['sinuous', 'sinuous/template', 'sinuous/htm'],
      output: { name: 'render' },
    }),
  mk('map/mini',
    [ESM, UMD, IIFE],
    {
      input: `${src}/map/mini/src/mini.js`,
      external: ['sinuous'],
      output: { name: 'mini' },
    }),
  mk('map',
    [ESM, UMD, IIFE],
    {
      input: `${src}/map/src/index.js`,
      external: ['sinuous'],
      output: { name: 'map' },
    }),
  mk('sinuous',
    [ESM, UMD, IIFE],
    {
      input: `${src}/src/index.js`,
      external: ['sinuous/observable', 'sinuous/htm' ],
      output: { name: 'sinuous' },
    }),
  mk('sinuous-observable',
    [ESM],
    {
      input: `${src}/src/index.js`,
      external: ['sinuous/htm'],
      output: {
        sourcemap: false,
      },
    }),
  mk('jsx',
    [ESM, UMD, IIFE],
    {
      input: `${src}/jsx/index.js`,
      external: ['sinuous/observable'],
      output: { name: 'sinuous' },
    }),
  mk('babel-plugin-htm',
    [ESM, CJS],
    {
      input: `${src}/babel-plugin-htm/src/index.js`,
    }),
  mk('all',
    [ESM, UMD, IIFE],
    {
    // Multiple globals - @see https://github.com/rollup/rollup/issues/494
      input: `${src}/all/src/index.js`,
      output: { name: 'window', extend: true },
    }),
]
  .flat(); // Config snippets are split into their own full configs as an array

/**
 * Expand a multi-format snippet into an array of single-format configs
 * @typedef {InputOptions & { output?: OutputOptions }} ConfigSnippet
 * @type {(name: string, formats: ModuleFormat[], configSnippet: ConfigSnippet) => RollupOptions[]}
 */
function mk(name, formats, configSnippet) {
  /** @type {RollupOptions[]} */
  const perFormatConfigs = [];
  const { output, ...rest } = configSnippet;
  for (const format of formats) {
    // For CLI later
    bundleNames.push(name);
    perFormatConfigs.push({
      output: {
        file: dest(name, format),
        format,
        ...output,
      },
      ...rest,
    });
  }
  return perFormatConfigs;
}

/**
 * Generate a full self contained bundle config from a single-format config
 * @type {(rollupConfig: RollupOptions) => RollupOptions}
 */
const makeBundleConfigs = (rollupConfig) => {
  const { input, external = [], output, ...rest } = rollupConfig;
  const { format, plugins = [], ...restOutput } = output;
  return {
    input,
    external,
    plugins: [
      nodeResolve(),
      [UMD, IIFE].includes(format)
        && pluginBabel(),
    ]
      .filter(Boolean),
    output: {
      format,
      sourcemap: true,
      plugins: [
        bundleSize({
          // Unfortunately this package wasn't properly typed or documented, see
          // package `size-plugin-core` for all available options
          // @ts-ignore
          columnWidth: 25,
          decorateItem: (item) =>
            item.replace('.js', `.js ${format.toUpperCase().padEnd(4)}`),
        }),

        [ESM, UMD, IIFE].includes(format)
          && pluginTerser(),

        [ESM].includes(format)
          && pluginReplaceImportsESM(rollupConfig),

        // These must be seperate replace calls to be different magic-strings
        [ESM].includes(format)
          && replace(/const ([a-z])=/g, ([, x]) => `let ${x}=`),

        [ESM].includes(format)
          && replace(/let ([a-z]);let /g, ([, x]) => `let ${x},`),

        [UMD, IIFE].includes(format)
          && replace([
            { search: /for\(var [a-z]=arguments.length,([a-z])=new Array.+?arguments\[[a-z]\]/g,
              eachMatch: ([, x]) => `var ${x}=Array.from(arguments)`,
            },
            { search: /Object.defineProperty\(([a-z]),"([a-z]+)".+?return ([a-z.]+)}}\)/g,
              eachMatch: ([, on, key, value]) => `${on}.${key}=${value}`,
            },
          ]),

        // Simplify the apply() wrapper functions in files like sinuous/src
        [UMD, IIFE].includes(format)
          && replace(
            /var [a-z]=Array.from\(arguments\);return ([a-z.]+.apply\(.+?)[a-z]\)/g,
            ([, partialApplyCall]) => `return ${partialApplyCall}arguments)`
          ),

        ...plugins,
      ]
        .filter(Boolean),
      strict:   false, // Remove `use strict;`
      interop:  false, // Remove `r=r&&r.hasOwnProperty("default")?r.default:r;`
      freeze:   false, // Remove `Object.freeze()`
      esModule: false, // Remove `esModule` property
      ...restOutput,
    },
    watch: {
      clearScreen: false,
    },
    onwarn(warning) {
    // https://github.com/rollup/rollup/wiki/Troubleshooting#this-is-undefined
      const skip = [
        'THIS_IS_UNDEFINED',
        'UNKNOWN_OPTION',
        'MISSING_GLOBAL_NAME',
        'CIRCULAR_DEPENDENCY',
      ];
      if (skip.includes(warning.code)) return;
      console.error(warning.message);
    },
    ...rest,
  };
};

// Plugins
// -----------------------------------------------------------------------------

/** @type {() => Plugin} */
function pluginBabel() {
  return babel({
    babelHelpers: 'bundled',
  });
}

/** @type {() => Plugin} */
function pluginTerser() {
  return terser({
    sourcemap: true,
    ecma: 2017,
    warnings: true,
    compress: {
      passes: 2,
    },
    mangle: {
      properties: {
        regex: /^_/,
      },
    },
    nameCache: {
      props: {
        cname: 6,
        props: {
          $_tag: '__t',
          $_props: '__p',
          $_children: '__c',
          // Fixes a weird issue with mangling. `r.o.has` is not a function.
          $_observers: '__o',
        },
      },
    },
  });
}

/** @type {(bundleConfig: RollupOptions) => Plugin?} */
function pluginReplaceImportsESM(bundleConfig) {
  const { external } = bundleConfig;
  if (!external || !Array.isArray(external) || !external.length) {
    return null;
  }
  const { format, file } = bundleConfig.output;
  const replacements = [];
  for (const dep of external) {
    // @ts-ignore Externals can be regular expressions which break basename()
    const depPath = path.relative(file, dest(path.basename(dep), format))
      .replace('..', '.')
      .replace('./..', '..');
    replacements.push({
      // Note that this is replacin from inside a minified bundle (no spaces)
      search: new RegExp(`from"${dep}"`, 'g'),
      eachMatch: () => `from"${depPath}"`,
    });
  }
  return replace(replacements, {
    sourcemap: Boolean(bundleConfig.output.sourcemap),
  });
}

const bundles = bundleSnippets.map(makeBundleConfigs);

export { bundles, bundleNames };
