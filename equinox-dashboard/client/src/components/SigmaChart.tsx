// SigmaChart.tsx — grafik σ_base dari event `Observed` engine bersama, port JSX dari `web/src/ui/svg.ts` (skala linier, rentang datar → garis
// tengah, label min/max) tanpa recharts (putusan pengendali). Tooltip = blok, σ_base, harga, round. Kosong → empty-state jujur menurut
// `eventsState` (seed / scanning / live / error); tidak pernah kurva contoh.
// Sumbu x: urutan observasi (Overview, default) atau nomor blok (Activity: garis waktu) — pada mode blok grafik menerima penanda vertikal
// (Settled) dan fungsi perkiraan waktu blok untuk label sumbu x & tooltip (selalu ditandai "≈").
import { memo, useMemo, useState, type MouseEvent } from 'react';
import { Radio } from 'lucide-react';
import type { EventsState } from '@/chain/types';
import { CHUNK, type ObservedEvent } from '@chain/chain/events';
import type { VolState } from '@chain/chain/snapshot';
import { fmtAge, utc, wad } from '@chain/ui/format';
import { useNow } from '@/chain/clock';

/** Titik grafik maksimum (yang terbaru) — sama dengan panel Activity klasik. */
export const MAX_POINTS = 400;
const W = 720, H = 220, PAD = 18;
const fmt4 = (v: number) => v.toFixed(4);

/** Penanda vertikal pada satu blok (mis. Settled): `label` singkat di grafik, `title` lengkap (tooltip native). */
export interface ChartMarker { block: bigint; label: string; title: string }
export type XAxis = 'order' | 'block';

export interface SigmaChartProps {
  observed: ObservedEvent[];
  eventsState: EventsState;
  /** `snapshot.vol` untuk baris kaki (lastRoundId / lastTs); null sebelum snapshot pertama. */
  vol: VolState | null;
  /** 'order' (default) = x berjarak sama per observasi; 'block' = x sebanding nomor blok (garis waktu). */
  xAxis?: XAxis;
  /** Penanda pada blok tertentu — digambar hanya pada mode 'block' dan hanya bila ada observasi. */
  markers?: ChartMarker[];
  /** Perkiraan unix time (s) sebuah blok untuk label sumbu x & tooltip; null/undefined = tidak ada snapshot → hanya nomor blok. */
  timeOf?: ((block: bigint) => number) | null;
  /** Catatan legenda untuk perkiraan waktu (ditampilkan bila `timeOf` ada). */
  timeNote?: string;
  heading?: { eyebrow: string; title: string };
  /** Tingkat heading judul panel: 3 (default, di bawah h2 halaman) atau 2 (Overview: panel langsung di bawah h1 — urutan heading a11y). */
  headingLevel?: 2 | 3;
}

/** Teks empty-state per status umpan: seed kosong, pindaian berjalan, pindaian gagal, atau memang belum ada observasi sejak deploy. */
export function emptyText(state: EventsState): { title: string; detail: string } {
  switch (state) {
    case 'seed': return { title: 'No Observed events loaded yet', detail: 'Seed empty — the chain scan runs after the first snapshot' };
    case 'scanning': return { title: 'Scanning the chain for Observed events…', detail: `eth_getLogs in ${CHUNK.toLocaleString('en-US')}-block windows from the deploy block` };
    case 'error': return { title: 'Event scan failed — retrying at the next refresh', detail: 'The public RPC rejected or timed out the log query' };
    case 'live': return { title: 'No observations since deploy', detail: 'The engine emits Observed only when a new Chainlink round is seen' };
  }
}

