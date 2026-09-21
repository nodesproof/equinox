// test/components/mobile.test.tsx — Task 6b (polesan mobile) lewat mock `matchMedia` (test/viewport.ts): ≤ 640 px tabel seri → daftar kartu
// (Boards penuh + Overview ringkas) dengan angka/status/paritas dari helper yang sama; header board expiry satu baris + pill pendek; label σ
// tidak dihurufbesarkan (Σ ≠ σ); laci navigasi ≤ 680 px (buka/tutup: X, backdrop, Escape, pindah rute; kunci gulir; fokus); tombol wallet
// ikon saja < 400 px / "Connect" ≤ 680 px; notice Trade; kartu event (Activity), kartu alamat + Copy dan daftar cfg() (Contracts).
// Tanpa matchMedia (test lain) semuanya tetap tampilan desktop — tabel, teks penuh.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL_SERIES, BOARDS, POOL_KEYS } from '@chain/deployment';
import { seriesLabel } from '@chain/chain/trade';
import { utc, wad } from '@chain/ui/format';
import Boards from '@/pages/Boards';
import Overview from '@/pages/Overview';
import Trade from '@/pages/Trade';
import Activity from '@/pages/Activity';
import Contracts from '@/pages/Contracts';
import { Layout } from '@/components/Layout';
import { atmWindow } from '@/components/BoardSummary';
import { keepSymbols } from '@/components/primitives';
import { boardViews, seriesViews } from '@/chain/selectors';
import { K0, boardPill, buyCell, deltaCell, parityCell, quoteCell, sharedStatus, sigmaCell, statusText } from '@/lib/boards';
import { CFG_FIELDS, addressRows, cfgRows } from '@/lib/contracts';
import { expiryLabel, refLabel } from '@/lib/format';
import { renderWithChain } from '../render';
import { liveParity, liveSnapshot, withSettled } from '../fixtures/snapshot';
import { liveEvents, liveTrades } from '../fixtures/events';
import { mockViewport, type Viewport } from '../viewport';

let viewport: Viewport | null = null;
const phone = (width = 375) => { viewport = mockViewport(width); return viewport; };
afterEach(() => { cleanup(); viewport?.restore(); viewport = null; window.location.hash = ''; document.body.style.overflow = ''; document.documentElement.style.overflow = ''; });

const cards = (root: ParentNode = document) => Array.from(root.querySelectorAll<HTMLElement>('.series-card'));
const card = (i: number) => document.querySelector<HTMLElement>(`.series-card[data-series="${i}"]`)!;

