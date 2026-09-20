# Equinox Plan 5 — Frontend React `equinox-dashboard/` di atas data layer `web/src` (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menjadikan scaffold React Manus di `equinox-dashboard/` sebagai frontend Equinox yang **hidup**: enam halaman (Overview, Boards, Trade, Portfolio, Activity, Contracts) yang membaca Arbitrum Sepolia lewat data layer `web/src/chain` yang sudah ada (tiga pool A/B/C, aset per pool, paritas K5, gas, event, wallet trading), semua state brief §8.2, lulus checklist penerimaan brief §9, lalu menggantikan UI klasik di GitHub Pages.

**Architecture:** `equinox-dashboard/` = Vite 7 + React 19 + Tailwind 4 (+ CSS kustom `index.css` = sistem desain), router wouter hash, satu `ChainProvider` (context) yang memegang snapshot/meta/parity/gas/events/wallet/txLog dan memanggil `readSnapshot`/`readParity`/`readGas`/`readEvents`/`write` dari `@chain` (= `../web/src`, alias Vite + TS paths). Halaman hanya membaca context lewat selector; tidak ada logika chain di komponen. `web/` tetap = SDK + test data layer + UI klasik cadangan.

**Tech Stack:** Node 22, npm, Vite ^7, @vitejs/plugin-react ^5, React ^19.2, Tailwind ^4 (`@tailwindcss/vite`), wouter ^3 (`useHashLocation`), lucide-react, sonner, recharts ^2, viem ^2.21 (versi sama dengan `web/`), vitest ^2 + jsdom + @testing-library/react + @testing-library/jest-dom; Playwright hanya di scratchpad untuk drive stub-provider.

**Spec:** `docs/superpowers/specs/2026-09-20-equinox-plan5-react-frontend-design.md` (Q1–Q11) — dan `docs/FRONTEND_BRIEF.md` (kontrak data/perilaku/copy/penerimaan). Plan 4 (Pool C) harus sudah selesai: manifest berisi `pools.C`, `web/src/deployment.ts` mengekspor `POOL_KEYS`, `POOLS[k].asset/assetSymbol/faucet`, `GAS_KEYS`, `PAXOS_FAUCET`; `web/src/chain/snapshot.ts` `UserState.asset[k]`, `SeriesRow` ber-kunci `POOL_KEYS`.

## Global Constraints

- Root `/home/mdlog/Project-MDlabs/Hackquest/arbitrum-sg/Equinox`; branch **`feat/plan-5`** dari `feat/plan-4`. Perintah npm aplikasi dari `equinox-dashboard/`; data layer dari `web/` (jangan diubah kecuali disebut tugas; bila butuh ekspor baru, tambahkan di `web/src` dengan test di `web/test` dan catat).
- **Tidak ada logika chain baru di aplikasi**: semua pembacaan lewat `@chain/chain/{snapshot,parity,gas,events,trade,wallet,client}` dan `@chain/deployment`; format angka lewat `@chain/ui/format` (`usdg`, `usdg6`, `wad`, `pct`, `feedUsd`, `shortAddr`, `shortHash`, `fmtAge`, `fmtCountdown`, `utc`, `relDiff`); polling lewat `@chain/ui/poll` (`pollBaseMs`, `nextDelayMs`, `isStale`, `BASE_MS`, `STALE_MS`).
- **Perilaku brief §5 wajib**: satu snapshot per poll dipaku ke satu blok; poll 15 s (`?poll=` ≥ 2000), backoff 30/60 s, stale 60 s, data terakhir dipertahankan + banner; paritas/gas/events di try/catch sendiri; events seed → delta tiap refresh ke-4; preview debounce 250 ms + sequence guard; aksi wallet menangkap pool & akun saat klik, satu aksi sekaligus, cap dari `executedBuy`/`executedClose` + `scaleFee`, `TxFailed` → tautan; 4902/4001; `?rpc=` loopback saja (sudah di data layer).
- **Copy brief §7**: testnet selalu terlihat; "indicative" vs "executed"; K5 = paritas matematika, Δ = inventaris; gas = `eth_estimateGas` satu `buy`, ≈ 1×; Pool C settle di **Paxos USDG (testnet)**; A/B mock; tidak ada "mainnet"; UTC; tautan explorer untuk setiap alamat/hash; tidak ada angka palsu (skeleton/`—` + alasan).
- **Hard-code dilarang**: alamat, jumlah pool/board/seri, parameter engine (VRP/α/spread/σ_min/σ_max), cfg (vega cap 5 %, reserve cap 80 %, fee, minSize, bounty) — semua dari manifest/snapshot (`cfg()` dan `params()` dibaca di Task 2 bila belum ada di snapshot).
- **Statis murni**: tanpa server, tanpa skrip pihak ketiga/telemetri, tanpa `localStorage` untuk state chain (boleh untuk preferensi sidebar). `base: '/equinox/'`; aset via `import.meta.env.BASE_URL`.
- **Budget**: JS total ≤ 250 KB gzip (dicek `npm run build` + skrip `scripts/size.mjs` yang gagal bila lewat); first snapshot ≤ 3 s; tanpa layout shift saat refresh.
- **Aksesibilitas**: kontras AA, keyboard penuh, fokus terlihat, `aria-live="polite"` untuk badge live/stale dan log tx, tabel dengan `<th scope>`, `prefers-reduced-motion` dihormati, 375 px tanpa scroll horizontal halaman (tabel scroll di dalam panel).
- **Test**: vitest (jsdom) per task; `npm run check` (tsc) + `npm test` + `npm run build` hijau sebelum commit; `web/` tests tetap hijau (`cd web && npm test`). Playwright hanya di scratchpad (`/tmp/claude-1000/.../scratchpad`), tidak pernah ditambahkan ke `package.json`; stub provider menolak `eth_sendTransaction` dengan 4001 — tidak ada yang menandatangani.
- **Commit**: pesan polos TANPA trailer/atribusi AI; `git add` path eksplisit; jangan commit `node_modules`, `dist`, `client/public/events-seed.json`, `.manus-logs`. Bahasa: komentar Indonesia, identifier & UI Inggris.
- **Aturan cadangan (Q2)**: `pages.yml` men-deploy `web/` sampai Task 7 lulus; pengalihan hanya di Task 7.

