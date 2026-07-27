/**
 * Stub for Node built-in modules (`node:fs`, `node:path`, …).
 *
 * The Anthropic SDK dynamically imports these inside its credential-*file*
 * loader — the path that reads OAuth profiles from disk. This app authenticates
 * with an explicit `apiKey`, so that code never executes; Metro just has to
 * resolve the specifier at bundle time.
 *
 * Any real access throws a descriptive error rather than failing silently.
 */
const PASSTHROUGH = new Set(['__esModule', 'default', 'then']);

module.exports = new Proxy(
  {},
  {
    get(_target, prop) {
      // Let module-interop and promise-unwrapping probes resolve to undefined.
      if (typeof prop === 'symbol' || PASSTHROUGH.has(prop)) return undefined;
      throw new Error(
        `Node built-in modules are not available in React Native (accessed "${String(prop)}"). ` +
          'The Anthropic SDK must be constructed with an explicit apiKey.'
      );
    },
  }
);
