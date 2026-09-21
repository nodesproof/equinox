// test/pages/boards.test.tsx — Boards dirender dari fixture ChainContext (tanpa provider/jaringan): satu panel per board manifest, baris = ALL_SERIES,
// semantik kolom board.ts (Buy/status, Δ, Close, Parity, OI, σ_buy), ATM, REVERT_TEXT, settled/blackout/expired/oracle stale, paritas ✗, detail
// Greeks, tautan Trade, filter bar, deep link ?board=, skeleton, stale, catatan kaki. Angka harapan dihitung dari fixture + formatter — tanpa literal.
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ALL_SERIES, BOARDS, GAS_KEYS, POOLS, POOL_KEYS } from '@chain/deployment';
import { relDiff, usdg6, utc, wad } from '@chain/ui/format';
import { REVERT_TEXT, seriesLabel } from '@chain/chain/trade';
import Boards from '@/pages/Boards';
import Overview from '@/pages/Overview';
import { boardPill } from '@/components/BoardSummary';
import { columnCount } from '@/components/BoardTable';
import { boardViews, seriesViews, type SeriesView } from '@/chain/selectors';
import { DEFAULT_TRADE_POOL, K0, boardNote, buyCell, closeCell, deltaCell, filterSeries, isOpenSeries, oiCell, parityCell, sharedStatus, sigmaCell } from '@/lib/boards';
import { boardsHref, tradeHref } from '@/lib/route';
import { expiryLabel, wadExact } from '@/lib/format';
import { renderWithChain } from '../render';
import { BLOCK, liveParity, liveSnapshot, withBlackout, withExpired, withOracleStale, withSettled, withStale } from '../fixtures/snapshot';

afterEach(() => { cleanup(); window.location.hash = ''; });

const panel = (container: HTMLElement, id: number) => container.querySelector<HTMLElement>(`article[aria-label="Board #${id}"]`)!;
const dataRows = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('tbody tr.series-row'));
const row = (container: HTMLElement, i: number) => container.querySelector<HTMLElement>(`tr.series-row[data-series="${i}"]`)!;
const cells = (tr: HTMLElement) => Array.from(tr.querySelectorAll<HTMLElement>('td'));
const views = (s = liveSnapshot(), parity = liveParity(s)) => seriesViews(s, parity);
const expandButton = (r: SeriesView) => screen.getByRole('button', { name: `Show Greeks for ${seriesLabel(r.ref)}` });

