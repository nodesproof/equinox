# Benchmark gas — Stylus vs Solidity (bit-identik)

Lingkungan: `nitro-devnode` `offchainlabs/nitro-node:v3.11.4-7d5ac27` di-upgrade ke ArbOS 61 (Stylus v3), L1 fee = 0;
`cargo-stylus`/`stylus-sdk` 0.10.9, rustc 1.92, `opt-level = 3`, stack 16 KiB, 2 fragmen, tanpa cache;
kontrol `solc 0.8.28` via-IR (200 runs), PRBMath v4.1.0. Pengukuran: `gasleft()` di sekitar `STATICCALL` dari `Bench.sol`.
Kolom "cached" = terukur − (programInitGas uncached − cached), turunan (CacheManager devnode adalah stub).
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

## Micro-benchmark biaya marjinal (gas per pasangan mul_wad + div_wad, loop 1.000 iterasi)

Program micro-benchmark (loop 1.000 iterasi) berasal dari spike 19 Sep 2026 dan tidak disertakan di repo; angkanya tidak dapat direproduksi dari tooling repo ini.

| Tipe | gas / pasangan |
|---|---|
| EVM Solidity (`MUL`/`DIV` 5 gas) | ≈ 30–40 |
| Stylus `I256` (ruint, limb 64-bit) | 105 |
| Stylus `i128` Q64.64 | 29 |
| Stylus `u64` | 0,5 |

Kesimpulan: rasio 2,6–2,9× pada lingkaran datang dari alur kontrol/loop/ABI yang murah di WASM; aritmetika 256-bit itu sendiri 3× lebih mahal daripada opcode EVM. Bukan 10×. Lihat PRD §13 dan §2.4.
