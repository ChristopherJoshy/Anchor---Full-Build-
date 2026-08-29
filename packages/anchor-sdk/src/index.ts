/**
 * anchor-sdk — on-device GNSS integrity monitoring for Expo (Android).
 *
 * Pipeline: Sensors -> Sensor Validation -> Fusion Estimator -> Integrity
 * Evaluation (six physics checks) -> Spoof/Anomaly Engine -> Safety State
 * Machine -> consumer. AI (ExecuTorch) explains verdicts in plain language and
 * never touches state.
 */

// Raw GNSS C/N0 measurement stream (native module binding).
export {
  default as AnchorGnss,
  type AnchorGnssSatellite,
  type AnchorGnssMeasurementEvent,
  type AnchorGnssErrorEvent,
  type AnchorGnssStatus,
  type AnchorGnssStatusEvent,
} from './gnss/AnchorGnssModule';

// Sensor hooks.
export { useLocationStream, locationToFix } from './sensors/useLocationStream';
export { useImuStream, magnetometerHeadingDeg } from './sensors/useImuStream';
export { useBarometerStream } from './sensors/useBarometerStream';
export { useGnssMeasurements } from './sensors/useGnssMeasurements';

// Shared contract types.
export type {
  IntegrityState,
  CheckId,
  CheckResult,
  Fix,
  ImuSample,
  BaroSample,
  SatelliteMeasurement,
  GnssMeasurementSample,
  SensorWindow,
  Verdict,
} from './types';