---

### Task 1: Bersihkan scaffold, toolchain npm, alias `@chain`, router hash, CI job `app`

**Files:**
- Delete: `equinox-dashboard/server/`, `equinox-dashboard/template.json`, `equinox-dashboard/patches/`, `equinox-dashboard/pnpm-lock.yaml`, `equinox-dashboard/client/public/__manus__/`, `equinox-dashboard/client/src/const.ts`, `equinox-dashboard/shared/`, `equinox-dashboard/client/src/components/ManusDialog.tsx`, `equinox-dashboard/client/src/components/Map.tsx`, `equinox-dashboard/visual-verification.md` (isinya dipindah ke README §Riwayat), komponen `client/src/components/ui/*` yang tidak diimpor setelah Task 1 (audit: `grep -rl "components/ui/<name>" client/src` — pertahankan `button`, `badge`, `input`, `tooltip`, `sonner`, `select`, `tabs`, `dialog`/`sheet` bila dipakai nav mobile, `skeleton`, `table`, `separator`; hapus sisanya), hooks `useComposition`, `usePersistFn` bila tidak dipakai.
- Modify: `equinox-dashboard/package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `client/index.html`, `client/src/App.tsx`, `client/src/main.tsx`, `client/src/contexts/ThemeContext.tsx` (tanpa `next-themes`; tema gelap tetap), `.gitignore` (tambah `client/public/events-seed.json`, `.manus-logs/`), `.prettierrc` (tetap)
- Create: `equinox-dashboard/vitest.config.ts`, `equinox-dashboard/test/setup.ts`, `equinox-dashboard/scripts/size.mjs`, `equinox-dashboard/scripts/seed.sh`, `equinox-dashboard/README.md`, `equinox-dashboard/client/src/vite-env.d.ts`
- Modify (repo): `.github/workflows/ci.yml` (job `app`), `.gitignore` root (tidak perlu bila `.gitignore` lokal cukup — verifikasi `git status`)

**Interfaces:**
- Produces: alias `@` → `client/src`, `@chain` → `../web/src`, `@deployment` → `../deployments/arbitrum-sepolia.json`; `define` `__COMMIT__`/`__BUILD_TIME__`; route hash: `/`, `/boards`, `/trade`, `/portfolio`, `/activity`, `/contracts`; skrip npm `dev | build | preview | check | test | seed | size`.

- [ ] **Step 1: `package.json`** — ganti seluruh isi:

```json
{
  "name": "equinox-dashboard",
  "private": true,
  "version": "0.2.0",
  "type": "module",
  "scripts": {
    "dev": "vite --port 5174 --strictPort",
    "build": "vite build && node scripts/size.mjs",
    "preview": "vite preview --port 4174 --strictPort",
    "check": "tsc --noEmit",
    "test": "vitest run",
    "seed": "bash scripts/seed.sh",
    "size": "node scripts/size.mjs"
  },
  "dependencies": {
    "@radix-ui/react-dialog": "^1.1.15",
    "@radix-ui/react-select": "^2.2.6",
    "@radix-ui/react-slot": "^1.2.3",
    "@radix-ui/react-tabs": "^1.1.13",
    "@radix-ui/react-tooltip": "^1.2.8",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^0.453.0",
    "react": "^19.2.1",
    "react-dom": "^19.2.1",
    "recharts": "^2.15.2",
    "sonner": "^2.0.7",
    "tailwind-merge": "^3.3.1",
    "viem": "^2.21.0",
    "wouter": "^3.7.1"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.1.3",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@types/node": "^22.20.4",
    "@types/react": "^19.2.1",
    "@types/react-dom": "^19.2.1",
    "@vitejs/plugin-react": "^5.0.4",
    "jsdom": "^25.0.1",
    "prettier": "^3.6.2",
    "tailwindcss": "^4.1.14",
    "tw-animate-css": "^1.4.0",
    "typescript": "^5.6.3",
    "vite": "^7.1.7",
    "vitest": "^2.1.4"
  }
}
```
Lalu `rm -rf node_modules pnpm-lock.yaml && npm install` → `package-lock.json` di-commit. Tambahkan kembali paket radix lain HANYA bila komponen yang dipertahankan mengimpornya (cek `npm run check`).

- [ ] **Step 2: `vite.config.ts`** — ganti seluruh isi:

```ts
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { defineConfig } from 'vite';

