# anchor-sdk

**On-device GNSS integrity monitoring for Expo (Android).**

Anchor watches your phone's raw GNSS signals and sensor streams, runs six physics
consistency checks over every sensor window, and reduces them to a single,
deterministic safety verdict — `TRUSTED`, `DEGRADED`, `DENIED` or `RECOVERING`.
On-device AI (ExecuTorch) explains the verdict in plain language. The AI can
never change the verdict: the type system gives it no path back into the state
machine.

```
Sensors → Sensor Validation → Fusion Estimator → Integrity Evaluation (6 physics checks)
       → Spoof/Anomaly Engine → Safety State Machine (deterministic RAIM/FDE) → consumer
                                                            ↑
                                     AI (ExecuTorch) explains verdicts only
```

## Install

```bash
npm install anchor-sdk
```

The package is an Expo module (autolinked). The app **must use
[expo-dev-client](https://docs.expo.dev/versions/latest/sdk/dev-client/) or a
bare workflow build** — the native `AnchorGnss` module is compiled by the EAS
cloud builder into your dev client / production build; it will not work inside
Expo Go.

Transitive dependencies installed with the SDK:

| Package | Purpose |
| --- | --- |
| `expo-location`, `expo-sensors` | fixes, magnetometer/gyroscope/barometer |
| `react-native-executorch` | on-device LLM / speech-to-text / embeddings (XNNPACK CPU) |
| `react-native-executorch-expo-resource-fetcher`, `expo-file-system`, `expo-asset` | model download |

Minimum OS: Android 13 (react-native-executorch requirement); raw GNSS
measurements need Android 7+ (API 24). New React Native architecture only.

## Quick start

```tsx
import { AnchorProvider, createAnchorSDK, useLocationStream, useImuStream, useBarometerStream, useGnssMeasurements } from 'anchor-sdk';

// 1. Mount the headless AI preloader near the app root (optional but recommended).
//    It renders nothing; it pre-warms the on-device models in the background.
<AnchorProvider>{/* your app */}</AnchorProvider>

// 2. Create the SDK once (it owns the safety state machine).
const anchor = createAnchorSDK();

// 3. Stream sensors and evaluate.
const { fix } = useLocationStream();      // { fix, error, granted }
const { sample: imu } = useImuStream();   // { sample, error }
const { sample: baro } = useBarometerStream();
const { history: gnss } = useGnssMeasurements(30);

// On each fix, push the newest samples into rolling buffers and evaluate:
const verdict = anchor.evaluate({ fixes, imu: imuSamples, baro: baroSamples, gnss });

console.log(verdict.state, verdict.reason, verdict.confidence);

// 4. Explain the verdict on demand (never mutates state):
const sentence = await anchor.explain(verdict);
```

Permissions are **not** requested by the SDK. The app must obtain
`ACCESS_FINE_LOCATION` before mounting the hooks; sensor hooks report `error`
and stop cleanly when it is missing.

## Architecture

### Safety state machine (deterministic, pure)

`evaluateIntegrity(window, prevState)` and `stepIntegrity(window, machine)` are
pure functions over the sensor window. Six physics checks run per evaluation;
transitions:

| Situation | Resulting state |
| --- | --- |
| All six checks pass | `TRUSTED` |
| Exactly one non-critical check fails | `DEGRADED` |
| ≥ 2 checks fail, or the critical pair **kinematic+cn0** / **kinematic+heading** fails | `DENIED` |
| `DENIED`, failing evaluation (any) | stays `DENIED` (debounce resets — never relax on a failure) |
| `DENIED`, after `RECOVERY_DEBOUNCE` (5) consecutive clean evaluations | `RECOVERING` |
| `RECOVERING`, next clean evaluation | `TRUSTED` |
| `RECOVERING`, failing evaluation | `DENIED` (regression, debounce restarts) |

`createAnchorSDK().evaluate()` owns the debounce counter internally; the
optional `prevState` argument seeds the first call only.

`confidence` is the weighted sum of check scores: kinematic 0.25, cn0 0.25,
heading 0.15, environmental 0.15, temporal 0.10, altitude 0.10.

### Physics checks and thresholds

All checks are pure, synchronous, and documented in their source files.

| Check | Signal | Fails when | Notes |
| --- | --- | --- | --- |
| `kinematicCheck` | consecutive fixes vs reported speed | \|implied − reported\| > (accuracy₁+accuracy₂)/dt + 2 m/s, or implied speed > 200 m/s (teleport) | dt ≤ 0 pairs skipped (temporal's domain) |
| `headingCheck` | GPS track bearing, fused magnetic heading, solar azimuth | max pairwise circular disagreement > 60° while moving (mean speed > 1.5 m/s, track ≥ 20 m) | solar source only when sun elevation > 5°; magnetic declination absorbed by threshold |
| `temporalCheck` | fix timestamps | duplicated/backwards timestamps, gaps > 300 s, or ≥ 10 intervals with stddev < 1 ms (quantized replay) | |
| `altitudeCheck` | GPS altitude delta vs barometric delta | divergence > 50 m (score falls linearly to 0 at 100 m) | barometric altitude via 44330·(1−(p/1013.25)^0.1903); no barometer → pass with note |
| `environmentalCheck` | per-fix plausibility | altitude outside [−450, 9000] m, speed outside [0, 320] m/s, accuracy > 100 m, invalid position (incl. null island 0,0) | |
| `cn0Check` | per-satellite C/N0 over epochs | lockstep: residual-variance ratio < 0.2 or mean pairwise \|corr\| > 0.9 | needs ≥ 4 common satellites, ≥ 5 epochs per run; runs split on gaps > 3 s and frozen clocks; flat signals (var < 1 dB²) are skipped, not flagged |

### AI wrappers (ExecuTorch, on-device)

Models come from Software Mansion's HuggingFace zoo (`.pte` files downloaded at
runtime by the library — never bundled):

| Task | Model | API |
| --- | --- | --- |
| `explain(verdict) → Promise<string>` | Llama 3.2 1B (quantized) | deterministic prompt template; stateless generation; 1–2 sentence plain-language explanation |
| `transcribe(Float32Array) → Promise<string>` | Whisper base.en | 16 kHz mono PCM in, transcript text out |
| `embed(text) → Promise<number[]>` | all-mpnet-base-v2 | pooled 768-d vector |

Guarantees:

- **No model loads at startup.** Models load lazily on first use; `AnchorProvider`
  pre-warms them in the background (same shared instances).
- **AI never touches state.** `AnchorSDK` exposes no mutation path —
  `explain` strictly maps `Verdict → Promise<string>`.
- Deviations from the original model plan: the embedding model shipped by the
  registry is `all_mpnet_base_v2` (`multi-qa-mpnet-base-v2` is not in the
  zoo); Llama 3.2 1B uses the registry's default quantized variant.

## API reference

### `createAnchorSDK(): AnchorSDK`

```ts
interface AnchorSDK {
  evaluate(window: SensorWindow, prevState?: IntegrityState): Verdict;
  explain(verdict: Verdict): Promise<string>;
  transcribe(audio: Float32Array): Promise<string>; // 16 kHz mono PCM
  embed(text: string): Promise<number[]>;
}
```

### Core types

```ts
type IntegrityState = 'TRUSTED' | 'DEGRADED' | 'DENIED' | 'RECOVERING';
type CheckId = 'kinematic' | 'heading' | 'temporal' | 'altitude' | 'environmental' | 'cn0';

interface CheckResult { id: CheckId; passed: boolean; score: number; detail: string; }
interface Fix { latitude: number; longitude: number; altitude: number; accuracy: number; speed: number; bearing: number; timestamp: number; }
interface ImuSample { headingDeg: number | null; gyroRadSec: { x: number; y: number; z: number } | null; timestamp: number; }
interface BaroSample { pressureHpa: number; timestamp: number; }
interface SatelliteMeasurement { svid: number; constellation: string; cn0DbHz: number | null; }
interface GnssMeasurementSample { satellites: SatelliteMeasurement[]; timestamp: number; elapsedRealtimeNanos?: number; }
interface SensorWindow { fixes: Fix[]; imu: ImuSample[]; baro: BaroSample[]; gnss: GnssMeasurementSample[]; } // chronological
interface Verdict { state: IntegrityState; failedChecks: CheckId[]; results: CheckResult[]; reason: string; confidence: number; timestamp: number; }
```

### Sensor hooks

| Hook | Returns | Rate |
| --- | --- | --- |
| `useLocationStream()` | `{ fix: Fix \| null, error: string \| null, granted: boolean }` | 1 Hz, Balanced accuracy |
| `useImuStream()` | `{ sample: ImuSample \| null, error: string \| null }` | ~10 Hz per sensor; complementary filter fuses gyro integration with magnetometer heading (`atan2(-mx, my)`, portrait, near-flat) |
| `useBarometerStream()` | `{ sample: BaroSample \| null, error: string \| null }` | ~10 Hz |
| `useGnssMeasurements(historyLength = 600)` | `{ latest, history, error, status, supported }` | 1 Hz measurement epochs; last N epochs kept in a ring buffer |

Nullability policy for `Fix` fields (expo-location may report null): altitude →
0, accuracy → `+Infinity`, speed → 0, bearing → 0. Unknown accuracy never
artificially passes the kinematic envelope; the environmental gate fails it.

### AnchorGnss native module (raw C/N0)

`useGnssMeasurements` wraps the native `AnchorGnss` module (Expo Modules API,
`expo.modules.anchorsdk.AnchorGnssModule`), which exposes:

- `start(): Promise<void>` — idempotent; registers a `GnssMeasurementsEvent.Callback`
  (Executor overload on API 31+, main-looper registration below). Requires
  `ACCESS_FINE_LOCATION` already granted: missing permission, disabled GPS and
  unsupported devices reject with `E_PERMISSION` / `E_LOCATION_DISABLED` /
  `E_UNSUPPORTED` **and** emit an `onError` event.
- `stop(): Promise<void>` — unregisters the callback.
- `isSupported(): boolean` — Android 7+ with a `LocationManager`.
- Events:
  - `onMeasurement` — `{ satellites: [{ svid, constellation, cn0DbHz }], timestamp, elapsedRealtimeNanos? }`;
    every measurement with C/N0 > 0; constellations map to
    `gps | glonass | beidou | galileo | qzss | irnss | unknown` (SBAS → `unknown`).
    `timestamp` is epoch ms derived from the event's boot-clock nanos (API 29+;
    wall clock otherwise — `elapsedRealtimeNanos` is only present from API 29).
  - `onError` — `{ code, message }`.
  - `onStatus` — `{ status: 'ready' | 'stopped' | 'notSupported' | 'locationDisabled' | 'notAllowed' }`.
    Note: on API 31+ the platform fires `onStatusChanged` once with
    `STATUS_READY` regardless of real conditions, so `start()` performs
    explicit permission/location checks upfront instead of relying on it. On
    API 24–30 `onStatus` forwards the genuine subsystem status.

