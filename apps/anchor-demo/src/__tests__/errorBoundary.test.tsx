/**
 * RootErrorBoundary — a child render exception must surface the INTEGRITY
 * FAULT panel (error + component stack on-screen), never a blank tree.
 */
import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { RootErrorBoundary } from '../components/RootErrorBoundary';

function Bomb({ message }: { message: string }): null {
  throw new Error(message);
}

describe('root error boundary', () => {
  it('renders the INTEGRITY FAULT panel with the error when a child throws', () => {
    // React logs the caught error internally; silence the noise.
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <RootErrorBoundary>
        <Bomb message="rendezvous with disaster" />
      </RootErrorBoundary>,
    );

    expect(screen.getByText('INTEGRITY FAULT')).toBeTruthy();
    expect(screen.getByText(/The instrument crashed/)).toBeTruthy();
    expect(screen.getByText(/rendezvous with disaster/)).toBeTruthy();

    errorSpy.mockRestore();
  });

  it('renders children untouched when nothing throws', () => {
    render(
      <RootErrorBoundary>
        <Text>ALL SYSTEMS NOMINAL</Text>
      </RootErrorBoundary>,
    );

    expect(screen.getByText('ALL SYSTEMS NOMINAL')).toBeTruthy();
  });
});
