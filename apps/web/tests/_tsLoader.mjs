import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { compileFunction } from "node:vm";
import ts from "typescript";

// Shared by every tests/*.test.mjs that needs to load real (untranspiled) TypeScript source —
// works on the supported Node 20 releases, which cannot import TypeScript directly (see
// tests/enquiry.test.mjs, the original example this pattern is copied from). Recursively
// resolves a loaded module's own relative imports and @learnthrive/* workspace-package imports,
// neither of which a plain require() anchored to the test file would ever find (relative paths
// resolve against the wrong directory; @learnthrive/* packages are raw TS source with no
// compiled JS, and Node's own native TS stripping can't handle everything this codebase uses,
// e.g. constructor parameter properties in packages/data's repositories).
const moduleCache = new Map();

function loadTsModule(fileUrl) {
  const cacheKey = fileUrl.href;
  if (moduleCache.has(cacheKey)) return moduleCache.get(cacheKey);

  const source = readFileSync(fileUrl, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  const nodeRequire = createRequire(fileUrl);
  const scopedRequire = (specifier) => {
    if (specifier.startsWith(".")) return loadTsModule(new URL(`${specifier}.ts`, fileUrl));
    // Anchored to this loader file's own location (tests/), not the importing file's — the
    // workspace layout (tests/ and packages/data/src/ are both fixed, known paths relative to
    // the repo root) doesn't change per caller, so there's nothing to re-derive.
    if (specifier.startsWith("@learnthrive/data/")) {
      const subpath = specifier.slice("@learnthrive/data/".length);
      return loadTsModule(new URL(`../../../packages/data/src/${subpath}.ts`, import.meta.url));
    }
    return nodeRequire(specifier); // bare specifier (node:*, an npm package) — real Node resolution
  };

  const fakeModule = { exports: {} };
  moduleCache.set(cacheKey, fakeModule.exports); // set before executing, in case of circular imports
  compileFunction(compiled, ["require", "module", "exports"])(scopedRequire, fakeModule, fakeModule.exports);
  moduleCache.set(cacheKey, fakeModule.exports);
  return fakeModule.exports;
}

/** `fromUrl` must be the caller's own `import.meta.url`, so `relativePath` resolves against the
 * calling test file's own directory. */
export function loadTsFrom(fromUrl, relativePath) {
  return loadTsModule(new URL(relativePath, fromUrl));
}