### Also exported

`evaluateIntegrity`, `stepIntegrity`, `confidenceOf`, `RECOVERY_DEBOUNCE`,
`kinematicCheck`, `headingCheck`, `temporalCheck`, `altitudeCheck`,
`environmentalCheck`, `cn0Check`, `solarCompassHeading(lat, lon, date)` (NOAA
solar azimuth/elevation), `barometricAltitudeMeters`, `haversineMeters`,
`forwardBearingDeg`, `circularDiffDeg`, `magnetometerHeadingDeg`,
`locationToFix`, `explainVerdict`, `buildExplanationPrompt`,
`transcribeCommand`, `embedText`, `RingBuffer`, and the `AnchorGnss` binding.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # jest (ts-jest, Node environment)
npm run lint        # eslint
node scripts/generate-fixtures.mjs   # regenerate the large fixtures deterministically
```

**Testing limits:** the AI wrappers depend on native ExecuTorch runtime and
cannot run in Node or on an emulator without the dev client — they are
verified by typecheck against the real `react-native-executorch@0.9.3` types,
by unit tests of the pure prompt builder, and on-device through the demo app.
The native `AnchorGnss` module compiles on EAS; measurement streaming itself
can only be exercised on hardware with a GNSS chipset.

## Autolinking notes

- The package is picked up via the workspace/`node_modules` symlink by Expo
  autolinking; `expo-module.config.json` declares the Android module class
  `expo.modules.anchorsdk.AnchorGnssModule`.
- Build with `expo-dev-client` / EAS build — not Expo Go.
- No iOS implementation is provided; the module config declares Android only.

## License

MIT
