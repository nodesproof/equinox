import type { Client } from './client';

// Stub Task 1: hanya blok terakhir. Task 2 mengganti file ini dengan snapshot penuh (multicall kedua pool, engine, feed).
export interface Snapshot { fetchedAtMs: number; blockNumber: bigint; blockTime: number }

export async function readSnapshot(client: Client): Promise<Snapshot> {
  const b = await client.getBlock();
  return { fetchedAtMs: Date.now(), blockNumber: b.number, blockTime: Number(b.timestamp) };
}
