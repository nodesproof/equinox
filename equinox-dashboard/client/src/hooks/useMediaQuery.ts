// useMediaQuery.ts — `matchMedia` sebagai external store (useSyncExternalStore): true bila kueri cocok, mengikuti perubahan lebar layar.
// Aman untuk jsdom/SSR: tanpa `window.matchMedia` hasilnya selalu false (tampilan desktop) — test yang ingin tampilan telepon mem-mock matchMedia.
import { useCallback, useSyncExternalStore } from 'react';

const hasMatchMedia = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    if (!hasMatchMedia()) return () => {};
    const mql = window.matchMedia(query);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  const getSnapshot = useCallback(() => (hasMatchMedia() ? window.matchMedia(query).matches : false), [query]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** Breakpoint bersama (sinkron dengan index.css): ≤ 640 px = telepon (daftar kartu seri, notice ringkas), ≤ 399 px = tombol wallet ikon saja. */
export const PHONE_QUERY = '(max-width: 640px)';
export const NARROW_QUERY = '(max-width: 399px)';
export const usePhone = () => useMediaQuery(PHONE_QUERY);
