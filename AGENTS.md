# AGENTS.md

Anchor — on-device GPS integrity monitor (RAIM/FDE on phone sensors). npm workspaces monorepo, Expo SDK 57, Android-only.

## Stack & env
- Node v24+ + npm only (no yarn/pnpm). `npm install` at root links workspaces.
- **Local Android build works** (x86_64 Linux host): full SDK at `~/Android/Sdk`, `/opt/android-studio/jbr` (JDK 25), `apps/anchor-demo/android/` prebuilt CNG (gitignored, `local.properties` set). Build: `cd apps/anchor-demo/android && ./gradlew assembleRelease` → `app/build/outputs/apk/release/app-release.apk` (~2 min warm, JS re-bundles each run). EAS cloud remains the production-release path.
- Emulator: `~/Android/Sdk/emulator/emulator -avd Pixel_API_36` (KVM available, x86_64 google_apis images; `adb root` works). API 33+ ranchu GNSS HAL **does deliver GnssMeasurements**; fake values via `adb emu geo fix` / `geo nmea` / `sensor set` — NEVER via in-app fakes.
- Metro watches `packages/anchor-sdk/src` directly (no-build package `main: src/index.ts`): never add a build step.
- If Metro stalls: `CHOKIDAR_USEPOLLING=1`.

## Hard rules
- **Mocks are strictly banned.** No stubbed/synthesized/faked sensor values, no placeholder data paths, no silent defaults that look real. The ONLY synthetic input allowed is the explicitly armed DEMO CONTROLS harness (attack-scenario frames for attacks that need hardware to stage live) — it must stay double-gated (`demoArmed`), purge its queue on disarm, and never touch display state while disarmed. Where a "mock" would have been the easy answer, fully implement the real thing instead (e.g. real VPN detection via AnchorNet, real download progress from the ExecuTorch fetcher).
- **Keep git current:** commit and push completed work promptly — never leave finished changes only local. `git pull --rebase origin main` before push.

## Repo map
- `packages/anchor-sdk` — Expo native module (Android): Kotlin `AnchorGnss` (C/N0, `expo-module.config.json:2` `platforms: ["android"]`), Kotlin `AnchorNet` (real VPN probe: `^tun[0-9]+$`/`^tap[0-9]+$` interfaces ∨ TRANSPORT_VPN over **all** networks — `tunl0` must NOT match), seven pure checks `src/physics/*` (6 physics + `networkCheck`), `src/evaluateIntegrity.ts` `stepIntegrity`/`evaluateIntegrity`, `src/sensors/*` hooks, `src/ai/*` ExecuTorch wrappers, `src/types.ts` contract (`SensorWindow.network?` carries the OS VPN signal).
- `apps/anchor-demo` — demo app (expo-router, `app.json:2` slug `anchor`, `package: com.christopherjoshy.anchor`). Routes `src/app/_layout.tsx` (font gate + `RootErrorBoundary` + `AnchorProvider`) → `src/app/index.tsx` (primer) → `src/app/dashboard.tsx` (scrollable sections: TELEMETRY / CHECKS / NETWORK / INTEGRITY / FLIGHT LOG / DEMO CONTROLS; `ModelStatus` shows real download progress; the fake Dynamic-Island pill was removed on request). UI `src/components/*`, hooks `src/hooks/*`, `src/theme.ts` tokens.
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
- **State machine ownership:** `src/ai/createAnchorSDK.ts` `createAnchorSDK()` owns one `IntegrityMachine` (`RECOVERY_DEBOUNCE=5` at `src/evaluateIntegrity.ts`). Call `sdk.evaluate(window)` repeatedly — debounce counting lives inside. `prevState` arg only seeds first call; after that internal machine is authoritative. Pure tests use `stepIntegrity(window, machine)` directly; `evaluateIntegrity(window, prevState)` is stateless view.
- **Recovery semantics (v2):** NO state returns to TRUSTED directly. DEGRADED and DENIED both count the same 5-clean-evaluation debounce → RECOVERING → next clean → TRUSTED. A lone failing check (e.g. VPN up) = DEGRADED; 2+ failures or a critical pair (kinematic+cn0, kinematic+heading) = DENIED.
- **VPN = inconsistency:** `window.network = { vpnActive }` (real AnchorNet, polled 2s in `useAnchorPipeline`) feeds `networkCheck` — tunnel up FAILS the check, so the instrument never holds TRUSTED while a VPN is up, and must ride out the full debounce after it clears.
- **AI never touches state:** `explain/transcribe/embed` are lazy dynamic `import('react-native-executorch')` on first call (JSI installs at import time — keep dynamic), XNNPACK CPU prebuilt AAR (x86_64+arm64-v8a), no NDK. Types `AnchorSDK` enforce `explain(verdict): Promise<string>` cannot mutate state. Models: `qwen3_0_6b` quantized 8da4w (advisory — same Qwen3 template, ~3x faster than 1.7B; `/no_think` appended to the prompt + defensive `stripThinking`), `whisper-base.en` (16kHz mono `Float32Array`), `all-mpnet-base-v2` (768-d).
- **Advisory latency ≤280ms:** `ADVISORY_LATENCY_BUDGET_MS` watchdog in `explainVerdict` calls `llm.interrupt()` — the only latency cap (lib has no JS maxNewTokens, no KV reuse between calls). `generate()` resolves with partial real output.
- **Download progress:** `executorchRuntime` wraps every `fromModelName(..., onDownloadProgress)` and exposes `subscribeModelDownloads`/`getModelDownloadStates`; the demo `ModelStatus` component renders the real fetcher fractions.
- **Sensor teardown:** `useImuStream`/`useBarometerStream` remove per-subscription handle, never `removeAllListeners` — latter kills other consumers.
- **fixMapping nullability:** null altitude → NaN (altitudeCheck skips fixes without usable GPS altitude and time-aligns the baro span; environmentalCheck skips only the altitude bound). null accuracy → +Infinity (fails closed).
## Design tokens (`apps/anchor-demo/src/theme.ts`)
`panel-bg #0C1116`, `panel-surface #151B21`, `chrome #3A434D`, `trusted #00D9A3`, `caution #FFB300`, `denied #FF3B30`. IBM Plex Mono numerals (tabular-nums), Inter labels. Hard edges, hairline dividers, no rounded cards.

