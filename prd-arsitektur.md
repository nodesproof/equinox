# EQUINOX — PRD & TECHNICAL ARCHITECTURE

**Produk:** Equinox — options AMM dengan penetapan harga Black-Scholes sepenuhnya on-chain (Arbitrum Stylus), settlement USDG
**Chain:** Arbitrum Sepolia `421614` (demo) → Arbitrum One `42161` (produksi). Stylus aktif di keduanya.
**Event:** Arbitrum Open House Singapore: Online Buildathon (submission 4 Okt 2026)
**Versi:** 1.3 — 19 September 2026 (v1.2 + pool terimplementasi & diaudit tiga putaran: NAV di-mark pada σ_mark(0), kapital referensi di-lag untuk util/cap, harga tidak pernah menembus mark (INV-15/16), FR-36 diperjelas, strike kelipatan 1 USDG, batas parameter; §8.3 bindPool, §8.6 factory dua-level & batas 24 KB, §13 baris pool terukur, §12 coverage)
**Status:** draft implementasi. Angka model di §6 diverifikasi numerik (Python) dan menjadi vektor uji. Pustaka Rust `bs-math`, program Stylus, dan kontrol Solidity **sudah dibangun, diuji bit-identik, dideploy ke devnode ArbOS 61/Stylus v3, dan diukur** (§13) — V2–V5 dan V10 §18 terverifikasi. Pool (`EquinoxPool`, `EquinoxVolEngine`, `EquinoxOptionToken`, `EquinoxFactory`) sudah dibangun, di-fuzz/invariant (§12), dan dijalankan sebagai dua pool identik (kontrol vs Stylus) di devnode (§13). Alamat feed/USDG dan rubrik juri masih wajib diverifikasi Hari 1.

---

## 0. RINGKASAN EKSEKUTIF

Setiap protokol opsi yang hidup di Arbitrum hari ini memasok volatilitas tersirat (IV) — satu-satunya input Black-Scholes yang tidak dapat diobservasi dan yang menentukan seluruh harga — dari luar chain: oracle IV milik tim, feed Deribit, atau matching engine off-chain. Bukan karena Black-Scholes tidak bisa dihitung di EVM (Lyra v1 melakukannya sejak 2021), melainkan karena **lingkaran kuant lengkap** — harga + Greeks per kuotasi, penyelesaian IV iteratif (3–20 evaluasi), mark-to-market NAV lintas puluhan seri pada setiap aksi LP, realized volatility per observasi — terlalu mahal dan terlalu rapuh untuk ditulis dalam Solidity fixed-point. Setiap tim yang mencoba akhirnya memangkas: memotong ekor distribusi, melarang delta tertentu, atau memindahkan pricing ke server.

Equinox menaruh lingkaran itu kembali on-chain. Pustaka Rust `black_scholes` di Arbitrum Stylus (WASM) menghitung Φ dengan aproksimasi rasional Cody (target error ≤ 1e-12), Black-Scholes + Greeks, implied-vol solver Newton dengan fallback bisection, dan pembaruan EWMA realized vol — dipanggil oleh `EquinoxPool.sol` (EVM) yang memegang USDG, mencetak seri opsi ERC-1155, dan menjamin solvabilitas keras.

Tiga klaim yang dibawa ke juri, semuanya dapat diuji:

1. **Tanpa oracle IV.** σ dihasilkan pool sendiri: EWMA realized vol dari observasi Chainlink yang disimpan on-chain × vol-risk-premium × dampak inventaris. Satu-satunya input eksternal adalah harga spot.
2. **Solvabilitas keras.** Put dijamin `K`; call dijual dengan payout cap `K` (settle `min(S_T − K, K)`) dan dihargai sebagai call spread `C(K) − C(2K)`. Invariant: pool tidak pernah berutang lebih dari cadangan. Untuk tenor ≤ 30 hari pada σ ≤ 60%, biaya cap bagi pembeli < 0,001% premi (§6.3).
3. **Lingkaran kuant utuh, terukur — dan diukur jujur.** Dua implementasi bit-identik — `BlackScholesSol.sol` (Solidity/PRBMath) dan `bs-math` (Rust/Stylus) — diuji terhadap 1.250 vektor dan diukur apples-to-apples di devnode (§13). Hasil: Stylus **2,6–2,9× lebih murah** pada lingkaran (IV solver 20 iterasi 250k vs 617k gas; MtM 32 seri 454k vs 1,24M), **lebih mahal** untuk panggilan tunggal tanpa cache (overhead inisialisasi ~31k gas), dan aritmetika 256-bit per operasi **3× lebih mahal** dari EVM. Bukan 10×. Angka ini adalah bagian dari produk: benchmark Stylus-vs-Solidity untuk matematika kuant fixed-point yang, sepengetahuan penulis, belum pernah dipublikasikan dengan implementasi bit-identik.

**Satu angka yang menjelaskan mengapa IV harus benar.** Pada call ETH 7 hari 5% OTM (S = 4.000, K = 4.200, σ = 60%), salah 10 poin vol berarti salah harga premi **33%** (58,62 → 78,14 USDG); pada ATM, 17%. Oracle IV yang terlambat satu jam saat vol melonjak memindahkan angka itu langsung dari LP ke trader. Equinox tidak punya oracle IV yang bisa terlambat.

---

## 1. SCOPE & DOCUMENT CONTROL

### Di dalam scope (MVP hackathon)
- `black_scholes` (Stylus/Rust): `exp`, `ln`, `sqrt`, Φ, φ, harga & Greeks, capped call, IV solver, EWMA update, batch mark-to-market — stateless, view-only
- `BlackScholesSol.sol`: implementasi kontrol dengan algoritma identik untuk benchmark gas & test Foundry murni
- `EquinoxPool.sol`: vault ERC-4626 USDG + AMM (buy/close), board & seri, cadangan, settlement Eropa cash-settled, claim
- `EquinoxOptionToken.sol`: ERC-1155, satu id per seri
- `EquinoxVolEngine.sol`: state σ (EWMA, VRP, dampak inventaris, spread, batas)
- `EquinoxFactory.sol`, `EquinoxLens.sol`, `MockUSDG`, `MockFeed`
- Vektor uji Python (presisi double) + kalibrator parameter (λ, VRP)
- Demo harness dua pool (kontrol vs Stylus) dengan tabel gas & presisi

### Di luar scope
- Delta hedging pool (perps). LP menanggung eksposur arah secara sadar, dibatasi utilisasi & vega cap
- Opsi Amerika, physical settlement, multi-underlying, portfolio margin
- Trader membuka posisi short (menjual ke pool) — hanya `buy` & `close`
- Orderbook, RFQ, governance/token, komponen AI
- Opsi atas tokenized equity (butuh rezim sesi pasar — lihat Vigil; jalur ekspansi, bukan MVP)

### Prior art yang harus disebut di pitch (jangan disembunyikan)
| Hal | Sudah ada | Klaim Equinox yang sah |
|---|---|---|
| Black-Scholes on-chain di Solidity | **Lyra v1** (Optimism, 2021): BS + Greeks fixed-point presisi tinggi, IV AMM (`baseIV` × `skew` bergerak per trade), hedging via Synthetix, perdagangan dibatasi rentang delta | Equinox tidak menemukan on-chain BS. Mekanisme dampak-inventaris pada IV **dikreditkan ke Lyra**. Yang baru: σ_base endogen (realized vol on-chain), IV solver & MtM NAV on-chain, solvabilitas keras tanpa hedger |
| Pindah ke off-chain karena biaya/kekakuan EVM | **Lyra v2 → Derive** (orderbook off-chain, settlement on-chain) | Stylus membalik tekanan desain itu — tesis inti dokumen ini |
| Options venue di Arbitrum dengan IV off-chain | **Premia v3** (oracle vol milik tim), **Stryke/Dopex CLAMM**, **Rysk**, **Moby** — sepengetahuan penulis semuanya memasok IV dari luar chain (**verifikasi status terkini Hari 1, V13**) | Equinox: nol input IV eksternal |
| Opsi tanpa Black-Scholes | **Panoptic** (perpetual options atas LP Uniswap v3), **Hegic** (harga tetap) | Instrumen berbeda; bukan pembanding langsung |
| Pustaka matematika Stylus | Contoh resmi Stylus & pustaka fixed-point komunitas (cek Hari 1, V12) | Jika ada `exp`/`ln` teruji, pakai & kreditkan; nilai Equinox ada di Φ presisi tinggi, solver, batch MtM, dan AMM-nya |

---

## 2. PROBLEM STATEMENT

### 2.1 Mekanisme yang menciptakan masalah

| Kode | Fakta | Implikasi |
|---|---|---|
| P1 | EVM tidak punya `exp`, `ln`, `erf` native; semuanya rutin fixed-point (PRBMath: ~2–5k gas per fungsi) dengan presisi 1e-18 tetapi tanpa jaminan error ekor | Satu evaluasi BS Solidity ≈ 20–60k gas tergantung presisi Φ (estimasi; diukur di §13 baris 2). **Murah untuk satu kuotasi**, mahal jika diulang |
| P2 | Implied vol tidak punya bentuk tertutup; butuh root-finding iteratif | 3–20 evaluasi BS per solve (diverifikasi §6.5). Newton polos **gagal** untuk deep-OTM tanpa bracketing |
| P3 | NAV vault opsi yang jujur = aset − nilai wajar kewajiban terbuka | N evaluasi BS per deposit/withdraw LP, N = jumlah seri terbuka (≤ 32 di MVP) |
| P4 | Realized volatility butuh `ln` per observasi harga dan `exp` untuk peluruhan EWMA | Tanpa ini σ_base harus datang dari admin/oracle |
| P5 | Konsekuensi di lapangan: protokol Solidity memangkas lingkaran ini — IV dari oracle off-chain (Premia, Stryke, Rysk, Moby), rentang delta dibatasi (Lyra v1), atau pricing dipindah seluruhnya ke server (Lyra v2/Derive) | Setiap pemangkasan = titik kepercayaan baru atau produk yang lebih sempit |
| P6 | Stylus: WASM berbagi state & ABI dengan EVM, dipanggil lewat `CALL`/`STATICCALL` biasa. **Terukur (§13):** alur kontrol/loop/ABI jauh lebih murah, tetapi aritmetika 256-bit (`I256` via ruint) **3× lebih mahal** per operasi daripada `MUL`/`DIV` EVM (105 vs ~35 gas per pasangan mul+div); `i128` setara EVM (29); `u64` ~0,5 | Lingkaran kuant lengkap tinggal on-chain **tanpa mengubah arsitektur EVM pool**, 2,6–2,9× lebih murah pada solver & MtM — bukan 10×. Klaim dokumentasi "10× komputasi" berlaku untuk aritmetika lebar-sempit, bukan fixed-point 256-bit |

### 2.2 Konsekuensi ekonomi
IV adalah satu-satunya input BS yang tidak dapat diobservasi. Siapa pun yang mengendalikannya mengendalikan transfer nilai antara LP dan trader. Oracle IV yang terlambat saat vol melonjak menjual opsi terlalu murah (LP rugi); yang terlambat saat vol turun menjualnya terlalu mahal (tidak ada volume). Dengan sensitivitas 17–33% premi per 10 poin vol (§6.7), latensi oracle bukan detail teknis — ia adalah PnL.

### 2.3 Bukti bahwa ini nyata, bukan teoretis
- **Lyra v2/Derive** meninggalkan AMM on-chain untuk orderbook off-chain — tim dengan implementasi BS Solidity paling matang menyimpulkan model on-chain tidak cukup fleksibel/murah.
- **Premia v3** mengoperasikan oracle volatilitas sendiri; pengguna mempercayai IV yang dipublikasikan tim.
- **Lyra v1** melarang perdagangan di luar rentang delta tertentu — pengakuan implisit bahwa ekor distribusi tidak dipercaya di Solidity.
- Volume opsi on-chain tetap sebagian kecil dari Deribit. **Verifikasi angka terkini Hari 1; jangan mengutip angka dari ingatan.**

### 2.4 Klaim yang HARUS tetap ditolak (jangan masuk pitch)
| Klaim (ada di draft lama) | Status | Versi yang jujur |
|---|---|---|
| "Black-Scholes murni di EVM menghabiskan gas limit blok" | **Salah** — Lyra 2021; satu evaluasi ≈ 20–60k gas | "Satu evaluasi murah; **lingkaran** (solver + MtM + Greeks + EWMA) yang mahal dan rapuh" |
| "Evaluasi dalam milidetik" | Tidak relevan — latensi ditentukan blok, bukan WASM | Hapus |
| "Ink lebih murah dari gas" | Salah kaprah — `1 gas = 10.000 ink` hanya konversi unit metering | "Penghematan datang dari eksekusi WASM yang lebih efisien, dan diukur dalam gas" |
| "Tanpa oracle sama sekali" | Salah — spot tetap Chainlink | "Tanpa oracle **IV**" |
| "Aproksimasi Φ Solidity (A&S 26.2.17) menghancurkan harga ekor" | **Salah** — error relatif < 1% hingga d = −6 (diverifikasi §6.7) | "Masalah ekor di praktik adalah truncation & pemangkasan karena gas (Φ := 0 di bawah ambang, rentang delta dilarang), bukan A&S per se" |
| "Stylus membuat Black-Scholes 10× lebih murah" | **Salah** — terukur 2,6–2,9× pada lingkaran, < 1× untuk panggilan tunggal tanpa cache (§13). EVM native 256-bit; ruint di WASM memakai limb 64-bit | "Stylus 2,6–2,9× lebih murah pada solver & MtM batch, diukur bit-identik; keuntungannya dari alur kontrol, bukan aritmetika" |

Baris terakhir penting: versi awal dokumen ini sendiri mengasumsikan argumen presisi; angkanya tidak mendukung. Argumen yang bertahan adalah **iterasi × cakupan on-chain × determinisme**, bukan presisi semata.

---

## 3. GOALS & NON-GOALS

### Goals
| G | Tujuan | Ukuran keberhasilan (demo) |
|---|---|---|
| G1 | Seluruh penetapan harga on-chain, nol input IV eksternal | Trace transaksi `buy()` tidak memuat input selain spot Chainlink dan state pool |
| G2 | Solvabilitas keras | INV-1..3 lulus fuzz ≥ 50k run; skenario S_T = 2,25× strike tetap membayar penuh |
| G3 | Kualitas numerik terukur | Stylus vs vektor Python: Φ ≤ 1e-12 absolut, harga ≤ 1e-9 relatif pada grid domain |
| G4 | Lingkaran kuant terjangkau & terukur jujur | Gas Stylus vs kontrol Solidity tercetak dari pengukuran (§13): ≥ 2,5× pada `impliedVol` dan `markPortfolio`; panggilan tunggal dilaporkan apa adanya (lebih mahal tanpa cache) |
| G5 | Jalan keluar tidak pernah bisa diblokir oleh admin | `close`, `claim`, `withdraw` (likuiditas bebas) tetap jalan saat trading dijeda; `claim` dan `withdraw` (NAV konservatif) tetap jalan saat oracle stale atau program Stylus tidak aktif |
| G6 | Gagal secara konservatif | Oracle stale / sequencer down → kuotasi revert, settlement menunggu; tidak ada harga salah yang tereksekusi |

### Non-goals
- Bukan orderbook, bukan RFQ. Equinox adalah venue bootstrapping untuk modal pasif — orderbook butuh market maker aktif sejak hari pertama.
- Tidak melakukan delta hedging. LP menanggung risiko arah secara sadar (seperti setiap DOV); dibatasi utilisasi & vega cap. Hedger perps adalah jalur produksi, bukan MVP.
- Tidak ada komponen AI. **Jangan tambahkan** — melemahkan produk kuant di mata juri yang menilai kualitas kontrak.
- Tidak mengklaim model ekor benar: lognormal salah di ekor. Mitigasinya premium floor & batas listing, bukan klaim presisi.

---

## 4. PERSONA & USER STORIES

