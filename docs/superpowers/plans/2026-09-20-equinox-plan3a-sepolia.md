# Equinox Plan 3a — Sepolia: engine bersama, dua pool live, keeper, demo (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dua pool Equinox (A = kontrol `BlackScholesSol`, B = Stylus) hidup di Arbitrum Sepolia dengan **feed Chainlink ETH/USD asli** dan **satu vol engine bersama**, dua board (Jum 25 Sep & Jum 2 Okt 2026 08:00 UTC), seed LP 1 juta USDG per pool, keeper cron yang mem-poke dan men-settle, skrip demo live yang mencatat tx hash ke `docs/DEMO_LOG.md`, dan test naratif deterministik untuk video.

**Architecture:** `EquinoxFactory` mendapat `createPoolWithVol` (engine yang sudah ada dipakai ulang; kontrak pool/token/engine/`PoolDeployer` tidak disentuh). `PoolE2EDeployer` menerima `feed` (mock bila `address(0)`) dan flag `sharedVol`. Semua interaksi Sepolia lewat `forge create` + `cast` (Foundry tidak bisa mengeksekusi Stylus). `deployments/arbitrum-sepolia.json` adalah satu-satunya sumber alamat (di-commit). Keeper = GitHub Actions cron dengan wallet terpisah.

**Tech Stack:** Foundry (`solc` 0.8.28 via-IR, `cast`, `forge`), `jq`, `python3` (aritmetika 256-bit di shell), GitHub Actions, Arbitrum Sepolia RPC publik `https://sepolia-rollup.arbitrum.io/rpc`.

**Spec:** `docs/superpowers/specs/2026-09-20-equinox-plan3-demo-design.md` (K1–K4, §1 fakta terverifikasi, §3 Plan 3a). PRD: `prd-arsitektur.md` v1.3.

## Global Constraints