// Data layer = ../web/src (alias @chain); manifest = ../deployments (alias @deployment) — satu sumber alamat, tanpa duplikasi logika chain.
const ROOT = path.resolve(import.meta.dirname);
const WEB = path.resolve(ROOT, '..', 'web', 'src');
const MANIFEST = path.resolve(ROOT, '..', 'deployments', 'arbitrum-sepolia.json');
function commit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'dev'; }
}
export default defineConfig({
  base: '/equinox/',
  root: path.resolve(ROOT, 'client'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(ROOT, 'client', 'src'), '@chain': WEB, '@deployment': MANIFEST },
    dedupe: ['viem', 'react', 'react-dom'],
  },
  define: { __COMMIT__: JSON.stringify(commit()), __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  server: { fs: { allow: [ROOT, WEB, path.dirname(MANIFEST)] } },
  build: { outDir: path.resolve(ROOT, 'dist'), emptyOutDir: true, target: 'es2022', sourcemap: false },
});
```

- [ ] **Step 3: `vitest.config.ts`, `test/setup.ts`, `tsconfig.json`, `client/src/vite-env.d.ts`**

```ts
// vitest.config.ts
import path from 'node:path';
import { defineConfig } from 'vitest/config';
const ROOT = path.resolve(import.meta.dirname);
export default defineConfig({
  resolve: { alias: { '@': path.resolve(ROOT, 'client', 'src'), '@chain': path.resolve(ROOT, '..', 'web', 'src'), '@deployment': path.resolve(ROOT, '..', 'deployments', 'arbitrum-sepolia.json') } },
  define: { __COMMIT__: '"test"', __BUILD_TIME__: '"1970-01-01T00:00:00.000Z"', 'import.meta.env.BASE_URL': '"/equinox/"' },
  test: { environment: 'jsdom', setupFiles: ['test/setup.ts'], include: ['test/**/*.test.tsx', 'test/**/*.test.ts'], css: false },
});
```
```ts
// test/setup.ts
import '@testing-library/jest-dom/vitest';
```
`tsconfig.json`: `compilerOptions` = `target ES2022, module ESNext, moduleResolution Bundler, jsx react-jsx, lib [ES2022, DOM, DOM.Iterable], strict, noUncheckedIndexedAccess, resolveJsonModule, isolatedModules, skipLibCheck, types ["vite/client", "@testing-library/jest-dom"], paths { "@/*": ["./client/src/*"], "@chain/*": ["../web/src/*"], "@deployment": ["../deployments/arbitrum-sepolia.json"] }`; `include: ["client/src", "test", "vite.config.ts", "vitest.config.ts", "../web/src"]`; `exclude: ["../web/src/main.ts", "../web/src/panels"]` (UI klasik tidak perlu ikut). `client/src/vite-env.d.ts` = salinan `web/src/vite-env.d.ts` (deklarasi `__COMMIT__`, `__BUILD_TIME__`, `Window.ethereum`).

- [ ] **Step 4: `client/index.html`** — hapus skrip analytics dan blok komentar template; `<title>Equinox — on-chain options, no IV oracle</title>`, meta description dari `web/index.html`, favicon SVG yang sama (cincin emas), font Instrument Sans + Martian Mono (preconnect + stylesheet), `<script type="module" src="/src/main.tsx">`.

- [ ] **Step 5: Router hash + App** — `client/src/App.tsx`:

```tsx
import { Router, Route, Switch } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import ErrorBoundary from '@/components/ErrorBoundary';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { Layout } from '@/components/Layout';
import Overview from '@/pages/Overview';
// Halaman lain ditambahkan Task 3–6; sampai itu ada, rute menampilkan placeholder "coming in Task N" TANPA angka.
export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster theme="dark" position="bottom-right" />
          <Router hook={useHashLocation}>
            <Layout>
              <Switch>
                <Route path="/" component={Overview} />
                <Route>Not found — <a href="#/">back to overview</a></Route>
              </Switch>
            </Layout>
          </Router>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
