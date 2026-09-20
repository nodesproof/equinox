# Equinox Plan 3 — Demo di Arbitrum Sepolia, dashboard + trading, paket submission (spec desain)

**Tanggal:** 20 September 2026 · **Status:** disetujui lisan (percakapan 20 Sep), menunggu review tertulis · **Sumber otoritas:** `prd-arsitektur.md` v1.3 (§10.3–10.4, §13, §15, §16, §17); dokumen ini mengamandemen §10.4 dan §13 untuk Plan 3.
**Konteks event:** Arbitrum Open House Singapore: Online Buildathon — Equinox disubmit sebagai **entri kedua** di samping Vigil (`../docs/TRACK.md`). Surface juri (dari `../docs/HACKATHON_BRIEF.md`): entri HackQuest → dashboard live → repo → explorer, plus video. Rubrik: *smart contract quality, product-market fit, innovation, real problem solving* + modifier *use of Arbitrum technology, presentation quality*; bobot tidak dipublikasikan. **Deadline yang dipakai: 1 Oktober 2026 23:59 SGT (15:59 UTC)** — T&C; HackQuest menampilkan 4 Okt; pakai yang lebih awal sampai ada konfirmasi tertulis.

---

## 0. Keputusan yang sudah diambil (tanya-jawab 20 Sep)

| # | Pertanyaan | Keputusan |
|---|---|---|
| K1 | Peran Equinox di buildathon | Submisi kedua, paket lengkap (form HackQuest, video script, Q&A juri, scorecard, runbook) |
| K2 | Kedalaman UI | Dashboard **+ trading lewat wallet** (MetaMask/injected): faucet, deposit/redeem, buy/close/claim dari browser |
| K3 | Sumber harga di Sepolia | **Chainlink ETH/USD asli** — σ_base benar-benar dari print nyata; waktu tidak bisa di-warp, settlement nyata terjadi di grid Jumat |
| K5 | Klaim identitas di chain hidup | **Paritas matematika**, bukan kuotasi pool byte-identik: kedua kontrak `math` memberi harga identik untuk input identik (S, K, t, σ) — diverifikasi langsung (`cappedCall`/`quote` pada kedua alamat math; `onchain-check` 20/20). Kuotasi pool ditampilkan berdampingan dengan util masing-masing dan **boleh berbeda** oleh dampak inventaris begitu histori trade menyimpang (ulangan put di A pada round berbeda pada 20 Sep: netVega Δ 1,64 → kuotasi berbeda di digit ke-5; trade juri pada satu pool akan memperbesar selisih). `sepolia-demo.sh` membandingkan kuotasi pool hanya bila `netVega` dan kapital-untuk-cap (`min(kas − escrow, capitalRefPrev)`) sama pada blok itu, selain itu membandingkan paritas math dan mencetak Δ kuotasi |
| K4 | σ identik A vs B pada feed hidup | **Satu vol engine bersama** (`EquinoxFactory.createPoolWithVol`): dua engine terpisah tidak bisa tetap identik karena `poke()` hanya mengamati round terakhir dan setiap trade hanya mem-poke engine pool-nya sendiri → histori observasi (dan EWMA) A/B menyimpang. Di Sepolia engine dibuat untuk Pool B (math Stylus) dan dipakai Pool A juga. Konsekuensi jujur: gas `buy` A vs B di Sepolia hanya membandingkan jalur pricing (2 × `cappedCall`); `sqrt` σ sama-sama Stylus. Benchmark devnode (dua engine, feed mock statis) tetap apples-to-apples |

Turunan K3: narasi deterministik §13 (warp 7 hari, settle 4.500, claim) tetap direkam dari Foundry (Pool A/kontrol) karena Foundry tidak bisa mengeksekusi Stylus dan chain publik tidak bisa di-warp; identitas A = B sudah dibuktikan on-chain (Plan 2 §13, Sepolia 20 Sep).

## 1. Fakta terverifikasi (20 Sep 2026)

