# Equinox Plan 3b — Dashboard + trading via wallet, GitHub Pages, paket submission, PRD v1.4 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dashboard live di `https://nodesproof.github.io/equinox/` yang membaca dua pool Sepolia (A kontrol, B Stylus) lewat RPC publik — papan 12 seri × 2 pool dengan **paritas matematika** (K5), kuotasi berdampingan + Δ inventaris, NAV, counter gas `buy` A vs B, aktivitas & grafik σ — plus **trading dari wallet** (faucet USDG mock, deposit/redeem, buy/close/claim); lalu paket submission HackQuest (form, video script, Q&A juri, scorecard, runbook) dan PRD v1.4.

**Architecture:** `web/` = Vite 6 + TypeScript 5 + viem 2, tanpa framework (pola `../vigil/web`): satu `Snapshot` per refresh lewat `client.multicall` (Multicall3 bawaan chain `arbitrumSepolia`), panel = fungsi `{ root, render(snapshot, meta) }`; tulis lewat `createWalletClient(custom(window.ethereum))` dengan `simulateContract` sebelum `writeContract`; alamat dari `deployments/arbitrum-sepolia.json` (alias `@deployment` saat build). Deploy lewat workflow GitHub Pages dari `main`.

**Tech Stack:** Node 22, npm, Vite ^6, vitest ^2, TypeScript ^5, viem ^2.21 (`viem/chains` `arbitrumSepolia`), GitHub Actions (`actions/setup-node@v4`, `actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4`), agen `submission-packager` untuk Task 6.

**Spec:** `docs/superpowers/specs/2026-09-20-equinox-plan3-demo-design.md` §4 (web), §5 (submission), K1–K5. Plan 3a (`docs/superpowers/plans/2026-09-20-equinox-plan3a-sepolia.md`) selesai: PR #5 (stacked di atas #4).

## Global Constraints

- Root repo `/home/mdlog/Project-MDlabs/Hackquest/arbitrum-sg/Equinox`; branch **`feat/plan-3b`** dari `feat/plan-3a`. Path relatif root; perintah npm dijalankan dari `web/`.
- **Sumber alamat tunggal:** `deployments/arbitrum-sepolia.json` (`pools.{A,B}.{pool,token,math}`, `pools.vol`, `pools.usdg`, `pools.sequencerFeed`, `pools.feed`, `pools.deployedAtBlock`, `pools.boards[].{id,expiry,strikes,seriesIds.{A,B}}`, `blackScholesSol`, `blackScholesStylus`, `rpc`, `chainId` 421614). Tidak ada alamat hard-coded di `web/src` selain Multicall3 dan explorer `https://sepolia.arbiscan.io`.
- **K5 (mengikat):** klaim identitas = paritas matematika — untuk setiap seri terbuka, `cappedCall(S, K, 2K, t, σ₀, 0)` (call) / `quote(S, K, t, σ₀, 0, false)` (put) pada **kedua** kontrak `math` dengan input identik harus byte-identik (toleransi nol). Kuotasi pool A|B ditampilkan berdampingan dengan Δ (USDG dan relatif) dan util masing-masing; tidak ada klaim "kuotasi pool identik" tanpa syarat.
- Satuan: aset USDG 6 dp; harga/σ/vega WAD; `t = (expiry − blockTimestamp) × 1e18 / 31536000` (persis `EquinoxPool._years`); `S` = `answer × 1e10` dari feed 8 dp; K WAD = strike × 1e18; seri id = `keccak256(abi.encode(pool, expiry, strike, isCall))`; urutan `seriesIds` per board `[C K0, P K0, C K1, P K1, C K2, P K2]`.
- Wallet: hanya `window.ethereum` (injected); chain harus 421614 (`wallet_switchEthereumChain`, fallback `wallet_addEthereumChain`); setiap tulis lewat `simulateContract` → `writeContract` → `waitForTransactionReceipt`; slippage 1 %: `maxPremium = (premi + fee) × 1,01`, `minProceeds = proceeds × 0,99`. Tidak ada kunci privat apa pun di `web/`.
- Read-only tanpa wallet harus lengkap (juri tanpa MetaMask melihat semuanya). RPC publik: refresh tiap 15 s (`?poll=` ≥ 2000 ms), backoff saat gagal, banner "RPC unreachable" dengan data terakhir.
- ABI di-generate dari `contracts/out` oleh `web/scripts/gen-abi.mjs` (fungsi + error + event) dan **di-commit**; CI (job `foundry`) menegakkan drift.
- Test: vitest unit (format, seriesId, deployment, abi, trade builders) wajib hijau di CI; `parity.network.test.ts` hanya bila `EQUINOX_NETWORK_TESTS=1`. `npm run typecheck` (tsc --noEmit) dan `npm run build` wajib hijau.
- Verifikasi headless untuk jalur tulis: `web/test/smoke.network.test.ts` (`npm run smoke`) memakai `SEPOLIA_PRIVATE_KEY` dari `.env` (owner, ≈ 0,36 ETH) dan builder yang sama dengan UI — transaksi nyata KECIL di Pool B board 1 (2 Okt): faucet 100 USDG, deposit 10 USDG, `buy` 0,01 C 2.600, `close` 0,01, `redeem` semua share hasil deposit. Tidak ada trade di board 0 sebelum Jumat.
- Commit: pesan polos TANPA trailer/atribusi AI; identitas repo-lokal `nodesproof <mdnodes88@gmail.com>`. `web/node_modules/` dan `web/dist/` git-ignored.
- Bahasa: komentar kode & dokumen Indonesia (README/UI Inggris; teks UI Inggris karena juri internasional); identifier Inggris.
- Kejujuran (spec §5): rasio gas Sepolia dijelaskan (engine σ bersama); mock USDG/sequencer disebut di footer; "cached" disebut pada setiap angka gas Stylus; tx out-of-gas tidak dihapus dari log.

---

### Task 1: Scaffold `web/` — konfigurasi, ABI, adapter deployment, client, helper UI, header/footer, CI

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`, `web/scripts/gen-abi.mjs`, `web/src/vite-env.d.ts`, `web/src/deployment.ts`, `web/src/chain/client.ts`, `web/src/ui/dom.ts`, `web/src/ui/format.ts`, `web/src/ui/poll.ts`, `web/src/panels/types.ts`, `web/src/panels/header.ts`, `web/src/panels/footer.ts`, `web/src/styles.css`, `web/src/main.ts`, `web/test/deployment.test.ts`, `web/test/abi.test.ts`, `web/test/format.test.ts`, `web/test/seriesId.test.ts`, `web/README.md`
- Modify: `.gitignore` (tambah `web/dist/`), `.github/workflows/ci.yml` (job `web` + drift ABI di job `foundry`)
- Generated (commit): `web/src/abi/{equinoxPool,equinoxVolEngine,equinoxOptionToken,mockUsdg,mockSequencerFeed,aggregatorV3,blackScholes}.ts`, `web/package-lock.json`

**Interfaces:**
- Produces: `deployment.ts` mengekspor `CHAIN_ID, RPC_URL, EXPLORER, POOLS {A,B}: {pool, token, math, label}`, `VOL, USDG, SEQ, FEED, DEPLOYED_AT_BLOCK, BOARDS[] {id, expiry, strikes:number[], seriesIds:{A:bigint[],B:bigint[]}}`, `ALL_SERIES[] {boardId, expiry, strike, isCall, idx, id:{A,B}}`, `explorerAddress(), explorerTx()`; `client.ts` mengekspor `client` (PublicClient) dan `rpcOverride()`; `ui/*` helper; `Panel`/`Meta` types. Dipakai Task 2–4.

- [ ] **Step 1: `web/package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `vite-env.d.ts`**

`web/package.json`:
```json
{
  "name": "equinox-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:network": "EQUINOX_NETWORK_TESTS=1 vitest run test/parity.network.test.ts",
    "abi": "node scripts/gen-abi.mjs",
    "typecheck": "tsc --noEmit",
    "snapshot": "EQUINOX_NETWORK_TESTS=1 vitest run test/parity.network.test.ts --reporter=verbose",
    "smoke": "EQUINOX_SMOKE=1 vitest run test/smoke.network.test.ts --reporter=verbose"
  },
  "dependencies": {
    "viem": "^2.21.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.0"
  }
}
```

`web/vite.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import { execSync } from 'node:child_process';
import path from 'node:path';

// Satu manifest: deployment Sepolia (alamat pool, engine, board, seri) — sumber alamat tunggal untuk halaman.
const MANIFEST = path.resolve(__dirname, '..', 'deployments/arbitrum-sepolia.json');

function commit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  base: '/equinox/',
  resolve: { alias: { '@deployment': MANIFEST } },
  define: {
    __COMMIT__: JSON.stringify(commit()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: { target: 'es2022', sourcemap: false },
  test: { include: ['test/**/*.test.ts'] },
});
```

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "types": ["vite/client"],
    "paths": { "@deployment": ["../deployments/arbitrum-sepolia.json"] }
  },
  "include": ["src", "test", "vite.config.ts"]
}
```

`web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Equinox — on-chain options, no IV oracle</title>
    <meta name="description" content="Live view of two Equinox option pools on Arbitrum Sepolia: Solidity control vs Stylus, same math, same Chainlink-derived volatility — quotes, NAV, gas, and trading from your wallet." />
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='30' fill='%230b1220'/%3E%3Ccircle cx='32' cy='32' r='14' fill='none' stroke='%23f2c94c' stroke-width='6'/%3E%3C/svg%3E" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=Martian+Mono:wght@400;600&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./src/main.ts"></script>
  </body>
</html>
```

`web/src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />
declare const __COMMIT__: string;
declare const __BUILD_TIME__: string;
// `@deployment` diketik dari JSON-nya sendiri lewat tsconfig `paths` + `resolveJsonModule` (tanpa deklarasi ambient).
interface Window { ethereum?: { request(args: { method: string; params?: unknown[] }): Promise<unknown>; on?(ev: string, cb: (...a: unknown[]) => void): void } }
```

- [ ] **Step 2: `web/scripts/gen-abi.mjs` (fungsi + error + event), jalankan**