### Persona
| # | Persona | Kebutuhan |
|---|---|---|
| U1 | **LP USDG** (vol seller pasif) | Yield premi dengan harga yang tidak bergantung pada oracle IV siapa pun; batas kerugian yang jelas |
| U2 | **Pemegang ETH** (hedger) | Put 7 hari yang harganya bisa diverifikasi dari state on-chain |
| U3 | **Trader spekulatif** | Konveksitas murah tenor pendek; deep-OTM tidak dilarang, hanya dihargai |
| U4 | **Integrator** (vault terstruktur, margin engine seperti Praetor) | Pustaka `black_scholes` Stylus yang teruji + token seri ERC-1155 yang bisa dikomposisi |
| U5 | **Keeper/searcher** | Bounty untuk `poke()` dan `settle()` |

### User stories
- **US-1 (U1):** Sebagai LP saya ingin NAV yang sudah memperhitungkan nilai wajar seluruh opsi terbuka, agar deposit/withdraw saya tidak disnipe oleh yang tahu lebih dulu.
- **US-2 (U1):** Sebagai LP saya ingin tahu batas kerugian maksimum pool pada setiap saat (`reserved`), bukan estimasi.
- **US-3 (U2):** Sebagai hedger saya ingin membeli put dan mengklaim pembayaran USDG setelah expiry tanpa pihak ketiga.
- **US-4 (U3):** Sebagai trader saya ingin harga naik saat saya membeli besar (dampak inventaris) dan turun saat saya menutup — dan tahu spread-nya di muka.
- **US-5 (U4):** Sebagai integrator saya ingin memanggil `quote()` dan `impliedVol()` dari kontrak saya sendiri lewat interface Solidity biasa.
- **US-6 (semua):** Sebagai siapa pun saya ingin bisa keluar: close/claim/withdraw meski trading dijeda; claim/withdraw meski oracle mati atau program matematika tidak aktif.

---

## 5. FUNCTIONAL REQUIREMENTS

### 5.1 Pustaka matematika (Stylus)
| ID | Requirement | Prioritas |
|---|---|---|
| FR-1 | `black_scholes` MUST stateless (tanpa storage); seluruh fungsi MUST `view`, dipanggil via `STATICCALL` | P0 |
| FR-2 | Aritmetika MUST fixed-point integer deterministik (WAD 1e18); **tidak ada float** | P0 |
| FR-3 | `normCdf` MUST memenuhi \|Φ − Φ_ref\| ≤ 1e-12 pada x ∈ [−8, 8] dan Φ(x) + Φ(−x) = 1 ± 1e-15 | P0 |
| FR-4 | `quote` MUST mengembalikan harga, delta, gamma, vega, theta dalam satu panggilan | P0 |
| FR-5 | `cappedCall` MUST menghitung `C(K) − C(cap)` beserta delta/vega gabungannya | P0 |
| FR-6 | `impliedVol` MUST konvergen (\|ΔP\| ≤ max(1e-8·target, 1e-14·S) — relatif untuk harga mikro) dalam ≤ 40 iterasi pada seluruh domain dengan bracketing + bisection fallback; MUST mengembalikan jumlah iterasi | P0 |
| FR-7 | `ewmaUpdate` MUST menerima Δt tak beraturan (peluruhan `λ^(Δt/1 hari)`) | P0 |
| FR-8 | `markPortfolio` MUST menghitung Σ OI_i × mid_i dan Σ OI_i × vega_i untuk ≤ 32 seri dalam **satu** panggilan lintas-VM | P0 |
| FR-9 | Input di luar domain (§6.6) MUST revert dengan error bertipe, bukan clamp diam-diam | P0 |
| FR-10 | Setiap fungsi publik MUST punya padanan di `BlackScholesSol.sol` dengan algoritma identik | P0 |

### 5.2 Mesin volatilitas
| ID | Requirement | Prioritas |
|---|---|---|
| FR-11 | σ_base MUST diturunkan dari EWMA log-return observasi Chainlink yang disimpan on-chain; tidak ada input σ dari admin/oracle di jalur kuotasi | P0 |
| FR-12 | `poke()` MUST permissionless; MUST mengabaikan observasi dengan `roundId` lama atau Δt < `MIN_OBS_INTERVAL` | P0 |
| FR-13 | σ_mark MUST = σ_base × VRP × (1 + α × util_vega), dihitung pada state **setelah** trade; `util_vega` memakai **kapital referensi yang di-lag** (`min(kapital live, snapshot berumur ≥ 1 hari)`), bukan kas live — lihat §8.4 "Kapital referensi" | P0 |
| FR-14 | Harga beli MUST memakai σ_mark × (1 + s) dan harga tutup σ_mark × (1 − s), s > 0 (arah spread mengikuti tanda vega unit pada σ_mark(0) — capped call dekat K = S/2 pada σ tinggi bervega negatif); **per unit, harga beli MUST ≥ harga pada σ_mark(0) dan harga tutup MUST ≤ harga pada σ_mark(0)** — pool tidak pernah bertransaksi menembus mark NAV-nya sendiri (INV-15, INV-16) | P0 |
| FR-15 | σ MUST di-clamp ke [σ_min, σ_max]; parameter MUST punya batas keras & rate limit perubahan | P0 |
| FR-16 | Skew per strike `1 + κ·ln(K/S)²` | P1 |

### 5.3 Pool, board, seri
| ID | Requirement | Prioritas |
|---|---|---|
| FR-17 | Pool MUST ERC-4626 atas USDG; `totalAssets = saldo − escrowedPayouts − markPortfolio(σ_mark(0))` — MtM pada σ_base × VRP **tanpa** dampak inventaris (D8 direvisi) | P0 |
| FR-18 | Seri MUST direpresentasikan ERC-1155 (`id = keccak(pool, expiry, strike, isCall)`); mint/burn hanya oleh pool | P0 |
| FR-19 | Board MUST punya expiry di grid (Jumat 08:00 UTC), tenor ≤ 30 hari; strike dalam [0,5·S, 2·S] saat listing; ≤ 32 seri terbuka per pool; strike MUST kelipatan 1 USDG (`K % 1e18 == 0`) agar pelepasan cadangan saat settle eksak | P0 |
| FR-20 | Listing MUST menolak seri dengan \|Δ\| < `minListingDelta` | P1 |

### 5.4 Trading
| ID | Requirement | Prioritas |
|---|---|---|
| FR-21 | `buy(series, size, maxPremium)` MUST menagih premi USDG (pembulatan ke atas), mencetak ERC-1155, menambah `reserved += K × size` | P0 |
| FR-22 | `close(series, size, minProceeds)` MUST membakar token, membayar harga tutup (pembulatan ke bawah), mengurangi `reserved` | P0 |
| FR-23 | Premi MUST ≥ `minPremiumBps × K × size` (floor risiko model ekor) | P0 |
| FR-24 | `buy` MUST revert jika `reserved_after > maxUtilBps × kapital referensi (FR-13)` atau `netVega_after > vegaCap` | P0 |
| FR-25 | Fee `feeBps` atas premi MUST diteruskan ke treasury; spread MUST tinggal di pool (LP) | P0 |
| FR-26 | Kuotasi MUST revert jika spot stale (> heartbeat × `staleMult`) atau sequencer down / dalam grace period | P0 |

### 5.5 Settlement
| ID | Requirement | Prioritas |
|---|---|---|
| FR-27 | `settle(board)` MUST permissionless, hanya setelah `expiry`, memakai observasi Chainlink pertama dengan `updatedAt ≥ expiry` yang dilihat kontrak | P0 |
| FR-28 | Payout call MUST = `min(max(S_T − K, 0), K)`; put = `max(K − S_T, 0)` per unit | P0 |
| FR-29 | Pada settle: `reserved −= OI × K`; `escrowedPayouts += OI × payout`; sisanya otomatis kembali ke LP | P0 |
| FR-30 | `claim(series, amount)` MUST membakar token dan membayar dari escrow; MUST tidak pernah bisa dijeda | P0 |
| FR-31 | Bounty settle MUST dibayar dari premi terkumpul (kecil, tetap) | P1 |

### 5.6 Akuntansi LP & keamanan
| ID | Requirement | Prioritas |
|---|---|---|
| FR-32 | `withdraw` MUST dibatasi `freeLiquidity = saldo − escrowed − reserved` | P0 |
| FR-33 | Owner MUST hanya bisa menjeda `buy` dan listing — **tidak pernah** `close`, `claim`, `withdraw`, `settle` | P0 |
| FR-34 | Alamat `math` MUST immutable per pool; reaktivasi program Stylus permissionless | P0 |
| FR-35 | Semua konversi WAD ↔ 6 desimal MUST membulatkan ke arah pool (premi ke atas, payout/proceeds ke bawah) | P0 |
| FR-36 | Saat oracle stale atau panggilan `math`/`vol` gagal (program tidak aktif), `withdraw`/`redeem` MUST tetap jalan memakai NAV konservatif (`saldo − escrowed − reserved`); `deposit`/`mint` MUST revert — `OracleStale` saat spot stale, `MathUnavailable` saat `vol`/`math` gagal selama ada seri terbuka; `close`, `claim`, `settle` MUST tidak pernah diblokir oleh kegagalan `vol.poke()` (dibungkus try/catch) | P0 |
| FR-37 | Withdrawal cooldown (request → claim) | P1 |

---

## 6. SPESIFIKASI MODEL HARGA

Ini inti produk. Bagian ini yang tidak bisa disalin tim lain dalam 48 jam — bukan rumusnya (ada di buku Hull), melainkan pustaka yang teruji terhadap vektor, solver yang terbukti konvergen di seluruh domain, dan invariant solvabilitas yang mengikat semuanya. Semua angka di bagian ini dihasilkan skrip Python presisi double (`math.erfc`) dan menjadi vektor uji.

### 6.1 Notasi
| Simbol | Arti | Representasi on-chain |
|---|---|---|
| `S` | spot ETH dalam USDG | WAD (1e18) dari Chainlink 8 desimal |
| `K` | strike | WAD |
| `T` | waktu ke expiry, tahun | `detik × 1e18 / 31.536.000` (WAD) |
| `σ` | volatilitas tahunan | WAD (0,60e18 = 60%) |
| `r` | suku bunga bebas risiko | WAD, default 0 |
| `Φ`, `φ` | CDF, PDF normal standar | WAD |
| `OI_i` | open interest seri i (unit = 1 ETH notional) | WAD |
| `util_vega` | `netVega / vegaCap` | WAD ∈ [0, 1] |

### 6.2 Black-Scholes & Greeks

```
d1 = [ ln(S/K) + (r + σ²/2)·T ] / (σ√T)
d2 = d1 − σ√T
C  = S·Φ(d1) − K·e^(−rT)·Φ(d2)
P  = K·e^(−rT)·Φ(−d2) − S·Φ(−d1)              (identik dengan C − S + K·e^(−rT))

Δ_call = Φ(d1)          Δ_put = Φ(d1) − 1
Γ      = φ(d1) / (S·σ√T)
Vega   = S·φ(d1)·√T                             (per 1,00 vol; ÷100 untuk per poin)
Θ_call = −S·φ(d1)·σ / (2√T) − r·K·e^(−rT)·Φ(d2)     (per tahun; ÷365 untuk per hari)
```

Put-call parity diuji sebagai invariant (INV-7), bukan diasumsikan.

### 6.3 Capped call — keputusan solvabilitas

Pool hanya memegang USDG. Put dijamin `K` per unit. Call cash-settled tanpa cap punya kewajiban tak terbatas → tidak bisa dijamin pool stablecoin tanpa hedger. Keputusan D4: **payout call = `min(S_T − K, K)`**, cadangan `K` per unit — simetris dengan put. Harganya call spread:

```
C_capped(K) = C(K) − C(2K)
Δ_capped    = Φ(d1(K)) − Φ(d1(2K))
Vega_capped = Vega(K) − Vega(2K)
```

Biaya cap bagi pembeli (S = 4.000, r = 0):

| K | σ | T | C(K) | C(2K) | Diskon cap |
|---|---|---|---|---|---|
| 4.200 | 60% | 7 h | 58,6239 | 0,000000 | 0,00000% |
| 4.000 | 60% | 7 h | 132,5559 | 0,000000 | 0,00000% |
| 4.200 | 60% | 30 h | 192,2098 | 0,001693 | 0,00088% |
| 4.000 | 100% | 30 h | 455,9308 | 4,1463 | 0,909% |
| 4.000 | 150% | 30 h | 680,9878 | 54,0501 | 7,94% |

Untuk tenor MVP (≤ 30 hari) pada vol ETH normal, cap **ekonomis tak terlihat**, tetapi memberi invariant solvabilitas yang bisa dibuktikan. Pada rezim vol ekstrem cap mulai terasa — dan justru di rezim itulah pool tanpa hedger memang tidak boleh menjual call tanpa batas. Sebutkan ini apa adanya; jangan sembunyikan dari UI.

### 6.4 Mesin volatilitas

**σ_base — EWMA realized vol on-chain (FR-11).** Setiap observasi Chainlink baru `(P_t, t)`:

```
r        = ln(P_t / P_prev)
Δt_hari  = (t − t_prev) / 86.400
w        = λ^(Δt_hari) = exp(Δt_hari · ln λ)
var_t    = w · var_prev + (1 − w) · r² / (Δt_hari / 365)
σ_base   = clamp( √var_t , σ_min , σ_max )
```

Contoh (λ = 0,94/hari, var awal = 55%², observasi tak beraturan):

| t (hari) | P | r | vol sesaat | σ_base (EWMA) |
|---|---|---|---|---|
| 0,25 | 4.020 | +0,00499 | 19,06% | 54,63% |
| 0,50 | 3.960 | −0,01504 | 57,46% | 54,67% |
| 1,00 | 4.100 | +0,03474 | 93,87% | 56,27% |
| 1,50 | 4.080 | −0,00489 | 13,21% | 55,45% |
| 2,00 | 3.900 | −0,04512 | 121,91% | 58,60% |

EWMA sengaja lamban (λ = 0,94 ≈ memori efektif 16 hari). Reaksi cepat terhadap permintaan datang dari suku berikutnya, bukan dari σ_base.

**σ_mark — VRP × dampak inventaris (FR-13; mekanisme dikreditkan ke Lyra v1):**

```
netVega   = Σ_i vegaAcc_i                         (USDG per 1,00 vol; vega yang dibukukan saat trade, pool short → positif)
vegaCap   = kapitalReferensi · vegaCapBps / 1e4   (kapitalReferensi = min(kas − escrow live, snapshot ≥ 1 hari) — §8.4)
util_vega = clamp( netVega_setelah_trade / vegaCap , 0 , 1 )
σ_mark(u) = clamp( σ_base · VRP · (1 + α · u) , σ_min , σ_max )
σ_buy     = σ_mark(util_after) · (1 + s)          σ_close = σ_mark(util_after) · (1 − s)     (tanda s dibalik bila vega unit pada σ_mark(0) < 0)
p_buy     = max( p(σ_buy) , p(σ_mark(0)) )        p_close = min( p(σ_close) , p(σ_mark(0)) )  (klem ke mark — FR-14, INV-15/16)
```

`util_after` dihitung satu lintasan dengan vega unit pada σ_mark(0) (aproksimasi orde pertama; tidak perlu iterasi titik tetap). Yang dibukukan ke `netVega`/`vegaAcc` adalah vega pada σ_buy (umumnya lebih besar untuk seri OTM/ITM — konservatif untuk cap; untuk ATM praktis sama), dilepas pro-rata (`vegaAcc × size / oi`) saat close dan seluruhnya saat settle. Vega unit negatif dibukukan 0, sehingga `netVega` mengabaikan OI bervega negatif — konservatif (eksposur pool tidak pernah dianggap lebih kecil dari yang sebenarnya).

Contoh (σ_base 55%, VRP 1,15, α 0,30; call K = 4.200, 7 hari):

| util_vega | σ_mark | C(4.200, 7 h) |
|---|---|---|
| 0,0 | 63,25% | 64,87 |
| 0,2 | 67,05% | 72,28 |
| 0,5 | 72,74% | 83,62 |
| 0,8 | 78,43% | 95,17 |