```
Untuk Task 1, `Layout` dan `Overview` = versi statis yang dipotong dari `Home.tsx` (shell sidebar/topbar/footer + Overview tanpa data; data hard-coded diganti `—` + label "awaiting snapshot" — nilai VRP/α/spread/vega cap/reserve cap yang hard-coded DIHAPUS). `Home.tsx` dihapus setelah dipecah menjadi `components/Layout.tsx`, `components/primitives.tsx` (AppMark, SectionHeading, EmptyValue, MetricCard, StatusPill, MiniSparkline), `pages/Overview.tsx`. Nav memakai `<Link href="/boards">` wouter, item aktif dari `useLocation()`.

- [ ] **Step 6: `scripts/size.mjs`, `scripts/seed.sh`, `.gitignore`**

```js
// scripts/size.mjs — gagal bila total JS gzip > 250 KB (brief §8.4)
import { gzipSync } from 'node:zlib'; import { readdirSync, readFileSync, statSync } from 'node:fs'; import path from 'node:path';
const dir = path.resolve(import.meta.dirname, '..', 'dist', 'assets'); let raw = 0, gz = 0;
for (const f of readdirSync(dir)) if (f.endsWith('.js')) { const b = readFileSync(path.join(dir, f)); raw += b.length; gz += gzipSync(b).length; }
console.log(`js: ${(raw / 1024).toFixed(0)} KB raw · ${(gz / 1024).toFixed(0)} KB gzip (budget 250 KB)`);
if (gz > 250 * 1024) { console.error('bundle over budget'); process.exit(1); }
```
```bash
#!/usr/bin/env bash
# seed.sh — bangkitkan seed event lewat skrip web (satu logika pindai) lalu salin ke client/public (git-ignored).
set -euo pipefail; cd "$(dirname "$0")/.."
(cd ../web && npm run seed) && cp ../web/public/events-seed.json client/public/events-seed.json && echo "seed disalin"
```
`.gitignore` tambah: `client/public/events-seed.json`, `.manus-logs/`.

- [ ] **Step 7: CI** — `.github/workflows/ci.yml` job `app`: checkout; setup-node 22 (cache npm, `cache-dependency-path: equinox-dashboard/package-lock.json`); `npm ci` di `web` (data layer deps); `npm ci` di `equinox-dashboard`; `npm run check && npm test && npm run build` di `equinox-dashboard`.

- [ ] **Step 8: Verifikasi & commit** — `npm run check && npm test` (boleh 0 test di Task 1 → tambahkan satu test `test/app.test.tsx` yang merender `<App />` dan menemukan teks "Arbitrum Sepolia"), `npm run build` (size.mjs mencetak ukuran; harus ≤ 250 KB — bila lewat, hapus dependensi/komponen lagi), `npm run preview` + `curl -s http://127.0.0.1:4174/equinox/ | grep -c 'id="root"'`; `git status` menunjukkan hanya file sumber (tanpa node_modules/dist/seed). Commit: `git add equinox-dashboard .github/workflows/ci.yml && git commit -m "app: adopt the React dashboard scaffold — strip the Manus runtime, npm, hash router, @chain alias, CI job"`. README aplikasi: tujuan, perintah, alias, aturan cadangan, riwayat (catatan visual-verification lama).

