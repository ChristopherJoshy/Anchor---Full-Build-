/**
 * Dashboard component test with REAL SDK physics — only sensor acquisition is
 * stubbed. The pipeline consumes synthetic streams built from the SDK's own
 * fixtures (clean-drive.json / spoofed-jump.json); the seven checks (six
 * physics + network) and the RAIM/FDE state machine run their real code
 * through createAnchorSDK.
 */
import { act, render, screen, waitFor } from '@testing-library/react-native';

import DashboardScreen from '../app/dashboard';
import {
  testBaroStream,
  testGnssStream,
  testImuStream,
  testLocationStream,
} from './__testboundaries__/nativeBoundaries';

/* eslint-disable @typescript-eslint/no-require-imports */
const cleanFixture = require('../../../../packages/anchor-sdk/src/__tests__/fixtures/clean-drive.json') as Fixture;
const spoofedFixture = require('../../../../packages/anchor-sdk/src/__tests__/fixtures/spoofed-jump.json') as Fixture;

interface FixtureFix {
  latitude: number;
  longitude: number;
  altitude: number;
  accuracy: number;
  speed: number;
  bearing: number;
  timestamp: number;
}
interface Fixture {
  fixes: FixtureFix[];
  imu: unknown[];
  baro: unknown[];
  gnss: unknown[];
}

/** Points the stubbed sensor hooks at fixture frame `i` of `fixture`. */
function feed(fixture: Fixture, i: number): void {
  testLocationStream.fix = fixture.fixes[i];
  testImuStream.sample = fixture.imu[i * 8] ?? fixture.imu[fixture.imu.length - 1];
  testBaroStream.sample = fixture.baro[Math.min(i, fixture.baro.length - 1)];
  testGnssStream.latest = fixture.gnss[i];
}

const CHECK_LABELS = ['KINEMATIC', 'HEADING', 'TEMPORAL', 'ALTITUDE', 'ENVIRONMENTAL', 'CN0', 'NETWORK'];
/** Feeds the ENTIRE fixture: the spoofed-jump teleport lands at frame ~105,
 * so a partial walk never reaches the attack. */
const WALK_LENGTH = 120;

describe('dashboard with real SDK physics', () => {
  it(
    'walks the clean-drive fixture into TRUSTED with seven gauges and an event log',
    async () => {
      const { rerender } = render(<DashboardScreen />);

      for (let i = 0; i < WALK_LENGTH; i += 1) {
        feed(cleanFixture, i);
        // eslint-disable-next-line no-await-in-loop
        await act(async () => {
          rerender(<DashboardScreen />);
        });
      }

      await waitFor(
        () => {
          expect(screen.getAllByText('TRUSTED').length).toBeGreaterThan(0);
        },
        { timeout: 30_000 },
      );
      for (const label of CHECK_LABELS) {
        if (label === 'NETWORK') {
          expect(screen.getAllByText(label).length).toBeGreaterThan(0);
        } else {
          expect(screen.getByText(label)).toBeTruthy();
        }
      }
      expect(screen.getByText('EVENT LOG')).toBeTruthy();
    },
    60_000,
  );

  it(
    'shows DENIED when the stream switches to the spoofed-jump fixture',
    async () => {
      const { rerender } = render(<DashboardScreen />);

      for (let i = 0; i < WALK_LENGTH; i += 1) {
        feed(spoofedFixture, i);
        // eslint-disable-next-line no-await-in-loop
        await act(async () => {
          rerender(<DashboardScreen />);
        });
      }

      await waitFor(
        () => {
          expect(screen.getAllByText('DENIED').length).toBeGreaterThan(0);
        },
        { timeout: 30_000 },
      );
    },
    60_000,
  );
});
