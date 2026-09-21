// contracts.ts — helper murni halaman Contracts: baris alamat dari manifest (`@chain/deployment` — satu-satunya sumber alamat; tidak ada alamat
// yang diketik di sini), tautan explorer/Sourcify, baris `cfg()` per pool dan `params()` engine dengan satuan, tautan dokumentasi, dan
// paragraf kejujuran (kalimat dari `web/src/panels/footer.ts`, daftar pool diturunkan dari manifest).
import { CHAIN_ID, COMMIT, DEPLOYER, FEED, MATH_SOL, MATH_STYLUS, POOLS, POOL_KEYS, SEQ, USDG, VOL, type PoolKey } from '@chain/deployment';
import type { PoolCfg, VolState } from '@chain/chain/snapshot';
import { fmtCountdown, pct, usdg, utc, wad } from '@chain/ui/format';
import { bpsPct } from '@/lib/format';
import { listPools, mintPools, paxosPools } from '@/lib/trade';

export const REPO = 'https://github.com/nodesproof/equinox';
/** Sourcify: repositori sumber terverifikasi per chain id + alamat (pola `https://repo.sourcify.dev/<chainId>/<address>`). */
export const sourcifyUrl = (address: string) => `https://repo.sourcify.dev/${CHAIN_ID}/${address}`;
/** Tautan commit GitHub bila COMMIT berbentuk SHA (7+ hex); `dev`/`test` → null. */
export const commitUrl = (commit: string = COMMIT): string | null => (/^[0-9a-f]{7,40}$/i.test(commit) ? `${REPO}/commit/${commit}` : null);

// ---------------------------------------------------------------- alamat

export interface AddressRow {
  /** Kelompok tabel: satu per pool + "shared". */
  group: string;
  label: string;
  address: string;
  /** Catatan pendek (peran / mock vs asli). */
  note: string;
}
/** Baris per pool (pool, option token, math) lalu kontrak bersama — urutan & label = footer klasik; USDG Paxos hanya bila ada pool ber-aset Paxos. */
export function addressRows(): AddressRow[] {
  const rows: AddressRow[] = [];
  for (const k of POOL_KEYS) {
    const p = POOLS[k];
    rows.push(
      { group: `Pool ${k}`, label: p.label, address: p.pool, note: `ERC-4626 vault · ${p.faucet === 'paxos' ? `real ${p.assetSymbol} (Paxos, testnet)` : `mock ${p.assetSymbol}`} · quotes, buy/close/settle/claim` },
      { group: `Pool ${k}`, label: `Option token ${k}`, address: p.token, note: 'ERC-1155 — one id per series (keccak of pool, expiry, strike, isCall)' },
      { group: `Pool ${k}`, label: `Math ${k}`, address: p.math, note: p.math === MATH_STYLUS ? 'Stylus program (cached) — same address for every Stylus pool' : p.math === MATH_SOL ? 'BlackScholesSol (Solidity control)' : 'pricing contract' },
    );
  }
  rows.push(
    { group: 'Shared', label: 'Shared vol engine (EWMA from Chainlink)', address: VOL, note: 'one σ_base / σ_mark(0) for every pool — params() below' },
    { group: 'Shared', label: 'Math A — BlackScholesSol', address: MATH_SOL, note: 'Solidity control implementation (K5 parity, left side)' },
    { group: 'Shared', label: 'Math B — Stylus program (cached)', address: MATH_STYLUS, note: 'Rust/Stylus implementation (K5 parity, right side)' },
    { group: 'Shared', label: 'Chainlink ETH/USD (real)', address: FEED, note: 'real testnet price feed — the only non-mock input' },
  );
  const mint = mintPools(), paxos = paxosPools();
  if (mint.length) rows.push({ group: 'Shared', label: `MockUSDG (6 dp, open mint = faucet — asset of ${mint.length === 1 ? 'Pool' : 'Pools'} ${listPools(mint)})`, address: USDG, note: 'mock, no real value' });
  for (const k of paxos) rows.push({ group: 'Shared', label: `${POOLS[k].assetSymbol} (Paxos, real testnet token — asset of Pool ${k})`, address: POOLS[k].asset, note: 'permissioned mint · faucet.paxos.com gives 100/day' });
  rows.push(
    { group: 'Shared', label: 'MockSequencerFeed (no L2 uptime feed on Sepolia)', address: SEQ, note: 'mock — always "up"; the real feed exists only on Arbitrum One' },
    { group: 'Shared', label: 'Deployer / treasury (EOA)', address: DEPLOYER, note: 'owner of the pools; fees go here on this testnet deployment' },
  );
  return rows;
}
/** Kelompok berurutan (Pool A, Pool B, …, Shared) untuk header tabel. */
export const addressGroups = (rows: AddressRow[]): string[] => rows.map((r) => r.group).filter((g, i, a) => a.indexOf(g) === i);