---

### Task 2: `ChainProvider` + hooks di atas data layer, fixture & test hooks

**Files:**
- Create: `client/src/chain/provider.tsx`, `client/src/chain/useSnapshot.ts`, `client/src/chain/useEvents.ts`, `client/src/chain/useWallet.ts`, `client/src/chain/useTrade.ts`, `client/src/chain/selectors.ts`, `client/src/chain/types.ts`, `test/fixtures/snapshot.ts`, `test/fixtures/events.ts`, `test/chain/provider.test.tsx`, `test/chain/useTrade.test.tsx`, `test/chain/selectors.test.ts`
- Modify (web, bila `cfg()`/`params()` lengkap belum ada di snapshot): `web/src/chain/snapshot.ts` (+`pools[k].cfg` dari `cfg()` → `{ feeBps, maxUtilBps, vegaCapBps, minPremiumBps, heartbeat, staleMult, sequencerGrace, maxOpenSeries, tenorMax, minSize, settleBounty }`, +`vol.lambdaPerDay, sigmaMin, sigmaMax, lastRoundId, lastTs` dari `params()`/`lastRoundId()`/`lastTs()`) + `web/test/snapshot.test.ts` assertion; angka-angka ini tidak boleh hard-coded di UI.

**Interfaces:**
```ts
// types.ts
export interface Meta { nowMs: number; lastOkMs: number | null; error: string | null; stale: boolean; refreshes: number }
export interface TxEntry { id: number; ok: boolean | null; what: string; tail: string; hash?: `0x${string}`; atMs: number }   // ok null = pending
export interface ChainState {
  snapshot: Snapshot | null; meta: Meta; parity: ParityRow[]; gas: GasEstimate | null; events: Events; eventsState: 'seed' | 'scanning' | 'live' | 'error';
  account: Address | null; wrongChain: boolean; hasWallet: boolean; busy: boolean; txLog: TxEntry[];
  refreshNow(): void; connect(): Promise<void>; run(what: string, build: (k: PoolKey, acct: Address) => Promise<TradeCall> | TradeCall, k: PoolKey): Promise<void>;
}
// provider.tsx: <ChainProvider client={client}> — client bisa di-inject (test); useChain() melempar bila di luar provider.
// selectors.ts: usePool(k), useSeriesRows(), useUser(), useAtm(), useBoards(), useEngine(); semua pure atas ChainState.
// useTrade.ts: previews { deposit(k, assets), redeem(k, shares), buy(k, id, size, acct?), close(k, id, size, acct?) } dengan debounce 250 ms + seq guard; aksi { faucet, approve, deposit, redeem, buy, close, claim } memakai builder @chain/chain/trade + executedBuy/executedClose/scaleFee/maxPremium/minProceeds; semua memanggil ChainState.run.
```

