import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import App from '@/App';

// Uji asap Task 1: cangkang merender chrome testnet (brief §7.1) dan router hash memetakan rute.
afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('App shell', () => {
  it('renders the Arbitrum Sepolia chrome on the overview route', () => {
    render(<App />);
    expect(screen.getAllByText(/Arbitrum Sepolia/).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/options edge/i);
    // Tidak ada angka on-chain yang dipalsukan: metrik menunggu snapshot.
    expect(screen.getAllByText('Awaiting snapshot').length).toBeGreaterThanOrEqual(4);
  });

  it('routes by hash: #/boards shows the Boards placeholder without data', () => {
    window.location.hash = '#/boards';
    render(<App />);
    expect(screen.getByRole('heading', { level: 2, name: /Boards & series/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Boards/, current: 'page' })).toHaveAttribute('href', '#/boards');
  });

  it('falls back to "Not found" for unknown hashes', () => {
    window.location.hash = '#/nope';
    render(<App />);
    expect(screen.getByText(/Not found/)).toBeInTheDocument();
  });
});
