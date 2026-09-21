// EventsPreview.tsx — pratinjau umpan aktivitas di Overview: `limit` event pool terbaru (semua pool di POOL_KEYS) dengan tautan explorer
// untuk tx dan pelaku, status pindaian (seed / scanning / live / error) sebagai pill, empty-state jujur tanpa baris contoh.
import { memo } from 'react';
import { Link } from 'wouter';
import { Activity, ArrowUpRight, ExternalLink } from 'lucide-react';
import { POOLS, POOL_KEYS, explorerAddress, explorerTx } from '@chain/deployment';
import type { TradeEvent } from '@chain/chain/events';
import { shortAddr, shortHash } from '@chain/ui/format';
import type { EventsState } from '@/chain/types';
import { StatusPill, type PillTone } from '@/components/primitives';

export const PREVIEW_ROWS = 5;

export function feedPill(state: EventsState, count: number): { tone: PillTone; text: string } {
  switch (state) {
    case 'seed': return { tone: 'muted', text: count ? 'Seed · scan pending' : 'No scan yet' };
    case 'scanning': return { tone: 'warn', text: 'Scanning…' };
    case 'error': return { tone: 'warn', text: 'Scan failed · retrying' };
    case 'live': return { tone: 'good', text: 'Live' };
  }
}

export interface EventsPreviewProps { trades: TradeEvent[]; eventsState: EventsState; limit?: number }

function EventsPreviewView({ trades, eventsState, limit = PREVIEW_ROWS }: EventsPreviewProps) {
  const rows = trades.slice(0, limit);
  const pill = feedPill(eventsState, trades.length);
  return (
    <article className={`panel events-panel ${rows.length ? '' : 'activity-empty'}`}>
      <div className="panel-header">
        <div><div className="eyebrow">Latest activity</div><h3>Pool events · {POOL_KEYS.join(' | ')}</h3></div>
        <StatusPill tone={pill.tone}>{pill.text}</StatusPill>
      </div>
      {rows.length ? (
        <>
          <ul className="event-list" aria-label="Latest pool events">
            {rows.map((t) => (
              <li key={`${t.tx}:${t.logIndex}`}>
                <span className={`pool-orb pool-orb--${t.pool === 'A' ? 'gold' : 'violet'} pool-orb--small`} title={POOLS[t.pool].label} aria-label={`Pool ${t.pool}`}>{t.pool}</span>
                <div className="event-list__body">
                  <div className="event-list__main"><strong>{t.kind}</strong><span className="mono">{t.label}</span><span className="mono event-list__amount">{t.amount}</span></div>
                  <div className="event-list__meta">
                    <span className="mono">block {t.block.toString()}</span>
                    <a className="mono" href={explorerTx(t.tx)} target="_blank" rel="noopener noreferrer" title={t.tx}>{shortHash(t.tx)} <ExternalLink size={11} /></a>
                    {t.who ? <a href={explorerAddress(t.who)} target="_blank" rel="noopener noreferrer" title={t.who}>by {shortAddr(t.who)}</a> : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="board-panel__foot">
            <span>{trades.length > limit ? `Latest ${limit} of ${trades.length} events since deploy` : `${trades.length} events since deploy`} · newest first</span>
            <Link href="/activity" className="soft-button">Open activity <ArrowUpRight size={14} /></Link>
          </div>
        </>
      ) : (
        <div className="empty-state">
          <div className="empty-state__icon"><Activity size={19} /></div>
          <strong>{eventsState === 'live' ? 'No pool events since deploy' : eventsState === 'scanning' ? 'Scanning the chain for events…' : eventsState === 'error' ? 'Event scan failed — retrying at the next refresh' : 'No events loaded yet'}</strong>
          <span>{eventsState === 'seed' ? 'The build-time seed is empty; Bought, Closed, Settled and Claimed events arrive with the first chain scan after the snapshot.' : 'Bought, Closed, Settled and Claimed events on every pool appear here, newest first, with explorer links.'}</span>
          <Link href="/activity" className="soft-button">Open activity <ArrowUpRight size={14} /></Link>
        </div>
      )}
    </article>
  );
}

/** Memo pada `trades` (identitas berubah hanya saat mergeEvents). */
export const EventsPreview = memo(EventsPreviewView);