// ---------------------------------------------------------------- konfigurasi live

export interface CfgField { key: keyof PoolCfg; label: string; hint: string }
/** 11 field `cfg()` — nama & urutan = tuple ABI; label untuk kerangka sebelum snapshot (tanpa nilai). */
export const CFG_FIELDS: CfgField[] = [
  { key: 'feeBps', label: 'Fee (feeBps)', hint: 'of the premium, charged on buy' },
  { key: 'maxUtilBps', label: 'Reserve cap (maxUtilBps)', hint: 'reserved ≤ this share of capital for caps' },
  { key: 'vegaCapBps', label: 'Vega cap (vegaCapBps)', hint: 'net vega ≤ this share of capital for caps' },
  { key: 'minPremiumBps', label: 'Min premium (minPremiumBps)', hint: 'floor of premium / notional' },
  { key: 'heartbeat', label: 'Oracle heartbeat', hint: 'Chainlink round cadence assumed' },
  { key: 'staleMult', label: 'Stale multiplier (staleMult)', hint: 'round older than heartbeat × staleMult → OracleStale' },
  { key: 'sequencerGrace', label: 'Sequencer grace', hint: 'wait after the L2 sequencer comes back' },
  { key: 'maxOpenSeries', label: 'Max open series', hint: 'per pool' },
  { key: 'tenorMax', label: 'Max tenor', hint: 'longest expiry a board may list' },
  { key: 'minSize', label: 'Min size', hint: 'smallest buy/close (SizeTooSmall below)' },
  { key: 'settleBounty', label: 'Settle bounty', hint: 'paid to whoever calls settle after expiry' },
];
const seconds = (s: number) => `${s.toLocaleString('en-US')} s (${fmtCountdown(s)})`;
/** Satu nilai `cfg()` dengan satuannya: bps → %, detik → s + durasi, multiplier → ×, minSize → units (WAD), settleBounty → aset pool (6 dp). */
export function cfgValue(key: keyof PoolCfg, c: PoolCfg, k: PoolKey): string {
  switch (key) {
    case 'feeBps': case 'maxUtilBps': case 'vegaCapBps': case 'minPremiumBps': return bpsPct(c[key]);
    case 'heartbeat': case 'sequencerGrace': case 'tenorMax': return seconds(c[key]);
    case 'staleMult': return `${c.staleMult}×`;
    case 'maxOpenSeries': return c.maxOpenSeries.toLocaleString('en-US');
    case 'minSize': return `${wad(c.minSize, 2)} units`;
    case 'settleBounty': return `${usdg(c.settleBounty)} ${POOLS[k].assetSymbol}`;
  }
}
export interface ConfigRow extends CfgField { /** Nilai terformat per pool (urutan POOL_KEYS). */ values: string[] }
export const cfgRows = (cfgs: Record<PoolKey, PoolCfg>): ConfigRow[] => CFG_FIELDS.map((f) => ({ ...f, values: POOL_KEYS.map((k) => cfgValue(f.key, cfgs[k], k)) }));
/** Nilai `cfg()` identik di semua pool? (kolom bisa diringkas menjadi satu bila ya). */
export const cfgIdentical = (rows: ConfigRow[]) => rows.every((r) => r.values.every((v) => v === r.values[0]));

