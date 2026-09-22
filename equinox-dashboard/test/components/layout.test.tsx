// test/components/layout.test.tsx — cangkang hidup dari fixture ChainContext: chrome testnet (strip, callout, tag board/seri, footer build),
// status connecting | live | stale | RPC error (badge aria-live + kartu jaringan), banner RPC tiga state + tombol retry, tombol wallet
// (tanpa wallet / connect / alamat / switch chain). Tanpa provider, tanpa jaringan.
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL_SERIES, BOARDS, CHAIN_ID, POOLS, POOL_KEYS, explorerAddress } from '@chain/deployment';
import { shortAddr } from '@chain/ui/format';
import { Layout, assetSentence, calloutSentence } from '@/components/Layout';
import { bannerModel, hms, syncStatus } from '@/lib/sync';
import { renderWithChain } from '../render';
import { BLOCK, USER, chainState, liveSnapshot, withStale, withUser } from '../fixtures/snapshot';

afterEach(() => { cleanup(); window.location.hash = ''; });

const page = <Layout><p>page content</p></Layout>;
const strip = () => screen.getByTestId('testnet-strip').textContent!.replace(/\s+/g, ' ').trim();

describe('Layout — testnet chrome from the manifest', () => {
  it('renders the testnet strip, callout, nav tags and footer build stamp', () => {
    renderWithChain(page, { snapshot: liveSnapshot() });
    // Brief §7.1 — always visible, derived from POOLS[k].faucet (mock vs Paxos), chain id from the manifest.
    expect(strip()).toBe(`Arbitrum Sepolia · ${CHAIN_ID} · ${assetSentence()}`);
    const mock = POOL_KEYS.filter((k) => POOLS[k].faucet === 'mint').join('/'), paxos = POOL_KEYS.filter((k) => POOLS[k].faucet === 'paxos').join('/');
    if (mock) expect(assetSentence()).toContain(`mock USDG on ${mock}`);
    if (paxos) expect(assetSentence()).toContain(`Pool ${paxos} settles in Paxos USDG (testnet)`);
    expect(screen.getByText(calloutSentence())).toBeInTheDocument();
    expect(calloutSentence()).toMatch(/— testnet, no real money\.$/);
    // Six hash routes; the Boards tag counts boards/series from the manifest.
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['#/', '#/boards', '#/trade', '#/portfolio', '#/activity', '#/contracts']);
    expect(within(nav).getByText(`${BOARDS.length} / ${ALL_SERIES.length}`)).toHaveAttribute('title', `${BOARDS.length} boards · ${ALL_SERIES.length} series in the manifest`);
    // Footer: build commit + build time in UTC (vitest defines __COMMIT__ = "test", __BUILD_TIME__ = epoch) + GitHub link.
    const footer = screen.getByRole('contentinfo');
    expect(footer).toHaveTextContent('build test · 1970-01-01 00:00 UTC');
    expect(within(footer).getByRole('link', { name: /GitHub/ })).toHaveAttribute('href', 'https://github.com/nodesproof/equinox');
    expect(screen.getByText('page content')).toBeInTheDocument();
    expect(screen.getAllByText(/Arbitrum Sepolia/).length).toBeGreaterThanOrEqual(2);
  });
});

