// route.ts — rute hash dengan kueri DI DALAM hash (`#/trade?pool=B&series=3`, putusan pengendali Task 1/4): deep link aman di GitHub Pages,
// dan `?rpc=`/`?poll=` (dibaca data layer dari `location.search`) tidak pernah tersentuh. Tautan berkueri dibangun sebagai <a href> polos
// lewat `tradeHref`/`boardsHref` — BUKAN <Link> wouter, karena `navigate()` wouter memindahkan `?…` ke `location.search` (menimpa `?poll=`).
import { useMemo } from 'react';
import { useHashLocation, type navigate } from 'wouter/use-hash-location';
import { ALL_SERIES, BOARDS, POOL_KEYS, type PoolKey } from '@chain/deployment';

/** Kueri di dalam hash: `#/trade?pool=B&series=3` → `URLSearchParams("pool=B&series=3")`; tanpa kueri → kosong. */
export function hashQuery(hash: string = typeof window !== 'undefined' ? window.location.hash : ''): URLSearchParams {
  return new URLSearchParams(hash.split('?')[1] ?? '');
}
/** Tautan prefill Trade: `k` = pool, `seriesIndex` = posisi di ALL_SERIES (= `SeriesView.i`, parameter useTrade). */
export const tradeHref = (k: PoolKey, seriesIndex: number) => `#/trade?pool=${k}&series=${seriesIndex}`;
/** Tautan Boards, opsional difokuskan ke satu board (`#/boards?board=1`). */
export const boardsHref = (boardId?: number) => (boardId === undefined ? '#/boards' : `#/boards?board=${boardId}`);

/** `pool` dari kueri bila ada di POOL_KEYS; selain itu null. */
export const queryPool = (q: URLSearchParams): PoolKey | null => POOL_KEYS.find((k) => k === q.get('pool')) ?? null;
/** `series` dari kueri bila bilangan bulat di [0, ALL_SERIES.length); selain itu null. */
export function querySeries(q: URLSearchParams): number | null {
  const v = q.get('series'); if (v === null || !/^\d+$/.test(v)) return null;
  const i = Number(v); return i < ALL_SERIES.length ? i : null;
}
/** `board` dari kueri bila id ada di BOARDS; selain itu null. */
export function queryBoard(q: URLSearchParams): number | null {
  const v = q.get('board'); if (v === null || !/^\d+$/.test(v)) return null;
  const id = Number(v); return BOARDS.some((b) => b.id === id) ? id : null;
}

/** Hook lokasi untuk <Router>: `useHashLocation` wouter yang path-nya dipotong sebelum `?` agar `#/trade?pool=B` tetap cocok dengan rute `/trade`. */
export function useHashRoute(): [string, typeof navigate] {
  const [loc, nav] = useHashLocation();
  return [loc.split('?')[0] || '/', nav];
}
// Formatter href <Link> = milik useHashLocation (`'#' + href`); dibaca saat runtime karena tipe wouter tidak mengeksposnya.
useHashRoute.hrefs = (useHashLocation as unknown as { hrefs?: (href: string) => string }).hrefs ?? ((href: string) => `#${href}`);

/** Kueri hash yang reaktif terhadap `hashchange` (memo per lokasi mentah) — untuk prefill halaman tanpa remount. */
export function useHashQuery(): URLSearchParams {
  const [loc] = useHashLocation();
  return useMemo(() => new URLSearchParams(loc.split('?')[1] ?? ''), [loc]);
}
