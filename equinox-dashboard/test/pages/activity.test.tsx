// test/pages/activity.test.tsx — Activity dari fixture ChainContext (tanpa provider/jaringan): baris tabel = fixture event (terbaru dulu, sel klasik,
// tautan explorer, ≈ waktu dari blok snapshot), filter pool / jenis / "mine" (chip hanya bila ada akun, case-insensitive), empty-state per
// eventsState dan "no match", pagination MAX_ROWS, garis waktu σ_base mode blok dengan penanda Settled + label ≈ waktu, helper murni.
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Address } from 'viem';
import { POOL_KEYS, explorerAddress, explorerTx } from '@chain/deployment';
import type { TradeEvent } from '@chain/chain/events';
import { shortAddr, shortHash, utc, wad } from '@chain/ui/format';
import Activity from '@/pages/Activity';
import Overview from '@/pages/Overview';
import { EVENTS_EVERY } from '@/chain/provider';
import { MAX_ROWS } from '@/components/EventsTable';
import { DEFAULT_EVENT_FILTER, NITRO_BLOCK_S, TIME_APPROX_NOTE, blockTimeApprox, countNote, filterTrades, isDefaultFilter, isMine, scanNote, settledMarkers } from '@/lib/activity';
import { renderWithChain } from '../render';
import { BLOCK, BLOCK_TIME, OWNER, USER, liveSnapshot, withUser } from '../fixtures/snapshot';
import { claimedEvent, liveEvents, liveObserved, liveTrades, settledEvent } from '../fixtures/events';

afterEach(() => { cleanup(); window.location.hash = ''; });

const rows = () => Array.from(document.querySelectorAll<HTMLElement>('.events-table tbody tr.series-row'));
const cells = (tr: HTMLElement) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent!.trim());
const chip = (name: string | RegExp) => screen.getByRole('button', { name });
const approx = (block: bigint) => `≈ ${utc(blockTimeApprox(block, BLOCK, BLOCK_TIME))}`;