describe('Boards — live snapshot', () => {
  it('renders one panel per manifest board with every series, the expiry in UTC, the status pill and the snapshot block', () => {
    const s = liveSnapshot();
    const { container } = renderWithChain(<Boards />, { snapshot: s, nowMs: s.fetchedAtMs });
    expect(screen.getByRole('heading', { level: 2, name: 'Boards & series' })).toBeInTheDocument();
    expect(screen.getByText(`block ${BLOCK} · ${utc(s.blockTime)}`)).toHaveClass('status-pill--good');
    const boards = boardViews(s, liveParity(s));
    expect(container.querySelectorAll('article.board-panel')).toHaveLength(BOARDS.length);
    for (const b of boards) {
      const p = panel(container, b.board.id);
      expect(within(p).getByRole('heading', { level: 3, name: `Board #${b.board.id}` })).toBeInTheDocument();
      // Expiry on one line ("25 Sep 2026 · 08:00 UTC"), the ISO form kept as the <time> title (Task 6b, finding 4).
      const time = within(p).getByText(expiryLabel(b.board.expiry));
      expect(time.tagName).toBe('TIME');
      expect(time).toHaveAttribute('title', utc(b.board.expiry));
      expect(time.parentElement).toHaveTextContent(`expiry ${expiryLabel(b.board.expiry)}`);
      expect(within(p).getByText(boardPill(b).text)).toBeInTheDocument();
      expect(within(p).getByText(`${b.series.length} series`)).toBeInTheDocument();
      expect(dataRows(p)).toHaveLength(b.series.length);
      // Header per pool from POOL_KEYS (never a literal count).
      for (const k of POOL_KEYS) for (const col of ['Buy', 'Close', 'OI']) expect(within(p).getByRole('columnheader', { name: `${col} ${k}` })).toBeInTheDocument();
      expect(within(p).getByRole('columnheader', { name: `σ_buy ${POOL_KEYS.join(' | ')}` })).toBeInTheDocument();
    }
    expect(dataRows(container)).toHaveLength(ALL_SERIES.length);
    expect(screen.getByText(`${ALL_SERIES.length} of ${ALL_SERIES.length} series`)).toBeInTheDocument();
  });

  it('every cell follows board.ts: Buy per pool (6 dp), Δ A|B (relDiff or =), Close, Parity, OI (2 dp), σ_buy A | B | C; exactly one ATM row', () => {
    const s = liveSnapshot();
    const { container } = renderWithChain(<Boards />, { snapshot: s });
    const rows = views(s);
    for (const r of rows) {
      const tr = row(container, r.i);
      const tds = cells(tr);
      const shared = sharedStatus(r);
      const expected = [
        ...(shared ? [shared.text] : POOL_KEYS.map((k) => buyCell(r, k).text)),
        deltaCell(r).text,
        ...POOL_KEYS.map((k) => closeCell(r, k)),
        parityCell(r).text,
        ...POOL_KEYS.map((k) => oiCell(r, k)),
        sigmaCell(r),
      ];
      expect(tds.slice(1, 1 + expected.length).map((td) => td.textContent)).toEqual(expected);
      expect(tds[0]).toHaveTextContent(seriesLabel(r.ref));
      expect(within(tds[0]!).getByText(r.ref.isCall ? 'C' : 'P')).toHaveClass(`option-pill--${r.ref.isCall ? 'c' : 'p'}`);
      expect(tr).toHaveAttribute('data-status', r.status[K0]);
      if (r.state[K0].buy) {
        // Quotes really are usdg6 of the fixture premium; the A/B gap is inventory (σ_buy differs) → relDiff, tagged as a difference.
        expect(tds[1]).toHaveTextContent(usdg6(r.state[K0].buy!.premium));
        expect(tds[1]).toHaveClass('mono');
        const a = r.state[GAS_KEYS[0]]?.buy, b = r.state[GAS_KEYS[1]]?.buy;
        if (a && b) {
          const delta = tr.querySelector('[data-delta]')!;
          expect(delta).toHaveAttribute('data-delta', a.premium === b.premium ? 'same' : 'diff');
          expect(delta.textContent).toBe(a.premium === b.premium ? '=' : relDiff(a.premium, b.premium));
        }
        expect(tr.querySelector('[data-parity]')).toHaveAttribute('data-parity', 'ok');
        expect(tr.querySelector('[data-parity]')!.textContent).toBe('✓');
      }
      expect(within(tr).getByRole('link', { name: 'Trade' })).toHaveAttribute('href', tradeHref(DEFAULT_TRADE_POOL, r.i));
    }
    const atm = container.querySelectorAll('tr.series-row--atm');
    expect(atm).toHaveLength(1);
    expect(atm[0]).toHaveAttribute('data-series', String(rows.find((r) => r.atm)!.i));
    expect(within(atm[0] as HTMLElement).getByTitle(/ATM — nearest strike to spot/)).toBeInTheDocument();
    // Trade goes to Pool B (the Stylus pool) when the manifest has it.
    expect(DEFAULT_TRADE_POOL).toBe(POOL_KEYS.includes('B') ? 'B' : POOL_KEYS[0]);
  });

  it('a series whose quoteBuy reverted shows the human REVERT_TEXT once across the Buy columns, with the revert name as title', () => {
    const s = liveSnapshot();
    const { container } = renderWithChain(<Boards />, { snapshot: s });
    const last = views(s)[ALL_SERIES.length - 1]!;
    expect(sharedStatus(last)?.name).toBe('SeriesExpired');
    const tr = row(container, last.i);
    const merged = within(tr).getByText(REVERT_TEXT.SeriesExpired!);
    expect(merged).toHaveAttribute('colspan', String(POOL_KEYS.length));
    expect(merged).toHaveAttribute('title', 'SeriesExpired');
    expect(merged).toHaveClass('quote-status');
    // No quote pair → Δ and σ_buy fall back to '—' (never blank), close '—'.
    expect(tr.querySelector('[data-delta]')).toHaveAttribute('data-delta', 'none');
    expect(cells(tr).map((td) => td.textContent)).toContain('—');
    for (const td of cells(tr).slice(1, -1)) expect(td.textContent).not.toBe('');
  });

  it('oracle stale: every unsettled series shows REVERT_TEXT.OracleStale in place of the quotes', () => {
    const s = withOracleStale(liveSnapshot());
    renderWithChain(<Boards />, { snapshot: s });
    const stale = views(s).filter((r) => r.state[K0].buyError === 'OracleStale');
    expect(stale.length).toBeGreaterThan(0);
    expect(screen.getAllByText(REVERT_TEXT.OracleStale!)).toHaveLength(stale.length);
    expect(screen.getAllByTitle('OracleStale')).toHaveLength(stale.length);
  });
});

