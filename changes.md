# Changelog

## 2026-08-29 — scaffold: monorepo workspaces, git remote, README

## 2026-08-29 — feat: scaffold packages/anchor-sdk (expo module, android)
- create-expo-module scaffold (AsyncFunction+Event), stripped template cruft (package/, example/, internal/), no-build TS layout: main/types -> src/index.ts
- deps: expo-location, expo-sensors; devDeps: jest + ts-jest + @types/jest + typescript; `npx jest` + `tsc --noEmit` wired

## 2026-08-29 — docs: comprehensive root readme
- full rewrite: pitch, TOC, background (RAIM/FDE heritage, on-device AI rationale), 7-stage ASCII pipeline, features (six checks w/ spoofer rationale, solar compass, state machine table, AI stack, voice, semantic search, demo UI, permissions), design tokens, getting started, project tree, AnchorSDK reference, roadmap, license

## 2026-08-29 — feat: sensor hooks + shared contract types
- src/types.ts: exact AnchorSDK contract types (IntegrityState, CheckId, CheckResult, Fix, ImuSample, BaroSample, SatelliteMeasurement, GnssMeasurementSample, SensorWindow, Verdict)
- useLocationStream (1 Hz Balanced, no auto permission request), useImuStream (mag+gyro ~10 Hz, atan2 portrait heading + complementary filter), useBarometerStream (~10 Hz), useGnssMeasurements (AnchorGnss native stream, ring-buffered history)
- src/utils/ringBuffer.ts shared FIFO util

## 2026-08-29 — feat: anchor-demo scaffold + app config + design system + permissions primer (apps/)
- create-expo-app default template (SDK 57, expo-router TS); installed expo-dev-client/location/sensors/audio/haptics/font/image, reanimated, async-storage, Google Fonts Inter + IBM Plex Mono; anchor-sdk workspace link (npm hoists to root node_modules)
- app.json: name Anchor, slug anchor, scheme anchor, dark UI, #0C1116, edge-to-edge, android package com.christopherjoshy.anchor, location+mic permissions, expo-audio mic plugin copy, expo-font plugin
- eas.json: cli.version >= 16.0.1, cli.appVersionSource remote (eas-cli 23 moved the key), development (dev-client, internal, autoIncrement) + production profiles; eas init @iamchris2005/anchor (98219ae4-65d4-41dc-a22d-03bee5050a3f); early EAS android development build queued: ffd2cd1e-c829-49d1-ba9a-aca0e681129b
  - note: first build attempt failed generating cloud keystore (truncated request error); immediate retry succeeded — transient
