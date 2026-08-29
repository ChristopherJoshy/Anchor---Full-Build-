# AGENTS.md

Anchor — on-device GPS integrity monitor (RAIM/FDE on phone sensors). npm workspaces monorepo, Expo SDK 57, Android-only.

## Stack & env
- Node v24 + npm only (no yarn/pnpm). `npm install` at root links workspaces.
- arm64 proot, **no local Android SDK/NDK/Gradle**. Native builds via EAS cloud only.
- Raw GNSS (`AnchorGnssModule.kt:72`) requires physical Android API 24+ — emulators have no radio.
- Metro watches `packages/anchor-sdk/src` directly (no-build package `main: src/index.ts`): never add a build step.
- If Metro stalls: `CHOKIDAR_USEPOLLING=1`.

## Repo map
- `packages/anchor-sdk` — Expo native module (Android): Kotlin `AnchorGnss` (C/N0, `expo-module.config.json:2` `platforms: ["android"]`), six pure checks `src/physics/*`, `src/evaluateIntegrity.ts:119` `stepIntegrity`/`evaluateIntegrity`, `src/sensors/*` hooks, `src/ai/*` ExecuTorch wrappers, `src/types.ts:8` contract.
- `apps/anchor-demo` — demo app (expo-router, `app.json:2` slug `anchor`, `package: com.christopherjoshy.anchor`). Routes `src/app/_layout.tsx` (font gate + `RootErrorBoundary` + `AnchorProvider`) → `src/app/index.tsx` (primer) → `src/app/dashboard.tsx`. UI `src/components/*`, hooks `src/hooks/*`, `src/theme.ts` tokens.
- Root `package.json:4` workspaces `packages/*, apps/*`; `npm test` is `npm test --workspaces --if-present`.

## Commands (exact)
```bash
npm install                                          # root, always first
npx tsc --noEmit                                     # in packages/anchor-sdk OR apps/anchor-demo
npx jest                                             # SDK: ts-jest/node; Demo: jest-expo/jsdom
npx jest src/__tests__/physicsChecks.test.ts         # single suite (SDK) — same pattern in demo
npx expo export --platform android                   # verify bundle contains [anchor:startup] + hermesc; on arm64 hermesc is shimmed via qemu-x86_64
npx expo start --dev-client                          # against EAS dev-client APK
npx eas build --profile development --platform android  # dev client (internal)
npx eas build --profile production --platform android   # standalone APK (`eas.json:12` `buildType: apk`)
npx expo-doctor                                      # must be 21/21 before ship
adb logcat | grep "anchor:startup"                   # startup milestone chain
```

## Architecture gotchas
- **State machine ownership:** `src/ai/createAnchorSDK.ts:19` `createAnchorSDK()` owns one `IntegrityMachine` (`RECOVERY_DEBOUNCE=5` at `src/evaluateIntegrity.ts:34`). Call `sdk.evaluate(window)` repeatedly — debounce counting lives inside. `prevState` arg only seeds first call; after that internal machine is authoritative. Pure tests use `stepIntegrity(window, machine)` directly; `evaluateIntegrity(window, prevState)` is stateless view.
- **AI never touches state:** `explain/transcribe/embed` are lazy dynamic `import('react-native-executorch')` on first call, XNNPACK CPU prebuilt AAR, no NDK. Types `AnchorSDK:82` enforce `explain(verdict): Promise<string>` cannot mutate state. Models: `qwen3_1_7b` (8da4w quantized, strip `<think>` blocks), `whisper-base.en` (16kHz mono `Float32Array`), `all-mpnet-base-v2` (768-d).
- **Sensor teardown:** `useImuStream`/`useBarometerStream` remove per-subscription handle, never `removeAllListeners` — latter kills other consumers.
- **Constellation codes:** `AnchorGnssModule.kt:32` local literals (`GPS=1` etc.), not `GnssMeasurement.CONSTELLATION_*` — compileSdk 36 jar lacks symbols.
- **Font gate / blank-screen hardening:** `src/app/_layout.tsx:44` resilient gate — 10s timeout or load error → system fonts, never returns `null`. `src/components/RootErrorBoundary.tsx:22` renders `INTEGRITY FAULT` instead of blank. `experiments.reactCompiler` disabled (`app.json`); `babel-preset-expo` auto-adds `react-native-worklets` plugin — don't add manually.
- **Permissions primer:** `src/hooks/usePermissions.ts` explains before native dialogs, requests location then mic in sequence, persists to AsyncStorage. Location denied → `dashboard.tsx:31` `NO POSITION SOURCE` + `Linking.openSettings()`; mic denied → only mic button disabled.
- **Demo harness:** `src/hooks/useAnchorPipeline.ts:50` `SIMULATE SPOOF` injects 5 teleported fixes + lockstep C/N0 through normal `sdk.evaluate`; `RESET` swaps fresh `createAnchorSDK()` to clear debounce.

