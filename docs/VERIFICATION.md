# Verifikasi Hari 1 — Equinox (PRD §18)

Diisi 19 September 2026. Baris ✅ sudah diverifikasi dengan perintah yang tertulis; baris ⬜ wajib diisi sebelum Hari 2.

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
| V9 | USDG di Arbitrum One: alamat & `decimals()` | Paxos docs → `cast call <usdg> "decimals()(uint8)" --rpc-url https://arb1.arbitrum.io/rpc` | ⬜ (fallback MockUSDG 6 dp) |
| V10 | nitro-devnode | `tools/devnode/up.sh` (image v3.11.4-7d5ac27, upgrade ArbOS 61 otomatis) | ✅ chain 412346, Stylus v3, maxFragments 4; CacheManager devnode = stub |
| V11 | Foundry tidak bisa eksekusi WASM | `forge test --fork-url http://127.0.0.1:8547` terhadap alamat Stylus | ⬜ (dokumentasikan pesan errornya) |
| V12 | Pustaka fixed-point Rust untuk Stylus yang teruji | GitHub search | ⬜ — port PRBMath sendiri sudah bit-identik, cukup |
| V13 | IV-sourcing Premia v3 / Stryke / Rysk / Moby | docs masing-masing | ⬜ |
| V14 | Rubrik/track juri | halaman event | ⬜ |
| V15 | Keepalive Stylus permissionless | `ArbWasm.codehashKeepalive(bytes32)`; `expiryDays` 365 / `keepaliveDays` 31 | ✅ (parameter terbaca; pemanggilan diuji di Hari 15) |

Temuan yang mengubah PRD (v1.1): rasio gas Stylus vs Solidity untuk matematika 256-bit adalah 2,6–2,9× pada lingkaran, < 1× untuk panggilan tunggal tanpa cache; `I256` 105 vs `i128` 29 vs `u64` 0,5 gas per pasangan mul+div. Lihat `docs/BENCHMARK.md`.
