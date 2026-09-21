// Banner.tsx — banner pemberitahuan (`.notice-banner`) + RpcBanner yang membaca ChainState & jam: tiga state brief §5/§8.2
// (muat pertama gagal → retry; RPC gagal dengan data lama → "RPC unreachable — showing data fetched HH:MM:SS UTC"; snapshot basi tanpa error).
import type { ReactNode } from 'react';
import { AlertTriangle, Radio, RotateCcw } from 'lucide-react';
import { useChain } from '@/chain/provider';
import { useNow } from '@/chain/clock';
import { bannerModel, type BannerTone } from '@/lib/sync';

export function Banner({ tone = 'warn', title, detail, action }: { tone?: BannerTone; title: string; detail?: ReactNode; action?: ReactNode }) {
  return (
    <div className={`notice-banner notice-banner--${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>
      <div className="notice-banner__icon">{tone === 'bad' ? <AlertTriangle size={16} /> : <Radio size={16} />}</div>
      <div>
        <strong>{title}</strong>
        {detail ? <span>{detail}</span> : null}
      </div>
      {action}
    </div>
  );
}

/** Banner RPC global (dipasang Layout, di atas konten setiap rute). Data lama TIDAK dihapus — banner hanya menjelaskan umurnya. */
export function RpcBanner() {
  const { snapshot, meta, refreshNow } = useChain();
  const now = useNow();
  const model = bannerModel({ snapshot, meta }, now);
  if (!model) return null;
  return (
    <div className="banner-slot">
      <Banner tone={model.tone} title={model.title} detail={model.detail}
        action={<button type="button" className="soft-button" onClick={refreshNow}><RotateCcw size={13} /> Retry now</button>} />
    </div>
  );
}
