# Runbook operasi Sepolia — settlement nyata pertama, Jumat 25 Sep 2026

Alamat: `deployments/arbitrum-sepolia.json` (`.pools`). Keeper: `tools/keeper/keeper.sh` (wallet `0x2e5607862E1c42C24Ea91d50C5737715a71ba89B`, cron `.github/workflows/keeper.yml` tiap 15 menit — hanya berjalan bila workflow ada di `main`). Semua waktu UTC.

## Prasyarat (paling lambat Rabu 23 Sep)

- `keeper.yml`, `tools/keeper/keeper.sh`, dan `deployments/arbitrum-sepolia.json` sudah di `main` (PR plan-3a di-merge); secret repo `KEEPER_PRIVATE_KEY` (+ `SEPOLIA_RPC_URL` opsional) terpasang.
- **Satu run cron hijau teramati** di Actions → keeper (bukan hanya `workflow_dispatch`): log memuat `poke: 0x…` dan empat baris `belum bisa settle (BoardNotExpired …)`.
- Cek lokal kapan saja tanpa tx: `DRY_RUN=1 KEEPER_PRIVATE_KEY=0x…01 tools/keeper/keeper.sh` (kunci dummy cukup untuk simulasi).

## Linimasa Jumat 25 Sep (board 0, expiry `1790323200`)

| Waktu | Yang terjadi |
|---|---|
| 07:59:00 | Blackout: `quoteBuy`/`buy`/`close` seri board 0 revert `SeriesExpired` (`expiry ≤ now + 60 s`); NAV menilai seri ini pada intrinsik. Board 1 (2 Okt) tetap bisa dikuotasi. |
| 08:00:00 | Expiry. `settle(0)` butuh round Chainlink dengan `updatedAt ≥ 1790323200` yang masih segar — biasanya mendarat **08:00–08:02** (cadence feed ETH/USD Sepolia ≈ 1–2 menit; 20 Sep: round …461 → …464 dalam ≈ 5,5 menit). Sebelum itu `settle` revert `SettlementNotReady`. |
| 08:00–08:05 | Run cron keeper (`*/15`, jitter GitHub beberapa menit): `poke` → cek sequencer mock → `settle(0)` di **A lalu B** (dua tx terpisah). Log: `board 0 @ … SETTLED 0x… <gas> → settled=true harga=<WAD>`. Bila round ≥ expiry belum ada: `belum bisa settle (SettlementNotReady …)` — run 08:15 menyelesaikannya. |
| — | Round A ≠ B (≈ 5 % kemungkinan: round baru mendarat di antara dua tx) adalah **sah** — masing-masing memakai round segar terakhir saat `settle` dipanggil (T2 PRD); `--claim` mencetak "≠ — round settlement berbeda". Bounty 2 USDG per settle masuk ke wallet keeper. |

Selektor revert yang dinamai keeper: `BoardNotExpired`, `SettlementNotReady`, `BoardAlreadySettled`, `OracleStale` — semuanya ditoleransi (exit 0); settle yang gagal dikirim (`status 0`/RPC) hanya mencetak `settle GAGAL — coba lagi run berikutnya` dan lanjut ke board/pool berikutnya.

## Fallback bila cron tidak jalan / gagal

1. Dispatch manual: `gh workflow run keeper.yml` (lalu `gh run watch`).
2. Lokal dari wallet keeper: `set -a; source .env; set +a; tools/keeper/keeper.sh` (kunci hanya dari `.env`, tidak pernah dicetak).
3. Dari owner (settle permissionless): `tools/demo/sepolia-demo.sh --claim` — settle bila belum, lalu claim; tidak bergantung pada keeper.

Sequencer mock: `MockSequencerFeed.set(int256,uint256)` (`.pools.sequencerFeed`) **terbuka** — artefak testnet. Siapa pun bisa menandai "down" atau memasang ulang grace 3600 s, yang membuat `settle` revert `SettlementNotReady` dan kuotasi/deposit revert `OracleStale`. Keeper dan `--claim` memeriksanya lebih dulu (`answer == 0`, `startedAt ∈ (0, now]`, `now − startedAt ≥ 3600`) dan memulihkan dengan `set(0, now − 7200)` bila perlu; manual: `cast send $SEQ "set(int256,uint256)" 0 $(( $(date -u +%s) - 7200 ))`.

## Setelah settlement (25 Sep, siang)

1. `tools/demo/sepolia-demo.sh --claim` (board 0) dari owner → baris settle (bila keeper belum), harga settlement A/B, payout C 2800 & P 2400 ke `docs/DEMO_LOG.md`; commit log-nya.
2. **List board 9 Okt** (`1791532800` = Jum 9 Okt 2026 08:00 UTC, grid Jumat ✓) di kedua pool supaya masih ada seri terbuka setelah board 1 (2 Okt) expiry — sebelum 2 Okt:
   `tools/sepolia/list-boards.sh 1791532800:K1,K2,K3` — strike naik & unik, kelipatan 1 USDG, **di dalam `[S/2, 2S]` pada saat listing** (S ≈ 2.600 → mis. `2200,2600,3000`; cek `spot()` dulu), tenor ≤ 30 hari ✓. Skrip idempoten (seed LP dilewati bila sudah ada), menulis `seriesIds`/`listTx` ke `deployments/arbitrum-sepolia.json` → commit JSON-nya (keeper membaca daftar board dari sana; board 2 Okt disettle cron 2 Okt 08:00 dengan cara yang sama).
3. Setelah 2 Okt: `--claim 1` (indeks board 1) untuk posisi board 2 Okt bila ada.

## Top-up keeper ≈ 5–6 Okt

Saldo 20 Sep setelah run ini: 0,019977 ETH. Satu run jalur `poke` penuh = 82.815 gas × ≈ 0,136 gwei ≈ 1,13 × 10⁻⁵ ETH (tx `0x7e5b90d8…`); 96 run/hari → ≈ 1,1 × 10⁻³ ETH/hari → **runway ≈ 18 hari dari 20 Sep** (habis ≈ 8 Okt; no-op poke lebih murah, settle sedikit lebih mahal). Kirim ≈ 0,02 Sepolia ETH ke `0x2e5607862E1c42C24Ea91d50C5737715a71ba89B` pada 5–6 Okt bila cron dibiarkan berjalan; saldo tercetak di baris pertama tiap run (`saldo … ETH`).

Catatan `--check`: sejak 60 s sebelum expiry board 0 (Jum 25 Sep 07:59 UTC) `quoteBuy` seri board 0 revert `SeriesExpired`, jadi pakai `tools/demo/sepolia-demo.sh --check 1` (board 2 Okt) sampai board 9 Okt terdaftar.