```js
// Membuat src/abi/<nama>.ts dari artefak Foundry di ../contracts/out. Jalankan `forge build` dulu (dari contracts/).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '..', 'contracts', 'out');
const dest = join(here, '..', 'src', 'abi');
mkdirSync(dest, { recursive: true });

const targets = [
  ['EquinoxPool.sol/EquinoxPool.json', 'equinoxPool'],
  ['EquinoxVolEngine.sol/EquinoxVolEngine.json', 'equinoxVolEngine'],
  ['EquinoxOptionToken.sol/EquinoxOptionToken.json', 'equinoxOptionToken'],
  ['MockUSDG.sol/MockUSDG.json', 'mockUsdg'],
  ['MockSequencerFeed.sol/MockSequencerFeed.json', 'mockSequencerFeed'],
  ['IAggregatorV3.sol/IAggregatorV3.json', 'aggregatorV3'],
  ['IBlackScholes.sol/IBlackScholes.json', 'blackScholes'],
];

for (const [artifact, name] of targets) {
  const { abi } = JSON.parse(readFileSync(join(out, artifact), 'utf8'));
  const keep = abi.filter((i) => i.type === 'function' || i.type === 'error' || i.type === 'event');
  const body = `// Dibuat oleh scripts/gen-abi.mjs dari contracts/out/${artifact} — jangan diedit.\nexport const ${name}Abi = ${JSON.stringify(keep, null, 2)} as const;\n`;
  writeFileSync(join(dest, `${name}.ts`), body);
  console.log(`wrote src/abi/${name}.ts (${keep.length} items)`);
}
```
Run: `cd contracts && forge build >/dev/null && cd ../web && npm install && npm run abi`
Expected: 7 baris `wrote src/abi/….ts`; `package-lock.json` dibuat.

- [ ] **Step 3: `web/src/deployment.ts`**

```ts
import { encodeAbiParameters, getAddress, keccak256, parseAbiParameters } from 'viem';
import manifest from '@deployment';

export type PoolKey = 'A' | 'B';
export const CHAIN_ID = manifest.chainId;                 // 421614
export const RPC_URL = manifest.rpc;
export const EXPLORER = 'https://sepolia.arbiscan.io';
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const;
const P = manifest.pools;
export const POOLS = {
  A: { pool: getAddress(P.A.pool), token: getAddress(P.A.token), math: getAddress(P.A.math), label: 'Pool A — control (BlackScholesSol)' },
  B: { pool: getAddress(P.B.pool), token: getAddress(P.B.token), math: getAddress(P.B.math), label: 'Pool B — Equinox (Stylus, cached)' },
} as const;
export const POOL_KEYS: PoolKey[] = ['A', 'B'];
export const VOL = getAddress(P.vol);
export const USDG = getAddress(P.usdg);
export const SEQ = getAddress(P.sequencerFeed);
export const FEED = getAddress(P.feed);
export const DEPLOYER = getAddress(P.deployer);
export const DEPLOYED_AT_BLOCK = BigInt(P.deployedAtBlock);
export const MATH_SOL = getAddress(manifest.blackScholesSol);
export const MATH_STYLUS = getAddress(manifest.blackScholesStylus);

export interface Board { id: number; expiry: number; strikes: number[]; seriesIds: { A: bigint[]; B: bigint[] } }
export const BOARDS: Board[] = P.boards.map((b) => ({
  id: b.id, expiry: b.expiry, strikes: b.strikes.map(Number),
  seriesIds: { A: b.seriesIds.A.map(BigInt), B: b.seriesIds.B.map(BigInt) },
}));

export interface SeriesRef { boardId: number; expiry: number; strike: number; isCall: boolean; idx: number; id: { A: bigint; B: bigint } }
/** Urutan seri per board: [C K0, P K0, C K1, P K1, C K2, P K2] (EquinoxPool.createBoard). */
export const ALL_SERIES: SeriesRef[] = BOARDS.flatMap((b) =>
  b.strikes.flatMap((strike, i) => [true, false].map((isCall, c) => {
    const idx = 2 * i + c;
    return { boardId: b.id, expiry: b.expiry, strike, isCall, idx, id: { A: b.seriesIds.A[idx]!, B: b.seriesIds.B[idx]! } };
  })),
);

/** keccak256(abi.encode(pool, expiry, strike, isCall)) — sama dengan EquinoxOptionToken.seriesId. */
export function seriesId(pool: `0x${string}`, expiry: number, strikeWad: bigint, isCall: boolean): bigint {
  return BigInt(keccak256(encodeAbiParameters(parseAbiParameters('address, uint64, uint128, bool'), [pool, BigInt(expiry), strikeWad, isCall])));
}
export const WAD = 10n ** 18n;
export const explorerAddress = (a: string) => `${EXPLORER}/address/${a}`;
export const explorerTx = (h: string) => `${EXPLORER}/tx/${h}`;
export const COMMIT = __COMMIT__;
export const BUILD_TIME = __BUILD_TIME__;
```

- [ ] **Step 4: `web/src/chain/client.ts`, `web/src/ui/{dom,format,poll}.ts`, `web/src/panels/types.ts`**

`client.ts`:
```ts
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
```

`ui/dom.ts` — salin verbatim dari `../vigil/web/src/ui/dom.ts` (`el`, `svgEl`, `setText`, `mount`).

`ui/poll.ts` — salin verbatim dari `../vigil/web/src/ui/poll.ts` (`BASE_MS` 15 000, `STALE_MS` 60 000, `pollBaseMs`, `nextDelayMs`, `isStale`, `startPolling`).

`ui/format.ts`:
```ts
export const usdg = (x: bigint, digits = 2) => (Number(x) / 1e6).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const usdg6 = (x: bigint) => (Number(x) / 1e6).toFixed(6);
export const wad = (x: bigint, digits = 4) => (Number(x) / 1e18).toFixed(digits);
export const pct = (x: bigint, digits = 2) => `${(Number(x) / 1e16).toFixed(digits)} %`;
export const feedUsd = (a: bigint) => (Number(a) / 1e8).toFixed(2);
export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const shortHash = (h: string) => `${h.slice(0, 10)}…`;
export function fmtAge(seconds: number): string {
  const s = Math.max(0, seconds);
  if (s < 90) return `${Math.round(s)} s ago`;
  if (s < 5400) return `${(s / 60).toFixed(1)} min ago`;
  if (s < 48 * 3600) return `${(s / 3600).toFixed(1)} h ago`;
  return `${(s / 86400).toFixed(1)} d ago`;
}
export function fmtCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}
export const utc = (ts: number) => new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
/** Selisih relatif |a−b|/max(a,b) sebagai string, mis. "2.4e-5". */
export function relDiff(a: bigint, b: bigint): string {
  const hi = a > b ? a : b; if (hi === 0n) return '0';
  const d = a > b ? a - b : b - a;
  return (Number(d) / Number(hi)).toExponential(1);
}
```

`panels/types.ts`:
```ts
import type { Snapshot } from '../chain/snapshot';
export interface Meta { nowMs: number; lastOkMs: number | null; error: string | null }
export interface Panel { root: HTMLElement; render(s: Snapshot | null, meta: Meta): void }
```
(`Snapshot` dibuat di Task 2; untuk Task 1 buat `web/src/chain/snapshot.ts` minimal: `export interface Snapshot { fetchedAtMs: number; blockNumber: bigint; blockTime: number }` dan `export async function readSnapshot(client: Client): Promise<Snapshot>` yang membaca `getBlock()` — Task 2 menggantinya.)

- [ ] **Step 5: `header.ts`, `footer.ts`, `styles.css`, `main.ts`**

`panels/header.ts`:
```ts
import { el, setText } from '../ui/dom';
import { CHAIN_ID, POOLS, explorerAddress } from '../deployment';
import { isStale } from '../ui/poll';
import type { Panel } from './types';

export function createHeader(): Panel {
  const status = el('span', { class: 'badge badge-wait' }, el('i', { class: 'lamp' }), el('span', { class: 'badge-text', text: 'connecting' }));
  const statusText = status.querySelector('.badge-text')!;
  const block = el('span', { class: 'mono muted', text: '' });
  const root = el('header', { class: 'site-header' },
    el('div', { class: 'brand' },
      el('div', {},
        el('h1', { text: 'Equinox' }),
        el('p', { class: 'tagline', text: 'On-chain ETH options priced by Black-Scholes in Arbitrum Stylus — volatility from Chainlink prints, no IV oracle' }),
      ),
    ),
    el('div', { class: 'header-right' },
      el('span', { class: 'badge', text: `Arbitrum Sepolia · ${CHAIN_ID}` }),
      status, block,
      el('a', { class: 'link', href: 'https://github.com/nodesproof/equinox', target: '_blank', rel: 'noopener', text: 'GitHub ↗' }),
      el('a', { class: 'link', href: explorerAddress(POOLS.B.pool), target: '_blank', rel: 'noopener', text: 'Pool B on Arbiscan ↗' }),
    ),
  );
  return {
    root,
    render(s, meta) {
      const stale = meta.lastOkMs === null || isStale(meta.lastOkMs, meta.nowMs);
      const state = s === null ? 'wait' : stale ? 'stale' : 'live';
      setText(statusText, s === null ? 'connecting' : stale ? 'stale' : 'live');
      status.className = `badge badge-${state}`;
      setText(block, s ? `block ${s.blockNumber}` : '');
    },
  };
}
```

`panels/footer.ts`:
```ts
import { el } from '../ui/dom';
import { BUILD_TIME, COMMIT, FEED, MATH_SOL, MATH_STYLUS, POOLS, SEQ, USDG, VOL, explorerAddress } from '../deployment';
import type { Panel } from './types';

const row = (label: string, addr: string) => el('li', {}, el('span', { class: 'muted', text: `${label} ` }), el('a', { class: 'mono', href: explorerAddress(addr), target: '_blank', rel: 'noopener', text: addr }));

