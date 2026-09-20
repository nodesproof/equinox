# Equinox Plan 4 — Pool C di atas USDG Paxos asli (Arbitrum Sepolia) + koreksi klaim USDG (spec desain)

**Tanggal:** 20 September 2026 · **Status:** disetujui lisan ("lanjutkan", 20 Sep) · **Sumber otoritas:** `prd-arsitektur.md` v1.4, spec Plan 3 (`2026-09-20-equinox-plan3-demo-design.md`, K1–K5). Dokumen ini menambah satu pool dan mengoreksi satu klaim; tidak mengubah kontrak.

---

## 0. Temuan yang memicu plan ini (terverifikasi 20 Sep 2026)

| Fakta | Nilai | Cara verifikasi |
|---|---|---|
| USDG (Global Dollar, Paxos) **ada** di Arbitrum Sepolia | proxy ERC-1967 `0xFFC95faa3d63Cde504a05B567C600B78C0b41892` → impl `0x0643bc7146ab7A2dD4Ea10d506ba95E1b933B236` (`contracts/stablecoins/USDG.sol:USDG`, solc 0.8.28); `name()` "Global Dollar", `symbol()` USDG, `decimals()` 6; owner `0xF0863D7A29a55d0c4263c11bFac754312ff078DF`; `totalSupply` ≈ 111.012 USDG | `cast call`; Sourcify v2 `exact_match` untuk proxy (10 Feb 2026) dan impl (13 Jul 2026) |
| `mint` tertutup | revert `AccountMissingSupplyControllerRole(address)` dari EOA acak; 0 event mint dalam ±1,5 juta blok terakhir | `cast call --from 0x1111…`, `cast logs` topic Transfer from 0x0 |
| Faucet resmi | `https://faucet.paxos.com/` — token USDG, jaringan berlabel "Arbitrum Sepolia" (kunci `ARBITRUM_ONE`), tautan explorer ke alamat di atas; **100 USDG per permintaan, 1 permintaan per wallet per hari**, form alamat saja; POST `/v2/treasury/faucet/transfers` | bundel `assets/index-DgKs9v4B.js` (konfigurasi `ARBITRUM_ONE_USDG`, konstanta `WT=100`, teks "Limit 1 request per wallet per day") |
| Halaman resources buildathon | tidak menyebut USDG/faucet Paxos; hanya faucet ETH, USDC Circle (`0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`, terverifikasi), Robinhood | tempelan pengguna 20 Sep |
| Klaim kita yang salah | JUDGE_QA Q25, SUBMISSION field 4 & daftar "jangan klaim", footer dashboard: "Paxos has no USDG on Arbitrum Sepolia" | grep |
| Factory hidup | `PoolE2EDeployer(0xeb64…2df3).factory()` = `0x2014077542088eCeFf980221CFc7Fa6b96A4F2e5`, `poolCount()` 2; `createPoolWithVol(Deploy, vol)` tanpa modifier akses | `cast call` |
| Simulasi deploy Pool C | `eth_call` `createPoolWithVol` dari owner dengan `usdg = 0xFFC9…` **berhasil** (alamat pool bergantung nonce), estimasi gas ≈ 5,05 juta | `cast call`/`cast estimate` 20 Sep |
| Capital reference | LP **pertama** memakai `_bootstrapCapitalRef` → cap aktif seketika; deposit berikutnya lag `CAPITAL_REF_DELAY` = 1 hari | `EquinoxPool.sol:609–616` |

## 1. Keputusan

| # | Keputusan | Alasan |
|---|---|---|
| P1 | **Pool C = "Equinox on real USDG"**: `createPoolWithVol` pada factory yang ada, `usdg = 0xFFC9…1892`, `math = program Stylus` (sama dengan Pool B), `feed`/`sequencerFeed`/`owner`/`treasury`/`cfg`/`rWad` **identik** dengan A/B, `name` "Equinox LP (USDG)", `symbol` "eqC"; engine vol bersama `0xc331…` (K4 tetap satu engine untuk tiga pool) | Tanpa kontrak baru; satu tx; cerita "pool identik, hanya asetnya asli"; math Stylus karena itu produk yang disubmit |
| P2 | Board Pool C = board A/B (expiry & strike sama; `createBoard` oleh owner), termasuk board 9/16 Okt nanti | Perbandingan apple-to-apple; keeper settle semua board di tiga pool |
| P3 | Seed dari faucet: deposit pertama (100 USDG, owner) → cap aktif seketika; LP kedua = wallet keeper (100 USDG) → lag 1 hari; permintaan faucet diulang harian oleh pengguna | Batas faucet; Pool C berskala ratusan USDG — bukti "aset asli", bukan demo utama |
| P4 | Pool A/B **tetap** MockUSDG; klaim dikoreksi: "USDG ada di Sepolia (faucet Paxos 100/hari/wallet) — mint tertutup dan pasokan ±111 k, jadi seed 1.000.000 USDG per pool dan trading bebas oleh juri memakai mock; Pool C membuktikan jalur aset asli" | Kejujuran (PRD §16) tanpa mereset demo yang sudah berjalan |
| P5 | Dashboard data-driven: `POOL_KEYS` dari manifest (`A`,`B`,`C` bila ada), **aset per pool** (`POOLS[k].asset`, `assetSymbol`, `faucet: 'mint' | 'paxos'`); saldo/allowance/positions dibaca per pool; tombol faucet Pool C = tautan `faucet.paxos.com`; paritas K5 & counter gas tetap A vs B; kartu NAV ×3; kolom papan Buy/Close/OI per pool | Tidak ada hard-code jumlah pool; aset berbeda per pool adalah perubahan nyata di jalur tulis |
| P6 | Tools membaca pool dari manifest: `tools/sepolia/pool-c.sh {deploy\|boards\|seed\|status}` (baru), `list-boards.sh` (board di C juga; seed mock hanya A/B), `keeper.sh` (settle di semua pool), `verify.sh` (Sourcify Pool C + token C), demo `--check` tidak berubah | Board mingguan dan settlement harus mencakup C |
| P7 | Dokumen: manifest `pools.C` + `boards[].seriesIds.C` + `listTx.C`; README tabel Live + paragraf "real USDG"; DEMO_LOG entri deploy/seed/trade nyata; SUBMISSION field 4 = USDG asli + mock, **checkbox Paxos dicentang**; JUDGE_QA Q25/Q26 dikoreksi + satu Q baru; PRD v1.5 (§10.3 tabel deployment, §16 V9/V-baru, §18); VERIFICATION.md baris USDG Sepolia; OPS_SEPOLIA & DEMO_RUNBOOK (Pool C dalam kalender); FRONTEND_BRIEF §2/§3.9/§6 (aset per pool) | Setiap angka/klaim baru punya sumber |
| P8 | Tidak ada perubahan kontrak, tidak ada redeploy A/B, tidak ada trade di board 0 Pool A/B sebelum Jumat | Demo settlement Jumat tetap utuh |