describe('Layout — sync status and RPC banner', () => {
  it('live: badge "live" (aria-live), snapshot age and block number; no banner', () => {
    const s = liveSnapshot();
    const { container } = renderWithChain(page, { snapshot: s, nowMs: s.fetchedAtMs + 12_000 });
    const badge = screen.getByText('live', { selector: 'b' });
    expect(badge).toHaveAttribute('aria-live', 'polite');
    expect(badge.parentElement).toHaveClass('sync-status--live');
    expect(badge.parentElement).toHaveTextContent(`snapshot 12 s ago · block ${BLOCK}`);
    expect(container.querySelector('.network-card')).toHaveClass('network-card--live');
    expect(container.querySelector('.network-card__status')).toHaveTextContent(`live · block ${BLOCK}`);
    expect(container.querySelector('.notice-banner')).toBeNull();
  });

  it('connecting: no snapshot and no error → "connecting", no banner, page still rendered', () => {
    const { container } = renderWithChain(page, { snapshot: null });
    expect(screen.getByText('connecting', { selector: 'b' })).toBeInTheDocument();
    expect(screen.getByText('waiting for the first snapshot')).toBeInTheDocument();
    expect(container.querySelector('.network-card')).toHaveClass('network-card--connecting');
    expect(container.querySelector('.notice-banner')).toBeNull();
    expect(screen.getByText('page content')).toBeInTheDocument();
  });

  it('stale + RPC error: badge "stale", banner "RPC unreachable — showing data fetched HH:MM:SS UTC", data kept, retry calls refreshNow', () => {
    const refreshNow = vi.fn();
    const { state, container } = renderWithChain(page, { snapshot: withStale(liveSnapshot()), refreshNow });
    expect(state.meta.stale).toBe(true);
    expect(syncStatus(state, state.meta.nowMs).kind).toBe('stale');
    expect(screen.getByText('stale', { selector: 'b' })).toBeInTheDocument();
    expect(container.querySelector('.network-card')).toHaveClass('network-card--stale');
    const banner = screen.getByRole('status', { name: '' });
    expect(banner).toHaveClass('notice-banner--warn');
    expect(within(banner).getByText(`RPC unreachable — showing data fetched ${hms(state.meta.lastOkMs!)}`)).toBeInTheDocument();
    expect(banner).toHaveTextContent(`block ${BLOCK} stays on screen`);
    expect(banner).toHaveTextContent(state.meta.error!);
    expect(screen.getByText('page content')).toBeInTheDocument();          // data kept — the page is not blanked
    fireEvent.click(within(banner).getByRole('button', { name: /Retry now/ }));
    expect(refreshNow).toHaveBeenCalledTimes(1);
  });

  it('stale without an error (hung refresh) still shows the badge and a "Snapshot is stale" banner', () => {
    const { state } = renderWithChain(page, chainState({ snapshot: withStale(liveSnapshot()), meta: { error: null } }));
    expect(state.meta.error).toBeNull();
    expect(screen.getByText('stale', { selector: 'b' })).toBeInTheDocument();
    expect(screen.getByText(`Snapshot is stale — last good data fetched ${hms(state.meta.lastOkMs!)}`)).toBeInTheDocument();
    expect(bannerModel(state, state.meta.nowMs)?.tone).toBe('warn');
  });

  it('first load failed: red banner "RPC error on first load — retrying" with the RPC message, badge "RPC error", retry calls refreshNow', () => {
    const refreshNow = vi.fn();
    const { container } = renderWithChain(page, { snapshot: null, meta: { error: 'HTTP request failed.' }, refreshNow });
    const banner = screen.getByRole('alert');
    expect(banner).toHaveClass('notice-banner--bad');
    expect(within(banner).getByText('RPC error on first load — retrying')).toBeInTheDocument();
    expect(banner).toHaveTextContent('HTTP request failed.');
    expect(screen.getByText('RPC error', { selector: 'b' })).toBeInTheDocument();
    expect(screen.getByText('no snapshot yet')).toBeInTheDocument();
    expect(container.querySelector('.network-card')).toHaveClass('network-card--failed');
    fireEvent.click(within(banner).getByRole('button', { name: /Retry now/ }));
    expect(refreshNow).toHaveBeenCalledTimes(1);
  });

  it('error right after a good snapshot (< 60 s): badge stays "live", banner already explains the RPC failure', () => {
    const s = liveSnapshot();
    const { state } = renderWithChain(page, { snapshot: s, nowMs: s.fetchedAtMs + 5_000, meta: { error: 'HTTP request failed.' } });
    expect(state.meta.stale).toBe(false);
    expect(screen.getByText('live', { selector: 'b' })).toBeInTheDocument();
    expect(screen.getByText(`RPC unreachable — showing data fetched ${hms(s.fetchedAtMs)}`)).toBeInTheDocument();
  });
});

describe('Layout — wallet button', () => {
  it('without an injected wallet: "Connect wallet" explains read-only and never calls connect()', () => {
    const connect = vi.fn(async () => {});
    renderWithChain(page, { snapshot: liveSnapshot(), hasWallet: false, connect });
    const btn = screen.getByRole('button', { name: /Connect wallet/ });
    expect(btn).toHaveAttribute('title', expect.stringMatching(/read-only/));
    fireEvent.click(btn);
    expect(connect).not.toHaveBeenCalled();
  });

  it('with a wallet and no account: "Connect wallet" calls connect(); busy disables it', () => {
    const connect = vi.fn(async () => {});
    renderWithChain(page, { snapshot: liveSnapshot(), hasWallet: true, account: null, connect });
    fireEvent.click(screen.getByRole('button', { name: /Connect wallet/ }));
    expect(connect).toHaveBeenCalledTimes(1);
    cleanup();
    renderWithChain(page, { snapshot: liveSnapshot(), hasWallet: true, account: null, busy: true, connect });
    expect(screen.getByRole('button', { name: /Connecting…/ })).toBeDisabled();
  });

  it('connected: the short address links to the explorer; wrong chain: "Switch to Arbitrum Sepolia" calls connect()', () => {
    renderWithChain(page, { snapshot: withUser(liveSnapshot()), hasWallet: true });
    const link = screen.getByRole('link', { name: new RegExp(shortAddr(USER)) });
    expect(link).toHaveAttribute('href', explorerAddress(USER));
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    cleanup();
    const connect = vi.fn(async () => {});
    renderWithChain(page, { snapshot: withUser(liveSnapshot()), hasWallet: true, wrongChain: true, connect });
    fireEvent.click(screen.getByRole('button', { name: /Switch to Arbitrum Sepolia/ }));
    expect(connect).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(shortAddr(USER))).toBeNull();
  });
});

describe('Layout — route change scroll', () => {
  it('scrolls to the top on a route change — smoothly, or instantly when the user prefers reduced motion (brief §8.4)', async () => {
    const scrollTo = vi.fn();
    const original = { scrollTo: window.scrollTo, matchMedia: window.matchMedia };
    Object.defineProperty(window, 'scrollTo', { configurable: true, writable: true, value: scrollTo });
    const prefersReduced = (on: boolean) => Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: (query: string) => ({
      matches: on && query.includes('prefers-reduced-motion: reduce'), media: query, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    }) });
    const go = (hash: string) => act(async () => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    try {
      prefersReduced(false);
      renderWithChain(page, { snapshot: liveSnapshot() });
      expect(scrollTo).not.toHaveBeenCalled();   // not on the first mount
      await go('#/boards');
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' });
      prefersReduced(true);
      await go('#/trade');
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'auto' });
    } finally {
      Object.defineProperty(window, 'scrollTo', { configurable: true, writable: true, value: original.scrollTo });
      Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: original.matchMedia });
    }
  });
});
