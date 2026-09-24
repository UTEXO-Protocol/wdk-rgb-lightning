# Simulator / Emulator Qualification

Disposable regtest-only application. Never install this controller-enabled app
as a production wallet. No physical devices, real funds or production seeds.
Run one app at a time against `server.mjs`, bound to host loopback port 29888.
Start the [local stack](../regtest/README.md) first; run chain scenarios serially.

## Tested Profile

- Expo 56.0.21, React Native 0.85.3, React 19.2.3, Bare Kit 0.14.5.
- Embedded Bare 1.29.4, uv 1.52.1, V8 14.8.178.31, reported by the worklet.
- Bare pack 2.2.1, bare-link 3.3.0, bare-lief 0.2.5; Node 22 build/controller.
- iOS 26.5 arm64 simulator Release build: pass.
- Android API 36 arm64 4096-byte-page emulator Release build: pass.
- Android API 36 arm64 16384-byte-page emulator: native import SIGSEGV.
  `zipalign -P 16` passed, but post-link ELF RELRO alignment failed. Re-linking
  with bare-lief 0.2.8 still fails ELF validation. No 0.2.8 APK runtime pass claimed.

The host WDK CLI engine floor remains Bare 1.32.0. A bundled mobile profile is a
different dependency/runtime configuration, not evidence that the CLI floor may
be lowered. Transitive dependencies are not locked by this test source; retain
each generated fixture lockfile and build artifacts with that run's evidence.

## Build In An Isolated Directory

Use a fresh copy of this directory, outside any real application. Install the
candidate WDK and Bare tarballs from the corresponding draft branches, not older
registry packages. All commands below run from that isolated copy. Replace
absolute placeholder paths with actual built artifacts.

```sh
npm install --ignore-scripts --no-audit --no-fund /absolute/candidate-wdk.tgz /absolute/candidate-bare.tgz
RLN_BARE_ARTIFACTS_DIR=/absolute/verified-bare-repo node node_modules/@utexo/rgb-lightning-node-bare/scripts/install-native-artifacts.js --platform all
node node_modules/bare-pack/bin.js --imports node_modules/bare-node-runtime/imports.json --linked --host ios-arm64-simulator --host android-arm64 --out wallet.bundle.js wallet.mjs
npx --no-install expo prebuild --no-install --clean --template expo-template-bare-minimum@sdk-56
node node_modules/react-native-bare-kit/ios/link.mjs
node node_modules/react-native-bare-kit/android/link.mjs
```

The installer checks the native graph, wrapper identity, symbols and hashes.
Do not bypass it. Never copy another application's generated addon frameworks;
there must be only the candidate addon, not an old version alongside it.
Use Node 22, Xcode with the selected simulator runtime, CocoaPods and JDK 21.
Run `pod install` inside `ios`, then build the generated `WDKQualification`
workspace/scheme in Release for a dedicated simulator. Build Android with
`./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --max-workers=2`
inside `android`. The fixture sets minSdk 29, required by Bare Kit.

Before approving Android packaging, run the candidate Bare package's
`scripts/check-android-linked.js android-arm64 <linked-addon.so>`, setting
`LLVM_READOBJ` to the NDK's `llvm-readobj`. Also run Android build-tools
`zipalign -c -P 16 -v 4 <apk>`. Both checks are mandatory; ZIP alignment alone is
insufficient. **The tested linker fails the ELF check; do not release this APK.**
It was installed only on isolated emulators to diagnose the failure.

## Execute

Install/launch the Release app on the dedicated simulator/emulator. For Android,
the app uses the emulator-only `10.0.2.2` host alias. iOS uses loopback.
From the WDK repository, in separate terminals:

```sh
node tests/mobile/server.mjs
QUALIFICATION_DEVICE=<simulator-udid> node tests/mobile/qualify.mjs
ANDROID_HOME=/absolute/android-sdk QUALIFICATION_DEVICE=emulator-5582 node tests/mobile/qualify.mjs --android
```

Execute one qualifier at a time. It checks native release identity, strict unlock,
independently confirmed funding/send, positive/negative Bare HTTPS certificates,
background/foreground events, cold process restart and explicit worklet teardown.
Private temporary evidence paths are printed. Retain failed runs as well as
successful runs. Do not publish wallet state, seed files or signer databases.
Stop the controller and dedicated simulators when finished; do not delete wallet
state as a recovery technique.

## Scope Limits

Bare HTTPS checks do not exercise native Rust HTTPS or every TLS protocol.
A five-second background transition is not OS suspension/low-memory endurance.
Teardown returning to React Native is not same-process signer-lock release.
Arm64 emulator execution does not qualify Android x64/arm32, Intel iOS simulator,
physical devices, app-store signing, production endpoints or real networks.
See [qualification results](../regtest/QUALIFICATION.md) for the release gates.
