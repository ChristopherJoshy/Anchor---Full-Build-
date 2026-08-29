import { NativeModule, requireNativeModule } from 'expo';

/**
 * JS contract mirror of the payloads emitted by the AnchorGnss native module
 * (android/src/main/java/expo/modules/anchorsdk/AnchorGnssModule.kt).
 */
export interface AnchorGnssSatellite {
  svid: number;
  constellation: 'gps' | 'glonass' | 'beidou' | 'galileo' | 'qzss' | 'irnss' | 'unknown';
  cn0DbHz: number;
}

export interface AnchorGnssMeasurementEvent {
  satellites: AnchorGnssSatellite[];
  timestamp: number;
  elapsedRealtimeNanos?: number;
}

export type AnchorGnssErrorEvent = {
  code: 'E_PERMISSION' | 'E_LOCATION_DISABLED' | 'E_UNSUPPORTED' | 'E_REGISTRATION_FAILED' | 'E_GNSS_STATUS';
  message: string;
};

export type AnchorGnssStatus =
  | 'ready'
  | 'stopped'
  | 'notSupported'
  | 'locationDisabled'
  | 'notAllowed'
  | 'unknown';

export interface AnchorGnssStatusEvent {
  status: AnchorGnssStatus;
}

type AnchorGnssModuleEvents = {
  onMeasurement: (event: AnchorGnssMeasurementEvent) => void;
  onError: (event: AnchorGnssErrorEvent) => void;
  onStatus: (event: AnchorGnssStatusEvent) => void;
};

declare class AnchorGnssNativeModule extends NativeModule<AnchorGnssModuleEvents> {
  /** Begins streaming C/N0 measurements. Idempotent; requires ACCESS_FINE_LOCATION already granted. */
  start(): Promise<void>;
  /** Stops streaming and unregisters the measurement callback. */
  stop(): Promise<void>;
  /** True when the device runs Android 7.0 (API 24)+ and exposes a LocationManager. */
  isSupported(): boolean;
}

/**
 * Raw GNSS C/N0 measurement stream. Android-only (see expo-module.config.json);
 * on other platforms requireNativeModule throws because the module is absent.
 */
export default requireNativeModule<AnchorGnssNativeModule>('AnchorGnss');