| Fakta | Nilai | Cara verifikasi |
|---|---|---|
| Chainlink ETH/USD, Arbitrum Sepolia | proxy `0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165` (aggregator `0xf3138B59cAcbA1a4d7d24fA7b184c20B3941433e`), 8 desimal, **heartbeat 120 s, deviasi 0,05 %** | `reference-data-directory.vercel.app/feeds-ethereum-testnet-sepolia-arbitrum-1.json` (sumber data docs.chain.link) + `cast call description()` = "ETH / USD", round terakhir umur 97 s, harga ≈ 2.626,85 |
| L2 Sequencer Uptime Feed, Arbitrum Sepolia | **tidak ada** (docs.chain.link/data-feeds/l2-sequencer-feeds hanya mencantumkan mainnet `0xFdB631F5EE196F0ed6FAa767959853A9F217697D`) | → `MockSequencerFeed` (status up), didokumentasikan (PRD V7) |
| USDG di Arbitrum Sepolia | tidak ada | → `MockUSDG` 6 dp dengan `mint` terbuka (= faucet) |
| Math sudah dideploy (Plan 1 Task 15) | Stylus `0xb3b37050a40b9755001bddd29cc5df17a59f51d4` (cached, `programTimeLeft` ≈ 365 hari), `BlackScholesSol` `0x5B239AE1510AED1Bb21EB9d2e8A471D45720c4B3`, `Bench` `0x5801Aa89eAdABDE9ea21D2e26858760F8B71f346` | `deployments/arbitrum-sepolia.json`; 20/20 `onchain-check.sh` |
| Multicall3 di Arbitrum Sepolia | `0xcA11bde05977b3631167028862bE2a173976CA11` (kode 3.8 KB) | `cast code` |
| Wallet owner/treasury (kunci di `.env`, git-ignored) | `0x90351bB1E85a17D5f70c62C0cC076D39D897076D`, saldo ≈ 0,38 Sepolia ETH | `cast balance` |
| Grid expiry berikutnya | **Jum 25 Sep 2026 08:00 UTC = `1790323200`**, **Jum 2 Okt 2026 08:00 UTC = `1790928000`** (keduanya memenuhi `(expiry − 115200) % 604800 == 0`) | Python `datetime` |
| Batas `createBoard` (kode) | `expiry > now`, `expiry − now ≤ tenorMax` (30 hari), grid Jumat, strike naik & unik, kelipatan 1 USDG, dalam `[S/2, 2S]`, ≤ 32 seri terbuka, owner, tidak saat pause | `EquinoxPool.createBoard` |

## 2. Bentuk keseluruhan

Dua rencana, satu spec:

- **Plan 3a — chain** (dikerjakan dulu; kalender): deployer dengan feed parametris, dua pool live di Sepolia, dua board, seed LP, keeper cron, skrip demo live, test naratif. Target selesai **≤ 21 Sep** agar riwayat trade ada sebelum settlement nyata pertama (25 Sep).
- **Plan 3b — web + submission**: dashboard + trading (Vite + TypeScript + viem), GitHub Pages, paket submission, PRD v1.4, README.

```
Sepolia (421614)
  Chainlink ETH/USD ──► EquinoxVolEngine (satu, bersama — K4) ──┬──► EquinoxPool A ──► BlackScholesSol   (kontrol)
        │                                                        └──► EquinoxPool B ──► bs-stylus (WASM) (Equinox)
  MockSequencerFeed ─┘   MockUSDG (faucet)     EquinoxOptionToken A/B
        ▲                                           ▲
  keeper.yml (cron 15 mnt: poke, settle)      web/ (GitHub Pages) ──► viem: baca (multicall3) + tulis (wallet)
        ▲                                           ▲
  tools/demo/sepolia-demo.sh (narasi live, tx hash → docs/DEMO_LOG.md)   docs/SUBMISSION.md, VIDEO_SCRIPT.md, JUDGE_QA.md, …
```

---

## 3. Plan 3a — chain

### 3.0 Factory: `createPoolWithVol` (K4)
`EquinoxFactory.createPoolWithVol(EquinoxPool.Deploy calldata d, address vol)` — sama seperti `createPool` tetapi memakai `EquinoxVolEngine` yang sudah ada (`d.vol`/`d.sigmaSeed` diabaikan); revert `VolFeedMismatch()` bila `EquinoxVolEngine(vol).feed() != d.feed`. Kontrak pool, token, engine, dan `PoolDeployer` tidak disentuh. Test `contracts/test/EquinoxFactory.t.sol`: `poolA.vol() == poolB.vol()`, trade di A mem-poke engine yang sama sehingga kuotasi A = B setelah round feed baru, mismatch feed revert, `forge build --sizes` hijau.

