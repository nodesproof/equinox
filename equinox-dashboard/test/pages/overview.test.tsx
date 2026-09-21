// test/pages/overview.test.tsx — Overview dirender dari fixture ChainContext (tanpa provider/jaringan): live, skeleton, muat pertama gagal,
// stale (data tetap), paritas ✗, paused, oracle stale, settled/expired/blackout, umpan event + grafik σ_base. Semua angka harapan dihitung
// dari fixture + formatter `@chain/ui/format` — tidak ada jumlah pool/board/seri yang ditanam.
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ALL_SERIES, BOARDS, POOLS, POOL_KEYS, explorerAddress, explorerTx } from '@chain/deployment';
import { fmtCountdown, pct, usdg, usdg6, wad } from '@chain/ui/format';
import Overview, { nextBoard } from '@/pages/Overview';
import { atmWindow, quoteCell } from '@/components/BoardSummary';
import { paritySummary } from '@/components/ParityPanel';
import { boardViews, seriesViews } from '@/chain/selectors';
import { refLabel } from '@/lib/format';
import { renderWithChain } from '../render';
import { BLOCK_TIME, VOL, liveParity, liveSnapshot, withBlackout, withExpired, withOracleStale, withPaused, withSettled, withStale } from '../fixtures/snapshot';
import { liveEvents, liveObserved, liveTrades } from '../fixtures/events';

afterEach(() => { cleanup(); window.location.hash = ''; });

const metricValues = (container: HTMLElement) => Array.from(container.querySelectorAll('.metric-card__value')).map((el) => el.textContent ?? '');
const poolCards = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>('article.pool-card'));
const card = (container: HTMLElement, k: string) => container.querySelector<HTMLElement>(`article.pool-card[data-pool="${k}"]`)!;