- [ ] **Step 1: `provider.tsx`** — port `web/src/main.ts` ke React: state `snapshot/meta/parity/gas/events` di `useReducer`; `useEffect` memulai `startPolling(refreshOnce, onError)` dari `@chain/ui/poll`; `refresh()` = `readSnapshot(client, account)` → set → `readParity`/`readGas` masing-masing try/catch → events pada `lastEventsBlock === null || refreshes % 4 === 0` (seed dulu via `loadSeed()` sekali saat mount; `eventsState`); `setInterval(1000)` untuk `nowMs`/`stale`; `running` promise bersama; `refreshNow()` seperti `main.ts`; `onWalletEvents` → `account`/`wrongChain`; `run()` = `busy` guard → `write(await build(k, acct), acct)` → `txLog` prepend (maks 50) → `refreshNow()`. Komentar Indonesia menjelaskan tiap aturan §5.
- [ ] **Step 2: `selectors.ts`** — `usePool(k)` mengembalikan `PoolState` + turunan `{ navPerShare, liability, capForCaps, vegaCap, util }` dengan rumus persis `web/src/panels/nav.ts` (brief §4.3/4.7); `useSeriesRows()` → baris dengan status `'open' | 'blackout' | 'expired' | 'settled'` per pool (predikat `web/src/panels/board.ts`); `useUser()`; `useAtm()` = `atmSeries`; `useEngine()` = `snapshot.vol` + feed + umur.
- [ ] **Step 3: `useTrade.ts`** — port `web/src/panels/trade.ts` (preview* + handler) tanpa DOM: fungsi murni + `useState`; tes memverifikasi bahwa `buy` memanggil `executedBuy` lalu `buyCall(k, id, size, premExec, scaleFee(...))` (mock `@chain/chain/wallet` dengan `vi.mock`), `close` memakai `minProceeds(executedClose)`, `approve` memakai `POOLS[k].asset`, `faucet` hanya untuk `faucet === 'mint'`, dan `run` menolak aksi kedua saat `busy`.
- [ ] **Step 4: Fixtures** — `test/fixtures/snapshot.ts` mengekspor `liveSnapshot()` (nilai Appendix C brief: feed 2579.49, σ_base 0.5483, σ_mark0 0.6306, NAV 1,000,102.51/1,000,103.16, Pool C NAV 100.xx bila `POOL_KEYS` memuat C, 12+ seri dengan quote per pool, satu seri `buyError: 'SeriesExpired'`, board 0 open) dan mutator `withStale()`, `withSettled(boardId, price)`, `withBlackout(seriesIdx)`, `withPaused(k)`, `withOracleStale()`, `withUser(positions…)`; `events.ts` = 8 trades + 7 observed. Fixture dibangun dari `POOL_KEYS`/`ALL_SERIES` nyata — tidak ada hard-code jumlah.
- [ ] **Step 5: Test provider** — `provider.test.tsx`: `vi.mock('@chain/chain/snapshot')` dll.; (a) refresh pertama mengisi snapshot & `meta.lastOkMs`; (b) kegagalan RPC setelah sukses → `meta.error` terisi, snapshot lama tetap, `stale` true setelah 60 s (fake timers); (c) events dibaca pada refresh 0 dan ke-4, tidak pada ke-1..3; (d) `readParity` gagal tidak menggagalkan snapshot. Jalankan `npm test`; commit `app: ChainProvider, hooks and selectors over the web data layer; fixtures`.

---

### Task 3: Layout hidup + Overview

**Files:** Create/Modify `client/src/components/Layout.tsx`, `client/src/components/{MetricCard,PoolCard,SigmaChart,ParityPanel,EventsPreview,Banner}.tsx`, `client/src/pages/Overview.tsx`, `test/pages/overview.test.tsx`, `test/components/layout.test.tsx`

- [ ] Layout: sidebar (nav 6 rute, tag Boards = `BOARDS.length` board / `ALL_SERIES.length` seri dari manifest), network card + status `connecting | live | stale` + `block N` (`aria-live`), tombol connect / alamat (shortAddr, tautan explorer) / "Switch to Arbitrum Sepolia" bila `wrongChain`, callout testnet ("USDG on A/B is a mock; Pool C settles in Paxos USDG — testnet, no real money"), topbar breadcrumb + `sync-status` (umur snapshot), testnet strip, banner RPC (`meta.error` → "RPC unreachable — showing data fetched HH:MM:SS UTC"), footer `build ${COMMIT} · ${BUILD_TIME}` + GitHub.
- [ ] Overview: metrik ETH/USD (+ umur `fmtAge`), σ_base, σ_mark(0) (+ VRP/α/spread dari `snapshot.vol`), next expiry (countdown dari `blockTime`), `SigmaChart` (recharts `AreaChart` dari `events.observed` — sumbu x urutan observasi, tooltip blok & σ; kosong → empty-state jujur), panel engine (`σ_mark(u)` rumus + params dari chain + `MIN_OBS_INTERVAL` bila diekspos, jika tidak: hapus baris), kartu pool per `POOL_KEYS` (NAV, NAV/share, free, util bar dari selector, reserved, escrow, paused, aset per pool), papan ringkas (baris ATM ± 2 per board — atau tabel lengkap komponen Task 4 bila sudah ada; di Task 3 tampilkan `BoardTable` sederhana dari selector), panel paritas (n ✓ / n live, ✗ merah bila ada), pratinjau event 5 terbaru; skeleton saat `snapshot === null` (tanpa angka), banner "RPC error on first load — retrying" bila `meta.error && !snapshot`.
- [ ] Test: render dengan `ChainContext` fixture: live → nilai terformat muncul (`2,579.49`, `0.5483`, NAV per pool, `POOL_KEYS.length` kartu); stale → badge "stale" + banner; snapshot null → skeleton tanpa `—` palsu di metrik utama kecuali label "awaiting snapshot"; parity ✗ → teks/warna; 375 px (jsdom: cek class `sidebar--mobile`?) → uji lewat Playwright di Task 7 saja. Commit `app: live layout and overview`.

