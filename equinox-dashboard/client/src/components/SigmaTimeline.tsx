// SigmaTimeline.tsx — garis waktu σ_base halaman Activity: SigmaChart yang sama (satu implementasi grafik) dalam mode sumbu blok, dengan
// penanda Settled dari umpan event dan perkiraan waktu blok (`blockTime − (snapshotBlock − blok) × 0.25 s`, selalu "≈") dari snapshot.
// Tanpa snapshot → hanya nomor blok pada label; tanpa observasi → empty-state jujur SigmaChart.
import { memo, useMemo } from 'react';
import type { ObservedEvent, TradeEvent } from '@chain/chain/events';
import type { Snapshot } from '@chain/chain/snapshot';
import type { EventsState } from '@/chain/types';
import { SigmaChart } from '@/components/SigmaChart';
import { TIME_APPROX_NOTE, blockTimeApprox, settledMarkers } from '@/lib/activity';

export interface SigmaTimelineProps {
  observed: ObservedEvent[];
  trades: TradeEvent[];
  eventsState: EventsState;
  /** Blok & waktu snapshot untuk perkiraan waktu; null sebelum snapshot pertama. */
  snapshot: Pick<Snapshot, 'blockNumber' | 'blockTime' | 'vol'> | null;
}

const HEADING = { eyebrow: 'Volatility engine · shared · timeline', title: 'σ_base over blocks' };

function SigmaTimelineView({ observed, trades, eventsState, snapshot }: SigmaTimelineProps) {
  const markers = useMemo(() => settledMarkers(trades), [trades]);
  const timeOf = useMemo(() => (snapshot ? (block: bigint) => blockTimeApprox(block, snapshot.blockNumber, snapshot.blockTime) : null), [snapshot]);
  return <SigmaChart observed={observed} eventsState={eventsState} vol={snapshot?.vol ?? null} xAxis="block" markers={markers} timeOf={timeOf} timeNote={TIME_APPROX_NOTE} heading={HEADING} />;
}

/** Memo pada (observed, trades, eventsState, snapshot) — snapshot berganti tiap poll, tetapi grafik hanya menghitung ulang fungsi waktu. */
export const SigmaTimeline = memo(SigmaTimelineView);