Pembeli besar menaikkan harga bagi dirinya sendiri (dihitung pada state pasca-trade) dan bagi pembeli berikutnya; penutupan menurunkannya. Spread `s` menjamin tidak ada round-trip gratis (INV-9).

**Klem ke mark (R3-a; FR-14, INV-15/16).** Dengan p0 = harga pada σ_mark(0) — σ yang dipakai NAV (§8.4) — pool tidak pernah menjual di bawah p0 dan tidak pernah membeli balik di atas p0, sehingga setiap `buy`/`close` menaikkan atau mempertahankan NAV. Biayanya, dinyatakan apa adanya: di atas `util > s/(α(1−s))` ≈ 17,5 % (α 0,3; s 5 %) penutupan dibayar mid p0 — pool tidak lagi mengutip spread sisi tutup, artinya tidak lagi membayar premi untuk penutupan yang mengurangi risikonya. Trader bermodal A yang sekaligus menjadi LP hanya bisa merebut kembali porsi `f = A/(A + TVL)` dari markup sisi beli lewat deposit→buy→redeem; kerugiannya tetap ≥ `(1 − f) · markup + fee`. Keunggulan LP yang terjamin adalah VRP di σ_mark(0), theta, dan spread sisi beli.

### 6.5 Implied-vol solver

Dipakai untuk (a) `impliedVol()` publik bagi integrator/UI dan (b) P1: mark IV dari harga trade terakhir. Newton polos **gagal** untuk deep-OTM: dari seed Brenner-Subrahmanyam, vega mendekati nol → langkah meledak → macet di clamp bawah (diverifikasi: put K = 3.000 dan call K = 5.200 tidak konvergen dalam 50 iterasi). Spesifikasi wajib:

```
seed = clamp( √(2π/T) · price/S , lo , hi )          lo = 1%, hi = 500%
loop ≤ 40:
  tol  = max(target/1e8, S/1e14)          (toleransi absolut 1e-10·S terlalu longgar untuk harga mikro: σ meleset 2,6e-4 pada P 2.600)
  diff = BS(σ) − target ;  jika |diff| ≤ tol → selesai
  perbarui bracket: diff > 0 → hi = σ ; selain itu lo = σ
  cand = σ − diff / Vega(σ)
  σ    = cand  jika lo < cand < hi dan Vega > 1e-9 ; selain itu (lo + hi)/2
```

Hasil terverifikasi (S = 4.000, T = 7 h):

| Seri | σ_true | Harga | Iterasi (Newton / bisect) |
|---|---|---|---|
| C 4.200 | 60% | 58,6239 | 5 (4 / 0) |
| P 4.000 | 60% | 132,5559 | 2 (1 / 0) |
| P 3.000 | 60% | 0,0195 | 13 (11 / 1) |
| C 5.200 | 60% | 0,0820 | 12 (10 / 1) |
| P 2.600 | 60% | 0,000005 | 20 (18 / 1) |
| C 4.200 | 120% | 183,0939 | 4 (3 / 0) |
| C 4.200 | 30% | 10,0650 | 7 (5 / 1) |
| C 6.000 | 60% | 0,000041 | 19 |
| P 2.000 30 h | 60% | 0,0030 | 15 |

(Iterasi = implementasi WAD integer, identik di Rust, Solidity, dan Python; σ dipulihkan ≤ 3e-9 relatif di semua kasus.)

Rentang **3–20 evaluasi BS per solve** adalah angka yang dipakai di §2.1 (P2) dan §13. Alternatif produksi: Jäckel "Let's Be Rational" (≤ 2 iterasi, jauh lebih rumit) — tidak untuk MVP.

### 6.6 Numerik

| Komponen | Algoritma | Presisi target |
|---|---|---|
| `exp`, `ln` | Port PRBMath SD59x18 (`exp2` via 192.64, `log2` biner iteratif) ke Rust `I256` | ≤ 1e-18 relatif pada domain PRBMath |
| `sqrt` | Babylonian `U256` atas `x · 1e18` | eksak (floor) |
| `Φ` | **Cody (1969)** erf/erfc rasional Chebyshev, tiga rentang (\|x\| < 0,5; 0,5–4; > 4); `Φ(x) = ½·erfc(−x/√2)` | ≤ 1e-12 absolut dalam WAD (double: ~1e-16) |
| `φ` | `exp(−x²/2) / √(2π)` | mengikuti `exp` |
| Domain | `S, K ∈ [1e-6, 1e12]·WAD`; `T ∈ [60 s, 365 h]`; `σ ∈ [1%, 500%]`; `\|d\| > 8` → Φ = 0/1 tanpa revert; input di luar batas → revert (FR-9) | — |
| Perkalian | checked_mul 256-bit lalu bagi — cukup karena domain membatasi \|a·b\| < 2^255 (analisis §9.5); tidak perlu intermediate 512-bit | tanpa overflow diam-diam |
| Pembulatan | premi ↑, proceeds/payout ↓; konversi WAD → 6 desimal di boundary pool | FR-35 |

Kenapa bukan A&S 26.2.17 (yang lazim di Solidity)? Bukan karena presisinya buruk (§6.7 menunjukkan < 1% relatif sampai d = −6), melainkan karena di Stylus **tidak ada alasan gas** untuk memilih 1e-7 ketika 1e-15 tersedia dengan biaya yang tidak lagi menentukan desain. Kontrol `BlackScholesSol.sol` memakai algoritma yang **sama** (Cody) agar perbandingan gas apples-to-apples; harga kedua implementasi harus sepakat ≤ 1e-9 relatif (INV-12).

### 6.7 Contoh terhitung — angka yang menjual produk ini

Semua: S = 4.000, T = 7 hari, r = 0, σ = 60%, per 1 ETH notional.

**Kuotasi & Greeks**

| Seri | Harga | d1 | d2 | Δ | Γ | Vega/poin | Θ/hari |
|---|---|---|---|---|---|---|---|
| C 4.200 | 58,6239 | −0,5456 | −0,6287 | 0,2927 | 0,001034 | 1,9042 | −8,1610 |
| P 3.800 | 53,0941 | 0,6589 | 0,5758 | −0,2550 | 0,000966 | 1,7787 | −7,6231 |
| C 4.000 | 132,5559 | 0,0415 | −0,0415 | 0,5166 | 0,001199 | 2,2080 | −9,4628 |
| P 4.000 | 132,5559 | 0,0415 | −0,0415 | −0,4834 | 0,001199 | 2,2080 | −9,4628 |
| P 3.000 | 0,0195 | 3,5038 | 3,4207 | −0,0002 | 0,000003 | 0,0048 | −0,0204 |
| C 5.200 | 0,0820 | −3,1160 | −3,1991 | 0,0009 | 0,000009 | 0,0172 | −0,0738 |

Parity: `C(4.200) − P(4.200) = −200,000000 = S − K` ✔

**Sensitivitas terhadap IV — mengapa oracle IV adalah PnL**

| Seri | C @50% | C @60% | C @70% | +10 poin vol | −10 poin vol |
|---|---|---|---|---|---|
| C 4.000, 7 h | 110,47 | 132,56 | 154,63 | **+16,7%** | −16,7% |
| C 4.200, 7 h | 40,22 | 58,62 | 78,14 | **+33,3%** | −31,4% |
| C 4.000, 30 h | 228,55 | 274,16 | 319,71 | +16,6% | −16,6% |

**Presisi ekor: A&S 26.2.17 vs eksak — klaim yang sengaja dilemahkan**

| d | Φ eksak | Φ A&S | err relatif |
|---|---|---|---|
| −2 | 2,275013e-02 | 2,275006e-02 | −0,000% |
| −4 | 3,167124e-05 | 3,168603e-05 | +0,047% |
| −5 | 2,866516e-07 | 2,871050e-07 | +0,158% |
| −6 | 9,865876e-10 | 9,901219e-10 | +0,358% |

Dampak ke harga put deep-OTM (7 h, σ 60%): K = 3.000 → −0,13%; K = 2.600 → −0,76%. **Kecil.** Yang menghancurkan ekor bukan A&S, melainkan truncation: implementasi yang menetapkan `Φ(x) := 0` untuk `x < −4,5` menjual call K = 6.000 (d2 = −4,92) seharga **0** alih-alih 0,000041 — secara ekonomi remeh untuk 7 hari, tetapi ini pola yang membuat protokol Solidity melarang perdagangan ekor sama sekali. Equinox tidak melarang; ia menghargai, lalu memasang `minPremiumBps` sebagai floor risiko model.

**Skenario settlement — 10 call K = 4.200 dijual pada σ_mark 63,25% (mid, tanpa spread: premi 648,68 USDG; cadangan 42.000)**

| S_T | Payout | PnL LP |
|---|---|---|
| 3.800 | 0 | +648,68 |
| 4.300 | 1.000 | −351,32 |
| 4.500 | 3.000 | −2.351,32 |
| 5.000 | 8.000 | −7.351,32 |
| 8.400 (cap) | 42.000 | −41.351,32 |
| 9.000 | 42.000 | −41.351,32 |

Baris terakhir adalah invariant solvabilitas dalam bentuk tabel: kerugian LP dibatasi cadangan, apa pun S_T.

### 6.8 Parameter awal

| Parameter | Nilai awal | Alasan |
|---|---|---|
| `lambdaPerDay` | 0,94 | RiskMetrics; memori ≈ 16 hari |
| `VRP` | 1,15 | IV/RV historis ETH > 1; kalibrasi §10.2 |
| `alpha` | 0,30 | σ_mark +30% pada util_vega = 1 |
| `spread` s | 5% dari σ (multiplikatif) | ≈ 5% premi ATM 7 h (3,2 poin vol × 2,2 USDG/poin); relatif lebih besar untuk OTM |
| `feeBps` | 300 bps atas premi | ke treasury |
| `sigmaMin` / `sigmaMax` | 20% / 300% | batas keras |
| `vegaCapBps` | 500 (5% TVL per 1,00 vol) | MtM loss ≤ 5% TVL per 100 poin vol; ≈ 226 kontrak ATM 7 h per 1 juta USDG |
| `maxUtilBps` | 8.000 (80%) | cadangan ≤ 80% aset bebas escrow |
| `minPremiumBps` | 5 bps × K | floor risiko ekor |
| `MIN_OBS_INTERVAL` | 60 s | abaikan observasi terlalu rapat (konstanta di `EquinoxVolEngine`) |
| `staleMult` | 3 × heartbeat | kuotasi revert jika lebih tua |
| `sequencerGrace` | 1 jam | setelah sequencer kembali |
| `maxOpenSeries` | 32 | batas loop MtM |
| `tenorMax` | 30 hari | |
| `settleBounty` | 2 USDG | dari premi |
| `minListingDelta` | 0,02 | P1 |
| `r` | 0 | crypto; parameter, bukan konstanta |

---

## 7. SYSTEM ARCHITECTURE

```
        OFF-CHAIN                                ON-CHAIN (Arbitrum Sepolia 421614 / One 42161)
 ┌──────────────────────┐
 │ Reference pricer +   │  vektor uji         ┌──────────────────────────────────────┐
 │ kalibrator (Python)  │ ─────────────────►  │  black_scholes  (Stylus / Rust WASM) │
 │ λ, VRP, κ, backtest  │  setParams()        │  stateless, view-only                │
 └──────────────────────┘        │            │  exp ln sqrt Φ φ quote cappedCall    │
                                 │            │  impliedVol ewmaUpdate markPortfolio │
 ┌──────────────────────┐        │            └───────────────▲──────────────────────┘
 │ Keeper (TS)          │ poke() │ settle()                   │ STATICCALL (ABI Solidity)
 │ observasi + expiry   │ ───────┼──────────┐                 │
 └──────────────────────┘        ▼          ▼                 │
                          ┌──────────────────────────┐  ┌─────┴──────────────────────┐
  Chainlink ETH/USD ────► │  EquinoxVolEngine.sol    │  │  EquinoxPool.sol           │
  Sequencer uptime  ────► │  EWMA var, VRP, α, s     │◄─┤  ERC-4626 USDG             │
                          │  σ_base → σ_mark         │  │  board/seri, buy/close     │
                          └──────────────────────────┘  │  reserved, settle, claim   │
                                                        │  NAV = saldo − escrow − MtM│
                          ┌──────────────────────────┐  └─────┬─────────────┬────────┘
                          │  EquinoxOptionToken.sol  │◄───────┘             │
                          │  ERC-1155, id per seri   │  mint/burn           │ USDG (6 dp)
                          └──────────────────────────┘                      ▼
                          ┌──────────────────────────┐              ┌──────────────┐
                          │  EquinoxFactory.sol      │──deploy──►   │  Treasury    │ fee
                          │  registry per underlying │              └──────────────┘
                          └──────────────────────────┘
                          ┌──────────────────────────┐
                          │  BlackScholesSol.sol     │  kontrol: algoritma identik, Solidity/PRBMath
                          │  (Pool A dalam demo)     │  benchmark gas & test Foundry murni
                          └──────────────────────────┘
```

### Prinsip desain
1. **Matematika stateless & immutable; logika di EVM.** Batasnya adalah ABI view-only. Pool tidak tahu apakah ia bicara dengan WASM atau Solidity.
2. **Satu interface, dua implementasi.** `IBlackScholes` ← Stylus (produksi) dan `BlackScholesSol` (kontrol, test). Ini yang membuat test Foundry bisa berjalan tanpa node Stylus (§9.7).
3. **Fail-closed.** Oracle stale / sequencer down / program tidak aktif → tidak ada risiko baru dan tidak ada kuotasi; `claim` dan `withdraw` selalu terbuka pada NAV konservatif yang tidak pernah menguntungkan yang keluar di atas yang tinggal (FR-36).
4. **Solvabilitas by construction.** Cadangan = payout maksimum; kedua sisi (put dan call) terbatas.
5. **Tidak ada input admin di jalur harga.** Parameter dibatasi keras & rate-limited; tidak ada `setSigma()`.
6. **Batch melintasi batas VM.** Satu panggilan `markPortfolio`, bukan 32 — overhead per panggilan lintas-VM diamortisasi.

---

## 8. CONTRACT SPECIFICATIONS

### 8.1 `black_scholes` (Stylus, Rust)

```rust
#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]
extern crate alloc;
use alloc::vec::Vec;
use stylus_sdk::{prelude::*, alloy_primitives::{U256, I256}};

sol_storage! { #[entrypoint] pub struct BlackScholes {} }   // tanpa state (FR-1)

#[public]
impl BlackScholes {
    pub fn exp(&self, x: I256) -> Result<U256, Vec<u8>>;
    pub fn ln(&self, x: U256) -> Result<I256, Vec<u8>>;
    pub fn sqrt(&self, x: U256) -> Result<U256, Vec<u8>>;
    pub fn norm_cdf(&self, x: I256) -> Result<U256, Vec<u8>>;
    pub fn norm_pdf(&self, x: I256) -> Result<U256, Vec<u8>>;

    pub fn price(&self, s: U256, k: U256, t: U256, sigma: U256, r: I256, is_call: bool)
        -> Result<U256, Vec<u8>>;
    /// (price, delta, gamma, vega, theta) — semua WAD
    pub fn quote(&self, s: U256, k: U256, t: U256, sigma: U256, r: I256, is_call: bool)
        -> Result<(U256, I256, U256, U256, I256), Vec<u8>>;
    /// (price, delta, vega) untuk C(k) − C(cap); vega bisa negatif untuk deep-ITM → I256
    pub fn capped_call(&self, s: U256, k: U256, cap: U256, t: U256, sigma: U256, r: I256)
        -> Result<(U256, I256, I256), Vec<u8>>;
    /// (sigma, iterasi) — Newton + bracket + bisection (§6.5)
    pub fn implied_vol(&self, target: U256, s: U256, k: U256, t: U256, r: I256,
                       is_call: bool, lo: U256, hi: U256) -> Result<(U256, u8), Vec<u8>>;
    pub fn ewma_update(&self, var_prev: U256, p_prev: U256, p_now: U256,
                       dt_seconds: U256, lambda_per_day: U256) -> Result<U256, Vec<u8>>;
    /// (Σ OI·mid, Σ OI·vega) — satu panggilan untuk ≤ 32 seri (FR-8); Σ vega bisa negatif → I256
    pub fn mark_portfolio(&self, s: U256, r: I256, sigma: U256, cap_mult: U256,
                          k: Vec<U256>, t: Vec<U256>, is_call: Vec<bool>, oi: Vec<U256>)
        -> Result<(U256, I256), Vec<u8>>;
}
```

