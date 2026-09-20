# Benchmark gas — Stylus vs Solidity (bit-identik)

Lingkungan: `nitro-devnode` `offchainlabs/nitro-node:v3.11.4-7d5ac27` di-upgrade ke ArbOS 61 (Stylus v3), L1 fee = 0;
`cargo-stylus`/`stylus-sdk` 0.10.9, rustc 1.92, `opt-level = 3`, stack 16 KiB, 2 fragmen, tanpa cache;
kontrol `solc 0.8.28` via-IR (200 runs), PRBMath v4.1.0. Pengukuran: `gasleft()` di sekitar `STATICCALL` dari `Bench.sol`.
Kolom "cached" = terukur − (programInitGas uncached − cached), turunan (CacheManager devnode adalah stub). Turunan ini dikonfirmasi langsung di Arbitrum Sepolia dengan program yang benar-benar cached — identik sampai satuan gas (bagian "Verifikasi di Arbitrum Sepolia" di bawah).
Angka di PRD §13 berasal dari build spike (WASM 34.346 byte; programInitGas 31.333/4.961; tabel referensi di rencana Task 14 memakai 31.376/4.997). Build repo ini: lihat baris programInitGas di bawah — selisih sel ≤ ~2% pada kolom terukur dan hingga ~5% pada kolom turunan; kesimpulan tidak berubah.
Setiap operasi yang di-benchmark menghasilkan bytes return yang identik pada kedua implementasi (dibandingkan otomatis oleh tools/bench/bench.sh); 20 pemeriksaan bit-eksak tambahan terhadap emulasi Python ada di tools/bench/onchain-check.sh.

programInitGas: uncached=30919 cached=4623 (kolom cached = terukur − 26296, turunan)

| Operasi | Solidity (kontrol) | Stylus tanpa cache | Stylus cached (turunan) | Rasio cached |
|---|---|---|---|---|
| normCdf(-0.5456)                           |      5435 |     34623 |      8327 |   0.6× |
| exp(-1)                                    |      6144 |     35256 |      8960 |   0.7× |
| ln(2)                                      |      3559 |     33974 |      7678 |   0.5× |
| quote C4200 7d 60% (harga+4 Greeks)        |     24536 |     41133 |     14837 |   1.6× |
| cappedCall C4200 cap 8400                  |     40886 |     46511 |     20215 |   2.0× |
| impliedVol C4200 (5 iterasi)               |    121321 |     73485 |     47189 |   2.6× |
| impliedVol P2600 deep-OTM (20 iterasi)     |    616839 |    249669 |    223373 |   2.8× |
| ewmaUpdate                                 |     22104 |     40725 |     14429 |   1.5× |
| markPortfolio 32 seri (1 panggilan)        |   1242892 |    453744 |    427448 |   2.9× |

## Verifikasi di Arbitrum Sepolia (program cached)

Deploy 20 Sep 2026 (`deployments/arbitrum-sepolia.json`, chain 421614, ArbOS 116 / Stylus v3): program Stylus `0xb3b37050a40b9755001bddd29cc5df17a59f51d4` (34.414 byte, 2 fragmen; data fee aktivasi 0,000152 ETH = 0,000126 ETH + bump 20 %), `BlackScholesSol` `0x5B239AE1510AED1Bb21EB9d2e8A471D45720c4B3`, `Bench` `0x5801Aa89eAdABDE9ea21D2e26858760F8B71f346`. `programInitGas` 30.919/4.623 dan 1 halaman memori — identik dengan devnode. `tools/bench/onchain-check.sh deployments/arbitrum-sepolia.json`: 20 × OK (bit-eksak terhadap emulasi Python, kedua implementasi).

`cargo stylus cache bid <program> 0` diterima (`ArbWasmCache.codehashIsCached == true`), sehingga kolom "cached" dapat diukur langsung, bukan diturunkan:

