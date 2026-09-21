// useEvents.ts — irisan umpan aktivitas: event pool (terbaru dulu) + Observed engine (urut rantai) + status pindaian (seed/scanning/live/error).
import type { ObservedEvent, TradeEvent } from '@chain/chain/events';
import { useChain } from './provider';
import type { ChainState } from './types';

export interface EventsSlice extends Pick<ChainState, 'events' | 'eventsState'> {
  trades: TradeEvent[];
  observed: ObservedEvent[];
  /** Observasi terakhir (σ_base terbaru); null bila belum ada Observed sejak deploy. */
  lastObserved: ObservedEvent | null;
}
export function useEvents(): EventsSlice {
  const { events, eventsState } = useChain();
  return { events, eventsState, trades: events.trades, observed: events.observed, lastObserved: events.observed[events.observed.length - 1] ?? null };
}