describe('Boards — row and board states', () => {
  it('settled board: S_T per pool in the pill, "settled @ payout/unit" in the Buy columns, rows tagged settled, parity —', () => {
    const s = withSettled(liveSnapshot(), BOARDS[0]!.id, 2900);
    const { container } = renderWithChain(<Boards />, { snapshot: s });
    const b = boardViews(s, liveParity(s))[0]!;
    const p = panel(container, b.board.id);
    expect(p).toHaveAttribute('data-status', 'settled');
    expect(within(p).getByText(`settled @ ${POOL_KEYS.map((k) => `${wad(s.pools[k].boards[0]!.settlementPrice, 2)} (${k})`).join(' / ')}`)).toBeInTheDocument();
    for (const r of b.series) {
      const tr = row(container, r.i);
      expect(tr).toHaveAttribute('data-status', 'settled');
      const payout = usdg6(r.state[K0].payoutPerUnit / 10n ** 12n);
      const merged = within(tr).getByText(`settled @ ${payout}/unit`);
      expect(merged).toHaveAttribute('colspan', String(POOL_KEYS.length));
      expect(merged).toHaveAttribute('title', 'SeriesSettled');
      expect(tr.querySelector('[data-parity]')!.textContent).toBe('—');
    }
    const call2400 = b.series.find((r) => r.ref.strike === 2400 && r.ref.isCall)!;
    expect(within(row(container, call2400.i)).getByText(`settled @ ${usdg6(500n * 10n ** 6n)}/unit`)).toBeInTheDocument();
    // Open interest survives settlement (units await claim) and is still printed with 2 dp.
    expect(within(row(container, call2400.i)).getAllByText(wad(call2400.state[K0].oi, 2)).length).toBeGreaterThanOrEqual(1);
  });

  it('blackout board shows "blackout" per series and the boards before it "expired — awaiting settle"', () => {
    const lastBoard = BOARDS[BOARDS.length - 1]!;
    const idx = ALL_SERIES.findIndex((r) => r.boardId === lastBoard.id);
    const s = withBlackout(liveSnapshot(), idx);
    const { container } = renderWithChain(<Boards />, { snapshot: s });
    const boards = boardViews(s, liveParity(s));
    const black = boards.find((b) => b.board.id === lastBoard.id)!;
    expect(black.status).toBe('blackout');
    const p = panel(container, lastBoard.id);
    expect(within(p).getByText(boardPill(black).text)).toHaveClass('status-pill--warn');
    expect(within(p).getAllByText('blackout')).toHaveLength(black.series.length);
    for (const b of boards.filter((x) => x.status === 'expired')) {
      const q = panel(container, b.board.id);
      expect(within(q).getAllByText('expired — awaiting settle')).toHaveLength(b.series.length + 1);   // pill + one merged cell per row
      for (const r of b.series) expect(row(container, r.i)).toHaveAttribute('data-status', 'expired');
    }
  });

  it('expired board (not yet settled) reads "expired — awaiting settle" in the pill and every row', () => {
    const s = withExpired(liveSnapshot(), BOARDS[0]!.id);
    const { container } = renderWithChain(<Boards />, { snapshot: s });
    const b = boardViews(s, liveParity(s))[0]!;
    expect(b.status).toBe('expired');
    const p = panel(container, b.board.id);
    expect(p).toHaveAttribute('data-status', 'expired');
    expect(within(p).getAllByText('expired — awaiting settle')).toHaveLength(b.series.length + 1);
  });

  it('parity ✗ is red in the row and explained in the detail with both math prices; parity [] reads as pending', () => {
    const s = liveSnapshot();
    const bad = 2;
    const parity = liveParity(s).map((p, i) => (i === bad ? { ...p, ok: false, priceStylus: p.priceSol! + 1n } : p));
    const { container } = renderWithChain(<Boards />, { snapshot: s, parity });
    const r = seriesViews(s, parity)[bad]!;
    const tr = row(container, bad);
    const mark = tr.querySelector('[data-parity]')!;
    expect(mark.textContent).toBe('✗');
    expect(mark).toHaveAttribute('data-parity', 'bad');
    expect(container.querySelectorAll('[data-parity="bad"]')).toHaveLength(1);
    fireEvent.click(expandButton(r));
    const detail = within(container.querySelector<HTMLElement>(`#series-detail-${bad}`)!).getByRole('region', { name: 'K5 math parity' });
    // A 1-wei mismatch must stay visible: on ✗ both prices are printed as exact WAD (18 dp), never rounded to 6 dp (brief §7.5).
    expect(wadExact(r.parity!.priceSol!)).not.toBe(wadExact(r.parity!.priceStylus!));
    expect(within(detail).getByText(wadExact(r.parity!.priceSol!))).toBeInTheDocument();
    expect(within(detail).getByText(wadExact(r.parity!.priceStylus!))).toBeInTheDocument();
    expect(within(detail).queryByText(wad(r.parity!.priceSol!, 6))).toBeNull();
    expect(within(detail).getByText(`mismatch · rel. diff ${relDiff(r.parity!.priceSol!, r.parity!.priceStylus!)}`)).toHaveClass('parity-bad');
    cleanup();
    const { container: c2 } = renderWithChain(<Boards />, { snapshot: s, parity: [] });
    expect(c2.querySelectorAll('[data-parity="pending"]')).toHaveLength(ALL_SERIES.length);
    expect(c2.querySelector('[data-parity="pending"]')!.textContent).toBe('…');
  });

  it('stale snapshot: the table keeps the last data (banner lives in Layout)', () => {
    const s = withStale(liveSnapshot());
    const { container, state } = renderWithChain(<Boards />, { snapshot: s });
    expect(state.meta.stale).toBe(true);
    expect(state.meta.error).not.toBeNull();
    expect(dataRows(container)).toHaveLength(ALL_SERIES.length);
    expect(screen.getByText(`block ${BLOCK} · ${utc(s.blockTime)}`)).toBeInTheDocument();
  });
});