describe('Task 6b — series card list at ≤ 640 px (Boards)', () => {
  it('375 px: one card per series instead of the table, with the same quotes, Δ, parity, σ_buy, status and Trade link as the table cells', () => {
    phone(375);
    const s = liveSnapshot();
    renderWithChain(<Boards />, { snapshot: s });
    expect(document.querySelector('table.series-table')).toBeNull();
    const rows = seriesViews(s, liveParity(s));
    expect(cards()).toHaveLength(ALL_SERIES.length);
    for (const r of rows) {
      const c = card(r.i);
      expect(c).toHaveAttribute('data-status', r.status[K0]);
      // Short label (the board header already shows the date), C/P pill, status chip.
      expect(within(c).getByText(refLabel(r.ref))).toHaveClass('series-card__label');
      expect(within(c).getByText(r.ref.isCall ? 'C' : 'P')).toHaveClass(`option-pill--${r.ref.isCall ? 'c' : 'p'}`);
      expect(within(within(c).getByText(statusText(r.status[K0])).closest('.status-pill')!).getByText(statusText(r.status[K0]))).toBeInTheDocument();
      // Buy quotes per pool = buyCell / sharedStatus (identical helpers to BoardTable).
      const shared = sharedStatus(r);
      const quotes = Array.from(c.querySelectorAll<HTMLElement>('.series-card__quote'));
      if (shared) {
        expect(quotes).toHaveLength(1);
        expect(quotes[0]!.querySelector('em')).toHaveTextContent(shared.text);
        if (shared.name) expect(quotes[0]!.querySelector('em')).toHaveAttribute('title', shared.name);
      } else {
        expect(quotes.map((q) => q.querySelector('b, em')!.textContent)).toEqual(POOL_KEYS.map((k) => buyCell(r, k).text));
        quotes.forEach((q, j) => expect(q.querySelector('span')).toHaveTextContent(`Buy ${POOL_KEYS[j]}`));
      }
      expect(c.querySelector('[data-parity]')).toHaveAttribute('data-parity', parityCell(r).state);
      expect(c.querySelector('[data-parity]')!.textContent).toBe(parityCell(r).text);
      expect(c.querySelector('[data-delta]')!.textContent).toBe(deltaCell(r).text);
      expect(c.querySelector('.series-card__meta dd.mono:not([data-delta])')!.textContent).toBe(sigmaCell(r));
      expect(within(c).getByRole('link', { name: 'Trade' })).toHaveAttribute('href', expect.stringMatching(new RegExp(`series=${r.i}$`)));
    }
    expect(document.querySelectorAll('.series-card--atm')).toHaveLength(1);
    expect(card(rows.find((r) => r.atm)!.i)).toHaveClass('series-card--atm');
    // σ_buy caption keeps σ lowercase via .sym; Δ too.
    const atm = card(rows.find((r) => r.atm)!.i);
    expect(within(atm).getByText(`σ_buy`, { exact: false }).closest('.sym')).not.toBeNull();
  });

  it('"Details" opens the same SeriesDetail (Greeks per pool, K5 prices, Trade on k) inside the card and closes again; the expanded state survives a resize to the table', () => {
    const vp = phone(375);
    const s = liveSnapshot();
    renderWithChain(<Boards />, { snapshot: s });
    const r = seriesViews(s, liveParity(s)).find((x) => x.atm)!;
    const label = seriesLabel(r.ref);
    const button = within(card(r.i)).getByRole('button', { name: `Details · show Greeks for ${label}` });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector(`#series-detail-${r.i}`)).toBeNull();
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const detail = document.querySelector<HTMLElement>(`#series-detail-${r.i}`)!;
    expect(detail).toHaveClass('series-card__detail');
    for (const k of POOL_KEYS) {
      const block = within(detail).getByRole('region', { name: `Pool ${k} Greeks` });
      expect(within(block).getByText('δ delta').nextElementSibling).toHaveTextContent(wad(r.state[k].buy!.delta, 2));
      expect(within(block).getByRole('link', { name: `Trade on ${k}` })).toBeInTheDocument();
    }
    expect(within(within(detail).getByRole('region', { name: 'K5 math parity' })).getByText('byte-identical')).toBeInTheDocument();
    // Wider viewport → the table comes back and the row is still expanded (shared state).
    act(() => vp.resize(900));
    expect(document.querySelector('.series-card')).toBeNull();
    expect(document.querySelector('table.series-table--full')).not.toBeNull();
    expect(document.querySelector(`tr#series-detail-${r.i}`)).not.toBeNull();
    expect(screen.getByRole('button', { name: `Hide Greeks for ${label}` })).toHaveAttribute('aria-expanded', 'true');
    act(() => vp.resize(640));
    expect(cards()).toHaveLength(ALL_SERIES.length);
    fireEvent.click(within(card(r.i)).getByRole('button', { name: `Details · hide Greeks for ${label}` }));
    expect(document.querySelector(`#series-detail-${r.i}`)).toBeNull();
  });

  it('board header: expiry on one line ("25 Sep 2026 · 08:00 UTC", ISO in the title) and the short status pill on phones, the long one on desktop', () => {
    const vp = phone(375);
    const s = withSettled(liveSnapshot(), BOARDS[0]!.id, 2900);
    renderWithChain(<Boards />, { snapshot: s });
    const boards = boardViews(s, liveParity(s));
    for (const b of boards) {
      const p = document.querySelector<HTMLElement>(`article[aria-label="Board #${b.board.id}"]`)!;
      const time = within(p).getByText(expiryLabel(b.board.expiry));
      expect(time.tagName).toBe('TIME');
      expect(time).toHaveAttribute('title', utc(b.board.expiry));
      const pill = boardPill(b);
      expect(within(p).getByText(pill.short)).toHaveAttribute('title', pill.text);
      expect(within(p).queryByText(pill.text)).toBeNull();
    }
    // Settled with one price on every pool → "settled @ 2900.00"; open → "open · 4d 5h 35m" (no sentence).
    const settled = boardPill(boards[0]!), open = boardPill(boards[1] ?? boards[0]!);
    expect(settled.short).toBe(`settled @ ${wad(s.pools[K0].boards[0]!.settlementPrice, 2)}`);
    expect(settled.text).toContain(` (${K0})`);
    if (open.tone === 'good') { expect(open.short).toMatch(/^open · \d/); expect(open.text).toMatch(/^open · expires in .* \(block time\)$/); }
    act(() => vp.resize(1280));
    expect(screen.getByText(boardPill(boards[0]!).text)).toBeInTheDocument();
  });
  it('expiryLabel formats "D Mon YYYY · HH:MM UTC" with the same minute as utc()', () => {
    for (const b of BOARDS) {
      expect(expiryLabel(b.expiry)).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4} · \d{2}:\d{2} UTC$/);
      expect(expiryLabel(b.expiry).slice(-9, -4)).toBe(utc(b.expiry).slice(11, 16));
    }
    expect(expiryLabel(Date.UTC(2026, 8, 25, 8, 0) / 1000)).toBe('25 Sep 2026 · 08:00 UTC');
  });
});

