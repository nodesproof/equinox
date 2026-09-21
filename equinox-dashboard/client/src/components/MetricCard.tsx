// MetricCard.tsx — kartu metrik utama Overview. Semua angka datang dari props (sudah diformat); tanpa `value` → EmptyValue + alasan
// (skeleton jujur, brief §7.5) — tidak pernah "0" atau angka contoh.
import type { ComponentType, ReactNode } from 'react';
import { EmptyValue } from '@/components/primitives';

export type Tone = 'neutral' | 'gold' | 'green' | 'violet' | 'warn';
type IconComponent = ComponentType<{ size?: number | string; strokeWidth?: number | string; className?: string }>;

export interface MetricCardProps {
  label: string;
  /** Nilai terformat; undefined = belum ada snapshot (EmptyValue dengan `emptyLabel`). */
  value?: string;
  suffix?: string;
  /** Baris keterangan (sumber, umur, parameter) — boleh berisi node agar bagian penting bisa ditebalkan. */
  meta: ReactNode;
  tone?: Tone;
  icon: IconComponent;
  /** Alasan nilai kosong: "Awaiting snapshot" (memuat), "RPC error — retrying" (muat pertama gagal), "No open board", … */
  emptyLabel?: string;
}

export function MetricCard({ label, value, suffix, meta, tone = 'neutral', icon: Icon, emptyLabel = 'Awaiting snapshot' }: MetricCardProps) {
  const loading = value === undefined;
  return (
    <article className={`metric-card metric-card--${tone}`} aria-label={label}>
      <div className="metric-card__top">
        <span className="metric-card__label">{label}</span>
        <span className="metric-card__icon"><Icon size={15} strokeWidth={1.8} /></span>
      </div>
      <div className={`metric-card__value ${loading ? 'metric-card__value--loading' : ''}`}>
        {loading ? <EmptyValue label={emptyLabel} /> : <>{value}{suffix ? <span>{suffix}</span> : null}</>}
      </div>
      <div className="metric-card__meta">{meta}</div>
    </article>
  );
}
