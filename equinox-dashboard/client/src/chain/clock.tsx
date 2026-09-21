// clock.tsx — detak 1 s di context TERPISAH dari ChainContext (putusan pengendali Task 3): hanya komponen yang menampilkan umur data,
// countdown, atau badge live/stale yang berlangganan lewat useNow(); konsumen useChain() lain tidak dirender ulang oleh jam ini.
// `meta.nowMs` dari provider diabaikan di UI — umur dihitung dari useNow() terhadap `snapshot.fetchedAtMs` / `meta.lastOkMs` / `feed.updatedAt`.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/** Interval detak default (ms) — sama dengan `setInterval(paint, 1000)` UI klasik. */
export const TICK_MS = 1000;

const ClockContext = createContext<number | null>(null);

export interface ClockProviderProps {
  /** Jam beku (test/fixture): nilai ini dipakai apa adanya dan tidak ada interval yang berjalan. */
  nowMs?: number;
  /** Interval detak (ms); default TICK_MS. */
  tickMs?: number;
  children: ReactNode;
}

export function ClockProvider({ nowMs, tickMs = TICK_MS, children }: ClockProviderProps) {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (nowMs !== undefined) return;
    const id = setInterval(() => setTick(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [nowMs, tickMs]);
  return <ClockContext.Provider value={nowMs ?? tick}>{children}</ClockContext.Provider>;
}

/** Waktu dinding (ms) yang berdetak tiap TICK_MS; melempar di luar <ClockProvider> agar kesalahan wiring terlihat saat render. */
export function useNow(): number {
  const v = useContext(ClockContext);
  if (v === null) throw new Error('useNow() must be used inside <ClockProvider>');
  return v;
}