---

### Task 4: Boards

**Files:** `client/src/pages/Boards.tsx`, `client/src/components/BoardTable.tsx`, `client/src/components/SeriesDetail.tsx`, `test/pages/boards.test.tsx`

- [ ] Satu panel per board (dari `BOARDS`): header expiry UTC + countdown/status (open / expired — awaiting settle / settled @ S_T per pool), tabel: Series (pill C/P, strike, ATM), `Buy ${k}` per pool (6 dp; status teks bila null: `buyError` nama revert manusiawi dari `REVERT_TEXT` bila ada, "blackout", "settled @ payout/unit"), `Δ A|B` (`relDiff` atau `=`), `Close ${k}`, Parity (`✓`/`✗`/`—`/`…`), `OI ${k}` (2 dp), `σ_buy A | B | C` (4 dp), tombol expand → `SeriesDetail` (delta, vega, σ efektif, spot, premi+fee per unit, harga math A/B dari parity row), tombol "Trade" → `#/trade?pool=B&series=<idx>` (query dibaca Trade). Filter bar: board, C/P, hanya open. Catatan kaki jujur (kutip dari `web/src/panels/board.ts` note + Pool C).
- [ ] Test: baris = `ALL_SERIES.length`; seri `buyError` menampilkan teks REVERT_TEXT; settled menampilkan payout; parity ✗ ditandai; tombol expand membuka detail dengan delta. Commit `app: boards page with per-pool quotes, parity and series detail`.

---

### Task 5: Trade + Portfolio (+ drive stub-provider)

**Files:** `client/src/pages/Trade.tsx`, `client/src/pages/Portfolio.tsx`, `client/src/components/{TxLog,PoolSwitch,AmountInput,PreviewLine}.tsx`, `test/pages/trade.test.tsx`, `test/pages/portfolio.test.tsx`, scratchpad `stub-drive.mjs` (Playwright; TIDAK di repo)

- [ ] Trade: pool switch (label + aset: "mock USDG" / "Paxos USDG"), status akun (connect / wrong network / no wallet → read-only + tautan faucet ETH QuickNode), faucet (tombol `mint` untuk A/B; tautan `PAXOS_FAUCET` "Get 100 USDG/day" untuk C), approve (muncul bila allowance < `ALLOWANCE_MIN`), deposit/redeem (+ preview `previewDeposit/previewRedeem`, tombol max), buy (select seri open, size, preview indikatif `quoteBuy` + "executed ≈ … (max …)" bila akun ada), close (select posisi, size ≤ posisi), claim (settled + posisi > 0), `TxLog` (`aria-live`, ✓/✗, tautan Arbiscan, pesan `decodeRevert`), semua tombol nonaktif saat `busy`/tanpa akun/wrong chain; prefill dari query `?pool=&series=`; kalimat gas/executed dari `web/src/panels/trade.ts` `gasNote` dipertahankan.
- [ ] Portfolio: tanpa akun → CTA connect; dengan akun: saldo aset per pool, LP share per pool × NAV/share = nilai, allowance per pool, posisi per seri (unit, nilai close saat ini via `quoteClose(id, posisi)` dibaca on-demand dalam `useEffect` dengan seq guard — bukan di snapshot), klaim tersedia (payout × posisi), riwayat sendiri (filter `events.trades` by `who === account`), tautan alamat.
- [ ] Test (mock `@chain/chain/wallet` + `client.readContract`): tanpa wallet → tombol nonaktif & teks read-only; Pool C → tidak ada tombol faucet, ada tautan Paxos; buy → `run` dipanggil dengan builder yang menghasilkan `maxPremiumAssets = maxPremium(premExec, scaleFee(...))`; close → `minProceeds(execClose)`; `busy` → tombol nonaktif; TxLog menampilkan tautan untuk `TxFailed`. Portfolio: posisi & klaim dihitung benar dari fixture.
- [ ] Drive stub-provider (scratchpad): `vite preview` → Playwright `addInitScript` mendefinisikan `window.ethereum` (`eth_requestAccounts`/`eth_accounts` → owner, `eth_chainId` → 0x66eee, `wallet_switchEthereumChain` → null, `eth_sendTransaction` → reject `{code:4001}`; `eth_call`/`eth_estimateGas`/lainnya → diteruskan ke RPC publik lewat `fetch`), klik connect → pilih Pool B → close 0.5 P 2400 #0 → log berakhir "User rejected the request."; simpan log ke laporan. Hentikan preview dengan `fuser -k 4174/tcp`. Commit `app: trade and portfolio pages`.