interface Geometry { xs: number[]; ys: number[]; yMin: number; yMax: number; line: string; area: string; /** x untuk blok mana pun (mode blok; di-clamp ke tepi plot). */ xOf: (block: bigint) => number }
function geometry(points: ObservedEvent[], xAxis: XAxis): Geometry | null {
  const n = points.length;
  if (n === 0) return null;
  const values = points.map((o) => Number(o.sigmaBase) / 1e18);
  const yMin = Math.min(...values), yMax = Math.max(...values);
  const b0 = points[0]!.block, b1 = points[n - 1]!.block;
  const span = Number(b1 - b0);
  const clamp = (x: number) => Math.min(W - PAD, Math.max(PAD, x));
  const xOf = (block: bigint) => (span <= 0 ? W / 2 : clamp(PAD + (Number(block - b0) / span) * (W - 2 * PAD)));
  const sx = (i: number) => (xAxis === 'block' ? xOf(points[i]!.block) : n === 1 ? W / 2 : PAD + (i / (n - 1)) * (W - 2 * PAD));
  const sy = (y: number) => (yMax === yMin ? H / 2 : H - PAD - ((y - yMin) / (yMax - yMin)) * (H - 2 * PAD));
  const xs = values.map((_, i) => sx(i)), ys = values.map(sy);
  const line = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${ys[i]!.toFixed(1)}`).join('');
  const area = n > 1 ? `${line}L${xs[n - 1]!.toFixed(1)} ${H - PAD}L${xs[0]!.toFixed(1)} ${H - PAD}Z` : '';
  return { xs, ys, yMin, yMax, line, area, xOf };
}

function LastObservation({ vol }: { vol: VolState }) {
  const now = useNow();
  return <span title={`lastRoundId ${vol.lastRoundId} · lastTs ${vol.lastTs}`}>engine lastRoundId …{vol.lastRoundId.toString().slice(-5)} · {utc(vol.lastTs)} ({fmtAge(now / 1000 - vol.lastTs)})</span>;
}

const NO_MARKERS: ChartMarker[] = [];
const DEFAULT_HEADING = { eyebrow: 'Volatility engine · shared', title: 'Observed σ_base' };

function SigmaChartView({ observed, eventsState, vol, xAxis = 'order', markers = NO_MARKERS, timeOf = null, timeNote, heading = DEFAULT_HEADING, headingLevel = 3 }: SigmaChartProps) {
  const Title = headingLevel === 2 ? 'h2' : 'h3';
  const points = useMemo(() => observed.slice(-MAX_POINTS), [observed]);
  const geo = useMemo(() => geometry(points, xAxis), [points, xAxis]);
  const [hover, setHover] = useState<number | null>(null);
  const first = points[0] ?? null, last = points[points.length - 1] ?? null;
  const empty = emptyText(eventsState);
  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    if (!geo) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const x = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < geo.xs.length; i++) if (Math.abs(geo.xs[i]! - x) < Math.abs(geo.xs[best]! - x)) best = i;
    setHover(best);
  };
  const hovered = hover !== null && geo ? points[hover] ?? null : null;
  const shownMarkers = xAxis === 'block' && geo ? markers : NO_MARKERS;
  const approx = (block: bigint) => (timeOf ? ` · ≈ ${utc(timeOf(block))}` : '');
  const summary = geo
    ? `σ_base history: ${points.length} observations, min ${fmt4(geo.yMin)}, max ${fmt4(geo.yMax)}, last ${fmt4(Number(last!.sigmaBase) / 1e18)} at block ${last!.block}${shownMarkers.length ? `, ${shownMarkers.length} settlement ${shownMarkers.length === 1 ? 'marker' : 'markers'}` : ''}`
    : `σ_base history: ${empty.title}`;
  const axisWord = xAxis === 'block' ? 'x = block number (≈ time)' : 'x = observation order';
  return (
    <article className="panel chart-panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">{heading.eyebrow}</div>
          <Title>{heading.title}</Title>
        </div>
        <div className="chart-legend">
          <span className="legend-dot legend-dot--gold" />σ_base per Observed event
          {xAxis === 'block' ? <><span className="legend-dot legend-dot--marker" />Settled (per pool)</> : null}
          <span className="legend-dot legend-dot--muted" />{points.length ? `${points.length} points` : 'no points'}
        </div>
      </div>
      <div className="chart-wrap">
        <div className="chart-y-labels" aria-hidden="true">
          {geo ? (geo.yMax === geo.yMin ? <span>σ {fmt4(geo.yMin)} (flat)</span> : <><span>{fmt4(geo.yMax)}</span><span>{fmt4(geo.yMin)}</span></>) : null}
        </div>
        <div className="chart-plot">
          <svg className="engine-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={summary}
            onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
            {geo
              ? (geo.yMax === geo.yMin ? [H / 2] : [PAD, H / 2, H - PAD]).map((y) => <line key={y} x1={PAD} x2={W - PAD} y1={y} y2={y} className="chart-grid" />)
              : [28, 82, 136, 190].map((y) => <line key={y} x1="0" x2={W} y1={y} y2={y} className="chart-grid" />)}
            {geo && geo.area ? <path className="sigma-area" d={geo.area} /> : null}
            {geo ? <path className="sigma-line" d={geo.line} /> : null}
            {geo ? shownMarkers.map((m, i) => {
              const x = geo.xOf(m.block);
              return (
                <g key={`${m.block}:${i}`} className="sigma-marker" data-block={m.block.toString()}>
                  <title>{m.title}{approx(m.block)}</title>
                  <line x1={x} x2={x} y1={PAD / 2} y2={H - PAD / 2} />
                </g>
              );
            }) : null}
            {geo ? <circle className="sigma-dot" cx={geo.xs[geo.xs.length - 1]} cy={geo.ys[geo.ys.length - 1]} r={3.5} /> : null}
            {geo && hover !== null ? <line className="sigma-hover" x1={geo.xs[hover]} x2={geo.xs[hover]} y1={PAD / 2} y2={H - PAD / 2} /> : null}
            {geo && hover !== null ? <circle className="sigma-dot sigma-dot--hover" cx={geo.xs[hover]} cy={geo.ys[hover]} r={4} /> : null}
          </svg>
          {geo ? shownMarkers.map((m, i) => (
            // Label penanda sebagai HTML (bukan <text> SVG): svg di-stretch (preserveAspectRatio none) sehingga teks SVG akan terdistorsi.
            <div key={`${m.block}:${i}`} className="sigma-marker-label" style={{ left: `${(geo.xOf(m.block) / W) * 100}%`, top: `${6 + (i % 3) * 14}px` }} title={`${m.title}${approx(m.block)}`}>{m.label}</div>
          )) : null}
          {hovered && geo && hover !== null ? (
            <div className="chart-tooltip" style={{ left: `${(geo.xs[hover]! / W) * 100}%` }} role="status">
              block {hovered.block.toString()}{approx(hovered.block)} · σ_base {wad(hovered.sigmaBase)} · ETH {wad(hovered.priceWad, 2)} USD · round …{hovered.roundId.toString().slice(-5)}
            </div>
          ) : null}
          {!geo ? (
            <div className="chart-empty"><Radio size={18} /><span>{empty.title}</span><small>{empty.detail}</small></div>
          ) : null}
        </div>
      </div>
      {xAxis === 'block' && first && last ? (
        <div className="chart-x-labels mono" aria-label="x axis" title={timeNote}>
          <span>block {first.block.toString()}{timeOf ? ` · ≈ ${utc(timeOf(first.block))}` : ''}</span>
          <span>{timeOf ? '≈ time from block' : 'time needs a snapshot'}</span>
          <span>block {last.block.toString()}{timeOf ? ` · ≈ ${utc(timeOf(last.block))}` : ''}</span>
        </div>
      ) : null}
      <div className="chart-footer">
        <span>
          {last
            ? `${observed.length} observations since deploy${observed.length > MAX_POINTS ? ` (chart: latest ${MAX_POINTS})` : ''} · last σ_base ${wad(last.sigmaBase)} at block ${last.block} (ETH ${wad(last.priceWad, 2)} USD)`
            : `${axisWord} · ${eventsState === 'live' ? 'scan live' : eventsState === 'scanning' ? 'scanning…' : eventsState === 'error' ? 'scan failed' : 'seed only'}`}
        </span>
        {vol ? <LastObservation vol={vol} /> : <span>engine lastRoundId — · awaiting snapshot</span>}
      </div>
      {timeOf && timeNote && last ? <div className="chart-note">{timeNote}</div> : null}
    </article>
  );
}

/** Memo pada `observed` (identitas stabil antar detak; berubah hanya saat mergeEvents) — tooltip lokal tidak menyentuh context. */
export const SigmaChart = memo(SigmaChartView);
