// svg.ts — grafik garis kecil tanpa dependensi: `<svg class="chart" viewBox="0 0 w h">` dengan satu polyline dan label min/max.
import { svgEl } from './dom';

const fmt4 = (v: number) => v.toFixed(4);

/**
 * `points` = [x, y] (x = urutan observasi, y = σ). Skala linier ke kotak [pad, w−pad] × [pad, h−pad], y dibalik (nilai besar di atas).
 * Rentang nol (semua y sama, atau satu titik) → garis datar di tengah, tanpa pembagian nol; satu label saja karena min = max.
 */
export function polyline(points: [number, number][], w = 600, h = 160, pad = 24, fmt: (v: number) => string = fmt4): SVGSVGElement {
  const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': 'sigma_base history' });
  if (points.length === 0) {
    const t = svgEl('text', { x: w / 2, y: h / 2, 'text-anchor': 'middle', class: 'chart-empty' }); t.textContent = 'no observations yet'; svg.append(t);
    return svg;
  }
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const xMin = Math.min(...xs), xMax = Math.max(...xs), yMin = Math.min(...ys), yMax = Math.max(...ys);
  const sx = (x: number) => (xMax === xMin ? w / 2 : pad + ((x - xMin) / (xMax - xMin)) * (w - 2 * pad));
  const sy = (y: number) => (yMax === yMin ? h / 2 : h - pad - ((y - yMin) / (yMax - yMin)) * (h - 2 * pad));
  // Garis bantu putus-putus pada min dan max supaya label punya acuan.
  for (const y of yMax === yMin ? [yMin] : [yMin, yMax]) svg.append(svgEl('line', { x1: pad, x2: w - pad, y1: sy(y), y2: sy(y), class: 'chart-grid' }));
  svg.append(svgEl('polyline', { points: points.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(' '), class: 'chart-line' }));
  const last = points[points.length - 1]!;
  svg.append(svgEl('circle', { cx: sx(last[0]), cy: sy(last[1]), r: 3, class: 'chart-dot' }));
  const label = (text: string, y: number) => { const t = svgEl('text', { x: 4, y, class: 'chart-label' }); t.textContent = text; svg.append(t); };
  if (yMax === yMin) label(`σ ${fmt(yMin)} (flat)`, h / 2 - 6);
  else { label(`max ${fmt(yMax)}`, pad - 6); label(`min ${fmt(yMin)}`, h - pad + 14); }
  return svg;
}