### 3.1 Deployer dengan feed parametris & engine bersama
`contracts/src/mocks/PoolE2EDeployer.sol` → constructor `(address owner, address mathA, address mathB, address feed_, bool sharedVol)`: bila `feed_ == address(0)` deploy `MockFeed(8)` dan `set(4000e8, now)` (perilaku devnode sekarang); bila bukan, pakai alamat itu apa adanya dan **tidak** memanggil `set`. `tick(int256)` hanya valid untuk mock (revert `NotMockFeed()` bila feed eksternal). Pool B dibuat dulu (`createPool`, engine dengan `mathB`); Pool A lewat `createPoolWithVol(paramsA, poolB.vol())` bila `sharedVol`, selain itu `createPool` (dua engine, seperti devnode sekarang). `nextExpiry`, `_params`, mint 4.000.000 USDG ke owner tetap. `tools/e2e/pool-e2e.sh` meneruskan `address(0) false`; test Foundry baru memastikan jalur mock/eksternal dan shared/terpisah. Ukuran initcode tetap < 49.152 B (`forge build --sizes`).

### 3.2 Deployment ke Sepolia — `tools/sepolia/deploy-pools.sh`
`forge create PoolE2EDeployer --constructor-args <owner> <mathA> <mathB> 0xd30e2101… true` (kunci dari `.env`: `set -a; source .env; set +a`, tidak pernah di-echo). Skrip menulis/menggabungkan ke `deployments/arbitrum-sepolia.json` (dengan `jq`) blok baru:
```json
"pools": {
  "deployer": "0x…", "usdg": "0x…", "feed": "0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165", "sequencerFeed": "0x…",
  "vol": "0x…",                       // engine bersama (math Stylus), K4
  "A": { "label": "control (BlackScholesSol)", "pool": "0x…", "token": "0x…", "math": "0x5B23…" },
  "B": { "label": "Equinox (Stylus)",           "pool": "0x…", "token": "0x…", "math": "0xb3b3…" },
  "deployedAtBlock": <blok>, "deployedAt": "<ISO-8601 UTC>"
}
```
`deployments/arbitrum-sepolia.json` **di-commit** (satu-satunya sumber alamat untuk web, keeper, demo, docs). Verifikasi otomatis di akhir skrip: `poolA.vol() == poolB.vol()`, `vol.feed()` == alamat Chainlink, `asset()` == usdg untuk keduanya, `vol.sigmaBase()` > 0.

### 3.3 Board & seed LP — `tools/sepolia/list-boards.sh`
Dari wallet owner: `usdg.approve` kedua pool; `deposit(1_000_000e6)` ke masing-masing (bootstrap kapital referensi seketika); `createBoard(1790323200, [2400e18, 2600e18, 2800e18])` dan `createBoard(1790928000, [2200e18, 2600e18, 3000e18])` di **kedua** pool (input identik) → 12 seri per pool; skrip membaca `board(id)` dan menulis `boards: [{ "id", "expiry", "strikes", "seriesIds": {"A": [...], "B": [...]} }]` ke JSON. Strike wajib berada dalam `[S/2, 2S]` pada saat listing: skrip membaca spot dulu dan **gagal keras** (bukan menyesuaikan diam-diam) bila spot bergerak keluar rentang — operator memilih strike baru secara sadar. Idempoten: bila board dengan expiry itu sudah ada di JSON, dilewati.

