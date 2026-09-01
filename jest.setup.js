// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
'use strict'

// Several methods on the wallet account return fees/amounts as BigInt
// (e.g. `transfer` / `quoteTransfer`). Register a serializer so BigInt
// values render readably in assertion diffs and snapshots instead of
// throwing "Do not know how to serialize a BigInt".
expect.addSnapshotSerializer({
  test: (value) => typeof value === 'bigint',
  print: (value) => `${String(value)}n`
})