describe('Overview — live snapshot', () => {
  it('shows the feed, σ_base, σ_mark(0) and engine params formatted from snapshot.vol (never literals)', () => {
    const s = liveSnapshot();
    const { container } = renderWithChain(<Overview />, { snapshot: s, nowMs: s.fetchedAtMs });
    expect(screen.getByText('2,579.49')).toBeInTheDocument();                       // feedUsd + grouping
    expect(screen.getByText(wad(VOL.sigmaBase))).toBeInTheDocument();               // 0.5483
    expect(screen.getAllByText(wad(VOL.sigmaMark0)).length).toBeGreaterThanOrEqual(1); // 0.6306 (also σ_mark(util) of an idle pool)
    // Engine panel rows: VRP, α, spread, σ_min–σ_max, λ from params(); the "Observation interval" row is gone (not in the snapshot).
    const engine = screen.getByText('Endogenous volatility').closest('article')!;
    expect(within(engine).getByText(wad(VOL.vrp, 2))).toBeInTheDocument();
    expect(within(engine).getByText(wad(VOL.alpha, 2))).toBeInTheDocument();
    expect(within(engine).getByText(pct(VOL.spread))).toBeInTheDocument();
    expect(within(engine).getByText(`${wad(VOL.sigmaMin, 2)} – ${wad(VOL.sigmaMax, 2)}`)).toBeInTheDocument();
    expect(within(engine).getByText(wad(VOL.lambdaPerDay, 2))).toBeInTheDocument();
    expect(screen.queryByText(/Observation interval/)).toBeNull();
    // Metric values carry no "—" placeholders in the live state.
    for (const v of metricValues(container)) expect(v).not.toContain('—');
  });

  it('renders one pool card per POOL_KEYS with NAV, free liquidity, utilisation and cfg-derived caps', () => {
    const s = liveSnapshot();
    const { container } = renderWithChain(<Overview />, { snapshot: s });
    expect(poolCards(container)).toHaveLength(POOL_KEYS.length);
    for (const k of POOL_KEYS) {
      const c = card(container, k), p = s.pools[k];
      // NAV and free liquidity sit in labelled cells (Pool C: both 90.26 in the fixture, so match by label → value).
      // "totalAssets" sits in a <span class="sym"> so the uppercase label keeps the identifier's case (Task 6b, finding 2).
      const nav = within(c).getByText((_, el) => el?.classList.contains('data-label') === true && el.textContent === 'NAV (totalAssets)');
      expect(within(nav).getByText('totalAssets')).toHaveClass('sym');
      expect(nav.nextElementSibling).toHaveTextContent(`${usdg(p.totalAssets)} ${POOLS[k].assetSymbol}`);
      expect(within(c).getByText('Free liquidity').nextElementSibling).toHaveTextContent(`${usdg(p.freeLiquidity)} ${POOLS[k].assetSymbol}`);
      expect(within(c).getByRole('meter')).toHaveAttribute('aria-valuemax', '100');
      expect(within(c).getByText(new RegExp(`Vega cap .*\\(${p.cfg.vegaCapBps / 100} % of capital ref\\)`))).toBeInTheDocument();
      expect(within(c).getByText(new RegExp(`\\(${p.cfg.maxUtilBps / 100} %\\)`))).toBeInTheDocument();
      expect(within(c).getByRole('link', { name: `Open Pool ${k} on Arbiscan` })).toHaveAttribute('href', explorerAddress(POOLS[k].pool));
      expect(within(c).queryByText('Trading paused')).toBeNull();
    }
    // Pool A utilisation from the selector: netVega / vegaCap = 2,100 / 50,000 = 4.20 %.
    expect(within(card(container, 'A')).getByText('4.20 %')).toBeInTheDocument();
  });

  it('counts down to the next board expiry from block time and labels the boards', () => {
    const s = liveSnapshot();
    renderWithChain(<Overview />, { snapshot: s, nowMs: s.fetchedAtMs });
    const boards = boardViews(s, liveParity(s));
    const next = nextBoard(boards)!;
    expect(next.board.id).toBe(BOARDS[0]!.id);
    expect(screen.getByText(fmtCountdown(next.board.expiry - BLOCK_TIME))).toBeInTheDocument();
    expect(screen.getAllByText(/from block/).length).toBeGreaterThanOrEqual(1);
    for (const b of BOARDS) expect(screen.getByRole('heading', { level: 3, name: `Board #${b.id}` })).toBeInTheDocument();
  });

  it('board summary: ATM ± 2 rows per board, 1-unit buy quotes per pool, revert name where a quote is missing', () => {
    const s = liveSnapshot();
    const { container } = renderWithChain(<Overview />, { snapshot: s });
    const views = boardViews(s, liveParity(s));
    for (const b of views) {
      const panel = container.querySelector<HTMLElement>(`article[aria-label="Board #${b.board.id}"]`)!;
      const rows = within(panel).getAllByRole('row').slice(1);         // minus header
      const expected = atmWindow(b.series, s.feed.spotWad);
      expect(rows).toHaveLength(expected.length);
      expect(expected.length).toBe(Math.min(5, b.series.length));
      rows.forEach((tr, i) => {
        const r = expected[i]!;
        for (const k of POOL_KEYS) expect(within(tr).getAllByText(quoteCell(r, k)).length).toBeGreaterThanOrEqual(1);
        if (r.atm) expect(tr).toHaveClass('series-row--atm');
      });
    }
    expect(views.flatMap((b) => b.series).filter((r) => r.atm)).toHaveLength(1);
    // The last series carries `buyError: 'SeriesExpired'` in the fixture: quoteCell shows the revert name, never a blank.
    const last = seriesViews(s, liveParity(s))[ALL_SERIES.length - 1]!;
    for (const k of POOL_KEYS) expect(quoteCell(last, k)).toBe('SeriesExpired');
  });

  it('parity panel: n ✓ / n live and the gas line wording', () => {
    const s = liveSnapshot();
    renderWithChain(<Overview />, { snapshot: s });
    const live = seriesViews(s, liveParity(s)).filter((r) => r.status[POOL_KEYS[0]!] === 'open').length;
    expect(screen.getByText(`${live} ✓ / ${live} live`)).toHaveClass('status-pill--good');
    expect(screen.getByText(/eth_estimateGas of buy\(1 unit\)/)).toBeInTheDocument();
    expect(screen.getByText(/byte-identical math for identical inputs/)).toBeInTheDocument();
    expect(screen.getAllByText(/Δ is inventory, not math/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('369,316')).toBeInTheDocument();                         // liveGas() fixture, A
    expect(screen.getByText('327,312')).toBeInTheDocument();                         // B
    expect(screen.getByText(`${(369_316 / 327_312).toFixed(2)}×`)).toBeInTheDocument();
  });

  it('parity ✗ is red, counted and listed by series label; parity [] reads as pending', () => {
    const s = liveSnapshot();
    const bad = 2;
    const parity = liveParity(s).map((p, i) => (i === bad ? { ...p, ok: false, priceStylus: p.priceSol! + 1n } : p));
    renderWithChain(<Overview />, { snapshot: s, parity });
    const rows = seriesViews(s, parity);
    const sum = paritySummary(rows);
    expect(sum.bad).toBe(1);
    const pill = screen.getByText(`1 ✗ · ${sum.ok} ✓ / ${sum.live} live`);
    expect(pill).toHaveClass('status-pill--bad');
    const list = screen.getByRole('list', { name: /parity mismatch/ });
    expect(within(list).getByText(refLabel(ALL_SERIES[bad]!))).toBeInTheDocument();
    cleanup();
    renderWithChain(<Overview />, { snapshot: s, parity: [] });
    expect(screen.getByText(/Parity pending/)).toBeInTheDocument();
  });

  it('shows "Trading paused" only on the paused pool', () => {
    const k = POOL_KEYS[POOL_KEYS.length - 1]!;
    const { container } = renderWithChain(<Overview />, { snapshot: withPaused(liveSnapshot(), k) });
    expect(within(card(container, k)).getByText('Trading paused')).toBeInTheDocument();
    for (const other of POOL_KEYS.filter((x) => x !== k)) expect(within(card(container, other)).queryByText('Trading paused')).toBeNull();
  });

  it('oracle stale: feed card warns with the cfg-derived window and quotes show OracleStale', () => {
    renderWithChain(<Overview />, { snapshot: withOracleStale(liveSnapshot()) });
    expect(screen.getByText(/older than heartbeat × staleMult/)).toBeInTheDocument();
    expect(screen.getAllByText('OracleStale').length).toBeGreaterThan(0);
  });

  it('settled board: payout per unit in the buy cells, S_T per pool in the pill, next expiry moves to the next board', () => {
    const s = withSettled(liveSnapshot(), BOARDS[0]!.id, 2900);
    const { container } = renderWithChain(<Overview />, { snapshot: s, nowMs: s.fetchedAtMs });
    const panel = container.querySelector<HTMLElement>(`article[aria-label="Board #${BOARDS[0]!.id}"]`)!;
    expect(within(panel).getByText(new RegExp(`settled @ ${POOL_KEYS.map((k) => `${wad(s.pools[k].boards[0]!.settlementPrice, 2)} \\(${k}\\)`).join(' / ')}`))).toBeInTheDocument();
    const call2400 = seriesViews(s, liveParity(s)).find((r) => r.ref.boardId === BOARDS[0]!.id && r.ref.strike === 2400 && r.ref.isCall)!;
    expect(quoteCell(call2400, POOL_KEYS[0]!)).toBe(`settled @ ${usdg6(500n * 10n ** 6n)}/unit`);
    if (BOARDS.length > 1) {
      const next = nextBoard(boardViews(s, liveParity(s)))!;
      expect(next.board.id).toBe(BOARDS[1]!.id);
      expect(screen.getByText(fmtCountdown(next.secondsToExpiry))).toBeInTheDocument();
    }
  });

  it('expired-awaiting-settle and blackout are named, never blank', () => {
    const lastBoard = BOARDS[BOARDS.length - 1]!;
    renderWithChain(<Overview />, { snapshot: withExpired(liveSnapshot(), lastBoard.id) });
    expect(screen.getAllByText('expired — awaiting settle').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('expired')).toBeInTheDocument();                         // next-expiry metric value
    cleanup();
    renderWithChain(<Overview />, { snapshot: withBlackout(liveSnapshot(), ALL_SERIES.length - 1) });
    expect(screen.getAllByText(/blackout/).length).toBeGreaterThanOrEqual(2);       // metric meta + board pill
  });
});

describe('Overview — events and σ_base chart', () => {
  it('previews the 5 newest pool events with explorer links and draws the Observed series', () => {
    const events = liveEvents();
    const { container } = renderWithChain(<Overview />, { snapshot: liveSnapshot(), events, eventsState: 'live' });
    const list = screen.getByRole('list', { name: 'Latest pool events' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(5);
    const newest = liveTrades()[0]!;
    expect(within(rows[0]!).getByText(newest.kind)).toBeInTheDocument();
    expect(within(rows[0]!).getByText(newest.label)).toBeInTheDocument();
    expect(within(rows[0]!).getByText(newest.amount)).toBeInTheDocument();
    expect(within(rows[0]!).getByLabelText(`Pool ${newest.pool}`)).toBeInTheDocument();
    expect(within(rows[0]!).getByTitle(newest.tx)).toHaveAttribute('href', explorerTx(newest.tx));
    expect(screen.getByText(`Latest 5 of ${events.trades.length} events since deploy · newest first`)).toBeInTheDocument();
    expect(screen.getByText('Live')).toHaveClass('status-pill--good');
    // Chart: one line path, last point, footer with the newest observation; y labels = max/min σ.
    const obs = liveObserved();
    const last = obs[obs.length - 1]!;
    expect(container.querySelector('path.sigma-line')).not.toBeNull();
    expect(screen.getByText(new RegExp(`${obs.length} observations since deploy · last σ_base ${wad(last.sigmaBase)} at block ${last.block}`))).toBeInTheDocument();
    expect(screen.getByText(wad(obs[0]!.sigmaBase))).toBeInTheDocument();           // min label (0.5200)
    expect(screen.queryByText(/No Observed events/)).toBeNull();
    // Hover tooltip: block and σ of the nearest point (rightmost x → newest observation).
    const svg = container.querySelector<SVGSVGElement>('svg.engine-chart')!;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 720, height: 220, right: 720, bottom: 220, x: 0, y: 0, toJSON() {} }) as DOMRect;
    fireEvent.mouseMove(svg, { clientX: 720, clientY: 100 });
    expect(screen.getByText(new RegExp(`block ${last.block} · σ_base ${wad(last.sigmaBase)}`))).toBeInTheDocument();
    fireEvent.mouseLeave(svg);
    expect(screen.queryByText(new RegExp(`block ${last.block} · σ_base`))).toBeNull();
  });

  it('empty feed states are honest per eventsState', () => {
    renderWithChain(<Overview />, { snapshot: liveSnapshot(), eventsState: 'seed' });
    expect(screen.getByText('No events loaded yet')).toBeInTheDocument();
    expect(screen.getByText('No Observed events loaded yet')).toBeInTheDocument();
    expect(screen.getByText('No scan yet')).toBeInTheDocument();
    cleanup();
    renderWithChain(<Overview />, { snapshot: liveSnapshot(), eventsState: 'error' });
    expect(screen.getAllByText(/scan failed/i).length).toBeGreaterThanOrEqual(2);
    cleanup();
    renderWithChain(<Overview />, { snapshot: liveSnapshot(), eventsState: 'live' });
    expect(screen.getByText('No pool events since deploy')).toBeInTheDocument();
    expect(screen.getByText('No observations since deploy')).toBeInTheDocument();
  });
});

describe('Overview — loading, first-load failure and stale', () => {
  it('snapshot null: skeleton without any number; every empty value says "Awaiting snapshot"', () => {
    const { container } = renderWithChain(<Overview />, { snapshot: null });
    const values = metricValues(container);
    expect(values).toHaveLength(4);
    for (const v of values) { expect(v).not.toMatch(/\d/); expect(v).toContain('Awaiting snapshot'); }
    expect(screen.getAllByText('Awaiting snapshot').length).toBeGreaterThanOrEqual(4 + 2 * POOL_KEYS.length);
    expect(poolCards(container)).toHaveLength(POOL_KEYS.length);
    for (const strong of Array.from(container.querySelectorAll('.pool-card__nav strong'))) expect(strong.textContent).not.toMatch(/\d/);
    expect(screen.getByText('Parity — awaiting snapshot')).toBeInTheDocument();
    expect(screen.queryByText('2,579.49')).toBeNull();
    expect(screen.queryByText(/RPC error/)).toBeNull();
  });

  it('first load failed (meta.error && !snapshot): empty values explain "RPC error — retrying", still no numbers', () => {
    const { container } = renderWithChain(<Overview />, { snapshot: null, meta: { error: 'HTTP request failed.' } });
    for (const v of metricValues(container)) { expect(v).not.toMatch(/\d/); expect(v).toContain('RPC error — retrying'); }
    expect(screen.getAllByText('RPC error — retrying').length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText('Awaiting snapshot')).toBeNull();
  });

  it('stale snapshot keeps every value on screen (the banner and badge live in Layout)', () => {
    const s = withStale(liveSnapshot());
    const { state } = renderWithChain(<Overview />, { snapshot: s });
    expect(state.meta.stale).toBe(true);
    expect(state.meta.error).not.toBeNull();
    expect(screen.getByText('2,579.49')).toBeInTheDocument();
    for (const k of POOL_KEYS) expect(screen.getAllByText(usdg(s.pools[k].totalAssets)).length).toBeGreaterThanOrEqual(1);
  });
});
