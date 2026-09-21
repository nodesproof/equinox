// TxLog.tsx — log transaksi sesi ini dari ChainState.txLog (terbaru di depan, maks 50): `✓ what — tx 0x… ↗` / `✗ what — pesan decodeRevert [tx ↗]`
// / `… what — pending`. Region aria-live agar hasil aksi diumumkan; tautan Arbiscan untuk setiap hash (juga tx yang terkirim lalu gagal — TxFailed).
import { memo } from 'react';
import { ExternalLink, Inbox } from 'lucide-react';
import { explorerTx } from '@chain/deployment';
import { shortHash } from '@chain/ui/format';
import type { TxEntry } from '@/chain/types';
import { StatusPill } from '@/components/primitives';
import { hms } from '@/lib/sync';
import { txLinePrefix, txLineState, txLineTail } from '@/lib/trade';

export interface TxLogProps { entries: TxEntry[]; busy?: boolean }

function TxLogView({ entries, busy = false }: TxLogProps) {
  const failed = entries.filter((e) => e.ok === false).length;
  return (
    <article className="panel tx-log" aria-label="Transaction log">
      <div className="panel-header">
        <div><div className="eyebrow">Transaction log</div><h3>Your actions this session</h3></div>
        {busy ? <StatusPill tone="warn">action in flight</StatusPill> : entries.length ? <StatusPill tone={failed ? 'bad' : 'good'}>{entries.length} {entries.length === 1 ? 'entry' : 'entries'}{failed ? ` · ${failed} failed` : ''}</StatusPill> : <StatusPill tone="muted">idle</StatusPill>}
      </div>
      {entries.length ? (
        <ol className="txlog" aria-live="polite" aria-relevant="additions text">
          {entries.map((e) => {
            const state = txLineState(e);
            const tail = txLineTail(e);
            return (
              <li key={e.id} className={`txlog__line txlog__line--${state}`} data-state={state} title={`${hms(e.atMs)}`}>
                <span className="txlog__text">{txLinePrefix(e)}{tail ? <span className="muted">{tail}</span> : null}{tail && e.hash ? ' ' : null}
                  {e.hash ? <a href={explorerTx(e.hash)} target="_blank" rel="noopener noreferrer" title={e.hash}>tx {shortHash(e.hash)} ↗</a> : null}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="tx-empty"><Inbox size={15} /><span>No transactions yet.</span><small>Every action is simulated first; a decoded revert or the confirmed hash lands here with an <ExternalLink size={10} aria-hidden="true" /> Arbiscan link.</small></div>
      )}
    </article>
  );
}

/** Memo pada `entries` (identitas berubah hanya saat ChainState.txLog berubah). */
export const TxLog = memo(TxLogView);
