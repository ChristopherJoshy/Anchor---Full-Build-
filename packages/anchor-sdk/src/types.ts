/**
 * Anchor SDK shared contract.
 *
 * These types are the integration contract between anchor-sdk and consumers
 * (apps/anchor-demo). They must not change shape without a coordinated update
 * on both sides.
 */

export type IntegrityState = 'TRUSTED' | 'DEGRADED' | 'DENIED' | 'RECOVERING';

export type CheckId = 'kinematic' | 'heading' | 'temporal' | 'altitude' | 'environmental' | 'cn0';

/** Result of one physics consistency check. `score` is 0..1, 1 = fully consistent. */
export interface CheckResult {
  id: CheckId;
  passed: boolean;
  score: number;
  detail: string;
}

/** One GNSS position fix, epoch milliseconds. */
export interface Fix {
  latitude: number;
  longitude: number;
  altitude: number;
  accuracy: number;
  speed: number;
  bearing: number;
  timestamp: number;
}

/** One fused inertial sample. `headingDeg` is magnetic heading (portrait convention, 0-360). */
export interface ImuSample {
  headingDeg: number | null;
  gyroRadSec: { x: number; y: number; z: number } | null;
  timestamp: number;
}

/** One barometric reading. */
export interface BaroSample {
  pressureHpa: number;
  timestamp: number;
}

/** One satellite's signal strength within a measurement epoch. */
export interface SatelliteMeasurement {
  svid: number;
  constellation: string;
  cn0DbHz: number | null;
}

/** One raw GNSS measurement epoch (all satellites seen at that instant). */
export interface GnssMeasurementSample {
  satellites: SatelliteMeasurement[];
  timestamp: number;
  elapsedRealtimeNanos?: number;
}

/** A chronological slice of every sensor stream the pipeline consumes. */
export interface SensorWindow {
  fixes: Fix[];
  imu: ImuSample[];
  baro: BaroSample[];
  gnss: GnssMeasurementSample[];
}

/** The output of the deterministic integrity evaluation over a SensorWindow. */
export interface Verdict {
  state: IntegrityState;
  failedChecks: CheckId[];
  results: CheckResult[];
  reason: string;
  confidence: number;
  timestamp: number;
}

/**
 * The public SDK surface. The AI methods can only read the verdict they are
 * given — the type has no path back into the state machine, so explanations
 * can never mutate integrity state.
 */
export interface AnchorSDK {
  evaluate(window: SensorWindow, prevState?: IntegrityState): Verdict;
  explain(verdict: Verdict): Promise<string>;
  /** 16 kHz mono PCM waveform. */
  transcribe(audio: Float32Array): Promise<string>;
  embed(text: string): Promise<number[]>;
}
