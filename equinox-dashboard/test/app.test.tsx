import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Client } from '@chain/chain/client';
import { BOARDS, POOLS, POOL_KEYS } from '@chain/deployment';
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

  it('routes by hash: #/boards shows the Boards page as a skeleton without data', () => {
    window.location.hash = '#/boards';
    render(<App client={offline} />);
    expect(screen.getByRole('heading', { level: 2, name: /Boards & series/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Boards/, current: 'page' })).toHaveAttribute('href', '#/boards');
    // Satu panel kerangka per board manifest, tanpa baris seri dan tanpa kuotasi (tidak ada angka palsu).
    expect(document.querySelectorAll('article.board-panel')).toHaveLength(BOARDS.length);
    expect(document.querySelectorAll('tr.series-row')).toHaveLength(0);
    expect(screen.getAllByText('Awaiting snapshot').length).toBeGreaterThanOrEqual(BOARDS.length);
  });

  it('routes #/trade and #/portfolio to the live pages: read-only without an injected wallet, no account numbers', () => {
    window.location.hash = '#/trade';
    const { unmount } = render(<App client={offline} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Trade' })).toBeInTheDocument();
    expect(screen.getByTestId('trade-note')).toHaveAttribute('data-kind', 'no-wallet');
    expect(screen.getByRole('button', { name: /^Buy$/ })).toBeDisabled();
    unmount();
    window.location.hash = '#/portfolio';
    render(<App client={offline} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Portfolio' })).toBeInTheDocument();
    expect(screen.getByText('Connect a wallet to see your portfolio')).toBeInTheDocument();
    expect(document.querySelector('.balance-card')).toBeNull();
  });

  it('routes #/activity and #/contracts to the live pages: empty feed stated honestly, manifest addresses without any config number', async () => {
    window.location.hash = '#/activity';
    const { unmount } = render(<App client={offline} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Activity' })).toBeInTheDocument();
    expect(screen.getByText('No events loaded yet')).toBeInTheDocument();
    expect(document.querySelectorAll('.events-table tbody tr')).toHaveLength(0);
    expect(screen.getByText('≈ time needs a snapshot')).toBeInTheDocument();
    expect(screen.getByText('No Observed events loaded yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mine/ })).toBeNull();
    unmount();
    window.location.hash = '#/contracts';
    render(<App client={offline} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Contracts & protocol' })).toBeInTheDocument();
    for (const k of POOL_KEYS) expect(screen.getByText(POOLS[k].pool)).toBeInTheDocument();
    for (const td of Array.from(document.querySelectorAll('.config-table td:not(.muted-text)'))) expect(td.textContent).not.toMatch(/\d/);
    expect(await screen.findByText('RPC error on first load — retrying')).toBeInTheDocument();
    expect(screen.getAllByText('RPC error — retrying').length).toBeGreaterThanOrEqual(11);
    for (const td of Array.from(document.querySelectorAll('.config-table td:not(.muted-text)'))) expect(td.textContent).not.toMatch(/\d/);
  });

  it('falls back to "Not found" for unknown hashes', () => {
    window.location.hash = '#/nope';
    render(<App client={offline} />);
    expect(screen.getByText(/Not found/)).toBeInTheDocument();
  });
});
