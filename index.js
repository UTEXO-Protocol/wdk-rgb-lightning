'use strict'

// Top-level entry — re-exports the Node binding by default. RN / bare
// worklet consumers hit `./bare.js` via the conditional export in
// package.json instead; see `exports`. Keeping a sensible default here
// means plain `import '@utexo/wdk-rgb-lightning'` from Node works
// without the consumer opting into a specific subpath.

export * from './index-node.js'
export { default } from './index-node.js'
