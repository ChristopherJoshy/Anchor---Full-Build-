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

## 2026-08-29 — audit: adversarial math audit (clean) + best-methods review (1 fix)
- Math audit vs authoritative sources, all 9 items CORRECT, no code changes: solar position matches NOAA's verbatim reference JS to 0.00000 deg on 12 cases (both hemispheres, midnight wrap, near-pole; our east-positive longitude vs NOAA's west-positive reconciled); haversine London-Paris 343556.5 m vs ~343.8 km arc, JFK-LHR within 19 m; barometric formula within 1.3 m of ISA-exact at 9 km (44330/0.1903 vs 44330.77/0.1902665); atan2(-mx,my) portrait heading + negated gyro integration match Android SensorEvent frame (x=right, y=top, z=out; gyro positive = CCW); cn0 residual-variance ratio 1-1/N proven exact, Monte Carlo 0% false positives at 5 and 30 epochs (20k trials), lockstep ratio 1e-30; kinematic/temporal outputs match independent Python recomputation on 6 windows (12/12 exact); CHECK_WEIGHTS sum 1.0, confidenceOf matches to 1e-12; README thresholds match code constants
- Best-methods fix: useImuStream/useBarometerStream teardown now removes per-subscription handles instead of removeAllListeners (documented expo-sensors pattern; removeAllListeners would kill other consumers' subscriptions on unmount)
- Verified current (no change): watchPositionAsync+Accuracy.Balanced+timeInterval (SDK 57 docs, Balanced is documented default), DeviceSensor addListener/subscription.remove (docs' own sample), react-native-executorch initExecutorch+ExpoResourceFetcher and functional LLMModule/SpeechToTextModule/TextEmbeddingsModule (documented Typescript API section), Expo Modules Events/sendEvent/AsyncFunction(Promise) DSL, RingBuffer O(1) push (toArray O(n) at 1 Hz x n<=600 is negligible), jest 29 + ts-jest 29 (both supported, nothing deprecated)