---

### Task 6: Activity + Contracts

**Files:** `client/src/pages/Activity.tsx`, `client/src/pages/Contracts.tsx`, `client/src/components/{EventsTable,SigmaTimeline}.tsx`, `test/pages/activity.test.tsx`, `test/pages/contracts.test.tsx`

- [ ] Activity: tabel event (pool, jenis, seri, jumlah, blok, tx ↗; filter pool/jenis/"mine" bila akun), catatan "N events since deploy · seed generated <generatedAt> · scanning…" (`eventsState`), `SigmaTimeline` recharts (x = blok → perkiraan waktu: `blockTime − (snapshotBlock − blok) × 0.25 s` diberi label "≈"), penanda `Settled`.
- [ ] Contracts: tabel alamat dari manifest (pool/token/math per `POOL_KEYS`, vol, feed, USDG mock, USDG Paxos bila C ada, sequencer mock, deployer, factory bila ada di manifest) + explorer + Sourcify link (`https://repo.sourcify.dev/421614/<addr>`), konfigurasi live `cfg()`/`params()` (tabel), build commit/time, tautan docs (README, BENCHMARK, DEMO_LOG, PRD, OPS, VERIFICATION), paragraf kejujuran (mock/testnet/K5/gas) — teks dari `web/src/panels/footer.ts`.
- [ ] Test: baris event = fixture; filter bekerja; Contracts menampilkan semua alamat `POOLS[k].pool` dan `POOLS.C.asset` bila ada. Commit `app: activity and contracts pages`.

---

### Task 7: Penerimaan (brief §9), pengalihan Pages, dokumen

**Files:** Create `equinox-dashboard/ACCEPTANCE.md`; Modify `.github/workflows/pages.yml`, `README.md`, `web/README.md`, `equinox-dashboard/README.md`, `docs/FRONTEND_BRIEF.md` (Appendix B), `docs/VIDEO_SCRIPT.md` (kolom visual), `docs/SUBMISSION.md` (kalimat dashboard), `prd-arsitektur.md` §10.4 (satu paragraf + versi v1.6)

- [ ] `pages.yml`: build `equinox-dashboard` (npm ci di `web` dan `equinox-dashboard`, `npm run seed` toleran, `npm run check && npm test && npm run build`), upload `equinox-dashboard/dist`; `workflow_dispatch` input `target` (`app` default, `classic` = jalur lama) — jalur `classic` dipertahankan sebagai cadangan sampai submisi.
- [ ] Jalankan 11 butir brief §9 terhadap chain live dan tulis `ACCEPTANCE.md` (per butir: perintah, bukti, ✅/❌). Butir 1: bandingkan minimal 8 nilai UI vs `cast call` di blok yang sama (`?rpc=` tidak dipakai; ambil blok dari header UI). Butir 9: Lighthouse mobile via `npx lighthouse http://127.0.0.1:4174/equinox/ --preset=... --chrome-flags=--headless` dari scratchpad (bukan dependensi repo). Bila ada ❌ → perbaiki di task ini (satu putaran) atau tandai dan JANGAN alihkan Pages (Q2).
- [ ] Dokumen: README bagian Dashboard (stack baru, URL sama, `web/` = SDK + klasik), `web/README.md` (peran), FRONTEND_BRIEF Appendix B (peta baru), VIDEO_SCRIPT kolom visual per kartu disesuaikan dengan UI baru (narasi tidak berubah), SUBMISSION kalimat "dashboard", PRD §10.4 paragraf "Plan 5". Commit `app: acceptance run, Pages switched to the React dashboard; docs`.