## Design tokens (`apps/anchor-demo/src/theme.ts`)
`panel-bg #0C1116`, `panel-surface #151B21`, `chrome #3A434D`, `trusted #00D9A3`, `caution #FFB300`, `denied #FF3B30`. IBM Plex Mono numerals (tabular-nums), Inter labels. Hard edges, hairline dividers, no rounded cards.

## Tests & verification (order: `tsc --noEmit` → `jest` → `expo-doctor`)
- SDK: `packages/anchor-sdk` jest preset `ts-jest`, `testMatch **/__tests__/**/*.test.ts`, fixtures `src/__tests__/fixtures/*.json` (clean-drive, spoofed-jump + 5 per-check). 73 tests.
- Demo: `apps/anchor-demo/jest.config.js:3` `jest-expo` + `jsdom`, `transformIgnorePatterns` must include `anchor-sdk|expo|reanimated|worklets`. `jest.setup.ts:1` → `src/__tests__/__mocks__/nativeModules.ts:60` stubs **only** native boundary (`expo-location`, `expo-audio`, `AnchorGnssModule`, `AsyncStorage`, `reanimated/worklets` passthrough). Physics/checks/state machine stay real; dashboard test feeds real `clean-drive.json`/`spoofed-jump.json` through `createAnchorSDK()`.
- Blank-screen regression class covered locally: font failure + 10s hang → still renders; primer row order + `Continue` request order; `RootErrorBoundary` fault panel; dashboard TRUSTED/DENIED via real SDK.
- `npx tsc --noEmit` must pass in both packages (demo `tsconfig.json:5` `paths: @/*`).

## Release & ops
- `eas.json:6` `development` (`developmentClient:true`) vs `production` (`distribution:internal, android.buildType:apk`). `appVersionSource: remote`, `cli >=16.0.1`, project `98219ae4-65d4-41dc-a22d-03bee5050a3f` (`app.json:57`).
- **Production APK only** — standalone with embedded `assets/index.android.bundle`, zero `expo-dev-client` entries. Rolling tag `latest` — delete release+tag then recreate per build (one release ever). `apps/anchor-demo/releases/anchor.apk` is LFS rolling artifact (replaced each build). Release body: EAS URL + build id + date + API 24+ note.
- Long `gh` upload: strip PATH `PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"` — Termux adb daemon injects `- waiting for device -` otherwise.

## Workflow
- Conventional commits, small & frequent. Every non-trivial change appends a dated heading to `changes.md`.
- `git pull --rebase origin main` before push (concurrent workers).
- Never stub with TODO/mocks/placeholders. Workstream lanes (if concurrent): `sdk → packages/anchor-sdk/**`, `demo → apps/anchor-demo/**`, `docs → README/agents`.
- Root `.gitignore:7` ignores lowercase `agents.md` (local-only). Canonical tracked file is uppercase `AGENTS.md` — maintain both in sync.
