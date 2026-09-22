// EventsTable.tsx — tabel umpan event halaman Activity: Pool, Kind, Series, Amount, Block (+ ≈ waktu bila ada snapshot), Tx ↗, Actor ↗ —
// kolom & teks sel = panel Activity klasik (`web/src/panels/activity.ts`), baris milik akun terhubung ditandai. Terbaru dulu, MAX_ROWS baris
// pertama lalu tombol "Show more" (klasik memotong di 30); halaman "Show more" hanya kembali ke awal saat FILTER berganti (`filterKey`), bukan pada
// setiap poll umpan (mergeEvents selalu mengalokasikan array baru). Empty-state jujur: per `eventsState` bila umpan kosong, "no match" bila filter
// menyaring semua. ≤ 640 px (usePhone) tabel diganti daftar kartu (teks sel yang sama: pool, kind, seri, amount, blok, ≈ waktu, tx, aktor); tablet: Scroller berpudar.
import { memo, useState } from 'react';
import type { Address } from 'viem';
import { Activity, Filter } from 'lucide-react';
import { POOLS, POOL_KEYS, explorerAddress, explorerTx } from '@chain/deployment';
import type { TradeEvent } from '@chain/chain/events';
import { shortAddr, shortHash, utc } from '@chain/ui/format';
import type { EventsState, SeedMeta } from '@/chain/types';
import { accent } from '@/components/PoolCard';
import { feedPill } from '@/components/EventsPreview';
import { Scroller } from '@/components/Scroller';
import { StatusPill } from '@/components/primitives';
import { usePhone } from '@/hooks/useMediaQuery';
import { countNote, isMine, scanNote } from '@/lib/activity';

/** Teks amount klasik dipecah pada " · " agar hanya membungkus di pemisah (textContent tetap = teks asli). */
const amountParts = (amount: string) => amount.split(' · ').map((part, i, all) => <span key={i}><span className="nowrap">{part}</span>{i < all.length - 1 ? ' · ' : ''}</span>);

/** Baris pertama yang ditampilkan (= MAX_ROWS panel klasik); tombol "Show more" menambah sebanyak ini lagi. */
export const MAX_ROWS = 30;

export interface EventsTableProps {
  /** Baris setelah filter, terbaru dulu. */
  rows: TradeEvent[];
  /** Jumlah event seluruhnya (sebelum filter) — kaki "n of N events since deploy". */
  total: number;
  eventsState: EventsState;
  account: Address | null;
  /** Perkiraan waktu blok (unix s); null tanpa snapshot → kolom waktu "—". */
  timeOf: ((block: bigint) => number) | null;
  /** Filter aktif (bukan default) — empty-state "no match" + tombol clear. */
  filtered: boolean;
  /** Kunci filter efektif (mis. `pool|kind|mine`): berganti → paging "Show more" kembali ke MAX_ROWS; poll dengan filter yang sama mempertahankan limit. */
  filterKey: string;
  /** Metadata seed hasil build (tanggal & blok terakhir) untuk kaki tabel; null tanpa seed. */
  seed?: SeedMeta | null;
  onClear: () => void;
}