- Root repo `/home/mdlog/Project-MDlabs/Hackquest/arbitrum-sg/Equinox`; branch **`feat/plan-3a`** dibuat dari `docs/plan-3` (yang berada di atas `feat/pool`, PR #4). Path relatif terhadap root. Jalankan `forge` dari `contracts/`.
- **Kunci privat**: hanya dari `.env` (git-ignored) lewat `set -a; source .env; set +a` — variabel `SEPOLIA_PRIVATE_KEY` (owner/treasury `0x90351bB1E85a17D5f70c62C0cC076D39D897076D`), `SEPOLIA_RPC_URL`, dan (Task 5) `KEEPER_PRIVATE_KEY`. **Tidak pernah** di-`echo`, di-log, di-commit, atau ditulis ke laporan. Skrip menerima kunci hanya lewat env var, bukan argumen posisi (argumen terlihat di `ps`).
- Alamat tetap (spec §1): feed Chainlink ETH/USD `0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165` (8 dp, heartbeat 120 s); math Stylus `0xb3b37050a40b9755001bddd29cc5df17a59f51d4` (cached), `BlackScholesSol` `0x5B239AE1510AED1Bb21EB9d2e8A471D45720c4B3` — keduanya sudah ada di `deployments/arbitrum-sepolia.json` (`blackScholesStylus`, `blackScholesSol`). Tidak ada sequencer feed di Sepolia → `MockSequencerFeed`. USDG → `MockUSDG` (6 dp, `mint` terbuka).
- Expiry grid: `1790323200` (Jum 25 Sep 2026 08:00 UTC) dan `1790928000` (Jum 2 Okt 2026 08:00 UTC); strike kelipatan 1 USDG dalam `[S/2, 2S]` saat listing, naik & unik; ≤ 32 seri terbuka per pool.
- Seri di `board(id).seriesIds` berurutan per strike: indeks `2i` = call K_i, `2i+1` = put K_i (`createBoard` loop `c = 0 → isCall`).
- Konfigurasi pool = §6.8 (sudah di `_params` deployer): feeBps 300, maxUtilBps 8000, vegaCapBps 500, minPremiumBps 5, heartbeat 3600, staleMult 3, sequencerGrace 3600, maxOpenSeries 32, tenorMax 30 hari, minSize 1e16, settleBounty 2e6; vol λ 0,94, VRP 1,15, α 0,30, s 0,05, σ ∈ [0,20; 3,0]; seed 0,55; `rWad` 0.
- **Kontrak di `contracts/src/pool/`** hanya boleh berubah di `EquinoxFactory.sol` (Task 1). `forge build --sizes` wajib hijau (CI menegakkan margin ≥ 0). `forge test` wajib hijau sebelum setiap commit.
- Semua skrip bash: `set -euo pipefail`, komentar Indonesia, identifier Inggris, idempoten bila dijalankan ulang (cek state di JSON/on-chain dulu). Perbandingan angka 256-bit lewat string atau `python3`, bukan aritmetika bash.
- `cast call` mengembalikan alamat checksummed dan angka dengan anotasi `[1.2e3]` → selalu `awk '{print $1}'`; alamat dibandingkan dalam huruf kecil.
- Commit: pesan polos, TANPA trailer/atribusi AI; identitas repo-lokal `nodesproof <mdnodes88@gmail.com>` (sudah diset). Satu commit per task kecuali disebut lain. `deployments/arbitrum-sepolia.json` DI-COMMIT; `deployments/devnode.json` dan `.env` tetap git-ignored.
- Bahasa: komentar/dokumen Indonesia (README Inggris); string literal Solidity ASCII.
- Devnode (Task 2 verifikasi): jalankan terlepas `setsid nohup tools/devnode/up.sh > /tmp/devnode-plan3a.log 2>&1 &`, tunggu `devnode siap`; hentikan HANYA dengan `docker rm -f nitro-dev` (jangan `pkill -f`). Kunci devnode publik: `0xb6b15c8cb491557369f3c7d2c287b053eb229daa9c22138887752191c9520659`.
- GitHub: workflow `schedule` hanya aktif di branch default (`main`) — keeper baru berjalan otomatis setelah PR di-merge; sampai saat itu `sepolia-demo.sh --claim` memanggil `settle` sendiri. Secret repo diset dengan `gh` memakai token nodesproof: `GH_TOKEN=$(sed -n 's#https://nodesproof:\([^@]*\)@github.com#\1#p' ~/.git-credentials)`.

---

### Task 1: `EquinoxFactory.createPoolWithVol` (engine bersama, K4)

**Files:**
- Modify: `contracts/src/pool/EquinoxFactory.sol`
- Create: `contracts/test/EquinoxFactory.t.sol`

**Interfaces:**
- Consumes: `PoolDeployer.deploy(Deploy, token, vol)` (factory-only), `EquinoxVolEngine.feed()`, `EquinoxOptionToken.bindPool`.
- Produces: `function createPoolWithVol(EquinoxPool.Deploy calldata d, address vol) external returns (address pool)`; `error VolFeedMismatch()`. Dipakai `PoolE2EDeployer` (Task 2).

- [ ] **Step 1: Tulis test yang gagal — `contracts/test/EquinoxFactory.t.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { PoolFixture } from "./PoolFixture.sol";
import { EquinoxPool } from "../src/pool/EquinoxPool.sol";
import { EquinoxFactory } from "../src/pool/EquinoxFactory.sol";
import { MockFeed } from "../src/mocks/MockFeed.sol";

/// @notice K4: dua pool berbagi satu EquinoxVolEngine lewat createPoolWithVol — σ identik by construction.
contract EquinoxFactoryTest is PoolFixture {
    EquinoxPool internal pool2;

    function _deploySharedPool() internal returns (EquinoxPool p) {
        EquinoxPool.Deploy memory d = deployParams(address(mathSol));
        d.name = "Equinox LP (shared)";
        d.symbol = "eqS";
        p = EquinoxPool(factory.createPoolWithVol(d, address(vol)));
        usdg.mint(lp, 1_000_000e6);
        vm.startPrank(lp);
        usdg.approve(address(p), type(uint256).max);
        p.deposit(1_000_000e6, lp);
        vm.stopPrank();
        vm.prank(trader);
        usdg.approve(address(p), type(uint256).max);
    }

    function test_createPoolWithVol_shares_engine_and_registers_pool() public {
        pool2 = _deploySharedPool();
        assertEq(address(pool2.vol()), address(vol), "engine bersama");
        assertEq(factory.poolCount(), 2);
        assertEq(factory.pools(1), address(pool2));
        assertEq(address(pool2.token().pool()), address(pool2), "token terikat ke pool baru");
        assertTrue(address(pool2.token()) != address(token), "token ERC-1155 tetap per pool");
    }

    function test_trade_on_shared_pool_pokes_common_engine_and_quotes_match() public {
        pool2 = _deploySharedPool();
        lpDeposit(1_000_000e6);
        // board identik di kedua pool
        (, uint64 expiry, uint256[] memory ids1) = listBoard7d();
        uint128[] memory ks = new uint128[](3);
        ks[0] = 3800e18; ks[1] = 4000e18; ks[2] = 4200e18;
        uint256 b2 = pool2.createBoard(expiry, ks);
        (, , , uint256[] memory ids2) = pool2.board(b2);
        // round feed baru; trade di pool2 saja → engine bersama ter-poke
        vm.warp(T0 + 1 hours);
        tick(4100e8);
        uint80 before = vol.lastRoundId();
        vm.prank(trader);
        pool2.buy(ids2[4], 1e18, type(uint256).max); // C4200 di pool2
        assertGt(vol.lastRoundId(), before, "poke lewat pool2");
        // trade identik di pool pertama → state identik → kuotasi identik (σ dari engine yang sama)
        vm.prank(trader);
        pool.buy(ids1[4], 1e18, type(uint256).max);
        EquinoxPool.QuoteOut memory q1 = pool.quoteBuy(ids1[4], 1e18);
        EquinoxPool.QuoteOut memory q2 = pool2.quoteBuy(ids2[4], 1e18);
        assertEq(q1.premiumAssets, q2.premiumAssets);
        assertEq(q1.sigma, q2.sigma);
        assertEq(pool.sigmaMarkNow(), pool2.sigmaMarkNow());
    }

    function test_createPoolWithVol_rejects_feed_mismatch() public {
        MockFeed other = new MockFeed(8);
        other.set(4000e8, block.timestamp);
        EquinoxPool.Deploy memory d = deployParams(address(mathSol));
        d.feed = address(other);
        vm.expectRevert(EquinoxFactory.VolFeedMismatch.selector);
        factory.createPoolWithVol(d, address(vol));
    }
}
```

- [ ] **Step 2: Jalankan — harus gagal kompilasi (`createPoolWithVol` belum ada)**

Run: `cd contracts && forge test --match-contract EquinoxFactoryTest 2>&1 | tail -5`
Expected: error kompilasi `Member "createPoolWithVol" not found`.

- [ ] **Step 3: Implementasi — tambahkan ke `EquinoxFactory` (setelah `createPool`)**

```solidity
    error VolFeedMismatch();

    /// @notice Seperti `createPool`, tetapi memakai `EquinoxVolEngine` yang sudah ada (K4: dua pool berbagi σ yang identik
    ///         by construction — pada feed hidup dua engine terpisah menyimpang karena histori observasinya berbeda).
    ///         `d.vol` dan `d.sigmaSeed` diabaikan; `d.feed` harus sama dengan `vol.feed()`.
    function createPoolWithVol(EquinoxPool.Deploy calldata d, address vol) external returns (address pool) {
        if (address(EquinoxVolEngine(vol).feed()) != d.feed) revert VolFeedMismatch();
        EquinoxOptionToken token = new EquinoxOptionToken();
        pool = poolDeployer.deploy(d, address(token), vol);
        token.bindPool(pool);
        pools.push(pool);
        emit PoolCreated(pool, address(token), vol, d.math, d.usdg, d.feed);
    }
```
Perbarui NatSpec judul factory: `/// @notice Demo memanggil createPool (Pool B, engine baru) lalu createPoolWithVol (Pool A memakai engine Pool B) — K4.`

- [ ] **Step 4: Jalankan test + seluruh suite + ukuran**

Run: `cd contracts && forge test --match-contract EquinoxFactoryTest -vv 2>&1 | grep -E "^\[|Suite result" && forge test 2>&1 | tail -1 && forge build --sizes 2>&1 | grep -E "EquinoxFactory |PoolDeployer |EquinoxPool "`
Expected: 3 × `[PASS]`; `83 tests passed` (80 + 3); margin runtime EquinoxFactory tetap ≫ 0 (≈ 10 KB), PoolDeployer 1.552 B, EquinoxPool 6.764 B tidak berubah.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/pool/EquinoxFactory.sol contracts/test/EquinoxFactory.t.sol
git commit -m "feat(factory): createPoolWithVol — two pools share one vol engine (K4)"
```

---

### Task 2: `PoolE2EDeployer` dengan feed parametris & `sharedVol`; E2E devnode tetap hijau

**Files:**
- Modify: `contracts/src/mocks/PoolE2EDeployer.sol`, `tools/e2e/pool-e2e.sh`
- Create: `contracts/test/PoolE2EDeployer.t.sol`

**Interfaces:**
- Consumes: `EquinoxFactory.createPool` / `createPoolWithVol` (Task 1), `MockFeed`, `MockSequencerFeed`, `MockUSDG`.
- Produces: `constructor(address owner, address mathA, address mathB, address feed_, bool sharedVol)`; getter `feed()` (IAggregatorV3), `mockFeed()` (MockFeed, `address(0)` bila feed eksternal), `sharedVol()`, `poolA()`, `poolB()`, `usdg()`, `seq()`, `factory()`, `tick(int256)` (revert `NotMockFeed()` bila feed eksternal), `nextExpiry(uint256)`. Dipakai Task 3 (Sepolia) dan `pool-e2e.sh` (devnode).

- [ ] **Step 1: Tulis test yang gagal — `contracts/test/PoolE2EDeployer.t.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { PoolE2EDeployer } from "../src/mocks/PoolE2EDeployer.sol";
import { BlackScholesSol } from "../src/math/BlackScholesSol.sol";
import { MockFeed } from "../src/mocks/MockFeed.sol";

/// @notice Deployer demo: feed mock vs eksternal, engine bersama vs terpisah. (Foundry tidak bisa menjalankan Stylus,
///         jadi mathA == mathB == BlackScholesSol di sini; di chain sungguhan mathB = program Stylus.)
contract PoolE2EDeployerTest is Test {
    uint256 internal constant T0 = 1_789_718_400;
    address internal owner = makeAddr("owner");
    BlackScholesSol internal math;

    function setUp() public {
        vm.warp(T0);
        math = new BlackScholesSol();
    }

    function test_mock_feed_path_matches_devnode_behaviour() public {
        PoolE2EDeployer d = new PoolE2EDeployer(owner, address(math), address(math), address(0), false);
        assertTrue(address(d.mockFeed()) != address(0));
        assertEq(address(d.feed()), address(d.mockFeed()));
        (, int256 answer, , uint256 updatedAt, ) = d.feed().latestRoundData();
        assertEq(answer, 4000e8);
        assertEq(updatedAt, T0);
        assertTrue(address(d.poolA().vol()) != address(d.poolB().vol()), "dua engine (devnode, apples-to-apples)");
        assertEq(d.usdg().balanceOf(owner), 4_000_000e6);
        assertEq(d.poolA().asset(), address(d.usdg()));
        assertEq(d.poolB().asset(), address(d.usdg()));
        assertEq(d.poolA().owner(), owner);
        assertEq(d.poolB().treasury(), owner);
        d.tick(4100e8);
        (, answer, , , ) = d.feed().latestRoundData();
        assertEq(answer, 4100e8);
    }

    function test_external_feed_path_shares_engine_and_forbids_tick() public {
        MockFeed external_ = new MockFeed(8);
        external_.set(2627e8, T0);
        PoolE2EDeployer d = new PoolE2EDeployer(owner, address(math), address(math), address(external_), true);
        assertEq(address(d.mockFeed()), address(0));
        assertEq(address(d.feed()), address(external_));
        assertTrue(d.sharedVol());
        assertEq(address(d.poolA().vol()), address(d.poolB().vol()), "engine bersama (K4)");
        assertEq(address(d.poolB().vol().feed()), address(external_));
        assertEq(d.factory().poolCount(), 2);
        assertEq(d.factory().pools(0), address(d.poolB()), "B dibuat dulu (pemilik engine)");
        vm.expectRevert(PoolE2EDeployer.NotMockFeed.selector);
        d.tick(2700e8);
    }

    function test_nextExpiry_is_on_friday_grid() public {
        PoolE2EDeployer d = new PoolE2EDeployer(owner, address(math), address(math), address(0), false);
        uint64 e = d.nextExpiry(604_800);
        assertEq((uint256(e) - 115_200) % 604_800, 0);
        assertGe(uint256(e), block.timestamp + 604_800);
    }
}
```

- [ ] **Step 2: Jalankan — harus gagal (constructor lama 3 argumen)**

Run: `cd contracts && forge test --match-contract PoolE2EDeployerTest 2>&1 | tail -3`
Expected: error kompilasi (`Wrong argument count for function call`).

- [ ] **Step 3: Tulis ulang `contracts/src/mocks/PoolE2EDeployer.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { EquinoxPool } from "../pool/EquinoxPool.sol";
import { EquinoxFactory } from "../pool/EquinoxFactory.sol";
import { EquinoxVolEngine } from "../pool/EquinoxVolEngine.sol";
import { IAggregatorV3 } from "../interfaces/IAggregatorV3.sol";
import { MockUSDG } from "./MockUSDG.sol";
import { MockFeed } from "./MockFeed.sol";
import { MockSequencerFeed } from "./MockSequencerFeed.sol";

/// @title PoolE2EDeployer — satu `forge create` men-deploy mock + factory + dua pool identik (A = kontrol, B = Stylus).
/// @notice Dipakai tools/e2e/pool-e2e.sh (devnode: feed mock, dua engine) dan tools/sepolia/deploy-pools.sh (Sepolia: feed
///         Chainlink asli, engine bersama — K4). Tidak ada panggilan ke `math` di jalur deploy, sehingga simulasi Foundry
///         tidak menyentuh WASM (Foundry tidak bisa mengeksekusi program Stylus, §9.7).
contract PoolE2EDeployer {
    error NotMockFeed();

    MockUSDG public immutable usdg;
    IAggregatorV3 public immutable feed;   // mock (devnode) atau eksternal (Chainlink)
    MockFeed public immutable mockFeed;    // address(0) bila feed eksternal
    MockSequencerFeed public immutable seq;
    EquinoxFactory public immutable factory;
    EquinoxPool public immutable poolA;
    EquinoxPool public immutable poolB;
    bool public immutable sharedVol;

    /// @param feed_ address(0) → deploy MockFeed(8) dengan round 4000e8 "sekarang"; selain itu dipakai apa adanya (tanpa `set`).
    /// @param sharedVol_ true → Pool A memakai engine Pool B (`createPoolWithVol`); false → dua engine (`createPool` ×2).
    constructor(address owner, address mathA, address mathB, address feed_, bool sharedVol_) {
        usdg = new MockUSDG();
        MockFeed m = MockFeed(address(0));
        IAggregatorV3 f = IAggregatorV3(feed_);
        if (feed_ == address(0)) {
            m = new MockFeed(8);
            m.set(4000e8, block.timestamp);
            f = IAggregatorV3(address(m));
        }
        mockFeed = m;
        feed = f;
        seq = new MockSequencerFeed();
        seq.set(0, block.timestamp - 2 hours);
        factory = new EquinoxFactory();
        sharedVol = sharedVol_;
        // Pool B dulu: engine-nya (math Stylus di chain sungguhan) menjadi engine bersama bila sharedVol.
        EquinoxPool b = EquinoxPool(factory.createPool(_params(owner, mathB, address(f), "Equinox LP (Stylus)", "eqB")));
        EquinoxPool.Deploy memory pa = _params(owner, mathA, address(f), "Equinox LP (control)", "eqA");
        EquinoxPool a = sharedVol_
            ? EquinoxPool(factory.createPoolWithVol(pa, address(b.vol())))
            : EquinoxPool(factory.createPool(pa));
        poolA = a;
        poolB = b;
        usdg.mint(owner, 4_000_000e6);
    }

    /// @notice Round baru "sekarang" pada feed mock (harga 8 desimal) — hanya untuk devnode/demo lokal.
    function tick(int256 price8) external {
        if (address(mockFeed) == address(0)) revert NotMockFeed();
        mockFeed.set(price8, block.timestamp);
    }

    /// @notice Expiry grid berikutnya (Jumat 08:00 UTC) yang ≥ now + minTenor.
    function nextExpiry(uint256 minTenor) external view returns (uint64) {
        return uint64(((block.timestamp + minTenor - 115_200) / 604_800 + 1) * 604_800 + 115_200);
    }

    function _params(address owner, address math, address feed_, string memory name, string memory symbol) internal view returns (EquinoxPool.Deploy memory d) {
        d.owner = owner;
        d.usdg = address(usdg);
        d.feed = feed_;
        d.sequencerFeed = address(seq);
        d.math = math;
        d.treasury = owner;
        d.cfg = EquinoxPool.Config({ feeBps: 300, maxUtilBps: 8000, vegaCapBps: 500, minPremiumBps: 5, heartbeat: 3600, staleMult: 3, sequencerGrace: 3600, maxOpenSeries: 32, tenorMax: 30 days, minSize: 1e16, settleBounty: 2e6 });
        d.vol = EquinoxVolEngine.Params({ lambdaPerDay: 0.94e18, vrp: 1.15e18, alpha: 0.3e18, spread: 0.05e18, sigmaMin: 0.2e18, sigmaMax: 3e18 });
        d.sigmaSeed = 0.55e18;
        d.rWad = 0;
        d.name = name;
        d.symbol = symbol;
    }
}
```

- [ ] **Step 4: Perbarui `tools/e2e/pool-e2e.sh`** — baris `forge create`: tambahkan dua argumen konstruktor:

```bash
DEPLOYER=$(forge create --rpc-url "$RPC" --private-key "$PK" --broadcast src/mocks/PoolE2EDeployer.sol:PoolE2EDeployer --constructor-args "$ME" "$MATH_A" "$MATH_B" 0x0000000000000000000000000000000000000000 false | grep "Deployed to" | awk '{print $3}')
```
(devnode: feed mock, dua engine → benchmark apples-to-apples tidak berubah).

- [ ] **Step 5: Test, suite, ukuran**

Run: `cd contracts && forge test --match-contract PoolE2EDeployerTest -vv 2>&1 | grep -E "^\[|Suite result" && forge test 2>&1 | tail -1 && forge build --sizes 2>&1 | grep -E "PoolE2EDeployer"`
Expected: 3 × `[PASS]`; `86 tests passed`; `PoolE2EDeployer` initcode < 49.152 (margin positif; sebelumnya 43.680 B — bertambah sedikit karena cabang `createPoolWithVol`).

- [ ] **Step 6: Verifikasi E2E devnode tidak berubah**

```bash
cd /home/mdlog/Project-MDlabs/Hackquest/arbitrum-sg/Equinox
setsid nohup tools/devnode/up.sh > /tmp/devnode-plan3a.log 2>&1 &
until grep -q "devnode siap" /tmp/devnode-plan3a.log; do sleep 5; done
tools/devnode/deploy.sh devnode http://127.0.0.1:8547 0xb6b15c8cb491557369f3c7d2c287b053eb229daa9c22138887752191c9520659 | tail -3
tools/e2e/pool-e2e.sh deployments/devnode.json 0xb6b15c8cb491557369f3c7d2c287b053eb229daa9c22138887752191c9520659; echo "exit=$?"
docker rm -f nitro-dev
```
Expected: `quoteBuy identik: (…)`, 4 × `OK`, tabel gas dengan rasio ≈ 1,05× / 1,08× / 0,99× (±3 %), `exit=0`. (Bila skew timestamp A/B membuat satu `BEDA` pada NAV/poolCash, jalankan ulang skrip sekali — artefak yang didokumentasikan di BENCHMARK.)

- [ ] **Step 7: Commit**

```bash
git add contracts/src/mocks/PoolE2EDeployer.sol contracts/test/PoolE2EDeployer.t.sol tools/e2e/pool-e2e.sh
git commit -m "feat(mocks): PoolE2EDeployer takes an external feed and a sharedVol flag; devnode E2E unchanged"
```

---

### Task 3: `tools/sepolia/lib.sh` + `deploy-pools.sh` — dua pool live di Sepolia

**Files:**
- Create: `tools/sepolia/lib.sh`, `tools/sepolia/deploy-pools.sh`
- Modify: `deployments/arbitrum-sepolia.json` (blok `pools` ditambahkan oleh skrip; di-commit)

**Interfaces:**
- Consumes: `PoolE2EDeployer(owner, mathA, mathB, feed, true)` (Task 2), `.env`, `deployments/arbitrum-sepolia.json` (`rpc`, `blackScholesSol`, `blackScholesStylus`).
- Produces: `deployments/arbitrum-sepolia.json.pools = { deployer, usdg, feed, sequencerFeed, vol, A:{label,pool,token,math}, B:{…}, deployedAtBlock, deployedAt, boards: [] }`; `lib.sh` mengekspor `ROOT, DEP, RPC, PK, ME`, fungsi `addr TARGET SIG [ARGS]` (alamat huruf kecil), `num TARGET SIG [ARGS]` (angka tanpa anotasi), `send TARGET SIG [ARGS]` (mencetak `txhash gasUsed`), `die MSG`, `jq_set FILTER [--arg …]` (tulis JSON in-place). Dipakai Task 4–6.

- [ ] **Step 1: `tools/sepolia/lib.sh`**

```bash
#!/usr/bin/env bash
# Pustaka bersama skrip Sepolia. Sumber: .env (kunci, RPC) + deployments/arbitrum-sepolia.json (alamat).
# Kunci hanya lewat env var; tidak pernah dicetak. Pakai: source tools/sepolia/lib.sh (setelah ROOT diset).
set -euo pipefail
ROOT="${ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
DEP="$ROOT/deployments/arbitrum-sepolia.json"
[ -f "$ROOT/.env" ] && { set -a; source "$ROOT/.env"; set +a; }
: "${SEPOLIA_PRIVATE_KEY:?SEPOLIA_PRIVATE_KEY tidak ada — isi .env (git-ignored)}"
PK="$SEPOLIA_PRIVATE_KEY"
RPC="${SEPOLIA_RPC_URL:-$(jq -r .rpc "$DEP")}"
ME=$(cast wallet address --private-key "$PK")
CHAIN=$(cast chain-id --rpc-url "$RPC"); [ "$CHAIN" == "421614" ] || { echo "chain $CHAIN bukan Arbitrum Sepolia (421614)"; exit 1; }

die() { echo "GAGAL: $*" >&2; exit 1; }
# alamat huruf kecil dari cast call
addr() { cast call --rpc-url "$RPC" "$1" "$2" "${@:3}" | awk '{print tolower($1)}'; }
# angka tanpa anotasi [1.2e3]
num() { cast call --rpc-url "$RPC" "$1" "$2" "${@:3}" | awk '{print $1}'; }
# kirim tx; cetak "txhash gasUsed"; gagal keras bila revert. Pakai lewat command substitution — res=$(send …) —
# supaya kegagalan menghentikan skrip (errexit); JANGAN lewat process substitution (< <(send …)), yang menelan exit code.
send() {
  local out; out=$(cast send --rpc-url "$RPC" --private-key "$PK" "$@" 2>&1) || { echo "$out" | tail -3 >&2; die "cast send $1 $2"; }
  echo "$out" | awk '/^transactionHash[[:space:]]/ {h=$2} /^gasUsed[[:space:]]/ {g=$2} END {print h, g}'
}
# tulis JSON in-place: jq_set '<filter>' [--arg k v …]
jq_set() { local f=$1; shift; local tmp; tmp=$(mktemp); jq "$@" "$f" "$DEP" > "$tmp" && mv "$tmp" "$DEP"; }
lower() { echo "$1" | tr '[:upper:]' '[:lower:]'; }
arbiscan() { echo "https://sepolia.arbiscan.io/tx/$1"; }
```

- [ ] **Step 2: `tools/sepolia/deploy-pools.sh`**

```bash
#!/usr/bin/env bash
# Deploy PoolE2EDeployer ke Arbitrum Sepolia: MockUSDG + MockSequencerFeed + factory + Pool B (Stylus, engine baru) +
# Pool A (kontrol, engine bersama — K4), feed Chainlink ETH/USD asli. Idempoten: berhenti bila .pools sudah ada.
# Pakai: tools/sepolia/deploy-pools.sh          (.env: SEPOLIA_PRIVATE_KEY, SEPOLIA_RPC_URL)
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; source "$ROOT/tools/sepolia/lib.sh"
FEED=0xd30e2101a97dcbaebcbc04f14c3f624e67a35165   # Chainlink ETH/USD, Arbitrum Sepolia (spec §1)
MATH_A=$(jq -r .blackScholesSol "$DEP"); MATH_B=$(jq -r .blackScholesStylus "$DEP")
[ "$(jq -r '.pools.deployer // empty' "$DEP")" == "" ] || { echo "pools sudah ada di $DEP (deployer $(jq -r .pools.deployer "$DEP")) — hapus blok .pools untuk deploy ulang"; exit 0; }
# feed harus hidup & segar sebelum deploy (constructor engine membaca latestRoundData)
FEED_TS=$(cast call --rpc-url "$RPC" "$FEED" "latestRoundData()(uint80,int256,uint256,uint256,uint80)" | sed -n 4p | awk '{print $1}')
NOW=$(date -u +%s); [ $((NOW - FEED_TS)) -le 3600 ] || die "feed Chainlink tidak segar (umur $((NOW - FEED_TS)) s)"
cd "$ROOT/contracts"
OUT=$(forge create --rpc-url "$RPC" --private-key "$PK" --broadcast src/mocks/PoolE2EDeployer.sol:PoolE2EDeployer \
      --constructor-args "$ME" "$MATH_A" "$MATH_B" "$FEED" true)
DEPLOYER=$(echo "$OUT" | awk '/Deployed to/ {print tolower($3)}'); TX=$(echo "$OUT" | awk '/Transaction hash/ {print $3}')
[ -n "$DEPLOYER" ] && [ -n "$TX" ] || { echo "$OUT"; die "forge create"; }
BLOCK=$(cast receipt --rpc-url "$RPC" "$TX" blockNumber)
A=$(addr "$DEPLOYER" "poolA()(address)"); B=$(addr "$DEPLOYER" "poolB()(address)")
USDG=$(addr "$DEPLOYER" "usdg()(address)"); SEQ=$(addr "$DEPLOYER" "seq()(address)")
VOL=$(addr "$B" "vol()(address)"); TOK_A=$(addr "$A" "token()(address)"); TOK_B=$(addr "$B" "token()(address)")
# verifikasi K4 + kabel
[ "$(addr "$A" "vol()(address)")" == "$VOL" ] || die "engine tidak bersama"
[ "$(addr "$VOL" "feed()(address)")" == "$FEED" ] || die "feed engine bukan Chainlink"
[ "$(addr "$A" "asset()(address)")" == "$USDG" ] && [ "$(addr "$B" "asset()(address)")" == "$USDG" ] || die "asset"
[ "$(addr "$A" "math()(address)")" == "$(lower "$MATH_A")" ] && [ "$(addr "$B" "math()(address)")" == "$(lower "$MATH_B")" ] || die "math"
SB=$(num "$VOL" "sigmaBase()(uint256)"); [ "$SB" != "0" ] || die "sigmaBase 0"
jq_set '.pools = {deployer:$dep, deployTx:$tx, usdg:$usdg, feed:$feed, sequencerFeed:$seq, vol:$vol,
        A:{label:"control (BlackScholesSol)", pool:$a, token:$ta, math:$ma},
        B:{label:"Equinox (Stylus)", pool:$b, token:$tb, math:$mb},
        deployedAtBlock:($blk|tonumber), deployedAt:$ts, boards:[]}' \
  --arg dep "$DEPLOYER" --arg tx "$TX" --arg usdg "$USDG" --arg feed "$FEED" --arg seq "$SEQ" --arg vol "$VOL" \
  --arg a "$A" --arg ta "$TOK_A" --arg ma "$(lower "$MATH_A")" --arg b "$B" --arg tb "$TOK_B" --arg mb "$(lower "$MATH_B")" \
  --arg blk "$BLOCK" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "deployer=$DEPLOYER (blok $BLOCK, $(arbiscan "$TX"))"; echo "poolA=$A poolB=$B vol=$VOL usdg=$USDG seq=$SEQ"