| Operasi | Solidity (kontrol) | Stylus cached, terukur di Sepolia | Kolom turunan devnode | Rasio cached |
|---|---|---|---|---|
| normCdf(-0.5456) | 5435 | 8327 | 8327 | 0,7× |
| exp(-1) | 6144 | 8960 | 8960 | 0,7× |
| ln(2) | 3559 | 7678 | 7678 | 0,5× |
| quote C4200 7d 60% (harga+4 Greeks) | 24536 | 14837 | 14837 | 1,7× |
| cappedCall C4200 cap 8400 | 40886 | 20215 | 20215 | 2,0× |
| impliedVol C4200 (5 iterasi) | 121321 | 47189 | 47189 | 2,6× |
| impliedVol P2600 deep-OTM (20 iterasi) | 616839 | 223373 | 223373 | 2,8× |
| ewmaUpdate | 22104 | 14429 | 14429 | 1,5× |
| markPortfolio 32 seri (1 panggilan) | 1242892 | 427448 | 427448 | 2,9× |

Semua sembilan sel terukur sama persis dengan turunan `terukur − 26.296` dari devnode, dan kolom Solidity juga identik — kesimpulan §13 PRD tidak berubah: 2,6–2,9× pada lingkaran (solver, MtM), < 1× untuk panggilan tunggal kecil. Catatan alat: `tools/bench/bench.sh` pada deployment yang sudah cached mencetak angka cached di kolom "tanpa cache" dan kolom "turunan"-nya menjadi negatif (mengurangkan 26.296 dua kali) — untuk deployment cached, baca kolom terukur saja.

## Transaksi pool end-to-end (devnode, dua pool identik, `tools/e2e/pool-e2e.sh`)

Pool A memakai `BlackScholesSol` (kontrol), Pool B memakai program Stylus; keduanya di-deploy lewat `EquinoxFactory` oleh `PoolE2EDeployer` dalam satu transaksi, lalu dijalankan dengan input identik lewat `cast` (`forge script` tidak bisa mengeksekusi WASM). Kuotasi (`quoteBuy`, 6 field), NAV, σ_mark, cadangan, dan kas keduanya identik byte-per-byte. Gas = `gasUsed` receipt (L1 fee = 0). Run 19 Sep 2026 setelah gelombang perbaikan (kode commit 6583367: satu evaluasi NAV per `deposit`).

| Operasi | Gas A (kontrol Solidity) | Gas B (Stylus) | Rasio |
|---|---|---|---|
| `buy` 10 C 4.200 (ERC-20 + ERC-1155 + 5 panggilan math: 3× `sqrt` + 2× `cappedCall`) | 387.211 | 367.932 | 1,05× |
| `close` 5 (ERC-20 + ERC-1155 + 5 panggilan math: 3× `sqrt` + 2× `cappedCall`) | 254.792 | 235.533 | 1,08× |
| `deposit` dengan 6 seri terbuka (NAV via satu `markPortfolio`; 3 panggilan math: 2× `sqrt` + 1× `markPortfolio`) | 219.538 | 220.352 | 0,99× |

Seperti diprediksi PRD §13: transaksi end-to-end didominasi storage EVM, transfer ERC-20/ERC-1155, dan overhead panggilan; keunggulan Stylus pada matematika (2,6–2,9× untuk solver/MtM) hampir tidak terlihat di tingkat transaksi — matematika hanya ≈ 27 % (Solidity) / 23 % (Stylus) dari gas `buy`, dan gas non-matematika kedua pool identik (selisih receipt A − B sama persis dengan selisih jumlah frame `math` di `debug_traceTransaction`). Jumlah panggilan math per baris diverifikasi dengan callTracer pada kedua pool.

