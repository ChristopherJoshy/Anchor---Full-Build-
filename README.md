# Anchor

**On-device GPS integrity monitoring for Android.** Anchor continuously cross-examines raw GNSS measurements against the phone's own physics — inertial sensors, barometer, magnetometer, and the sun itself — through six independent consistency checks, then feeds them into a deterministic RAIM/FDE-derived state machine that classifies every fix as **TRUSTED**, **DEGRADED**, **DENIED**, or **RECOVERING**. A fully offline AI stack — an on-device LLM, speech recognizer, and embedder running via ExecuTorch — explains every verdict, takes voice commands, and powers semantic search over the flight-recorder log, without ever sending a byte to the cloud.

The repo is an npm-workspaces monorepo:

- [`packages/anchor-sdk`](packages/anchor-sdk) — the engine: Expo native module (Android) exposing raw satellite measurements, sensor streams, six physics checks, the RAIM/FDE state machine, and the on-device AI layer.
- [`apps/anchor-demo`](apps/anchor-demo) — the cockpit: an Expo SDK 57 demo app with an avionics glass-cockpit UI that exercises every SDK capability.

## Table of contents

- [Background](#background)
- [Architecture](#architecture)
- [Features](#features)
  - [The six physics consistency checks](#the-six-physics-consistency-checks)
    - [1. Kinematic consistency](#1-kinematic-consistency)
    - [2. Heading consistency](#2-heading-consistency)
    - [3. Temporal consistency](#3-temporal-consistency)
    - [4. Altitude consistency](#4-altitude-consistency)
    - [5. Environmental plausibility](#5-environmental-plausibility)
    - [6. C/N0 temporal correlation](#6-cn0-temporal-correlation)
  - [Solar compass](#solar-compass)
  - [Integrity state machine](#integrity-state-machine)
  - [On-device AI stack](#on-device-ai-stack)
  - [Voice commands](#voice-commands)
  - [Semantic event-log search](#semantic-event-log-search)
  - [Demo app UI](#demo-app-ui)
  - [Permissions and graceful degradation](#permissions-and-graceful-degradation)
- [Design system](#design-system)
- [Getting started](#getting-started)
- [Project structure](#project-structure)
- [AnchorSDK interface](#anchorsdk-interface)
- [Roadmap](#roadmap)
- [License](#license)

## Background

### The threat: GPS spoofing

Civilian GNSS signals (GPS L1 C/A and friends) carry no cryptographic authentication. A receiver simply locks onto whatever signal is strongest and most self-consistent — so an attacker with a software-defined radio can broadcast a counterfeit constellation and walk the receiver to any position, velocity, and time of their choosing. Cheap hardware has moved this from a nation-state capability to a laptop demo. The victims are everything that trusts a phone's GPS: navigation, geofenced audit trails, delivery proofs, asset trackers, location-based authentication.

### RAIM/FDE heritage

Aviation solved this problem decades ago with **RAIM** (Receiver Autonomous Integrity Monitoring): the receiver cross-checks its redundant ranging measurements against each other and raises an integrity flag when they disagree.

- With **5 satellites** visible, a single faulty measurement is *detectable*.
- With **6**, it can be *excluded* and the fix recalculated — **FDE** (Fault Detection and Exclusion).
- Pseudorange residuals form a test statistic, compared against a threshold derived from a permitted **false-alarm probability**.
- The outcome is a **protection level** (HPL) compared against an **alert limit** (HAL): either the fix is provably good enough, or it is not.

Anchor re-derives that philosophy for a phone. Instead of pseudorange residuals, the redundancy comes from physically independent sensors (IMU, barometer, magnetometer, the sun); instead of one test statistic, six pure consistency checks with deterministic thresholds; instead of HPL vs HAL, a weighted verdict with explicit debouncing before trust is granted or restored.

### Why on-device AI

The AI in Anchor is advisory: it explains verdicts in plain language, transcribes voice commands, and embeds text for search. Running it on-device (ExecuTorch on XNNPACK CPU) keeps the safety path pure and the advisory path private, offline, and latency-predictable. The separation is enforced at the type level: `explain(verdict)` receives an immutable `Verdict` and returns a `Promise<string>` — the AI can *describe* the safety state but can never *change* it.

### Why no cloud

An integrity monitor that phones home fails in exactly the scenarios it exists for: jamming routinely accompanies spoofing, and a disconnected or adversarial network is precisely when you need trustworthy positioning. Keeping everything on the device also means location history never leaves the phone, and the safety classification remains a pure, deterministic function — same window in, same verdict out.

## Architecture

Every position fix flows through seven stages. Stages 1–3 acquire and condition sensor data, 4–5 run the physics and anomaly analysis, 6 makes the trust decision, 7 delivers it to the app.

```text
┌──────────────────────────────────────────────────────────────────────┐
│ 1 · SENSORS                                                          │
│ GNSS measurements (Kotlin AnchorGnss, API 24+) · location @ 1 Hz     │
│ magnetometer + gyroscope (complementary heading) · barometer         │
└───────────────────────────────────┬──────────────────────────────────┘
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 2 · SENSOR VALIDATION                                                │
│ raw-stream plausibility, dropout and rate handling                   │
└───────────────────────────────────┬──────────────────────────────────┘
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 3 · FUSION ESTIMATOR                                                 │
│ complementary-filter heading · per-epoch SensorWindow assembly       │
└───────────────────────────────────┬──────────────────────────────────┘
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 4 · INTEGRITY EVALUATION                                             │
│ six physics consistency checks — pure, independently weighted        │
│ kinematic · heading · temporal · altitude · environmental · cn0      │
└───────────────────────────────────┬──────────────────────────────────┘
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 5 · SPOOF/ANOMALY ENGINE                                             │
│ correlated-failure reasoning · synthetic-signal detection            │
└───────────────────────────────────┬──────────────────────────────────┘
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 6 · SAFETY STATE MACHINE (deterministic RAIM/FDE)                    │
│ TRUSTED · DEGRADED · DENIED · RECOVERING — weights, critical         │
│ pairs (kinematic+cn0, kinematic+heading), 5-eval recovery debounce   │
└───────────────────────────────────┬──────────────────────────────────┘
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 7 · CONSUMER                                                         │
│ AnchorProvider → Verdict { state, checks[], reason }                 │
│ StatusStrip · TapeGauges ×6 · EventLog · AI explain (all offline)    │
└──────────────────────────────────────────────────────────────────────┘
```

### Monorepo layout

| Path | Role |
| --- | --- |
| `packages/anchor-sdk` | Expo native module (standalone, **Android-only**): Kotlin GNSS bridge, sensor hooks, six checks, state machine, AI loaders. Pure logic is platform-agnostic TypeScript. |
| `apps/anchor-demo` | Expo SDK 57 app (expo-router) with the avionics UI, voice control, semantic search, and debug controls. Consumes the SDK via the workspace. |

Root `package.json` wires both with npm workspaces; `npm install` at the root links `anchor-sdk` into the demo app.

### Data flow: sensors to UI

1. Sensor hooks (`useGnssMeasurements`, `useLocationStream`, `useImuStream`, `useBarometerStream`) stream into a ring buffer / window builder; each epoch assembles a `SensorWindow`.
2. `evaluate(window, prevState)` runs the six checks and the state machine — a **pure, synchronous** function. No I/O, no randomness.
3. The resulting `Verdict` (state, per-check results, human-readable reason) is published through `AnchorProvider`.
4. The UI reacts: the StatusStrip crossfades and fires a haptic on transition, the six TapeGauges ease to their new residuals, and the EventLog appends a timestamped row.
5. On demand, the AI layer explains the latest verdict, transcribes a voice command, or embeds a search query — all lazily loaded on first use.

## Features

### The six physics consistency checks

Each check is a **pure function** over the sensor window: deterministic, independently weighted, and unit-tested against recorded fixtures (`clean-drive.json`, `spoofed-jump.json`). A check fails when the reported GNSS solution disagrees with what the phone's other physics say must be true.

#### 1. Kinematic consistency

**What it detects:** motion that is physically impossible. The check compares the speed *implied* by consecutive fixes (displacement / Δt) against the *reported* speed from the location provider, and flags teleports — displacements no vehicle could cover in one epoch.

**Why a spoofer trips it:** the cheapest spoof rips the receiver to a new location. The GNSS-reported position jumps, but the phone did not accelerate: implied and reported speed diverge, or the fix teleports outright.

#### 2. Heading consistency

**What it detects:** disagreement between three independent heading references — GPS course-over-ground, the fused magnetic heading (magnetometer + gyroscope complementary filter), and the solar compass (see [Solar compass](#solar-compass)).

**Why a spoofer trips it:** a spoofed fix moves your reported position and bearing, but it cannot move the Earth's magnetic field or the sun. When the counterfeit track turns you, the magnetometer and solar references stay honest — the three-way disagreement exposes the fraud.

#### 3. Temporal consistency

**What it detects:** timestamp pathology: non-monotonic epochs, jitter outside physical bounds, and replayed or duplicated samples.

**Why a spoofer trips it:** synthetic signal generators routinely replay recorded measurements or emit epochs at irregular cadence. Real hardware produces a monotonic, tightly-clocked stream; counterfeits rarely do.

#### 4. Altitude consistency

**What it detects:** divergence between GNSS altitude and the barometric estimate. The barometer integrates real ambient pressure and drifts smoothly; GNSS altitude should track it within physical bounds.

**Why a spoofer trips it:** counterfeit signals impose an attacker-chosen altitude. Barometric drift is gradual and physical; a GPS altitude that suddenly disagrees with the smoothed barometric trend is a strong counterfeit signature.

#### 5. Environmental plausibility

**What it detects:** fixes that violate sanity bounds — speed above any physical vehicle, altitude outside the plausible envelope, parameter combinations that cannot coexist (e.g. stationary fix with supersonic implied velocity).

**Why a spoofer trips it:** spoofing tools focus on producing *convincing* trajectories, and plausibility is exactly where their shortcuts show. A hard bounds check is cheap and catches the sloppiest counterfeits before the expensive checks bother.

#### 6. C/N0 temporal correlation

**What it detects:** synthetic signal injection in the RF domain itself. The check tracks each satellite's carrier-to-noise-density (C/N0) residual over time and tests whether per-satellite residuals move **in lockstep**.

**Why a spoofer trips it:** authentic satellites fade independently — multipath, foliage, and body shadowing hit each vehicle differently. A single counterfeit signal generator drives every tracked satellite from one source, so their C/N0 residuals correlate; lockstep movement is the synthetic-signal flag.

### Solar compass

`solarCompassHeading(time, latitude, longitude)` implements **NOAA solar position**: from the current time and location it computes the sun's azimuth and elevation. The sun is a celestial reference no radio attacker can counterfeit, so the derived heading gives the [heading check](#2-heading-consistency) a third, physically unspoofable vote — wherever GPS course and magnetometer agree with each other but not with the sky, something is lying.

### Integrity state machine

`evaluateIntegrity` is a **deterministic, weighted RAIM/FDE state machine** — same inputs, same verdict, every time. Checks carry weights; a single non-critical failure degrades trust, compound or critical-pair failure denies it, and recovery is deliberately slower than failure.

| State | Meaning | Color | Enters when | Leaves when |
| --- | --- | --- | --- | --- |
| `TRUSTED` | All checks pass; fix is trustworthy | `trusted` | initial state; failing check recovers | any check fails |
| `DEGRADED` | Exactly **1 non-critical** check failing | `caution` | one non-critical failure | failure clears → `TRUSTED`; a second failure or critical pair → `DENIED` |
| `DENIED` | Fix is not trustworthy | `denied` | **≥ 2** checks failing, or a **critical pair** (`kinematic`+`cn0`, `kinematic`+`heading`) | **5 consecutive clean evaluations** → `RECOVERING` |
| `RECOVERING` | Provisional trust, under observation | `caution` | recovery debounce elapsed after `DENIED` | clean evaluations hold → `TRUSTED`; any failure → back to `DENIED` |

The 5-evaluation debounce is the FDE flavor of the design: trust is *excluded* on strong evidence and only *re-admitted* after a sustained clean streak, so a flapping spoofer cannot toggle the state machine.

### On-device AI stack

All models run via **react-native-executorch** on **XNNPACK CPU** (prebuilt AAR — no native toolchain needed), loaded from Software Mansion's Hugging Face-hosted `.pte` binaries, and **lazy-loaded on first call** so app start pays nothing for AI.

| Capability | Model | Input → output |
| --- | --- | --- |
| `explain` | Llama-3.2-1B (quantized) | `Verdict` → 1–2 plain-English sentences |
| `transcribe` | whisper-base.en | `Float32Array` (16 kHz mono PCM) → transcript |
| `embed` | multi-qa-mpnet-base-v2 | text → embedding vector |

The type-level contract matters: `explain(verdict)` takes a `Verdict` and returns a `Promise<string>`. It structurally *cannot* mutate sensor state or flip the safety machine — AI advises, physics decides.

### Voice commands

The mic button streams to the on-device ASR (`transcribe`); the transcript is matched against a **fixed command set**:

| Utterance | Action |
| --- | --- |
| `"simulate spoof"` | injects a synthetic spoofed fix into the pipeline |
| `"reset"` | clears the simulator and returns to live sensors |
| `"show reason"` | surfaces the current verdict's plain-language reason |

A fixed set keeps false accepts low, avoids any cloud NLU, and matches the aviation habit of pushing discrete buttons instead of chatting with the autopilot.

### Semantic event-log search

Every EventLog entry's reason is embedded (`embed`) when written. The search bar embeds your query and ranks entries by **cosine similarity** — so searching *"signal looked synthetic"* finds the C/N0 correlation alarm even though no entry contains those words. All matching happens on-device.

### Demo app UI

The demo (`apps/anchor-demo`, Expo SDK 57 + expo-router, distributed as an EAS-built dev client) presents the pipeline as an **avionics glass cockpit**:

- **StatusStrip** — full-width filled strip at the top: current state color, reason in mono type. Transitions crossfade and fire a haptic.
- **Six TapeGauges** — vertical PFD-style scrolling tick scales, one per check (kinematic, heading, temporal, altitude, environmental, cn0) with IBM Plex Mono readouts and eased motion.
- **EventLog** — flight-recorder-style scrolling log with a monospace fixed-width timestamp column.
- **Persistent bottom bar** — mic button plus the semantic search bar, always reachable.
- **Debug controls** — `SIMULATE SPOOF`, `RESET`, and `SHOW REASON` buttons that drive the same paths as the voice commands.

### Permissions and graceful degradation

Before any native dialog appears, a **permissions primer screen** explains, in plain language, why Anchor wants location (it is the thing being monitored) and the microphone (voice commands only). Tapping **Continue** triggers the native dialogs **in sequence**, so each request arrives with context instead of a permission blitz on first launch.

| Permission denied | Behavior |
| --- | --- |
| Location | Empty state with a plain explanation and a button that opens system settings via `Linking.openSettings()` — the app cannot function without a fix, and it says so honestly. |
| Microphone | Only the mic button is disabled. Gauges, verdicts, event log, search, and debug controls keep working — voice is a convenience, never a dependency. |

## Design system

The demo's visual language is **avionics instrumentation**, not consumer app: dark panels, hairline dividers, hard edges, and disciplined color that only ever means one thing.

### Tokens

| Token | Value | Reserved for |
| --- | --- | --- |
| `panel-bg` | `#0C1116` | app background |
| `panel-surface` | `#151B21` | instrument panels |
| `chrome` | `#3A434D` | hairlines, inactive chrome |
| `trusted` | `#00D9A3` | `TRUSTED` — and nothing else |
| `caution` | `#FFB300` | `DEGRADED` and `RECOVERING` |
| `denied` | `#FF3B30` | `DENIED` — and nothing else |

### Typography, layout, motion

- **Type:** IBM Plex Mono for every reading (numerals that don't reflow the layout, cockpit-plausible look); Inter for labels and prose.
- **Layout:** hard edges, hairline dividers, no rounded cards, no gradients — instrument bezels, not soft UI.
- **Motion:** minimal and functional — eased gauge needle/tape motion and the StatusStrip crossfade. Nothing bounces, nothing decorates.

### Avionics rationale

The tape gauges are borrowed straight from the **primary flight display (PFD)**, where speed and altitude are shown as scrolling vertical tapes. The format survives because it maximizes **single-glance information density**: value, trend, and deviation-from-norm are readable in one fixation. Six gauges side by side give the same property for integrity: a pilot-style scan across kinematic → heading → temporal → altitude → environmental → C/N0 answers "is this fix healthy?" before the StatusStrip even needs to speak.

## Getting started

### Prerequisites

- **Node v24** and npm (the monorepo uses npm workspaces)
- An **Expo account** (free) — the dev client is built on EAS
- A physical **Android device, API 24+** (Android 7.0+). Raw GNSS measurements require real radio hardware; emulators will not work.

### Install

```bash
git clone https://github.com/ChristopherJoshy/Anchor---Full-Build-.git
cd Anchor---Full-Build-
npm install
```

### Build the dev client (EAS)

The demo runs through a **development build** (`expo-dev-client`), since it bundles a custom native module:

```bash
cd apps/anchor-demo
npx eas login
npx eas build --profile development --platform android
```

EAS builds in the cloud (no local Android SDK needed). When it finishes, install the APK on your device from the build page — the `development` profile is an internal-distribution APK.

### Run

```bash
npx expo start --dev-client
```

Launch the installed Anchor dev client; it connects to the Metro bundler.

### Test and typecheck

```bash
cd packages/anchor-sdk
npx jest           # unit tests incl. clean-drive / spoofed-jump fixtures
npx tsc --noEmit   # typecheck
```

## Project structure

```text
anchor/
├── package.json                  # npm workspaces root (packages/*, apps/*)
├── changes.md                    # dated build log
├── packages/
│   └── anchor-sdk/               # Expo module — standalone, Android-only
│       ├── package.json          # no-build TS package: main/types → src/index.ts
│       ├── expo-module.config.json
│       ├── src/
│       │   ├── index.ts          # public barrel: createAnchorSDK, hooks, provider, types
│       │   ├── AnchorSdk.types.ts
│       │   ├── AnchorSdkModule.ts # typed proxy over the native module
│       │   ├── checks/           # six pure physics checks, one file each
│       │   ├── integrity/        # evaluateIntegrity: weighted RAIM/FDE state machine
│       │   ├── solar/            # solarCompassHeading — NOAA solar position
│       │   ├── hooks/            # useLocationStream · useImuStream ·
│       │   │                     #   useBarometerStream · useGnssMeasurements (ring buffer)
│       │   ├── ai/               # lazy ExecuTorch loaders: explain/transcribe/embed
│       │   ├── provider.tsx      # AnchorProvider context
│       │   └── __tests__/        # jest + fixtures: clean-drive.json, spoofed-jump.json
│       └── android/
│           └── src/main/java/…/AnchorGnss*.kt
│                                 # registerGnssMeasurementsCallback (API 24+):
│                                 #   per-satellite C/N0, constellation map, epoch timestamps
└── apps/
    └── anchor-demo/              # Expo SDK 57 + expo-router demo app
        ├── app.json              # dev-client config, plugins, scheme
        └── src/
            ├── app/              # routes: _layout, cockpit, permissions primer
            ├── components/       # StatusStrip · TapeGauge ×6 · EventLog · bottom bar
            ├── constants/theme.ts # design tokens (panel colors, type roles)
            ├── hooks/            # voice-command matching, semantic search
            └── assets/           # fonts (IBM Plex Mono, Inter), images
```

The SDK is a **no-build TypeScript package** — consumers (and Metro) consume `src/` directly, so there is no compile step to fall out of sync.

## AnchorSDK interface

```ts
import { createAnchorSDK } from "anchor-sdk";

const anchor = createAnchorSDK();

// Safety path — pure, synchronous, deterministic.
const verdict: Verdict = anchor.evaluate(sensorWindow, previousState);

// Advisory path — async, lazy-loaded, fully on-device (ExecuTorch / XNNPACK).
const explanation = await anchor.explain(verdict);   // "Fix denied: position jumped 1.2 km in one second."
const transcript  = await anchor.transcribe(pcmF32); // Float32Array, 16 kHz mono → "simulate spoof"
const vector      = await anchor.embed("signal looked synthetic"); // number[] for cosine search
```

### Method reference

| Method | Signature | Engine | Notes |
| --- | --- | --- | --- |
| `evaluate` | `(window: SensorWindow, prevState?: IntegrityState) => Verdict` | six pure checks + weighted RAIM/FDE state machine | synchronous, no I/O; same window + previous state → same verdict |
| `explain` | `(verdict: Verdict) => Promise<string>` | Llama-3.2-1B quantized (ExecuTorch, XNNPACK) | 1–2 plain sentences; type-level guarantee it never touches state |
| `transcribe` | `(audio: Float32Array) => Promise<string>` | whisper-base.en (ExecuTorch, XNNPACK) | 16 kHz mono PCM; powers the fixed voice-command set |
| `embed` | `(text: string) => Promise<number[]>` | multi-qa-mpnet-base-v2 (ExecuTorch, XNNPACK) | powers semantic event-log search |

All three AI calls lazy-load their model on first invocation; the safety path pays nothing for AI.

### Exports

- `createAnchorSDK(): AnchorSDK` — factory wiring native module, checks, state machine, and AI loaders
- **Sensor hooks:** `useLocationStream` (expo-location @ 1 Hz) · `useImuStream` (magnetometer + gyroscope complementary heading) · `useBarometerStream` · `useGnssMeasurements` (per-satellite C/N0 via the Kotlin `AnchorGnss` module, ring buffer)
- `AnchorProvider` — React context publishing the latest `Verdict`
- **Types:** `IntegrityState`, `CheckId`, `CheckResult`, `Fix`, `ImuSample`, `BaroSample`, `SatelliteMeasurement`, `GnssMeasurementSample`, `SensorWindow`, `Verdict`

## Roadmap

- [x] MVP pipeline: sensors → six checks → RAIM/FDE state machine, XNNPACK CPU AI
- [x] Avionics demo app: tapes, strip, event log, voice, semantic search
- [ ] **NPU delegation (stretch):** Qualcomm QNN / Hexagon delegation for the AI stack. Requires building ExecuTorch **from source** with `EXECUTORCH_BUILD_QNN=ON` on a machine with the full Android NDK toolchain. Explicitly out of MVP scope — the shipped runtime is the XNNPACK CPU prebuilt AAR.

## License

Package manifests declare MIT (see `packages/*/LICENSE`, `apps/*/LICENSE`). A root-level `LICENSE` file: TBD.
