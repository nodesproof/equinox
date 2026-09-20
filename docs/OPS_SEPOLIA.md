# Runbook operasi Sepolia — settlement nyata pertama, Jumat 25 Sep 2026

Alamat: `deployments/arbitrum-sepolia.json` (`.pools` — A, B, dan sejak Plan 4 **C**: `pools.C`, pool `0xebd255c8324dce0478996d9d40d6642044872e92` yang ber-aset USDG Paxos asli `0xFFC9…1892`, alat `tools/sepolia/pool-c.sh`). Keeper: `tools/keeper/keeper.sh` (wallet `0x2e5607862E1c42C24Ea91d50C5737715a71ba89B`, cron `.github/workflows/keeper.yml` tiap 15 menit — hanya berjalan bila workflow ada di `main`; membaca daftar pool dari manifest, jadi C ikut di-settle). Semua waktu UTC.

## Prasyarat (paling lambat Rabu 23 Sep)

- `keeper.yml`, `tools/keeper/keeper.sh`, dan `deployments/arbitrum-sepolia.json` (dengan `pools.C`) sudah di `main` (PR plan-3a + plan-4 di-merge); secret repo `KEEPER_PRIVATE_KEY` (+ `SEPOLIA_RPC_URL` opsional) terpasang.
- **Satu run cron hijau teramati** di Actions → keeper (bukan hanya `workflow_dispatch`): log memuat `poke: 0x…`, satu baris `NAV C …`, dan **enam** baris `belum bisa settle (BoardNotExpired …)` (board 0/1 × pool A, B, C — `DRY_RUN=1` 20 Sep 14:00 UTC sudah mencetak enam).
- Cek lokal kapan saja tanpa tx: `DRY_RUN=1 KEEPER_PRIVATE_KEY=0x…01 tools/keeper/keeper.sh` (kunci dummy cukup untuk simulasi); status Pool C tanpa tx: `tools/sepolia/pool-c.sh status`.
- **Permintaan faucet USDG harian sampai Kamis 24 Sep** (`https://faucet.paxos.com/`, USDG → Arbitrum Sepolia, 100 USDG per wallet per hari, form alamat saja): (a) wallet keeper `0x2e56…a89B` — begitu saldonya ≥ 100 USDG, jalankan LP kedua `set -a; source .env; set +a; tools/sepolia/pool-c.sh seed 100 --keeper` (deposit kedua kena lag `CAPITAL_REF_DELAY` 1 hari untuk util/cap, jadi lakukan paling lambat Kamis agar cap sudah naik pada Jumat); (b) wallet owner `0x9035…076D` — saldo trader 9,735133 USDG sisa dari trade pertama; permintaan tambahan hanya bila ingin trade lebih besar di C (**jangan** menyetor seluruh grant sebagai LP lagi — itulah yang memblokir trade pertama, `docs/DEMO_LOG.md` › Pool C). Skrip `seed` keluar `exit 3` ("DITUNDA") bila saldo < jumlah, tanpa tx.

## Linimasa Jumat 25 Sep (board 0, expiry `1790323200`)

| Waktu | Yang terjadi |
|---|---|
| 07:59:00 | Blackout: `quoteBuy`/`buy`/`close` seri board 0 revert `SeriesExpired` (`expiry ≤ now + 60 s`); NAV menilai seri ini pada intrinsik. Board 1 (2 Okt) tetap bisa dikuotasi. |
| 08:00:00 | Expiry. `settle(0)` butuh round Chainlink dengan `updatedAt ≥ 1790323200` yang masih segar — biasanya mendarat **08:00–08:02** (cadence feed ETH/USD Sepolia ≈ 1–2 menit; 20 Sep: round …461 → …464 dalam ≈ 5,5 menit). Sebelum itu `settle` revert `SettlementNotReady`. |
| 08:00–08:05 | Run cron keeper (`*/15`, jitter GitHub beberapa menit): `poke` → cek sequencer mock → `settle(0)` di **A, B, lalu C** (tiga tx terpisah; urutan = manifest). Log: `board 0 @ … SETTLED 0x… <gas> → settled=true harga=<WAD>`. Bila round ≥ expiry belum ada: `belum bisa settle (SettlementNotReady …)` — run 08:15 menyelesaikannya. Board 0 di C tidak punya posisi terbuka (0,01 unit sudah ditutup) — settle-nya tetap dijalankan agar seri board 0 C berstatus settled di dashboard. |
| — | Round A ≠ B ≠ C (≈ 5 % kemungkinan per pasangan: round baru mendarat di antara dua tx) adalah **sah** — masing-masing memakai round segar terakhir saat `settle` dipanggil (T2 PRD); `--claim` mencetak "≠ — round settlement berbeda" untuk A/B. Bounty 2 USDG per settle masuk ke wallet keeper — di A/B mock, **di C 2 USDG Paxos asli** dari kas Pool C (`EquinoxPool.sol:456`: dibayar hanya bila `freeLiquidity() ≥ bounty`; free C ≈ 90 USDG, jadi dibayar dan NAV C turun 2 USDG per board yang disettle). |

