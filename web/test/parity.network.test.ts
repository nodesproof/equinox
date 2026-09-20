// test/parity.network.test.ts — bukti headless di Arbitrum Sepolia; hanya jalan bila EQUINOX_NETWORK_TESTS=1.
import { describe, expect, it } from 'vitest';
import { client } from '../src/chain/client';
import { readParity } from '../src/chain/parity';
import { readSnapshot } from '../src/chain/snapshot';
import { readGas } from '../src/chain/gas';
import { readEvents } from '../src/chain/events';
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
  // Ambang = keadaan rantai yang diverifikasi 20 Sep: 6 event trade (3 per pool; tx out-of-gas revert tanpa event, ulangannya yang tercatat)
  // dan 6 Observed (engine hanya emit saat ada round Chainlink baru). Angka hanya bisa bertambah.
  it('reads every pool event and Observed since deploy in 50k-block windows', async () => {
    const bn = await client.getBlockNumber();
    const { trades, observed } = await readEvents(client, bn);
    expect(trades.length).toBeGreaterThanOrEqual(6);
    expect(observed.length).toBeGreaterThanOrEqual(6);
    for (const t of trades) { expect(t.label).toMatch(/^([CP] \d+ #\d+|board #\d+)$/); expect(t.amount).not.toBe(''); expect(t.tx).toMatch(/^0x[0-9a-f]{64}$/); }
    for (let i = 1; i < trades.length; i++) expect(trades[i - 1]!.block >= trades[i]!.block, 'trades newest first').toBe(true);
    for (let i = 1; i < observed.length; i++) expect(observed[i - 1]!.block <= observed[i]!.block, 'observed in chain order').toBe(true);
    console.log(JSON.stringify({ toBlock: bn.toString(), trades: trades.length, observed: observed.length, perPool: { A: trades.filter((t) => t.pool === 'A').length, B: trades.filter((t) => t.pool === 'B').length },
      firstThree: trades.slice(0, 3), lastObserved: observed[observed.length - 1] }, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 1));
  }, 90_000);
});