describe('Boards — series detail', () => {
  it('expanding a row reveals the Greeks per pool from quoteBuy, premium + fee, close, OI, K5 prices and per-pool Trade links; collapsing hides it', () => {
    const s = liveSnapshot();
    const { container } = renderWithChain(<Boards />, { snapshot: s });
    const r = views(s).find((x) => x.atm)!;
    expect(container.querySelector(`#series-detail-${r.i}`)).toBeNull();
    const button = expandButton(r);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const detail = container.querySelector<HTMLElement>(`#series-detail-${r.i}`)!;
    expect(detail).toHaveClass('series-detail');
    expect(detail.querySelector('td')).toHaveAttribute('colspan', String(columnCount()));
    expect(columnCount()).toBe(5 + 3 * POOL_KEYS.length);
    for (const k of POOL_KEYS) {
      const q = r.state[k].buy!;
      const block = within(detail).getByRole('region', { name: `Pool ${k} Greeks` });
      const value = (label: string) => within(block).getByText(label).nextElementSibling!.textContent;
      expect(value('δ delta')).toBe(wad(q.delta, 2));
      expect(value('vega / unit')).toBe(wad(q.vega, 4));
      expect(value('σ effective')).toBe(wad(q.sigma));
      expect(value('spot (quote)')).toBe(`${wad(q.spot, 2)} USD`);
      expect(value('premium / unit')).toBe(`${usdg6(q.premium)} ${POOLS[k].assetSymbol}`);
      expect(value('fee / unit')).toBe(`${usdg6(q.fee)} ${POOLS[k].assetSymbol}`);
      expect(value('premium + fee')).toBe(`${usdg6(q.premium + q.fee)} ${POOLS[k].assetSymbol}`);
      expect(value('close / unit')).toBe(`${usdg6(r.state[k].close!)} ${POOLS[k].assetSymbol}`);
      expect(value('open interest')).toBe(`${wad(r.state[k].oi, 2)} units`);
      expect(within(block).getByText('open')).toHaveClass('status-pill--good');
      expect(within(block).getByRole('link', { name: `Trade on ${k}` })).toHaveAttribute('href', tradeHref(k, r.i));
    }
    // Delta of an ATM call is signed and near 0.5; a put would be negative — the fixture Black-Scholes decides, the UI only formats.
    expect(Number(wad(r.state[K0].buy!.delta, 2))).toBeGreaterThan(0);
    const k5 = within(detail).getByRole('region', { name: 'K5 math parity' });
    expect(within(k5).getByText(`${GAS_KEYS[0]} Solidity`).nextElementSibling).toHaveTextContent(wad(r.parity!.priceSol!, 6));
    expect(within(k5).getByText(`${GAS_KEYS[1]} Stylus`).nextElementSibling).toHaveTextContent(wad(r.parity!.priceStylus!, 6));
    expect(within(k5).getByText('byte-identical')).toBeInTheDocument();
    expect(within(k5).getByText(/never by math/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: `Hide Greeks for ${seriesLabel(r.ref)}` }));
    expect(container.querySelector(`#series-detail-${r.i}`)).toBeNull();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('a put shows a negative delta; a series without a quote explains why and still shows OI (and the payout once settled)', () => {
    const s = withSettled(liveSnapshot(), BOARDS[0]!.id, 2900);
    const { container } = renderWithChain(<Boards />, { snapshot: s });
    const rows = views(s);
    const put = rows.find((r) => !r.ref.isCall && r.state[K0].buy)!;
    fireEvent.click(expandButton(put));
    const putDetail = container.querySelector<HTMLElement>(`#series-detail-${put.i}`)!;
    expect(within(putDetail).getAllByText(wad(put.state[K0].buy!.delta, 2))[0]!.textContent!.startsWith('-')).toBe(true);
    const settled = rows.find((r) => r.ref.boardId === BOARDS[0]!.id && r.ref.strike === 2400 && r.ref.isCall)!;
    fireEvent.click(expandButton(settled));
    const detail = container.querySelector<HTMLElement>(`#series-detail-${settled.i}`)!;
    for (const k of POOL_KEYS) {
      const block = within(detail).getByRole('region', { name: `Pool ${k} Greeks` });
      expect(within(block).getByText('no buy quote').nextElementSibling).toHaveTextContent(`settled @ ${usdg6(settled.state[k].payoutPerUnit / 10n ** 12n)}/unit`);
      expect(within(block).getByText('payout / unit').nextElementSibling).toHaveTextContent(`${usdg6(settled.state[k].payoutPerUnit / 10n ** 12n)} ${POOLS[k].assetSymbol}`);
      expect(within(block).getByText('open interest').nextElementSibling).toHaveTextContent(`${wad(settled.state[k].oi, 2)} units`);
      expect(within(block).getByText('settled')).toHaveClass('status-pill--gold');
    }
    expect(within(within(detail).getByRole('region', { name: 'K5 math parity' })).getByText(/unavailable/)).toBeInTheDocument();
  });
});

describe('Boards — filters and deep links', () => {
  it('board chips show one board, type chips keep calls or puts, "Open only" hides settled series and says so', () => {
    const s = withSettled(liveSnapshot(), BOARDS[0]!.id, 2900);
    const { container } = renderWithChain(<Boards />, { snapshot: s });
    const boards = boardViews(s, liveParity(s));
    const all = boards.flatMap((b) => b.series);
    const chip = (name: string) => screen.getByRole('button', { name });
    expect(chip('All boards')).toHaveAttribute('aria-pressed', 'true');
    // Puts only.
    fireEvent.click(chip('Puts'));
    expect(chip('Puts')).toHaveAttribute('aria-pressed', 'true');
    const puts = all.filter((r) => !r.ref.isCall);
    expect(dataRows(container)).toHaveLength(puts.length);
    for (const tr of dataRows(container)) expect(tr.querySelector('.option-pill')).toHaveClass('option-pill--p');
    expect(screen.getByText(`${puts.length} of ${all.length} series`)).toBeInTheDocument();
    fireEvent.click(chip('Calls & puts'));
    expect(dataRows(container)).toHaveLength(all.length);
    // Open only: the settled board has nothing open → honest empty line with the hidden count; total rows = open series.
    fireEvent.click(chip('Open only'));
    expect(chip('Open only')).toHaveAttribute('aria-pressed', 'true');
    const open = all.filter(isOpenSeries);
    expect(open).toEqual(filterSeries(all, { board: null, type: 'all', openOnly: true }));
    expect(dataRows(container)).toHaveLength(open.length);
    const settledPanel = panel(container, BOARDS[0]!.id);
    expect(within(settledPanel).getByText(`No series on this board match the current filter — ${boards[0]!.series.length} series hidden.`)).toBeInTheDocument();
    expect(within(settledPanel).getByText(`0 of ${boards[0]!.series.length} series`)).toBeInTheDocument();
    fireEvent.click(chip('Open only'));
    // One board.
    if (BOARDS.length > 1) {
      const b = BOARDS[1]!;
      fireEvent.click(chip(`#${b.id}`));
      expect(container.querySelectorAll('article.board-panel')).toHaveLength(1);
      expect(panel(container, b.id)).toBeInTheDocument();
      const n = all.filter((r) => r.ref.boardId === b.id).length;
      expect(dataRows(container)).toHaveLength(n);
      expect(screen.getByText(`${n} of ${n} series`)).toBeInTheDocument();
      fireEvent.click(chip('All boards'));
      expect(container.querySelectorAll('article.board-panel')).toHaveLength(BOARDS.length);
    }
  });

  it('#/boards?board=<id> preselects the board and follows later hash changes without a remount', () => {
    const target = BOARDS[BOARDS.length - 1]!;
    window.location.hash = boardsHref(target.id);
    const { container } = renderWithChain(<Boards />, { snapshot: liveSnapshot() });
    expect(container.querySelectorAll('article.board-panel')).toHaveLength(1);
    expect(panel(container, target.id)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `#${target.id}` })).toHaveAttribute('aria-pressed', 'true');
    // Another "Full board" link while already on the page: hashchange → filter follows.
    act(() => { window.location.hash = boardsHref(BOARDS[0]!.id); window.dispatchEvent(new Event('hashchange')); });
    expect(container.querySelectorAll('article.board-panel')).toHaveLength(1);
    expect(panel(container, BOARDS[0]!.id)).toBeInTheDocument();
    // An unknown board id is ignored (all boards).
    cleanup(); window.location.hash = '#/boards?board=999999';
    const { container: c2 } = renderWithChain(<Boards />, { snapshot: liveSnapshot() });
    expect(c2.querySelectorAll('article.board-panel')).toHaveLength(BOARDS.length);
  });

  it('Overview actions and the summary "Full board" links point at the Boards page', () => {
    const s = liveSnapshot();
    renderWithChain(<Overview />, { snapshot: s });
    expect(screen.getByRole('link', { name: /View all boards/ })).toHaveAttribute('href', '#/boards');
    expect(screen.getByRole('link', { name: /Compare series/ })).toHaveAttribute('href', '#/boards');
    const full = screen.getAllByRole('link', { name: /Full board/ });
    expect(full.map((a) => a.getAttribute('href'))).toEqual(BOARDS.map((b) => boardsHref(b.id)));
  });
});

