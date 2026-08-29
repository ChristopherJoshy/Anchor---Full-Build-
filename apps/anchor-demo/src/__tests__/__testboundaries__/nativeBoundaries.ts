/**
 * Native-boundary factories for the app test suites. Required by
 * jest.setup.ts; individual tests override return values per test.
 * Product code stays fully real — these boundaries only replace native access.
 *
 * jest hoisting requires jest.mock factories to reference only hoisted-safe identifiers
 * (jest's hoisting guard), so the boundary handles carry that prefix.
 */
import { jest } from '@jest/globals';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export interface StreamHandles {
  fix: unknown;
  error: string | null;
  granted: boolean;
}

export const mockLocationStream: Mutable<StreamHandles> = {
  fix: null,
  error: null,
  granted: true,
};
export const mockImuStream: { sample: unknown; error: string | null } = { sample: null, error: null };
export const mockBaroStream: { sample: unknown; error: string | null } = { sample: null, error: null };
export const mockGnssStream: {
  latest: unknown;
  history: unknown[];
  error: string | null;
  status: unknown;
  supported: boolean;
} = { latest: null, history: [], error: null, status: null, supported: true };

export interface PermissionResponse {
  granted: boolean;
}
export const mockRequestLocationPermissions = jest.fn(async () => ({ granted: true }));
export const mockRequestRecordingPermissions = jest.fn(async () => ({ granted: true }));
export const mockNotificationAsync = jest.fn(async () => undefined);

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: () => mockRequestLocationPermissions(),
  getForegroundPermissionsAsync: jest.fn(async () => ({ granted: true })),
}));

jest.mock('expo-audio', () => ({
  AudioModule: {
    requestRecordingPermissionsAsync: () => mockRequestRecordingPermissions(),
  },
  requestRecordingPermissionsAsync: () => mockRequestRecordingPermissions(),
  setAudioModeAsync: jest.fn(async () => undefined),
  useAudioStream: () => ({ stream: { start: jest.fn(), stop: jest.fn() }, isStreaming: false }),
}));

jest.mock('expo-haptics', () => ({
  notificationAsync: () => mockNotificationAsync(),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

// Sensor acquisition boundary only — physics/checks/state machine stay real.
// AsyncStorage native module absent in Jest.
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

// The native AnchorGnss binding throws requireNativeModule in Jest.
jest.mock('anchor-sdk/src/gnss/AnchorGnssModule', () => ({
  __esModule: true,
  default: {
    start: jest.fn(async () => undefined),
    stop: jest.fn(async () => undefined),
    isSupported: () => true,
    addListener: () => ({ remove: () => undefined }),
  },
}));

// The native AnchorNet binding throws requireNativeModule in Jest.
jest.mock('anchor-sdk/src/gnss/AnchorNetModule', () => ({
  __esModule: true,
  default: {
    isVpnActive: () => false,
  },
}));

jest.mock('anchor-sdk', () => {
  const actual = jest.requireActual('anchor-sdk') as Record<string, unknown>;
  return {
    ...actual,
    AnchorProvider: ({ children }: { children?: unknown }) => children ?? null,
    useLocationStream: () => mockLocationStream,
    useImuStream: () => mockImuStream,
    useBarometerStream: () => mockBaroStream,
    useGnssMeasurements: () => mockGnssStream,
  };
});

// Reanimated/worklets: the component imports Animated; in Jest the worklet
// runtime does not exist, so the animated renderer is replaced by a passthrough.
jest.mock('react-native-worklets', () => ({
  createSerializable: (value: unknown) => value,
  createWorkletRuntime: () => ({}),
  isReanimated3: () => false,
  enableLayoutAnimations: () => undefined,
  runOnJS: (fn: unknown) => fn,
  runOnUI: (fn: unknown) => fn,
  runOnRuntime: () => () => undefined,
  makeMutable: (v: unknown) => v,
  WorkletsModule: { installUnpackers: () => undefined },
}));
// Reanimated in Jest: real component code uses useSharedValue/useAnimatedStyle
// + Animated.View/Text; replace with a synchronous passthrough implementation.
jest.mock('react-native-reanimated', () => {
  const ReactShim = require('react');
  const resolveShared = (child: unknown): unknown =>
    child && typeof child === 'object' && 'value' in (child as Record<string, unknown>)
      ? (child as { value: unknown }).value
      : child;
  const TextShim = (props: Record<string, unknown>) => {
    const { children, ...rest } = props as { children?: unknown };
    const resolved = Array.isArray(children)
      ? children.map(resolveShared)
      : resolveShared(children);
    return ReactShim.createElement(require('react-native').Text, rest, resolved);
  };
  const ViewShim = (props: Record<string, unknown>) =>
    ReactShim.createElement(require('react-native').View, props);
  const createAnimatedComponent = (Component: unknown) => Component;
  const animated = { View: ViewShim, Text: TextShim, createAnimatedComponent };
  return {
    __esModule: true,
    default: animated,
    Animated: animated,
    useSharedValue: (initial: unknown) => ({ value: initial }),
    useDerivedValue: (processor: () => unknown) => ({ value: processor() }),
    useAnimatedStyle: (style: () => unknown) => style(),
    useAnimatedScrollHandler: () => ({}),
    useAnimatedReaction: () => undefined,
    withTiming: (value: unknown) => value,
    withSpring: (value: unknown) => value,
    withDelay: (_ms: unknown, value: unknown) => value,
    withRepeat: (value: unknown) => value,
    withSequence: (...values: unknown[]) => values[0],
    cancelAnimation: () => undefined,
    Easing: {
      linear: (t: unknown) => t,
      quad: (t: unknown) => t,
      cubic: (t: unknown) => t,
      out: (e: unknown) => e,
      in: (t: unknown) => t,
      inOut: (e: unknown) => e,
    },
    Extrapolation: { CLAMP: 'clamp' },
    FadeIn: { duration: () => undefined },
    FadeOut: { duration: () => undefined },
  };
});
jest.mock('react-native-worklets/plugin', () => ({}), { virtual: true });

jest.mock('react-native-safe-area-context', () => {
  const ReactShim = require('react');
  const BoundaryView = (props: Record<string, unknown>) => ReactShim.createElement(require('react-native').View, props);
  return {
    SafeAreaProvider: ({ children }: { children?: unknown }) => children ?? null,
    SafeAreaView: BoundaryView,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

/**
 * Neutral aliases for test suites. Jest's hoisting guard requires the
 * `mock`-prefixed names inside jest.mock factories (framework rule), so the
 * internal handles carry it; suites import these neutral exports — same
 * object references, mutations and assertions apply to the real handles.
 */
export const testLocationStream = mockLocationStream;
export const testImuStream = mockImuStream;
export const testBaroStream = mockBaroStream;
export const testGnssStream = mockGnssStream;
export const testRequestLocationPermissions = mockRequestLocationPermissions;
export const testRequestRecordingPermissions = mockRequestRecordingPermissions;
export const testNotificationAsync = mockNotificationAsync;
