import { createPublicClient, http } from 'viem';
import { arbitrumSepolia } from 'viem/chains';
import { RPC_URL } from '../deployment';

/** `?rpc=http://127.0.0.1:8545` mengarahkan halaman ke node lokal (hanya loopback yang diterima). */
export function rpcOverride(search: string = typeof location !== 'undefined' ? location.search : ''): string | null {
  const v = new URLSearchParams(search).get('rpc');
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost' ? u.toString() : null;
  } catch {
    return null;
  }
}

export const chain = arbitrumSepolia; // id 421614; multicall3 sudah terdefinisi di viem
export const client = createPublicClient({ chain, transport: http(rpcOverride() ?? RPC_URL, { timeout: 15_000, retryCount: 1 }) });
export type Client = typeof client;
