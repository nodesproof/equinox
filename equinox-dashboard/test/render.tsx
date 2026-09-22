// test/render.tsx — merender halaman/komponen di dalam ChainContext fixture + ClockProvider beku + router hash, tanpa ChainProvider/jaringan.
import type { ReactElement, ReactNode } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { Router } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { ChainContext } from '@/chain/provider';
import { ClockProvider } from '@/chain/clock';
import type { ChainState } from '@/chain/types';
import { chainState, type StateOverrides } from './fixtures/snapshot';

export interface Rendered extends RenderResult { state: ChainState }

/** Jam beku = `meta.nowMs` fixture agar umur/countdown deterministik; override nowMs lewat `chainState({ nowMs })`. */
export function Providers({ state, children }: { state: ChainState; children: ReactNode }) {
  return (
    <ChainContext.Provider value={state}>
      <ClockProvider nowMs={state.meta.nowMs}>
        <Router hook={useHashLocation}>{children}</Router>
      </ClockProvider>
    </ChainContext.Provider>
  );
}

export function renderWithChain(ui: ReactElement, over: StateOverrides | ChainState = {}): Rendered {
  const state = 'client' in over && 'refreshNow' in over ? (over as ChainState) : chainState(over as StateOverrides);
  const result = render(<Providers state={state}>{ui}</Providers>);
  return { ...result, state };
}