- `cargo stylus export-abi` menghasilkan `IBlackScholes.sol`; SDK memetakan `norm_cdf` → `normCdf` (selector memakai nama camelCase — `cast call ... "norm_cdf(...)"` akan revert kosong).
- Error bertipe (`SolidityError`): `OutOfDomain(uint8 arg)`, `NoConvergence(uint8 iters)`, `LengthMismatch()`.
- Semua fungsi menerima `&self` → `view`; program tanpa storage → aktivasi murah, footprint memori kecil.
- Reentrancy: fitur `reentrant` SDK **tidak** diaktifkan (default). Tidak ada panggilan keluar dari program.
- Struktur: crate murni `bs-math` (`no_std`, hanya `alloy-primitives`; modul `fixed`, `exp`, `ln`, `normal`, `bs`, `solver`, `ewma`, `portfolio`, `constants`) + crate `bs-stylus` (wrapper `#[public]` tipis). Pemisahan ini membuat matematika teruji dengan `cargo test` native tanpa SDK/node, dan crate `bs-math` bisa dipakai proyek lain (Praetor). Test L1: kesetaraan bit-eksak terhadap `tests/vectors_gen.rs` yang dihasilkan `tools/reference/gen_vectors.py`.

### 8.2 `IBlackScholes.sol` + `BlackScholesSol.sol` (kontrol)

```solidity
interface IBlackScholes {
    function normCdf(int256 x) external view returns (uint256);
    function quote(uint256 s, uint256 k, uint256 t, uint256 sigma, int256 r, bool isCall)
        external view returns (uint256 price, int256 delta, uint256 gamma, uint256 vega, int256 theta);
    function cappedCall(uint256 s, uint256 k, uint256 cap, uint256 t, uint256 sigma, int256 r)
        external view returns (uint256 price, int256 delta, int256 vega);
    function impliedVol(uint256 target, uint256 s, uint256 k, uint256 t, int256 r, bool isCall, uint256 lo, uint256 hi)
        external view returns (uint256 sigma, uint8 iters);
    function ewmaUpdate(uint256 varPrev, uint256 pPrev, uint256 pNow, uint256 dtSeconds, uint256 lambdaPerDay)
        external view returns (uint256);
    function markPortfolio(uint256 s, int256 r, uint256 sigma, uint256 capMult,
        uint256[] calldata k, uint256[] calldata t, bool[] calldata isCall, uint256[] calldata oi)
        external view returns (uint256 sumMid, int256 sumVega);
}
```

`BlackScholesSol` mengimplementasikan interface yang sama dengan PRBMath (`exp`, `ln`) + Cody erfc dalam Solidity. Kegunaannya: (1) benchmark gas apples-to-apples, (2) test Foundry fuzz/invariant pool tanpa node Stylus, (3) Rencana B3. Harga harus sepakat dengan Stylus ≤ 1e-9 relatif (INV-12).

### 8.3 `EquinoxOptionToken.sol` (ERC-1155)

```solidity
function seriesId(address pool, uint64 expiry, uint128 strike, bool isCall) external pure returns (uint256);
function mint(address to, uint256 id, uint256 amount) external onlyPool;
function burn(address from, uint256 id, uint256 amount) external onlyPool;
function totalSupply(uint256 id) external view returns (uint256);
function uri(uint256 id) external view returns (string memory);   // metadata seri on-chain
```

`totalSupply(id) == OI(id)` selalu (INV-4), juga setelah settle karena `claim` mengurangi `oi`. Satu token per pool; `pool` diikat sekali lewat `bindPool(address)` oleh deployer-nya (factory) karena alamat pool belum ada saat token dibuat.

### 8.4 `EquinoxPool.sol`

```solidity
struct Config   { uint16 feeBps; uint16 maxUtilBps; uint16 vegaCapBps; uint16 minPremiumBps; uint32 heartbeat; uint8 staleMult;
                  uint32 sequencerGrace; uint8 maxOpenSeries; uint32 tenorMax; uint128 minSize; uint128 settleBounty; }
struct Series   { uint32 boardId; uint64 expiry; uint128 strike; bool isCall; bool settled; uint256 oi; uint256 vegaAcc; uint256 payoutPerUnit; }
struct Board    { uint64 expiry; bool settled; uint256 settlementPrice; uint256[] seriesIds; }
struct Deploy   { address owner; address usdg; address feed; address sequencerFeed; address math; address treasury;
                  Config cfg; EquinoxVolEngine.Params vol; uint256 sigmaSeed; int256 rWad; string name; string symbol; }
struct QuoteOut { uint256 premiumAssets; uint256 feeAssets; uint256 sigma; int256 delta; uint256 vegaTotal; uint256 spotWad; }

uint256 public constant CAP_MULT = 2e18;              // cap call = 2K
uint64  public constant CAPITAL_REF_DELAY = 1 days;   // jendela lag kapital referensi

// LP (ERC-4626; keempatnya nonReentrant, satu evaluasi NAV per panggilan lewat memo transient)
function deposit(uint256 assets, address receiver) external returns (uint256 shares);
function mint(uint256 shares, address receiver) external returns (uint256 assets);
function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);
function totalAssets() public view override returns (uint256);
function maxWithdraw(address owner) public view override returns (uint256);   // min(porsi, freeLiquidity)
function maxRedeem(address owner) public view override returns (uint256);

// Listing (owner, MVP)
function createBoard(uint64 expiry, uint128[] calldata strikes) external onlyOwner returns (uint256 boardId);

// Trading
function quoteBuy(uint256 seriesId, uint256 size) public view returns (QuoteOut memory q);
function quoteClose(uint256 seriesId, uint256 size) public view returns (uint256 proceedsAssets, uint256 sigmaClose, uint256 spotWad);
function buy(uint256 seriesId, uint256 size, uint256 maxPremiumAssets) external nonReentrant returns (uint256 premiumAssets); // batas = premi + fee
function close(uint256 seriesId, uint256 size, uint256 minProceedsAssets) external nonReentrant returns (uint256 proceedsAssets);

// Settlement
function settle(uint256 boardId) external nonReentrant;                                        // permissionless, bounty
function claim(uint256 seriesId, uint256 amount) external nonReentrant returns (uint256 payoutAssets); // tidak pernah bisa dijeda

// Transparansi
function reserved() external view returns (uint256);
function escrowedPayouts() external view returns (uint256);
function freeLiquidity() external view returns (uint256);
function netVega() external view returns (uint256);
function series(uint256 id) external view returns (uint32 boardId, uint64 expiry, uint128 strike, bool isCall, bool settled, uint256 oi, uint256 vegaAcc, uint256 payoutPerUnit);
function board(uint256 boardId) external view returns (uint64 expiry, bool settled, uint256 settlementPrice, uint256[] memory seriesIds); // revert BoardUnknown
function boardCount() external view returns (uint256);
function openSeriesIds() external view returns (uint256[] memory);
function sigmaMarkNow() external view returns (uint256);                     // σ_mark(util saat ini), mid
function spot() external view returns (uint256 priceWad, bool fresh);
function capitalRefPrev() external view returns (uint256);                   // snapshot kapital (kas − escrow) sebelum jendela berjalan
function capitalRefCur() external view returns (uint256);
function capitalRefAt() external view returns (uint64);

// Admin (Ownable2Step)
function pauseTrading(bool) external onlyOwner;                              // hanya buy + createBoard
function setConfig(Config calldata) external onlyOwner;                      // batas keras — lihat "Batas konfigurasi"
function setTreasury(address) external onlyOwner;                            // ≠ 0
```

**Alur `buy`** (`buy` → `quoteBuy`; transkripsi dari kode):
```
0.  _refreshCapitalRef()  — geser snapshot kapital referensi bila jendela 1 hari sudah lewat ("Kapital referensi")
1.  vol.poke()  dalam try/catch — kegagalan di dalam poke (oracle/math) tidak memblokir entry point mana pun (FR-36)
2.  require !tradingPaused ; size ≥ minSize ; seri ada, belum settle, expiry > now + 60 s (blackout pra-expiry)
3.  S = spot segar (FR-26) — revert OracleStale bila stale / sequencer down
4.  T = (expiry − now) sebagai WAD tahun ; σ₀ = vol.sigmaMark(0)
    (p0, ·, vega0) = price(S, K, T, σ₀)      — call: math.cappedCall(S, K, 2K, T, σ, r) ; put: math.quote(S, K, T, σ, r, false)
5.  util_after = clamp((netVega + max(vega0, 0)·size) / (vegaCapBps · kapitalReferensi), 0, 1)
    σ_buy = vol.sigmaMark(util_after) · (1 + s)  bila vega0 ≥ 0 ; · (1 − s) bila vega0 < 0
6.  (p_buy, Δ, V) = price(S, K, T, σ_buy)
7.  p = max(p_buy, p0)                      — klem ke mark (FR-14); σ yang dilaporkan = σ_buy bila p_buy > p0, selain itu σ₀
    premium = max(p·size, minPremiumBps·K·size) → bulatkan ke atas ke 6 desimal ; fee = premium·feeBps/1e4 (ke atas)
    require premium + fee ≤ maxPremiumAssets
8.  kapitalReferensi = min(kas − escrow live, capitalRefPrev)
    require reserved + K·size ≤ maxUtilBps · kapitalReferensi ; require netVega + max(V, 0)·size ≤ vegaCapBps · kapitalReferensi
9.  reserved += K·size ; netVega += max(V, 0)·size ; oi += size ; vegaAcc += max(V, 0)·size
    USDG.transferFrom(trader, pool, premium + fee) ; USDG.transfer(treasury, fee) ; token.mint(trader, id, size)   (CEI)
    emit Bought(id, trader, size, premium, fee, σ_efektif, S)
```

**Alur `close`:** cermin `buy` — `rel = vegaAcc · size / oi` (dibatasi `netVega`); σ_close = σ_mark(util(netVega − rel)) · (1 − s) (· (1 + s) bila vega0 < 0); `p = min(p_close, p0)` — klem ke mark, σ yang dilaporkan = σ₀ bila klem mengikat; proceeds = p·size dibulatkan ke bawah, `require ≥ minProceedsAssets`; `oi −= size`, `vegaAcc −= rel`, `netVega −= rel`, `reserved −= K·size`; burn lalu transfer (CEI). Tidak terpengaruh `tradingPaused`, tidak pernah ditolak util/vega cap; tetap butuh spot segar dan `math` (kuotasi); ditolak dalam blackout 60 s pra-expiry — pemegang menunggu `settle`.

**Alur `settle(boardId)`:**
```
0. _refreshCapitalRef() ; vol.poke() (try/catch)
1. require boardId < boardCount (BoardUnknown) ; !settled (BoardAlreadySettled) ; now ≥ expiry (BoardNotExpired)
2. spot = OracleLib.read(…) ; require spot.fresh && spot.updatedAt ≥ expiry (SettlementNotReady)
   — round segar mana pun pasca-expiry yang ada SAAT dipanggil, bukan "round pertama" secara historis (T2)
3. untuk setiap seri: payout = isCall ? min(max(S_T − K, 0), K) : max(K − S_T, 0)     (_payoutPerUnit — rumus yang sama dengan MtM blackout)
   settled = true ; payoutPerUnit = payout ; escrowed += oi·payout ; reserved −= oi·K ; netVega −= min(netVega, vegaAcc) ; vegaAcc = 0
   hapus dari daftar seri terbuka
4. settlementPrice = S_T ; board.settled = true ; emit Settled(boardId, S_T, Δescrowed, Δreserved)
5. bounty ke msg.sender hanya bila freeLiquidity ≥ settleBounty
```
Sisa `oi·K − oi·payout` otomatis menjadi milik LP karena tidak lagi dikurangkan dari `totalAssets`.

**Alur `claim`:** `require settled` → `oi −= amount` (INV-4 tetap berlaku setelah settle) → `escrowed −= amount·payoutPerUnit` → burn `amount` → transfer (bulatkan ke bawah). Tidak ada pause, tidak ada batas waktu di MVP.

**`totalAssets()` (FR-17, FR-36):**
```
kewajiban (_liabilityWad):
    tidak ada seri terbuka → 0
    oracle segar → seri dengan expiry ≤ now + 60 s (blackout / sudah lewat expiry): intrinsik += oi · payout(S_now, K), oi[i] := 0
                   (mtm, ·) = math.markPortfolio(S, r, σ_mark(0), 2, k[], t[], isCall[], oi[])   — seri lainnya, satu panggilan
                   kewajiban = mtm + intrinsik
    oracle stale, atau staticcall vol/math gagal (try/catch) → kewajiban = reserved  (konservatif)
totalAssets = saldoUSDG − escrowed − min(kewajiban, saldoUSDG − escrowed)
deposit / mint    : revert OracleStale() bila spot stale (juga tanpa seri terbuka) ; revert MathUnavailable() bila jalur konservatif dipakai dengan seri terbuka
withdraw / redeem : selalu jalan — pada NAV konservatif (saldoUSDG − escrowed − reserved) bila jalur konservatif dipakai
```
MtM memakai σ_mark(0) = σ_base × VRP (mid, tanpa spread, **tanpa dampak inventaris**). Alasannya (temuan audit C-1): util bergantung pada kas dan `netVega` yang diubah oleh deposit/redeem itu sendiri, sehingga MtM pada σ_mark(util) membuka sandwich deposit→redeem (PoC 0,65 % TVL per putaran). Karena harga trade tidak pernah menembus mark (FR-14), setiap `buy`/`close` menaikkan atau mempertahankan NAV (INV-15) — spread dan dampak inventaris terealisasi sebagai keuntungan LP saat trade; theta terakumulasi seiring waktu; perubahan σ_base dan S memindahkan NAV setiap blok.

Seri dalam blackout 60 s pra-expiry atau yang sudah lewat expiry di-mark pada **nilai intrinsik** terhadap spot saat ini (`min(max(S − K, 0), K)` / `max(K − S, 0)` — helper `_payoutPerUnit` yang sama dengan `settle`), bukan pada nilai waktu; karena itu `settle` hanya menggeser NAV sebesar bounty dan selisih antara spot mark dan round settlement (temuan audit akhir I-1: sebelumnya deposit→settle→redeem menangkap lompatan NAV di settle, PoC +213 USDG per board ATM). Konsekuensi yang diterima dan dinyatakan jujur: nilai waktu ≈ 60 detik terakhir sebuah seri lenyap di batas blackout (`expiry − 60 s`), bukan saat `settle`; ia hanya bisa ditangkap oleh round-trip LP dua blok yang mengapit detik itu — sebesar LP 61 detik mana pun di bawah marking kontinu; cooldown penarikan (FR-37, P1) menghapusnya. NAV dievaluasi **sekali** per entry point ERC-4626 lewat memo transient storage (EIP-1153; kata kunci `transient`, solc 0.8.28, EVM cancun; Arbitrum sejak ArbOS 20) dan `deposit`/`mint`/`withdraw`/`redeem` `nonReentrant` (temuan I-3: sebelumnya `_liabilityWad` dievaluasi dua kali per deposit — terukur di devnode, `deposit` dengan 6 seri terbuka turun 291.893 → 219.538 gas di Solidity dan 263.429 → 220.352 di Stylus, §13).