/** Kartu event untuk telepon: baris 1 orb pool + kind + seri (+ "you"), baris 2 amount, baris 3 blok · ≈ waktu · tx ↗ · aktor ↗. */
function EventCards({ shown, account, timeOf }: { shown: TradeEvent[]; account: Address | null; timeOf: EventsTableProps['timeOf'] }) {
  return (
    <ul className="event-cards" aria-label="Pool events">
      {shown.map((t) => {
        const mine = isMine(t, account);
        return (
          <li key={`${t.tx}:${t.logIndex}`} className={`event-card ${mine ? 'event-card--mine' : ''}`} data-kind={t.kind} data-pool={t.pool} data-mine={mine ? 'true' : undefined}>
            <div className="event-card__head">
              <span className={`pool-orb pool-orb--${accent(t.pool)} pool-orb--small`} title={POOLS[t.pool].label} aria-label={`Pool ${t.pool}`}>{t.pool}</span>
              <strong>{t.kind}</strong>
              <span className="mono">{t.label}</span>
              {mine ? <StatusPill tone="gold" title="trader / holder = the connected account">you</StatusPill> : null}
            </div>
            <div className="event-card__amount mono">{amountParts(t.amount)}</div>
            <div className="event-card__meta">
              <span className="mono">block {t.block.toString()}</span>
              <span className="mono muted-text">{timeOf ? `≈ ${utc(timeOf(t.block))}` : 'time needs a snapshot'}</span>
              <a className="mono" href={explorerTx(t.tx)} target="_blank" rel="noopener noreferrer" title={t.tx}>{shortHash(t.tx)} ↗</a>
              {t.who ? <a className="mono" href={explorerAddress(t.who)} target="_blank" rel="noopener noreferrer" title={t.who}>by {shortAddr(t.who)} ↗</a> : <span className="muted-text">no actor (settle)</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function EventsTableView({ rows, total, eventsState, account, timeOf, filtered, filterKey, seed = null, onClear }: EventsTableProps) {
  // Paging disimpan bersama kunci filternya; kunci berganti → state disetel ulang SAAT render (pola React "adjust state on prop change", tanpa
  // efek/frame dengan daftar lama) ke MAX_ROWS; poll umpan (rows baru, filter sama) → limit tetap.
  const [paging, setPaging] = useState({ key: filterKey, limit: MAX_ROWS });
  if (paging.key !== filterKey) setPaging({ key: filterKey, limit: MAX_ROWS });
  const limit = paging.key === filterKey ? paging.limit : MAX_ROWS;
  const phone = usePhone();
  const shown = rows.slice(0, limit);
  const pill = feedPill(eventsState, total);
  const emptyTitle = eventsState === 'live' ? 'No pool events since deploy' : eventsState === 'scanning' ? 'Scanning the chain for events…' : eventsState === 'error' ? 'Event scan failed — retrying at the next refresh' : 'No events loaded yet';
  return (
    <article className="panel events-table-panel" aria-label="Pool events">
      <div className="panel-header">
        <div><div className="eyebrow">Event feed</div><h3>Pool events · {POOL_KEYS.join(' | ')}</h3></div>
        <StatusPill tone={pill.tone}>{pill.text}</StatusPill>
      </div>
      {shown.length && phone ? <EventCards shown={shown} account={account} timeOf={timeOf} /> : shown.length ? (
        <Scroller>
          <table className="series-table events-table">
            <thead><tr><th scope="col">Pool</th><th scope="col">Kind</th><th scope="col">Series</th><th scope="col">Amount</th><th scope="col">Block</th><th scope="col" title="Approximate — derived from the snapshot block time, not a chain timestamp">≈ Time (UTC)</th><th scope="col">Tx</th><th scope="col">Actor</th></tr></thead>
            <tbody>
              {shown.map((t) => {
                const mine = isMine(t, account);
                return (
                  <tr key={`${t.tx}:${t.logIndex}`} className={`series-row ${mine ? 'series-row--mine' : ''}`} data-kind={t.kind} data-pool={t.pool} data-mine={mine ? 'true' : undefined}>
                    <td><span className={`pool-orb pool-orb--${accent(t.pool)} pool-orb--small`} title={POOLS[t.pool].label} aria-label={`Pool ${t.pool}`}>{t.pool}</span></td>
                    <td><strong>{t.kind}</strong></td>
                    <td className="mono">{t.label}</td>
                    <td className="mono">{amountParts(t.amount)}</td>
                    <td className="mono">{t.block.toString()}</td>
                    <td className="mono muted-text">{timeOf ? `≈ ${utc(timeOf(t.block))}` : '—'}</td>
                    <td><a className="mono" href={explorerTx(t.tx)} target="_blank" rel="noopener noreferrer" title={t.tx}>{shortHash(t.tx)} ↗</a></td>
                    <td><span className="row-actions">{t.who ? <a className="mono" href={explorerAddress(t.who)} target="_blank" rel="noopener noreferrer" title={t.who}>{shortAddr(t.who)} ↗</a> : <span className="muted-text">— (settle has no actor)</span>}{mine ? <StatusPill tone="gold" title="trader / holder = the connected account">you</StatusPill> : null}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Scroller>
      ) : filtered && rows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon"><Filter size={19} /></div>
          <strong>No events match this filter</strong>
          <span>{total} {total === 1 ? 'event' : 'events'} since deploy — widen the pool, kind or “mine” filter.</span>
          <button type="button" className="soft-button" onClick={onClear}>Clear filters</button>
        </div>
      ) : (
        <div className="empty-state empty-state--large">
          <div className="empty-state__icon"><Activity size={19} /></div>
          <strong>{emptyTitle}</strong>
          <span>{eventsState === 'seed' ? 'The build-time seed is empty; Bought, Closed, Settled and Claimed events arrive with the first chain scan after the snapshot.' : 'Bought, Closed, Settled and Claimed events on every pool appear here, newest first, with explorer links.'}</span>
        </div>
      )}
      <div className="board-panel__foot events-table__foot">
        <span>{countNote(rows.length, total)} · newest first · {scanNote(eventsState, total, seed)}</span>
        {rows.length > shown.length ? <button type="button" className="soft-button" onClick={() => setPaging({ key: filterKey, limit: limit + MAX_ROWS })}>Show {Math.min(MAX_ROWS, rows.length - shown.length)} more ({rows.length - shown.length} hidden)</button> : null}
        {timeOf ? null : <span>≈ time needs a snapshot</span>}
      </div>
    </article>
  );
}

/** Memo pada props (rows berganti hanya saat umpan/filter berubah). */
export const EventsTable = memo(EventsTableView);