describe('Task 6b — Overview summary cards and Greek labels', () => {
  it('375 px: the Overview board summary renders ATM ± 2 cards per board with quoteCell texts, parity and σ_buy, no actions', () => {
    phone(375);
    const s = liveSnapshot();
    renderWithChain(<Overview />, { snapshot: s });
    expect(document.querySelector('table')).toBeNull();
    for (const b of boardViews(s, liveParity(s))) {
      const panel = document.querySelector<HTMLElement>(`article[aria-label="Board #${b.board.id}"]`)!;
      const expected = atmWindow(b.series, s.feed.spotWad);
      const list = within(panel).getByRole('list', { name: 'Series' });
      expect(list).toHaveClass('series-cards--summary');
      const cs = cards(list);
      expect(cs).toHaveLength(expected.length);
      cs.forEach((c, i) => {
        const r = expected[i]!;
        expect(c).toHaveAttribute('data-series', String(r.i));
        expect(within(c).getByText(refLabel(r.ref))).toBeInTheDocument();
        const texts = Array.from(c.querySelectorAll('.series-card__quote b, .series-card__quote em')).map((e) => e.textContent);
        const perPool = POOL_KEYS.map((k) => quoteCell(r, k));
        expect(texts.length === 1 ? perPool.every((t) => t === texts[0]) : texts.join('|') === perPool.join('|')).toBe(true);
        expect(within(c).queryByRole('button')).toBeNull();
        expect(within(c).queryByRole('link', { name: 'Trade' })).toBeNull();
        expect(c.querySelector('[data-parity]')!.textContent).toBe(parityCell(r).text);
        expect(within(c).getByText(sigmaCell(r))).toBeInTheDocument();
      });
    }
  });

  it('labels keep "σ" (never "Σ"): metric labels wrap the Greek word in .sym, the pool-card identifier keeps its case, keepSymbols leaves plain text alone', () => {
    renderWithChain(<Overview />, { snapshot: liveSnapshot() });
    for (const label of ['σ base', 'σ mark (0)']) {
      const el = screen.getByLabelText(label).querySelector<HTMLElement>('.metric-card__label')!;
      expect(el.textContent).toBe(label);
      expect(el.textContent).not.toContain('Σ');
      expect(within(el).getByText('σ')).toHaveClass('sym');
    }
    expect(screen.getByLabelText('ETH / USD').querySelector('.metric-card__label .sym')).toBeNull();
    expect(screen.getAllByRole('columnheader', { name: `σ_buy ${POOL_KEYS.join(' | ')}` })[0]!.querySelector('.sym')).toHaveTextContent('σ_buy');
    const { container } = render(<span>{keepSymbols('Δ A|B')}</span>);
    expect(container.querySelector('.sym')).toHaveTextContent('Δ');
    expect(container.textContent).toBe('Δ A|B');
    expect(keepSymbols('Next expiry')).toBe('Next expiry');
  });
});

