/**
 * Font-gate resilience — regression tests for the blank-screen class.
 * The layout must NEVER render null permanently: a font load failure or a
 * >10 s hang must still produce visible content.
 *
 * mockFontState is hoisted-safe name so the jest.mock factory may reference it.
 */
import { act, render } from '@testing-library/react-native';


export const mockFontState: { loaded: boolean; error: Error | null } = {
  loaded: true,
  error: null,
};

jest.mock('expo-font', () => ({
  useFonts: () => [mockFontState.loaded, mockFontState.error ?? undefined],
}));

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(async () => undefined),
  hideAsync: jest.fn(async () => undefined),
}));

jest.mock('anchor-sdk', () => ({
  AnchorProvider: ({ children }: { children?: unknown }) => children ?? null,
}));

// The real expo-router Stack resolves routes; the stub renders a marker so the
// mounted-content assertion observes the layout's own output.
jest.mock('expo-router', () => {
  const ReactShim = require('react');
  const MarkerText = (props: Record<string, unknown>) =>
    ReactShim.createElement(
      require('react-native').Text,
      { testID: 'router-stack-marker' },
      props.children,
    );
  return {
    Stack: Object.assign(MarkerText, { Screen: () => null }),
  };
});

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

import RootLayout from '../app/_layout';

describe('root layout font gate', () => {
  it('renders content even when font loading FAILS (regression: null-render blank screen)', () => {
    mockFontState.loaded = false;
    mockFontState.error = new Error('font failed');

    const { toJSON, queryByTestId } = render(<RootLayout />);

    // The tree must mount real content (provider + router stack), not null.
    expect(queryByTestId('router-stack-marker')).not.toBeNull();
    expect(toJSON()).not.toBeNull();

    mockFontState.loaded = true;
    mockFontState.error = null;
  });

  it('renders content when fonts hang and the 10 s timeout fires', () => {
    jest.useFakeTimers();
    mockFontState.loaded = false;
    mockFontState.error = null;

    const { queryByTestId } = render(<RootLayout />);

    // Advance past the 10 s gate; the timeout flips the gate inside act().
    act(() => {
      jest.advanceTimersByTime(10_500);
    });
    expect(queryByTestId('router-stack-marker')).not.toBeNull();

    mockFontState.loaded = true;
    mockFontState.error = null;
    jest.useRealTimers();
  });
});
