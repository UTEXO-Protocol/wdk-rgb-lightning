# BFA Qualification

Use the Bitcoin, Electrs, Esplora and proxy services from [README.md](./README.md).
Keep scenarios serial. No real-network funds are used. The issuer below is a
test-only rgb-lib process, not a WDK issuance API.

Build and install the exact Node/Bare `0.2.0-beta.3` peers first. Runtime checks
require RLN commit `a17b685615750536f0320db1cd3f3ba68a8f1c57` and reject the older
`v0.15.0-beta.3` release binary. Bare requires a `BARE_BIN` executable >=1.33.0.

## External Unlock

```sh
node tests/regtest/external-unlock.mjs
BARE_BIN=/absolute/path/to/bare node tests/regtest/external-unlock.mjs --bare
```

Each runtime exercises native and attached signers with omitted/null RPC,
successful RPC, malformed URLs, RPC rejection followed by retry, and signer
mismatch. The loopback HTTP fixture only answers `web3_clientVersion`. These
12 cases per runtime do not prove BFA consignment validation.

## Funded Fixture

The helper's Cargo lock preserves the native release's BFA source revisions.
Source access to the private RGB repositories is required. It generates an
ephemeral regtest issuer key in memory and never prints or persists its mnemonic.
Its directory is disposable test evidence, not a recoverable production wallet.

```sh
CARGO_TARGET_DIR=/tmp/wdk-bfa-fixture-target cargo +1.94.0 build \
  --locked --release --manifest-path tests/regtest/bfa-fixture/Cargo.toml
export BFA_FIXTURE_BIN=/tmp/wdk-bfa-fixture-target/release/wdk-bfa-fixture
```

Use contracts from rgb-lib tag `v0.3.0-beta.42-bfa`, exact commit
`aaf5b52f63ff2ee966707f099aacadd5f2e6037f`. Set `RGB_LIB_SOURCE` to that checkout.
The commands below use Anvil's public test account, not a private wallet key.
Use a new container name if the default name already exists; do not delete an
existing container or volume to make the test pass.

```sh
export BFA_ANVIL_CONTAINER=wdk-bfa-anvil-20261007
export ANVIL_TEST_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
docker run -d --name "$BFA_ANVIL_CONTAINER" \
  -p 127.0.0.1:29545:8545 -v "$RGB_LIB_SOURCE/tests/contracts:/contracts:ro" \
  --entrypoint anvil \
  ghcr.io/foundry-rs/foundry@sha256:0c00cb0bda1ab1b91c9a6bf60f4c76c09c1a8870824b6d4718afbabacf6f9a17 \
  --host 0.0.0.0 --port 8545 --chain-id 31337 --block-time 2
docker exec "$BFA_ANVIL_CONTAINER" forge install \
  OpenZeppelin/openzeppelin-contracts@v5.0.2 --root /tmp --no-git

TOKEN=$(docker exec "$BFA_ANVIL_CONTAINER" forge create \
  /contracts/TestERC20.sol:TestERC20 --rpc-url http://127.0.0.1:8545 \
  --private-key "$ANVIL_TEST_KEY" --cache-path /tmp/forge-cache \
  --out /tmp/forge-out --root /tmp --contracts /contracts \
  --remappings @openzeppelin/=/tmp/lib/openzeppelin-contracts/ --broadcast --json \
  --constructor-args 'Bridged Token' BRG 6 1000000000 \
  | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>console.log(JSON.parse(s).deployedTo))')
export BFA_BRIDGE_ADDRESS=$(docker exec "$BFA_ANVIL_CONTAINER" forge create \
  /contracts/BaseBridge.sol:BaseBridge --rpc-url http://127.0.0.1:8545 \
  --private-key "$ANVIL_TEST_KEY" --cache-path /tmp/forge-cache \
  --out /tmp/forge-out --root /tmp --contracts /contracts \
  --remappings @openzeppelin/=/tmp/lib/openzeppelin-contracts/ --broadcast --json \
  --constructor-args "$TOKEN" \
  | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>console.log(JSON.parse(s).deployedTo))')
docker exec "$BFA_ANVIL_CONTAINER" cast send "$TOKEN" \
  'approve(address,uint256)' "$BFA_BRIDGE_ADDRESS" 1000000000 \
  --rpc-url http://127.0.0.1:8545 --private-key "$ANVIL_TEST_KEY" --json

node tests/regtest/bfa.mjs
BARE_BIN=/absolute/path/to/bare node tests/regtest/bfa.mjs --bare
```

The suite checks a real ERC-20 lock and BFA bridge transition, blind receipt,
witness send, both settled balances, BFA listing/metadata, WebRGB read mappings,
transfer history, exact consignment bytes and cold process restart. Mints with
no matching lock or only wrong-amount locks must fail without crediting funds.
The fixed RPC endpoints must be local; the test checks both chain identities.

## Event-Selection Acceptance Test

```sh
node tests/regtest/bfa.mjs --probe-event-selection
```

This also creates two locks for the same mint OpId: amount 1 first, then the
correct amount 1000. The receive must settle. The pinned upstream validator
currently fails this assertion. This is an intentionally failing acceptance
test, not a skipped or expected-failure pass. The proposed correction is
[rgb-lib #103](https://github.com/UTEXO-Protocol/rgb-lib/pull/103); it is not
included in the production candidate.

Every run prints its evidence directory and retains results and native state.
Do not commit wallet directories. To stop the separate fixture without deleting
evidence, use `docker stop "$BFA_ANVIL_CONTAINER"`.
