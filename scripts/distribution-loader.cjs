/** Local TypeScript loader for isolated verification and read-only operational scripts. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

module.exports = function distributionLoader(overrides = {}, env = process.env) {
  const cache = new Map();
  function load(relative) {
    let file = path.resolve(root, relative);
    if (!path.extname(file)) file += '.ts';
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const localRequire = createRequire(file);
    function requireSource(name) {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      // The marker is enforced by Next's production build; this is a server-side script.
      if (name === 'server-only') return {};
      if (name.startsWith('@/')) return load(`src/${name.slice(2)}`);
      if (name.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(file), name)));
      return localRequire(name);
    }
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
      fileName: file,
    }).outputText;
    const context = vm.createContext({ module, exports: module.exports, require: requireSource,
      process: { env }, Buffer, URL, Date, Intl, console, AbortSignal, fetch, Headers, Request, Response, setTimeout, clearTimeout });
    new vm.Script(source, { filename: file }).runInContext(context);
    return module.exports;
  }
  return load;
};