export function createFooter(): Panel {
  const root = el('footer', { class: 'site-footer' },
    el('h2', { text: 'Contracts' }),
    el('ul', { class: 'addr-list' },
      row('Pool A (control, BlackScholesSol)', POOLS.A.pool), row('Pool B (Equinox, Stylus)', POOLS.B.pool),
      row('Shared vol engine (EWMA from Chainlink)', VOL), row('Math A — BlackScholesSol', MATH_SOL), row('Math B — Stylus program (cached)', MATH_STYLUS),
      row('Chainlink ETH/USD (real)', FEED), row('MockUSDG (6 dp, open mint = faucet)', USDG), row('MockSequencerFeed (no L2 uptime feed on Sepolia)', SEQ),
    ),
    el('p', { class: 'muted small' },
      'Mocked on purpose: USDG and the sequencer uptime feed have no Sepolia equivalents; the price feed is the real Chainlink ETH/USD. ',
      'Both pools share one volatility engine (σ_base / σ_mark(0) identical by construction); pool quotes may differ through the inventory term of σ_mark once trade histories diverge — the live identity claim is math parity (both math contracts return byte-identical prices for identical inputs). ',
      'Stylus gas numbers are with the program cached. Treasury = deployer wallet on this testnet deployment. ',
      el('a', { href: 'https://github.com/nodesproof/equinox/blob/main/docs/BENCHMARK.md', target: '_blank', rel: 'noopener', text: 'Benchmark' }), ' · ',
      el('a', { href: 'https://github.com/nodesproof/equinox/blob/main/docs/DEMO_LOG.md', target: '_blank', rel: 'noopener', text: 'Demo log' }), ' · ',
      el('a', { href: 'https://github.com/nodesproof/equinox/blob/main/prd-arsitektur.md', target: '_blank', rel: 'noopener', text: 'PRD' }),
    ),
    el('p', { class: 'muted small mono', text: `build ${COMMIT} · ${BUILD_TIME}` }),
  );
  return { root, render() {} };
}
```

`styles.css` (ringkas, gelap, satu kolom, tabel lebar):
```css
:root{--bg:#0b1220;--panel:#111a2b;--line:#22304a;--fg:#e6edf7;--muted:#8fa0bb;--gold:#f2c94c;--ok:#4cd28a;--warn:#f0a35c;--bad:#f06a6a;--mono:'Martian Mono',ui-monospace,monospace;--sans:'Instrument Sans',system-ui,sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--sans);line-height:1.45}
#app{max-width:1280px;margin:0 auto;padding:16px}
.mono{font-family:var(--mono);font-size:.85em}.muted{color:var(--muted)}.small{font-size:.85em}.hidden{display:none}
.site-header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:8px 0 16px;border-bottom:1px solid var(--line)}
h1{margin:0;font-size:28px;color:var(--gold)}h2{font-size:16px;margin:0 0 8px;color:var(--gold)}.tagline{margin:4px 0 0;color:var(--muted);max-width:720px}
.header-right{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.link{color:var(--fg);text-decoration:none;border:1px solid var(--line);padding:4px 8px;border-radius:6px}
.badge{border:1px solid var(--line);border-radius:999px;padding:3px 10px;font-size:.85em;display:inline-flex;gap:6px;align-items:center}.lamp{width:8px;height:8px;border-radius:50%;background:var(--muted);display:inline-block}
.badge-live .lamp{background:var(--ok)}.badge-stale .lamp{background:var(--warn)}.badge-wait .lamp{background:var(--muted)}
.banner{background:#3a2a12;border:1px solid var(--warn);padding:8px 12px;border-radius:8px;margin:12px 0}
section{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;margin:16px 0}
table{width:100%;border-collapse:collapse;font-size:.9em}th,td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}th:first-child,td:first-child,th.l,td.l{text-align:left}
tr.atm td{background:#172238}.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:900px){.grid2{grid-template-columns:1fr}}
.kv{display:grid;grid-template-columns:auto 1fr;gap:4px 12px}.kv dt{color:var(--muted)}.kv dd{margin:0;font-family:var(--mono)}
form.trade{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}label{display:flex;flex-direction:column;gap:4px;font-size:.9em;color:var(--muted)}
input,select,button{font:inherit;padding:8px;border-radius:8px;border:1px solid var(--line);background:#0e1628;color:var(--fg)}button{cursor:pointer;background:#1b2a48}button.primary{background:var(--gold);color:#111;font-weight:600}button:disabled{opacity:.5;cursor:default}
.txlog{font-family:var(--mono);font-size:.8em;max-height:180px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:8px;margin-top:8px}.txlog a{color:var(--gold)}
.site-footer{padding:16px 0 32px;color:var(--muted)}.addr-list{list-style:none;padding:0;margin:0 0 12px;display:grid;gap:4px}.addr-list a{color:var(--fg);text-decoration:none;word-break:break-all}
svg.chart{width:100%;height:160px;background:#0e1628;border-radius:8px}
```

`main.ts` (Task 1: header + footer saja; Task 2–4 menambah panel):
```ts
import './styles.css';
import { client } from './chain/client';
import { readSnapshot, type Snapshot } from './chain/snapshot';
import { el, mount } from './ui/dom';
import { startPolling } from './ui/poll';
import { createHeader } from './panels/header';
import { createFooter } from './panels/footer';
import type { Meta, Panel } from './panels/types';

const app = document.querySelector<HTMLDivElement>('#app')!;
const banner = el('div', { class: 'banner hidden', role: 'status' });
const panels: Panel[] = [createHeader(), createFooter()];
mount(app, banner, ...panels.map((p) => p.root));

let snapshot: Snapshot | null = null;
const meta: Meta = { nowMs: Date.now(), lastOkMs: null, error: null };
function paint() {
  meta.nowMs = Date.now();
  for (const p of panels) p.render(snapshot, meta);
  const show = meta.error !== null && snapshot !== null;
  banner.classList.toggle('hidden', !show);
  if (show) banner.textContent = `RPC unreachable — showing data fetched ${new Date(meta.lastOkMs ?? 0).toISOString().slice(11, 19)} UTC`;
}
startPolling(async () => { snapshot = await readSnapshot(client); meta.lastOkMs = Date.now(); meta.error = null; paint(); },
  (e) => { meta.error = e instanceof Error ? e.message : String(e); paint(); });
setInterval(paint, 1000);
```

- [ ] **Step 6: Test unit — `deployment.test.ts`, `abi.test.ts`, `format.test.ts`, `seriesId.test.ts`**

```ts
// test/deployment.test.ts
import { describe, expect, it } from 'vitest';
import { ALL_SERIES, BOARDS, CHAIN_ID, POOLS, VOL } from '../src/deployment';
describe('deployment manifest', () => {
  it('is Arbitrum Sepolia with two boards of six series each', () => {
    expect(CHAIN_ID).toBe(421614);
    expect(BOARDS).toHaveLength(2);
    for (const b of BOARDS) { expect(b.strikes).toHaveLength(3); expect(b.seriesIds.A).toHaveLength(6); expect(b.seriesIds.B).toHaveLength(6); expect((b.expiry - 115_200) % 604_800).toBe(0); }
    expect(ALL_SERIES).toHaveLength(12);
    expect(ALL_SERIES[0]).toMatchObject({ boardId: 0, strike: 2400, isCall: true, idx: 0 });
    expect(ALL_SERIES[1]).toMatchObject({ strike: 2400, isCall: false, idx: 1 });
    expect(POOLS.A.pool).not.toBe(POOLS.B.pool);
    expect(VOL).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});
```
```ts
// test/seriesId.test.ts — id di JSON == keccak256(abi.encode(pool, expiry, strike, isCall)) untuk semua 24 seri
import { describe, expect, it } from 'vitest';
import { ALL_SERIES, POOLS, WAD, seriesId } from '../src/deployment';
describe('series ids', () => {
  it('match the on-chain derivation for every series of both pools', () => {
    for (const s of ALL_SERIES) {
      expect(seriesId(POOLS.A.pool, s.expiry, BigInt(s.strike) * WAD, s.isCall)).toBe(s.id.A);
      expect(seriesId(POOLS.B.pool, s.expiry, BigInt(s.strike) * WAD, s.isCall)).toBe(s.id.B);
    }
  });
});
```
```ts
// test/abi.test.ts
import { describe, expect, it } from 'vitest';
import { equinoxPoolAbi } from '../src/abi/equinoxPool';
import { equinoxVolEngineAbi } from '../src/abi/equinoxVolEngine';
import { equinoxOptionTokenAbi } from '../src/abi/equinoxOptionToken';
import { mockUsdgAbi } from '../src/abi/mockUsdg';
import { blackScholesAbi } from '../src/abi/blackScholes';
import { aggregatorV3Abi } from '../src/abi/aggregatorV3';
const names = (abi: readonly { type: string; name?: string }[], t = 'function') => abi.filter((i) => i.type === t).map((i) => i.name!);
describe('generated ABIs', () => {
  it('pool exposes what the dashboard reads and writes', () => {
    expect(names(equinoxPoolAbi)).toEqual(expect.arrayContaining(['quoteBuy', 'quoteClose', 'buy', 'close', 'claim', 'deposit', 'redeem', 'previewDeposit', 'previewRedeem', 'totalAssets', 'totalSupply', 'balanceOf', 'reserved', 'escrowedPayouts', 'netVega', 'freeLiquidity', 'sigmaMarkNow', 'capitalRefPrev', 'tradingPaused', 'board', 'series', 'openSeriesIds', 'spot', 'owner']));
    expect(names(equinoxPoolAbi, 'event')).toEqual(expect.arrayContaining(['Bought', 'Closed', 'Settled', 'Claimed']));
    expect(names(equinoxPoolAbi, 'error')).toEqual(expect.arrayContaining(['OracleStale', 'UtilizationExceeded', 'VegaCapExceeded', 'SlippageExceeded', 'SeriesExpired']));
  });
  it('engine, token, usdg, math, feed', () => {
    expect(names(equinoxVolEngineAbi)).toEqual(expect.arrayContaining(['sigmaBase', 'sigmaMark', 'params', 'varWad', 'poke']));
    expect(names(equinoxVolEngineAbi, 'event')).toContain('Observed');
    expect(names(equinoxOptionTokenAbi)).toEqual(expect.arrayContaining(['balanceOf', 'seriesId']));
    expect(names(mockUsdgAbi)).toEqual(expect.arrayContaining(['mint', 'approve', 'allowance', 'balanceOf']));
    expect(names(blackScholesAbi)).toEqual(expect.arrayContaining(['cappedCall', 'quote']));
    expect(names(aggregatorV3Abi)).toContain('latestRoundData');
  });
});
```
```ts
// test/format.test.ts
import { describe, expect, it } from 'vitest';
import { fmtCountdown, relDiff, usdg, usdg6, wad } from '../src/ui/format';
describe('format', () => {
  it('usdg / wad', () => { expect(usdg6(268_181_826n)).toBe('268.181826'); expect(usdg(1_000_000_000_000n, 0)).toBe('1,000,000'); expect(wad(632_500_000_000_000_000n)).toBe('0.6325'); });
  it('relDiff', () => { expect(relDiff(25_141_500n, 25_140_896n)).toBe('2.4e-5'); expect(relDiff(5n, 5n)).toBe('0'); });
  it('countdown', () => { expect(fmtCountdown(90_061)).toBe('1d 1h 1m'); expect(fmtCountdown(59)).toBe('0m 59s'); });
});
```
Run: `cd web && npm run typecheck && npm test && npm run build`
Expected: typecheck bersih; 4 file test, semua pass; `dist/` berisi `index.html` + `assets/`.

- [ ] **Step 7: `.gitignore`, CI, `web/README.md`, commit**

`.gitignore`: tambah baris `web/dist/`.
`.github/workflows/ci.yml` — tambah job:
```yaml
  web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: web/package-lock.json }
      - run: npm ci
        working-directory: web
      - run: npm run typecheck && npm test && npm run build
        working-directory: web
```
dan di job `foundry`, setelah langkah test, langkah drift ABI:
```yaml
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - name: ABI web harus identik dengan artefak Foundry
        run: cd web && node scripts/gen-abi.mjs && git diff --exit-code -- src/abi
```
`web/README.md` (Inggris, singkat): apa halaman ini, `npm ci && npm run dev`, `?rpc=` dan `?poll=`, `npm run test:network`, cara build, Pages.

```bash
git add .gitignore .github/workflows/ci.yml web/package.json web/package-lock.json web/vite.config.ts web/tsconfig.json web/index.html web/scripts/gen-abi.mjs web/src web/test web/README.md
git commit -m "web: Vite + viem scaffold, generated ABIs, deployment adapter, header/footer, unit tests, CI job"
```

---

### Task 2: Snapshot (multicall), paritas K5, estimasi gas, panel papan seri + NAV

**Files:**
- Create: `web/src/chain/snapshot.ts` (ganti stub), `web/src/chain/parity.ts`, `web/src/chain/gas.ts`, `web/src/panels/board.ts`, `web/src/panels/nav.ts`, `web/test/parity.network.test.ts`, `web/test/snapshot.test.ts`
- Modify: `web/src/main.ts`

**Interfaces:**
- Produces: `readSnapshot(client, account?) → Snapshot` (lihat tipe di bawah), `readParity(client, snap) → ParityRow[]`, `readGas(client, snap) → GasEstimate | null`. Dipakai panel dan Task 3–4.

- [ ] **Step 1: `snapshot.ts`**

```ts
import type { Address } from 'viem';
import type { Client } from './client';
import { ALL_SERIES, BOARDS, FEED, POOLS, POOL_KEYS, USDG, VOL, WAD, type PoolKey, type SeriesRef } from '../deployment';
import { equinoxPoolAbi } from '../abi/equinoxPool';
import { equinoxVolEngineAbi } from '../abi/equinoxVolEngine';
import { equinoxOptionTokenAbi } from '../abi/equinoxOptionToken';
import { mockUsdgAbi } from '../abi/mockUsdg';
import { aggregatorV3Abi } from '../abi/aggregatorV3';

export interface Quote { premium: bigint; fee: bigint; sigma: bigint; delta: bigint; vega: bigint; spot: bigint }
export interface PoolState {
  totalAssets: bigint; totalSupply: bigint; reserved: bigint; escrow: bigint; netVega: bigint; freeLiquidity: bigint;
  sigmaMarkNow: bigint; capitalRefPrev: bigint; tradingPaused: boolean; cash: bigint; owner: Address;
  boards: { settled: boolean; settlementPrice: bigint }[];
}
export interface SeriesState { oi: bigint; settled: boolean; payoutPerUnit: bigint; buy: Quote | null; buyError: string | null; close: bigint | null }
export interface SeriesRow { ref: SeriesRef; A: SeriesState; B: SeriesState }
export interface UserState { address: Address; usdg: bigint; allowance: Record<PoolKey, bigint>; shares: Record<PoolKey, bigint>; positions: Record<PoolKey, bigint[]> }
export interface Snapshot {
  fetchedAtMs: number; blockNumber: bigint; blockTime: number;
  feed: { answer: bigint; updatedAt: number; spotWad: bigint };
  vol: { sigmaBase: bigint; sigmaMark0: bigint; varWad: bigint; vrp: bigint; alpha: bigint; spread: bigint };
  pools: Record<PoolKey, PoolState>;
  series: SeriesRow[];
  user: UserState | null;
}

const ONE = WAD;
type MC = { status: 'success'; result: unknown } | { status: 'failure'; error: Error };
const ok = <T,>(r: MC | undefined): T | null => (r && r.status === 'success' ? (r.result as T) : null);
const must = <T,>(r: MC | undefined, what: string): T => { const v = ok<T>(r); if (v === null) throw new Error(`multicall: ${what} failed`); return v; };
const errName = (r: MC | undefined): string | null => (r && r.status === 'failure' ? (r.error as { shortMessage?: string }).shortMessage ?? r.error.message : null);

export async function readSnapshot(client: Client, account?: Address): Promise<Snapshot> {
  const block = await client.getBlock();
  const bn = block.number;
  const pool = (k: PoolKey) => ({ address: POOLS[k].pool, abi: equinoxPoolAbi } as const);
  const vol = { address: VOL, abi: equinoxVolEngineAbi } as const;
  // --- inti: feed, engine, dua pool, board ---
  const core = await client.multicall({ blockNumber: bn, allowFailure: true, contracts: [
    { address: FEED, abi: aggregatorV3Abi, functionName: 'latestRoundData' },
    { ...vol, functionName: 'sigmaBase' }, { ...vol, functionName: 'sigmaMark', args: [0n] }, { ...vol, functionName: 'varWad' }, { ...vol, functionName: 'params' },
    ...POOL_KEYS.flatMap((k) => [
      { ...pool(k), functionName: 'totalAssets' }, { ...pool(k), functionName: 'totalSupply' }, { ...pool(k), functionName: 'reserved' },
      { ...pool(k), functionName: 'escrowedPayouts' }, { ...pool(k), functionName: 'netVega' }, { ...pool(k), functionName: 'freeLiquidity' },
      { ...pool(k), functionName: 'sigmaMarkNow' }, { ...pool(k), functionName: 'capitalRefPrev' }, { ...pool(k), functionName: 'tradingPaused' },
      { address: USDG, abi: mockUsdgAbi, functionName: 'balanceOf', args: [POOLS[k].pool] }, { ...pool(k), functionName: 'owner' },
      ...BOARDS.map((b) => ({ ...pool(k), functionName: 'board', args: [BigInt(b.id)] })),
    ]),
  ] }) as MC[];
  const per = 11 + BOARDS.length;
  const rd = must<readonly [bigint, bigint, bigint, bigint, bigint]>(core[0], 'latestRoundData');
  const params = must<readonly [bigint, bigint, bigint, bigint, bigint, bigint]>(core[4], 'params');
  const pools = {} as Record<PoolKey, PoolState>;
  POOL_KEYS.forEach((k, i) => {
    const o = 5 + i * per;
    pools[k] = {
      totalAssets: must(core[o], 'totalAssets'), totalSupply: must(core[o + 1], 'totalSupply'), reserved: must(core[o + 2], 'reserved'),
      escrow: must(core[o + 3], 'escrowedPayouts'), netVega: must(core[o + 4], 'netVega'), freeLiquidity: must(core[o + 5], 'freeLiquidity'),
      sigmaMarkNow: ok<bigint>(core[o + 6]) ?? 0n, capitalRefPrev: must(core[o + 7], 'capitalRefPrev'), tradingPaused: must(core[o + 8], 'tradingPaused'),
      cash: must(core[o + 9], 'cash'), owner: must(core[o + 10], 'owner'),
      boards: BOARDS.map((_, j) => { const b = must<readonly [bigint, boolean, bigint, readonly bigint[]]>(core[o + 11 + j], 'board'); return { settled: b[1], settlementPrice: b[2] }; }),
    };
  });
  // --- seri: series(id), quoteBuy(id, 1), quoteClose(id, 1) per pool ---
  const sc = await client.multicall({ blockNumber: bn, allowFailure: true, contracts: ALL_SERIES.flatMap((s) => POOL_KEYS.flatMap((k) => [
    { ...pool(k), functionName: 'series', args: [s.id[k]] },
    { ...pool(k), functionName: 'quoteBuy', args: [s.id[k], ONE] },
    { ...pool(k), functionName: 'quoteClose', args: [s.id[k], ONE] },
  ])) }) as MC[];
  const series: SeriesRow[] = ALL_SERIES.map((ref, i) => {
    const st = (k: PoolKey, j: number): SeriesState => {
      const o = (i * 2 + j) * 3;
      const sr = must<readonly [number, bigint, bigint, boolean, boolean, bigint, bigint, bigint]>(sc[o], 'series');
      const q = ok<{ premiumAssets: bigint; feeAssets: bigint; sigma: bigint; delta: bigint; vegaTotal: bigint; spotWad: bigint }>(sc[o + 1]);
      const c = ok<readonly [bigint, bigint, bigint]>(sc[o + 2]);
      return { oi: sr[5], settled: sr[4], payoutPerUnit: sr[7],
        buy: q ? { premium: q.premiumAssets, fee: q.feeAssets, sigma: q.sigma, delta: q.delta, vega: q.vegaTotal, spot: q.spotWad } : null,
        buyError: q ? null : errName(sc[o + 1]), close: c ? c[0] : null };
    };
    return { ref, A: st('A', 0), B: st('B', 1) };
  });
  // --- pengguna (opsional) ---
  let user: UserState | null = null;
  if (account) {
    const uc = await client.multicall({ blockNumber: bn, allowFailure: true, contracts: [
      { address: USDG, abi: mockUsdgAbi, functionName: 'balanceOf', args: [account] },
      ...POOL_KEYS.flatMap((k) => [
        { address: USDG, abi: mockUsdgAbi, functionName: 'allowance', args: [account, POOLS[k].pool] },
        { ...pool(k), functionName: 'balanceOf', args: [account] },
        ...ALL_SERIES.map((s) => ({ address: POOLS[k].token, abi: equinoxOptionTokenAbi, functionName: 'balanceOf', args: [account, s.id[k]] })),
      ]),
    ] }) as MC[];
    const n = 2 + ALL_SERIES.length;
    user = { address: account, usdg: ok<bigint>(uc[0]) ?? 0n, allowance: { A: 0n, B: 0n }, shares: { A: 0n, B: 0n }, positions: { A: [], B: [] } };
    POOL_KEYS.forEach((k, i) => { const o = 1 + i * n; user!.allowance[k] = ok<bigint>(uc[o]) ?? 0n; user!.shares[k] = ok<bigint>(uc[o + 1]) ?? 0n; user!.positions[k] = ALL_SERIES.map((_, j) => ok<bigint>(uc[o + 2 + j]) ?? 0n); });
  }
  return {
    fetchedAtMs: Date.now(), blockNumber: bn, blockTime: Number(block.timestamp),
    feed: { answer: rd[1], updatedAt: Number(rd[3]), spotWad: rd[1] * 10n ** 10n },
    vol: { sigmaBase: must(core[1], 'sigmaBase'), sigmaMark0: must(core[2], 'sigmaMark0'), varWad: must(core[3], 'varWad'), vrp: params[1], alpha: params[2], spread: params[3] },
    pools, series, user,
  };
}

/** Seri ATM terdekat pada board terbuka terdekat — untuk counter gas dan sorotan baris. */
export function atmSeries(s: Snapshot): SeriesRow | null {
  const open = s.series.filter((r) => !r.A.settled && r.ref.expiry > s.blockTime + 60 && r.ref.isCall);
  if (open.length === 0) return null;
  const spot = Number(s.feed.spotWad) / 1e18;
  const nearestExpiry = Math.min(...open.map((r) => r.ref.expiry));
  return open.filter((r) => r.ref.expiry === nearestExpiry).sort((a, b) => Math.abs(a.ref.strike - spot) - Math.abs(b.ref.strike - spot))[0] ?? null;
}
```
Catatan `params`: `EquinoxVolEngine.params()` getter struct → tuple `(lambdaPerDay, vrp, alpha, spread, sigmaMin, sigmaMax)`; `quoteBuy` mengembalikan struct `QuoteOut` → viem men-decode sebagai objek berfield; `series` → tuple 8; `board` → tuple 4 (`seriesIds` array).

- [ ] **Step 2: `parity.ts` dan `gas.ts`**

```ts
// parity.ts — K5: kedua kontrak math dengan input identik harus byte-identik.
import type { Client } from './client';
import { ALL_SERIES, MATH_SOL, MATH_STYLUS, WAD, type SeriesRef } from '../deployment';
import { blackScholesAbi } from '../abi/blackScholes';
import type { Snapshot } from './snapshot';

export interface ParityRow { ref: SeriesRef; ok: boolean | null; priceSol: bigint | null; priceStylus: bigint | null }
export const yearsWad = (expiry: number, blockTime: number) => (BigInt(expiry - blockTime) * WAD) / 31_536_000n;

export async function readParity(client: Client, s: Snapshot): Promise<ParityRow[]> {
  const live = ALL_SERIES.filter((r) => r.expiry > s.blockTime + 60);
  const S = s.feed.spotWad, sigma0 = s.vol.sigmaMark0;
  const call = (math: `0x${string}`, r: SeriesRef) => {
    const K = BigInt(r.strike) * WAD, t = yearsWad(r.expiry, s.blockTime);
    return r.isCall
      ? { address: math, abi: blackScholesAbi, functionName: 'cappedCall', args: [S, K, 2n * K, t, sigma0, 0n] } as const
      : { address: math, abi: blackScholesAbi, functionName: 'quote', args: [S, K, t, sigma0, 0n, false] } as const;
  };
  const res = await client.multicall({ blockNumber: s.blockNumber, allowFailure: true, contracts: live.flatMap((r) => [call(MATH_SOL, r), call(MATH_STYLUS, r)]) });
  const priceOf = (x: (typeof res)[number]) => (x.status === 'success' ? (x.result as readonly bigint[])[0]! : null);
  const rows = new Map(live.map((r, i) => {
    const a = res[2 * i]!, b = res[2 * i + 1]!;
    const same = a.status === 'success' && b.status === 'success' && JSON.stringify(a.result, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) === JSON.stringify(b.result, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
    return [r.id.A, { ref: r, ok: a.status === 'success' && b.status === 'success' ? same : null, priceSol: priceOf(a), priceStylus: priceOf(b) }];
  }));
  return ALL_SERIES.map((r) => rows.get(r.id.A) ?? { ref: r, ok: null, priceSol: null, priceStylus: null });
}
```
```ts
// gas.ts — estimasi gas `buy(id, 1, max)` dari wallet owner (punya USDG + allowance) untuk seri ATM, A vs B.
import type { Client } from './client';
import { POOLS, POOL_KEYS, type PoolKey } from '../deployment';
import { equinoxPoolAbi } from '../abi/equinoxPool';
import { atmSeries, type Snapshot } from './snapshot';
const MAX = 2n ** 256n - 1n;
export interface GasEstimate { strike: number; expiry: number; gas: Record<PoolKey, bigint | null> }
export async function readGas(client: Client, s: Snapshot): Promise<GasEstimate | null> {
  const row = atmSeries(s); if (!row) return null;
  const gas = { A: null as bigint | null, B: null as bigint | null };
  await Promise.all(POOL_KEYS.map(async (k) => {
    try { gas[k] = await client.estimateContractGas({ address: POOLS[k].pool, abi: equinoxPoolAbi, functionName: 'buy', args: [row.ref.id[k], 10n ** 18n, MAX], account: s.pools[k].owner }); }
    catch { gas[k] = null; }
  }));
  return { strike: row.ref.strike, expiry: row.ref.expiry, gas };
}
```

- [ ] **Step 3: Panel `board.ts` dan `nav.ts`**

`board.ts` (tabel 12 baris; kolom: Board · K · C/P · Buy A | Buy B (USDG/unit) · Δ · Close A | Close B · Parity · OI A | OI B · σ_buy A|B):
```ts
import { el, setText } from '../ui/dom';
import { relDiff, usdg6, wad, utc } from '../ui/format';
import type { Panel } from './types';
import type { ParityRow } from '../chain/parity';
import type { GasEstimate } from '../chain/gas';
import { atmSeries, type Snapshot } from '../chain/snapshot';

export interface BoardPanel extends Panel { setParity(rows: ParityRow[]): void; setGas(g: GasEstimate | null): void }

export function createBoard(): BoardPanel {
  const tbody = el('tbody');
  const gasLine = el('p', { class: 'muted small', text: 'gas: —' });
  const note = el('p', { class: 'muted small' },
    'Quotes are per 1.0 unit at each pool\'s own inventory (σ_mark(util)); Δ is inventory, not math. ',
    'Parity ✓ = both math contracts (Solidity control vs Stylus) return byte-identical prices for identical inputs (S, K, t, σ_mark(0)) at this block — K5. ',
    'Gas = eth_estimateGas of buy(1 unit) from the seed-LP wallet; σ is computed by the shared engine, so the A/B difference is the two pricing calls (Stylus program cached).');
  const root = el('section', {}, el('h2', { text: 'Series board — Pool A (control) vs Pool B (Stylus)' }),
    el('table', {}, el('thead', {}, el('tr', {}, ...['Board', 'K', 'C/P', 'Buy A', 'Buy B', 'Δ', 'Close A', 'Close B', 'Parity', 'OI A', 'OI B', 'σ_buy A | B'].map((h, i) => el('th', { class: i < 3 ? 'l' : '', text: h })))), tbody), gasLine, note);
  let parity: ParityRow[] = []; let gas: GasEstimate | null = null; let last: Snapshot | null = null;
  const paint = () => {
    const s = last; if (!s) return;
    const atm = atmSeries(s);
    tbody.replaceChildren(...s.series.map((r) => {
      const p = parity.find((x) => x.ref.id.A === r.ref.id.A);
      const bA = r.A.buy, bB = r.B.buy;
      const status = r.A.settled ? `settled @ ${usdg6(r.A.payoutPerUnit / 10n ** 12n)}/unit` : r.ref.expiry <= s.blockTime + 60 ? 'blackout/expired' : r.A.buyError ?? '';
      const cell = (t: string, cls = '') => el('td', { class: cls, text: t });
      return el('tr', { class: atm && atm.ref.id.A === r.ref.id.A ? 'atm' : '' },
        cell(`#${r.ref.boardId} ${utc(r.ref.expiry)}`, 'l'), cell(String(r.ref.strike), 'l mono'), cell(r.ref.isCall ? 'C' : 'P', 'l'),
        cell(bA ? usdg6(bA.premium) : status, 'mono'), cell(bB ? usdg6(bB.premium) : (bB === null && bA ? '—' : ''), 'mono'),
        cell(bA && bB ? (bA.premium === bB.premium ? '=' : relDiff(bA.premium, bB.premium)) : '', bA && bB && bA.premium === bB.premium ? 'ok' : 'muted'),
        cell(r.A.close !== null ? usdg6(r.A.close) : '—', 'mono'), cell(r.B.close !== null ? usdg6(r.B.close) : '—', 'mono'),
        cell(p ? (p.ok === null ? '—' : p.ok ? '✓' : '✗') : '…', p && p.ok === false ? 'bad' : p && p.ok ? 'ok' : 'muted'),
        cell(wad(r.A.oi, 2), 'mono'), cell(wad(r.B.oi, 2), 'mono'),
        cell(bA && bB ? `${wad(bA.sigma)} | ${wad(bB.sigma)}` : '', 'mono'));
    }));
    setText(gasLine, gas ? `gas buy(1 C ${gas.strike}, ${utc(gas.expiry)}): A ${gas.gas.A ?? '—'} · B ${gas.gas.B ?? '—'}${gas.gas.A && gas.gas.B ? ` · ratio ${(Number(gas.gas.A) / Number(gas.gas.B)).toFixed(2)}×` : ''}` : 'gas: —');
  };
  return { root, render(s) { last = s; paint(); }, setParity(rows) { parity = rows; paint(); }, setGas(g) { gas = g; paint(); } };
}
```

`nav.ts` (dua kartu A|B: NAV, NAV/share, kas, escrow, reserved, liability = kas − escrow − NAV, util = netVega / (5 % × capForCaps), netVega, freeLiquidity, σ_mark(util), paused; plus header engine: σ_base, σ_mark(0), spot & umur round, countdown board):
```ts
import { el } from '../ui/dom';
import { feedUsd, fmtAge, fmtCountdown, pct, usdg, wad } from '../ui/format';
import { BOARDS, POOLS, POOL_KEYS, type PoolKey } from '../deployment';
import type { Panel } from './types';
import type { Snapshot } from '../chain/snapshot';

export function createNav(): Panel {
  const engine = el('dl', { class: 'kv' });
  const cards = { A: el('dl', { class: 'kv' }), B: el('dl', { class: 'kv' }) } as Record<PoolKey, HTMLDListElement>;
  const root = el('section', {}, el('h2', { text: 'Volatility engine (shared) & NAV' }), engine,
    el('div', { class: 'grid2' }, ...POOL_KEYS.map((k) => el('div', {}, el('h2', { text: POOLS[k].label }), cards[k]))));
  const kv = (dl: HTMLDListElement, rows: [string, string][]) => dl.replaceChildren(...rows.flatMap(([a, b]) => [el('dt', { text: a }), el('dd', { text: b })]));
  return { root, render(s, meta) {
    if (!s) return;
    const now = Math.floor(meta.nowMs / 1000);
    kv(engine, [
      ['Chainlink ETH/USD', `${feedUsd(s.feed.answer)} USD · ${fmtAge(now - s.feed.updatedAt)}`],
      ['σ_base (EWMA realized vol)', wad(s.vol.sigmaBase)], ['σ_mark(0) = σ_base × VRP', `${wad(s.vol.sigmaMark0)} (VRP ${wad(s.vol.vrp, 2)}, α ${wad(s.vol.alpha, 2)}, spread ${pct(s.vol.spread)})`],
      ...BOARDS.map((b): [string, string] => [`Board #${b.id} expiry`, `${new Date(b.expiry * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC · ${b.expiry > now ? `in ${fmtCountdown(b.expiry - now)}` : s.pools.A.boards[b.id]?.settled ? `settled @ ${wad(s.pools.A.boards[b.id]!.settlementPrice, 2)} (A) / ${wad(s.pools.B.boards[b.id]!.settlementPrice, 2)} (B)` : 'expired — awaiting settle'}`]),
    ]);
    for (const k of POOL_KEYS) {
      const p = s.pools[k];
      const cap = p.cash - p.escrow < p.capitalRefPrev ? p.cash - p.escrow : p.capitalRefPrev;
      const vegaCap = cap * 500n / 10_000n;
      const util = vegaCap === 0n ? 0n : (p.netVega * 10n ** 18n) / vegaCap;
      const liability = p.cash - p.escrow - p.totalAssets * 10n ** 12n;
      kv(cards[k], [
        ['NAV (totalAssets)', `${usdg(p.totalAssets)} USDG`], ['NAV / share', p.totalSupply === 0n ? '—' : (Number(p.totalAssets) / Number(p.totalSupply) ).toFixed(6)],
        ['cash − escrow − MtM liability', `${usdg(p.cash / 10n ** 12n)} − ${usdg(p.escrow / 10n ** 12n)} − ${usdg(liability / 10n ** 12n)}`],
        ['reserved (Σ OI × K)', `${usdg(p.reserved / 10n ** 12n)} USDG`], ['free liquidity', `${usdg(p.freeLiquidity)} USDG`],
        ['net vega / util', `${wad(p.netVega, 1)} / ${pct(util > 10n ** 18n ? 10n ** 18n : util)} of cap ${wad(vegaCap, 0)}`], ['σ_mark(util)', wad(p.sigmaMarkNow)],
        ['capital reference (lagged)', `${usdg(p.capitalRefPrev / 10n ** 12n)} USDG`], ['trading paused', p.tradingPaused ? 'yes' : 'no'],
      ]);
    }
  } };
}
```
Rumus di panel = kontrak: `vegaCap = capForCaps × vegaCapBps/1e4` (500 bps, §6.8) dan `util = netVega/vegaCap` (`EquinoxPool._util`), `capForCaps = min(cash − escrow, capitalRefPrev)`.

- [ ] **Step 4: `main.ts` — wiring panel + paritas + gas**

Ganti daftar panel: `[header, nav, board, footer]`; setelah `readSnapshot` sukses: `board.setParity(await readParity(client, snapshot))` dan `board.setGas(await readGas(client, snapshot))` (keduanya dalam `try/catch` sendiri agar kegagalan estimasi tidak menggagalkan refresh).

- [ ] **Step 5: Test jaringan (bukti headless) dan test unit**

`test/parity.network.test.ts` (dijalankan oleh `npm run test:network` / `npm run snapshot`):
```ts
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
```
`test/snapshot.test.ts` (unit tanpa jaringan): `atmSeries` memilih C terdekat spot pada expiry terdekat yang belum blackout — bangun `Snapshot` sintetis dari `ALL_SERIES` dengan `blockTime` dan `spotWad` tertentu; assert strike terpilih (spot 2.650 → 2.600 pada board 0; `blockTime = expiry0 − 30` → board 1 dipilih, 2.600).

Run: `cd web && npm run typecheck && npm test && npm run test:network && npm run build`
Expected: unit hijau; network: 12 seri, semua paritas `true`, gas A/B terisi (angka ≈ 330–390k), log JSON tercetak.

- [ ] **Step 6: Commit**

```bash
git add web/src web/test web/package.json
git commit -m "web: snapshot via multicall, K5 math parity, gas estimates, series board and NAV panels"
```

---

### Task 3: Aktivitas (event) + grafik σ_base + poll/banner

**Files:**
- Create: `web/src/chain/events.ts`, `web/src/panels/activity.ts`, `web/src/ui/svg.ts`, `web/test/events.test.ts`
- Modify: `web/src/main.ts`

**Interfaces:**
- Produces: `readEvents(client, fromBlock, toBlock) → { trades: TradeEvent[]; observed: ObservedEvent[] }` (dipakai panel; di-refresh tiap 4 poll = 60 s).

- [ ] **Step 1: `events.ts`**

```ts
import { parseAbiItem, type Address } from 'viem';
import type { Client } from './client';
import { ALL_SERIES, DEPLOYED_AT_BLOCK, POOLS, POOL_KEYS, VOL, type PoolKey } from '../deployment';

export interface TradeEvent { pool: PoolKey; kind: 'Bought' | 'Closed' | 'Settled' | 'Claimed'; block: bigint; tx: `0x${string}`; who: Address | null; label: string; amount: string }
export interface ObservedEvent { block: bigint; roundId: bigint; priceWad: bigint; sigmaBase: bigint }
const EV = {
  Bought: parseAbiItem('event Bought(uint256 indexed seriesId, address indexed trader, uint256 size, uint256 premiumAssets, uint256 feeAssets, uint256 sigmaBuy, uint256 spotWad)'),
  Closed: parseAbiItem('event Closed(uint256 indexed seriesId, address indexed trader, uint256 size, uint256 proceedsAssets, uint256 sigmaClose, uint256 spotWad)'),
  Settled: parseAbiItem('event Settled(uint256 indexed boardId, uint256 settlementPriceWad, uint256 escrowedAddedWad, uint256 reservedReleasedWad)'),
  Claimed: parseAbiItem('event Claimed(uint256 indexed seriesId, address indexed holder, uint256 amount, uint256 payoutAssets)'),
  Observed: parseAbiItem('event Observed(uint80 indexed roundId, uint256 priceWad, uint256 dtSeconds, uint256 varWad, uint256 sigmaBase)'),
};
const CHUNK = 50_000n;
const seriesLabel = (k: PoolKey, id: bigint) => { const s = ALL_SERIES.find((x) => x.id[k] === id); return s ? `${s.isCall ? 'C' : 'P'} ${s.strike} #${s.boardId}` : `series ${id.toString().slice(0, 8)}…`; };
const u = (x: bigint) => (Number(x) / 1e6).toFixed(2);
const w = (x: bigint) => (Number(x) / 1e18).toFixed(2);

async function chunked<T>(from: bigint, to: bigint, fn: (a: bigint, b: bigint) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let a = from; a <= to; a += CHUNK) { const b = a + CHUNK - 1n < to ? a + CHUNK - 1n : to; out.push(...(await fn(a, b))); }
  return out;
}

export async function readEvents(client: Client, toBlock: bigint, fromBlock: bigint = DEPLOYED_AT_BLOCK) {
  const trades: TradeEvent[] = [];
  for (const k of POOL_KEYS) {
    const logs = await chunked(fromBlock, toBlock, (a, b) => client.getLogs({ address: POOLS[k].pool, events: [EV.Bought, EV.Closed, EV.Settled, EV.Claimed], fromBlock: a, toBlock: b }));
    for (const l of logs) {
      const args = l.args as Record<string, bigint | Address>;
      const e = l.eventName as TradeEvent['kind'];
      const row: TradeEvent = { pool: k, kind: e, block: l.blockNumber, tx: l.transactionHash, who: (args.trader ?? args.holder ?? null) as Address | null, label: '', amount: '' };
      if (e === 'Bought') { row.label = seriesLabel(k, args.seriesId as bigint); row.amount = `${w(args.size as bigint)} units · ${u(args.premiumAssets as bigint)} USDG @ σ ${w(args.sigmaBuy as bigint)}`; }
      else if (e === 'Closed') { row.label = seriesLabel(k, args.seriesId as bigint); row.amount = `${w(args.size as bigint)} units · ${u(args.proceedsAssets as bigint)} USDG @ σ ${w(args.sigmaClose as bigint)}`; }
      else if (e === 'Settled') { row.label = `board #${args.boardId}`; row.amount = `S_T ${w(args.settlementPriceWad as bigint)} · escrow +${w(args.escrowedAddedWad as bigint)} · reserved −${w(args.reservedReleasedWad as bigint)}`; }
      else { row.label = seriesLabel(k, args.seriesId as bigint); row.amount = `${w(args.amount as bigint)} units · payout ${u(args.payoutAssets as bigint)} USDG`; }
      trades.push(row);
    }
  }
  const obs = await chunked(fromBlock, toBlock, (a, b) => client.getLogs({ address: VOL, event: EV.Observed, fromBlock: a, toBlock: b }));
  const observed: ObservedEvent[] = obs.map((l) => ({ block: l.blockNumber, roundId: l.args.roundId!, priceWad: l.args.priceWad!, sigmaBase: l.args.sigmaBase! }));
  trades.sort((a, b) => (a.block === b.block ? 0 : a.block > b.block ? -1 : 1));
  return { trades, observed };
}
```

- [ ] **Step 2: `ui/svg.ts` + `panels/activity.ts`**

`svg.ts`: `polyline(points: [number, number][], w, h, pad)` → SVG `<svg class="chart" viewBox="0 0 w h">` dengan polyline σ_base (sumbu x = urutan observasi, y = σ, label min/max). `activity.ts`: dua kolom — kiri tabel 30 event terakhir (pool, jenis, seri, jumlah, blok, link Arbiscan); kanan grafik σ_base dari `Observed` (≤ 400 titik terakhir) + teks "N observations since deploy; last σ_base …". Panel mengekspor `setEvents({trades, observed})`.

- [ ] **Step 3: `main.ts`**: setiap 4 refresh (atau saat pertama) `activity.setEvents(await readEvents(client, snapshot.blockNumber))` dalam `try/catch`; simpan `lastEventsBlock` dan baca inkremental (`fromBlock = lastEventsBlock + 1`) lalu gabungkan.

- [ ] **Step 4: `test/events.test.ts`**: `chunked` membagi rentang dengan benar (mock fn menghitung panggilan untuk 120.001 blok → 3 chunk); label seri untuk id dari JSON (`seriesLabel` diekspor untuk test).

Run: `cd web && npm run typecheck && npm test && npm run build`; lalu `npm run dev` dan buka `http://localhost:5173/equinox/` di browser (verifikasi manual oleh pengendali dengan Chrome: panel aktivitas menampilkan ≥ 7 trade dari 20 Sep dan grafik σ dengan puluhan titik).

- [ ] **Step 5: Commit** — `git add web/src web/test && git commit -m "web: activity feed from pool events and sigma_base chart from Observed"`

---

### Task 4: Wallet + panel Trade (faucet, approve, deposit/redeem, buy/close, claim) + smoke test headless

**Files:**
- Create: `web/src/chain/wallet.ts`, `web/src/chain/trade.ts`, `web/src/panels/trade.ts`, `web/test/trade.test.ts`, `web/test/smoke.network.test.ts`
- Modify: `web/src/main.ts` (akun → `readSnapshot(client, account)`; panel trade)

**Interfaces:**
- `trade.ts` (murni, tanpa DOM): `MAX_UINT`, `slippage = 100n` bps, `buyCall(k, id, size, quote)`, `closeCall(k, id, size, proceeds)`, `claimCall(k, id, amount)`, `depositCall(k, assets, receiver)`, `redeemCall(k, shares, receiver)`, `approveCall(k)`, `faucetCall(receiver, amount = 100_000e6)` → objek `{ address, abi, functionName, args }` siap untuk `simulateContract`/`writeContract`/`estimateContractGas`. `wallet.ts`: `connect() → Address`, `ensureChain()`, `write(call, account) → hash` (simulate → write → wait), `decodeRevert(e) → string` (nama error dari ABI, mis. `UtilizationExceeded` → pesan manusiawi).

- [ ] **Step 1: `trade.ts`**

```ts
import { POOLS, USDG, type PoolKey } from '../deployment';
import { equinoxPoolAbi } from '../abi/equinoxPool';
import { mockUsdgAbi } from '../abi/mockUsdg';
export const MAX_UINT = 2n ** 256n - 1n;
export const SLIPPAGE_BPS = 100n;
export const FAUCET_AMOUNT = 100_000n * 10n ** 6n;
export const maxPremium = (premium: bigint, fee: bigint) => ((premium + fee) * (10_000n + SLIPPAGE_BPS)) / 10_000n;
export const minProceeds = (proceeds: bigint) => (proceeds * (10_000n - SLIPPAGE_BPS)) / 10_000n;
const pool = (k: PoolKey) => ({ address: POOLS[k].pool, abi: equinoxPoolAbi } as const);
export const buyCall = (k: PoolKey, id: bigint, size: bigint, premium: bigint, fee: bigint) => ({ ...pool(k), functionName: 'buy', args: [id, size, maxPremium(premium, fee)] } as const);
export const closeCall = (k: PoolKey, id: bigint, size: bigint, proceeds: bigint) => ({ ...pool(k), functionName: 'close', args: [id, size, minProceeds(proceeds)] } as const);
export const claimCall = (k: PoolKey, id: bigint, amount: bigint) => ({ ...pool(k), functionName: 'claim', args: [id, amount] } as const);
export const depositCall = (k: PoolKey, assets: bigint, receiver: `0x${string}`) => ({ ...pool(k), functionName: 'deposit', args: [assets, receiver] } as const);
export const redeemCall = (k: PoolKey, shares: bigint, owner: `0x${string}`) => ({ ...pool(k), functionName: 'redeem', args: [shares, owner, owner] } as const);
export const approveCall = (k: PoolKey) => ({ address: USDG, abi: mockUsdgAbi, functionName: 'approve', args: [POOLS[k].pool, MAX_UINT] } as const);
export const faucetCall = (to: `0x${string}`, amount = FAUCET_AMOUNT) => ({ address: USDG, abi: mockUsdgAbi, functionName: 'mint', args: [to, amount] } as const);
/** Pesan manusiawi untuk error kontrak yang mungkin dilihat trader. */
export const REVERT_TEXT: Record<string, string> = {
  OracleStale: 'Spot is stale (Chainlink round older than 3 h or sequencer grace) — quotes are refused until a fresh round.',
  UtilizationExceeded: 'Reserve cap reached (80 % of the lagged capital reference) — new LP capital counts after 1–2 days.',
  VegaCapExceeded: 'Vega cap reached (5 % of the capital reference).', SlippageExceeded: 'Price moved beyond 1 % slippage — refresh and retry.',
  SeriesExpired: 'Series is in the 60-second blackout or expired — wait for settlement, then claim.', SeriesSettled: 'Series is settled — use claim.',
  SizeTooSmall: 'Minimum size is 0.01 units.', TradingIsPaused: 'Trading is paused by the owner (close/claim/withdraw still work).',
  MathUnavailable: 'Math program unavailable — deposits are refused until it is back (withdrawals still work).', NotSettled: 'Board not settled yet.',
  ERC20InsufficientBalance: 'Not enough USDG — use the faucet.', ERC20InsufficientAllowance: 'Approve USDG for this pool first.',
};
```

- [ ] **Step 2: `wallet.ts`**

```ts
import { BaseError, ContractFunctionRevertedError, createWalletClient, custom, type Address } from 'viem';
import { chain, client } from './client';
import { REVERT_TEXT } from './trade';

export function hasWallet(): boolean { return typeof window !== 'undefined' && !!window.ethereum; }
export function walletClient() { if (!window.ethereum) throw new Error('No injected wallet (MetaMask) found'); return createWalletClient({ chain, transport: custom(window.ethereum as never) }); }
export async function connect(): Promise<Address> { const [a] = await walletClient().requestAddresses(); if (!a) throw new Error('No account'); await ensureChain(); return a; }
export async function ensureChain(): Promise<void> {
  const w = walletClient(); const id = await w.getChainId(); if (id === chain.id) return;
  try { await w.switchChain({ id: chain.id }); } catch { await w.addChain({ chain }); await w.switchChain({ id: chain.id }); }
}
export function decodeRevert(e: unknown): string {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const name = r?.data?.errorName; if (name) return REVERT_TEXT[name] ?? `Reverted: ${name}`;
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}
/** simulate → write → tunggu receipt; mengembalikan hash; melempar pesan yang sudah didekode. */
export async function write(call: { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] }, account: Address): Promise<`0x${string}`> {
  await ensureChain();
  const { request } = await client.simulateContract({ ...(call as never), account });
  const hash = await walletClient().writeContract(request);
  const rc = await client.waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error(`Transaction ${hash} failed (status 0)`);
  return hash;
}
```

- [ ] **Step 3: Panel `trade.ts`**

Isi: tombol **Connect wallet** (menampilkan alamat, saldo USDG, share A/B, posisi terbuka A/B dari `snapshot.user`); pilih pool (radio A/B, default B); tombol **Faucet 100,000 USDG**; **Approve USDG** (tampil hanya bila allowance < 1e12); form **Deposit** (USDG) / **Redeem** (share, tombol "max") dengan preview (`previewDeposit`/`previewRedeem` lewat `client.readContract`); form **Buy** (select seri terbuka: label `C 2800 #0 (25 Sep)`, input ukuran unit, preview premi+fee dari `quoteBuy(id, size)` live, tombol Buy dengan `maxPremium` 1 %); **Close** (select seri dengan posisi > 0, ukuran ≤ posisi, preview `quoteClose`); **Claim** (seri settled dengan posisi > 0, jumlah = posisi). Setiap aksi: disable tombol → `write(...)` → baris log `✓ buy 0.5 C 2800 on B — tx 0x… ↗` atau `✗ <pesan decodeRevert>` → panggil `onChange()` agar `main.ts` me-refresh snapshot dengan akun. Tanpa wallet: panel menampilkan penjelasan + tautan faucet Sepolia ETH (`https://faucet.quicknode.com/arbitrum/sepolia`) dan tetap read-only.

- [ ] **Step 4: `main.ts`**: simpan `account: Address | null`; `readSnapshot(client, account ?? undefined)`; `trade.onConnected = (a) => { account = a; refreshNow(); }`; `trade.onChange = refreshNow` (memicu poll segera).

- [ ] **Step 5: `test/trade.test.ts`** — builder: `maxPremium(268_181_826n, 8_045_455n) === 278_989_553n` ((268 181 826 + 8 045 455) × 1,01 = 278 989 553,81 → floor); `minProceeds(100_000_000n) === 99_000_000n`; `buyCall('B', 1n, 10n**18n, 5n, 1n).functionName === 'buy'` dan `args[2] === 6n*101n/100n`; `faucetCall(addr).args[1] === 100_000_000_000n`; `REVERT_TEXT` memuat 12 kunci.

- [ ] **Step 6: `test/smoke.network.test.ts` — bukti headless jalur tulis (transaksi nyata kecil di Pool B, board 1)**

Test vitest bergerbang env (`describe.skipIf(process.env.EQUINOX_SMOKE !== '1')`), memakai `createWalletClient({ account: privateKeyToAccount(process.env.SEPOLIA_PRIVATE_KEY as `0x${string}`), chain, transport: http(RPC_URL) })` dari `viem`/`viem/accounts` dan builder dari `src/chain/trade.ts` (satu-satunya sumber calldata UI). Urutan: `faucetCall(me, 100e6)` → `approveCall('B')` bila allowance < 1e12 → `depositCall('B', 10e6, me)` (catat share yang diterima) → `buyCall('B', id C K_mid board 1, 0.01e18, quote.premium, quote.fee)` dengan quote dari `readContract quoteBuy` → `closeCall('B', id, 0.01e18, quoteClose)` → `redeemCall('B', shares, me)`. Setiap langkah: `client.simulateContract` → `wallet.writeContract` → `client.waitForTransactionReceipt` → `expect(rc.status).toBe('success')`, cetak hash. Di akhir: `token.balanceOf(me, id) == 0` dan share == nilai sebelum deposit. Kunci hanya di env proses; jangan pernah dicetak. Jalankan sekali dari `web/`: `set -a; source ../.env; set +a; npm run smoke`.
Expected: 5–6 hash tx dengan `status success`; posisi 0,01 dibuka & ditutup di Pool B board 1 (2 Okt); share hasil deposit di-redeem.

- [ ] **Step 7: Verifikasi UI di browser** (pengendali dengan Chrome: `npm run dev` → buka halaman; tanpa wallet: semua panel terisi; dengan MetaMask milik pengguna (opsional, direkam untuk video): faucet → approve → buy 0,1 C → close).

- [ ] **Step 8: Commit** — `git add web/src web/test web/package.json && git commit -m "web: wallet connect and trade panel (faucet, deposit/redeem, buy/close/claim) with simulate-before-write and decoded reverts; headless smoke test"`

---

### Task 5: GitHub Pages — workflow, aktivasi Pages, README web

**Files:**
- Create: `.github/workflows/pages.yml`
- Modify: `README.md` (baris status + link dashboard), `web/README.md`

- [ ] **Step 1: `.github/workflows/pages.yml`**

```yaml
name: pages
on:
  push:
    branches: [main]
    paths: ['web/**', 'deployments/**', '.github/workflows/pages.yml']
  workflow_dispatch:
permissions: { contents: read, pages: write, id-token: write }
concurrency: { group: pages, cancel-in-progress: true }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: web/package-lock.json }
      - run: npm ci
        working-directory: web
      - run: npm run typecheck && npm test && npm run build
        working-directory: web
      - uses: actions/upload-pages-artifact@v3
        with: { path: web/dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: ${{ steps.deployment.outputs.page_url }} }
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Aktifkan Pages (sumber = GitHub Actions) dengan token nodesproof**

```bash
GH_TOKEN=$(sed -n 's#https://nodesproof:\([^@]*\)@github.com#\1#p' ~/.git-credentials) gh api -X POST repos/nodesproof/equinox/pages -f build_type=workflow 2>&1 | tail -1 || \
GH_TOKEN=$(sed -n 's#https://nodesproof:\([^@]*\)@github.com#\1#p' ~/.git-credentials) gh api -X PUT repos/nodesproof/equinox/pages -f build_type=workflow
GH_TOKEN=$(sed -n 's#https://nodesproof:\([^@]*\)@github.com#\1#p' ~/.git-credentials) gh api repos/nodesproof/equinox/pages --jq '{build_type, html_url, status}'
```
Expected: `build_type: workflow`, `html_url: https://nodesproof.github.io/equinox/`. (Deploy pertama terjadi saat workflow berjalan di `main` setelah merge — atau `gh workflow run pages.yml` setelah merge.)

- [ ] **Step 3: README** — baris status "Dashboard + wallet trading" → `✅ https://nodesproof.github.io/equinox/ (live after merge; read-only without a wallet; trade with MetaMask on Arbitrum Sepolia)`; seksi "Live on Arbitrum Sepolia" dapat paragraf "Dashboard" (apa yang ditampilkan, K5, faucet, `?rpc=`/`?poll=`). `web/README.md` lengkap.

- [ ] **Step 4: Commit** — `git add .github/workflows/pages.yml README.md web/README.md && git commit -m "pages: GitHub Pages workflow for the dashboard; README links"`

---

### Task 6: Paket submission (agen `submission-packager`)

**Files:**
- Create: `docs/SUBMISSION.md`, `docs/VIDEO_SCRIPT.md`, `docs/JUDGE_QA.md`, `docs/RUBRIC_SCORECARD.md`, `docs/DEMO_RUNBOOK.md`

**Interfaces:**
- Consumes: `README.md`, `prd-arsitektur.md`, `docs/BENCHMARK.md`, `docs/DEMO_LOG.md`, `docs/OPS_SEPOLIA.md`, `docs/VERIFICATION.md`, spec Plan 3, `../docs/HACKATHON_BRIEF.md`, `../docs/RUBRIC_SCORECARD.md` (contoh format Vigil), URL dashboard, PR/alamat.

- [ ] **Step 1: Dispatch agen `submission-packager`** (pengendali) dengan brief: proyek Equinox (bukan Vigil — entri kedua), deadline 1 Okt 23:59 SGT, surface juri (entri HackQuest → dashboard live → repo → explorer + video), klaim yang boleh (tanpa oracle IV; solvabilitas keras; paritas math K5; benchmark jujur 2,6–2,9× lingkaran vs ~1× transaksi; tx out-of-gas didokumentasikan), yang TIDAK boleh (kuotasi pool identik tanpa syarat; 10×; "sequencer feed asli"), field form ≤ 300 karakter (dihitung), video 3 menit sesuai spec §5, ≥ 20 Q&A dari PRD §11/§16/§19 + temuan audit, scorecard terhadap Rubrik A/B, runbook per surface + rehearsal.
- [ ] **Step 2: Review pengendali** (fakta vs dokumen sumber; karakter ≤ 300; tautan valid) → perbaikan → commit `docs: submission package (form, video script, judge Q&A, rubric scorecard, demo runbook)`.

---

### Task 7: PRD v1.4 + README final

**Files:**
- Modify: `prd-arsitektur.md`, `README.md`

- [ ] **Step 1: PRD v1.4** — header `**Versi:** 1.4 — <tanggal> (v1.3 + Plan 3: dua pool live di Sepolia dengan feed Chainlink asli & engine σ bersama (K4), klaim paritas math (K5), dashboard + trading wallet (§10.4), keeper bash/cast (§10.3), paket submission)`; §10.3 keeper = bash + GitHub Actions cron (bukan TypeScript), self-heal sequencer mock, `ksend`; §10.4 UI terbangun (stack, panel, K5, tautan); §13: tambahkan hasil settlement nyata 25 Sep (harga, tx) dan ringkasan `--claim`, tabel Sepolia + caveat (sudah ada) dirapikan, dan hapus duplikasi angka dengan BENCHMARK bila perlu (tunjuk ke BENCHMARK); §15 status hari 10–15 (tanggal nyata); §18 V6 = alamat/heartbeat/deviasi terverifikasi, V7 = tidak ada sequencer feed → mock, V8 ✅; §19 tambah D17 (engine bersama, K4) dan D18 (paritas math, K5) dengan biaya masing-masing; §11 T-baru: setter mock sequencer terbuka (artefak testnet; self-heal).
- [ ] **Step 2: README** — bagian atas: badge/link dashboard, "Try it in 60 seconds" (buka dashboard; tanpa wallet lihat; dengan MetaMask: faucet → approve → buy), tautan paket submission.
- [ ] **Step 3: Verifikasi** `drift-ok` + `forge test` + `cd web && npm test && npm run build`; commit `docs: PRD v1.4 (Plan 3 as built: shared engine, math parity, dashboard, keeper), README final`.

---

## Self-review (penulis rencana)

**Spec coverage (§4–§5, K5):** §4.1 stack/struktur → Task 1; §4.2 read path (multicall, gas dari owner, event) → Task 2–3; §4.3 panel 1–6 → Task 2 (header/nav/board), 3 (aktivitas/grafik), 4 (trade), 1 (footer); §4.4 wallet → Task 4; §4.5 test → Task 1–4 (+ network parity); §4.6 kriteria terima → Task 5 (Pages) + Task 4 (alur trade); §5 paket → Task 6; PRD v1.4/README → Task 7; K5 → `parity.ts` + papan + catatan; kejujuran → footer/note/README.

**Placeholder scan:** tidak ada TBD/TODO; kode panel `activity.ts`/`svg.ts`/`trade.ts` (panel) dan `web/README.md` dideskripsikan per elemen tanpa kode penuh — eksekutor menulisnya mengikuti pola `board.ts`/`nav.ts` (rubrik: setiap elemen yang disebut harus ada).

**Type consistency:** `Snapshot.series[i].ref.id.{A,B}` dipakai board/parity/gas/trade; `Quote` field `premium, fee, sigma, delta, vega, spot`; `PoolState` field dipakai nav; `readParity`/`readGas` menerima `Snapshot`; builder `trade.ts` args sesuai ABI (`buy(uint256,uint256,uint256)`, `close(uint256,uint256,uint256)`, `claim(uint256,uint256)`, `deposit(uint256,address)`, `redeem(uint256,address,address)`, `approve(address,uint256)`, `mint(address,uint256)`).

**Dependensi:** 1 → 2 → 3 → 4 → 5 → 6 → 7 (6 dan 7 setelah dashboard live agar tautan nyata; 6 setelah settlement 25 Sep bila kalender mengizinkan).