describe('Task 6b — navigation drawer and topbar ≤ 680 px', () => {
  const page = <Layout><p>page content</p></Layout>;
  const aside = () => document.querySelector<HTMLElement>('aside.sidebar')!;
  const hamburger = () => screen.getByRole('button', { name: 'Open navigation' });

  it('opens the full drawer (labels, network card, wallet row, callout, build) with dialog semantics, locks scroll and moves focus; Escape closes and returns focus', () => {
    phone(375);
    renderWithChain(page, { snapshot: liveSnapshot() });
    expect(hamburger()).toHaveAttribute('aria-expanded', 'false');
    expect(hamburger()).toHaveAttribute('aria-controls', 'app-sidebar');
    expect(aside()).not.toHaveClass('sidebar--mobile-open');
    fireEvent.click(hamburger());
    expect(aside()).toHaveClass('sidebar--mobile-open');
    expect(aside()).toHaveAttribute('role', 'dialog');
    expect(aside()).toHaveAttribute('aria-modal', 'true');
    expect(hamburger()).toHaveAttribute('aria-expanded', 'true');
    const nav = within(aside()).getByRole('navigation', { name: 'Main navigation' });
    for (const label of ['Overview', 'Boards', 'Trade', 'Portfolio', 'Activity', 'Contracts']) expect(within(nav).getByText(label)).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: /Overview/ })).toHaveAttribute('aria-current', 'page');
    expect(within(aside()).getByText(/live · block/)).toBeInTheDocument();
    expect(within(aside()).getByText('Arbitrum Sepolia')).toBeInTheDocument();
    expect(within(screen.getByTestId('drawer-wallet')).getByRole('button', { name: 'Connect wallet' })).toBeInTheDocument();
    expect(screen.getByTestId('drawer-wallet')).toHaveTextContent('No injected wallet — read-only');
    expect(within(aside()).getByText('Testnet only')).toBeInTheDocument();
    expect(within(aside()).getByText(/^Build/)).toHaveTextContent('Build test');
    expect(within(aside()).getByRole('link', { name: /GitHub/ })).toHaveAttribute('href', 'https://github.com/nodesproof/equinox');
    expect(within(aside()).getByRole('button', { name: 'Close navigation' })).toHaveClass('sidebar-close');   // the X (the backdrop shares the name)
    expect(document.querySelector('.mobile-backdrop')).not.toBeNull();
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(document.activeElement).toHaveClass('sidebar-close');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(aside()).not.toHaveClass('sidebar--mobile-open');
    expect(aside()).not.toHaveAttribute('role');
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(hamburger());
    expect(document.querySelector('.mobile-backdrop')).toBeNull();
  });

  it('closes on the X button, on the backdrop and on a route change', () => {
    phone(375);
    window.scrollTo = vi.fn();   // jsdom: not implemented (Layout scrolls to the top on a route change)
    renderWithChain(page, { snapshot: liveSnapshot() });
    fireEvent.click(hamburger());
    fireEvent.click(within(aside()).getByRole('button', { name: 'Close navigation' }));
    expect(aside()).not.toHaveClass('sidebar--mobile-open');
    fireEvent.click(hamburger());
    fireEvent.click(document.querySelector('.mobile-backdrop')!);
    expect(aside()).not.toHaveClass('sidebar--mobile-open');
    fireEvent.click(hamburger());
    expect(aside()).toHaveClass('sidebar--mobile-open');
    act(() => { window.location.hash = '#/boards'; window.dispatchEvent(new Event('hashchange')); });
    expect(aside()).not.toHaveClass('sidebar--mobile-open');
    expect(document.body.style.overflow).toBe('');
    expect(within(aside()).getByRole('link', { name: /Boards/ })).toHaveAttribute('aria-current', 'page');
  });

  it('wallet button in the topbar: icon only with an aria-label below 400 px, "Connect" up to 680 px, "Connect wallet" on desktop; the drawer keeps the full text', () => {
    const vp = phone(360);
    renderWithChain(page, { snapshot: liveSnapshot(), hasWallet: true, account: null });
    const topbar = () => within(screen.getByRole('banner')).getByRole('button', { name: 'Connect wallet' });
    expect(topbar()).toHaveAttribute('aria-label', 'Connect wallet');
    expect(topbar()).toHaveClass('connect-button--icon');
    expect(topbar().textContent!.trim()).toBe('');
    act(() => vp.resize(414));
    expect(within(screen.getByRole('banner')).getByRole('button', { name: 'Connect' })).not.toHaveAttribute('aria-label');
    expect(within(screen.getByRole('banner')).getByRole('button', { name: 'Connect' }).textContent!.trim()).toBe('Connect');
    fireEvent.click(hamburger());
    expect(within(screen.getByTestId('drawer-wallet')).getByRole('button', { name: 'Connect wallet' }).textContent!.trim()).toBe('Connect wallet');
    act(() => vp.resize(1280));
    expect(within(screen.getByRole('banner')).getByRole('button', { name: 'Connect wallet' }).textContent!.trim()).toBe('Connect wallet');
    expect(screen.queryByTestId('drawer-wallet')).toBeNull();
  });
});

