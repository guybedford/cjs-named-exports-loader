import fs from 'fs';
import module from 'module';
import path from 'path';
import lexer from 'cjs-module-lexer';
import url from 'url';

const { fileURLToPath } = url;
const { parse, init } = lexer;
const { Module } = module;

function isCJS (filepath) {
  return filepath.endsWith('.cjs') || filepath.endsWith('.js') && getPackageBoundary(filepath).type !== 'module';
}

function getPackageBoundary (checkPath) {
  const rootSeparatorIndex = checkPath.indexOf(path.sep);
  let separatorIndex;
  while (
    (separatorIndex = checkPath.lastIndexOf(path.sep)) > rootSeparatorIndex
  ) {
    checkPath = checkPath.slice(0, separatorIndex);
    if (checkPath.endsWith(path.sep + 'node_modules'))
      return false;
    try {
      return JSON.parse(fs.readFileSync(checkPath + path.sep + 'package.json')); 
    }
    catch (e) {
      if (e.code === 'ENOENT')
        continue;
      if (e instanceof SyntaxError)
        continue;
      throw e;
    }
  }
  return {};
}

export async function resolve (specifier, context, defaultResolve) {
  if (specifier.endsWith('?cjsoriginal')) {
    return { url: specifier.slice(0, -12) };
  }
  const { url } = await defaultResolve(specifier, context);
  if (url.startsWith('file:') && isCJS(fileURLToPath(url)))
    return { url: url + '?cjsexportproxy' };
  return { url };
}

export async function getFormat (url, context, defaultGetFormat) {
  const exportProxy = url.endsWith('?cjsexportproxy');
  if (exportProxy)
    return { format: 'module' };
  return defaultGetFormat(url, context);
}

export async function getSource (url, context, defaultGetSource) {
  const exportProxy = url.endsWith('?cjsexportproxy');
  if (!exportProxy)
    return defaultGetSource(url, context, defaultGetSource);
  url = url.slice(0, -15);
  const filename = fileURLToPath(url);
  await init();
  const exports = parseModuleExports(filename);
  let source = `import exports from '${url}?cjsoriginal';\n`;
  if (exports.size)
    source += `export const `;
  source += [...exports].map(expt => `${expt} = exports.${expt}`).join(', ') + ';\n';
  source += `export default exports;\n`;
  return { source };
}

const cjsParseCache = new Map();
function parseModuleExports (filename) {
  const cached = cjsParseCache.get(filename);
  if (cached)
    return cached.exportNames;

  let source;
  var exports, reexports;
  try {
    source = fs.readFileSync(filename, 'utf8');
    ({ exports, reexports } = parse(source));
  } catch (e) {
    exports = [], reexports = [];
  }
  const exportNames = new Set(exports);

  // Set first for cycles.
  cjsParseCache.set(filename, { source, exportNames });

  for (const reexport of reexports) {
    const m = new Module(filename);
    m.filename = filename;
    m.paths = Module._nodeModulePaths(m.path);
    let resolved;
    try {
      resolved = Module._resolveFilename(reexport, m);
    } catch {
      continue;
    }
    const ext = path.extname(resolved);
    if (ext === '.js' || !Module._extensions[ext]) {
      const reexportNames = parseModuleExports(resolved);
      for (const name of reexportNames)
        exportNames.add(name);
    }
  }

  return exportNames;
};
