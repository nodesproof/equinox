// test/parity.network.test.ts — bukti headless di Arbitrum Sepolia; hanya jalan bila EQUINOX_NETWORK_TESTS=1.
import { describe, expect, it } from 'vitest';
import { client } from '../src/chain/client';
import { readParity } from '../src/chain/parity';
import { readSnapshot } from '../src/chain/snapshot';
import { readGas } from '../src/chain/gas';
import { readEvents } from '../src/chain/events';
import { ALL_SERIES, BOARDS, GAS_KEYS, POOLS, POOL_KEYS, USDG } from '../src/deployment';
import { equinoxPoolAbi } from '../src/abi/equinoxPool';
import { mockUsdgAbi } from '../src/abi/mockUsdg';
const enabled = process.env.EQUINOX_NETWORK_TESTS === '1';
const ASSET_SCALE = 10n ** 12n;
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
const tag = (r: { strike: number; isCall: boolean; boardId: number }) => `${r.strike}${r.isCall ? 'C' : 'P'} #${r.boardId}`;
// Asersi bebas keadaan rantai: jumlah seri = 6 × jumlah board manifest (board 9/16 Okt ditambahkan setelah 25 Sep); hanya seri hidup yang dikuotasi.
describe.skipIf(!enabled)('live Sepolia', () => {
  it('math parity holds on every live series; pool.math() matches the manifest; quotes bracket the σ₀ mark (R3-a); gas estimates exist', async () => {
    const s = await readSnapshot(client);
    expect(s.series).toHaveLength(6 * BOARDS.length);
    // `math` immutable di pool = alamat math manifest (A: BlackScholesSol, B dan C: program Stylus) — yang dipanggil parity.ts adalah kontrak yang sama dengan pool.
    // `asset()` pool = aset manifest per pool (A/B MockUSDG, C USDG Paxos asli) — alamat yang dipakai approve/saldo di UI adalah yang dibaca pool.
    for (const k of POOL_KEYS) {
      expect(await client.readContract({ address: POOLS[k].pool, abi: equinoxPoolAbi, functionName: 'math' }), `${k} math()`).toBe(POOLS[k].math);
      expect(await client.readContract({ address: POOLS[k].pool, abi: equinoxPoolAbi, functionName: 'asset' }), `${k} asset()`).toBe(POOLS[k].asset);
      // Setiap board manifest terdaftar di setiap pool (snapshot menoleransi `board()` yang revert di pool selain yang pertama — di sini dibuktikan tidak terjadi).
      expect(await client.readContract({ address: POOLS[k].pool, abi: equinoxPoolAbi, functionName: 'boardCount', blockNumber: s.blockNumber }), `${k} boardCount()`).toBeGreaterThanOrEqual(BigInt(BOARDS.length));
      // `cash` snapshot = balanceOf(pool) pada aset pool itu (WAD); pool C hidup dengan aset asli — saldo > 0 sejak seed dari faucet Paxos.
      expect(s.pools[k].cash, `${k} cash`).toBe((await client.readContract({ address: POOLS[k].asset, abi: mockUsdgAbi, functionName: 'balanceOf', args: [POOLS[k].pool], blockNumber: s.blockNumber })) * ASSET_SCALE);
      expect(s.pools[k].cash > 0n, `${k} cash > 0`).toBe(true);
    }
    if (POOL_KEYS.includes('C')) expect(POOLS.C.asset).not.toBe(USDG);
    const live = s.series.filter((r) => r.ref.expiry > s.blockTime + 60);
    expect(live.length).toBeGreaterThan(0);
    for (const r of live) for (const k of POOL_KEYS) expect(r[k].buy, `${k} quote ${tag(r.ref)}`).not.toBeNull();
    const parity = await readParity(client, s);
    for (const p of parity.filter((p) => p.ref.expiry > s.blockTime + 60)) {
      expect(p.ok, `parity ${tag(p.ref)}`).toBe(true);
      // R3-a per pool, 1 unit: buy ≥ mark σ₀ ≥ close. `priceSol` = harga Solidity 1 unit pada σ_mark(0) (WAD) = p0 di quoteBuy/quoteClose pada blok yang sama;
      // premi = ceil(max(p_buy, p0) / 1e12) ≥ ceil(p0 / 1e12); proceeds = floor(min(p_close, p0) / 1e12) ≤ floor(p0 / 1e12).
      const row = s.series.find((r) => r.ref.id.A === p.ref.id.A)!;
      expect(p.priceSol, `priceSol ${tag(p.ref)}`).not.toBeNull();
      for (const k of POOL_KEYS) {
        expect(row[k].buy!.premium >= ceilDiv(p.priceSol!, ASSET_SCALE), `${k} buy ${row[k].buy!.premium} ≥ mark ${ceilDiv(p.priceSol!, ASSET_SCALE)} ${tag(p.ref)}`).toBe(true);
        expect(row[k].close !== null && row[k].close <= p.priceSol! / ASSET_SCALE, `${k} close ${row[k].close} ≤ mark ${p.priceSol! / ASSET_SCALE} ${tag(p.ref)}`).toBe(true);
      }
    }
    const g = await readGas(client, s);
    expect(g?.gas.A).not.toBeNull(); expect(g?.gas.B).not.toBeNull();
    expect(Object.keys(g!.gas)).toEqual([...GAS_KEYS]); // counter gas tetap A vs B walau pool C ada
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
    for (const t of trades) expect(POOL_KEYS).toContain(t.pool);
    console.log(JSON.stringify({ toBlock: bn.toString(), trades: trades.length, observed: observed.length, perPool: Object.fromEntries(POOL_KEYS.map((k) => [k, trades.filter((t) => t.pool === k).length])),
      firstThree: trades.slice(0, 3), lastObserved: observed[observed.length - 1] }, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 1));
  }, 90_000);
  // Jalur akun (Task 2, sebelumnya tak teruji): snapshot dengan akun owner — dibaca dari snapshot (`pools.A.owner`), bukan hard-coded.
  // Keadaan rantai 20 Sep: seed LP 1e12 share per pool (tidak berubah oleh settle/claim); posisi demo 5 C 2800 #0 (idx 4) dan 1 P 2400 #0 (idx 1) di kedua
  // pool HANYA sampai board 0 settle dan di-claim (`--claim`, Jum 25 Sep) — sesudahnya posisi itu 0, jadi nilai persisnya hanya diasersi selama
  // `series[4].A.settled === false`. Smoke test (board 1, 0,01 unit, redeem share yang sama) mengembalikan share dan posisi ke nilai ini.
  it('user path: readSnapshot(client, owner) fills asset balance, shares, positions and allowance on every pool', async () => {
    const s0 = await readSnapshot(client);
    const owner = s0.pools.A.owner;
    expect(s0.pools.B.owner).toBe(owner);
    if (POOL_KEYS.includes('C')) expect(s0.pools.C.owner, 'C owner').toBe(owner);
    expect(s0.user).toBeNull();
    const s = await readSnapshot(client, owner);
    const u = s.user!;
    expect(u).not.toBeNull();
    expect(u.address).toBe(owner);
    expect(u.shares.A).toBe(1_000_000_000_000n);
    expect(u.shares.B).toBe(1_000_000_000_000n);
    expect(ALL_SERIES[4]).toMatchObject({ boardId: 0, strike: 2800, isCall: true });
    expect(ALL_SERIES[1]).toMatchObject({ boardId: 0, strike: 2400, isCall: false });
    const board0Open = s.series[4]!.A.settled === false;
    // Posisi per pool selalu selebar ALL_SERIES (juga C); posisi demo dan allowance MockUSDG hanya fakta pool A/B (dibuka sebelum Pool C ada).
    for (const k of POOL_KEYS) expect(u.positions[k], `${k} positions`).toHaveLength(ALL_SERIES.length);
    for (const k of ['A', 'B'] as const) {
      if (board0Open) {
        expect(u.positions[k][4], `${k} C 2800 #0`).toBe(5n * 10n ** 18n);
        expect(u.positions[k][1], `${k} P 2400 #0`).toBe(10n ** 18n);
      }
      expect(u.allowance[k] > 0n, `${k} allowance`).toBe(true);
    }
    if (POOL_KEYS.includes('C')) expect(u.shares.C > 0n, 'C shares (seed LP from the Paxos faucet)').toBe(true);
    // Saldo aset per pool: A dan B membaca token mock yang sama (nilai identik, > 0 untuk owner); C membaca USDG Paxos asli (token lain — nilainya bebas, hanya bentuknya diasersi).
    for (const k of POOL_KEYS) expect(typeof u.asset[k], `${k} asset balance`).toBe('bigint');
    expect(u.asset.A > 0n).toBe(true);
    expect(u.asset.B).toBe(u.asset.A);
    if (POOL_KEYS.includes('C')) expect(u.asset.C, 'C asset balance').toBe(await client.readContract({ address: POOLS.C.asset, abi: mockUsdgAbi, functionName: 'balanceOf', args: [owner], blockNumber: s.blockNumber }));
    console.log(JSON.stringify({ block: s.blockNumber.toString(), owner, board0Open, asset: u.asset, shares: u.shares, allowance: u.allowance,
      positions: Object.fromEntries(POOL_KEYS.map((k) => [k, u.positions[k].map(String)])) }, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
  }, 60_000);
});
