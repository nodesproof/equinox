# Equinox — log demo live di Arbitrum Sepolia

> **Summary (English).** Every transaction of the live demo on Arbitrum Sepolia, one section per run of `tools/demo/sepolia-demo.sh`, with Arbiscan links. Pool A = Solidity control (`BlackScholesSol`), Pool B = Stylus program (cached); both share one volatility engine fed by the real Chainlink ETH/USD feed (decision K4), so σ_base/σ_mark(0) are identical by construction while each pool's quote carries its own inventory term.
> Run of 20 Sep 2026 00:31 UTC, board 0 (expiry Fri 25 Sep 2026 08:00 UTC), spot 2,627.97 USD: `quoteBuy` 10 C 2800 returned **268.181826 USDG @ σ_buy 0.667412 on both pools at block 310700824 — byte-identical** (both books were still identical at that block); then `buy` 10 C 2800, `buy` 1 P 2400 and `close` 5 C 2800 on both pools. Like-for-like gas pairs (same `poke` path): `buy` 1 P 2400 345,760 (A) vs 312,273 (B), `close` 5 C 2800 265,191 vs 212,988; the `buy` 10 C 2800 pair (422,695 vs 345,781) is not like-for-like because A ran the full EWMA `poke` path.
> One transaction **failed out-of-gas** and is kept in the log: `cast send` used Nitro's zero-margin `eth_estimateGas` as the gas limit, the call's minimum gas rose ≈ 750 with `block.timestamp` before inclusion, and `cast send` reported the status-0 receipt as success. `send()` in `tools/sepolia/lib.sh` now pads the limit to 1.5× and fails on `status 0`; the trade was repeated; the per-block estimate replay is in the note below the table.
> Because the repeat filled against a later Chainlink round, the two books now differ by ≈ 1.6 vega (`netVega` at block 310703512: 541.07 vs 542.70), so the inventory term of σ_mark(util) makes pool quotes differ by ≈ 2 × 10⁻⁵ relative (1 C 2800 at block 310714347: 25.140896 vs 25.141500 USDG) while these positions are open; σ_mark(0) from the shared engine stays identical.
> The live identity claim is therefore **math parity** (decision K5): both `math` contracts return byte-identical prices for identical inputs (S, K, t, σ) — `tools/bench/onchain-check.sh` 20/20, the dashboard's Parity column per series, and `sepolia-demo.sh --check` (read-only) — not byte-identical pool quotes; the demo script compares pool quotes byte-for-byte only when both pools carry identical inventory at that block, otherwise it prints the Δ.
> State rows are read at one block (310703512): `reserved` (16,400 USDG) and `escrowedPayouts` (0) equal on A and B; `totalAssets`/`freeLiquidity` differ by a few hundred 1e-6 units and `netVega` by the timestamp skew of sequential transactions, not by the model.
> Next entry: the first real settlement of board 0 (Fri 25 Sep 2026 08:00 UTC — scheduled, not done yet) and `--claim`, which appends settlement prices, transactions and payouts here.
> **Pool C (20 Sep 2026 13:57 UTC, section below):** a third pool identical to Pool B (same Stylus math, same shared engine, same config) but whose asset is the **real Paxos USDG on Arbitrum Sepolia** (`0xFFC95faa3d63Cde504a05B567C600B78C0b41892`, 6 dp, Sourcify exact match), created through the existing factory in one transaction (4,976,404 gas) plus the same two boards (25 Sep, 2 Oct). Its `mint` is permissioned and the Paxos faucet gives 100 USDG per wallet per day, so Pool C runs at a scale of hundreds of USDG. The 100 USDG seed deposit is done (two real transactions; NAV 100 USDG, `capitalRefPrev` bootstrapped); the first trade then blocked on the token's own `InsufficientFunds()` because the owner wallet was both the sole LP and the sole trader and had deposited its entire faucet grant as LP capital. **Resolved**: a new `pool-c.sh redeem` redeemed 10 of the 100 USDG back from Pool C to the owner (real tx), after which `buy 0.01`/`close 0.01` C K1 (board 1, 2 Oct) executed and settled fully in real Paxos USDG (net round-trip cost 0.264867 USDG). LP #2 (keeper) still waits for its own faucet request; logged below.

Setiap bagian = satu run `tools/demo/sepolia-demo.sh`. Pool A = kontrol `BlackScholesSol`, Pool B = Stylus; engine σ bersama (K4). Tautan = Arbiscan Sepolia.