- scripts/generate-assets.mjs (sharp): 1024px avionics anchor-in-crosshair glyph (#00D9A3 on #0C1116, hairline #3A434D grid) -> icon, splash, adaptive foreground/background/monochrome, favicon; default Expo template assets deleted
- src/theme.ts: avionics tokens (panel #0C1116, surface #151B21, chrome #3A434D, trusted #00D9A3, caution #FFB300, denied #FF3B30; semantic colorForIntegrityState; IBM Plex Mono numerals w/ tabular-nums, Inter labels)
- src/app/_layout.tsx: loads both font families, wraps Stack in SDK AnchorProvider (pending export in anchor-sdk — tracked), dark content style
- permissions primer (src/app/index.tsx + usePermissions.ts): GPS/MIC plain-language rows, single Continue -> native dialogs in sequence, decisions persisted in async-storage, never re-prompts; template example screens/components removed

## 2026-08-29 — feat: six physics consistency checks, NOAA solar compass, fixtures
- src/physics/: kinematicCheck (accuracy envelope + 200 m/s teleport), headingCheck (track/magnetic/solar, 60° limit), temporalCheck (monotonicity, gaps > 300 s, quantized replay), altitudeCheck (GPS vs barometric delta, 50 m limit), environmentalCheck (alt [-450,9000] m, speed [0,320] m/s, 100 m accuracy gate, null-island), cn0Check (residual-variance ratio + pairwise correlation lockstep detection, run splitting on gaps/replays)
- solarCompass.ts: NOAA solar position (azimuth/elevation), tested vs solstice/equinox geometry
- fixtures: clean-drive.json + spoofed-jump.json (seeded generator in scripts/) + 5 per-check fixtures; 48 jest tests green

## 2026-08-29 — feat: deterministic integrity state machine (evaluateIntegrity)
- stepIntegrity(window, machine): pure RAIM/FDE transition; RECOVERY_DEBOUNCE=5 clean evals DENIED->RECOVERING->TRUSTED; glitch during recovery -> DENIED with debounce reset; critical pairs kinematic+cn0 / kinematic+heading -> DENIED
- evaluateIntegrity(window, prevState): stateless contract view; confidence = weighted check scores (kinematic/cn0 0.25, heading/env 0.15, temporal/altitude 0.1)
- 67 jest tests green; EAS Kotlin fix: constellation codes as documented literals (compileSdk 36 jar lacks GnssMeasurement.CONSTELLATION_* symbols)

## 2026-08-29 — feat: ExecuTorch AI wrappers (explain/transcribe/embed), AnchorProvider, createAnchorSDK
- react-native-executorch 0.9.3 functional API (LLMModule/SpeechToTextModule/TextEmbeddingsModule fromModelName), lazy module-level promise caches, dynamic import to keep non-device environments clean
- models: llama3_2_1b (quantized), whisper_base_en, all_mpnet_base_v2 (multi-qa-mpnet-base-v2 not shipped; documented deviation)
- explainVerdict: strict (Verdict) -> Promise<string], deterministic prompt template, stateless generate(); transcribeCommand: 16kHz mono Float32Array -> text; embedText: string -> number[]
- AnchorProvider: headless preloader sharing the SDK's model caches; createAnchorSDK: owns the IntegrityMachine for debounced recovery

## 2026-08-29 — feat: full SDK wiring + package README
- src/index.ts exports the complete surface: native binding, sensor hooks, six checks, solarCompassHeading, evaluateIntegrity/stepIntegrity, createAnchorSDK/AnchorProvider, AI wrappers, contract types
- README: quick start, state machine table, thresholds table, native module events/status docs, AI guarantees, autolinking notes
- 70 jest tests green, tsc --noEmit clean

## 2026-08-29 — feat(anchor-demo): complete instrument app + first green EAS build (apps/)
- full instrument UI: StatusStrip (state fill + crossfade), six PFD-style TapeGauges (scrolling tick tape, fixed center readout, eased via Reanimated), EventLog flight recorder, BottomBar with labeled TEST HARNESS (SIMULATE SPOOF injects 5 teleported fixes + 5 lockstep-waveform C/N0 epochs through the normal pipeline; RESET swaps in a fresh createAnchorSDK to clear the SDK-internal debounce machine; SHOW REASON reveals last explanation), mic capture via expo-audio AudioStream (16 kHz mono float32, fully offline) -> sdk.transcribe -> fixed command matching, semantic search (sdk.embed query -> cosine vs stored reason vectors)
- pipeline aligned with final SDK semantics: no prevState threading (SDK owns recovery-debounce), AnchorProvider at router root, useGnssMeasurements(30)
- expo-doctor 21/21; tsc --noEmit clean against complete anchor-sdk contract
  - app.json: removed SDK-57-removed android.edgeToEdgeEnabled/android.statusBar fields; async-storage pinned 2.2.0
  - local bundling proof: repaired npm-corrupted react-native-worklets (missing src/threads.ts), full 1892-module Metro graph + 5 MB Hermes bytecode via expo export (hermesc x86_64 binary shimmed through qemu-x86_64 on this arm64 box)
- EAS development build 254e5629-9aa6-476f-ac31-b04c800e9de9 FINISHED (post anchor-sdk Kotlin constellation fix 5ba7532); APK downloaded to apps/anchor-demo/releases/anchor-dev.apk (gitignored: 258 MB exceeds GitHub 100 MB blob limit — artifact lives at https://expo.dev/accounts/iamchris2005/projects/anchor/builds/254e5629-9aa6-476f-ac31-b04c800e9de9)
- APK artifact apps/anchor-demo/releases/anchor-dev.apk now stored in git via LFS (258 MB, exceeds plain-blob limit): https://expo.dev/accounts/iamchris2005/projects/anchor/builds/254e5629-9aa6-476f-ac31-b04c800e9de9

## 2026-08-29 — ci: dev apk published as rolling dev-latest GitHub release; future artifacts ship via releases, LFS frozen
- release https://github.com/ChristopherJoshy/Anchor---Full-Build-/releases/tag/dev-latest — asset anchor-dev.apk (258,207,665 bytes, state: uploaded), body carries EAS build URL + id 254e5629 + date + API 24+ physical-device install note
- agents.md release policy rewritten: every successful EAS build replaces the dev-latest release (delete release+tag, recreate with new asset); no more APK blobs via LFS — existing LFS copy frozen at build 254e5629

## 2026-08-29 — ci: real standalone production apk shipped (EAS 81f660f9); dev-client shell removed from git and releases
- eas.json production profile now builds an installable APK (distribution internal, android.buildType apk) — commit 2a5c834
- EAS production build 81f660f9-453d-4446-b246-b9a84a37b077 FINISHED: https://expo.dev/accounts/iamchris2005/projects/anchor/builds/81f660f9-453d-4446-b246-b9a84a37b077 — verified real app: assets/index.android.bundle (4,107,444 B) embedded, zero dev-launcher/expo-dev-client entries in the APK
- rolling release replaced: dev-latest deleted, tag `latest` recreated with the production APK (184,483,397 B): https://github.com/ChristopherJoshy/Anchor---Full-Build-/releases/tag/latest
- in-repo LFS artifact replaced: anchor-dev.apk (frozen 254e5629 dev client) removed, anchor.apk added as new LFS object — superseded LFS object deletion not exposed by the GitHub REST API (404); ages out via orphaned-object GC

## 2026-08-29 — audit: adversarial math audit (clean) + best-methods review (1 fix)
- Math audit vs authoritative sources, all 9 items CORRECT, no code changes: solar position matches NOAA's verbatim reference JS to 0.00000 deg on 12 cases (both hemispheres, midnight wrap, near-pole; our east-positive longitude vs NOAA's west-positive reconciled); haversine London-Paris 343556.5 m vs ~343.8 km arc, JFK-LHR within 19 m; barometric formula within 1.3 m of ISA-exact at 9 km (44330/0.1903 vs 44330.77/0.1902665); atan2(-mx,my) portrait heading + negated gyro integration match Android SensorEvent frame (x=right, y=top, z=out; gyro positive = CCW); cn0 residual-variance ratio 1-1/N proven exact, Monte Carlo 0% false positives at 5 and 30 epochs (20k trials), lockstep ratio 1e-30; kinematic/temporal outputs match independent Python recomputation on 6 windows (12/12 exact); CHECK_WEIGHTS sum 1.0, confidenceOf matches to 1e-12; README thresholds match code constants
- Best-methods fix: useImuStream/useBarometerStream teardown now removes per-subscription handles instead of removeAllListeners (documented expo-sensors pattern; removeAllListeners would kill other consumers' subscriptions on unmount)
- Verified current (no change): watchPositionAsync+Accuracy.Balanced+timeInterval (SDK 57 docs, Balanced is documented default), DeviceSensor addListener/subscription.remove (docs' own sample), react-native-executorch initExecutorch+ExpoResourceFetcher and functional LLMModule/SpeechToTextModule/TextEmbeddingsModule (documented Typescript API section), Expo Modules Events/sendEvent/AsyncFunction(Promise) DSL, RingBuffer O(1) push (toArray O(n) at 1 Hz x n<=600 is negligible), jest 29 + ts-jest 29 (both supported, nothing deprecated)

## 2026-08-29 — ci: rebuilt production apk at HEAD so the shipped binary includes 91b6d99 (sensor teardown audit fix)
- prior released apk (81f660f9) predated the audit fix although the tag pointed past it; rebuilt from clean synced tree (e5d9673)
- EAS production build 6004d5eb-92b0-42a5-9f9b-84a802bf66c9 FINISHED: https://expo.dev/accounts/iamchris2005/projects/anchor/builds/6004d5eb-92b0-42a5-9f9b-84a802bf66c9 — verified: assets/index.android.bundle (4,107,360 B) embedded, 0 dev-launcher/expo-dev-client entries
- rolling release `latest` deleted + recreated with the new APK (184,483,309 B): https://github.com/ChristopherJoshy/Anchor---Full-Build-/releases/tag/latest
- LFS object replaced (45eb611492 -> d9996625d3) — commit 5a384c1

## 2026-08-29 — fix(anchor-demo): blank-launch hardening — ErrorBoundary, startup milestones, resilient font gate, react compiler off
- reported: production apk blank at launch in emulator (persists after user's local fixes; no fix commits found on the remote — full ref search: ls-remote, branch -r, branches API, PR list, commits API all show main == 520f13c only)
- RootErrorBoundary at app root: render exceptions now paint error + component stack (DENIED-styled) instead of a blank frame
- [anchor:startup] milestone logs (fonts/provider/primer decisions/dashboard mount) — `adb logcat | grep anchor:startup` pinpoints a stall
- font gate: load failure or >10 s hang proceeds with system fonts instead of returning null forever; primer renders its shell instead of null while decisions load
  - static audit found: useFonts gate rendered null permanently on font error; no ErrorBoundary (production uncaught = blank); SDK AI imports are dynamic (no import-time JSI); sensor listeners are effect-scoped; main=expo-router/entry correct; worklets babel plugin auto-applied by babel-preset-expo
- experiments.reactCompiler disabled (known release-miscompile source; not needed)
- pre-verified before shipping: tsc clean, expo export bundle contains all 6 milestone strings + route keys, expo-doctor 21/21

## 2026-08-29 — feat: swap explainer LLM to Qwen3 1.7B (quantized) per model-zoo research
- Researched installed react-native-executorch 0.9.3 registry: 24 LLMs (incl. qwen3_0_6b/1_7b/4b/3_5_0_8b/3_5_2b, qwen2_5_0_5b/1_5b/3b, llama3_2_1b/3b, smollm2_1_135m/360m/1_7b, phi_4_mini_4b, hammer2_1, gemma4_e2b, lfm2_5 family, bielik), 6 STT (whisper tiny/base/small x en/multilingual), 7 embedders (all_mpnet_base_v2 best English; clip text + 2 multilingual also shipped)
- Explainer: llama3_2_1b -> qwen3_1_7b (registry default = 8da4w-quantized pte; resolveCell(opts.quant !== false) proves default quantization). ASR whisper_base_en and embedder all_mpnet_base_v2 kept (best-fit rationale in report)
- Qwen3 thinking-mode normalization: stripThinking() removes <think> blocks (enable_thinking not exposed by generate()); system prompt tightened
- Docs: package README model table + deviations; root README model-table lines only (4 lines: explain rows x2, embed rows x2 — embed was mislabeled multi-qa-mpnet-base-v2, actually all-mpnet-base-v2)
- 73 jest tests green (3 new stripThinking cases), tsc clean

## 2026-08-29 — ci: rebuilt production apk carrying hardening + Qwen3 explainer (EAS c6d4852a) shipped as latest
- shipped 951c2cf8 predated the Qwen3 explainer swap (a79075e); rebuilt from synced HEAD be25cee so the next emulator window tests ONE apk with both
- EAS production build c6d4852a-50da-422c-ae54-13239678b47c FINISHED: https://expo.dev/accounts/iamchris2005/projects/anchor/builds/c6d4852a-50da-422c-ae54-13239678b47c
- verified in the shipped binary: assets/index.android.bundle embedded (4,103,332 B); extracted-bundle greps: 'anchor:startup' 1, 'qwen' 3 (Qwen3 accessor present), 'INTEGRITY FAULT' 1; 0 dev-launcher/expo-dev-client entries
- rolling release `latest` deleted + recreated with the new APK (184,480,273 B): https://github.com/ChristopherJoshy/Anchor---Full-Build-/releases/tag/latest
- LFS object replaced (f7abab8464 -> new pointer) — commit ea8b955
- agents.md: full refresh per new standing directive — stack state, blank-launch hardening record, release pipeline reality, agents.md maintenance cadence rule

## 2026-08-29 — test(anchor-demo): component render suite — primer, font-gate resilience, error boundary, dashboard with real physics
- EAS Simulator unavailable (availability:false, waitlist) — no session started, nothing billed; fell back to a real component render suite in Node
- devDeps: jest 29 + jest-expo ~57 + @react-native/jest-preset 0.86.3 (must match react-native 0.86) + @testing-library/react-native 13 (legacy-peer-deps: react-test-renderer peer)
- jest.config.js (jest-expo preset, jsdom, transformIgnorePatterns for expo/reanimated/anchor-sdk), jest.setup.ts -> native-module boundary mocks (expo-location/expo-audio/expo-haptics/AsyncStorage/AnchorGnss native binding/reanimated-worklets passthrough); physics/checks/state machine always real
- suites: primer (rows + Continue + request order), fontGate (font-failure + 10s-hang both render content — the blank-screen regression class), errorBoundary (INTEGRITY FAULT panel), dashboard with real physics (clean-drive -> TRUSTED + six gauge labels + EVENT LOG; spoofed-jump -> DENIED), pureLogic (13: command matching + cosine ranking)
- REAL BUG FOUND AND FIXED: matchCommand returned the first command in LIST order, not the first appearing in the utterance ('reset then simulate spoof' matched 'simulate spoof'); now earliest occurrence wins — commit separate
- app 21/21 + SDK 73/73 green; app + SDK tsc clean; tsconfig gains types:["jest"]

## 2026-08-29 — fix: SDK physics hardening + demo pipeline/display hardening

- SDK: `AnchorProvider` now renders `children` (was `return null` — blank screen on device; tests mocked it); `evaluateIntegrity` off-by-one `reasonFor` now uses `next.cleanStreak` (DENIED 1/5 vs 0/5, RECOVERING satisfied after 5)
- SDK physics: `kinematicCheck` fail-closed on non-finite coords/speed/accuracy/timestamp and infinite accuracy (Infinity no longer infinite tolerance); `environmentalCheck`/`temporalCheck`/`headingCheck`/`altitudeCheck` fail on NaN/Infinity; `headingCheck` guards solar/displacement/trackBearing NaN and non-finite speed; `altitudeCheck` validates pressure >0 and finite; `cn0Check` keys by `constellation:svid` (fixes GPS 5 ≠ GLONASS 5 collision) and rejects non-finite C/N0, `residualRatio` properly filtered
- SDK native: `AnchorGnssModule.kt` `measurementCallback` `@Volatile`, promise resolved inside `mainHandler.post` for API 24-30 (was resolved before registration — stuck no-data), `cn0DbHz` filter `isFinite()`
- SDK sensors: `useBarometerStream` holds subscription in `useRef` (was per-render `let` leak on StrictMode); `executorchRuntime` docs unchanged but lazy guarantee preserved
- Demo: `useAnchorPipeline` deduplicates sensor pushes and evaluates only on new `fix.timestamp` (was re-pushing same fix on every IMU 10Hz tick — 60 fixes filled in 6s, corrupting kinematic/heading); `injectSpoof` bounded to one burst; `reset` generation guard prevents stale `explain/embed` overwriting new entries; `spoofs` bounded, base lat/lon fallback now real coordinate
- Demo display: `TapeGauge` removes invalid `useDerivedValue<ReactNode>` (was rendering SharedValue object on device) — static `displayScore` + animated column; clamps NaN scores; `SafeAreaProvider` at `_layout.tsx` + `SafeAreaView` in `dashboard.tsx`/`index.tsx` (was hard-coded `paddingTop:72` occluded by notch); `theme.hairline` now `StyleSheet.hairlineWidth` (was 1px thick); overlay scrim now uses inner `Pressable` to allow scroll without closing; dashboard `locationDenied` gated on `permsLoaded`; `BottomBar` surfaces `lastError` and clips NaN cosine scores
- Demo hooks: `useVoiceCommands` toggle deadlock fixed (now guards on `status` not stale `isStreaming`), adds 10s transcription timeout and resets `allowsRecording`; `usePermissions` adds unmount guard; `useLocation`/`index.tsx` `onContinue` try/finally and de-duplicated navigation; `lib/search` `cosineSimilarity` NaN-safe
- Tests: `nativeModules` adds `react-native-safe-area-context` mock; `fontGate` now passes with new provider; `TapeGauge` mock still passes; SDK 73/73 + demo 21/21 green; `tsc --noEmit` clean both packages; `expo export --platform android` bundles 1892 modules + 5MB Hermes; `expo-doctor` 21/21

## 2026-08-29 — fix(demo): real metrics, stall-proof status engine, live telemetry rail

- Status freeze fixed: evaluation now runs on BOTH new-fix arrival AND a 1 Hz interval tick (skips if fix path evaluated <900 ms ago) — status/gauges/mocks stay live even when GPS fixes stall (indoors/denied); mock frames drain one per tick instead of one per GPS fix
- Real metrics: `detMs` measured via `measureDeterministic`/`performance.now` around `sdk.evaluate` (was `5+random(8)` fabricated); advisory `quantizedMs` now real elapsed time (was the chosen random); fabricated ADV% / `hybridConfidenceOf` removed from the panel (CONF = real verdict.confidence)
- Live telemetry rail: POS lat/lon (4 dp, N/S E/W), ALT, ACC (caution >25 m), SPD, TRK, SAT count (caution <4), BARO hPa — all measured from the sensor window each tick, never synthesized
- `WINDOW_FIX_CAP` 60 → 30: injected violations age out in ~30 s so TRUSTED→DEGRADED→DENIED→RECOVERING→TRUSTED is visible in a demo window; recovery debounce still 5 clean evals
- Injector relabeled SCENARIO INJECTOR — REAL PHYSICS (frames enter the same `evaluate()` path as live GPS); VPN banner unchanged (IP ≠ GNSS, GPS stays TRUSTED)
- primer `paddingTop` 72 → spacing.xl (SafeArea already insets top — double offset removed)
- Only synthesized element remains the Qwen advisory TEXT (showcase, labeled) — all numbers, states, gauges, telemetry are measured
- tsc clean both packages; demo jest 21/21 (--runInBand); expo export 5.1MB hbc; expo-doctor 21/21

## 2026-08-29 — feat: zero-mock implementation — real VPN detection, real advisory, iQOO 15 island capsule

- Mocking banned across the app: deleted the fake hybrid showcase engine (synthesized Qwen text, fake timing, fake ADV%) — every displayed value is now measured or real SDK output
- SDK: new native `AnchorNetModule.kt` — real OS VPN detection (kernel tun/tap interface scan + ConnectivityManager TRANSPORT_VPN), registered in expo-module.config.json; `AnchorNet` exported from SDK index
- Demo `useNetworkIntegrity`: polls real `AnchorNet.isVpnActive()` every 2 s; real HTTPS IP geolocation (ipwho.is → ipapi.co fallback) every 60 s; real haversine IP↔GPS divergence (limit 150 km) — banner + flight-recorder events on tunnel up/down and divergence; GNSS physics stay authoritative (VPN ≠ spoof, per fraud-detection research)
- Advisory: real on-device Qwen3 1.7B via `sdk.explain` (lazy ExecuTorch load) — deterministic reason shown, clearly labeled, until the model produces text; `IntegrityPanel` replaces HybridPanel (EVAL ms measured via performance.now, CONF real, FAILED checks real, advisory source labeled)
- Test harness: DISARMED by default (`LIVE SENSORS ONLY`); ARM switch gates all attack staging (teleport/cn0/alt/hdg/time/env/attack→DENIED) + RECOVERY PATH — full real machine arc TRUSTED→DEGRADED→DENIED→(5 clean evals)→RECOVERING→TRUSTED in ~20 s (window caps 12); frames enter the same evaluate() path as live GPS
- Stall-proof 1 Hz engine + immediate new-fix path (900 ms guard) — status never freezes; no dead-end screen when GPS denied/indoor: banner + OPEN SETTINGS + full instrument stays usable
- RECOVERY VERIFIED latch derived from real flight-recorder transitions (RECOVERING@t → TRUSTED@t)
- Telemetry rail: POS/ALT/ACC/SPD/TRK/SAT/BARO + SENSORS health row (GPS/IMU/BARO/GNSS ✓✗ with sample counts, fix age) — all measured
- `IslandCapsule`: Dynamic-Island-style capsule for the iQOO 15 demo device — pill hugs the camera cutout (state color, live conf), auto-expands on non-TRUSTED transitions (reason, CONF, EVAL, FAILED, VPN tunnel+divergence), tap toggles, Reanimated morph
- SDK 73/73 + demo 21/21 green; tsc clean both; expo export 5.1MB hbc; expo-doctor 21/21