describe('Boards — empty states and footnote', () => {
  it('without a snapshot: one skeleton panel per manifest board, no digits in the table, "Awaiting snapshot"; first-load failure reads "RPC error — retrying"', () => {
    const { container } = renderWithChain(<Boards />, { snapshot: null });
    expect(container.querySelectorAll('article.board-panel')).toHaveLength(BOARDS.length);
    expect(dataRows(container)).toHaveLength(0);
    expect(screen.getAllByText('Awaiting snapshot').length).toBeGreaterThanOrEqual(BOARDS.length + 1);
    for (const b of BOARDS) expect(within(panel(container, b.id)).getByText(expiryLabel(b.expiry))).toHaveAttribute('title', utc(b.expiry));
    expect(screen.getByText(`— of ${ALL_SERIES.length} series`)).toBeInTheDocument();
    expect(screen.getByText(/Gas: — awaiting snapshot/)).toBeInTheDocument();
    expect(screen.queryByText(/RPC error/)).toBeNull();
    cleanup();
    renderWithChain(<Boards />, { snapshot: null, meta: { error: 'HTTP request failed.' } });
    expect(screen.getAllByText('RPC error — retrying').length).toBeGreaterThanOrEqual(BOARDS.length + 1);
    expect(screen.queryByText('Awaiting snapshot')).toBeNull();
  });

  it('quotes the classic board footnote (inventory vs math, K5 wording, Pool C sentence when Pool C exists) and the gas line', () => {
    const s = liveSnapshot();
    renderWithChain(<Boards />, { snapshot: s });
    const note = screen.getByTestId('board-note');
    expect(note).toHaveTextContent(boardNote().join(' '));
    expect(note).toHaveTextContent('Quotes are per 1.0 unit at each pool\'s own inventory (σ_mark(util)); Δ is inventory, not math.');
    expect(note).toHaveTextContent('Parity ✓ = both math contracts (Solidity control vs Stylus) return byte-identical prices for identical inputs (S, K, t, σ_mark(0)) at this block — K5.');
    const poolC = 'Pool C: same Stylus math and engine as B, settled in Paxos USDG (testnet); its inventory term (σ_mark(util)) follows its own pool size.';
    if (POOL_KEYS.includes('C')) expect(note).toHaveTextContent(poolC); else expect(note).not.toHaveTextContent(poolC);
    expect(screen.getByText('369,316')).toBeInTheDocument();
    expect(screen.getByText('327,312')).toBeInTheDocument();
    expect(screen.getByText(`${(369_316 / 327_312).toFixed(2)}×`)).toBeInTheDocument();
    expect(screen.getByText(`block ${BLOCK}`)).toBeInTheDocument();
    // UTC everywhere; no "$".
    expect(document.body.textContent).not.toContain('$');
  });
});
