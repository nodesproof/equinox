// useWallet.ts — irisan wallet: akun, jaringan, keberadaan wallet injected, gerbang busy, log tx, dan `canAct` (predikat tombol aksi panel Trade klasik).
import { useChain } from './provider';
import type { ChainState } from './types';

export interface WalletSlice extends Pick<ChainState, 'account' | 'wrongChain' | 'hasWallet' | 'busy' | 'txLog' | 'connect'> {
  /** Aksi tulis boleh dijalankan: ada wallet, akun terhubung, jaringan benar, tidak ada aksi lain yang berjalan. */
  canAct: boolean;
}
export function useWallet(): WalletSlice {
  const { account, wrongChain, hasWallet, busy, txLog, connect } = useChain();
  return { account, wrongChain, hasWallet, busy, txLog, connect, canAct: hasWallet && account !== null && !wrongChain && !busy };
}
