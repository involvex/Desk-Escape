// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// `@opencode/client` ships several entry points. Only the promise root
// (`dist/promise/index.js`, exposed as `@opencode/client` and
// `@opencode/client/promise`) is browser-safe.
//
// Verified by static import-graph analysis of `dist/promise/index.js`:
// it reaches only 7 files under `dist/chunks/` and imports **no** node
// builtins -- it relies solely on `fetch` / `Headers` / `URL` /
// `WebSocket` / `TextDecoder` / `ReadableStream`, all of which React
// Native provides.
//
// The other subpaths must never enter a bundle:
//   dist/promise/service.js -> node:fs, node:os, node:path, node:child_process, Buffer
//   dist/solid/             -> solid-js + solid-js/store
//   dist/effect/            -> effect
//
// We block those entry points only. The shared `dist/chunks/` directory is
// deliberately NOT blocked: the node-importing chunks live there too and are
// reachable solely from the blocked service entry, so blocking them by path
// would be both unnecessary and fragile as the package re-hashes its chunks.
//
// See docs/ARCHITECTURE.md ("OpenCode V2 client") for details.
const blockOpenCodeV2EntryPoints = [
  /node_modules[\\/]@opencode[\\/]client[\\/]dist[\\/]service\.js$/,
  /node_modules[\\/]@opencode[\\/]client[\\/]dist[\\/]promise[\\/]service\.js$/,
  /node_modules[\\/]@opencode[\\/]client[\\/]dist[\\/]solid[\\/]/,
  /node_modules[\\/]@opencode[\\/]client[\\/]dist[\\/]effect[\\/]/,
];

config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : []),
  ...blockOpenCodeV2EntryPoints,
];

module.exports = config;