echo "sigmaBase=$SB ($(python3 -c "print(f'{$SB/1e18:.4f}')"))"; jq .pools "$DEP"
```

- [ ] **Step 3: Jalankan deploy (transaksi nyata di Sepolia; gas ≈ 0,002 ETH)**

```bash
cd /home/mdlog/Project-MDlabs/Hackquest/arbitrum-sg/Equinox && chmod +x tools/sepolia/*.sh && tools/sepolia/deploy-pools.sh
```
Expected: alamat deployer/pool/engine tercetak, `sigmaBase=550000000000000000 (0.5500)`, blok JSON `.pools` dengan `boards: []`. Jalankan sekali lagi → `pools sudah ada … exit 0` (idempoten). Bila `forge create` gagal dengan `max fee per gas less than block base fee`, ulangi (forge mengestimasi ulang) — jangan ubah kunci/JSON manual.

- [ ] **Step 4: Commit**

```bash
git add tools/sepolia/lib.sh tools/sepolia/deploy-pools.sh deployments/arbitrum-sepolia.json
git commit -m "deploy(sepolia): two pools (control vs Stylus) with the real Chainlink ETH/USD feed and a shared vol engine"
```

---

### Task 4: `tools/sepolia/list-boards.sh` — seed LP + dua board per pool

**Files:**
- Create: `tools/sepolia/list-boards.sh`
- Modify: `deployments/arbitrum-sepolia.json` (`pools.boards[]`)

**Interfaces:**
- Consumes: `lib.sh`, `.pools.{A,B,usdg}`; `EquinoxPool.deposit/createBoard/board/spot/balanceOf`, `EquinoxOptionToken.seriesId`.
- Produces: `pools.boards = [{ id, expiry, expiryIso, strikes:["2400","2600","2800"], seriesIds:{A:[…6], B:[…6]}, listTx:{A,B} }, …]` — urutan seri: `[C K0, P K0, C K1, P K1, C K2, P K2]`. Dipakai keeper (Task 5), demo (Task 6), web (Plan 3b).

- [ ] **Step 1: Skrip**

```bash
#!/usr/bin/env bash
# Seed LP (1.000.000 USDG per pool) + dua board identik di Pool A dan B. Idempoten per expiry.
# Pakai: tools/sepolia/list-boards.sh [EXPIRY:K1,K2,K3 …]   default: 1790323200:2400,2600,2800 1790928000:2200,2600,3000
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; source "$ROOT/tools/sepolia/lib.sh"
A=$(jq -r .pools.A.pool "$DEP"); B=$(jq -r .pools.B.pool "$DEP"); USDG=$(jq -r .pools.usdg "$DEP")
TOK_A=$(jq -r .pools.A.token "$DEP"); TOK_B=$(jq -r .pools.B.token "$DEP")
[ "$A" != "null" ] || die "jalankan deploy-pools.sh dulu"
SPECS=("$@"); [ ${#SPECS[@]} -gt 0 ] || SPECS=("1790323200:2400,2600,2800" "1790928000:2200,2600,3000")
MAX=115792089237316195423570985008687907853269984665640564039457584007913129639935
SEED=1000000000000   # 1.000.000 USDG (6 dp)
# --- seed LP (sekali per pool) ---
for P in "$A" "$B"; do
  if [ "$(num "$P" "balanceOf(address)(uint256)" "$ME")" == "0" ]; then
    [ "$(num "$USDG" "allowance(address,address)(uint256)" "$ME" "$P")" != "0" ] || send "$USDG" "approve(address,uint256)" "$P" "$MAX" >/dev/null
    res=$(send "$P" "deposit(uint256,address)" "$SEED" "$ME"); tx=${res%% *}; gas=${res##* }; echo "deposit 1.000.000 USDG → $P: $(arbiscan "$tx") gas=$gas"
  else echo "seed LP sudah ada di $P"; fi
done
# --- board ---
SPOT=$(num "$A" "spot()(uint256,bool)" | head -1)   # WAD
for spec in "${SPECS[@]}"; do
  EXP=${spec%%:*}; KS=${spec#*:}
  [ $(( (EXP - 115200) % 604800 )) -eq 0 ] || die "expiry $EXP bukan grid Jumat 08:00 UTC"
  if jq -e --arg e "$EXP" '.pools.boards[] | select(.expiry == ($e|tonumber))' "$DEP" >/dev/null; then echo "board $EXP sudah tercatat — lewati"; continue; fi
  python3 - "$SPOT" "$KS" <<'PY' || die "strike di luar [S/2, 2S] untuk spot saat ini — pilih strike lain secara sadar"
import sys; s=int(sys.argv[1]); ks=[int(k)*10**18 for k in sys.argv[2].split(',')]
assert ks==sorted(ks) and len(set(ks))==len(ks), "strike harus naik & unik"
for k in ks: assert s//2 <= k <= 2*s, f"{k/1e18} di luar [{s/2e18:.0f}, {2*s/1e18:.0f}]"
print("strike ok, spot", s/1e18)
PY
  STRIKES="[$(python3 -c "print(','.join(str(int(k)*10**18) for k in '$KS'.split(',')))")]"
  res=$(send "$A" "createBoard(uint64,uint128[])" "$EXP" "$STRIKES"); txa=${res%% *}; gasa=${res##* }
  res=$(send "$B" "createBoard(uint64,uint128[])" "$EXP" "$STRIKES"); txb=${res%% *}; gasb=${res##* }
  IDA=$(( $(num "$A" "boardCount()(uint256)") - 1 )); IDB=$(( $(num "$B" "boardCount()(uint256)") - 1 ))
  [ "$IDA" == "$IDB" ] || die "boardId A ($IDA) != B ($IDB)"
  # seri: derivasi deterministik (sama dengan board(id).seriesIds — urutan C,P per strike), lalu cek expiry on-chain
  SA="[]"; SB="[]"
  for k in ${KS//,/ }; do for c in true false; do
    ia=$(num "$TOK_A" "seriesId(address,uint64,uint128,bool)(uint256)" "$A" "$EXP" "${k}000000000000000000" "$c")
    ib=$(num "$TOK_B" "seriesId(address,uint64,uint128,bool)(uint256)" "$B" "$EXP" "${k}000000000000000000" "$c")
    [ "$(cast call --rpc-url "$RPC" "$A" "series(uint256)(uint32,uint64,uint128,bool,bool,uint256,uint256,uint256)" "$ia" | sed -n 2p | awk '{print $1}')" == "$EXP" ] || die "seri $ia tidak terdaftar di A"
    SA=$(jq -cn --argjson a "$SA" --arg v "$ia" '$a + [$v]'); SB=$(jq -cn --argjson b "$SB" --arg v "$ib" '$b + [$v]')
  done; done
  jq_set '.pools.boards += [{id:($id|tonumber), expiry:($e|tonumber), expiryIso:$iso, strikes:($ks|split(",")), seriesIds:{A:$sa, B:$sb}, listTx:{A:$txa, B:$txb}}]' \
    --arg id "$IDA" --arg e "$EXP" --arg iso "$(date -u -d @"$EXP" +%Y-%m-%dT%H:%M:%SZ)" --arg ks "$KS" --argjson sa "$SA" --argjson sb "$SB" --arg txa "$txa" --arg txb "$txb"
  echo "board $IDA expiry $EXP strikes $KS: A $(arbiscan "$txa") (gas $gasa) | B $(arbiscan "$txb") (gas $gasb)"
done
jq '.pools.boards' "$DEP"
```
Catatan: `num "$A" "spot()(uint256,bool)"` — `spot()` mengembalikan dua nilai; baris pertama = harga WAD. `series(id)` baris ke-2 = `expiry`.

- [ ] **Step 2: Jalankan (transaksi nyata: 2 approve, 2 deposit, 4 createBoard)**

Run: `tools/sepolia/list-boards.sh`
Expected: dua baris `deposit 1.000.000 USDG → …`, `strike ok, spot 26xx.xx` ×2, dua baris `board 0 expiry 1790323200 …` dan `board 1 expiry 1790928000 …`, JSON `boards` berisi 2 entri × 6 seri per pool. Jalankan lagi → "seed LP sudah ada", "board … sudah tercatat — lewati". Cek on-chain: `cast call <A> "openSeriesIds()(uint256[])"` berisi 12 id.

- [ ] **Step 3: Commit**

```bash
git add tools/sepolia/list-boards.sh deployments/arbitrum-sepolia.json
git commit -m "deploy(sepolia): seed LP 1M USDG per pool and list boards 25 Sep / 2 Oct 2026 (12 series each)"
```

---

### Task 5: Keeper — `tools/keeper/keeper.sh` + workflow cron + wallet keeper

**Files:**
- Create: `tools/keeper/keeper.sh`, `.github/workflows/keeper.yml`
- Modify: `.env` (tambah `KEEPER_PRIVATE_KEY`; git-ignored), secret repo `KEEPER_PRIVATE_KEY` (GitHub)

**Interfaces:**
- Consumes: `deployments/arbitrum-sepolia.json` (`pools.vol`, `pools.A/B.pool`, `pools.boards[]`, `blackScholesStylus`, `rpc`), env `KEEPER_PRIVATE_KEY`, `SEPOLIA_RPC_URL` (opsional), `DRY_RUN`.
- Produces: log kesehatan + hash `poke`/`settle`; exit 0 kecuali RPC/kunci gagal.

- [ ] **Step 1: Wallet keeper (sekali) — buat, danai 0,02 ETH dari owner, simpan**

```bash
cd /home/mdlog/Project-MDlabs/Hackquest/arbitrum-sg/Equinox && set -a && source .env && set +a
NEW=$(cast wallet new --json | jq -r '.[0]')       # {"address":…,"private_key":…}
KADDR=$(echo "$NEW" | jq -r .address); KPK=$(echo "$NEW" | jq -r .private_key)
grep -q '^KEEPER_PRIVATE_KEY=' .env || printf '\n# wallet keeper (cron GitHub Actions) — terpisah dari owner\nKEEPER_PRIVATE_KEY=%s\nKEEPER_ADDRESS=%s\n' "$KPK" "$KADDR" >> .env
cast send --rpc-url "$SEPOLIA_RPC_URL" --private-key "$SEPOLIA_PRIVATE_KEY" "$KADDR" --value 0.02ether | grep -E "^(status|transactionHash)"
cast balance --rpc-url "$SEPOLIA_RPC_URL" "$KADDR" --ether
GH_TOKEN=$(sed -n 's#https://nodesproof:\([^@]*\)@github.com#\1#p' ~/.git-credentials) gh secret set KEEPER_PRIVATE_KEY --repo nodesproof/equinox --body "$KPK"
GH_TOKEN=$(sed -n 's#https://nodesproof:\([^@]*\)@github.com#\1#p' ~/.git-credentials) gh secret list --repo nodesproof/equinox
echo "keeper=$KADDR"
```
Expected: `status 1 (success)`, saldo `0.02`, `KEEPER_PRIVATE_KEY` di daftar secret. **Jangan cetak `$KPK`/`$NEW` ke laporan** — hanya alamatnya. Bila `.env` sudah memuat `KEEPER_PRIVATE_KEY`, pakai yang ada (lewati pembuatan).

- [ ] **Step 2: `tools/keeper/keeper.sh`**

```bash
#!/usr/bin/env bash
# Keeper Equinox (Sepolia): poke engine vol bersama, settle board yang sudah expiry (round segar ≥ expiry), laporan kesehatan.
# Sistem tidak bergantung padanya untuk keselamatan (§10.3) — ia hanya mempercepat. Idempoten; revert settle yang sah ditoleransi.
# Pakai: KEEPER_PRIVATE_KEY=0x… [SEPOLIA_RPC_URL=…] [DRY_RUN=1] tools/keeper/keeper.sh [deployments/arbitrum-sepolia.json]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEP="${1:-$ROOT/deployments/arbitrum-sepolia.json}"
: "${KEEPER_PRIVATE_KEY:?KEEPER_PRIVATE_KEY tidak ada}"
PK="$KEEPER_PRIVATE_KEY"; RPC="${SEPOLIA_RPC_URL:-$(jq -r .rpc "$DEP")}"; DRY="${DRY_RUN:-0}"
ME=$(cast wallet address --private-key "$PK")
VOL=$(jq -r .pools.vol "$DEP"); A=$(jq -r .pools.A.pool "$DEP"); B=$(jq -r .pools.B.pool "$DEP")
FEED=$(jq -r .pools.feed "$DEP"); STYLUS=$(jq -r .blackScholesStylus "$DEP")
num() { cast call --rpc-url "$RPC" "$1" "$2" "${@:3}" | awk '{print $1}'; }
NOW=$(date -u +%s)
echo "== keeper $ME @ $(date -u +%FT%TZ) (DRY_RUN=$DRY) saldo $(cast balance --rpc-url "$RPC" "$ME" --ether) ETH"
# --- kesehatan ---
RD=$(cast call --rpc-url "$RPC" "$FEED" "latestRoundData()(uint80,int256,uint256,uint256,uint80)")
PRICE=$(echo "$RD" | sed -n 2p | awk '{print $1}'); UPD=$(echo "$RD" | sed -n 4p | awk '{print $1}')
echo "feed: $(python3 -c "print(f'{$PRICE/1e8:.2f}')") USD, umur $((NOW - UPD)) s $([ $((NOW - UPD)) -gt 10800 ] && echo '!! STALE (>3 jam)')"
TL=$(num 0x0000000000000000000000000000000000000071 "programTimeLeft(address)(uint64)" "$STYLUS")
echo "stylus programTimeLeft: $((TL / 86400)) hari $([ "$TL" -lt 2592000 ] && echo '!! < 30 hari — aktivasi ulang diperlukan')"
echo "sigmaBase: $(num "$VOL" "sigmaBase()(uint256)")  NAV A: $(num "$A" "totalAssets()(uint256)")  NAV B: $(num "$B" "totalAssets()(uint256)")"
echo "reserved A/B: $(num "$A" "reserved()(uint256)") / $(num "$B" "reserved()(uint256)")  escrow A/B: $(num "$A" "escrowedPayouts()(uint256)") / $(num "$B" "escrowedPayouts()(uint256)")"
# --- poke (engine bersama) ---
if [ "$DRY" == "1" ]; then echo "poke (simulasi): $(cast call --rpc-url "$RPC" --from "$ME" "$VOL" "poke()(uint256)" | awk '{print $1}')"
else TX=$(cast send --rpc-url "$RPC" --private-key "$PK" "$VOL" "poke()" 2>&1 | awk '/^transactionHash[[:space:]]/ {print $2}'); echo "poke: $TX lastRoundId=$(num "$VOL" "lastRoundId()(uint80)")"; fi
# --- settle board yang sudah expiry ---
for P in "$A" "$B"; do
  for ID in $(jq -r '.pools.boards[].id' "$DEP"); do
    BD=$(cast call --rpc-url "$RPC" "$P" "board(uint256)(uint64,bool,uint256,uint256[])" "$ID")
    EXP=$(echo "$BD" | sed -n 1p | awk '{print $1}'); SETTLED=$(echo "$BD" | sed -n 2p)
    [ "$NOW" -ge "$EXP" ] || { echo "board $ID @ $P: expiry dalam $(( (EXP - NOW) / 3600 )) jam"; continue; }
    [ "$SETTLED" == "false" ] || { echo "board $ID @ $P: sudah settle (harga $(echo "$BD" | sed -n 3p | awk '{print $1}'))"; continue; }
    if cast call --rpc-url "$RPC" --from "$ME" "$P" "settle(uint256)" "$ID" >/dev/null 2>&1; then
      if [ "$DRY" == "1" ]; then echo "board $ID @ $P: settle SIAP (simulasi)"
      else TX=$(cast send --rpc-url "$RPC" --private-key "$PK" "$P" "settle(uint256)" "$ID" 2>&1 | awk '/^transactionHash[[:space:]]/ {print $2}'); echo "board $ID @ $P: SETTLED $TX"; fi
    else echo "board $ID @ $P: belum bisa settle (round segar ≥ expiry belum ada)"; fi
  done
done
```

- [ ] **Step 3: `.github/workflows/keeper.yml`**

```yaml
name: keeper
on:
  schedule:
    - cron: '*/15 * * * *'   # hanya aktif di branch default (main)
  workflow_dispatch:
