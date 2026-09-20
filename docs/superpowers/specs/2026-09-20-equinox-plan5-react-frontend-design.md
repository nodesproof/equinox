# Equinox Plan 5 — Frontend React (`equinox-dashboard/`) di atas data layer `web/src/chain` (spec desain)

**Tanggal:** 20 September 2026 · **Status:** disetujui lisan ("Lanjutkan", 20 Sep) · **Sumber otoritas:** `docs/FRONTEND_BRIEF.md` (kontrak data §3, formula §4, perilaku §5, jalur tulis §6, kejujuran §7, persyaratan §8, penerimaan §9), spec Plan 3 (K5), spec Plan 4 (Pool C, aset per pool). Tidak ada perubahan kontrak.

---

## 0. Titik awal (terverifikasi 20 Sep 2026)

`equinox-dashboard/` = scaffold React yang dihasilkan Manus dari FRONTEND_BRIEF (React 19, Vite 7, Tailwind 4, shadcn/Radix, pnpm; 87 file, 860 KB tanpa node_modules; belum masuk git). Isinya: bahasa visual "dark observatory" (`client/src/index.css`, 225 baris kelas kustom: sidebar, topbar, metric-card, panel, board table, notice banner) dan halaman Overview dengan data kosong (`—`, banner "Live RPC adapter not connected"); Boards/Trade/Portfolio/Activity/Contracts = stub 1–4 baris; alamat kontrak hard-coded di `Home.tsx`; navigasi via state `Page`, bukan router. Kopling platform Manus yang harus dibuang: `vite-plugin-manus-runtime`, plugin debug collector & storage proxy di `vite.config.ts`, `@builder.io/vite-plugin-jsx-loc`, skrip analytics `%VITE_ANALYTICS_ENDPOINT%/umami` di `index.html`, `server/index.ts` (Express), `client/src/const.ts` (OAuth Manus), `components/ManusDialog.tsx`, `components/Map.tsx` (+`@types/google.maps`), `template.json`, `client/public/__manus__/`, `patches/wouter@3.7.1.patch` (hanya untuk runtime Manus), `server.allowedHosts`. `pnpm check` dan `pnpm build` lolos; bundel 175 KB gzip sebelum data layer.

## 1. Keputusan