## 2. Arsitektur singkat

```
faucet.paxos.com ──100 USDG/hari──▶ owner 0x9035… ──approve/deposit──▶ Pool C (asset = USDG Paxos 0xFFC9…)
                                    keeper 0x2e56… ──deposit (LP #2)──▶      │ math = Stylus 0xb3b3…  vol = 0xc331… (bersama A/B/C)
Chainlink ETH/USD 0xd30e… ──▶ EquinoxVolEngine ──σ──▶ Pool A (mock USDG, Sol) · Pool B (mock USDG, Stylus) · Pool C (USDG asli, Stylus)
keeper.yml (15 menit) ──poke + settle──▶ A, B, C          dashboard: POOL_KEYS dari manifest, aset per pool
```

## 3. Data & antarmuka

- Manifest: `pools.C = { label: "Equinox (Stylus, real USDG)", pool, token, math, asset: "0xffc9…1892", assetSymbol: "USDG", assetKind: "paxos", createTx, createdAtBlock }`; `pools.usdg` tetap = mock (aset A/B). `boards[].seriesIds.C`, `boards[].listTx.C` ditulis oleh `pool-c.sh boards` / `list-boards.sh`.
- Web `deployment.ts`: `PoolKey = 'A' | 'B' | 'C'`; `POOL_KEYS: PoolKey[]` = kunci yang ada di manifest (urut A, B, C); `POOLS[k] = { pool, token, math, label, asset, assetSymbol, faucet: 'mint' | 'paxos' }` (A/B: `asset = pools.usdg`, `faucet: 'mint'`); `SeriesRef.id: Record<PoolKey, bigint>`; `Board.seriesIds: Record<PoolKey, bigint[]>`.
- Snapshot: `PoolState.cash` = `asset(k).balanceOf(pool)`; `UserState = { address, asset: Record<PoolKey, bigint>, allowance, shares, positions }` (saldo aset **per pool**); seri `Record<PoolKey, SeriesState>` dibangun dari `POOL_KEYS`.
- Trade: `approveCall(k)` → `POOLS[k].asset`; `faucetCall(k, to)` hanya untuk `faucet === 'mint'`; panel menampilkan tautan Paxos + saldo USDG asli untuk C; `REVERT_TEXT.ERC20InsufficientBalance` disesuaikan per pool ("use the faucet" vs "get USDG from faucet.paxos.com").
- Paritas/gas: tetap `MATH_SOL` vs `MATH_STYLUS`, gas `buy` A vs B (C punya math yang sama dengan B; tidak ada klaim baru).
- Events: `readEvents` sudah iterasi `POOL_KEYS`; seed & merge tidak berubah; label seri mencari id di semua pool.

## 4. Verifikasi & kejujuran

- Setelah deploy: `pool-c.sh status` mencetak `asset()`, `math()`, `vol()`, `cfg()` C dan membandingkan dengan B (semua sama kecuali `asset`); `verify.sh` Sourcify exact match untuk pool C dan token C (bytecode = A/B).
- Trade nyata pertama di USDG asli (0,01 unit, board 1) dicatat di DEMO_LOG dengan hash; DEMO_LOG juga mencatat batas faucet dan skala pool.
- Test web: unit (jumlah diperbarui di dokumen), network (paritas & `math()` untuk A/B; user path menyertakan C: `positions.C.length === ALL_SERIES.length`).
- Copy: "Pool C settles in Paxos USDG (testnet); A/B use a mock so anyone can trade" — tidak ada klaim "mainnet"/"USDG produksi".

## 5. Di luar cakupan

Mengganti aset A/B; USDC Circle; multi-aset dalam satu pool; perubahan kontrak/ABI (ABI tidak berubah → `web/src/abi` tetap).
