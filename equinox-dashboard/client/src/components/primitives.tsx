import type { ComponentType, ReactNode } from "react";

// Primitif tampilan bersama (dipotong dari scaffold Home.tsx). Semua nilai angka datang dari props —
// tidak ada literal on-chain di sini; tanpa nilai, tampilkan "—" + alasan (brief §7.5).

/** Logo cincin emas Equinox (murni CSS, lihat .brand-mark di index.css). */
export function AppMark({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand-mark ${small ? "brand-mark--small" : ""}`} aria-hidden="true">
      <span className="brand-mark__ring" />
      <span className="brand-mark__core" />
    </div>
  );
}

export function SectionHeading({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail?: string; action?: ReactNode }) {
  return (
    <div className="section-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h2>{title}</h2>
        {detail ? <p>{detail}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** Nilai kosong yang jujur: "—" + label alasan (mis. "Awaiting snapshot"). */
export function EmptyValue({ label = "Awaiting snapshot" }: { label?: string }) {
  return (
    <span className="empty-value" title={label}>
      <span>—</span>
      <small>{label}</small>
    </span>
  );
}

export type Tone = "neutral" | "gold" | "green" | "violet";
type IconComponent = ComponentType<{ size?: number | string; strokeWidth?: number | string; className?: string }>;

/** Kartu metrik; tanpa `value` → EmptyValue (skeleton jujur, bukan angka palsu). */
export function MetricCard({ label, value, suffix, meta, tone = "neutral", icon: Icon, emptyLabel = "Awaiting snapshot" }: {
  label: string; value?: string; suffix?: string; meta: string; tone?: Tone; icon: IconComponent; emptyLabel?: string;
}) {
  const loading = value === undefined;
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <div className="metric-card__top">
        <span className="metric-card__label">{label}</span>
        <span className="metric-card__icon"><Icon size={15} strokeWidth={1.8} /></span>
      </div>
      <div className={`metric-card__value ${loading ? "metric-card__value--loading" : ""}`}>
        {loading ? <EmptyValue label={emptyLabel} /> : <>{value}<span>{suffix}</span></>}
      </div>
      <div className="metric-card__meta">{meta}</div>
    </article>
  );
}

export function StatusPill({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "good" | "warn" | "gold" }) {
  return <span className={`status-pill status-pill--${tone}`}><span className="status-pill__dot" />{children}</span>;
}

/** Sparkline kecil: `points` = deret nilai (dinormalkan ke tinggi 46); tanpa data → hanya garis dasar. */
export function MiniSparkline({ tone = "gold", points = [], label = "Awaiting chain snapshot" }: { tone?: "gold" | "violet" | "green"; points?: number[]; label?: string }) {
  const width = 180, height = 46, pad = 4;
  let line = `M0 ${height - pad}H${width}`;
  if (points.length > 1) {
    const min = Math.min(...points), max = Math.max(...points), span = max - min || 1;
    line = points.map((p, i) => `${i === 0 ? "M" : "L"}${((i / (points.length - 1)) * width).toFixed(1)} ${(height - pad - ((p - min) / span) * (height - 2 * pad)).toFixed(1)}`).join("");
  }
  return (
    <svg className={`mini-sparkline mini-sparkline--${tone}`} viewBox={`0 0 ${width} ${height}`} fill="none" role="img" aria-label={label}>
      <path d={line} />
      {points.length > 1 ? <path className="mini-sparkline__fade" d={`${line}V${height}H0Z`} /> : null}
    </svg>
  );
}
