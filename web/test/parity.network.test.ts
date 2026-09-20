// test/parity.network.test.ts — bukti headless di Arbitrum Sepolia; hanya jalan bila EQUINOX_NETWORK_TESTS=1.
import { describe, expect, it } from 'vitest';
import { client } from '../src/chain/client';
import { readParity } from '../src/chain/parity';
import { readSnapshot } from '../src/chain/snapshot';
import { readGas } from '../src/chain/gas';
const enabled = process.env.EQUINOX_NETWORK_TESTS === '1';
describe.skipIf(!enabled)('live Sepolia', () => {
  it('math parity holds on every live series; quotes are per-pool consistent; gas estimates exist', async () => {
    const s = await readSnapshot(client);
    expect(s.series).toHaveLength(12);
    const live = s.series.filter((r) => r.ref.expiry > s.blockTime + 60);
    expect(live.length).toBeGreaterThan(0);
    for (const r of live) { expect(r.A.buy, `A quote ${r.ref.strike}${r.ref.isCall ? 'C' : 'P'}`).not.toBeNull(); expect(r.B.buy).not.toBeNull(); }
    const parity = await readParity(client, s);
    for (const p of parity.filter((p) => p.ref.expiry > s.blockTime + 60)) expect(p.ok, `parity ${p.ref.strike}${p.ref.isCall ? 'C' : 'P'}`).toBe(true);
    const g = await readGas(client, s);
    expect(g?.gas.A).not.toBeNull(); expect(g?.gas.B).not.toBeNull();
    console.log(JSON.stringify({ block: s.blockNumber.toString(), spot: s.feed.answer.toString(), sigmaMark0: s.vol.sigmaMark0.toString(), gas: g }, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
  }, 60_000);
});
