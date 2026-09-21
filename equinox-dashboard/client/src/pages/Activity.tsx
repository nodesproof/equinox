// Activity.tsx — halaman Activity HIDUP: umpan event pool (Bought/Closed/Settled/Claimed di setiap pool POOL_KEYS, terbaru dulu) dengan filter
// pool / jenis / "mine" (hanya bila ada akun), kaki "N events since deploy · <status pindaian>", dan garis waktu σ_base (SigmaChart mode blok)
// dengan penanda Settled dan perkiraan waktu blok dari snapshot (`blockTime − (snapshotBlock − blok) × 0.25 s`, selalu "≈").
// Digerakkan oleh `useEvents()` (seed → pindaian → live), bukan snapshot; snapshot hanya memberi anchor waktu. Tidak ada angka yang ditanam.
import { useMemo, useState } from 'react';
import type { Address } from 'viem';
import { Filter, Layers, User } from 'lucide-react';
import { POOL_KEYS } from '@chain/deployment';
import { shortAddr, utc } from '@chain/ui/format';
import { useSnapshot } from '@/chain/useSnapshot';
import { useEvents } from '@/chain/useEvents';
import { useWallet } from '@/chain/useWallet';
import { NETWORK_NAME } from '@/components/Layout';
import { EventsTable } from '@/components/EventsTable';
import { SigmaTimeline } from '@/components/SigmaTimeline';
import { SectionHeading, StatusPill } from '@/components/primitives';
import { DEFAULT_EVENT_FILTER, EVENT_KINDS, NITRO_BLOCK_S, blockTimeApprox, filterTrades, isDefaultFilter, type EventFilter } from '@/lib/activity';

/** Filter bar: chip pool (semua + satu per POOL_KEYS), chip jenis (semua + 4 jenis event), chip "Mine" hanya bila ada akun; ringkasan n of N di kanan. */
function FilterBar({ filter, onChange, account, shown, total }: { filter: EventFilter; onChange: (f: EventFilter) => void; account: Address | null; shown: number; total: number }) {
  const chip = (active: boolean, label: string, onClick: () => void, key: string, title?: string) => (
    <button type="button" key={key} className={`filter-chip ${active ? 'filter-chip--active' : ''}`} aria-pressed={active} onClick={onClick} title={title}>{label}</button>
  );
  return (
    <div className="filter-bar" role="group" aria-label="Event filters">
      <span className="filter-label"><Filter size={13} /> Pool</span>
      {chip(filter.pool === null, 'All pools', () => onChange({ ...filter, pool: null }), 'all')}
      {POOL_KEYS.map((k) => chip(filter.pool === k, k, () => onChange({ ...filter, pool: k }), `p${k}`))}
      <span className="filter-label filter-label--gap">Kind</span>
      {chip(filter.kind === null, 'All kinds', () => onChange({ ...filter, kind: null }), 'k-all')}
      {EVENT_KINDS.map((kind) => chip(filter.kind === kind, kind, () => onChange({ ...filter, kind }), `k${kind}`))}
      {account ? (
        <>
          <span className="filter-label filter-label--gap"><User size={13} /> Account</span>
          {chip(filter.mine, `Mine · ${shortAddr(account)}`, () => onChange({ ...filter, mine: !filter.mine }), 'mine', `Only events whose trader or holder is ${account} (Settled has no actor)`)}
        </>
      ) : null}
      <span className="filter-spacer" />
      <span className="filter-count mono">{shown} of {total} events</span>
    </div>
  );
}

export default function Activity() {
  const { snapshot, failed } = useSnapshot();
  const { trades, observed, eventsState } = useEvents();
  const { account } = useWallet();
  const [filter, setFilter] = useState<EventFilter>(DEFAULT_EVENT_FILTER);
  // "Mine" tanpa akun (wallet terputus setelah dipilih) → filter itu tidak berlaku, bukan tabel kosong yang menyesatkan.
  const effective = useMemo<EventFilter>(() => (account ? filter : { ...filter, mine: false }), [filter, account]);
  const rows = useMemo(() => filterTrades(trades, effective, account), [trades, effective, account]);
  const timeOf = useMemo(() => (snapshot ? (block: bigint) => blockTimeApprox(block, snapshot.blockNumber, snapshot.blockTime) : null), [snapshot]);

  return (
    <div className="page-stack">
      <SectionHeading eyebrow={`Activity · ${NETWORK_NAME}`} title="Activity"
        detail={`Bought, Closed, Settled and Claimed events on every pool (${POOL_KEYS.join(', ')}) and the σ_base history of the shared volatility engine, read with eth_getLogs from the deploy block — newest first, with Arbiscan links. Times are approximate: derived from the snapshot block time at ≈ ${Math.round(1 / NITRO_BLOCK_S)} blocks per second (Nitro), never a chain timestamp.`}
        action={snapshot ? <StatusPill tone="good" title={`Snapshot block ${snapshot.blockNumber} · ${utc(snapshot.blockTime)} — the anchor of every ≈ time on this page`}><Layers size={12} /> block {snapshot.blockNumber.toString()} · {utc(snapshot.blockTime)}</StatusPill> : <StatusPill tone="muted">{failed ? 'RPC error — retrying' : 'Awaiting snapshot'}</StatusPill>} />
      <FilterBar filter={effective} onChange={setFilter} account={account} shown={rows.length} total={trades.length} />
      <EventsTable rows={rows} total={trades.length} eventsState={eventsState} account={account} timeOf={timeOf} filtered={!isDefaultFilter(effective)} onClear={() => setFilter(DEFAULT_EVENT_FILTER)} />
      <SigmaTimeline observed={observed} trades={trades} eventsState={eventsState} snapshot={snapshot} />
    </div>
  );
}
