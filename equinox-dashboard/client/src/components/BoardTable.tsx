// BoardTable.tsx — satu panel per board (Boards): header (BoardHead: expiry satu baris + pill status countdown blok / blackout / expired — awaiting
// settle / settled @ S_T per pool), tabel penuh per seri: Series (pill C/P, strike, ATM), Buy k per pool (6 dp atau alasan), Δ A|B, Close k, Parity,
// OI k, σ_buy, tombol expand → SeriesDetail (Greeks), tautan Trade (prefill `#/trade?pool=B&series=i`). Semantik kolom = web/src/panels/board.ts.
// ≤ 640 px (usePhone) tabel diganti daftar kartu SeriesCards dengan helper sel yang sama; state expand dibagi keduanya.
import { memo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { POOL_KEYS } from '@chain/deployment';
import { seriesLabel } from '@chain/chain/trade';
import type { BoardView, SeriesView } from '@/chain/selectors';
import { BoardHead } from '@/components/BoardHead';
import { Scroller } from '@/components/Scroller';
import { SeriesCards } from '@/components/SeriesCards';
import { SeriesDetail } from '@/components/SeriesDetail';
import { keepSymbols } from '@/components/primitives';
import { usePhone } from '@/hooks/useMediaQuery';
import { DEFAULT_TRADE_POOL, K0, boardPill, buyCell, closeCell, deltaCell, oiCell, parityCell, sharedStatus, sigmaCell } from '@/lib/boards';
import { tradeHref } from '@/lib/route';

/** Jumlah kolom tabel: Series + Buy×pool + Δ + Close×pool + Parity + OI×pool + σ_buy + aksi (untuk colSpan baris detail). */
export const columnCount = () => 5 + 3 * POOL_KEYS.length;

function SeriesRow({ r, expanded, onToggle }: { r: SeriesView; expanded: boolean; onToggle: (i: number) => void }) {
  const shared = sharedStatus(r);
  const delta = deltaCell(r), parity = parityCell(r);
  const label = seriesLabel(r.ref);
  return (
    <>
      <tr className={`series-row ${r.atm ? 'series-row--atm' : ''} ${expanded ? 'series-row--open' : ''}`} data-series={r.i} data-status={r.status[K0]}>
        <td>
          <div className="series-name">
            <span className={`option-pill option-pill--${r.ref.isCall ? 'c' : 'p'}`}>{r.ref.isCall ? 'C' : 'P'}</span>
            <div><strong>{r.atm ? <span className="atm-dot" title="ATM — nearest strike to spot on the nearest open board" /> : null}{label}</strong><small>{r.ref.isCall ? 'call' : 'put'} · K {r.ref.strike}</small></div>
          </div>
        </td>
        {shared
          ? <td colSpan={POOL_KEYS.length} className="muted-text quote-status" title={shared.name ?? undefined}>{shared.text}</td>
          : POOL_KEYS.map((k) => { const c = buyCell(r, k); return <td key={k} className={c.kind === 'quote' ? 'mono' : 'muted-text quote-status'} title={c.name ?? undefined}>{c.text}</td>; })}
        <td className={`mono ${delta.same === true ? 'delta-same' : delta.same === null ? 'muted-text' : ''}`} data-delta={delta.same === null ? 'none' : delta.same ? 'same' : 'diff'}>{delta.text}</td>
        {POOL_KEYS.map((k) => <td key={k} className="mono">{closeCell(r, k)}</td>)}
        <td><span className={`parity ${parity.state === 'pending' ? 'pending' : ''}`} data-parity={parity.state}>{parity.text}</span></td>
        {POOL_KEYS.map((k) => <td key={k} className="mono">{oiCell(r, k)}</td>)}
        <td className="mono">{sigmaCell(r)}</td>
        <td>
          <div className="row-actions">
            <a className="soft-button" href={tradeHref(DEFAULT_TRADE_POOL, r.i)} title={`Open Trade with Pool ${DEFAULT_TRADE_POOL} and ${label} selected`}>Trade</a>
            <button type="button" className={`row-expand ${expanded ? 'rotate-180' : ''}`} aria-expanded={expanded} aria-controls={`series-detail-${r.i}`}
              aria-label={`${expanded ? 'Hide' : 'Show'} Greeks for ${label}`} onClick={() => onToggle(r.i)}><ChevronDown size={15} /></button>
          </div>
        </td>
      </tr>
      {expanded ? <tr className="series-detail" id={`series-detail-${r.i}`}><td colSpan={columnCount()}><SeriesDetail row={r} /></td></tr> : null}
    </>
  );
}

export interface BoardTableProps {
  board: BoardView;
  /** Baris yang lolos filter halaman (subset `board.series`, urutan manifest). */
  rows: SeriesView[];
}

function BoardTableView({ board, rows }: BoardTableProps) {
  // Seri yang diperluas (indeks global ALL_SERIES) — state lokal per panel agar toggle tidak merender ulang board lain; dibagi tabel ↔ kartu.
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  const toggle = (i: number) => setExpanded((prev) => { const next = new Set(prev); if (next.has(i)) next.delete(i); else next.add(i); return next; });
  const phone = usePhone();
  const total = board.series.length;
  return (
    <article className="panel board-panel" aria-label={`Board #${board.board.id}`} data-status={board.status}>
      <BoardHead id={board.board.id} expiry={board.board.expiry} pill={boardPill(board)} meta={rows.length === total ? `${total} series` : `${rows.length} of ${total} series`} />
      {rows.length === 0 ? (
        <p className="board-empty">No series on this board match the current filter — {total} series hidden.</p>
      ) : phone ? (
        <SeriesCards rows={rows} variant="full" expanded={expanded} onToggle={toggle} />
      ) : (
        <Scroller>
          <table className="series-table series-table--full">
            <thead>
              <tr>
                <th scope="col">Series</th>
                {POOL_KEYS.map((k) => <th scope="col" key={k}>Buy {k}</th>)}
                <th scope="col" title="Relative premium difference between Pool A and Pool B at their own inventory — '=' when identical">{keepSymbols('Δ A|B')}</th>
                {POOL_KEYS.map((k) => <th scope="col" key={k}>Close {k}</th>)}
                <th scope="col" title="K5: Solidity control vs Stylus math, byte-identical for identical inputs">Parity</th>
                {POOL_KEYS.map((k) => <th scope="col" key={k}>OI {k}</th>)}
                <th scope="col">{keepSymbols(`σ_buy ${POOL_KEYS.join(' | ')}`)}</th>
                {/* Nama aksesibel lewat aria-label (bukan span `sr-only`: elemen absolut 1 px itu keluar dari .table-scroll dan melebarkan dokumen di 375 px). */}
                <th scope="col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => <SeriesRow key={r.i} r={r} expanded={expanded.has(r.i)} onToggle={toggle} />)}
            </tbody>
          </table>
        </Scroller>
      )}
    </article>
  );
}

/** Memo pada `board`/`rows` (identitas stabil per snapshot + parity + filter) — detak jam tidak merender ulang tabel. */
export const BoardTable = memo(BoardTableView);
