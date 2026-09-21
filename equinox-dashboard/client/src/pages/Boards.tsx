// Boards.tsx — halaman Boards HIDUP: satu panel per board manifest (`useBoards()`), tabel penuh per seri (BoardTable), filter bar (board, C/P,
// hanya open), catatan kaki board klasik + baris gas. State: snapshot null → panel kerangka per board manifest tanpa angka ("Awaiting snapshot" /
// "RPC error — retrying"); stale → data lama tetap (banner di Layout). Deep link `#/boards?board=1` memilih board (reaktif terhadap hashchange).
import { useEffect, useMemo, useState } from 'react';
import { Filter, Layers } from 'lucide-react';
import { ALL_SERIES, BOARDS, GAS_KEYS, POOL_KEYS } from '@chain/deployment';
import type { GasEstimate } from '@chain/chain/gas';
import { utc } from '@chain/ui/format';
import { useSnapshot } from '@/chain/useSnapshot';
import { useBoards } from '@/chain/selectors';
import { BoardTable } from '@/components/BoardTable';
import { EmptyValue, SectionHeading, SkeletonLine, StatusPill } from '@/components/primitives';
import { DEFAULT_FILTER, boardNote, filterSeries, type BoardFilter, type TypeFilter } from '@/lib/boards';
import { gasUnits } from '@/lib/format';
import { queryBoard, useHashQuery } from '@/lib/route';

const TYPE_CHIPS: { value: TypeFilter; label: string }[] = [{ value: 'all', label: 'Calls & puts' }, { value: 'C', label: 'Calls' }, { value: 'P', label: 'Puts' }];

/** Filter bar: chip board (semua + satu per board manifest), chip C/P, toggle "Open only"; ringkasan n of m series di kanan. */
function FilterBar({ filter, onChange, shown, total }: { filter: BoardFilter; onChange: (f: BoardFilter) => void; shown: number | null; total: number }) {
  const chip = (active: boolean, label: string, onClick: () => void, key: string) => (
    <button type="button" key={key} className={`filter-chip ${active ? 'filter-chip--active' : ''}`} aria-pressed={active} onClick={onClick}>{label}</button>
  );
  return (
    <div className="filter-bar" role="group" aria-label="Series filters">
      <span className="filter-label"><Filter size={13} /> Board</span>
      {chip(filter.board === null, 'All boards', () => onChange({ ...filter, board: null }), 'all')}
      {BOARDS.map((b) => chip(filter.board === b.id, `#${b.id}`, () => onChange({ ...filter, board: b.id }), `b${b.id}`))}
      <span className="filter-label filter-label--gap">Type</span>
      {TYPE_CHIPS.map((t) => chip(filter.type === t.value, t.label, () => onChange({ ...filter, type: t.value }), t.value))}
      <span className="filter-label filter-label--gap">State</span>
      {chip(filter.openOnly, 'Open only', () => onChange({ ...filter, openOnly: !filter.openOnly }), 'open')}
      <span className="filter-spacer" />
      <span className="filter-count mono">{shown === null ? '—' : shown} of {total} series</span>
    </div>
  );
}

/** Kerangka sebelum snapshot: header board dari manifest (id, expiry) + alasan; tidak ada angka. */
function BoardSkeletons({ emptyLabel }: { emptyLabel: string }) {
  return (
    <div className="board-stack">
      {BOARDS.map((b) => (
        <article className="panel board-panel" key={b.id} aria-label={`Board #${b.id}`} data-status="loading">
          <div className="board-panel__head">
            <div className="board-title"><div className="board-index">#{b.id}</div><div><h3>Board #{b.id}</h3><p>expiry {utc(b.expiry)}</p></div></div>
            <div className="board-head-meta"><span className="board-series-count">{ALL_SERIES.filter((s) => s.boardId === b.id).length} series</span><EmptyValue label={emptyLabel} /></div>
          </div>
          <div className="skeleton-rows" aria-hidden="true">{[0, 1, 2].map((i) => <SkeletonLine key={i} width={`${72 - i * 12}%`} />)}</div>
        </article>
      ))}
    </div>
  );
}

