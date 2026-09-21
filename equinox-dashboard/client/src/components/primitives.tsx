import type { ReactNode } from "react";

// Primitif tampilan bersama (dipotong dari scaffold Home.tsx). Semua nilai angka datang dari props —
// tidak ada literal on-chain di sini; tanpa nilai, tampilkan "—" + alasan (brief §7.5). MetricCard ada di components/MetricCard.tsx.

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

/** Huruf Yunani (σ, Δ, α, λ, …) di dalam label yang CSS-nya `text-transform: uppercase`: kata yang memuatnya dibungkus `<span class="sym">`
 *  (text-transform: none) agar σ tidak berubah menjadi Σ — artinya berbeda. Kata lain tetap teks biasa (tetap dihurufbesarkan oleh CSS). */
const GREEK = /[\u0370-\u03FF]/;
export function keepSymbols(text: string): ReactNode {
  if (!GREEK.test(text)) return text;
  return text.split(/(\s+)/).map((word, i) => (GREEK.test(word) ? <span key={i} className="sym">{word}</span> : word));
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

/** Balok skeleton (memuat) — tanpa angka; `width` dalam px atau %. Animasi dimatikan oleh prefers-reduced-motion (index.css). */
export function SkeletonLine({ width = "60%", height = 10 }: { width?: number | string; height?: number }) {
  return <span className="skeleton-line" style={{ width, height }} aria-hidden="true" />;
}

export type PillTone = "muted" | "good" | "warn" | "gold" | "bad";
export function StatusPill({ children, tone = "muted", title }: { children: ReactNode; tone?: PillTone; title?: string }) {
  return <span className={`status-pill status-pill--${tone}`} title={title}><span className="status-pill__dot" />{children}</span>;
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