**Kapital referensi (lag) — R2-a.** Util dan semua cap (`maxUtilBps`, `vegaCapBps`) dihitung atas `kapitalReferensi = min(kapital live, capitalRefPrev)`, di mana `capitalRefPrev`/`capitalRefCur` adalah dua snapshot `saldo − escrowed` yang digeser sekali per `CAPITAL_REF_DELAY = 1 hari` di awal setiap `buy`/`close`/`settle`/`deposit`/`mint`/`withdraw`/`redeem` (bootstrap pada `deposit`/`mint` pertama). Deposit baru memperluas kapasitas trading setelah 1–2 hari; penarikan mengurangi kapasitas seketika. Tanpa ini, deposit besar menurunkan util seketika → beli murah → redeem → tutup pada util tinggi (PoC +965 USDG per blok). Residual yang diterima: LP yang kapitalnya sudah "menua" masih bisa memanfaatkan selisih util sekali per ≈ 2 hari, dibatasi porsi LP-nya (T16).

**Batas konfigurasi (`_setConfig`, `ConfigOutOfBounds(which)`):** `feeBps ≤ 1000`, `0 < maxUtilBps ≤ 9000`, `0 < vegaCapBps ≤ 5000`, `minPremiumBps ≤ 100`, `heartbeat ∈ [1 jam, 1 hari]` (heartbeat 1 detik akan membuat spot stale permanen dan membekukan `close`/`settle`/`claim` — FR-33 lewat jalan lain), `staleMult ≥ 1`, `sequencerGrace ≤ 1 hari`, `0 < maxOpenSeries ≤ 32`, `0 < tenorMax ≤ 90 hari`, `minSize > 0`, `settleBounty ≤ 100 USDG`; `treasury ≠ 0` (konstruktor dan `setTreasury`); `rWad ∈ [−0,5; 0,5]` saat konstruksi (deployment memakai 0).

**Oracle (`OracleLib.read`):** spot segar ⇔ sequencer naik (`answer == 0`, `startedAt ∈ (0, now]`, grace sudah lewat) dan `answer > 0`, `updatedAt ∈ (0, now]`, umur ≤ heartbeat × staleMult; feed yang revert = tidak segar (try/catch). Round sequencer dengan `startedAt == 0` (belum diinisialisasi) dihitung **down**; `startedAt`/`updatedAt` di masa depan dihitung tidak segar. `sequencerFeed = address(0)` = tanpa cek sequencer (devnode/demo).

**Events:** `Bought(seriesId, trader, size, premiumAssets, feeAssets, sigmaBuy, spotWad)`, `Closed(seriesId, trader, size, proceedsAssets, sigmaClose, spotWad)`, `BoardCreated(boardId, expiry, seriesIds)`, `Settled(boardId, settlementPriceWad, escrowedAddedWad, reservedReleasedWad)`, `Claimed(seriesId, holder, amount, payoutAssets)`, `TradingPaused(paused)`, `ConfigUpdated(cfg)`, `TreasuryUpdated(treasury)`; `Deposit`/`Withdraw` ERC-4626 dari OpenZeppelin. σ di `Bought`/`Closed` adalah σ **efektif** (σ₀ bila klem ke mark mengikat).

### 8.5 `EquinoxVolEngine.sol`

```solidity
struct Params { uint64 lambdaPerDay; uint64 vrp; uint64 alpha; uint64 spread; uint64 sigmaMin; uint64 sigmaMax; }   // semua WAD
uint256 public varWad; uint256 public lastPrice; uint80 public lastRoundId; uint64 public lastTs; uint64 public lastParamsUpdate;
uint64  public constant MIN_OBS_INTERVAL = 60;        uint64  public constant PARAMS_MIN_INTERVAL = 6 hours;
uint256 public constant MAX_PARAM_DELTA_BPS = 2000;   uint64  public constant MAX_ALPHA_DELTA = 0.2e18;

function poke() external returns (uint256 sigmaBase);            // permissionless (FR-12)
function sigmaBase() public view returns (uint256);              // clamp(√varWad, σ_min, σ_max)
function sigmaMark(uint256 utilWad) external view returns (uint256);
function spread() external view returns (uint256);
function setParams(Params calldata p) external onlyOwner;          // dibatasi keras + rate-limited (Ownable2Step)
```

`σ_mark(u) = clamp(σ_base · VRP · (1 + α·u))` dengan `σ_base = clamp(√var)` — σ_base di-clamp **dulu**, baru produknya (§6.4/FR-15; dipulihkan pada gelombang perbaikan, M-1): saat √var < σ_min pool me-mark pada σ_min × VRP, bukan σ_min telanjang.

**Guard `setParams`:** `sigmaMin ≥ 5%`, `sigmaMax ≤ 500%`, `vrp ∈ [1,0; 2,0]`, `alpha ∈ [0; 1,0]`, `spread ∈ [0,5%; 20%]`, `lambda ∈ [0,80; 0,99]`; `|Δparam| ≤ 20%` relatif (alpha: ≤ 0,2 absolut, karena boleh mulai dari 0) per `PARAMS_MIN_INTERVAL` (6 jam). Tidak ada fungsi `setSigma` — σ_base hanya bisa berubah lewat observasi harga. Tambahan (R3-b): `sigmaMax × (1 + spread) ≤ 500 %` agar σ_buy/σ_close tidak pernah keluar domain `math` (`SIGMA_MAX = 5e18`); sisi bawah tersirat (`sigmaMin × (1 − spread) ≥ 4 % > SIGMA_MIN 1 %`).

**`poke()`:**
```
(roundId, price, updatedAt) = feed.latestRoundData()
jika roundId ≤ lastRoundId atau price ≤ 0 atau updatedAt ≤ lastTs atau updatedAt > now → return sigmaBase()
jika updatedAt − lastTs < MIN_OBS_INTERVAL (60 s) → return sigmaBase()
varWad = math.ewmaUpdate(varWad, lastPrice, price, updatedAt − lastTs, lambdaPerDay)
simpan state ; emit Observed(roundId, price, Δt, varWad, sigmaBase)
```
Jalur "tidak ada round baru" tetap memanggil `math.sqrt` lewat `sigmaBase()`, karena itu pool membungkus `vol.poke()` dalam try/catch (FR-36). Round bertanggal masa depan (`updatedAt > now`) diabaikan, simetris dengan `OracleLib`; round dengan Δt < 60 s tidak dibuang — pergerakannya masuk ke observasi berikutnya (return dihitung dari `lastPrice`). EWMA **tidak di-winsorisasi**: satu observasi dengan log-return ±30 % menambah ≈ 2,0 ke var (σ_base 55 % → ≈ 1,5) dan meluruh dengan memori ≈ 16 hari — didokumentasikan, tidak diubah (agregasi Chainlink membuatnya sangat kecil kemungkinannya; `sigmaMax` tetap membatasi σ).

Inisialisasi: `varWad` = (σ_seed)² dari deployer (mis. 55%²) — **satu-satunya** input σ manusia, hanya saat deploy, dan meluruh dengan λ; `lastPrice`/`lastRoundId`/`lastTs` diambil dari round feed saat deploy (`answer > 0`, `updatedAt ≠ 0`) — konstruktor mempercayai `updatedAt` round seed; hanya `poke` yang menolak round bertanggal masa depan.

### 8.6 `EquinoxFactory.sol`
```solidity
function createPool(EquinoxPool.Deploy calldata d) external returns (address pool);   // satu argumen struct (§8.4 `Deploy`)
function pools(uint256 i) external view returns (address);
function poolCount() external view returns (uint256);
function poolDeployer() external view returns (PoolDeployer);                        // hanya `new EquinoxPool`; onlyFactory
event PoolCreated(address indexed pool, address token, address vol, address indexed math, address usdg, address feed);
```
Men-deploy `EquinoxVolEngine` + `EquinoxOptionToken`, lalu `EquinoxPool` lewat kontrak `PoolDeployer` terpisah, lalu `token.bindPool(pool)` — semua dalam satu transaksi (`createPool(Deploy)`); `math` immutable di pool dan vol engine. Dua level diperlukan karena **batas kode 24.576 byte** (EIP-170): factory satu-level harus menanam initcode pool + token + vol engine (21,7 + 5,5 + 6,4 = 33,5 KB) di runtime-nya; dengan pemisahan, runtime factory 13,8 KB dan `PoolDeployer` 23,0 KB — margin `PoolDeployer` hanya ≈ 1,5 KB (1.552 B) karena ia menanam initcode pool, sehingga pertumbuhan pool di atas itu mematahkan jalur factory. Test Foundry tidak menegakkan batas ini — chain sungguhan iya; CI menjalankan `forge build --sizes` dan gagal bila ada margin runtime negatif. `createPool` permissionless dan `pools[]` tidak diverifikasi (siapa pun bisa mendaftarkan pool dengan `math`/feed/USDG sembarang) — hanya alamat yang di-deploy demo yang kanonik. Demo memanggilnya dua kali: `math = BlackScholesSol` (Pool A) dan `math = Stylus` (Pool B).

### 8.7 `EquinoxLens.sol` (view, untuk UI & demo)
`quoteWithGreeks(pool, seriesId, size)`, `navBreakdown(pool)` → (saldo, escrowed, reserved, mtm, netVega, util), `surface(pool)` → σ_mark per seri terbuka + IV tersirat dari harga beli (`impliedVol`). Boleh dibuang jika waktu sempit.

### 8.8 Mocks (testnet)
`MockUSDG` (ERC-20, **6 desimal** — sesuaikan dengan V9), `MockFeed` (AggregatorV3 yang bisa di-set harga, `updatedAt`, `roundId`), `MockSequencerFeed`. Semua hanya untuk Sepolia/devnode; alamat produksi di §18.

---

## 9. INTEGRASI STYLUS — SPESIFIKASI TEKNIS

### 9.1 Toolchain
| Komponen | Pakai | Catatan |
|---|---|---|
| Rust | stable + target `wasm32-unknown-unknown` | `rustup target add wasm32-unknown-unknown` |
| `cargo-stylus` | `new`, `check`, `deploy`, `export-abi`, `activate`, `cache`, `replay`, `trace` | **Verifikasi versi & subcommand yang ada Hari 1 (V3)** |
| `stylus-sdk` | versi stabil terbaru; sintaks `#[public]` (bukan `#[external]` lama), `sol_storage!`, `sol_interface!` | Pin versi di `Cargo.toml`; V4 |
| Node lokal | `nitro-devnode` (Docker) — Stylus aktif, faucet built-in | e2e tanpa Sepolia |
| Foundry | `forge`, `cast`, `anvil` | Foundry **tidak bisa mengeksekusi WASM** (§9.7) |
| Python | `math.erfc`, `numpy` (opsional) | vektor uji & kalibrator |

### 9.2 ABI & panggilan lintas-VM
- Program Stylus adalah kontrak biasa dengan alamat biasa. Solidity memanggilnya lewat `IBlackScholes(addr).quote(...)` → `STATICCALL` standar; runtime Nitro mendeteksi bytecode berprefiks Stylus dan mengeksekusi WASM.
- Argumen & return ABI-encoded; array dinamis (`Vec<U256>`) didukung; tuple return dipetakan ke multiple returns Solidity.
- Setiap panggilan membayar overhead tetap (`CALL` + inisialisasi program) di atas biaya komputasi. **Inilah alasan `markPortfolio` batch** (FR-8): satu overhead untuk 32 seri, bukan 32 overhead. Ukur keduanya (§13).

### 9.3 Aktivasi, kedaluwarsa, cache
| Hal | Fakta | Tindakan |
|---|---|---|
| Aktivasi | `cargo stylus deploy` men-deploy **dan** mengaktivasi; aktivasi mengompilasi WASM → native di node dan membayar fee data | Catat biaya aktivasi aktual di §13 |
| Kedaluwarsa | Program harus di-*keepalive* dalam `expiryDays` (default 365) — permissionless via precompile `ArbWasm` (`0x…71`) | Runbook tahunan; siapa pun boleh membayar |
| Upgrade Stylus | Saat versi Stylus naik lewat upgrade ArbOS, program **harus diaktivasi ulang** sebelum bisa dipanggil | Permissionless (`activateProgram`); pool tidak butuh governance untuk pulih (FR-34). Sampai diaktivasi, semua yang butuh kuotasi (`buy`, `close`, `deposit`) revert; `claim` dan `withdraw` konservatif tetap jalan (FR-36) → T7 |
| Cache | `CacheManager` (lelang slot cache) menurunkan biaya inisialisasi program: `programInitGas` **31.333 → 4.961 gas** (build spike; build repo yang di-commit: lihat docs/BENCHMARK.md) untuk program ini (terukur via `ArbWasm`) | Produksi di Arbitrum One: `cargo stylus cache bid <addr> 0`. Devnode resmi hanya punya stub CacheManager (bid "sukses" tapi `codehashIsCached` = false) — angka cached di §13 adalah turunan, ditandai |

### 9.4 Gas, ink, batas ukuran
- Metering internal Stylus memakai **ink**; `1 gas = 10.000 ink` (default `ink_price`). Semua angka yang dilaporkan ke pengguna tetap **gas**. Jangan pernah menulis "lebih murah karena ink".
- Sumber penghematan yang **terukur** (§13): alur kontrol, loop, pemanggilan fungsi, dan ABI — bukan aritmetika. `I256` (ruint) 105 gas per pasangan mul+div vs EVM ~35; `i128` 29; `u64` 0,5. Klaim dokumentasi "~10× komputasi" berlaku untuk aritmetika lebar-sempit dan memori, tidak untuk fixed-point 256-bit.
- Batas: 24 KB terkompresi (brotli) per fragmen; cargo-stylus 0.10 memecah program lebih besar menjadi **fragmen** (maks `getMaxStylusContractFragments()` = 4 di Sepolia/ArbOS 61). `bs-stylus`: 34,3 KB → 2 fragmen (opt-level 3) atau 25,8 KB (opt-level "z", ~25% lebih lambat). Fragmen butuh **Stylus v3 / ArbOS ≥ 61** — devnode resmi (v3.11.4) lahir di ArbOS 59 dan harus di-upgrade (`ArbOwner.scheduleArbOSUpgrade(61, 0)` oleh chain owner dev). `wasm-opt -Oz` hanya menghemat 0,7 KB dan hasilnya ditolak aktivasi — **jangan pakai**.
- Memori dibayar per halaman WASM 64 KB (`pageGas` = 1.000 gas/halaman) **pada setiap panggilan**. Stack default Rust 1 MiB = 17 halaman = 17.000 gas per panggilan sia-sia. Wajib: `.cargo/config.toml` dengan `-C link-arg=-zstack-size=16384` → `programMemoryFootprint` = 1 halaman (terukur: `ln` 49,5k → 34,4k gas).
- Biaya tetap per panggilan (terukur): `programInitGas` 31.333 gas tanpa cache / 4.961 cached (build spike; build repo yang di-commit: lihat docs/BENCHMARK.md) + `CALL` + ABI ≈ 3k. Panggilan tunggal `ln`/`exp`/`normCdf` di Stylus ≈ 34–36k tanpa cache, ≈ 8–9k cached, vs 3,5–6k di Solidity. **Batch (FR-8) bukan optimasi opsional — ia syarat agar Stylus menang.**

### 9.5 Determinisme & numerik
- **Hanya integer.** `I256`/`U256` dari `alloy-primitives` (re-export SDK). Stylus VM **tidak mendukung floating point** (README SDK: "floating point and SIMD, which the Stylus VM does not yet support"); tidak ada `f64` di jalur mana pun.
- Perkalian WAD: `a·b/1e18` dengan `checked_mul` 256-bit lalu bagi — cukup karena domain §6.6 membatasi |a·b| < 2^255 (S, K ≤ 1e30; Φ, σ ≤ 5e18). Tidak perlu intermediate 512-bit; overflow → `MathError::Overflow`.
- Hasil Stylus dan Solidity kontrol **bit-identik** — tercapai dan diuji: `exp` (22 titik), `ln` (20), `sqrt` (15), Φ (341), φ (161), `quote` (700 kasus), capped (6), IV (11), EWMA (5) di Rust; subset yang sama di Foundry terhadap PRBMath v4 asli; dan `cast call` on-chain di devnode. Emulasi Python (`tools/reference/wad_emul.py`) adalah spesifikasi eksekusi ketiganya.