/** Catatan kaki board klasik + baris gas A vs B (eth_estimateGas buy(1 unit) seri ATM). */
function BoardNote({ gas, blockNumber, emptyLabel }: { gas: GasEstimate | null; blockNumber: bigint | null; emptyLabel: string }) {
  const gasA = gas ? gas.gas[GAS_KEYS[0]] : null, gasB = gas ? gas.gas[GAS_KEYS[1]] : null;
  const ratio = gasA !== null && gasB !== null && gasB !== 0n ? `${(Number(gasA) / Number(gasB)).toFixed(2)}×` : '—';
  return (
    <article className="panel board-note" aria-label="Reading the boards">
      <div className="panel-header"><div><div className="eyebrow">Reading the boards</div><h3>What each column means</h3></div>
        {blockNumber !== null ? <StatusPill tone="good">block {blockNumber.toString()}</StatusPill> : <StatusPill tone="muted">{emptyLabel}</StatusPill>}</div>
      <p className="panel-copy" data-testid="board-note">{boardNote().join(' ')}</p>
      <div className="gas-line">
        <span>
          {gas
            ? <>Gas <strong>buy(1 C {gas.strike}, {utc(gas.expiry)})</strong>: {GAS_KEYS[0]} <strong>{gasUnits(gasA)}</strong> · {GAS_KEYS[1]} <strong>{gasUnits(gasB)}</strong> · ratio <strong>{ratio}</strong></>
            : <>Gas: — {blockNumber === null ? emptyLabel.toLowerCase() : 'no open board or estimate not read yet'}</>}
        </span>
      </div>
    </article>
  );
}

export default function Boards() {
  const { snapshot, gas, failed } = useSnapshot();
  const boards = useBoards();
  const query = useHashQuery();
  const queried = queryBoard(query);
  const [filter, setFilter] = useState<BoardFilter>(() => ({ ...DEFAULT_FILTER, board: queried }));
  // `#/boards?board=1` (tautan "Full board" di Overview) mengikuti perubahan hash tanpa remount; chip tetap bisa mengubahnya setelah itu.
  useEffect(() => { if (queried !== null) setFilter((f) => (f.board === queried ? f : { ...f, board: queried })); }, [queried]);
  const emptyLabel = failed ? 'RPC error — retrying' : 'Awaiting snapshot';

  // Memo per (boards, filter): identitas `rows` stabil agar BoardTable (memo) tidak dirender ulang oleh detak context lain.
  const filtered = useMemo(() => boards.filter((b) => filter.board === null || b.board.id === filter.board).map((b) => ({ board: b, rows: filterSeries(b.series, filter) })), [boards, filter]);
  const total = filtered.reduce((n, f) => n + f.board.series.length, 0);
  const shown = filtered.reduce((n, f) => n + f.rows.length, 0);

  return (
    <div className="page-stack">
      <SectionHeading eyebrow="Boards" title="Boards & series"
        detail={`${BOARDS.length} boards · ${ALL_SERIES.length} series in the manifest. Buy and close quotes are indicative view quotes per 1.0 unit at each pool's own inventory (${POOL_KEYS.join(', ')}), read from one block-pinned snapshot; Δ and Parity compare ${GAS_KEYS[0]} (Solidity) with ${GAS_KEYS[1]} (Stylus).`}
        action={snapshot ? <StatusPill tone="good" title={`Snapshot block ${snapshot.blockNumber} · ${utc(snapshot.blockTime)}`}><Layers size={12} /> block {snapshot.blockNumber.toString()} · {utc(snapshot.blockTime)}</StatusPill> : <StatusPill tone="muted">{emptyLabel}</StatusPill>} />
      <FilterBar filter={filter} onChange={setFilter} shown={snapshot ? shown : null} total={snapshot ? total : ALL_SERIES.filter((s) => filter.board === null || s.boardId === filter.board).length} />
      {snapshot === null ? <BoardSkeletons emptyLabel={emptyLabel} /> : (
        <div className="board-stack">
          {filtered.map(({ board, rows }) => <BoardTable key={board.board.id} board={board} rows={rows} />)}
        </div>
      )}
      <BoardNote gas={gas} blockNumber={snapshot?.blockNumber ?? null} emptyLabel={emptyLabel} />
    </div>
  );
}