describe('Activity — event feed', () => {
  it('renders every fixture event newest first with the classic cells, ≈ time from the snapshot block, explorer links and the live pill', () => {
    const s = liveSnapshot();
    const trades = liveTrades();
    renderWithChain(<Activity />, { snapshot: s, nowMs: s.fetchedAtMs, events: liveEvents(), eventsState: 'live' });
    expect(screen.getByRole('heading', { level: 2, name: 'Activity' })).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText(`block ${BLOCK} · ${utc(BLOCK_TIME)}`)).toHaveClass('status-pill--good');
    const trs = rows();
    expect(trs).toHaveLength(trades.length);
    trades.forEach((t, i) => {
      const tr = trs[i]!;
      expect(tr).toHaveAttribute('data-kind', t.kind);
      expect(tr).toHaveAttribute('data-pool', t.pool);
      const c = cells(tr);
      expect(c[0]).toBe(t.pool);
      expect(c[1]).toBe(t.kind);
      expect(c[2]).toBe(t.label);
      expect(c[3]).toBe(t.amount);
      expect(c[4]).toBe(t.block.toString());
      expect(c[5]).toBe(approx(t.block));
      const links = within(tr).getAllByRole('link');
      expect(links[0]).toHaveAttribute('href', explorerTx(t.tx));
      expect(links[0]).toHaveTextContent(shortHash(t.tx));
      expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer');
      expect(links[1]).toHaveAttribute('href', explorerAddress(t.who!));
      expect(links[1]).toHaveTextContent(shortAddr(t.who!));
    });
    // Newest first: blocks strictly descending.
    for (let i = 1; i < trs.length; i++) expect(BigInt(cells(trs[i - 1]!)[4]!) > BigInt(cells(trs[i]!)[4]!)).toBe(true);
    expect(screen.getByText(`${trades.length} of ${trades.length} events`)).toBeInTheDocument();
    expect(screen.getByText(`${trades.length} events since deploy · newest first · chain scan live · re-read every ${EVENTS_EVERY}th snapshot`)).toBeInTheDocument();
    // No account → no "Mine" chip, no "you" marker, no highlighted rows.
    expect(screen.queryByRole('button', { name: /Mine/ })).toBeNull();
    expect(document.querySelector('[data-mine]')).toBeNull();
    expect(screen.queryByText('you')).toBeNull();
  });

  it('filters by pool and kind (chips are aria-pressed), shows n of N, and the no-match state clears back to every row', () => {
    const s = liveSnapshot();
    const trades = liveTrades();
    renderWithChain(<Activity />, { snapshot: s, nowMs: s.fetchedAtMs, events: liveEvents(), eventsState: 'live' });
    const k0 = POOL_KEYS[0]!;
    fireEvent.click(chip(k0));
    expect(chip(k0)).toHaveAttribute('aria-pressed', 'true');
    expect(chip('All pools')).toHaveAttribute('aria-pressed', 'false');
    const inPool = trades.filter((t) => t.pool === k0);
    expect(rows()).toHaveLength(inPool.length);
    for (const tr of rows()) expect(tr).toHaveAttribute('data-pool', k0);
    expect(screen.getByText(`${inPool.length} of ${trades.length} events`)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`^${countNote(inPool.length, trades.length)}`))).toBeInTheDocument();
    fireEvent.click(chip('Bought'));
    const both = inPool.filter((t) => t.kind === 'Bought');
    expect(rows()).toHaveLength(both.length);
    expect(rows().map((tr) => cells(tr)[4])).toEqual(both.map((t) => t.block.toString()));
    fireEvent.click(chip('All pools'));
    expect(rows()).toHaveLength(trades.filter((t) => t.kind === 'Bought').length);
    fireEvent.click(chip('Closed'));
    for (const tr of rows()) expect(tr).toHaveAttribute('data-kind', 'Closed');
    // No Settled event in the fixture → honest "no match" state with a clear button (not the scan empty-state).
    fireEvent.click(chip('Settled'));
    expect(rows()).toHaveLength(0);
    expect(screen.getByText('No events match this filter')).toBeInTheDocument();
    expect(screen.queryByText('No pool events since deploy')).toBeNull();
    expect(screen.getByText(`0 of ${trades.length} events since deploy · newest first · chain scan live · re-read every ${EVENTS_EVERY}th snapshot`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(rows()).toHaveLength(trades.length);
    expect(chip('All kinds')).toHaveAttribute('aria-pressed', 'true');
  });

  it('offers the "mine" chip only with an account and keeps the actor match case-insensitive; own rows are highlighted', () => {
    const s = withUser(liveSnapshot());
    const trades = liveTrades();
    const lower = USER.toLowerCase() as Address;
    renderWithChain(<Activity />, { snapshot: s, nowMs: s.fetchedAtMs, events: liveEvents(), eventsState: 'live', account: lower });
    const mine = trades.filter((t) => t.who === USER);
    expect(mine.length).toBeGreaterThan(0);
    // Highlighted before the filter is applied.
    expect(document.querySelectorAll('[data-mine="true"]')).toHaveLength(mine.length);
    expect(screen.getAllByText('you')).toHaveLength(mine.length);
    const mineChip = chip(new RegExp(`Mine · ${shortAddr(lower)}`));
    expect(mineChip).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(mineChip);
    expect(rows()).toHaveLength(mine.length);
    expect(rows().map((tr) => cells(tr)[4])).toEqual(mine.map((t) => t.block.toString()));
    for (const tr of rows()) expect(tr).toHaveAttribute('data-mine', 'true');
    expect(screen.getByText(`${mine.length} of ${trades.length} events`)).toBeInTheDocument();
    // Pool chip combines with "mine".
    const k = mine[0]!.pool;
    fireEvent.click(chip(k));
    expect(rows()).toHaveLength(mine.filter((t) => t.pool === k).length);
    // Settled has no actor → never "mine".
    expect(isMine(settledEvent('A', 0, 2900), USER)).toBe(false);
    expect(isMine(trades.find((t) => t.who === OWNER)!, USER)).toBe(false);
  });

  it('is honest per eventsState when the feed is empty and keeps old rows on a failed scan', () => {
    const s = liveSnapshot();
    const { unmount } = renderWithChain(<Activity />, { snapshot: s, nowMs: s.fetchedAtMs, events: { trades: [], observed: [] }, eventsState: 'seed' });
    expect(screen.getByText('No events loaded yet')).toBeInTheDocument();
    expect(screen.getAllByText('No scan yet').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/0 events since deploy · newest first · no seed · chain scan pending/)).toBeInTheDocument();
    expect(screen.getByText('0 of 0 events')).toBeInTheDocument();
    expect(rows()).toHaveLength(0);
    unmount();
    const r2 = renderWithChain(<Activity />, { snapshot: s, nowMs: s.fetchedAtMs, events: { trades: [], observed: [] }, eventsState: 'scanning' });
    expect(screen.getByText('Scanning the chain for events…')).toBeInTheDocument();
    expect(screen.getAllByText('Scanning…').length).toBeGreaterThanOrEqual(1);
    r2.unmount();
    renderWithChain(<Activity />, { snapshot: s, nowMs: s.fetchedAtMs, events: liveEvents(), eventsState: 'error' });
    expect(rows()).toHaveLength(liveTrades().length);
    expect(screen.getAllByText('Scan failed · retrying').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/chain scan failed — retrying at the next refresh$/)).toBeInTheDocument();
  });

  it('shows MAX_ROWS rows first, "Show more" reveals the rest, and a filter change resets the page', () => {
    const base = liveTrades();
    const many: TradeEvent[] = [];
    for (let i = 0; i < MAX_ROWS + 5; i++) {
      const t = base[i % base.length]!;
      many.push({ ...t, block: BLOCK - BigInt(i) * 3n, logIndex: i, tx: `0x${(i + 1).toString(16).padStart(64, 'b')}` as `0x${string}` });
    }
    const s = liveSnapshot();
    renderWithChain(<Activity />, { snapshot: s, nowMs: s.fetchedAtMs, events: { trades: many, observed: liveObserved() }, eventsState: 'live' });
    expect(rows()).toHaveLength(MAX_ROWS);
    const more = screen.getByRole('button', { name: `Show 5 more (5 hidden)` });
    fireEvent.click(more);
    expect(rows()).toHaveLength(many.length);
    expect(screen.queryByRole('button', { name: /Show .* more/ })).toBeNull();
    fireEvent.click(chip('Bought'));
    fireEvent.click(chip('All kinds'));
    expect(rows()).toHaveLength(MAX_ROWS);
  });

  it('without a snapshot the table keeps the block but no ≈ time, and the timeline says time needs a snapshot', () => {
    renderWithChain(<Activity />, { snapshot: null, events: liveEvents(), eventsState: 'seed' });
    expect(screen.getByText('Awaiting snapshot')).toHaveClass('status-pill--muted');
    const c = cells(rows()[0]!);
    expect(c[4]).toBe(liveTrades()[0]!.block.toString());
    expect(c[5]).toBe('—');
    expect(screen.getAllByText('≈ time needs a snapshot').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('time needs a snapshot')).toBeInTheDocument();
    expect(document.querySelector('.chart-x-labels')!.textContent).not.toContain('≈ 20');
    expect(document.querySelector('.chart-note')).toBeNull();
    expect(document.querySelector('path.sigma-line')).not.toBeNull();
  });
});