## 2026-09-20T00:31:58Z — `--trade` board 0 (expiry 2026-09-25T08:00:00Z) @ blok 310700824

Spot Chainlink: **2627.970000 USD**; σ_base 0.549677; σ_mark(0) 0.632129.

| Langkah | Pool A (kontrol) | Pool B (Stylus) |
|---|---|---|
| quoteBuy 10 C 2800 (blok 310700824) | premi 268.181826 USDG @ σ_buy 0.667412 | identik ✓ |
| buy 10 C 2800 | [422695 gas](https://sepolia.arbiscan.io/tx/0x817ebf9709d8bddc4dda75264f8b4964cbe2ada029f60907c28dbba11bb66674) | [345781 gas](https://sepolia.arbiscan.io/tx/0x1815a3fa652b6436aba283fa26c4cf1c0275deea259066f6969e85e95c9e7ff5)  rasio 1.22× |
| quoteBuy 1 P 2400 | premi 13.144951 USDG (floor 5 bps × K = 1.200000: mid > floor) | — |
| buy 1 P 2400 | ✗ out-of-gas [349720 gas = gasLimit](https://sepolia.arbiscan.io/tx/0x1262c6cb7975acd5b1265a98e877a58d727f231a98a4dbbe29897fed38a39386) → ulang [345760 gas](https://sepolia.arbiscan.io/tx/0x64bc18c558346d3250fd7d78ea01642cff4b5f6161d507a85906cd48f5f562b7) | [312273 gas](https://sepolia.arbiscan.io/tx/0x2981f39237082e0b46c40020cddd3d632293275cfe4f80e6e825389f17b4d2d2)  rasio 1.11× |
| close 5 C 2800 | [265191 gas](https://sepolia.arbiscan.io/tx/0xae180f380e6cc32877899cdadafeb28924d81b5b0bf6b2711558baf18478677a) | [212988 gas](https://sepolia.arbiscan.io/tx/0xe4172809e83fe8fc5c69cba3ea2bbe8b3b326ab35cc2d896e7c8457265ce4dd8)  rasio 1.25× |
| totalAssets @ blok 310703512 | 1000048415780 | 1000048943783 (≠ — timestamp tx A/B berbeda, lihat BENCHMARK) |
| reserved @ blok 310703512 | 16400000000000000000000 | 16400000000000000000000 ✓ |
| netVega @ blok 310703512 | 541068014738398755298 | 542704017790895033657 (≠ — timestamp tx A/B berbeda, lihat BENCHMARK) |
| escrowedPayouts @ blok 310703512 | 0 | 0 ✓ |
| freeLiquidity @ blok 310703512 | 983778578937 | 983779106940 (≠ — timestamp tx A/B berbeda, lihat BENCHMARK) |
| sigmaMarkNow @ blok 310703512 | 633835358518330346 | 633841560124872602 |

Catatan run ini: tx `buy 1 P 2400` di Pool A yang pertama (0x1262c6cb…) **gagal out-of-gas** — `gasUsed == gasLimit` 349.720. Mekanismenya: `cast send` memakai `eth_estimateGas` Nitro apa adanya, dan estimasi itu adalah gas minimum yang lolos, tanpa margin (pada lima tx lain `gasUsed` hanya 5–7k di bawah `gasLimit`). Replay `cast estimate` panggilan yang sama per blok: 326.003 / 325.971 / 325.975 pada blok 310700886–888 (round Chainlink …386, `updatedAt` 1789864333, belum tampak di L2), 349.744 / 349.741 pada 310700889–890 (round tampak, ts 1789864333), 350.306–350.314 pada 310700891–894 (ts …334), 350.470 / 350.476 pada 310700895–896 (ts …335). Limit 349.720 sama dengan estimasi jalur `poke` penuh pada ts …333 — estimasi sudah memuat round baru; **tidak ada perpindahan jalur** antara estimasi dan eksekusi. Yang bergerak adalah gas minimum panggilan ini terhadap `block.timestamp` (+562 gas pada +1 s, +164 lagi pada +2 s — jalur pricing, bukan komponen L1): tx masuk dua detik kemudian di blok 310700896 (ts …335, minimum ≈ 350.47x) dan kekurangan ≈ 750 gas. Bahaya kedua yang terpisah (tidak terjadi di sini, tetapi nyata): bila round baru mendarat di antara estimasi dan eksekusi, `vol.poke()` berpindah dari no-op ke jalur EWMA penuh — ≈ +25k gas (estimasi `buy` yang sama 325.891 pada state 310700881 tanpa round baru vs 350.470 pada 310700895 dengan round baru). `send` di `tools/sepolia/lib.sh` sejak itu memasang gas limit 1,5 × estimasi — menutup kedua mekanisme — dan gagal keras bila receipt `status 0` (sebelumnya `cast send` keluar 0 dan tx gagal tercatat seolah sukses); tx diulang dengan `send` yang sudah diperbaiki, dan baris keadaan akhir dibaca ulang setelahnya (blok 310703512). Harga isi put dari log `Transfer` USDG (premi + fee, bruto): B 13,760609 USDG, ulangan A 13,107924 USDG — angka 13,144951 pada baris `quoteBuy 1 P 2400` adalah kuotasi sebelum round baru, bukan harga isi. Pembacaan gas: `buy 10 C 2800` di A memuat jalur `poke` penuh (round …385 diamati di blok 310700863) sedangkan B tidak (no-op) — rasio 1,22× melebih-lebihkan selisih ≈ 25k gas (≈ 1,15× setara); `buy 1 P 2400` (keduanya jalur penuh) dan `close 5 C 2800` (keduanya no-op) adalah perbandingan setara.

## Pool C — USDG Paxos asli (20 Sep 2026)

Bukan run `sepolia-demo.sh`: satu pool ketiga, `tools/sepolia/pool-c.sh deploy` + `boards` (owner `0x90351bB1E85a17D5f70c62C0cC076D39D897076D`, `.env`), tanpa kontrak baru dan tanpa menyentuh Pool A/B.

**Temuan yang mendasari (diverifikasi 20 Sep 2026, spec Plan 4 §0):** USDG (Global Dollar, Paxos) **ada** di Arbitrum Sepolia — proxy `0xFFC95faa3d63Cde504a05B567C600B78C0b41892` (`name()` "Global Dollar", `symbol()` USDG, `decimals()` 6, `totalSupply` 111.012,000100 USDG), Sourcify v2 `exact_match` untuk proxy dan implementasinya. `mint` tertutup (revert `AccountMissingSupplyControllerRole` dari EOA acak); satu-satunya jalan mendapatkannya adalah faucet resmi `https://faucet.paxos.com/` — **100 USDG per wallet per hari**. Karena itu Pool A/B tetap memakai MockUSDG (seed 1.000.000 per pool, juri bisa mint), dan Pool C membuktikan jalur aset asli pada skala ratusan USDG.

**Pool C = Pool B dengan aset asli.** `EquinoxFactory(0x2014077542088eCeFf980221CFc7Fa6b96A4F2e5).createPoolWithVol(Deploy, vol)` dengan `usdg` = USDG Paxos, `math` = program Stylus `0xb3b3…51d4` (sama dengan B), `vol` = engine bersama `0xc331…6a3e` (K4: satu engine untuk tiga pool), `feed`/`sequencerFeed`/`owner`/`treasury` = A/B, `cfg` dan `rWad` dibaca on-chain dari Pool B dan diverifikasi ulang setelah deploy (`asset()`, `math()`, `vol()`, `cfg()`, `token().pool()`); `name` "Equinox LP (USDG)", `symbol` "eqC". Dry-run `eth_call` sebelum tx memprediksi alamat `0xebd255c8…` (sama dengan dry-run 20 Sep pagi), `eth_estimateGas` 5.059.913; gas terpakai 4.976.404.

| Langkah | Tx / hasil | Gas | Blok (UTC) |
|---|---|---|---|
| `createPoolWithVol` → Pool C `0xebd255c8324dce0478996d9d40d6642044872e92`, token `0xca00de0e18ea648d716dfc3e9fd00f03009dada3` (`pools(2)`, `poolCount` 3) | [0xedcfbd1f…53fb](https://sepolia.arbiscan.io/tx/0xedcfbd1f7fa25b8267e0ca31754d72084c228a275fe602070bbcd535db6953fb) | 4.976.404 | 310891153 (13:57:58) |
| `createBoard` board 0: expiry 1790323200 (Jum 25 Sep 08:00), strike 2400/2600/2800 | [0x058ad928…4192](https://sepolia.arbiscan.io/tx/0x058ad9289b772ef4324f6d10e4eb156365b36fe9ddab7d4ff0ca7476024e4192) | 616.999 | 310891256 (13:58:24) |
| `createBoard` board 1: expiry 1790928000 (Jum 2 Okt 08:00), strike 2200/2600/3000 | [0xf2821d8a…985c](https://sepolia.arbiscan.io/tx/0xf2821d8acc17fb9ed3ec5e9b7920e0ecd3ec216f8d554a20fbdba42b08bc985c) | 582.913 | 310891327 (13:58:42) |

Board id 0/1 di C sama dengan A/B; enam seri per board (C,P per strike) diturunkan dari `token.seriesId()` dan dicek `series(id).expiry` on-chain, lalu ditulis ke `deployments/arbitrum-sepolia.json` (`pools.C`, `boards[].seriesIds.C`, `boards[].listTx.C`). Sourcify: `EquinoxPool (C)` dan `EquinoxOptionToken (C)` `exact_match` (creation + runtime; bytecode identik dengan A/B, dicocokkan otomatis beberapa menit setelah deploy) — `tools/sepolia/verify.sh` 14/14 verified. Keeper (`DRY_RUN=1 tools/keeper/keeper.sh`) kini membaca tiga pool dari manifest: board 0/1 @ C "belum bisa settle (BoardNotExpired)".

Keluaran `tools/sepolia/pool-c.sh status` setelah board (13:59 UTC):

```
Pool C 0xebd255c8324dce0478996d9d40d6642044872e92 · asset 0xffc95faa3d63cde504a05b567c600b78c0b41892 · math 0xb3b37050a40b9755001bddd29cc5df17a59f51d4 · vol 0xc331031a1730a567fd9149d5950912a1cdcb6a3e
cfg C == cfg B: ya
NAV 0 · free 0 · reserved 0 · capitalRefPrev 0 · boards 2
USDG asli: owner 100000000 · keeper 0 · pool 0
```

### Seed — 100 USDG asli dari owner (20 Sep 2026 14:12–14:13 UTC)

`tools/sepolia/pool-c.sh seed 100` dari owner. Allowance USDG asli owner → Pool C masih 0, jadi skrip mengirim `approve` dulu, baru `deposit`:

| Langkah | Tx | Gas | Blok (UTC) |
|---|---|---|---|
| `approve(Pool C, MAX)` | [0xa80a97c2…04872](https://sepolia.arbiscan.io/tx/0xa80a97c25bbc03959b9b1a18ecd7fed22d7178521bc488ba3202e6c1d7c04872) | 58.325 | 310894714 (14:12:57) |
| `deposit(100000000, owner)` — 100 USDG | [0x96efa81f…c1da3](https://sepolia.arbiscan.io/tx/0x96efa81f0038e99ac3af299caf03689b1dd70a5744a3548d3e51cb75e8bc1da3) | 390.963 | 310894728 (14:13:00) |

Setelah `deposit`: `shares` owner 100000000 (1:1 — deposit pertama), `NAV` (`totalAssets`) 100000000 (100 USDG), `capitalRefPrev` 100000000000000000000 (1e20 = 100 USDG dalam WAD — `_bootstrapCapitalRef` jalan seketika di deposit pertama, sama seperti A/B), `reserved` masih 0. Ini murni kapital LP; premi belum dibayar siapa pun pada titik ini.

### Trade pertama — diblokir oleh batas faucet, bukan bug (20 Sep 2026 14:20 UTC)

`tools/sepolia/pool-c.sh trade 0.01` mencoba beli lalu tutup 0,01 unit C K1 (strike 2600, board 1, expiry 2 Okt) di Pool C. `quoteBuy` (view, blok 310896537): premi 1,225719 USDG + fee 0,036772 USDG (σ_buy 0,731842, S 2.573,672369 USD) — tapi simulasi jalur eksekusi (`buy` lewat `eth_call --from owner`, dipakai skrip untuk menghitung batas kirim *sebelum* tx nyata dikirim, sesuai catatan brief bahwa `buy`/`close` men-poke vol engine dulu) **revert** dengan `data 0x356680b7`. Selector itu adalah `InsufficientFunds()` — error kustom milik token USDG sendiri, bukan `EquinoxPool` (dicocokkan dari ABI facet implementasi USDG `0x0643bc7146aB7a2dd4Ea10d506bA95e1b933b236` via Sourcify v2, dikonfirmasi silang di openchain.xyz dan 4byte.directory).

Akar masalah: di demo ini owner adalah LP **dan** trader yang sama. Seed di atas menyetor seluruh 100 USDG (batas faucet 100/wallet/hari) sebagai kapital LP, sehingga saldo USDG asli milik owner sendiri sekarang **0** (`balanceOf(owner)` = 0; allowance ke Pool C tetap MAX − 100000000, tidak jadi terpakai). `buy()` menarik premi dari `msg.sender` lewat `transferFrom` — 0 saldo < ~1,26 USDG premi → revert. **Tidak ada transaksi nyata yang terkirim**: nonce owner tetap 284 sebelum dan sesudah percobaan ini; hanya panggilan simulasi baca (`cast call`, tanpa gas nyata) yang revert. Sesuai batasan tugas ("jangan retry buta"), percobaan dihentikan di sini — tidak ada perubahan ukuran trade atau tx susulan yang dikirim.

`tools/sepolia/pool-c.sh status` dan `tools/demo/sepolia-demo.sh --check` (read-only, A/B) sesudahnya:

```
Pool C 0xebd255c8324dce0478996d9d40d6642044872e92 · asset 0xffc95faa3d63cde504a05b567c600b78c0b41892 · math 0xb3b37050a40b9755001bddd29cc5df17a59f51d4 · vol 0xc331031a1730a567fd9149d5950912a1cdcb6a3e
cfg C == cfg B: ya
NAV 100000000 · free 100000000 · reserved 0 · capitalRefPrev 100000000000000000000 · boards 2
USDG asli: owner 0 · keeper 0 · pool 100000000
```

`--check` blok 310895991 tetap hijau untuk A/B: paritas math byte-identik, kuotasi A vs B berbeda hanya karena inventaris (seperti run-run sebelumnya) — Pool C tidak menyentuh A/B.

Jujur soal skala dan status pada titik itu: seed 100 USDG **selesai** (dua tx nyata, tabel di atas); trade pertama dalam USDG asli **belum** — diblokir oleh batas faucet itu sendiri (bukan oleh kontrak, bukan oleh skrip). Wallet keeper masih 0 USDG — LP kedua menunggu permintaan faucet hariannya sendiri. Kapital demo utama (1.000.000 USDG per pool) tetap di Pool A/B dengan mock.

### Resolusi — redeem 10 USDG, trade pertama selesai dalam USDG asli (20 Sep 2026 14:28 UTC)

Ralat aturan main dari controller: brief semula meminta seluruh 100 USDG faucet owner disetor sebagai kapital LP, padahal wallet yang sama juga jadi trader — itu sendiri yang membuat saldo trader 0. Perbaikannya bukan kontrak baru, tapi kapital LP ditarik sebagian: subcommand baru `tools/sepolia/pool-c.sh redeem [USDG=10]` (cermin `seed`, hanya kunci owner) memanggil `redeem(shares, owner, owner)` ERC-4626 setelah mengecek `maxRedeem(owner) ≥ UNITS` dan `freeLiquidity() ≥ UNITS` (kalau kurang: `die`, bukan menyesuaikan jumlah sendiri).

| Langkah | Tx | Gas | Blok (UTC) |
|---|---|---|---|
| `redeem(10000000, owner, owner)` — 10 USDG | [0xac24d01e…3ca1f42](https://sepolia.arbiscan.io/tx/0xac24d01e5c60ba94d71b51724323a6d9871b3c6ae9fecfcccd7b277453ca1f42) | 287.498 | 310898302 (14:28:02) |

Sesudah redeem: shares owner 90000000, NAV 90000000 (90 USDG tetap di Pool C sebagai kapital LP), USDG asli owner 10000000 (10 USDG, sekarang tersedia untuk trader). `capForCaps` = min(freeLiquidity 90, capitalRefPrev 100) = 90 USDG — trading tetap aktif, seperti prediksi ruling.

`tools/sepolia/pool-c.sh trade 0.01` (beli lalu tutup 0,01 unit C K1, board 1, 2 Okt) berjalan sampai selesai kali ini:

```
buy 0.01 C(board 1, K1) di C: quote 1258407+37753 · exec 1258406 · max 1309120 · https://sepolia.arbiscan.io/tx/0x3ae0a152da8adab0ac10ec13efa702378f27ca2fbdea120e43690050b3994ffc gas=373191
close 0.01 di C: exec 993533 · min 983597 · https://sepolia.arbiscan.io/tx/0xd937a99260520bf6b3184b33dc72e3a8bfc8b363e1050f2889cb845dc24affff gas=199405 · posisi sisa 0
```

Sebelum `buy`, skrip sempat mengirim satu `approve(Pool C, MAX)` tambahan yang tidak tercetak di baris di atas (`>/dev/null`) — bug lama di baris pengecekan allowance `trade)`: allowance owner sudah ~MAX (sisa dari `seed`, ≈1,1579×10⁷⁷), dan perbandingan `[ … -ge … ]` bash gagal ("integer expression expected") karena angka itu jauh melebihi jangkauan integer bash; `||` lalu tetap memicu `send` approve. Transaksinya nyata dan tidak berbahaya (re-approve MAX yang sudah ~MAX, secara ekonomi no-op) — ditemukan lewat pencarian nonce (285) dan diverifikasi langsung: [0x1f3fbca8…9ca2767](https://sepolia.arbiscan.io/tx/0x1f3fbca86bdc1fbf18a5a0032795c79fb557f1724c4574fe6bf57a7069ca2767) gas 41.809, blok 310898403 (14:28:28), status 1. Dicatat di sini untuk kejujuran ledger; bukan salah satu dari tiga transaksi yang diotorisasi controller untuk ronde ini, tapi konsekuensi tak sengaja dari bug yang sudah ada di skrip sebelum ronde ini (bukan dari perubahan `redeem`) — perbaikannya di luar cakupan ronde ini.

`buy`: [0x3ae0a152…3994ffc](https://sepolia.arbiscan.io/tx/0x3ae0a152da8adab0ac10ec13efa702378f27ca2fbdea120e43690050b3994ffc) gas 373.191, blok 310898422 (14:28:33), status 1. Kuotasi view sebelum eksekusi: premi 1,258407 USDG + fee 0,037753 USDG; simulasi jalur eksekusi (dipakai skrip untuk menghitung `max`): premi 1,258406 USDG; cap (`max`) dikirim ke kontrak: 1,309120 USDG. Log `Transfer` USDG yang sesungguhnya: owner → Pool C **1,296150 USDG** (premi + fee bruto), Pool C → owner **0,037752 USDG** (fee protokol — `treasury()` == alamat owner di deployment ini, jadi fee kembali ke wallet yang sama); **biaya bersih owner sebagai trader: 1,258398 USDG** — **premi dibayar dalam USDG Paxos asli**, bukan mock.

`close`: [0xd937a992…24affff](https://sepolia.arbiscan.io/tx/0xd937a99260520bf6b3184b33dc72e3a8bfc8b363e1050f2889cb845dc24affff) gas 199.405, blok 310898447 (14:28:39), status 1. Simulasi eksekusi: 0,993533 USDG; `min` dikirim: 0,983597 USDG; log `Transfer` sesungguhnya Pool C → owner: **0,993531 USDG**. Posisi sisa di `TOK_C` untuk seri ini: **0** (tertutup penuh). Biaya bersih round-trip: 1,258398 − 0,993531 = **0,264867 USDG** — cocok persis dengan perubahan saldo USDG owner (10,000000 → 9,735133 USDG di `status` di bawah).

`tools/sepolia/pool-c.sh status` dan `tools/demo/sepolia-demo.sh --check` (read-only, A/B) sesudahnya:

```
Pool C 0xebd255c8324dce0478996d9d40d6642044872e92 · asset 0xffc95faa3d63cde504a05b567c600b78c0b41892 · math 0xb3b37050a40b9755001bddd29cc5df17a59f51d4 · vol 0xc331031a1730a567fd9149d5950912a1cdcb6a3e
cfg C == cfg B: ya
NAV 90264867 · free 90264867 · reserved 0 · capitalRefPrev 100000000000000000000 · boards 2
USDG asli: owner 9735133 · keeper 0 · pool 90264867
```

`reserved` kembali ke 0 (posisi tertutup penuh, sama seperti prasyarat di brief), `capitalRefPrev` tidak berubah (100 USDG, WAD) — redeem tidak menyentuhnya. `--check` blok 310899494 tetap hijau untuk A/B: paritas math byte-identik, kuotasi A vs B berbeda hanya karena inventaris — Pool C (redeem + trade) tidak menyentuh A/B.

**Status akhir: seed, redeem, dan trade pertama (buy+close) di Pool C semuanya selesai dan nyata di USDG Paxos asli.** Wallet keeper masih 0 USDG — LP kedua (`seed --keeper`) tetap menunggu permintaan faucet hariannya sendiri, belum dijalankan.
