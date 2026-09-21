// BoardSummary.tsx — papan ringkas Overview dari selector `useBoards()`: per board (manifest) baris ATM ± 2, kuotasi buy 1 unit per pool
// (6 dp, atau ALASAN kuotasi kosong: nama revert / blackout / expired / settled @ payout), paritas K5 dan σ_buy per pool. Tabel penuh = Boards (Task 4).
import { memo } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { POOL_KEYS, type PoolKey } from '@chain/deployment';
import { fmtCountdown, usdg6, utc, wad } from '@chain/ui/format';
import { seriesLabel } from '@chain/chain/trade';
import { ASSET_SCALE, T_MIN, type BoardView, type SeriesView } from '@/chain/selectors';
import { EmptyValue, SkeletonLine, StatusPill, type PillTone } from '@/components/primitives';
import { boardsHref } from '@/lib/route';

/** Jendela ATM ± span baris: berpusat pada baris ATM board itu, atau pada call dengan strike terdekat spot bila board tidak memuat seri ATM. */
export function atmWindow(series: SeriesView[], spotWad: bigint, span = 2): SeriesView[] {
  if (series.length === 0) return series;
  let centre = series.findIndex((r) => r.atm);
  if (centre < 0) {
    const spot = Number(spotWad) / 1e18;
    const calls = series.map((r, i) => ({ r, i })).filter(({ r }) => r.ref.isCall);
    centre = (calls.length ? calls : series.map((r, i) => ({ r, i }))).reduce((best, cur) => (Math.abs(cur.r.ref.strike - spot) < Math.abs(best.r.ref.strike - spot) ? cur : best)).i;
  }
  const size = 2 * span + 1;
  let lo = Math.max(0, centre - span), hi = lo + size;
  if (hi > series.length) { hi = series.length; lo = Math.max(0, hi - size); }
  return series.slice(lo, hi);
}

/** Teks sel Buy bila kuotasi 1 unit tidak ada — alasan, bukan kosong (brief §5). */
export function quoteCell(r: SeriesView, k: PoolKey): string {
  const st = r.state[k];
  if (st.buy) return usdg6(st.buy.premium);
  if (st.settled) return `settled @ ${usdg6(st.payoutPerUnit / ASSET_SCALE)}/unit`;
  const status = r.status[k];
  if (status === 'blackout') return 'blackout';
  if (status === 'expired') return 'expired — awaiting settle';
  return st.buyError ?? '—';
}

export function boardPill(b: BoardView): { tone: PillTone; text: string } {
  switch (b.status) {
    case 'open': return { tone: 'good', text: `open · expires in ${fmtCountdown(b.secondsToExpiry)} (block time)` };
    case 'blackout': return { tone: 'warn', text: `blackout · ≤ ${T_MIN} s to expiry` };
    case 'expired': return { tone: 'warn', text: 'expired — awaiting settle' };
    case 'settled': return { tone: 'gold', text: `settled @ ${POOL_KEYS.map((k) => `${wad(b.settled[k].settlementPrice, 2)} (${k})`).join(' / ')}` };
  }
}

const parityMark = (r: SeriesView) => (r.parity === null ? '…' : r.parity.ok === null ? '—' : r.parity.ok ? '✓' : '✗');

export interface BoardSummaryProps {
  boards: BoardView[];
  /** Spot WAD dari snapshot untuk memusatkan jendela pada board tanpa seri ATM; null sebelum snapshot. */
  spotWad: bigint | null;
  emptyLabel?: string;
}

function BoardSummaryView({ boards, spotWad, emptyLabel = 'Awaiting snapshot' }: BoardSummaryProps) {
  if (boards.length === 0 || spotWad === null) {
    return (
      <div className="board-stack">
        <article className="panel">
          <div className="board-panel__head"><div className="board-title"><div className="board-index">#</div><div><h3>Boards</h3><p><EmptyValue label={emptyLabel} /></p></div></div></div>
          <div className="skeleton-rows" aria-hidden="true">{[0, 1, 2].map((i) => <SkeletonLine key={i} width={`${72 - i * 12}%`} />)}</div>
        </article>
      </div>
    );
  }
  return (
    <div className="board-stack">
      {boards.map((b) => {
        const pill = boardPill(b);
        const rows = atmWindow(b.series, spotWad);
        return (
          <article className="panel" key={b.board.id} aria-label={`Board #${b.board.id}`}>
            <div className="board-panel__head">
              <div className="board-title">
                <div className="board-index">#{b.board.id}</div>
                <div><h3>Board #{b.board.id}</h3><p>expiry {utc(b.board.expiry)}</p></div>
              </div>
              <div className="board-head-meta">
                <span className="board-series-count">{rows.length} of {b.series.length} series · ATM ± 2</span>
                <StatusPill tone={pill.tone}>{pill.text}</StatusPill>
              </div>
            </div>
            <div className="table-scroll">
              <table className="series-table">
                <thead>
                  <tr>
                    <th scope="col">Series</th>
                    {POOL_KEYS.map((k) => <th scope="col" key={k}>Buy {k}</th>)}
                    <th scope="col">Parity A|B</th>
                    <th scope="col">σ_buy {POOL_KEYS.join(' | ')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.i} className={`series-row ${r.atm ? 'series-row--atm' : ''}`}>
                      <td>
                        <div className="series-name">
                          <span className={`option-pill option-pill--${r.ref.isCall ? 'c' : 'p'}`}>{r.ref.isCall ? 'C' : 'P'}</span>
                          <div><strong>{r.atm ? <span className="atm-dot" title="ATM — nearest strike to spot on the nearest open board" /> : null}{seriesLabel(r.ref)}</strong><small>{r.ref.isCall ? 'call' : 'put'} · K {r.ref.strike}</small></div>
                        </div>
                      </td>
                      {POOL_KEYS.map((k) => <td key={k} className={r.state[k].buy ? 'mono' : 'muted-text'}>{quoteCell(r, k)}</td>)}
                      <td><span className={`parity ${r.parity === null ? 'pending' : ''}`} data-parity={r.parity?.ok === false ? 'bad' : r.parity?.ok ? 'ok' : 'none'}>{parityMark(r)}</span></td>
                      <td className="mono">{POOL_KEYS.some((k) => r.state[k].buy) ? POOL_KEYS.map((k) => (r.state[k].buy ? wad(r.state[k].buy!.sigma) : '—')).join(' | ') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="board-panel__foot">
              <span>Quotes are per <strong>1.0 unit</strong> at each pool's own inventory (σ_mark(util)) — indicative view quotes; Δ is inventory, not math.</span>
              <a href={boardsHref(b.board.id)} className="soft-button">Full board <ArrowUpRight size={14} /></a>
            </div>
          </article>
        );
      })}
    </div>
  );
}

/** Memo pada `boards` (identitas stabil per snapshot + parity). */
export const BoardSummary = memo(BoardSummaryView);