### 9.6 Strategi pengujian (empat lapis)
| Lapis | Alat | Yang diuji | Kecepatan |
|---|---|---|---|
| L1 | `cargo test` native (host) + `stylus-sdk` test VM | Setiap fungsi vs `vectors.json` (grid §10.1); properti Φ; konvergensi solver | detik |
| L2 | `cargo stylus check` | Validitas WASM, ukuran, estimasi aktivasi | detik |
| L3 | Foundry + `BlackScholesSol` | Pool: unit, fuzz, invariant (INV-1..11), skenario §12; **tanpa Stylus** | menit |
| L4 | `nitro-devnode` / Sepolia + `forge script --broadcast` / `cast` | e2e dengan Stylus terdeploy; gas aktual; INV-12 lintas implementasi | menit–jam |

Alamat program Stylus masuk ke skrip Foundry lewat env (`MATH_ADDR`). L3 harus tetap hijau jika Stylus belum ada — ini yang membuat Rencana B3 tidak menghancurkan test suite.

### 9.7 Jebakan yang sudah diketahui
1. **Foundry tidak bisa mensimulasikan program Stylus.** `forge test --fork-url` akan menarik bytecode WASM dan gagal mengeksekusinya. Semua test yang menyentuh Stylus harus lewat node sungguhan (L4). Karena itu ada `BlackScholesSol`.
2. Versi `stylus-sdk` bergerak cepat; makro dan nama fitur (`export-abi`, `#[public]`) berubah antar minor. Pin versi, baca changelog, jangan pakai contoh lama dari ingatan.
3. `export-abi` butuh fitur `export-abi` dan `main` khusus; boilerplate `#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]` wajib.
4. Program yang belum diaktivasi mengembalikan revert generik saat dipanggil — bedakan dari bug logika (`cargo stylus check --wasm-file` & `activate`).
5. `block.number` di Arbitrum adalah estimasi L1; pakai `block.timestamp` untuk semua logika waktu.
6. Chainlink di Sepolia bisa punya heartbeat & deviasi berbeda dari mainnet → `staleMult` harus parameter, bukan konstanta.
7. USDG adalah proxy upgradeable dengan pause/blocklist (Paxos) — pool tidak bisa mencegah pembekuan; dokumentasikan (T9).

---

## 10. OFF-CHAIN SERVICES

### 10.1 Reference pricer & vektor uji (Python)
**Input:** grid `S/K ∈ {0,5; 0,7; 0,85; 0,95; 1; 1,05; 1,15; 1,3; 2}`, `T ∈ {1 h(jam), 1 h(hari), 7 h, 30 h, 90 h, 365 h}`, `σ ∈ {10%, 30%, 60%, 100%, 200%, 300%}`, `r ∈ {0, 5%}`, call/put; grid Φ `x ∈ [−8, 8]` langkah 0,01.
**Output:** `vectors.json` (harga, Greeks, IV kembali dari harga, EWMA) dalam WAD string. Dipakai L1 dan L3. Tambahkan kasus tepi: `T = 60 s`, `σ = σ_min`, deep-OTM K = 2.600.
**Artefak pitch:** tabel §6.7 diregenerasi dari skrip ini — juri boleh menjalankannya.

### 10.2 Kalibrator (Python)
- Data: harga ETH harian/jam ≥ 3 tahun; jika akses Deribit DVOL tersedia, rasio IV/RV historis → `VRP`.
- Estimasi `λ` (maximum likelihood EWMA) dan distribusi IV/RV → `VRP` awal; skew κ (P1).
- Backtest sederhana: pool sintetis menjual ATM/OTM 7 h setiap Jumat dengan σ_mark model vs harga Deribit → PnL LP kumulatif. **Ini grafik pitch terkuat kedua** setelah tabel gas.

### 10.3 Keeper (TypeScript, viem)
- Memantau `feed.latestRoundData()`; saat round baru → `poke()` (opsional; setiap trade juga memanggilnya).
- Setelah `expiry`, menunggu round pertama `updatedAt ≥ expiry` → `settle(boardId)`; menerima bounty.
- Alarm jika NAV konservatif dipakai (oracle stale) atau program Stylus butuh aktivasi ulang (`ArbWasm.programTimeLeft`).
- **Sistem tidak bergantung padanya untuk keselamatan**; ia hanya mempercepat.

### 10.4 UI minimal (P1)
Next.js + wagmi: panel kuotasi (premi, Greeks, σ_mark, util), NAV breakdown, dan **counter gas Pool A vs Pool B** live dari `eth_estimateGas`. Dibuang pertama jika waktu sempit (§15); video bisa memakai output `Demo.s.sol`.

---

## 11. THREAT MODEL

| # | Ancaman | Vektor | Mitigasi | Residual |
|---|---|---|---|---|
| T1 | Spot stale / sequencer down | kuotasi dengan harga lama | FR-26: revert kuotasi; sequencer uptime feed + grace; settlement menunggu round segar; round sequencer dengan `startedAt == 0` dihitung down, `startedAt`/`updatedAt` masa depan dihitung tidak segar (`OracleLib`) | Rendah |
| T2 | Timing settlement | keeper/griefer memilih round | FR-27: round segar dengan `updatedAt ≥ expiry` yang ada **saat `settle` dipanggil** — bukan round pertama secara historis; permissionless + bounty; Chainlink eksogen | **Diterima & didokumentasikan** — operator MUST menjalankan keeper (§10.3); bounty adalah insentif, bukan jaminan; round yang dipakai terlambat jika tak ada yang memanggil |
| T3 | Manipulasi σ_mark via wash trade | beli besar → σ naik → tutup | spread `s` dua arah, fee, dampak dihitung pasca-trade, `alpha` dibatasi, vega cap; kapital referensi di-lag (§8.4); harga tidak pernah menembus mark (INV-15/16) | Rendah (biaya > keuntungan; INV-9) |
| T4 | Model ekor salah (lognormal) | beli deep-OTM murah lalu crash | `minPremiumBps` floor; `minListingDelta` (P1); cap call — lihat T17 untuk sisi sewa modalnya | **Diterima** — ini risiko LP yang eksplisit, bukan bug |
| T5 | Insolvensi pool | S_T ekstrem | cadangan = payout maksimum; cap call; `maxUtilBps`; INV-1..3 fuzz | Nihil by construction |
| T6 | LP sniping NAV (lag Chainlink vs pasar) | deposit/withdraw sebelum update | MtM NAV setiap aksi; withdrawal cooldown (P1); deposit revert saat stale; `vol.poke()` di setiap entry point LP/trade (`buy`/`close`/`settle`/`deposit`/`mint`/`withdraw`/`redeem`; `claim` tidak) — menutup lever "deposit→poke→redeem"; nilai waktu ≈ 60 s terakhir sebuah seri lenyap di batas blackout `expiry − 60 s` (§8.4) — hanya bisa ditangkap round-trip LP dua blok yang mengapit detik itu, sebesar LP 61 detik mana pun | Rendah–sedang (**sebutkan**; cooldown adalah jawaban produksi) |
| T7 | Program Stylus kedaluwarsa / butuh aktivasi ulang | `buy`/`close`/`deposit` revert (butuh kuotasi) | reaktivasi permissionless (siapa pun, dalam menit); FR-36: `claim` & `withdraw` konservatif tetap jalan; keeper alarm; opsi produksi: fallback otomatis ke `BlackScholesSol` (D14) | Rendah |
| T8 | Pembulatan menguntungkan trader | dust, WAD→6 dp | FR-35 arah pembulatan; `minSize`; fuzz INV-1 dengan dust | Rendah |
| T9 | USDG dipause / alamat diblokir | Paxos | tidak bisa dimitigasi di kontrak; dokumentasikan; UI menampilkan status; treasury yang diblokir membuat `buy` revert (transfer fee gagal) sampai `setTreasury` | **Diterima** |
| T10 | Reentrancy | callback token | USDG/ERC-1155 receiver hooks: CEI + `nonReentrant` pada `buy`/`close`/`settle`/`claim` dan keempat entry ERC-4626; Stylus tanpa panggilan keluar | Nihil untuk `buy`/`close`/`settle`/`claim` (`nonReentrant`, diuji dengan pembeli re-entrant lewat hook ERC-1155: `close`/`buy`/`claim` dari dalam `buy` ditolak `ReentrancyGuardReentrantCall`); entry point ERC-4626 juga `nonReentrant` — USDG dan token share tanpa hook, guard menjadikannya jaminan, bukan asumsi (tidak diuji re-entrant) |
| T11 | Ketidaksesuaian Stylus vs kontrol | bug port | INV-12 di L4 pada grid penuh; kontrol tidak pernah dipakai produksi | Rendah |
| T12 | Griefing gas via seri | listing banyak seri → loop MtM mahal | `maxOpenSeries` 32; listing owner-only di MVP | Nihil |
| T13 | Front-running trade | mempool | Sequencer Arbitrum FCFS tanpa mempool publik; `maxPremium`/`minProceeds` slippage guard | Rendah |
| T14 | Parameter admin merusak harga | `setParams`, `setConfig` | batas keras + rate limit (§8.5); batas `setConfig` (§8.4); tidak ada `setSigma`; owner `Ownable2Step` | Rendah–sedang: owner **tanpa timelock** — `setParams` bisa menggeser σ_mark(0) hingga 20 % per 6 jam (VRP ±20 %), yang menggeser kewajiban MtM sebesar vega × Δσ dan dengannya NAV; `setConfig` mengubah cap harga seketika; produksi: timelock/multisig |
| T15 | Seed σ awal salah | deploy | hanya saat deploy, meluruh dengan λ; kalibrasi §10.2 | Rendah |
| T16 | LP sandwich NAV/harga via util & σ (deposit→trade→redeem) | deposit mengubah kas/util seketika; NAV atau harga trade bergerak | NAV di-mark pada σ_mark(0) (D8); kapital referensi di-lag 1 hari; harga tidak pernah menembus mark (FR-14, INV-15/16); diuji: sandwich literal rugi (`test_dilution_sandwich_cannot_profit`), deposit→settle→redeem rugi (`test_jit_settle_sandwich_cannot_profit`) | Rendah — lever sisi withdraw sekali per ≈ 2 hari, dibatasi porsi LP (**diterima & didokumentasikan**) |
| T17 | Sewa modal murah via floor premi | beli deep-OTM: cadangan `K × size` terkunci berapa pun preminya | `minPremiumBps` adalah **floor sewa modal**, bukan mitigasi: 5 bps × K menyewa kunci K selama tenor penuh (200 P 2.600 mengunci 520k dari pool 1 juta seharga ≈ 260 USDG); sampai FR-20 (`minListingDelta`, P1): rentang strike [S/2, 2S] + listing owner-only + `maxUtilBps` | **Diterima & didokumentasikan** — jawaban produksi: FR-20 |

T5 dan T3 layak disorot di pitch: satu invariant yang dibuktikan fuzz (solvabilitas) dan satu properti ekonomi yang dibuktikan test (tidak ada round-trip gratis).

---

## 12. INVARIANTS & TEST PLAN

### Invariants (Foundry fuzz + invariant testing, L3; ulang subset di L4)
| ID | Invariant |
|---|---|
| INV-1 | `reserved ≤ usdg.balanceOf(pool) − escrowedPayouts` — solvabilitas |
| INV-2 | `reserved == Σ_seri_terbuka OI_i × K_i` |
| INV-3 | Untuk setiap S_T: `Σ_i OI_i × payout_i(S_T) ≤ reserved` (uji dengan S_T ∈ {0, K/2, K, 2K, 10K}) |
| INV-4 | `token.totalSupply(id) == OI(id)` untuk setiap seri |
| INV-5 | `Φ` monoton naik; `Φ(0) = 0,5`; `Φ(x) + Φ(−x) = 1 ± 1e-15`; `Φ ∈ [0, 1]` |
| INV-6 | `max(S − K, 0) ≤ C ≤ S` dan `max(K − S, 0) ≤ P ≤ K` (r = 0) |
| INV-7 | `\|C − P − (S − K)\| ≤ 1e-9·S` (put-call parity, r = 0) |
| INV-8 | Harga monoton naik terhadap σ dan T; call turun terhadap K, put naik terhadap K |
| INV-9 | `quoteClose(size) < quoteBuy(size)` pada state yang sama, untuk setiap size — tidak ada round-trip gratis |
| INV-10 | `σ_mark ∈ [σ_min, σ_max]` selalu; `util_vega ∈ [0, 1]` |
| INV-11 | `settle` idempoten; `Σ claim ≤ escrowed`; setelah semua claim `escrowed == 0` |
| INV-12 | Stylus vs `BlackScholesSol`: `exp`/`ln`/`sqrt` bit-identik; harga ≤ 1e-9 relatif pada grid §10.1 |
| INV-13 | Pada `settle`: `Δescrowed = Σ OI_i × payout_i ≤ Σ OI_i × K_i = −Δreserved` — settle tidak pernah menciptakan kewajiban di atas cadangan yang dilepas |
| INV-14 | `close`, `claim`, `withdraw(freeLiquidity)` sukses saat `tradingPaused == true` |
| INV-15 | `totalAssets` tidak pernah turun oleh sebuah `buy`/`close` (harga ≥/≤ mark) |
| INV-16 | `quoteBuy(id, n) ≥ quoteClose(id, n)` untuk setiap seri terbuka dan setiap n — menguatkan INV-9 untuk vega negatif |

### Skenario test wajib
1. **Happy path:** LP deposit 1 juta → trader beli 10 C 4.200 → σ_mark naik terukur → warp 7 h → feed 4.500 → settle → claim 3.000 → NAV LP = 1.000.000 + premi − 3.000, dengan premi ≥ 648,68 (mid) karena spread dan dampak inventaris; fee ke treasury tidak masuk NAV.
2. **Solvabilitas ekstrem:** 200 C 4.000 (util 80%) → feed 40.000 → settle → payout = 800.000 = reserved; LP sisa ≥ 200.000 + premi.
3. **Deep-OTM tidak nol:** P 2.600 7 h → premi = max(0,000005·size, floor 5 bps·K) → floor yang menang; tercatat.
4. **Wash trade:** beli 50 → tutup 50 dalam blok yang sama → trader rugi ≥ 2·s·vega + fee (INV-9).
5. **Oracle stale:** `updatedAt` lama → `buy`/`close`/`deposit` revert (tidak ada kuotasi tanpa spot); `withdraw` memakai NAV konservatif dan sukses; `claim` seri yang sudah settle sukses.
6. **Sequencer down:** status 1 → revert; setelah `sequencerGrace` → normal.
7. **Settlement round:** panggilan sebelum expiry → revert `BoardNotExpired`; setelah expiry dengan round terakhir masih bertanggal sebelum expiry → revert `SettlementNotReady`; round segar pertama dengan `updatedAt ≥ expiry` → sukses; panggilan kedua → `BoardAlreadySettled`.
8. **Pause:** owner pause → `buy` revert; `close`/`claim`/`withdraw` jalan (INV-14).
9. **Solver seluruh domain:** `impliedVol` untuk setiap titik grid ≤ 40 iterasi dan memulihkan σ ± 1e-8 (L1 + L4).
10. **EWMA tak beraturan:** urutan §6.4 direproduksi ± 1e-12.
11. **Cap call:** S_T = 9.000 vs 8.400 membayar sama (K).
12. **Program belum aktif (L4):** panggilan ke alamat Stylus sebelum `activate` → revert; setelah → sukses. Dokumentasikan gasnya.

Target: **≥ 90% line coverage** pada `EquinoxPool`, `EquinoxVolEngine`, `BlackScholesSol`; invariant run ≥ 50k; L1 100% fungsi tercakup vektor. Proyek sebelumnya di pipeline ini (CorpAction Engine) melaporkan 94,2% — jangan kirim angka jauh di bawah itu. Tercapai 19 Sep 2026 (Plan 2, `forge coverage --ir-minimum`, setelah gelombang perbaikan): `EquinoxPool` 92,1 %, `EquinoxVolEngine` 98,6 %, `EquinoxOptionToken` 100 %, `OracleLib` 100 %, `EquinoxFactory` 87,5 % (`poolCount()` tak terpanggil), `BlackScholesSol` 98,8 % — total `src/pool` + `src/oracle` 93,4 % baris (428/458); invariant 7 × 51.200 panggilan (256 run × kedalaman 200, 0 revert) di HEAD.

