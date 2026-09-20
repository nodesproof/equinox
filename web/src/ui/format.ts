export const usdg = (x: bigint, digits = 2) => (Number(x) / 1e6).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const usdg6 = (x: bigint) => (Number(x) / 1e6).toFixed(6);
export const wad = (x: bigint, digits = 4) => (Number(x) / 1e18).toFixed(digits);
export const pct = (x: bigint, digits = 2) => `${(Number(x) / 1e16).toFixed(digits)} %`;
export const feedUsd = (a: bigint) => (Number(a) / 1e8).toFixed(2);
export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const shortHash = (h: string) => `${h.slice(0, 10)}…`;
export function fmtAge(seconds: number): string {
  const s = Math.max(0, seconds);
  if (s < 90) return `${Math.round(s)} s ago`;
  if (s < 5400) return `${(s / 60).toFixed(1)} min ago`;
  if (s < 48 * 3600) return `${(s / 3600).toFixed(1)} h ago`;
  return `${(s / 86400).toFixed(1)} d ago`;
}
export function fmtCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}
export const utc = (ts: number) => new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
/** Selisih relatif |a−b|/max(a,b) sebagai string, mis. "2.4e-5". */
export function relDiff(a: bigint, b: bigint): string {
  const hi = a > b ? a : b; if (hi === 0n) return '0';
  const d = a > b ? a - b : b - a;
  if (d === 0n) return '0'; // nilai sama → "0", bukan "0.0e+0"
  return (Number(d) / Number(hi)).toExponential(1);
}
