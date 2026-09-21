import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Client } from '@chain/chain/client';
import App from '@/App';

// Uji asap: cangkang merender chrome testnet (brief §7.1), router hash memetakan rute, dan ChainProvider yang di-mount memakai client stub
// yang menolak setiap pembacaan — tidak ada jaringan; jalur "RPC error on first load — retrying" terlihat ujung-ke-ujung tanpa angka palsu.
const offline = { getBlock: () => Promise.reject(new Error('offline (test stub)')) } as unknown as Client;

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('App shell', () => {
  it('renders the Arbitrum Sepolia chrome on the overview route, then the first-load RPC error without fabricating numbers', async () => {
    render(<App client={offline} />);
    expect(screen.getAllByText(/Arbitrum Sepolia/).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/options edge/i);
    // Tidak ada angka on-chain yang dipalsukan: metrik menunggu snapshot.
    expect(screen.getAllByText('Awaiting snapshot').length).toBeGreaterThanOrEqual(4);
    // Client stub menolak getBlock → provider mencatat error tanpa snapshot → banner retry (Layout) + label alasan di metrik (Overview).
    expect(await screen.findByText('RPC error on first load — retrying')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('offline (test stub)');
    expect(screen.getByRole('button', { name: /Retry now/ })).toBeInTheDocument();
    expect(screen.getAllByText('RPC error — retrying').length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText('Awaiting snapshot')).toBeNull();
    for (const el of Array.from(document.querySelectorAll('.metric-card__value'))) expect(el.textContent).not.toMatch(/\d/);
  });

  it('routes by hash: #/boards shows the Boards placeholder without data', () => {
    window.location.hash = '#/boards';
    render(<App client={offline} />);
    expect(screen.getByRole('heading', { level: 2, name: /Boards & series/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Boards/, current: 'page' })).toHaveAttribute('href', '#/boards');
  });

  it('falls back to "Not found" for unknown hashes', () => {
    window.location.hash = '#/nope';
    render(<App client={offline} />);
    expect(screen.getByText(/Not found/)).toBeInTheDocument();
  });
});