Catatan pengukuran:
- Kolom Stylus memuat premi inisialisasi program **tanpa cache** (`programInitGas` 30.919 vs 4.623 cached; panggilan Stylus pertama dalam satu transaksi ≈ 31k gas untuk `sqrt`, berikutnya ≈ 5k) karena CacheManager devnode adalah stub. Di Sepolia/One dengan program di-cache, kolom B turun ≈ 26k gas per transaksi — keuntungan tambahan yang tidak diklaim di tabel.
- Baris `deposit` 0,99× (219.538 vs 220.352): dengan satu `markPortfolio` atas satu seri hidup (5 seri lain ber-OI 0 dilewati), kolom Stylus tidak lagi mengamortisasi premi inisialisasi ≈ 31k itu — konsisten dengan temuan Plan 1: loop menang, panggilan tunggal kecil tidak. Sebelum gelombang perbaikan (NAV dievaluasi dua kali per `deposit`) baris ini 291.893 vs 263.429 (1,10×). Per panggilan di dalam trace yang sama Stylus tetap lebih murah — `cappedCall` 50.899 vs 22.586 (2,25×), `markPortfolio` 6 seri 56.343 vs 23.277 (2,42×), angka Stylus untuk panggilan non-pertama (trace Task 7, sebelum gelombang perbaikan; kontrak `math` tidak berubah).
- Harness mengirim transaksi A dan B berurutan; sepasang bisa mengapit batas detik wall-clock devnode sehingga waktu-ke-expiry berbeda 1 detik dan NAV/kas berbeda beberapa ratus unit 1e-6 USDG (terlihat pada satu dari tiga run setelah gelombang perbaikan: Δ 381 unit pada pasangan `close`; tiga run Task 7 sebelumnya bersih). Pemeriksaan identitas hanya sah untuk pasangan yang mendarat di blok dengan timestamp sama — run yang miring cukup diulang. Gas bervariasi ≤ ≈ 0,3 % antar run; rasio stabil (±0,01×).

## Transaksi pool di Sepolia (engine σ bersama, program cached)

Dua pool live di Arbitrum Sepolia (`deployments/arbitrum-sepolia.json` → `pools`, deploy blok 310687948): A = kontrol `BlackScholesSol` (`0x627b099c3e475f851d15ca9f261cd2f5b8b8be08`), B = Stylus (`0x7f79616217cc49edea777108b60981d7bf807cc9`), feed Chainlink ETH/USD asli (`0xd30e2101a97dcbaebcbc04f14c3f624e67a35165`); **satu `EquinoxVolEngine` bersama** (`0xc331031a1730a567fd9149d5950912a1cdcb6a3e`, math Stylus; keputusan K4 spec Plan 3 — dua engine terpisah tidak bisa tetap identik pada feed hidup karena `poke()` hanya mengamati round terakhir dan tiap trade hanya mem-poke engine pool-nya sendiri) sehingga σ_base/σ_mark(0) identik by construction — σ_mark(util) tetap per pool, karena util memuat inventaris pool itu. Karena `sqrt` σ dan `ewmaUpdate` dijalankan engine yang sama untuk kedua pool, selisih gas `buy`/`close` di sini hanya 2 panggilan pricing (`cappedCall` untuk call, `quote` untuk put; Solidity di A, Stylus cached di B) — **bukan apples-to-apples seperti tabel devnode di atas** (dua engine, feed mock statis), yang tetap menjadi benchmark rujukan. Rasio di sini juga tidak sebanding dengan rasio devnode 1,05–1,08×: kolom A ikut membayar `sqrt` Stylus lewat engine bersama dan kolom B tidak lagi membayar premi inisialisasi ≈ 26k gas (cached) — dua efek yang sama-sama menaikkan rasio, bukan bukti Stylus makin unggul. Variabel ketiga: setiap `buy`/`close` memanggil `vol.poke()` — no-op murah bila round Chainlink belum berubah, jalur EWMA penuh ≈ +25k gas bila round baru tampak — sehingga hanya pasangan yang menempuh jalur sama yang setara. Angka = `gasUsed` receipt dari `docs/DEMO_LOG.md` (run 2026-09-20T00:31:58Z, board 25 Sep 2026, program Stylus cached):

| Operasi (Sepolia, cached, engine σ bersama) | Gas A (kontrol) | Gas B (Stylus) | Rasio |
|---|---|---|---|
| `buy` 10 C 2.800 — **tidak setara**: A menempuh jalur `poke` penuh, B no-op | 422.695 | 345.781 | 1,22× tercetak; ≈ 1,15× setara (≈ 25k gas `poke` dikurangkan dari A) |
| `buy` 1 P 2.400 (keduanya jalur `poke` penuh; A = tx ulangan, lihat insiden) | 345.760 | 312.273 | 1,11× |
| `close` 5 C 2.800 (keduanya `poke` no-op) | 265.191 | 212.988 | 1,25× |

