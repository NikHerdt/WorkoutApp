const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

/**
 * The Anthropic SDK dynamically imports Node built-ins for its credential-file
 * loader (reading OAuth profiles from disk). React Native has no equivalent,
 * and this app passes an explicit `apiKey`, so those branches never run — but
 * Metro still resolves the specifiers while bundling. Point them at a stub that
 * throws if anything ever actually touches them.
 *
 * Scoped to the specifiers that SDK path needs: anything else importing a Node
 * built-in still fails loudly at build time rather than being silently stubbed.
 */
const STUBBED_NODE_BUILTINS = new Set([
  'node:fs',
  'node:fs/promises',
  'node:path',
  'node:crypto',
  'node:os',
  'node:readline',
  'node:stream',
  'node:stream/promises',
  'node:util',
  'node:buffer',
  'node:child_process',
]);

const NODE_BUILTIN_STUB = path.resolve(__dirname, 'src/shims/nodeBuiltinStub.js');

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (STUBBED_NODE_BUILTINS.has(moduleName)) {
    return { type: 'sourceFile', filePath: NODE_BUILTIN_STUB };
  }
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