### 3.4 Keeper — `tools/keeper/keeper.sh` + `.github/workflows/keeper.yml`
- Cron `*/15 * * * *` (GitHub Actions; jitter beberapa menit dapat diterima), `workflow_dispatch` untuk manual.
- Wallet **keeper terpisah** (bukan owner): dibuat `cast wallet new`, didanai ≈ 0,02 Sepolia ETH; kunci disimpan sebagai secret repo `KEEPER_PRIVATE_KEY`; RPC dari secret opsional `SEPOLIA_RPC_URL` (default RPC publik). Bounty settle (2 USDG mock) menumpuk di wallet keeper — tidak penting.
- Logika: `vol.poke()` sekali (engine bersama; no-op murah bila round belum berubah; gagal → lanjut); cek `MockSequencerFeed` (setter terbuka — pulihkan `set(0, now − 7200)` bila answer ≠ 0 / grace dipasang ulang); lalu per pool (A lalu B), untuk setiap board di JSON dengan `settled == false` (baca `board(id)`): pre-flight `cast call settle(id)` — revert `BoardNotExpired`/`SettlementNotReady`/`BoardAlreadySettled`/`OracleStale` dinamai dan ditoleransi (log, exit 0) — lalu kirim dengan estimasi × 1,5 dan cek `status` receipt; satu settle gagal → board/pool berikutnya. Setelah `settle` sukses, tulis hash + `board(id)` ke log job (JSON tidak diubah oleh keeper — tanpa commit dari CI).
- Pemeriksaan kesehatan yang dicetak tiap run: umur round feed, `programTimeLeft` program Stylus (ArbWasm `0x…71`), `totalAssets()` A vs B, σ_base / σ_mark(0) (engine bersama) dan keadaan per pool (`reserved`, escrow — util per pool sah berbeda) — tidak ada assert; kegagalan membaca kesehatan tidak memblokir settle.
- Mode `DRY_RUN=1` (hanya `cast call`/`estimateGas`) untuk test lokal.

### 3.5 Demo live — `tools/demo/sepolia-demo.sh`
Menjalankan narasi identik di A dan B dari wallet owner, mencetak tabel dan menulis `docs/DEMO_LOG.md` (tanggal, blok, tx hash Arbiscan `https://sepolia.arbiscan.io/tx/…`):
1. `quoteBuy` 10 C 2.800 (board 25 Sep) — cetak premi, σ_buy, Δ, vega, spot untuk A dan B; **assert identik hanya bila `netVega` dan kapital-untuk-cap (`min(kas − escrow, capitalRefPrev)`) A == B pada blok itu**; selalu assert paritas math (harga dari kedua kontrak math pada input identik) dan premi tiap pool == `math`-nya sendiri; selain itu cetak Δ kuotasi pool (K5). Blok ini juga dijalankan sendiri, read-only, lewat `--check`.
2. `buy` 10 C 2.800 di A dan B (gas dicetak; rasio).
3. `quoteBuy` 1 P 2.400 → cetak mid vs floor `minPremiumBps × K` (pada S ≈ 2.627 dan 5 hari put ini ≈ 9 % OTM, mid ≈ 11 USDG > floor 1,2 — floor yang menang untuk deep-OTM diperagakan `Narrative.t.sol`); `buy` 1 P 2.400.
4. `close` 5 C 2.800 di A dan B.
5. Cetak NAV, `reserved`, `netVega`, `escrowedPayouts`, `freeLiquidity`, `sigmaMarkNow` A vs B pada blok yang sama (✓ bila sama; NAV/`netVega` boleh berbeda oleh skew timestamp tx, `sigmaMarkNow` = σ_mark(util) per pool — tidak di-assert). Yang identik by construction: `vol()` A == B dan σ_mark(0) dari engine bersama.
Langkah pasca-settlement (dijalankan terpisah setelah 25 Sep 08:00 UTC, `sepolia-demo.sh --claim`): `claim` seri C 2.800 & P 2.400 (payout sesuai `settlementPrice`), cetak NAV sebelum/sesudah, tambahkan ke `DEMO_LOG.md`.
Skrip memakai `cast send` sekuensial; peringatan skew timestamp A/B (lihat BENCHMARK) berlaku — kuotasi diambil pada blok yang sama lewat `cast call --block`.

### 3.6 Narasi deterministik — `contracts/test/Narrative.t.sol`
Test Foundry pada Pool A (kontrol) yang **mencetak** tabel §13 dengan `console2.log`: LP deposit 1.000.000 → `quoteBuy` 10 C 4.200 (mid dari `cappedCall` pada σ_mark(0) = 64,87/unit vs harga beli; σ_mark) → `buy` → `buy` P 2.600 (floor menang) → `vm.warp` 7 hari → `tick(4500e8)` → `settle` → `claim` 10 × 300 = 3.000 → NAV LP = 1.000.000 + premi − 3.000 − bounty 2 (fee ke treasury tidak masuk NAV). Assert angka cocok dengan §6.7 dan `test_scenario1_settle_claim_nav`; dijalankan `forge test --match-contract Narrative -vv` untuk video. Tidak mengubah kontrak.