| # | Keputusan | Alasan |
|---|---|---|
| Q1 | **`equinox-dashboard/` menjadi frontend Equinox; `web/` menjadi SDK (data layer + test) dan UI klasik cadangan.** Tidak ada duplikasi logika chain: aplikasi mengimpor `../web/src/{chain,deployment,abi}` lewat alias `@chain` (Vite `resolve.alias` + `server.fs.allow`, TS `paths`). | Data layer sudah teruji (33 unit + 3 network), sudah N-pool/aset-per-pool setelah Plan 4; brief §0.3 |
| Q2 | **Aturan cadangan:** Pages tetap men-deploy `web/` sampai aplikasi lulus **seluruh** checklist brief §9 (dijalankan di Task penerimaan); pengalihan = satu commit di `pages.yml`. Batas: bila belum lulus **28 Sep 2026**, submisi memakai UI klasik. | Deadline 1 Okt; tidak boleh ada hari tanpa dashboard yang berfungsi |
| Q3 | **Bersih dari Manus/Express/analytics** (daftar §0). Tidak ada skrip pihak ketiga, telemetri, atau server. Situs statis murni. | Brief §8.4 (keamanan, CSP), hosting Pages |
| Q4 | **npm**, bukan pnpm: `package-lock.json`, `npm ci` di CI (cache npm seperti `web/`). Patch wouter dibuang (tidak diperlukan tanpa runtime Manus). | Konvensi repo; satu package manager |
| Q5 | **Router wouter dengan `useHashLocation`** (`/#/`, `/#/boards`, `/#/trade`, `/#/portfolio`, `/#/activity`, `/#/contracts`); `base: '/equinox/'`; aset via `import.meta.env.BASE_URL`. | Deep link aman di GitHub Pages tanpa trik 404 |
| Q6 | **Tailwind 4 + kelas kustom `index.css` dipertahankan** sebagai sistem desain (token warna = brief §3.10 #67); komponen shadcn yang tidak dipakai dihapus dari `components/ui/` (audit impor); `recharts` hanya untuk grafik σ_base & sparkline; `framer-motion` dibuang bila tidak dipakai. Budget: **≤ 250 KB gzip total JS** (brief §8.4), diperiksa saat build. | Bundel 175 KB sebelum viem (~60 KB gzip) — harus dipangkas |
| Q7 | **Hooks tipis di atas data layer**, satu sumber kebenaran per refresh: `useSnapshot()` (poll 15 s, backoff 30/60 s, `stale` 60 s, data terakhir dipertahankan saat RPC gagal, `?poll=`), `useParity(snapshot)`, `useGas(snapshot)`, `useEvents(snapshotBlock)` (seed → delta tiap refresh ke-4, merge/dedupe), `useWallet()` (EIP-1193: connect, `ensureChain` 4902/4001, `accountsChanged`/`chainChanged`), `useTrade()` (aksi faucet/approve/deposit/redeem/buy/close/claim; cap dari `executedBuy`/`executedClose` + `scaleFee`; `write()`; `TxFailed` → log dengan tautan; satu aksi sekaligus; pool & akun ditangkap saat klik). Semua state chain hidup di satu `ChainProvider` (context) — halaman hanya membaca. | Brief §5 (setiap baris = insiden); tidak ada logika chain di komponen |
| Q8 | **Enam halaman** sesuai brief §8.1, semua **state** §8.2, **format** §8.3, **Pool C** (aset per pool; faucet Paxos untuk C, mint untuk A/B; paritas & gas A vs B). Tidak ada angka palsu: skeleton/`—` + alasan. | Brief §7–8 |
| Q9 | **Test:** vitest + `@testing-library/react` + jsdom — komponen/halaman dirender dari **fixture snapshot** (live, stale, wrong network, no wallet, paused, oracle stale, blackout, settled, no positions, seed 404); hooks diuji dengan `client` yang di-mock; satu skrip drive stub-provider (Playwright, scratchpad/`scripts/`, bukan CI) menegaskan calldata cap = simulasi & "User rejected the request.". Data layer tetap diuji di `web/`. | Brief §8.4; tidak ada yang menandatangani di CI |
| Q10 | **CI/Pages:** job `app` di `ci.yml` (typecheck, test, build, cek budget gzip); `pages.yml` mendapat input `target: classic|app` (default `classic`) sampai pengalihan permanen (Q2); build app menjalankan `npm run seed` di `web/` lalu menyalin `events-seed.json` ke `client/public/`. | Q2 |
| Q11 | **Dokumen:** README (bagian Dashboard + stack), `web/README.md` (peran SDK + UI klasik), `equinox-dashboard/README.md` (baru), FRONTEND_BRIEF Appendix B (peta implementasi baru), VIDEO_SCRIPT (satu pass revisi visual setelah penerimaan), SUBMISSION (URL tetap). Jumlah test di dokumen diperbarui dari keluaran nyata. | Kejujuran |

## 2. Arsitektur

```
equinox-dashboard/                      (frontend — Vite 7 + React 19 + Tailwind 4, base /equinox/)
  client/index.html                     (tanpa analytics; font Instrument Sans + Martian Mono)
  client/src/main.tsx → App.tsx         (ChainProvider → Router(hash) → Layout(sidebar/topbar/testnet strip) → pages)
  client/src/chain/                     hooks: useSnapshot, useParity, useGas, useEvents, useWallet, useTrade; ChainProvider
  client/src/pages/                     Overview, Boards, Trade, Portfolio, Activity, Contracts
  client/src/components/                (design system: MetricCard, Panel, StatusPill, BoardTable, SeriesRow, TxLog, EmptyValue, Skeleton, Banner…)
  client/src/lib/format.ts              re-export dari @chain/ui/format + helper tampilan
  client/public/events-seed.json        (dibangkitkan saat build; git-ignored)
  test/                                 vitest (jsdom)
  ← @chain = ../web/src  (chain/*, deployment.ts, abi/*, ui/format.ts, ui/poll.ts)   ← @deployment = ../deployments/arbitrum-sepolia.json
web/                                    (SDK + UI klasik cadangan; test data layer; scripts/seed-events.ts, gen-abi.mjs)
```

Data flow: `ChainProvider` memegang `{ snapshot, meta(lastOk, stale, error), parity, gas, events, account, wrongChain, busy, txLog }`; `useSnapshot` membaca `readSnapshot(client, account)`; halaman memakai selector (`usePool(k)`, `useSeriesRows()`, `useUser()`) agar render tidak menyalin logika. Tulis: `useTrade().run(action, args)` → builder `@chain/chain/trade` → `write()`; setelah selesai `refreshNow()`.

## 3. Halaman & komponen (ringkas; detail = brief §8.1–8.3)

- **Layout:** sidebar (nav 6 item, network card "Arbitrum Sepolia · 421614", status live/stale/connecting + blok, tombol connect/alamat), topbar strip testnet ("Testnet · mock USDG on A/B · Pool C settles in Paxos USDG"), banner RPC (stale/error), toaster (sonner) untuk hasil tx.
- **Overview:** metrik (ETH/USD + umur, σ_base, σ_mark(0), VRP/α/spread, next expiry countdown), kartu per pool (NAV, NAV/share, free liquidity, util bar, reserved, escrow, paused), grafik σ_base (Observed), ringkasan paritas (n ✓ / n), CTA ke Boards/Trade.
- **Boards:** satu tabel per board (baris strike × C/P): Buy per pool, Δ A|B, Close per pool, Parity ✓/✗/—, OI per pool, σ_buy; status baris (open/blackout/expired-awaiting-settle/settled @ payout); ATM highlight; baris expandable Greeks (δ, vega, σ efektif, spot) dari `quoteBuy`.
- **Trade:** pool switch (A/B/C dengan label aset), faucet (mint) atau tautan Paxos (C), approve, deposit/redeem (preview), buy/close/claim (preview indikatif + executed + cap), log tx dengan tautan Arbiscan & pesan revert manusiawi; read-only tanpa wallet.
- **Portfolio:** saldo aset per pool, LP share × NAV/share, posisi per seri dengan nilai close saat ini (`quoteClose(id, posisi)`) dan payout klaim, riwayat sendiri (event dengan trader/holder = akun), allowance.
- **Activity:** feed event (filter pool/jenis/mine), grafik σ_base dengan sumbu waktu (blok → waktu via snapshot), penanda Settled.
- **Contracts:** alamat §2 brief (dari manifest, termasuk Pool C & USDG asli) + explorer, konfigurasi `cfg()`/`params()` live, build commit, tautan docs, status Sourcify (statis dari VERIFICATION).

## 4. Penerimaan (gerbang pengalihan Pages)

Seluruh brief §9 (11 butir) dijalankan terhadap chain live dan dicatat di `equinox-dashboard/ACCEPTANCE.md` dengan bukti (perbandingan `cast` per nilai, hasil drive stub, ukuran bundel, skor Lighthouse mobile, grep hard-code). Lulus semua → commit pengalihan `pages.yml` (`target` default `app`) + README.

## 5. Di luar cakupan

Perubahan kontrak/ABI; data layer baru; backend; i18n; tema terang; halaman admin (settle/poke/createBoard) — mungkin sebagai tombol permissionless "Poke engine" di Overview bila waktu ada (opsional, bukan syarat penerimaan).