**Suite invariant (L3, `EquinoxPool.invariants.t.sol`):** 7 invariant — INV-1, 2, 4, 10, 11, 15, 16 — atas handler `deposit`/`withdraw`/`buy`/`close`/`tickTime`/`settle`/`claim` dengan dua board (7 dan 14 hari); konfigurasi default `foundry.toml` 32 run × kedalaman 128 = 4.096 panggilan per invariant (CI), run panjang 256 × 200 = 51.200. INV-13 di-assert lewat event `Settled` (`Δescrowed ≤ Δreserved`) di skenario 1 dan 2; INV-3 lewat skenario 2; INV-9/INV-14 lewat `test_wash_trade_is_not_free`/`test_pause_semantics`; klaim parsial multi-pemegang, `mint`, dan kedua sandwich (deposit→buy→redeem→close; deposit→settle→redeem) diuji sebagai unit test; satu evaluasi NAV per entry ERC-4626 di-assert dengan `vm.expectCall(markPortfolio, 1)`. CI menegakkan `forge build --sizes` (margin runtime setiap kontrak tidak negatif, ≥ 0).

---

## 13. DEMO HARNESS

`Demo.s.sol` (Foundry script, L4 di devnode/Sepolia) men-deploy `MockUSDG`, `MockFeed`, `MockSequencerFeed`, `BlackScholesSol`, lalu lewat `EquinoxFactory` dua pool identik:

- **Pool A (kontrol):** `math = BlackScholesSol`
- **Pool B (Equinox):** `math = black_scholes` Stylus (alamat dari `MATH_ADDR`, hasil `cargo stylus deploy`)

Urutan yang dijalankan pada keduanya dengan input identik, mencetak tabel:

**Hasil terukur (19 Sep 2026).** Lingkungan: `nitro-devnode` image `offchainlabs/nitro-node:v3.11.4-7d5ac27`, di-upgrade ke ArbOS 61 (Stylus v3), L1 fee = 0; `cargo-stylus`/`stylus-sdk` 0.10.9, rustc 1.92, `opt-level = 3`, stack 16 KiB, 2 fragmen; kontrol `solc 0.8.28` via-IR, optimizer 200 runs, PRBMath v4.1.0. Pengukuran = `gasleft()` di sekitar `STATICCALL` dari harness `Bench.sol` (termasuk overhead panggilan & inisialisasi program). Kolom "cached" = terukur − (31.333 − 4.961) dari `ArbWasm.programInitGas` (turunan; CacheManager devnode adalah stub). Semua keluaran bit-identik antara A dan B (Δharga = 0).

**Sumber kanonik.** Tabel di bawah adalah pengukuran build spike 19 Sep 2026. Untuk build yang di-commit di repo, angka kanoniknya adalah docs/BENCHMARK.md (keluaran tools/bench/bench.sh); selisihnya ≤ ~2% pada kolom terukur karena ukuran WASM sedikit berbeda, dan kesimpulan (2,6–2,9× pada lingkaran, < 1× panggilan tunggal tanpa cache, aritmetika 256-bit 3× lebih mahal dari EVM) tidak berubah.

| Operasi | Solidity (kontrol) | Stylus tanpa cache | Stylus cached (turunan) | Rasio cached |
|---|---|---|---|---|
| `normCdf(−0,5456)` | 5.435 | 35.037 | 8.665 | 0,6× |
| `exp(−1)` | 6.144 | 35.670 | 9.298 | 0,7× |
| `ln(2)` | 3.559 | 34.388 | 8.016 | 0,4× |
| `quote` C 4.200 7 h (harga + 4 Greeks) | 24.536 | 41.547 | 15.175 | 1,6× |
| `cappedCall` C 4.200 cap 8.400 | 40.886 | 46.925 | 20.553 | 2,0× |
| `impliedVol` C 4.200 (5 iterasi) | 121.321 | 73.899 | 47.527 | 2,6× |
| `impliedVol` P 2.600 deep-OTM (20 iterasi) | 616.839 | 250.083 | 223.711 | 2,8× |
| `ewmaUpdate` | 22.082 | 41.135 | 14.763 | 1,5× |
| `markPortfolio` 32 seri (satu panggilan) | 1.242.892 | 454.158 | 427.786 | 2,9× |

**Micro-benchmark biaya marjinal** (program terpisah, loop 1.000 iterasi, gas per pasangan `mul_wad`+`div_wad`): `I256` (ruint) **105**; `i128` Q64.64 **29**; `u64` **0,5**; EVM Solidity ≈ 30–40 (`MUL`/`DIV` = 5 gas). Inilah alasan rasio 2,6–2,9× dan bukan 10×: keunggulan WASM ada di alur kontrol, bukan di aritmetika 256-bit. Jalur `i128` Q64.64 (D5) diperkirakan menaikkan rasio lingkaran ke ~5× — **belum diukur end-to-end**.

Baris pool (`buy`, `close`, `deposit` dengan seri terbuka) sudah diukur di devnode dengan dua pool identik (`tools/e2e/pool-e2e.sh` + `PoolE2EDeployer`, lewat `cast` karena `forge script` tidak bisa mengeksekusi WASM) — lihat docs/BENCHMARK.md seksi "Transaksi pool end-to-end": `buy` 10 C 4.200 387.211 vs 367.932 gas (1,05×), `close` 5 254.792 vs 235.533 (1,08×), `deposit` dengan 6 seri terbuka 219.538 vs 220.352 (0,99×) — rasio 0,99–1,08× karena transaksi didominasi storage EVM dan transfer token, bukan matematika (matematika ≈ 23–27 % dari gas `buy`). Baris `deposit` 0,99×: dengan satu `markPortfolio` atas satu seri hidup, kolom Stylus tidak lagi mengamortisasi premi inisialisasi program ≈ 31k gas (tanpa cache) — konsisten dengan temuan Plan 1: loop menang, panggilan tunggal kecil tidak. Kuotasi, NAV, σ_mark, cadangan, dan kas kedua pool identik byte-per-byte. Belum diukur: 32 × `quote` terpisah vs satu `markPortfolio` di dalam pool, `deposit` dengan 32 seri hidup, dan biaya aktivasi aktual di Sepolia (0,000147 ETH per `cargo stylus check`).

Lalu narasi: LP deposit → beli 10 C 4.200 (mid 64,87 per unit pada σ_mark 63,25%; harga beli lebih tinggi karena spread + dampak — cetak keduanya) → beli P 2.600 (floor menang, tidak nol) → warp 7 h → feed 4.500 → `settle` → `claim` → NAV LP. Angka yang tercetak harus cocok dengan §6.7 dan skenario 1 §12.

**Aturan kejujuran untuk tabel ini** (sudah dijalankan): rasio 10× yang ditargetkan v1.0 **tidak tercapai** dan dicabut dari seluruh dokumen; narasi bergeser ke iterasi & batch (2,6–2,9×) plus benchmark itu sendiri sebagai kontribusi. Baris `buy`/`close`/`deposit` terukur 0,99–1,08× karena didominasi storage EVM — tidak disembunyikan, dijelaskan. Skrip: `tools/bench/bench.sh` (harness `contracts/src/Bench.sol`).

> `block.number` di Arbitrum adalah estimasi L1. Gunakan `block.timestamp` dan `vm.warp` untuk memajukan waktu di demo; di devnode, majukan waktu lewat RPC `evm_increaseTime` jika tersedia, atau pakai expiry pendek (jam) untuk rekaman video.

---

## 14. BUSINESS MODEL

| Item | Isi |
|---|---|
| **Initial user** | LP USDG yang ingin yield vol-selling tanpa mempercayai oracle IV tim mana pun; trader tenor pendek di Arbitrum yang hari ini memakai venue dengan IV off-chain |
| **Buyer** | Trader membayar `feeBps` (300 bps atas premi) ke treasury; LP membayar lewat spread yang mereka terima (spread adalah pendapatan LP, bukan protokol) |
| **Distribution** | Dua jalur: (1) pool itu sendiri; (2) `black_scholes` sebagai **pustaka publik** di Stylus — integrator (Praetor margin engine, vault terstruktur, protokol lain) memanggil `quote`/`impliedVol` langsung. Pustaka adalah saluran akuisisi |
| **Revenue** | Fee atas premi. Ilustrasi: volume premi 1 juta USDG/bulan × 3% = 30k USDG/bulan. **Kecil**; skala datang dari jumlah underlying dan integrator, bukan satu pool |
| **USDG** | Settlement dalam stablecoin teregulasi MAS (Paxos Digital Singapore) & MiCA (Paxos Issuance Europe): jalur natural ke venue teregulasi di Singapura dan ke Global Dollar Network. Jangan mengklaim yield GDN — itu untuk partner jaringan, bukan otomatis untuk pool |
| **Expansion** | BTC/USDG; tenor lebih panjang dengan hedger perps; opsi atas tokenized equity di Robinhood Chain dengan rezim sesi (menggabungkan logika Vigil); trader short (dua sisi) |

**Jujur soal ekonomi.** Ini bukan bisnis fee tinggi pada TVL kecil. Nilainya adalah **membuka kategori**: options venue on-chain yang seluruh logika harganya bisa diaudit dari state, dan pustaka kuant Stylus yang dipakai orang lain. Sampaikan begitu; jangan mengarang proyeksi.

---

## 15. RENCANA KERJA 15 HARI (SOLO)

| Hari | Deliverable | Go/No-Go |
|---|---|---|
| **1** | Verifikasi §18 seluruhnya. Registrasi hackathon. `cargo stylus new` + `forge init`. Python `vectors.json` (§10.1) | Jika Stylus di Sepolia bermasalah (V2) → devnode; jika toolchain rusak → Rencana B1 |
| **2–3** | Modul `fixed` (`exp`, `ln`, `sqrt`) + `normal` (Cody) + test L1 vs vektor. `cargo stylus check`. Deploy ke devnode + Sepolia. Ukur `normCdf` — **sudah dikerjakan sebagai spike 19 Sep (bit-identik, terdeploy di devnode); tinggal dipindahkan ke repo lewat Plan 1** | **Go/No-Go #1:** ✅ tercapai di spike |
| **4** | `quote`, `cappedCall`, `impliedVol`, `ewmaUpdate`, `markPortfolio`, `export-abi`, `BlackScholesSol`, benchmark — **sudah dikerjakan di spike**; Hari 2–4 dipakai untuk Plan 1 (repo, CI, Sepolia) dan mulai pool lebih awal | **Go/No-Go #2:** ✅ dijawab: 2,6–2,9× pada lingkaran; narasi sudah dipindah ke iterasi & batch (§0, §13) |
| **5–6** | `EquinoxOptionToken` + `EquinoxPool` inti: deposit/withdraw, board, `quoteBuy/Close`, `buy/close`, cadangan. Test L3 dengan kontrol | Skenario 1, 4, 8 lulus |
| **7** | `settle` + `claim` + FR-36 + invariant INV-1..4, 9, 11, 13, 14 (fuzz ≥ 50k) | Skenario 2, 5, 7, 11 lulus |
| **8** | `EquinoxVolEngine`: `poke`, EWMA, VRP, α, spread, guard `setParams`. INV-8, 10 | Skenario 10 lulus; §6.4 direproduksi |
| **9** | `totalAssets` MtM via `markPortfolio`; `EquinoxFactory`; `EquinoxLens`. e2e L4 di devnode dengan Stylus | **Go/No-Go #3:** `buy` end-to-end di Pool B dengan Stylus, premi = §6.7 |
| **10** | `Demo.s.sol` dua pool + tabel §13 terisi dari pengukuran. Deploy Sepolia. INV-12 pada grid | Tabel gas & presisi tercetak |
| **11** | Hardening: T3, T4, T6, T8 (dust), `maxOpenSeries`, pause semantics; coverage ≥ 90%; skenario 3, 6, 9, 12 | Coverage tercapai |
| **12** | Kalibrator Python: λ, VRP, grafik IV/RV & backtest sintetis. README arsitektur (ringkas dari dokumen ini) | Grafik siap |
| **13** | UI minimal (P1) **atau** langsung skrip video. Q&A juri dilatih | — |
| **14** | Video 3 menit (§13 sebagai alur), README final, teks submission | — |
| **15** | Buffer + submit | Submission tutup **4 Okt 15:59** |

**Aturan pemangkasan bila tertinggal.** Buang dengan urutan ini: UI → `EquinoxLens` → `EquinoxFactory` (hardcode dua pool di script) → skew κ → withdrawal cooldown → `impliedVol` publik (mark memakai σ_mark saja) → `EquinoxVolEngine` EWMA (σ_base dari seed + dampak inventaris, **dokumentasikan sebagai regresi**). Yang **tidak boleh** dibuang: `black_scholes` Stylus dengan vektor, `EquinoxPool` buy/settle/claim, INV-1..3, dan demo dua pool dengan tabel gas terukur. Empat hal itu sudah merupakan proyek yang utuh dan jujur.

---

## 16. PERTANYAAN JURI & JAWABAN SIAP

| Pertanyaan | Jawaban |
|---|---|
| "Lyra sudah menghitung Black-Scholes on-chain tahun 2021. Apa yang baru?" | Benar, dan kami mengkreditkannya, termasuk mekanisme dampak inventaris. Yang baru: σ_base endogen dari realized vol on-chain (tanpa oracle IV), IV solver dan NAV mark-to-market lintas seri yang berjalan **on-chain per transaksi**, dan solvabilitas keras tanpa hedger. Lyra sendiri pindah ke orderbook off-chain karena EVM memaksa pemangkasan; Stylus menghapus tekanan itu. |
| "Berapa sebenarnya penghematan Stylus?" | 2,6–2,9× pada solver dan mark-to-market batch, diukur dengan implementasi bit-identik; panggilan tunggal tanpa cache justru lebih mahal. Bukan 10× — kami mengukur, menemukan bahwa aritmetika 256-bit di WASM 3× lebih mahal dari opcode EVM, dan menulisnya di dokumen. Itu temuan yang berguna bagi siapa pun yang berencana memindahkan matematika DeFi ke Stylus. |
| "Stylus dekoratif? Bisa dibangun di Solidity?" | Bisa — `BlackScholesSol` membuktikannya, dan pool bisa memakai salah satu lewat satu parameter factory. Stylus dipilih karena tiga hal yang terukur: lingkaran solver/MtM 2,6–2,9× lebih murah, pustaka Rust diuji native terhadap 1.250 vektor tanpa node, dan tidak ada "stack too deep" (kontrol Solidity butuh via-IR). Kami tidak mengklaim Stylus membuat yang mustahil menjadi mungkin. |
| "Jadi masih pakai oracle." | Ya — untuk **spot**, dari Chainlink, seperti semua orang. Yang dihilangkan adalah oracle **IV**, satu-satunya input yang tidak bisa diobservasi dan yang menentukan 17–33% premi per 10 poin. |
| "Kenapa call di-cap?" | Pool memegang USDG saja dan tidak melakukan hedging. Tanpa cap, kewajiban call tak terbatas dan solvabilitas hanya bisa dijanjikan, bukan dibuktikan. Untuk tenor ≤ 30 hari pada σ ≤ 60%, cap berharga < 0,001% premi. Angkanya di §6.3. |
| "LP tidak hedge delta — ini kasino?" | LP menjual vol dengan eksposur arah, sama seperti setiap DOV. Bedanya: harga tidak bergantung oracle, batas kerugian eksplisit (`reserved`), NAV mark-to-market, dan vega cap. Hedger perps adalah jalur produksi yang jujur kami sebut belum ada. |
| "Model ekor salah — deep-OTM akan disalahgunakan." | Setuju lognormal salah di ekor. Karena itu ada premium floor 5 bps × K dan batas delta listing — sebagai parameter risiko, bukan klaim presisi. Kami justru menghapus argumen presisi ekor dari pitch setelah menghitungnya (§2.4). |
| "Kenapa USDG, bukan USDC?" | Secara teknis USDC bisa. USDG memberi jalur ke venue teregulasi di Singapura (MAS) dan Eropa (MiCA), dan ini event Singapura. Kami tidak mengklaim USDG tak tergantikan. |
| "Apa yang on-chain?" | Realized vol, σ_mark, harga, Greeks, IV solver, cadangan, NAV, settlement. Off-chain hanya kalibrasi parameter (dibatasi & rate-limited) dan keeper yang cuma mempercepat. |
| "Apa yang tidak bisa direplikasi tim lain dalam 48 jam?" | Pustaka Stylus yang lulus vektor 1e-12 di seluruh domain, solver yang terbukti konvergen di deep-OTM, dan invariant solvabilitas yang lulus fuzz. Kerangka pool-nya bisa; kepercayaan pada angkanya tidak. |
| "Determinisme WASM? Float?" | Hanya integer `I256`/`U256`. Tidak ada float. `exp`/`ln`/`sqrt` bit-identik dengan implementasi Solidity kontrol — diuji. |
| "Program Stylus bisa kedaluwarsa/berhenti setelah upgrade ArbOS." | Betul; reaktivasi permissionless (siapa pun bisa membayarnya dalam hitungan menit), dan sampai itu terjadi kuotasi berhenti — `buy`/`close`/`deposit` — tetapi `claim` dan `withdraw` tetap terbuka dengan NAV konservatif. Ini dirancang, bukan ditemukan belakangan. |
| "Kenapa bukan tokenized stocks di Robinhood Chain?" | Karena opsi atas aset dengan jam pasar butuh rezim sesi (feed 24/5) — masalah terpisah yang kami dokumentasikan sebagai ekspansi. MVP harus membuktikan mesin harganya dulu pada aset 24/7. |

