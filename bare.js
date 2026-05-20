'use strict'

// Bare-runtime entry. `bare-node-runtime/global` installs Node-style
// globals (Buffer, process, setImmediate) into the bare runtime; the
// `with { imports: ... }` clause remaps Node module identifiers
// (`fs`, `path`, …) to their bare-* equivalents at module-resolution
// time. We re-export `./index-bare.js` (rather than `./index.js`)
// because the bare path uses `@utexo/rgb-lightning-node-bare` while the
// Node path uses the napi addon — picking the wrong one in a bare
// worklet would fail to load.

import 'bare-node-runtime/global'

export * from './index-bare.js' with { imports: 'bare-node-runtime/imports' }

export { default } from './index-bare.js' with { imports: 'bare-node-runtime/imports' }
