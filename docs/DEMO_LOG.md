# Equinox — log demo live di Arbitrum Sepolia

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
