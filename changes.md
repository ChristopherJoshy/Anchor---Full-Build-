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