describe('Activity — σ_base timeline', () => {
  it('draws the observations on a block axis with ≈ time labels, a hover tooltip carrying the ≈ time, and the approximation note', () => {
    const s = liveSnapshot();
    const obs = liveObserved();
    const first = obs[0]!, last = obs[obs.length - 1]!;
    const { container } = renderWithChain(<Activity />, { snapshot: s, nowMs: s.fetchedAtMs, events: liveEvents(), eventsState: 'live' });
    expect(screen.getByRole('heading', { level: 3, name: 'σ_base over blocks' })).toBeInTheDocument();
    expect(container.querySelector('path.sigma-line')).not.toBeNull();
    const labels = container.querySelector('.chart-x-labels')!;
    expect(labels).toHaveTextContent(`block ${first.block} · ${approx(first.block)}`);
    expect(labels).toHaveTextContent(`block ${last.block} · ${approx(last.block)}`);
    expect(labels).toHaveTextContent('≈ time from block');
    expect(container.querySelector('.chart-note')).toHaveTextContent(TIME_APPROX_NOTE);
    expect(TIME_APPROX_NOTE).toContain('approximation');
    expect(screen.getByText(new RegExp(`${obs.length} observations since deploy · last σ_base ${wad(last.sigmaBase)} at block ${last.block}`))).toBeInTheDocument();
    const svg = container.querySelector<SVGSVGElement>('svg.engine-chart')!;
    expect(svg.getAttribute('aria-label')).toContain(`${obs.length} observations`);
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 720, height: 220, right: 720, bottom: 220, x: 0, y: 0, toJSON() {} }) as DOMRect;
    fireEvent.mouseMove(svg, { clientX: 720, clientY: 100 });
    expect(screen.getByRole('status')).toHaveTextContent(`block ${last.block} · ${approx(last.block)} · σ_base ${wad(last.sigmaBase)}`);
    fireEvent.mouseMove(svg, { clientX: 0, clientY: 100 });
    expect(screen.getByRole('status')).toHaveTextContent(`block ${first.block} · ${approx(first.block)}`);
    fireEvent.mouseLeave(svg);
    expect(screen.queryByRole('status')).toBeNull();
    // No Settled event → no marker, but the legend names the marker kind.
    expect(container.querySelectorAll('.sigma-marker')).toHaveLength(0);
    expect(container.querySelector('.chart-legend')).toHaveTextContent('Settled (per pool)');
  });

  it('places one settlement marker per Settled event (per pool) at its block, with the label and a full title; Overview stays marker-free', () => {
    const s = liveSnapshot();
    const settledA = settledEvent('A', 0, 2900), settledB = settledEvent('B', 0, 2900, 3n);
    const trades = [settledB, settledA, claimedEvent('A', 0, OWNER), ...liveTrades()];
    const events = { trades, observed: liveObserved() };
    const { container, unmount } = renderWithChain(<Activity />, { snapshot: s, nowMs: s.fetchedAtMs, events, eventsState: 'live' });
    const markers = Array.from(container.querySelectorAll<SVGGElement>('.sigma-marker'));
    expect(markers).toHaveLength(2);
    expect(markers.map((m) => m.getAttribute('data-block'))).toEqual([settledA.block.toString(), settledB.block.toString()]);
    expect(markers[0]!.querySelector('title')!.textContent).toBe(`Pool A board #0 settled at block ${settledA.block} · ${settledA.amount} · ${approx(settledA.block)}`);
    // Beyond the last observation → clamped to the right edge of the plot, both lines visible.
    for (const m of markers) { const x = Number(m.querySelector('line')!.getAttribute('x1')); expect(x).toBeGreaterThan(0); expect(x).toBeLessThanOrEqual(720); }
    const labels = Array.from(container.querySelectorAll<HTMLElement>('.sigma-marker-label'));
    expect(labels.map((l) => l.textContent)).toEqual(['settled board #0 · A', 'settled board #0 · B']);
    expect(labels[1]!.title).toContain(`Pool B board #0 settled at block ${settledB.block}`);
    expect(container.querySelector('svg.engine-chart')!.getAttribute('aria-label')).toContain('2 settlement markers');
    // The table lists the Settled and Claimed rows too (no actor for Settled).
    expect(rows()[0]).toHaveAttribute('data-kind', 'Settled');
    expect(cells(rows()[0]!)[7]).toContain('settle has no actor');
    expect(rows()[2]).toHaveAttribute('data-kind', 'Claimed');
    fireEvent.click(chip('Settled'));
    expect(rows()).toHaveLength(2);
    unmount();
    // Overview keeps the order axis: no markers, no x labels.
    const o = renderWithChain(<Overview />, { snapshot: s, nowMs: s.fetchedAtMs, events, eventsState: 'live' });
    expect(o.container.querySelectorAll('.sigma-marker')).toHaveLength(0);
    expect(o.container.querySelector('.chart-x-labels')).toBeNull();
    expect(o.container.querySelector('path.sigma-line')).not.toBeNull();
  });

  it('is honest without observations (per eventsState) while the feed still lists trades', () => {
    const s = liveSnapshot();
    renderWithChain(<Activity />, { snapshot: s, nowMs: s.fetchedAtMs, events: { trades: liveTrades(), observed: [] }, eventsState: 'live' });
    expect(screen.getByText('No observations since deploy')).toBeInTheDocument();
    expect(document.querySelector('path.sigma-line')).toBeNull();
    expect(document.querySelector('.chart-x-labels')).toBeNull();
    expect(screen.getByText(/x = block number \(≈ time\) · scan live/)).toBeInTheDocument();
    expect(rows()).toHaveLength(liveTrades().length);
  });
});