Selektor revert yang dinamai keeper: `BoardNotExpired`, `SettlementNotReady`, `BoardAlreadySettled`, `OracleStale` — semuanya ditoleransi (exit 0); settle yang gagal dikirim (`status 0`/RPC) hanya mencetak `settle GAGAL — coba lagi run berikutnya` dan lanjut ke board/pool berikutnya.

## Fallback bila cron tidak jalan / gagal

1. Dispatch manual: `gh workflow run keeper.yml` (lalu `gh run watch`).
2. Lokal dari wallet keeper: `set -a; source .env; set +a; tools/keeper/keeper.sh` (kunci hanya dari `.env`, tidak pernah dicetak).
3. Dari owner (settle permissionless): `tools/demo/sepolia-demo.sh --claim` — settle bila belum, lalu claim; tidak bergantung pada keeper. **Hanya A/B.** Pool C: `cast send $(jq -r .pools.C.pool deployments/arbitrum-sepolia.json) "settle(uint256)" 0 --rpc-url $RPC --private-key ⟨kunci berdana apa pun⟩` (permissionless; bounty 2 USDG asli ke pemanggil), lalu cek `tools/sepolia/pool-c.sh status`.

Sequencer mock: `MockSequencerFeed.set(int256,uint256)` (`.pools.sequencerFeed`) **terbuka** — artefak testnet. Siapa pun bisa menandai "down" atau memasang ulang grace 3600 s, yang membuat `settle` revert `SettlementNotReady` dan kuotasi/deposit revert `OracleStale`. Keeper dan `--claim` memeriksanya lebih dulu (`answer == 0`, `startedAt ∈ (0, now]`, `now − startedAt ≥ 3600`) dan memulihkan dengan `set(0, now − 7200)` bila perlu; manual: `cast send $SEQ "set(int256,uint256)" 0 $(( $(date -u +%s) - 7200 ))`.

## Setelah settlement (25 Sep, siang)

1. `tools/demo/sepolia-demo.sh --claim` (board 0) dari owner → baris settle (bila keeper belum), harga settlement A/B, payout C 2800 & P 2400 ke `docs/DEMO_LOG.md`; commit log-nya. **Pool C:** `--claim` tidak menyentuhnya; owner tidak punya posisi di C (trade pertama sudah ditutup penuh), jadi tidak ada claim — cukup `tools/sepolia/pool-c.sh status` untuk mencatat `settled`/harga settlement C di log bila ingin.
2. **List board 9 Okt dan 16 Okt** (`1791532800` = Jum 9 Okt 2026 08:00 UTC dan `1792137600` = Jum 16 Okt 2026 08:00 UTC — keduanya grid Jumat ✓, tenor 14/21 hari ≤ 30 hari dari 25 Sep ✓; sama dengan `DEMO_RUNBOOK.md` › Timeline 09:00) di **ketiga pool** supaya masih ada seri terbuka setelah board 1 (2 Okt) expiry dan sampai `rewardTime` HackQuest (12 Okt) — sebelum 2 Okt:
   `tools/sepolia/list-boards.sh 1791532800:K1,K2,K3 1792137600:K1,K2,K3` — strike naik & unik, kelipatan 1 USDG, **di dalam `[S/2, 2S]` pada saat listing** (S ≈ 2.600 → mis. `2300,2600,2900`; cek `spot()` dulu). Seri terbuka sesudahnya: 6 (board 1) + 12 = 18 ≤ 32 (`maxOpenSeries`) per pool. Skrip idempoten per expiry × pool (seed LP mock dilewati bila sudah ada dan hanya untuk A/B; sejak Plan 4 `KEYS` dibaca dari manifest, jadi board yang sama dibuat di **A, B, dan C** dalam satu perintah dan `seriesIds.C`/`listTx.C` ditulis sekaligus). Bila C tertinggal (mis. tx C gagal), `tools/sepolia/pool-c.sh boards` membuat ulang **hanya** board manifest yang belum punya `seriesIds.C` dan belum expiry. Menulis `seriesIds`/`listTx` ke `deployments/arbitrum-sepolia.json` → commit JSON-nya (keeper membaca daftar board dari sana; Pages dibangun ulang lewat pemicu `deployments/**`; board 2 Okt dan 9 Okt disettle cron pada expiry masing-masing dengan cara yang sama; test web bebas dari jumlah board).