describe('Task 6b — Trade, Activity and Contracts on phones', () => {
  it('Trade 375 px: intro + wallet paragraphs fold into one notice card with a "How it works" disclosure that still holds the classic TradeNote', () => {
    phone(375);
    renderWithChain(<Trade />, { snapshot: liveSnapshot(), hasWallet: false });
    const intro = screen.getByTestId('trade-intro');
    expect(intro.tagName).toBe('DETAILS');
    expect(intro).toHaveClass('notice-card--warn');
    expect(within(intro).getByText(/No injected wallet found — the panel is read-only; boards and quotes stay readable\./)).toHaveClass('notice-card__lead');
    expect(within(intro).getByText(/How it works/)).toBeInTheDocument();
    const note = within(intro).getByTestId('trade-note');
    expect(note).toHaveAttribute('data-kind', 'no-wallet');
    expect(within(intro).getByText(/Every action is simulated first \(eth_call\) and written through your wallet/)).toBeInTheDocument();
    expect(document.querySelector('.section-heading p')).toBeNull();
  });

  it('Activity 375 px: one event card per trade with the classic texts and explorer links (no table)', () => {
    phone(375);
    const s = liveSnapshot();
    const trades = liveTrades();
    renderWithChain(<Activity />, { snapshot: s, nowMs: s.fetchedAtMs, events: liveEvents(), eventsState: 'live' });
    expect(document.querySelector('table.events-table')).toBeNull();
    const items = within(screen.getByRole('list', { name: 'Pool events' })).getAllByRole('listitem');
    expect(items).toHaveLength(trades.length);
    trades.forEach((t, i) => {
      const li = items[i]!;
      expect(li).toHaveAttribute('data-kind', t.kind);
      expect(li).toHaveAttribute('data-pool', t.pool);
      expect(within(li).getByText(t.kind)).toBeInTheDocument();
      expect(within(li).getByText(t.label)).toBeInTheDocument();
      expect(li.querySelector('.event-card__amount')).toHaveTextContent(t.amount);
      expect(within(li).getByText(`block ${t.block}`)).toBeInTheDocument();
      expect(within(li).getByText(/^≈ /)).toBeInTheDocument();
      const links = within(li).getAllByRole('link');
      expect(links[0]).toHaveAttribute('title', t.tx);
      expect(links[1]).toHaveAttribute('title', t.who!);
    });
  });

  it('Contracts 375 px: address cards (full address, Copy → clipboard, Arbiscan, Sourcify) and a cfg() list with the same values as the table', async () => {
    phone(375);
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const s = liveSnapshot();
    renderWithChain(<Contracts />, { snapshot: s });
    expect(document.querySelector('table.contracts-table')).toBeNull();
    const rows = addressRows();
    for (const r of rows) {
      const c = document.querySelector<HTMLElement>(`.address-card[data-address="${r.address}"]`)!;
      expect(c).not.toBeNull();
      expect(within(c).getByText(r.address)).toHaveClass('address-card__addr');
      expect(within(c).getByRole('link', { name: /Arbiscan/ })).toHaveAttribute('href', expect.stringContaining(r.address));
      expect(within(c).getByRole('link', { name: /Sourcify/ })).toHaveAttribute('href', expect.stringContaining(r.address));
    }
    const first = rows[0]!;
    fireEvent.click(within(document.querySelector<HTMLElement>(`.address-card[data-address="${first.address}"]`)!).getByRole('button', { name: `Copy ${first.label} address` }));
    await act(async () => { await Promise.resolve(); });
    expect(writeText).toHaveBeenCalledWith(first.address);
    // cfg(): one card per field; values = cfgRows (collapsed to one when identical across pools).
    const cfgs = Object.fromEntries(POOL_KEYS.map((k) => [k, s.pools[k].cfg])) as Parameters<typeof cfgRows>[0];
    const expected = cfgRows(cfgs);
    for (const f of CFG_FIELDS) {
      const c = document.querySelector<HTMLElement>(`.config-card[data-cfg="${f.key}"]`)!;
      expect(within(c).getByText(f.label)).toBeInTheDocument();
      expect(within(c).getByText(f.hint)).toBeInTheDocument();
      const row = expected.find((r) => r.key === f.key)!;
      expect(c.querySelector('.config-card__values')).toHaveTextContent(row.values[0]!);
    }
    delete (navigator as unknown as { clipboard?: unknown }).clipboard;
  });
});