### 3.7 Kriteria terima Plan 3a
- `forge test` hijau (+ test deployer & Narrative); `forge build --sizes` hijau.
- `deployments/arbitrum-sepolia.json` berisi pools/boards; `vol()` A == B (engine bersama) dan σ_mark(0) bersama — `sigmaMarkNow()` (σ_mark(util)) tidak dituntut sama; 12 seri per pool terlihat di Arbiscan.
- `sepolia-demo.sh` selesai exit 0 dengan paritas math ✓ (kuotasi A == B hanya bila inventaris sama, K5) dan `docs/DEMO_LOG.md` berisi hash.
- Workflow keeper berjalan hijau minimal 2× berturut-turut (dispatch manual + cron).
- `docs/BENCHMARK.md` mendapat baris gas `buy`/`close` Sepolia (program cached) dari demo.

---

## 4. Plan 3b — web (dashboard + trading)

### 4.1 Stack & struktur (pola Vigil, `../vigil/web/`)
`web/` — Vite 6 + TypeScript 5 + **viem 2**, tanpa framework; DOM langsung. Struktur:
```
web/
  index.html  vite.config.ts (base '/equinox/')  package.json  tsconfig.json
  scripts/gen-abi.mjs            # ABI dari contracts/out → src/abi/*.ts (EquinoxPool, EquinoxVolEngine, EquinoxOptionToken, MockUSDG, IAggregatorV3, Multicall3)
  src/main.ts  src/styles.css
  src/chain/{client.ts, deployment.ts, snapshot.ts, quotes.ts, events.ts, wallet.ts}
  src/panels/{header.ts, series.ts, nav.ts, trade.ts, activity.ts, vol.ts}
  src/ui/{format.ts, dom.ts}
  test/{format.test.ts, seriesId.test.ts, abi.test.ts, parity.network.test.ts}
  public/{favicon.png, …}
```
`deployment.ts` mengimpor `../../deployments/arbitrum-sepolia.json` saat build (satu sumber alamat). Workflow `.github/workflows/pages.yml` (salin pola Vigil: build `web/dist`, `actions/deploy-pages`) → `https://nodesproof.github.io/equinox/` (GitHub Pages harus diaktifkan di repo: Settings → Pages → Source "GitHub Actions" — tindakan pemilik repo, atau `gh api` dengan token nodesproof). CI job `web`: `npm ci`, `typecheck`, `vitest run`, `vite build`.

### 4.2 Pembacaan (read path)
- `publicClient` viem pada RPC publik Sepolia (bisa diganti lewat `?rpc=`), refresh tiap 12 s dan saat blok baru (`watchBlockNumber`).
- Satu **snapshot** per refresh lewat Multicall3: feed `latestRoundData`, per pool: `totalAssets`, `totalSupply`, `reserved`, `escrowedPayouts`, `netVega`, `freeLiquidity`, `sigmaMarkNow`, `vol.sigmaBase`, `capitalRefPrev`, `tradingPaused`, `usdg.balanceOf(pool)`, `board(id)` untuk tiap board, `series(id)` untuk 12 seri, `quoteBuy(id, 1e18)` dan `quoteClose(id, 1e18)` untuk seri terbuka (revert `SeriesExpired`/`OracleStale` ditampilkan sebagai status, bukan error), dan bila wallet terhubung: saldo USDG, share, `token.balanceOf(user, id)`.
- **Counter gas A vs B**: `estimateGas` untuk `buy(seriesId, 1e18, maxUint)` dengan `account = owner` (`0x9035…`, yang punya saldo & allowance) pada seri ATM terdekat, dicetak berdampingan dengan rasio — tulisan kecil menjelaskan bahwa ini estimasi `eth_estimateGas` (bukan receipt), bahwa program Stylus cached, dan bahwa σ dihitung engine bersama sehingga selisihnya hanya jalur pricing (K4); tautan ke tabel devnode apples-to-apples di BENCHMARK.
- Event: `getLogs` dari `deployedAtBlock` untuk `Bought/Closed/Settled/Claimed` (kedua pool) dan `Observed` (vol engine) — dipakai panel Aktivitas dan grafik σ_base (SVG sederhana, sumbu waktu).