Kuotasi `quoteBuy` 10 C 2.800 identik byte-per-byte pada blok yang sama: premi 268,181826 USDG @ σ_buy 0,667412 di A dan B pada blok 310700824 — kedua buku masih identik pada blok itu. Klaim identitas live = **paritas matematika** pada kedua alamat `math` (K5 spec Plan 3: input identik S, K, t, σ → harga identik byte-per-byte; `onchain-check` 20/20 dan panggilan langsung), bukan kuotasi pool byte-identik: kuotasi pool sah berbeda lewat suku util begitu histori trade berbeda, dan `sepolia-demo.sh` membandingkan kuotasi pool byte-per-byte hanya bila `netVega` dan kapital-untuk-cap (`min(kas − escrow, capitalRefPrev)`) sama pada blok itu, selain itu membandingkan paritas math langsung pada kedua `math` (input dari tuple kuotasi), mereproduksi premi tiap pool dari `math`-nya sendiri, dan mencetak Δ kuotasi (`--check` menjalankan blok itu saja, read-only). NAV/kas (`totalAssets`, `freeLiquidity`) A vs B dapat berbeda beberapa ratus unit bila tx A dan B mendarat pada detik yang berbeda (waktu-ke-expiry berbeda 1 s) — artefak harness sekuensial, bukan model. Di run ini artefaknya lebih besar karena put A diisi ulang pada round Chainlink lain (lihat insiden): `reserved` dan `escrowedPayouts` identik, tetapi `totalAssets` berbeda 0,53 USDG dan `netVega` 1,64 vega (blok 310703512), sehingga suku inventaris σ_mark(util) — bukan matematikanya — kini membuat kuotasi A/B berbeda ≈ 0,0006 USDG (≈ 2 × 10⁻⁵ relatif) selama posisi ini terbuka (1 C 2.800 pada blok 310714347: 25,140896 vs 25,141500 USDG; σ_mark(0) dari engine bersama tetap identik).

Insiden run ini (tidak disembunyikan): tx `buy` 1 P 2.400 pertama di Pool A **gagal out-of-gas** — `gasUsed == gasLimit` 349.720. Limit itu adalah estimasi `eth_estimateGas` Nitro apa adanya, yakni gas minimum tanpa margin, dan gas minimum panggilan ini naik bersama `block.timestamp` (≈ 750 gas dalam 2 s sebelum tx masuk). `cast send` keluar 0 pada receipt `status 0`, sehingga tx gagal sempat tercatat seolah sukses. `send` di `tools/sepolia/lib.sh` sejak itu memasang gas limit 1,5 × estimasi dan gagal keras bila `status 0`; tx diulang (345.760 gas, baris di atas). Post-mortem lengkap dengan replay estimasi per blok: `docs/DEMO_LOG.md`.

## Micro-benchmark biaya marjinal (gas per pasangan mul_wad + div_wad, loop 1.000 iterasi)

Program micro-benchmark (loop 1.000 iterasi) berasal dari spike 19 Sep 2026 dan tidak disertakan di repo; angkanya tidak dapat direproduksi dari tooling repo ini.

| Tipe | gas / pasangan |
|---|---|
| EVM Solidity (`MUL`/`DIV` 5 gas) | ≈ 30–40 |
| Stylus `I256` (ruint, limb 64-bit) | 105 |
| Stylus `i128` Q64.64 | 29 |
| Stylus `u64` | 0,5 |

Kesimpulan: rasio 2,6–2,9× pada lingkaran datang dari alur kontrol/loop/ABI yang murah di WASM; aritmetika 256-bit itu sendiri 3× lebih mahal daripada opcode EVM. Bukan 10×. Lihat PRD §13 dan §2.4.