permissions: { contents: read }
concurrency: { group: keeper, cancel-in-progress: false }
jobs:
  keeper:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: foundry-rs/foundry-toolchain@v1
      - name: poke + settle (Arbitrum Sepolia)
        env:
          KEEPER_PRIVATE_KEY: ${{ secrets.KEEPER_PRIVATE_KEY }}
          SEPOLIA_RPC_URL: ${{ secrets.SEPOLIA_RPC_URL }}
        run: tools/keeper/keeper.sh deployments/arbitrum-sepolia.json
```
(`SEPOLIA_RPC_URL` boleh kosong → skrip memakai RPC publik dari JSON.)

- [ ] **Step 4: Uji lokal — simulasi lalu satu run nyata**

```bash
cd /home/mdlog/Project-MDlabs/Hackquest/arbitrum-sg/Equinox && chmod +x tools/keeper/keeper.sh && set -a && source .env && set +a
DRY_RUN=1 tools/keeper/keeper.sh
tools/keeper/keeper.sh
```
Expected: blok kesehatan (feed umur < 300 s, programTimeLeft ≈ 365 hari, sigmaBase, NAV A/B), `poke (simulasi): 550000000000000000` lalu pada run nyata `poke: 0x… lastRoundId=…` (bertambah bila ada round baru), 4 baris `board … expiry dalam N jam`. Exit 0.

- [ ] **Step 5: Commit** (push & aktivasi cron terjadi setelah merge ke `main`; `workflow_dispatch` diuji setelah merge)

```bash
git add tools/keeper/keeper.sh .github/workflows/keeper.yml
git commit -m "keeper: poke shared vol engine and settle expired boards on Arbitrum Sepolia (GitHub Actions cron)"
```

---

### Task 6: Demo live — `tools/demo/sepolia-demo.sh` → `docs/DEMO_LOG.md`

**Files:**
- Create: `tools/demo/sepolia-demo.sh`, `docs/DEMO_LOG.md` (dibuat/ditambah oleh skrip; di-commit)

**Interfaces:**
- Consumes: `lib.sh`, `.pools.*`, board 0 (`seriesIds.A/B[4]` = C 2800, `[1]` = P 2400).
- Produces: bagian baru di `docs/DEMO_LOG.md` per run (`--trade` default, `--claim` setelah settle); mencetak kuotasi A vs B (harus identik pada blok yang sama), gas `buy`/`close`, NAV/σ/reserved.

- [ ] **Step 1: Skrip**

```bash
#!/usr/bin/env bash
# Demo live di Arbitrum Sepolia: narasi identik di Pool A (kontrol) dan B (Stylus) — kuotasi harus identik pada blok yang sama.
# Pakai: tools/demo/sepolia-demo.sh [--trade|--claim] [BOARD_IDX=0]
#   --trade : beli 10 C K_hi, beli 1 P K_lo (cetak mid vs floor 5 bps × K — mana yang menang), tutup 5 C K_hi; catat gas & tx hash
#   --claim : setelah expiry — settle bila perlu (permissionless), claim semua posisi owner, catat payout
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; source "$ROOT/tools/sepolia/lib.sh"
MODE=${1:---trade}; BI=${2:-0}; LOG="$ROOT/docs/DEMO_LOG.md"
A=$(jq -r .pools.A.pool "$DEP"); B=$(jq -r .pools.B.pool "$DEP"); USDG=$(jq -r .pools.usdg "$DEP"); VOL=$(jq -r .pools.vol "$DEP")
TOK_A=$(jq -r .pools.A.token "$DEP"); TOK_B=$(jq -r .pools.B.token "$DEP")
EXP=$(jq -r ".pools.boards[$BI].expiry" "$DEP"); KS=($(jq -r ".pools.boards[$BI].strikes[]" "$DEP")); BID=$(jq -r ".pools.boards[$BI].id" "$DEP")
KLO=${KS[0]}; KHI=${KS[${#KS[@]}-1]}
ida() { jq -r ".pools.boards[$BI].seriesIds.A[$1]" "$DEP"; }; idb() { jq -r ".pools.boards[$BI].seriesIds.B[$1]" "$DEP"; }
C_A=$(ida $(( (${#KS[@]}-1)*2 ))); C_B=$(idb $(( (${#KS[@]}-1)*2 ))); P_A=$(ida 1); P_B=$(idb 1)
MAX=115792089237316195423570985008687907853269984665640564039457584007913129639935
QSIG="quoteBuy(uint256,uint256)((uint256,uint256,uint256,int256,uint256,uint256))"
usd() { python3 -c "print(f'{$1/1e6:,.6f}')"; }; wad() { python3 -c "print(f'{$1/1e18:.6f}')"; }
row() { printf '| %s | %s | %s |\n' "$1" "$2" "$3" >> "$LOG"; }
[ -f "$LOG" ] || printf '# Equinox — log demo live di Arbitrum Sepolia\n\nSetiap bagian = satu run `tools/demo/sepolia-demo.sh`. Pool A = kontrol `BlackScholesSol`, Pool B = Stylus; engine σ bersama (K4). Tautan = Arbiscan Sepolia.\n' > "$LOG"
BLK=$(cast block-number --rpc-url "$RPC"); TS=$(date -u +%FT%TZ)
printf '\n## %s — `%s` board %s (expiry %s) @ blok %s\n\n' "$TS" "$MODE" "$BID" "$(jq -r ".pools.boards[$BI].expiryIso" "$DEP")" "$BLK" >> "$LOG"
SPOT=$(num "$A" "spot()(uint256,bool)" | head -1); printf 'Spot Chainlink: **%s USD**; σ_base %s; σ_mark(0) %s.\n\n' "$(wad "$SPOT")" "$(wad "$(num "$VOL" "sigmaBase()(uint256)")")" "$(wad "$(num "$VOL" "sigmaMark(uint256)(uint256)" 0)")" >> "$LOG"
printf '| Langkah | Pool A (kontrol) | Pool B (Stylus) |\n|---|---|---|\n' >> "$LOG"
if [ "$MODE" == "--trade" ]; then
  [ "$(num "$USDG" "allowance(address,address)(uint256)" "$ME" "$A")" != "0" ] || send "$USDG" "approve(address,uint256)" "$A" "$MAX" >/dev/null
  [ "$(num "$USDG" "allowance(address,address)(uint256)" "$ME" "$B")" != "0" ] || send "$USDG" "approve(address,uint256)" "$B" "$MAX" >/dev/null
  # kuotasi pada blok yang sama
  QA=$(cast call --rpc-url "$RPC" --block "$BLK" "$A" "$QSIG" "$C_A" 10000000000000000000); QB=$(cast call --rpc-url "$RPC" --block "$BLK" "$B" "$QSIG" "$C_B" 10000000000000000000)
  [ "$QA" == "$QB" ] || die "BEDA quoteBuy 10 C $KHI pada blok $BLK: A=$QA B=$QB"
  PREM=$(echo "$QA" | tr -d '()' | awk -F', ' '{print $1}' | awk '{print $1}'); SIG=$(echo "$QA" | tr -d '()' | awk -F', ' '{print $3}' | awk '{print $1}')
  row "quoteBuy 10 C $KHI (blok $BLK)" "premi $(usd "$PREM") USDG @ σ_buy $(wad "$SIG")" "identik ✓"
  res=$(send "$A" "buy(uint256,uint256,uint256)" "$C_A" 10000000000000000000 "$MAX"); txa=${res%% *}; ga=${res##* }
  res=$(send "$B" "buy(uint256,uint256,uint256)" "$C_B" 10000000000000000000 "$MAX"); txb=${res%% *}; gb=${res##* }
  row "buy 10 C $KHI" "[$ga gas]($(arbiscan "$txa"))" "[$gb gas]($(arbiscan "$txb"))  rasio $(python3 -c "print(f'{$ga/$gb:.2f}')")×"
  QPA=$(cast call --rpc-url "$RPC" "$A" "$QSIG" "$P_A" 1000000000000000000); PP=$(echo "$QPA" | tr -d '()' | awk -F', ' '{print $1}' | awk '{print $1}')
  FLOOR=$(python3 -c "print(int($KLO*10**6*5//10000))")   # minPremiumBps 5 × K × 1 unit, dalam 6 dp
  row "quoteBuy 1 P $KLO" "premi $(usd "$PP") USDG (floor 5 bps × K = $(usd "$FLOOR"): $([ "$PP" == "$FLOOR" ] && echo 'floor menang' || echo 'mid > floor'))" "—"
  res=$(send "$A" "buy(uint256,uint256,uint256)" "$P_A" 1000000000000000000 "$MAX"); txa=${res%% *}; ga=${res##* }
  res=$(send "$B" "buy(uint256,uint256,uint256)" "$P_B" 1000000000000000000 "$MAX"); txb=${res%% *}; gb=${res##* }
  row "buy 1 P $KLO" "[$ga gas]($(arbiscan "$txa"))" "[$gb gas]($(arbiscan "$txb"))"
  res=$(send "$A" "close(uint256,uint256,uint256)" "$C_A" 5000000000000000000 0); txa=${res%% *}; ga=${res##* }
  res=$(send "$B" "close(uint256,uint256,uint256)" "$C_B" 5000000000000000000 0); txb=${res%% *}; gb=${res##* }
  row "close 5 C $KHI" "[$ga gas]($(arbiscan "$txa"))" "[$gb gas]($(arbiscan "$txb"))  rasio $(python3 -c "print(f'{$ga/$gb:.2f}')")×"
else
  for P in "$A" "$B"; do
    if [ "$(cast call --rpc-url "$RPC" "$P" "board(uint256)(uint64,bool,uint256,uint256[])" "$BID" | sed -n 2p)" == "false" ]; then
      res=$(send "$P" "settle(uint256)" "$BID"); tx=${res%% *}; g=${res##* }; row "settle board $BID ($P)" "[$g gas]($(arbiscan "$tx"))" "—"; fi
  done
  SP=$(cast call --rpc-url "$RPC" "$A" "board(uint256)(uint64,bool,uint256,uint256[])" "$BID" | sed -n 3p | awk '{print $1}'); printf 'Harga settlement: **%s USD** (round Chainlink pertama yang segar dengan `updatedAt ≥ expiry`).\n\n' "$(wad "$SP")" >> "$LOG"
  for pair in "C_$KHI:$C_A:$C_B" "P_$KLO:$P_A:$P_B"; do
    NAME=${pair%%:*}; r=${pair#*:}; SA_ID=${r%%:*}; SB_ID=${r#*:}
    BALA=$(num "$TOK_A" "balanceOf(address,uint256)(uint256)" "$ME" "$SA_ID"); BALB=$(num "$TOK_B" "balanceOf(address,uint256)(uint256)" "$ME" "$SB_ID")
    [ "$BALA" != "0" ] || { row "claim $NAME" "tidak ada posisi" "tidak ada posisi"; continue; }
    res=$(send "$A" "claim(uint256,uint256)" "$SA_ID" "$BALA"); txa=${res%% *}; ga=${res##* }
    res=$(send "$B" "claim(uint256,uint256)" "$SB_ID" "$BALB"); txb=${res%% *}; gb=${res##* }
    PAY=$(cast call --rpc-url "$RPC" "$A" "series(uint256)(uint32,uint64,uint128,bool,bool,uint256,uint256,uint256)" "$SA_ID" | sed -n 8p | awk '{print $1}')
    row "claim $NAME ($(wad "$BALA") unit × payout $(wad "$PAY") USDG)" "[$ga gas]($(arbiscan "$txa"))" "[$gb gas]($(arbiscan "$txb"))"
  done
fi
# --- keadaan akhir (blok yang sama untuk A dan B) ---
BLK2=$(cast block-number --rpc-url "$RPC")
for m in totalAssets reserved netVega escrowedPayouts freeLiquidity; do
  va=$(cast call --rpc-url "$RPC" --block "$BLK2" "$A" "$m()(uint256)" | awk '{print $1}'); vb=$(cast call --rpc-url "$RPC" --block "$BLK2" "$B" "$m()(uint256)" | awk '{print $1}')
  row "$m @ blok $BLK2" "$va" "$vb $([ "$va" == "$vb" ] && echo '✓' || echo '(≠ — timestamp tx A/B berbeda, lihat BENCHMARK)')"
done
row "sigmaMarkNow @ blok $BLK2" "$(cast call --rpc-url "$RPC" --block "$BLK2" "$A" "sigmaMarkNow()(uint256)" | awk '{print $1}')" "$(cast call --rpc-url "$RPC" --block "$BLK2" "$B" "sigmaMarkNow()(uint256)" | awk '{print $1}')"
echo "log ditulis ke $LOG"; tail -n 20 "$LOG"
```
Catatan: parsing tuple `cast call` untuk `QuoteOut` — keluaran berbentuk `(1227449820 [1.2e9], 36823495 [3.6e7], …)`; `tr -d '()'` lalu split `, ` lalu `awk '{print $1}'` membuang anotasi.

- [ ] **Step 2: Jalankan `--trade` (transaksi nyata: 2 approve, 6 tx trade)**

Run: `cd /home/mdlog/Project-MDlabs/Hackquest/arbitrum-sg/Equinox && chmod +x tools/demo/sepolia-demo.sh && tools/demo/sepolia-demo.sh --trade`
Expected: tidak ada `BEDA` (kuotasi identik pada blok yang sama); baris `buy 10 C 2800` dengan gas A ≈ 380–390k dan B ≈ 365–375k (program cached; rasio ≈ 1,0x karena engine σ bersama → sqrt sama-sama Stylus; selisih hanya 2 × `cappedCall`); `P 2400`: dengan S ≈ 2.627, t ≈ 5 hari, σ ≈ 0,63 put ini hanya ≈ 9 % OTM → mid ≈ 11 USDG/unit **> floor 1,2** — baris mencetak `mid > floor` (floor yang menang untuk deep-OTM diperagakan `Narrative.t.sol`, P 2600 pada S 4000: mid 0,00002 < floor 1,3); `close 5`; keadaan akhir A vs B (NAV/reserved/netVega identik bila tx A dan B mendarat di detik yang sama; bila tidak, ditandai — bukan kegagalan).

- [ ] **Step 3: Commit**

```bash
git add tools/demo/sepolia-demo.sh docs/DEMO_LOG.md
git commit -m "demo(sepolia): live narrative on both pools with Arbiscan tx log; --claim mode for post-settlement"
```
(`--claim` dijalankan setelah 25 Sep 08:00 UTC oleh operator; hasilnya di-commit terpisah: `docs: demo log — first real settlement (25 Sep) and claims`.)

---

### Task 7: `contracts/test/Narrative.t.sol` — tabel §13 deterministik untuk video

**Files:**
- Create: `contracts/test/Narrative.t.sol`

**Interfaces:**
- Consumes: `PoolFixture` (`lpDeposit`, `sid`, `tick`, `traderBuy`, `T0`, `WEEK`, `mathSol`, `vol`, `pool`, `usdg`, `token`).
- Produces: output `console2.log` yang dibaca di video; assert angka §6.7 / skenario 1.

- [ ] **Step 1: Test**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { console2 } from "forge-std/console2.sol";
import { PoolFixture } from "./PoolFixture.sol";
import { EquinoxPool } from "../src/pool/EquinoxPool.sol";

/// @notice Narasi §13 (deterministik, Pool kontrol): LP deposit → beli 10 C 4.200 → beli P 2.600 (floor) → warp 7 hari →
///         feed 4.500 → settle → claim → NAV LP. Dicetak sebagai tabel untuk video; angka harus cocok dengan §6.7 & skenario 1.
///         Jalankan: forge test --match-contract NarrativeTest -vv
contract NarrativeTest is PoolFixture {
    function _usd(uint256 assets6) internal pure returns (string memory) {
        uint256 w = assets6 / 1e6; uint256 f = assets6 % 1e6;
        bytes memory fs = bytes(vm.toString(f + 1e6)); // padding 6 digit
        bytes memory out = new bytes(6);
        for (uint256 i = 0; i < 6; i++) out[i] = fs[i + 1];
        return string(abi.encodePacked(vm.toString(w), ".", out));
    }

    function test_narrative_scenario1_prints_table() public {
        console2.log("| Langkah | Nilai |");
        console2.log("|---|---|");
        uint256 shares = lpDeposit(1_000_000e6);
        console2.log("| LP deposit | 1,000,000.000000 USDG -> %s share |", vm.toString(shares));
        uint64 expiry = uint64(T0 + WEEK);
        uint128[] memory ks = new uint128[](4);
        ks[0] = 2600e18; ks[1] = 3800e18; ks[2] = 4000e18; ks[3] = 4200e18;
        uint256 boardId = pool.createBoard(expiry, ks);
        uint256 idC = sid(expiry, 4200e18, true);
        uint256 idP = sid(expiry, 2600e18, false);
        // mid pada sigma_mark(0) = 0.55 x 1.15 = 0.6325 (§6.7: 64.87 USDG/unit)
        uint256 t = uint256(expiry - block.timestamp) * 1e18 / 31_536_000;
        (uint256 midWad, , ) = mathSol.cappedCall(4000e18, 4200e18, 8400e18, t, vol.sigmaMark(0), 0);
        uint256 mid6 = (midWad + 1e12 - 1) / 1e12;
        assertApproxEqAbs(mid6, 64_870_000, 20_000, "mid C4200 7d @ 63.25% = 64.87");
        EquinoxPool.QuoteOut memory q = pool.quoteBuy(idC, 10e18);
        console2.log("| sigma_mark(0) | %s (0.55 x VRP 1.15) |", vm.toString(vol.sigmaMark(0)));
        console2.log("| mid C4200 7d per unit | %s USDG |", _usd(mid6));
        console2.log("| quoteBuy 10 C4200 | premi %s USDG @ sigma_buy %s, fee %s |", _usd(q.premiumAssets), vm.toString(q.sigma), _usd(q.feeAssets));
        assertGt(q.premiumAssets, mid6 * 10, "harga beli > mid (spread + dampak inventaris)");
        uint256 premC = traderBuy(idC, 10e18);
        EquinoxPool.QuoteOut memory qp = pool.quoteBuy(idP, 1e18);
        uint256 floor6 = uint256(2600e18) * 5 / 10_000 / 1e12;
        assertEq(qp.premiumAssets, floor6, "P2600 deep-OTM: floor 5 bps x K menang");
        console2.log("| quoteBuy 1 P2600 | premi %s USDG = floor 5 bps x K (mid < floor) |", _usd(qp.premiumAssets));
        uint256 premP = traderBuy(idP, 1e18);
        console2.log("| reserved setelah beli | %s USDG (10 x 4200 + 1 x 2600) |", _usd(pool.reserved() / 1e12));
        console2.log("| NAV setelah beli | %s USDG |", _usd(pool.totalAssets()));
        vm.warp(expiry);
        tick(4500e8);
        address keeper = makeAddr("keeper");
        vm.prank(keeper);
        pool.settle(boardId);
        console2.log("| settle @ S_T = 4500 | payout C4200 = 300/unit, P2600 = 0; bounty 2 USDG ke keeper |");
        vm.prank(trader);
        uint256 got = pool.claim(idC, 10e18);
        assertEq(got, 3000e6);
        console2.log("| claim 10 C4200 | %s USDG |", _usd(got));
        uint256 nav = pool.totalAssets();
        assertEq(nav, 1_000_000e6 + premC + premP - 3000e6 - 2e6, "NAV LP = 1,000,000 + premi - 3,000 - bounty");
        console2.log("| NAV LP akhir | %s USDG (= 1,000,000 + premi %s + %s - 3,000 - 2) |", _usd(nav), _usd(premC), _usd(premP));
        console2.log("| fee ke treasury (tidak masuk NAV) | %s USDG |", _usd(usdg.balanceOf(treasury)));
    }
}
```

- [ ] **Step 2: Jalankan**

Run: `cd contracts && forge test --match-contract NarrativeTest -vv 2>&1 | grep -E "^\s*\||\[PASS\]|\[FAIL\]"`
Expected: `[PASS] test_narrative_scenario1_prints_table`, tabel 12 baris: mid `64.87xxxx`, premi 10 C4200 > 648,70, P2600 = `1.300000` (floor), settle 4500, claim `3000.000000`, NAV akhir konsisten. (Bila `assertApproxEqAbs` mid gagal lebih dari 0,02 USDG, laporkan — jangan longgarkan; angka §6.7 adalah kontrak dokumen.)

- [ ] **Step 3: Commit**

```bash
git add contracts/test/Narrative.t.sol
git commit -m "test: deterministic §13 narrative table for the demo video"
```

---

### Task 8: Dokumen Plan 3a — BENCHMARK (baris Sepolia), README (live), PRD catatan kecil

**Files:**
- Modify: `docs/BENCHMARK.md`, `README.md`, `prd-arsitektur.md` (satu kalimat), `deployments/arbitrum-sepolia.json` (sudah)

- [ ] **Step 1: `docs/BENCHMARK.md`** — di bawah seksi "Verifikasi di Arbitrum Sepolia (program cached)", tambahkan subseksi:

```markdown
### Transaksi pool di Sepolia (engine σ bersama, program cached)

Dua pool live (`deployments/arbitrum-sepolia.json` → `pools`): A = `BlackScholesSol`, B = Stylus; **satu `EquinoxVolEngine` bersama** (math Stylus; K4 spec Plan 3) sehingga σ identik by construction. Karena `sqrt` σ dijalankan engine yang sama, selisih gas `buy`/`close` di sini hanya 2 panggilan `cappedCall` — bukan apples-to-apples seperti tabel devnode di atas. Angka dari `docs/DEMO_LOG.md` (run <tanggal>):

| Operasi (Sepolia, cached) | Gas A (kontrol) | Gas B (Stylus) | Rasio |
|---|---|---|---|
| `buy` 10 C 2.800 (board 25 Sep) | <angka> | <angka> | <rasio>× |
| `close` 5 C 2.800 | <angka> | <angka> | <rasio>× |

Kuotasi identik byte-per-byte pada blok yang sama (`sepolia-demo.sh` gagal keras bila tidak). NAV/reserved A vs B dapat berbeda beberapa ratus unit bila tx A dan B mendarat pada detik yang berbeda (waktu-ke-expiry berbeda 1 s) — artefak harness sekuensial, bukan model.
```
Isi `<angka>` dari `docs/DEMO_LOG.md` (Task 6).

- [ ] **Step 2: `README.md`** — tambahkan seksi `## Live on Arbitrum Sepolia` setelah "Status" (bahasa Inggris):

```markdown
## Live on Arbitrum Sepolia

Two identical pools are live, priced by two different implementations of the same math and fed by the **real Chainlink ETH/USD feed** (`0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165`, 8 dp, 120 s heartbeat). All addresses are in `deployments/arbitrum-sepolia.json` (`pools`):

| | Pool A — control | Pool B — Equinox |
|---|---|---|
| Pool (ERC-4626, USDG) | `<A>` | `<B>` |
| Pricing math | `BlackScholesSol` `0x5B23…` | Stylus program `0xb3b3…` (cached) |
| Option token (ERC-1155) | `<tokA>` | `<tokB>` |
| Vol engine (shared, EWMA from Chainlink prints) | `<vol>` | same |
| Boards | Fri 25 Sep 2026 08:00 UTC (2400/2600/2800), Fri 2 Oct 2026 (2200/2600/3000) | same |

Mocked on purpose (no testnet equivalents): `MockUSDG` (6 dp, open `mint` = faucet) and `MockSequencerFeed`. A GitHub Actions keeper (`.github/workflows/keeper.yml`, every 15 min) pokes the vol engine and settles expired boards; settlement is permissionless, so the keeper only speeds things up. `docs/DEMO_LOG.md` records every demo transaction with Arbiscan links. Try it from a shell: `tools/demo/sepolia-demo.sh --trade` (needs `.env`), or read-only: `cast call <A> "quoteBuy(uint256,uint256)(...)" <seriesId> 1000000000000000000 --rpc-url https://sepolia-rollup.arbitrum.io/rpc`. Dashboard + wallet trading: Plan 3b.
```
Isi `<…>` dari JSON. Perbarui juga baris status "Demo, UI, pool deployment on Sepolia | ⏳ Plan 3" → "Pools live on Sepolia (real Chainlink feed, shared vol engine, keeper, demo log) | ✅ 2x Sep 2026 |" dan baris baru "Dashboard + wallet trading, submission package | ⏳ Plan 3b |".

- [ ] **Step 3: `prd-arsitektur.md`** — di §13 setelah paragraf "Baris pool (…) sudah diukur di devnode …", tambahkan satu paragraf: `Sejak <tanggal> dua pool hidup di Arbitrum Sepolia dengan feed Chainlink ETH/USD asli dan engine σ bersama (K4, spec Plan 3): alamat di deployments/arbitrum-sepolia.json, transaksi demo di docs/DEMO_LOG.md, gas buy/close Sepolia di docs/BENCHMARK.md. PRD v1.4 (Plan 3b) akan merapikan §10.4 dan §13 setelah dashboard dan settlement nyata 25 Sep.`

- [ ] **Step 4: Verifikasi & commit**

Run: `cd contracts && forge test 2>&1 | tail -1 && forge build --sizes >/dev/null && cd .. && jq -e '.pools.boards | length == 2' deployments/arbitrum-sepolia.json && grep -c "sepolia.arbiscan.io/tx" docs/DEMO_LOG.md`
Expected: `87 tests passed` (80 + 3 factory + 3 deployer + 1 narrative), `true`, ≥ 6 tautan tx.

```bash
git add docs/BENCHMARK.md README.md prd-arsitektur.md
git commit -m "docs: Sepolia pools live — addresses, keeper, demo log, Sepolia gas rows"
```

---

## Self-review (penulis rencana)

**Spec coverage (Plan 3a, spec §3):** §3.0 factory → Task 1; §3.1 deployer → Task 2; §3.2 deploy → Task 3; §3.3 board & seed → Task 4; §3.4 keeper → Task 5; §3.5 demo live (+ `--claim`) → Task 6; §3.6 narasi → Task 7; §3.7 kriteria terima → Task 8 verifikasi (test hijau, JSON pools/boards, demo exit 0 dengan kuotasi identik, keeper hijau — cron aktif setelah merge, BENCHMARK baris Sepolia). Keeper "job gagal bila σ beda" dari spec §3.4 diganti: dengan engine bersama σ identik trivial, jadi keeper hanya melaporkan (perbedaan `sigmaMarkNow` A/B sah bila util berbeda).

**Placeholder scan:** `<angka>`/`<A>` di Task 8 diisi dari keluaran Task 3–6 (ditandai eksplisit); tidak ada TBD/TODO.

**Type consistency:** `PoolE2EDeployer(owner, mathA, mathB, feed_, sharedVol_)` dipakai identik di Task 2 test, `pool-e2e.sh` (`0x0…0 false`), `deploy-pools.sh` (`$FEED true`); `createPoolWithVol(Deploy calldata, address)` di Task 1 & 2; JSON `pools.{deployer,usdg,feed,sequencerFeed,vol,A.{pool,token,math},B.{…},boards[].{id,expiry,strikes,seriesIds.{A,B}}}` dibaca konsisten oleh Task 4–6 dan keeper; `QuoteOut` 6 field sesuai `QSIG`; `board(id)` 4 nilai (baris 2 = settled, baris 3 = settlementPrice); `series(id)` 8 nilai (baris 2 = expiry, baris 8 = payoutPerUnit).

**Dependensi:** 1 → 2 → 3 → 4 → 5 → 6 → 8; 7 independen (boleh setelah 2). Transaksi nyata terjadi di Task 3, 4, 5 (dana keeper, satu poke), 6.