3. Setelah 2 Okt: `--claim 1` (indeks board 1) untuk posisi board 2 Okt bila ada — **hanya A/B**; di C claim posisi bila ada (`cast send $C "claim(uint256,uint256)" <seriesId> <amount>` dari wallet pemegang; per 20 Sep tidak ada posisi terbuka di C).

## Pool C — catatan operasi (Plan 4)

- **Alat:** `tools/sepolia/pool-c.sh deploy | boards | seed [USDG=100] [--keeper] | redeem [USDG=10] | trade [SIZE=0.01] | status` (kunci owner dari `.env`; `--keeper` memakai `KEEPER_PRIVATE_KEY`). `deploy` sudah dijalankan (20 Sep 13:57 UTC, tx `0xedcfbd1f…53fb`) dan menolak berjalan lagi selama `pools.C` ada; `status` read-only.
- **Urutan tulis manifest:** `deploy` dan `boards` **mengirim tx dulu, baru menulis manifest** setelah asersi wiring (`asset()`, `math()`, `vol()`, `cfg()`, `token().pool()`; untuk `boards`: `boardId` dan `series(id).expiry`). Bila sebuah asersi gagal *setelah* tx sukses, **jangan** langsung mengulang perintah (mengulang `deploy` = pool kedua): baca dulu on-chain `factory.pools(poolCount()-1)` / `pool.board(boardCount()-1)`, cocokkan dengan yang diharapkan, lalu tulis `pools.C` / `seriesIds.C` ke manifest secara manual (`jq`) — temuan review Task 1 Plan 4, tidak terjadi pada run 20 Sep.
- **Skala & kuotasi:** NAV C 90,264867 USDG (20 Sep 14:28 UTC), LP tunggal = owner; kuotasi 1 unit di C ≈ 7 % di atas A/B karena vega cap 5 % dari ≈ 90 USDG sangat kecil → suku inventaris σ_mark(util) di klem-nya (ukuran pool, bukan matematika). Turun setelah LP kedua masuk dan lag 1 hari lewat.
- **Trade di C:** `pool-c.sh trade 0.01` (beli lalu tutup 0,01 unit C 2.600 board 1) butuh saldo USDG asli ≥ ≈ 1,3 USDG di wallet owner; pengecekan allowance memakai `ge()` (presisi-bebas) sejak `c38a675` — tidak ada lagi `approve` tersembunyi.
- **Jangan** memakai `pool-c.sh` untuk A/B, dan jangan mengklaim "mainnet"/"USDG produksi": C adalah bukti jalur aset asli pada skala faucet.

## Top-up keeper ≈ 5–6 Okt

Saldo 20 Sep setelah run ini: 0,019977 ETH. Satu run jalur `poke` penuh = 82.815 gas × ≈ 0,136 gwei ≈ 1,13 × 10⁻⁵ ETH (tx `0x7e5b90d8…`); 96 run/hari → ≈ 1,1 × 10⁻³ ETH/hari → **runway ≈ 18 hari dari 20 Sep** (habis ≈ 8 Okt; no-op poke lebih murah, settle sedikit lebih mahal). Kirim ≈ 0,02 Sepolia ETH ke `0x2e5607862E1c42C24Ea91d50C5737715a71ba89B` pada 5–6 Okt bila cron dibiarkan berjalan; saldo tercetak di baris pertama tiap run (`saldo … ETH`).

Catatan `--check`: sejak 60 s sebelum expiry board 0 (Jum 25 Sep 07:59 UTC) `quoteBuy` seri board 0 revert `SeriesExpired`, jadi pakai `tools/demo/sepolia-demo.sh --check 1` (board 2 Okt) sampai board 9/16 Okt terdaftar.