export interface ParamRow { label: string; /** null sebelum snapshot. */ value: string | null; hint: string }
/** `params()` engine + σ_base + observasi terakhir — semua dari `snapshot.vol`; null → hanya label (kerangka). */
export function engineRows(vol: VolState | null): ParamRow[] {
  return [
    { label: 'EWMA decay λ', value: vol && `${wad(vol.lambdaPerDay, 2)} / day`, hint: 'weight of realised variance per day' },
    { label: 'VRP multiplier', value: vol && `${wad(vol.vrp, 2)}×`, hint: 'σ_mark(0) = σ_base × VRP' },
    { label: 'Inventory sensitivity α', value: vol && wad(vol.alpha, 2), hint: 'σ_mark(u) = σ_mark(0) × (1 + α·u)' },
    { label: 'Buy / close spread', value: vol && pct(vol.spread), hint: 'close quotes at σ_mark × (1 − spread)' },
    { label: 'σ clamp [σ_min, σ_max]', value: vol && `${wad(vol.sigmaMin, 2)} – ${wad(vol.sigmaMax, 2)}`, hint: 'annualised bounds of σ_base' },
    { label: 'σ_base now', value: vol && wad(vol.sigmaBase), hint: 'annualised EWMA at the snapshot block' },
    { label: 'Last round observed', value: vol && `…${vol.lastRoundId.toString().slice(-5)}`, hint: vol ? `lastRoundId ${vol.lastRoundId}` : 'lastRoundId' },
    { label: 'Last observation', value: vol && utc(vol.lastTs), hint: vol ? `lastTs ${vol.lastTs}` : 'lastTs' },
  ];
}

// ---------------------------------------------------------------- dokumentasi & kejujuran

/** Ikon tautan docs (kunci, bukan komponen — helper ini bebas React; `DocsPanel` memetakannya ke lucide). */
export type DocIcon = 'book' | 'code' | 'scroll' | 'shield';
export interface DocLink { label: string; path: string; detail: string; icon: DocIcon }
/** Tautan docs (GitHub `main`) — README, BENCHMARK, DEMO_LOG, PRD, OPS, VERIFICATION; ikon per tautan (bukan per indeks). */
export const DOCS: DocLink[] = [
  { label: 'README', path: 'README.md', detail: 'what Equinox is, how to run it, the three pools', icon: 'book' },
  { label: 'Benchmark', path: 'docs/BENCHMARK.md', detail: 'Stylus vs Solidity gas, program cached', icon: 'code' },
  { label: 'Demo log', path: 'docs/DEMO_LOG.md', detail: 'every demo transaction with its hash', icon: 'scroll' },
  { label: 'PRD / architecture', path: 'prd-arsitektur.md', detail: 'requirements and architecture (Indonesian)', icon: 'book' },
  { label: 'Ops on Sepolia', path: 'docs/OPS_SEPOLIA.md', detail: 'keeper, boards, settlement runbook', icon: 'scroll' },
  { label: 'Verification', path: 'docs/VERIFICATION.md', detail: 'source verification and parity checks', icon: 'shield' },
];
export const docUrl = (d: DocLink) => `${REPO}/blob/main/${d.path}`;

/** Paragraf kejujuran = kalimat footer klasik (`web/src/panels/footer.ts`), daftar pool mock/Paxos dari manifest; tanpa pool Paxos kalimat Pool C hilang. */
export function honestySentences(): string[] {
  const mint = mintPools(), paxos = paxosPools();
  const mockPart = mint.length ? `USDG on ${mint.join('/')} and the sequencer feed are mocks` : 'the sequencer feed is a mock';
  const paxosPart = paxos.length ? ` (Paxos USDG exists on Sepolia but its mint is permissioned and the faucet gives 100/day; Pool ${paxos.join('/')} uses the real token)` : '';
  return [
    `Mocked on purpose: ${mockPart}${paxosPart}; the price feed is the real Chainlink ETH/USD.`,
    'All pools share one volatility engine (σ_base / σ_mark(0) identical by construction); pool quotes may differ through the inventory term of σ_mark once trade histories or pool sizes diverge — the live identity claim is math parity (both math contracts return byte-identical prices for identical inputs).',
    'Stylus gas numbers are with the program cached.',
    'Treasury = deployer wallet on this testnet deployment.',
  ];
}
