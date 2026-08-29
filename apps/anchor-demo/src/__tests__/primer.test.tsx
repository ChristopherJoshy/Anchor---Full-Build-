import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import {
  mockRequestLocationPermissions,
  mockRequestRecordingPermissions,
} from './__mocks__/nativeModules';
import PrimerScreen from '../app/index';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn() }),
}));

// AsyncStorage holds permission decisions; give it an empty in-memory store.
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
  },
}));

describe('permissions primer', () => {
  it('renders the Location and Microphone rows with plain-language reasons and a Continue button', async () => {
    render(<PrimerScreen />);

    expect(
      await screen.findByText('Location — reads GPS fixes to check them against physics'),
    ).toBeTruthy();
    expect(screen.getByText("Microphone — hears voice commands like 'simulate spoof'")).toBeTruthy();
    expect(screen.getByText('CONTINUE')).toBeTruthy();
    expect(screen.getByText('ANCHOR')).toBeTruthy();
    expect(screen.getByText('GNSS INTEGRITY MONITOR')).toBeTruthy();
    expect(screen.getByText('GPS')).toBeTruthy();
    expect(screen.getByText('MIC')).toBeTruthy();
  });

  it('fires the location request then the mic request when Continue is pressed', async () => {
    mockRequestLocationPermissions.mockResolvedValue({ granted: true });
    mockRequestRecordingPermissions.mockResolvedValue({ granted: true });

    render(<PrimerScreen />);
    fireEvent.press(await screen.findByText('CONTINUE'));

    await waitFor(() => {
      expect(mockRequestLocationPermissions).toHaveBeenCalledTimes(1);
      expect(mockRequestRecordingPermissions).toHaveBeenCalledTimes(1);
    });

    const locationOrder = mockRequestLocationPermissions.mock.invocationCallOrder[0];
    const micOrder = mockRequestRecordingPermissions.mock.invocationCallOrder[0];
    expect(locationOrder).toBeLessThan(micOrder);
  });
});
