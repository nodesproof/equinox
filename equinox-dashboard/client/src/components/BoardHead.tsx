// BoardHead.tsx — header panel board (Boards, Overview, kerangka): indeks, judul, expiry satu baris ("25 Sep 2026 · 08:00 UTC", ISO penuh di title),
// meta (jumlah seri) + pill status. Di telepon (CSS ≤ 640 px) meta turun ke bawah judul; teks pill memakai versi pendek (`boardPill().short`).
import type { ReactNode } from 'react';
import { utc } from '@chain/ui/format';
import { StatusPill, type PillTone } from '@/components/primitives';
import { usePhone } from '@/hooks/useMediaQuery';
import { expiryLabel } from '@/lib/format';

export interface BoardHeadProps {
  id: number;
  /** Unix s (UTC) — expiry board dari manifest. */
  expiry: number;
  /** Teks meta kiri pill, mis. "6 series" / "5 of 6 series · ATM ± 2". */
  meta: ReactNode;
  /** Pill status; null = belum ada snapshot → `fallback` (EmptyValue) di tempatnya. */
  pill: { tone: PillTone; text: string; short: string } | null;
  fallback?: ReactNode;
}

export function BoardHead({ id, expiry, meta, pill, fallback = null }: BoardHeadProps) {
  const phone = usePhone();
  return (
    <div className="board-panel__head">
      <div className="board-title">
        <div className="board-index">#{id}</div>
        <div><h3>Board #{id}</h3><p>expiry <time dateTime={new Date(expiry * 1000).toISOString()} title={utc(expiry)}>{expiryLabel(expiry)}</time></p></div>
      </div>
      <div className="board-head-meta">
        <span className="board-series-count">{meta}</span>
        {pill ? <StatusPill tone={pill.tone} title={phone ? pill.text : undefined}>{phone ? pill.short : pill.text}</StatusPill> : fallback}
      </div>
    </div>
  );
}