describe('Activity — pure helpers', () => {
  it('blockTimeApprox: 0.25 s per block behind the snapshot block, labelled as an approximation', () => {
    expect(NITRO_BLOCK_S).toBe(0.25);
    expect(blockTimeApprox(BLOCK, BLOCK, BLOCK_TIME)).toBe(BLOCK_TIME);
    expect(blockTimeApprox(BLOCK - 4n, BLOCK, BLOCK_TIME)).toBe(BLOCK_TIME - 1);
    expect(blockTimeApprox(BLOCK - 4000n, BLOCK, BLOCK_TIME)).toBe(BLOCK_TIME - 1000);
    expect(blockTimeApprox(BLOCK + 8n, BLOCK, BLOCK_TIME)).toBe(BLOCK_TIME + 2);
    expect(TIME_APPROX_NOTE.startsWith('≈ time =')).toBe(true);
  });

  it('filterTrades / settledMarkers / scanNote / countNote', () => {
    const trades = [settledEvent('B', 0, 2900, 5n), settledEvent('A', 0, 2900), ...liveTrades()];
    expect(filterTrades(trades, DEFAULT_EVENT_FILTER, null)).toEqual(trades);
    expect(isDefaultFilter(DEFAULT_EVENT_FILTER)).toBe(true);
    expect(isDefaultFilter({ ...DEFAULT_EVENT_FILTER, mine: true })).toBe(false);
    expect(filterTrades(trades, { pool: 'A', kind: 'Settled', mine: false }, null)).toHaveLength(1);
    expect(filterTrades(trades, { pool: null, kind: null, mine: true }, null)).toEqual([]);
    expect(filterTrades(trades, { pool: null, kind: null, mine: true }, USER).every((t) => t.who === USER)).toBe(true);
    const markers = settledMarkers(trades);
    expect(markers.map((m) => m.block)).toEqual([settledEvent('A', 0, 2900).block, settledEvent('B', 0, 2900, 5n).block]);
    expect(markers[0]).toMatchObject({ label: 'settled board #0 · A' });
    expect(scanNote('seed', 0)).toContain('no seed');
    expect(scanNote('seed', 3)).toContain('seed loaded');
    expect(scanNote('scanning', 3)).toContain('eth_getLogs');
    expect(scanNote('live', 3)).toContain(`${EVENTS_EVERY}th snapshot`);
    expect(scanNote('error', 3)).toContain('retrying');
    expect(countNote(8, 8)).toBe('8 events since deploy');
    expect(countNote(1, 1)).toBe('1 event since deploy');
    expect(countNote(2, 8)).toBe('2 of 8 events since deploy');
  });
});