### 4.3 Panel
1. **Header**: nama, chain (421614) + status RPC, harga feed & umur round, blok; σ_base/σ_mark(0) (engine bersama, K4); per pool A/B: util, kapital referensi, `tradingPaused`.
2. **Papan seri**: tabel 12 baris × kolom {expiry, strike, C/P, OI A/B, premi beli/unit A | B, proceeds tutup/unit A | B, Δ, vega, status (terbuka/blackout/expired/settled + `payoutPerUnit`)}; kolom **paritas math** per seri (harga `cappedCall`/`quote` dari kedua kontrak math pada input yang sama: S, K, t, σ_mark(0)) → ✓ "identik" (K5); kuotasi pool A | B berdampingan dengan util masing-masing dan Δ bila inventaris berbeda; **kolom gas buy A vs B**.
3. **NAV**: per pool: kas, escrow, reserved, liability MtM (= kas − escrow − NAV), NAV, NAV/share, util, netVega; share & nilai milik wallet.
4. **Trade** (aktif setelah connect): pilih pool (A/B; default B), **faucet** (`MockUSDG.mint(me, 100_000e6)`), **approve** (max), **deposit/redeem** (input USDG/share, preview lewat `previewDeposit/previewRedeem`), **buy** (seri + ukuran; `quoteBuy` live; `maxPremium = (premi+fee) × 1,01`), **close** (ukuran ≤ saldo; `minProceeds = quote × 0,99`), **claim** (seri settled; payout yang akan diterima). Setiap tx: tombol → tanda tangan → hash + link Arbiscan → refresh snapshot. Chain salah → `wallet_switchEthereumChain` (dan `wallet_addEthereumChain` bila perlu). Peta error selector → pesan (mis. `UtilizationExceeded` → "cap utilisasi 80 % tercapai — kapital referensi di-lag 1 hari").
5. **Aktivitas**: 50 event terakhir (pool, jenis, seri, ukuran, harga/σ, tx), grafik σ_base dari `Observed`.
6. **Footer**: alamat semua kontrak + link Arbiscan; catatan "USDG, sequencer feed = mock; harga = Chainlink asli; math Stylus cached"; link repo, PRD, BENCHMARK.

### 4.4 Wallet & tulis (write path)
`createWalletClient({ chain: arbitrumSepolia, transport: custom(window.ethereum) })`; `simulateContract` sebelum `writeContract` (agar revert tampil sebelum tanda tangan); `waitForTransactionReceipt`; tanpa penyimpanan kunci apa pun di web. Tanpa wallet: seluruh dashboard tetap berfungsi (read-only) — juri tanpa MetaMask tetap melihat semuanya.

### 4.5 Test web
- `format.test.ts` (WAD/6 dp → string, pembulatan tampilan), `seriesId.test.ts` (`keccak256(abi.encode(pool, expiry, strike, isCall))` == `token.seriesId` untuk seri di JSON — nilai diambil dari JSON), `abi.test.ts` (ABI yang di-generate memuat fungsi yang dipakai).
- `parity.network.test.ts` (dijalankan bila `EQUINOX_NETWORK_TESTS=1`): kuotasi yang akan ditampilkan == `quoteBuy` on-chain per pool; paritas math A == B untuk semua seri terbuka (panggilan langsung ke kedua kontrak math dengan input identik, K5); NAV yang dihitung panel == `totalAssets()`.
- `npm run typecheck`, `vite build` hijau; halaman terbuka tanpa error konsol pada RPC publik.

### 4.6 Kriteria terima Plan 3b
Dashboard live di `nodesproof.github.io/equinox/` menampilkan 12 seri × 2 pool dengan paritas math ✓ dan kuotasi pool berdampingan (Δ inventaris bila ada), NAV, gas A vs B, aktivitas; alur trade lengkap (faucet → approve → deposit → buy → close → claim) berhasil dari MetaMask di Sepolia (direkam sebagai bukti); CI `web` hijau.

---

