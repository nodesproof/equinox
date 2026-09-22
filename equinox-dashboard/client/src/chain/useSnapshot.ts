// useSnapshot.ts — irisan snapshot dari ChainProvider: data blok-pinned + meta + parity/gas yang menyusul, dan dua flag state awal untuk §8.2.
import { useChain } from './provider';
import type { ChainState } from './types';

export interface SnapshotSlice extends Pick<ChainState, 'snapshot' | 'meta' | 'parity' | 'gas' | 'refreshNow'> {
  /** Belum ada snapshot dan belum ada error: muat pertama (skeleton, tanpa angka palsu). */
  loading: boolean;
  /** Belum pernah ada snapshot dan RPC gagal: "RPC error on first load" (tombol retry = refreshNow). */
  failed: boolean;
}
export function useSnapshot(): SnapshotSlice {
  const { snapshot, meta, parity, gas, refreshNow } = useChain();
  return { snapshot, meta, parity, gas, refreshNow, loading: snapshot === null && meta.error === null, failed: snapshot === null && meta.error !== null };
}
