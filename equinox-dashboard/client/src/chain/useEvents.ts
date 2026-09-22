// useEvents.ts — irisan umpan aktivitas: event pool (terbaru dulu) + Observed engine (urut rantai) + status pindaian (seed/scanning/live/error)
// + metadata seed hasil build (tanggal & blok terakhir) untuk kaki halaman Activity.
import type { ObservedEvent, TradeEvent } from '@chain/chain/events';
import { useChain } from './provider';
import type { ChainState } from './types';

export interface EventsSlice extends Pick<ChainState, 'events' | 'eventsState' | 'seed'> {
  trades: TradeEvent[];
  observed: ObservedEvent[];
  /** Observasi terakhir (σ_base terbaru); null bila belum ada Observed sejak deploy. */
  lastObserved: ObservedEvent | null;
}
export function useEvents(): EventsSlice {
  const { events, eventsState, seed } = useChain();
  return { events, eventsState, seed, trades: events.trades, observed: events.observed, lastObserved: events.observed[events.observed.length - 1] ?? null };
}