---

## 17. RENCANA B

**B1 — Toolchain Stylus di Sepolia bermasalah (Hari 1–3).** Kerjakan seluruh L1 (native `cargo test`) dan L4 di `nitro-devnode` lokal; rekam demo dari devnode. Narasi tidak berubah (Stylus live di Arbitrum One/Sepolia; masalahnya lokal).

**B2 — Ukuran/gas program di luar batas.** Pecah: program 1 = `exp/ln/sqrt/Φ/quote/cappedCall`; program 2 = `impliedVol/ewma/markPortfolio` yang memanggil program 1. Tambah satu overhead panggilan; tesis utuh.

**B3 — Stylus benar-benar tidak bisa dipakai (paling buruk).** Kirim pool dengan `BlackScholesSol`, pustaka Rust dengan L1 hijau + `cargo stylus check` sukses, dan jelaskan bahwa alamat `math` immutable per pool dirancang persis agar Pool B bisa di-deploy kapan pun. Kehilangan tabel gas; solvabilitas, tanpa-oracle-IV, dan solver tetap terdemonstrasi. **Ini melemahkan pitch secara signifikan — hanya jika B1 dan B2 gagal.**

**B4 — USDG tidak ada di Arbitrum One (V9).** `MockUSDG` 6 desimal untuk demo (dibutuhkan di Sepolia apa pun kondisinya); dokumentasikan bahwa produksi menunggu deployment resmi atau memakai USDC dengan parameter identik.

**B5 — Jangan lakukan:** membangun hedger perps, orderbook, atau UI dulu. Semuanya memindahkan Anda ke kategori yang sudah penuh dan mengorbankan satu-satunya bagian yang membedakan: pustaka kuant dan invariant-nya.

---

## 18. VERIFICATION CHECKLIST — HARI 1

Jangan tulis satu baris kontrak sebelum semua ini terjawab dengan `cast`/`curl`/`cargo`.

| # | Item | Cara | Konsekuensi jika salah |
|---|---|---|---|
| V1 | Chain ID & RPC Arbitrum Sepolia (`421614`) dan One (`42161`) | `cast chain-id --rpc-url …` | Deploy ke chain salah |
| V2 | ✅ Sepolia: `stylusVersion()` = 3, `arbOSVersion()` = 116 (ArbOS 61), `getMaxStylusContractFragments()` = 4; `expiryDays` = 365, `keepaliveDays` = 31, `pageGas` = 1.000 | `cast call 0x…71 …` (dilakukan 19 Sep) | — |
| V3 | ✅ `cargo-stylus` 0.10.9 (`cargo install cargo-stylus --version 0.10.9 --locked`); `new/check/deploy/export-abi/cache bid` dipakai; `Stylus.toml` wajib ada | dilakukan 19 Sep | — |
| V4 | ✅ `stylus-sdk` 0.10.9: `sol_storage!` + `#[entrypoint]` + `#[public]`, `#[derive(SolidityError)]`, `print_from_args()`, `Vec<U256>` args, no_std butuh `use alloc::vec;`, nama fungsi di-camelCase (`norm_cdf` → `normCdf`) | dilakukan 19 Sep | — |
| V5 | ✅ `bs-stylus` 34,3 KB → 2 fragmen; aktivasi 0,000147 ETH (Sepolia); `programMemoryFootprint` 1 halaman setelah stack 16 KiB | `cargo stylus check --endpoint <sepolia>` | — |
| V6 | Chainlink ETH/USD di Sepolia: alamat, `decimals()`, heartbeat, deviasi — **dari docs.chain.link, jangan dari ingatan** | `cast call <feed> "latestRoundData()"` | `staleMult` & skala salah |
| V7 | L2 Sequencer Uptime Feed tersedia di Sepolia? | docs.chain.link | Jika tidak: pakai `MockSequencerFeed` di demo, dokumentasikan |
| V8 | Faucet Arbitrum Sepolia berfungsi | — | Tidak bisa deploy |
| V9 | USDG di Arbitrum One: ada? alamat? `decimals()` (diduga 6) | Paxos docs + `cast call` | **Skala 6 dp salah → seluruh pool salah harga**; Rencana B4 |
| V10 | ✅ `nitro-devnode` dengan `NITRO_NODE_VERSION=v3.11.4-7d5ac27` jalan; **wajib** `scheduleArbOSUpgrade(61, 0)` agar fragmen didukung; CacheManager-nya stub | dilakukan 19 Sep | Tanpa upgrade: deploy 2 fragmen revert |
| V11 | Foundry versi terbaru; konfirmasi `forge test` gagal mengeksekusi kode Stylus (dokumentasikan error-nya) | fork test ke alamat Stylus | Menghemat hari sia-sia |
| V12 | Ada pustaka fixed-point/`exp`/`ln` Rust untuk Stylus yang teruji? (contoh resmi, komunitas) | GitHub search | Pakai & kreditkan atau port PRBMath sendiri |
| V13 | Status IV-sourcing Premia v3, Stryke, Rysk, Moby per hari ini | docs masing-masing | Tabel prior art §1 harus akurat |
| V14 | Rubrik/track juri event: apakah ada track Stylus? bobot kualitas kontrak vs demo? | halaman event | Menentukan proporsi waktu Hari 12–14 |
| V15 | Batas `expiryDays` & mekanisme keepalive Stylus (permissionless?) | docs Stylus | T7 & FR-34 |

---

## 19. OPEN DECISIONS

| # | Keputusan | Opsi | Rekomendasi saya |
|---|---|---|---|
| D1 | Chain | Arbitrum Sepolia/One vs Robinhood Chain | **Arbitrum Sepolia → One.** Stylus dijamin; USDG diverifikasi V9. Robinhood Chain = ekspansi (tokenized stocks butuh rezim sesi) |
| D2 | Underlying MVP | ETH saja vs ETH + BTC | **ETH saja.** Satu feed, satu kalibrasi, satu demo |
| D3 | Representasi seri | ERC-1155 vs ERC-721 | **ERC-1155.** Seri fungible per (expiry, strike, sisi); 721 hanya menambah gas & kompleksitas |
| D4 | Solvabilitas call | Cap 2K (USDG-only) vs pool dua aset (ETH + USDG) vs cadangan berbasis VaR | **Cap 2K.** Invariant keras, satu vault, cap < 0,001% premi untuk tenor MVP. Dua aset = produksi |
| D5 | Aritmetika | `I256` WAD end-to-end vs `i128` Q64.64 internal | **`I256` WAD untuk MVP** — sudah dibangun, bit-identik, 2,6–2,9× pada lingkaran. Terukur: `i128` 29 gas vs `I256` 105 per pasangan mul+div → refactor Q64.64 internal adalah **P1 Hari 11** jika waktu ada (perkiraan rasio lingkaran ~5×; ABI tetap WAD) |
| D6 | Algoritma Φ | Cody erfc vs A&S 26.2.17 | **Cody.** Tidak ada alasan gas di Stylus untuk 1e-7 ketika 1e-15 tersedia; kontrol memakai algoritma sama |
| D7 | Solver IV | Newton + bisection vs Jäckel | **Newton + bisection.** Terverifikasi 3–20 iterasi; Jäckel untuk produksi |
| D8 | MtM NAV | σ_mark(util) (mid) vs σ_mark(0) vs σ_buy | **σ_mark(0) = σ_base × VRP** (direvisi Plan 2): σ_mark(util) membuka sandwich NAV karena util diubah oleh deposit/redeem itu sendiri; trade tetap memakai σ_mark(util) tetapi tidak pernah menembus mark (FR-14). Konservatif hanya saat stale (FR-36) |
| D9 | `r` | konstanta 0 vs parameter | **Parameter, default 0.** Biaya nol; menutup pertanyaan "funding basis?" |
| D10 | Listing | owner-only vs permissionless dengan aturan | **Owner-only untuk MVP.** Permissionless membuka T12 |
| D11 | Withdrawal cooldown | ya/tidak | **P1.** Sebutkan sebagai jawaban T6; jangan bangun sebelum Hari 11 |
| D12 | Kirim UI? | ya/tidak | **Hanya jika Hari 12 selesai tepat waktu.** Video bisa memakai output script |
| D13 | Nama repo publik | — | Hindari kata "oracle" di nama (produk ini justru menghapusnya) |
| D14 | Fallback otomatis ke `BlackScholesSol` bila panggilan Stylus revert (program tidak aktif) | ya/tidak | **Tidak untuk MVP.** Menambah jalur kode yang sulit diuji di L3; reaktivasi permissionless sudah cukup. Sebutkan sebagai opsi produksi di T7 |
| D15 | Basis util/cap | kas live vs kapital referensi di-lag | **Di-lag 1 hari, `min(live, snapshot)`.** Biaya: kapital LP baru butuh 1–2 hari untuk memperluas kapasitas; penarikan tetap seketika |
| D16 | Harga vs mark | inventaris murni vs klem ke mark | **Klem:** beli ≥ mark ≥ tutup. Biaya: pada util > s/(α(1−s)) ≈ 17,5 % (α 0,3; s 5 %) pool tidak lagi membayar premi di atas mid untuk penutupan yang mengurangi risiko |

---

## 20. GLOSARIUM

| Istilah | Arti |
|---|---|
| **Stylus** | Lingkungan eksekusi WASM di Arbitrum Nitro; kontrak Rust/C/C++ berbagi state & ABI dengan EVM |
| **Ink** | Unit metering internal Stylus; `1 gas = 10.000 ink`. Bukan sumber penghematan |
| **Aktivasi** | Kompilasi WASM → native di node, sekali per program; harus diulang saat versi Stylus naik |
| **Keepalive / expiryDays** | Program kedaluwarsa jika tidak di-keepalive dalam jendela tertentu; permissionless |
| **WAD** | Fixed-point 18 desimal (`1e18 = 1,0`) |
| **Φ / φ** | CDF / PDF distribusi normal standar |
| **Cody erfc** | Aproksimasi rasional Chebyshev untuk erf/erfc (1969), presisi double |
| **A&S 26.2.17** | Aproksimasi Φ Abramowitz-Stegun, error absolut ~7,5e-8; lazim di Solidity |
| **IV / σ_mark** | Implied volatility; σ yang dipakai pool untuk mid-price = σ_base × VRP × (1 + α·util) |
| **σ_base** | Realized vol EWMA dari observasi Chainlink on-chain |
| **VRP** | Vol risk premium — rasio IV/RV yang dikenakan pool |
| **util_vega** | `netVega / vegaCap`; ukuran inventaris pool |
| **Capped call** | Call dengan payout `min(S_T − K, K)`; dihargai `C(K) − C(2K)` |
| **Board / seri** | Board = satu expiry; seri = (expiry, strike, call/put) → satu id ERC-1155 |
| **reserved** | Σ OI × K — kewajiban maksimum pool; tidak pernah bisa ditarik LP |
| **escrowedPayouts** | Payout yang sudah pasti setelah settle, menunggu `claim` |
| **NAV konservatif** | `saldo − escrowed − reserved`; dipakai `withdraw` saat oracle stale |
| **DOV** | DeFi Option Vault — vault yang menjual opsi secara pasif |

---

## 21. SUMBER TEKNIS YANG DIPAKAI DOKUMEN INI

- Arbitrum Stylus — pengantar, cara kerja, gas & ink, aktivasi, caching: `https://docs.arbitrum.io/stylus/gentle-introduction`, `https://docs.arbitrum.io/stylus/concepts/how-it-works`, `https://docs.arbitrum.io/stylus/concepts/gas-metering`, `https://docs.arbitrum.io/stylus/how-tos/caching-contracts`
- Stylus SDK (Rust): `https://github.com/OffchainLabs/stylus-sdk-rs` — `cargo-stylus`: `https://github.com/OffchainLabs/cargo-stylus` — contoh: `https://stylus-by-example.org`
- Nitro devnode (Stylus lokal): `https://github.com/OffchainLabs/nitro-devnode`
- Chainlink — alamat feed Arbitrum & L2 Sequencer Uptime Feeds: `https://docs.chain.link/data-feeds/price-feeds/addresses?network=arbitrum`, `https://docs.chain.link/data-feeds/l2-sequencer-feeds`
- PRBMath (`exp`, `ln`, SD59x18): `https://github.com/PaulRBerg/prb-math`
- Paxos Global Dollar (USDG) — dokumentasi & alamat kontrak: `https://paxos.com/usdg/`, `https://docs.paxos.com`
- Lyra v1 — whitepaper & `BlackScholes.sol` (prior art on-chain BS + IV AMM): `https://github.com/lyra-finance/lyra-protocol`
- Premia v3 — dokumentasi (IV oracle): `https://docs.premia.blue`
- W. J. Cody, "Rational Chebyshev approximations for the error function," *Math. Comp.* 23 (1969) 631–637
- M. Abramowitz & I. Stegun, *Handbook of Mathematical Functions*, §26.2.17
- P. Jäckel, "Let's Be Rational" (2015) — solver IV alternatif
- J. C. Hull, *Options, Futures, and Other Derivatives* — rumus BS & Greeks
- RiskMetrics Technical Document (1996) — EWMA λ = 0,94
- Skrip verifikasi angka dokumen ini: `tools/reference/bs_numbers.py`, `tools/reference/bs_extra.py` (Python 3, hanya stdlib) — sudah ada di direktori proyek; jalankan untuk meregenerasi setiap tabel §6
- Emulasi integer eksak (spesifikasi eksekusi Rust & Solidity): `tools/reference/wad_emul.py`; generator konstanta & vektor: `tools/reference/gen_constants.py`, `tools/reference/gen_vectors.py`; benchmark: `tools/bench/bench.sh` — semuanya dibuat lewat Plan 1 (`docs/superpowers/plans/2026-09-19-equinox-quant-core.md`)
- Stylus SDK README (tidak ada float; no_std didukung): `https://github.com/OffchainLabs/stylus-sdk-rs/blob/main/README.md`; `nitro-devnode`: `https://github.com/OffchainLabs/nitro-devnode`; image node: `offchainlabs/nitro-node:v3.11.4-7d5ac27`
