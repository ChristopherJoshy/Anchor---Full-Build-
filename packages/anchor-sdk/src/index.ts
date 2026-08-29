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

// Network-integrity signals (real OS-level VPN detection).
export { default as AnchorNet } from './gnss/AnchorNetModule';

// Sensor hooks and their pure helpers.
export { useLocationStream } from './sensors/useLocationStream';
export { locationToFix } from './sensors/fixMapping';
export { useImuStream } from './sensors/useImuStream';
export { magnetometerHeadingDeg, wrapAngleDelta } from './sensors/headingMath';
export { useBarometerStream } from './sensors/useBarometerStream';
export { useGnssMeasurements } from './sensors/useGnssMeasurements';

// Physics checks and supporting formulas.
export { kinematicCheck } from './physics/kinematicCheck';
export { headingCheck } from './physics/headingCheck';
export { temporalCheck } from './physics/temporalCheck';
export { altitudeCheck, barometricAltitudeMeters, BARO_REFERENCE_PRESSURE_HPA } from './physics/altitudeCheck';
export { environmentalCheck } from './physics/environmentalCheck';
export { cn0Check } from './physics/cn0Check';
export { solarCompassHeading } from './physics/solarCompass';
export { haversineMeters, forwardBearingDeg, circularDiffDeg, clamp01 } from './physics/geo';

// Safety state machine (deterministic, pure).
export {
  evaluateIntegrity,
  stepIntegrity,
  confidenceOf,
  RECOVERY_DEBOUNCE,
  type IntegrityMachine,
  type EvaluateResult,
} from './evaluateIntegrity';

// Public SDK (state machine owner + lazy AI that can never touch state).
export { createAnchorSDK } from './ai/createAnchorSDK';
export { AnchorProvider, type AnchorProviderProps } from './ai/AnchorProvider';
export { explainVerdict, buildExplanationPrompt } from './ai/explainVerdict';
export { transcribeCommand } from './ai/transcribeCommand';
export { embedText } from './ai/embedText';

// Shared contract types.
export type {
  AnchorSDK,
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