## 5. Paket submission & dokumen (Plan 3b, task terakhir)

Dibuat lewat agen **submission-packager** (pola paket Vigil di `../docs/`), setelah dashboard dan settlement 25 Sep nyata:
- `docs/SUBMISSION.md` — isi form HackQuest (setiap field ≤ 300 karakter, dihitung), link UI (Pages), repo, video, explorer (pool A/B, program Stylus), track.
- `docs/VIDEO_SCRIPT.md` — 3 menit: (1) masalah & klaim "tanpa oracle IV" (30 s), (2) dashboard live: σ dari print Chainlink nyata, kuotasi A = B (45 s), (3) trade dari wallet (45 s), (4) settlement nyata 25 Sep + claim (30 s), (5) tabel gas jujur 2,6–2,9× vs 0,99–1,08× + benchmark sebagai kontribusi (30 s).
- `docs/JUDGE_QA.md` (≥ 20 pertanyaan dari §11, §16, §19, temuan audit Plan 2 — termasuk "kenapa 10× dicabut", "sandwich NAV", "kenapa mock USDG"), `docs/RUBRIC_SCORECARD.md`, `docs/DEMO_RUNBOOK.md` (jalur per surface + rehearsal).
- **Aturan kejujuran** (mengikat): rasio transaksi 0,99–1,08× tidak disembunyikan; mock USDG/sequencer disebut di footer dashboard, README, dan form; "cached" disebut di setiap angka gas Stylus.
- PRD → **v1.4**: §10.4 UI (terbangun; stack), §13 hasil Sepolia (alamat, tabel demo live, settlement nyata), §15 status hari 10–15, §18 V6/V7 ✅ dengan nilai terverifikasi, header/status. README: link dashboard, alamat pool, cara mencoba (faucet), keeper.

---

## 6. Risiko & fallback

| Risiko | Mitigasi / fallback |
|---|---|
| Feed Chainlink Sepolia berhenti/jarang (testnet) | `staleMult` 3 → jendela 3 jam; `OracleStale` tampil di dashboard; keeper melaporkan umur round; narasi Foundry tidak terpengaruh |
| Spot bergerak keluar `[S/2, 2S]` saat listing | `list-boards.sh` membaca spot dan gagal keras; operator memilih strike lain |
| GitHub Pages belum aktif di repo | tindakan pemilik repo (Settings → Pages → GitHub Actions) atau `gh api repos/nodesproof/equinox/pages` dengan token nodesproof; fallback: `mdlog.github.io/equinox` dari fork |
| Cron GitHub tertunda/lewat | settle permissionless — `sepolia-demo.sh --claim` memanggil `settle` sendiri bila keeper belum |
| Juri tanpa Sepolia ETH | tautan faucet Sepolia di panel Trade; dashboard read-only tetap lengkap |
| Kapital referensi di-lag → deposit juri tidak langsung memperluas cap | seed 1 juta USDG per pool memberi ruang; pesan error dipetakan; dijelaskan di UI |
| `PoolDeployer` margin 1,5 KB | Plan 3 tidak menyentuh `contracts/src/pool/` |
| Kunci | owner hanya di `.env` lokal; keeper terpisah di secret; tidak ada kunci di web/CI selain secret keeper |

## 7. Jadwal (deadline 1 Okt 23:59 SGT)

| Tanggal | Deliverable |
|---|---|
| 20–21 Sep | Plan 3a selesai: pool A/B live, board 25 Sep & 2 Okt, seed LP, keeper hijau, `DEMO_LOG.md` dengan trade pertama, `Narrative.t.sol` |
| 22–24 Sep | Plan 3b web: snapshot/read, panel, Pages live; 25 Sep: trade wallet |
| **Jum 25 Sep 08:00 UTC** | settlement nyata board pertama (keeper) → `--claim`, log |
| 26–28 Sep | rekam video, paket submission, PRD v1.4, README |
| 29 Sep–1 Okt | buffer, rehearsal runbook, submit (target 30 Sep) |

## 8. Di luar scope
`EquinoxLens`, kalibrator Python §10.2, skew κ (FR-16), `minListingDelta` (FR-20), withdrawal cooldown (FR-37), deploy Arbitrum One, USDG asli, sequencer feed asli, listing permissionless.
