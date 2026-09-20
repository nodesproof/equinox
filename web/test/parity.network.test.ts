// test/parity.network.test.ts — bukti headless di Arbitrum Sepolia; hanya jalan bila EQUINOX_NETWORK_TESTS=1.
import { describe, expect, it } from 'vitest';
import { client } from '../src/chain/client';
import { readParity } from '../src/chain/parity';
import { readSnapshot } from '../src/chain/snapshot';
import { readGas } from '../src/chain/gas';
import { readEvents } from '../src/chain/events';
import { ALL_SERIES, POOL_KEYS } from '../src/deployment';
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
  // Jalur akun (Task 2, sebelumnya tak teruji): snapshot dengan akun owner — dibaca dari snapshot (`pools.A.owner`), bukan hard-coded.
  // Keadaan rantai 20 Sep: seed LP 1e12 share per pool; posisi demo 5 C 2800 #0 (idx 4) dan 1 P 2400 #0 (idx 1) di kedua pool; allowance MAX.
  // Smoke test (board 1, 0,01 unit, redeem share yang sama) mengembalikan share dan posisi ke nilai ini.
  it('user path: readSnapshot(client, owner) fills shares, positions and allowance on both pools', async () => {
    const s0 = await readSnapshot(client);
    const owner = s0.pools.A.owner;
    expect(s0.pools.B.owner).toBe(owner);
    expect(s0.user).toBeNull();
    const s = await readSnapshot(client, owner);
    const u = s.user!;
    expect(u).not.toBeNull();
    expect(u.address).toBe(owner);
    expect(u.shares.A).toBe(1_000_000_000_000n);
    expect(u.shares.B).toBe(1_000_000_000_000n);
    expect(ALL_SERIES[4]).toMatchObject({ boardId: 0, strike: 2800, isCall: true });
    expect(ALL_SERIES[1]).toMatchObject({ boardId: 0, strike: 2400, isCall: false });
    for (const k of POOL_KEYS) {
      expect(u.positions[k]).toHaveLength(ALL_SERIES.length);
      expect(u.positions[k][4], `${k} C 2800 #0`).toBe(5n * 10n ** 18n);
      expect(u.positions[k][1], `${k} P 2400 #0`).toBe(10n ** 18n);
      expect(u.allowance[k] > 0n, `${k} allowance`).toBe(true);
    }
    expect(u.usdg > 0n).toBe(true);
    console.log(JSON.stringify({ block: s.blockNumber.toString(), owner, usdg: u.usdg.toString(), shares: u.shares, allowance: u.allowance,
      positions: { A: u.positions.A.map(String), B: u.positions.B.map(String) } }, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
  }, 60_000);
});
