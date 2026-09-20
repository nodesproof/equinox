# Verifikasi Hari 1 — Equinox (PRD §18)

Diisi 19 September 2026; V9/V9a diperbarui 20 September 2026 (Plan 4 — USDG Paxos ada di Sepolia). Baris ✅ sudah diverifikasi dengan perintah yang tertulis; baris ⬜ wajib diisi sebelum Hari 2.

| # | Item | Perintah | Hasil |
|---|---|---|---|
| V1 | Chain ID Arbitrum Sepolia / One | `cast chain-id --rpc-url https://sepolia-rollup.arbitrum.io/rpc` | ✅ 421614 (One: 42161) |
| V2 | Stylus di Sepolia | `cast call --rpc-url $SEP 0x0000000000000000000000000000000000000071 "stylusVersion()(uint16)"` → 3; `"expiryDays()(uint16)"` → 365; `"keepaliveDays()(uint16)"` → 31; `"pageGas()(uint16)"` → 1000; `cast call --rpc-url $SEP 0x0000000000000000000000000000000000000064 "arbOSVersion()(uint64)"` → 116 (ArbOS 61); `cast call --rpc-url $SEP 0x000000000000000000000000000000000000006b "getMaxStylusContractFragments()(uint256)"` → 4 | ✅ |
| V3 | cargo-stylus | `cargo install cargo-stylus --version 0.10.9 --locked && cargo stylus --version` | ✅ stylus 0.10.9 |
| V4 | stylus-sdk API | `cargo search stylus-sdk` → 0.10.9; makro `sol_storage!`/`#[entrypoint]`/`#[public]`/`#[derive(SolidityError)]`; `print_from_args()`; nama fungsi di-camelCase pada ABI; no_std butuh `use alloc::vec;` | ✅ |
| V5 | Ukuran & aktivasi | `cd stylus/bs-stylus && cargo stylus check --endpoint $SEP` → 34,3 KB (2 fragmen), data fee ≈ 0,00015 ETH; `programMemoryFootprint` = 1 halaman (stack 16 KiB) | ✅ |
| V6 | Chainlink ETH/USD Sepolia: alamat, `decimals()`, heartbeat, deviasi | docs.chain.link → `cast call <feed> "latestRoundData()(uint80,int256,uint256,uint256,uint80)"` | ⬜ |
| V7 | L2 Sequencer Uptime Feed di Sepolia | docs.chain.link | ⬜ |
| V8 | Faucet Arbitrum Sepolia | — | ⬜ |
| V9 | USDG Paxos di Arbitrum Sepolia (Plan 4, 20 Sep) / di Arbitrum One | Sepolia: `cast call 0xFFC95faa3d63Cde504a05B567C600B78C0b41892 "name()(string)"` → "Global Dollar"; `"symbol()(string)"` → USDG; `"decimals()(uint8)"` → 6; `"totalSupply()(uint256)"` → 111.012,000100 USDG; `cast call --from 0x1111… <usdg> "mint(address,uint256)" …` → revert `AccountMissingSupplyControllerRole(address)`; Sourcify v2 `GET /v2/contract/421614/<addr>` → `exact_match` untuk proxy (10 Feb 2026) dan implementasi `0x0643bc7146ab7A2dD4Ea10d506ba95E1b933B236` (13 Jul 2026). One: Paxos docs → `cast call <usdg> "decimals()(uint8)" --rpc-url https://arb1.arbitrum.io/rpc` | **Sepolia ✅** — ada, 6 dp, proxy ERC-1967, sumber terverifikasi; klaim lama "tidak ada di Sepolia" (19–20 Sep pagi) **salah, dicabut**. Pool A/B tetap `MockUSDG` (mint tertutup + faucet 100/hari, lihat V9a); Pool C `0xebd255c8324dce0478996d9d40d6642044872e92` ber-aset token asli ini (`asset()` dicek `pool-c.sh status`; trade pertama `0x3ae0a152…4ffc` / `0xd937a992…ffff`, `docs/DEMO_LOG.md`). **One ⬜** — alamat & `decimals()` di Arbitrum One belum diverifikasi |
| V9a | Faucet USDG Paxos (satu-satunya jalan mendapat USDG asli di Sepolia) | `https://faucet.paxos.com/` — token USDG, jaringan "Arbitrum Sepolia", form alamat saja; bundel JS: `WT=100`, "Limit 1 request per wallet per day"; dipakai 20 Sep untuk owner `0x9035…076D` (saldo 100 USDG → seed Pool C) | ✅ **100 USDG per permintaan, 1 permintaan per wallet per hari** → skala Pool C ratusan USDG; LP kedua (keeper `0x2e56…a89B`) menunggu permintaannya sendiri |
| V10 | nitro-devnode | `tools/devnode/up.sh` (image v3.11.4-7d5ac27, upgrade ArbOS 61 otomatis) | ✅ chain 412346, Stylus v3, maxFragments 4; CacheManager devnode = stub |
| V11 | Foundry tidak bisa eksekusi WASM | `forge test --fork-url http://127.0.0.1:8547` terhadap alamat Stylus | ⬜ (dokumentasikan pesan errornya) |
| V12 | Pustaka fixed-point Rust untuk Stylus yang teruji | GitHub search | ⬜ — port PRBMath sendiri sudah bit-identik, cukup |
| V13 | IV-sourcing Premia v3 / Stryke / Rysk / Moby | docs masing-masing | ⬜ |
| V14 | Rubrik/track juri | halaman event | ⬜ |
| V15 | Keepalive Stylus permissionless | `ArbWasm.codehashKeepalive(bytes32)`; `expiryDays` 365 / `keepaliveDays` 31 | ✅ (parameter terbaca; pemanggilan diuji di Hari 15) |

Temuan yang mengubah PRD (v1.1): rasio gas Stylus vs Solidity untuk matematika 256-bit adalah 2,6–2,9× pada lingkaran, < 1× untuk panggilan tunggal tanpa cache; `I256` 105 vs `i128` 29 vs `u64` 0,5 gas per pasangan mul+div. Lihat `docs/BENCHMARK.md`.