## Tests & verification (order: `tsc --noEmit` → `jest` → `expo-doctor`)
- SDK: `packages/anchor-sdk` jest preset `ts-jest`, `testMatch **/__tests__/**/*.test.ts`, fixtures `src/__tests__/fixtures/*.json` (clean-drive, spoofed-jump + 5 per-check). 76 tests. NOTE: the spoofed-jump teleport lands at frame ~105 — a windowed feed must cover the whole fixture to reach DENIED.
- Demo: `apps/anchor-demo/jest.config.js` `jest-expo` + `jsdom`, `transformIgnorePatterns` must include `anchor-sdk|expo|reanimated|worklets|standard-navigation`. `jest.setup.ts` polyfills TextEncoder/TextDecoder (expo winter needs them in jsdom) → `src/__tests__/__testboundaries__/nativeBoundaries.ts` stubs **only** the native boundary (`expo-location`, `expo-audio`, `AnchorGnssModule`, `AnchorNetModule`, `AsyncStorage`, `reanimated/worklets` passthrough). Physics/checks/state machine stay real; dashboard test feeds full real fixtures through `createAnchorSDK()`.

## Release & ops
- `eas.json:6` `development` (`developmentClient:true`) vs `production` (`distribution:internal, android.buildType:apk`). `appVersionSource: remote`, `cli >=16.0.1`, project `98219ae4-65d4-41dc-a22d-03bee5050a3f` (`app.json:57`).
- **Production APK only** — standalone with embedded `assets/index.android.bundle`, zero `expo-dev-client` entries. Rolling tag `latest` — delete release+tag then recreate per build (one release ever). `apps/anchor-demo/releases/anchor.apk` is LFS rolling artifact (replaced each build). Release body: EAS URL + build id + date + API 24+ note.
- Long `gh` upload: strip PATH `PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"` — Termux adb daemon injects `- waiting for device -` otherwise.

## Workflow
- Conventional commits, small & frequent. Every non-trivial change appends a dated heading to `changes.md`.
- `git pull --rebase origin main` before push (concurrent workers). **Push promptly after completing work — do not batch finished work locally.**
- Mocks are banned (see Hard rules) — implement the real thing instead. Workstream lanes (if concurrent): `sdk → packages/anchor-sdk/**`, `demo → apps/anchor-demo/**`, `docs → README/agents`.
- Root `.gitignore:7` ignores lowercase `agents.md` (local-only). Canonical tracked file is uppercase `AGENTS.md` — maintain both in sync.
