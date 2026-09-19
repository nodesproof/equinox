# Equinox Pool (Plan 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun venue-nya: `EquinoxPool` (vault ERC-4626 atas USDG yang menjual opsi ETH Eropa cash-settled dengan harga sepenuhnya on-chain), `EquinoxVolEngine` (σ dari EWMA realized vol + dampak inventaris), `EquinoxOptionToken` (ERC-1155 per seri), factory dua-level, mock, test skenario §12 + invariant, dan E2E dua pool identik (kontrol Solidity vs Stylus) di devnode — yaitu PRD §5.2–§5.6, §6.4, §8.3–§8.6, §8.8, §11–§13 (baris pool), FR-11..FR-37, INV-1/2/4/9/10/11/14.

**Architecture:** Pool = EVM (OpenZeppelin ERC4626 + Ownable2Step + ReentrancyGuard) yang memanggil `IBlackScholes` (Stylus atau kontrol Solidity — pool tidak tahu bedanya) hanya lewat `STATICCALL`. Akuntansi internal WAD, konversi ke 6 desimal hanya di boundary transfer (premi ↑, proceeds/payout ↓). Solvabilitas keras: `reserved = Σ OI×K ≤ cash − escrow`, call dibayar `min(S_T−K, K)`. NAV = cash − escrow − MtM (satu panggilan `markPortfolio`); saat oracle stale/`math` gagal → NAV konservatif dan hanya `claim`/`withdraw` yang jalan. Deployment dua-level (`EquinoxFactory` → `PoolDeployer`) karena batas kode 24 KB. L3 = Foundry dengan `BlackScholesSol`; L4 = skrip `cast` (Foundry tidak bisa mengeksekusi WASM).

**Tech Stack:** Foundry ≥ 1.5 (`solc` 0.8.28 via-IR), OpenZeppelin Contracts **v5.4.0** (vendored `--no-git`), PRBMath v4.1.0 (sudah ada), `cast`/`jq`/`bc`, Python 3.12 (generator vektor), Docker + `tools/devnode/up.sh` (Plan 1), program Stylus `bs-stylus` (Plan 1).

**Spec:** `prd-arsitektur.md` v1.2. Plan 1 (`docs/superpowers/plans/2026-09-19-equinox-quant-core.md`) sudah selesai dan di-merge (`main` = 4a04c1a saat rencana ini ditulis).

**Catatan penting untuk eksekutor:** seluruh kode di rencana ini **sudah dijalankan dan lolos** (19 Sep 2026) dalam spike di luar repo: 46 test Foundry (4 oracle + 3 token + 6 vol engine + 16 pool + 5 invariant + 12 kontrol Plan 1), coverage Pool 93,8 % / VolEngine 98,6 % / Token & OracleLib 100 %, semua kontrak < 24.576 byte, dan E2E dua pool di devnode dengan program Stylus (kuotasi/NAV/σ/cash identik). Tugas Anda memindahkannya ke repo dengan disiplin TDD; jika sebuah langkah "expected" tidak terjadi, berhenti dan laporkan — jangan mengubah algoritma atau parameter.

## Global Constraints

- Root repo `/home/mdlog/Project-MDlabs/Hackquest/arbitrum-sg/Equinox`; kerjakan di branch `feat/pool` dari `main`. Path relatif terhadap root.
- Unit: semua akuntansi internal WAD (1e18); `size` opsi dalam WAD unit (1e18 = 1 ETH); strike/harga WAD; aset USDG 6 desimal (`assetScale = 1e12`); premi & fee dibulatkan **ke atas** ke 6 dp, proceeds/payout **ke bawah** (FR-35). `r` = 0 (immutable `rWad`).
- Solvabilitas (FR-21..FR-29, INV-1..3): `reserved += K×size/1e18` saat buy, dilepas saat close/settle; call dihargai `C(K) − C(2K)` (`CAP_MULT = 2e18`) dan dibayar `min(max(S_T−K,0), K)`; put `max(K−S_T,0)`.
- σ (FR-11..FR-15): `σ_base = clamp(√var)`, `var` hanya berubah lewat `poke()` dari round Chainlink baru dengan Δt ≥ 60 s; `σ_mark = σ_base × VRP × (1 + α·util)`, `util = clamp(netVega/vegaCap, 0, 1)`, `vegaCap = (cash − escrow) × vegaCapBps/1e4`; beli pada `σ_mark(util setelah trade) × (1+s)`, tutup pada `σ_mark(util setelah tutup) × (1−s)`; premi ≥ `minPremiumBps × K × size`. Tidak ada `setSigma`. `setParams`: batas keras (λ ∈ [0,80; 0,99], VRP ∈ [1; 2], α ≤ 1, s ∈ [0,5 %; 20 %], σ_min ≥ 5 %, σ_max ≤ 500 %), rate limit 6 jam, |Δ| ≤ 20 % relatif (α: ≤ 0,2 absolut).
- Oracle (FR-26, FR-27, FR-36): spot segar ⇔ sequencer up + grace lewat, `answer > 0`, umur ≤ `heartbeat × staleMult`; kuotasi/`buy`/`close`/`deposit`/`createBoard` revert `OracleStale()` bila tidak segar; `withdraw` memakai NAV konservatif `cash − escrow − reserved`; `settle` memakai round dengan `updatedAt ≥ expiry` yang segar. Feed yang revert = tidak segar (try/catch), bukan revert pool.
- Listing (FR-19): expiry di grid Jumat 08:00 UTC (`(expiry − 115200) % 604800 == 0`), tenor ≤ `tenorMax`, strike naik & unik dalam `[S/2, 2S]`, ≤ `maxOpenSeries` (32) seri terbuka, hanya owner, tidak saat pause.
- Pause (FR-33, INV-14): hanya `buy` dan `createBoard`; `close`, `claim`, `withdraw`, `settle` tidak pernah dijeda.
- Parameter awal §6.8: feeBps 300, maxUtilBps 8000, vegaCapBps 500, minPremiumBps 5, heartbeat 3600, staleMult 3, sequencerGrace 3600, maxOpenSeries 32, tenorMax 30 hari, minSize 1e16, settleBounty 2e6; vol: λ 0,94, VRP 1,15, α 0,30, s 0,05, σ_min 0,20, σ_max 3,0; sigmaSeed 0,55.
- **Batas kode 24.576 byte per kontrak** (Arbitrum One = EIP-170; test Foundry TIDAK menegakkannya, chain sungguhan iya): `forge build --sizes` wajib hijau. Karena itu pool tidak men-deploy anaknya; `EquinoxFactory` men-deploy vol + token dan mendelegasikan `new EquinoxPool` ke `PoolDeployer`; token diikat sekali via `bindPool`.
- **Foundry tidak bisa mengeksekusi program Stylus** (`OpcodeNotFound`): E2E L4 memakai `forge create` (deployer tanpa panggilan math) + `cast send`/`cast call`, bukan `forge script`.
- Vektor uji: `tools/reference/gen_vectors.py` adalah satu-satunya sumber; berkas generated di-commit dan dicek CI. Seed EWMA harus `W("0.55")² / 1e18` (eksak, sama seperti kontrak), bukan float.
- Commit: pesan polos, TANPA trailer/atribusi AI. Satu commit per task (Task 5 boleh dua). Identitas repo-lokal `nodesproof <mdnodes88@gmail.com>` (sudah diset).
- Bahasa komentar/dokumen: Indonesia; identifier Inggris. String literal Solidity harus ASCII (`unicode"…"` bila perlu).

---

### Task 1: Dependensi (OpenZeppelin v5.4.0), konfigurasi Foundry, interface Chainlink, mock

**Files:**
- Modify: `contracts/foundry.toml`
- Create: `contracts/src/interfaces/IAggregatorV3.sol`, `contracts/src/mocks/MockUSDG.sol`, `contracts/src/mocks/MockFeed.sol`, `contracts/src/mocks/MockSequencerFeed.sol`
- Vendor: `contracts/lib/openzeppelin-contracts/` (v5.4.0, salinan biasa seperti forge-std/prb-math)

**Interfaces:**
- Produces: `IAggregatorV3 { decimals(); latestRoundData() → (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80) }`; `MockUSDG` (ERC-20 6 dp, `mint(address,uint256)`); `MockFeed(uint8 decimals)` dengan `set(int256 answer, uint256 updatedAt)` yang menaikkan `roundId`; `MockSequencerFeed` dengan `set(int256 answer, uint256 startedAt)` (0 = up). Remapping `@openzeppelin/contracts/`; seksi `[invariant]` (runs 32, depth 64, `fail_on_revert = false`) dan `[fuzz]` (runs 256).

- [ ] **Step 1: Branch, vendor OZ, konfigurasi**

```bash
cd /home/mdlog/Project-MDlabs/Hackquest/arbitrum-sg/Equinox
git switch -c feat/pool main
cd contracts
forge install OpenZeppelin/openzeppelin-contracts@v5.4.0 --no-git
grep -m1 '"version"' lib/openzeppelin-contracts/package.json        # expected: "version": "5.4.0"
cat > foundry.toml <<'EOF'
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.28"
optimizer = true
optimizer_runs = 200
via_ir = true
remappings = [
    "@prb/math/=lib/prb-math/",
    "forge-std/=lib/forge-std/src/",
    "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/",
]

[invariant]
runs = 32
depth = 64
fail_on_revert = false

[fuzz]
runs = 256
EOF
```

- [ ] **Step 2: Tulis interface dan mock**

`contracts/src/interfaces/IAggregatorV3.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Subset Chainlink AggregatorV3Interface yang dipakai Equinox (harga spot & sequencer uptime).
interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
```

`contracts/src/mocks/MockUSDG.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Stablecoin 6 desimal untuk testnet/devnode (sesuaikan bila V9 menunjukkan desimal USDG berbeda).
contract MockUSDG is ERC20 {
    constructor() ERC20("Mock Global Dollar", "USDG") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

`contracts/src/mocks/MockFeed.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IAggregatorV3 } from "../interfaces/IAggregatorV3.sol";

/// @notice AggregatorV3 yang bisa di-set: harga (8 desimal), updatedAt, dan roundId naik setiap `set`.
contract MockFeed is IAggregatorV3 {
    uint8 public immutable dec;
    uint80 public roundId;
    int256 public answer;
    uint256 public updatedAt;
    uint256 public startedAt;

    constructor(uint8 decimals_) {
        dec = decimals_;
    }

    function decimals() external view returns (uint8) {
        return dec;
    }

    /// @notice Round baru dengan harga & waktu tertentu.
    function set(int256 answer_, uint256 updatedAt_) external {
        roundId += 1;
        answer = answer_;
        updatedAt = updatedAt_;
        startedAt = updatedAt_;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, startedAt, updatedAt, roundId);
    }
}
```

`contracts/src/mocks/MockSequencerFeed.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IAggregatorV3 } from "../interfaces/IAggregatorV3.sol";

/// @notice L2 Sequencer Uptime Feed tiruan: answer 0 = up, 1 = down; startedAt = saat status berubah.
contract MockSequencerFeed is IAggregatorV3 {
    int256 public answer;
    uint256 public startedAt;

    function decimals() external pure returns (uint8) {
        return 0;
    }

    function set(int256 answer_, uint256 startedAt_) external {
        answer = answer_;
        startedAt = startedAt_;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, startedAt, startedAt, 1);
    }
}
```

- [ ] **Step 3: Build & suite lama tetap hijau (test = tidak ada regresi)**

Run: `cd contracts && forge build 2>&1 | grep -E "^Error|Compiler run" && forge test 2>&1 | grep "Suite result"`
Expected: `Compiler run successful!` dan `Suite result: ok. 12 passed`.

- [ ] **Step 4: Commit**

```bash
cd ..
git add contracts/foundry.toml contracts/src/interfaces/IAggregatorV3.sol contracts/src/mocks contracts/lib/openzeppelin-contracts
git commit -m "chore(contracts): vendor OpenZeppelin 5.4.0, Chainlink interface, USDG/feed/sequencer mocks, invariant config"
```

### Task 2: `OracleLib` — kesegaran spot + sequencer uptime (FR-26)

**Files:**
- Create: `contracts/src/oracle/OracleLib.sol`
- Test: `contracts/test/OracleLib.t.sol`

**Interfaces:**
- Consumes: `IAggregatorV3`, `MockFeed`, `MockSequencerFeed` (Task 1).
- Produces: `library OracleLib { struct Spot { uint256 priceWad; uint256 updatedAt; uint80 roundId; bool fresh; } function read(IAggregatorV3 feed, IAggregatorV3 sequencerFeed, uint256 scale, uint256 heartbeat, uint256 staleMult, uint256 sequencerGrace) internal view returns (Spot memory); function sequencerUp(IAggregatorV3, uint256 grace) internal view returns (bool); }` — feed yang revert atau `answer ≤ 0` → `fresh = false` (tidak revert). CATATAN: alamat tanpa kode tetap revert (cek `extcodesize` Solidity terjadi sebelum `try`); feed adalah immutable yang diverifikasi saat deploy.

- [ ] **Step 1: Tulis test yang gagal — `contracts/test/OracleLib.t.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { OracleLib } from "../src/oracle/OracleLib.sol";
import { IAggregatorV3 } from "../src/interfaces/IAggregatorV3.sol";
import { MockFeed } from "../src/mocks/MockFeed.sol";
import { MockSequencerFeed } from "../src/mocks/MockSequencerFeed.sol";

contract RevertingFeed {
    function decimals() external pure returns (uint8) { return 8; }
    function latestRoundData() external pure returns (uint80, int256, uint256, uint256, uint80) { revert("feed down"); }
}

contract OracleHarness {
    function read(address feed, address seqf, uint256 scale, uint256 hb, uint256 mult, uint256 grace) external view returns (OracleLib.Spot memory) {
        return OracleLib.read(IAggregatorV3(feed), IAggregatorV3(seqf), scale, hb, mult, grace);
    }
}

/// @notice FR-15/FR-26: kesegaran spot, sequencer up + grace, feed revert → tidak segar (bukan revert).
contract OracleLibTest is Test {
    OracleHarness h;
    MockFeed feed;
    MockSequencerFeed seqf;
    uint256 constant T0 = 1_789_718_400;

    function setUp() public {
        vm.warp(T0);
        h = new OracleHarness();
        feed = new MockFeed(8);
        seqf = new MockSequencerFeed();
        feed.set(4000e8, T0);
        seqf.set(0, T0 - 2 hours);
    }

    function test_fresh_and_scaled() public view {
        OracleLib.Spot memory s = h.read(address(feed), address(seqf), 1e10, 3600, 3, 3600);
        assertTrue(s.fresh);
        assertEq(s.priceWad, 4000e18);
        assertEq(s.roundId, 1);
    }

    function test_stale_after_heartbeat_times_mult() public {
        vm.warp(T0 + 3 hours);
        assertTrue(h.read(address(feed), address(seqf), 1e10, 3600, 3, 3600).fresh);
        vm.warp(T0 + 3 hours + 1);
        assertFalse(h.read(address(feed), address(seqf), 1e10, 3600, 3, 3600).fresh);
    }

    function test_sequencer_rules() public {
        seqf.set(1, T0);
        assertFalse(h.read(address(feed), address(seqf), 1e10, 3600, 3, 3600).fresh);
        seqf.set(0, T0);                                   // baru naik: dalam grace
        assertFalse(h.read(address(feed), address(seqf), 1e10, 3600, 3, 3600).fresh);
        vm.warp(T0 + 3600);
        assertTrue(h.read(address(feed), address(seqf), 1e10, 3600, 3, 3600).fresh);
        assertTrue(h.read(address(feed), address(0), 1e10, 3600, 3, 3600).fresh); // tanpa sequencer feed
    }

    function test_bad_or_reverting_feed_is_not_fresh() public {
        feed.set(0, T0);
        assertFalse(h.read(address(feed), address(seqf), 1e10, 3600, 3, 3600).fresh);
        RevertingFeed bad = new RevertingFeed();
        OracleLib.Spot memory s = h.read(address(bad), address(seqf), 1e10, 3600, 3, 3600); // feed revert → tidak segar, bukan revert
        assertFalse(s.fresh);
        assertEq(s.priceWad, 0);
        assertFalse(h.read(address(feed), address(bad), 1e10, 3600, 3, 3600).fresh); // sequencer feed revert → tidak segar
    }
}
```

- [ ] **Step 2: Jalankan — harus gagal kompilasi**

Run: `cd contracts && forge test --match-contract OracleLibTest 2>&1 | grep -E "Error|not found" | head -2`
Expected: `Source "../src/oracle/OracleLib.sol" not found`.

- [ ] **Step 3: Tulis `contracts/src/oracle/OracleLib.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IAggregatorV3 } from "../interfaces/IAggregatorV3.sol";

/// @title OracleLib — pembacaan spot Chainlink + L2 sequencer uptime dengan aturan kesegaran (FR-26).
/// @dev Semua pembacaan dibungkus try/catch: feed yang revert diperlakukan sebagai tidak segar, bukan sebagai bug.
library OracleLib {
    struct Spot {
        uint256 priceWad;   // harga dalam WAD (1e18)
        uint256 updatedAt;  // detik
        uint80 roundId;
        bool fresh;         // segar: sequencer naik (+grace), answer > 0, umur ≤ heartbeat × staleMult
    }

    /// @param scale 10^(18 − decimals feed), dihitung sekali saat deploy.
    function read(
        IAggregatorV3 feed,
        IAggregatorV3 sequencerFeed,
        uint256 scale,
        uint256 heartbeat,
        uint256 staleMult,
        uint256 sequencerGrace
    ) internal view returns (Spot memory s) {
        if (!sequencerUp(sequencerFeed, sequencerGrace)) return s; // fresh = false, price 0
        try feed.latestRoundData() returns (uint80 roundId, int256 answer, uint256, uint256 updatedAt, uint80) {
            if (answer <= 0 || updatedAt == 0 || updatedAt > block.timestamp) return s;
            s.priceWad = uint256(answer) * scale;
            s.updatedAt = updatedAt;
            s.roundId = roundId;
            s.fresh = block.timestamp - updatedAt <= heartbeat * staleMult;
        } catch {
            return s;
        }
    }

    /// @notice true bila tidak ada sequencer feed (address(0)), atau feed melaporkan naik dan grace period sudah lewat.
    function sequencerUp(IAggregatorV3 sequencerFeed, uint256 grace) internal view returns (bool) {
        if (address(sequencerFeed) == address(0)) return true;
        try sequencerFeed.latestRoundData() returns (uint80, int256 answer, uint256 startedAt, uint256, uint80) {
            // Konvensi Chainlink: answer 0 = up, 1 = down; startedAt = saat status terakhir berubah.
            if (answer != 0) return false;
            return block.timestamp - startedAt >= grace;
        } catch {
            return false;
        }
    }
}
```

- [ ] **Step 4: Jalankan — 4 lolos**

Run: `cd contracts && forge test --match-contract OracleLibTest 2>&1 | grep -E "^\[|Suite result"`
Expected: `[PASS] test_fresh_and_scaled`, `test_stale_after_heartbeat_times_mult`, `test_sequencer_rules`, `test_bad_or_reverting_feed_is_not_fresh`; `Suite result: ok. 4 passed`.

- [ ] **Step 5: Commit**

```bash
cd ..
git add contracts/src/oracle/OracleLib.sol contracts/test/OracleLib.t.sol
git commit -m "feat(contracts): OracleLib with heartbeat/sequencer freshness rules and try/catch feed reads"
```

### Task 3: `EquinoxOptionToken` — ERC-1155 per seri, diikat sekali ke pool (FR-18, INV-4)

**Files:**
- Create: `contracts/src/pool/EquinoxOptionToken.sol`
- Test: `contracts/test/EquinoxOptionToken.t.sol`

**Interfaces:**
- Produces: `contract EquinoxOptionToken is ERC1155Supply { address pool; address immutable deployer; bindPool(address) /* sekali, hanya deployer */; seriesId(address pool, uint64 expiry, uint128 strike, bool isCall) pure → uint256 = keccak256(abi.encode(...)); mint/burn onlyPool; totalSupply(id) }`; error `OnlyPool`, `OnlyDeployer`, `AlreadyBound`.

- [ ] **Step 1: Tulis test yang gagal — `contracts/test/EquinoxOptionToken.t.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { EquinoxOptionToken } from "../src/pool/EquinoxOptionToken.sol";

/// @notice FR-18: mint/burn hanya oleh pool yang diikat sekali; seriesId deterministik; totalSupply == OI.
contract EquinoxOptionTokenTest is Test {
    EquinoxOptionToken token;
    address pool = makeAddr("pool");
    address other = makeAddr("other");

    function setUp() public {
        token = new EquinoxOptionToken();
    }

    function test_bind_once_by_deployer() public {
        assertEq(token.deployer(), address(this));
        vm.prank(other);
        vm.expectRevert(EquinoxOptionToken.OnlyDeployer.selector);
        token.bindPool(pool);
        token.bindPool(pool);
        assertEq(token.pool(), pool);
        vm.expectRevert(EquinoxOptionToken.AlreadyBound.selector);
        token.bindPool(other);
    }

    function test_mint_burn_only_pool_and_supply() public {
        uint256 id = token.seriesId(pool, 1_790_928_000, 4200e18, true);
        vm.expectRevert(EquinoxOptionToken.OnlyPool.selector); // belum diikat
        token.mint(other, id, 1e18);
        token.bindPool(pool);
        vm.prank(other);
        vm.expectRevert(EquinoxOptionToken.OnlyPool.selector);
        token.mint(other, id, 1e18);
        vm.prank(pool);
        token.mint(other, id, 5e18);
        assertEq(token.totalSupply(id), 5e18);
        assertEq(token.balanceOf(other, id), 5e18);
        vm.prank(pool);
        token.burn(other, id, 2e18);
        assertEq(token.totalSupply(id), 3e18);
    }

    function test_seriesId_is_deterministic_and_distinct() public view {
        uint256 c = token.seriesId(pool, 1_790_928_000, 4200e18, true);
        uint256 p = token.seriesId(pool, 1_790_928_000, 4200e18, false);
        assertTrue(c != p);
        assertEq(c, uint256(keccak256(abi.encode(pool, uint64(1_790_928_000), uint128(4200e18), true))));
    }
}
```

- [ ] **Step 2: Jalankan — harus gagal kompilasi**

Run: `cd contracts && forge test --match-contract EquinoxOptionTokenTest 2>&1 | grep -E "Error|not found" | head -2`
Expected: `Source "../src/pool/EquinoxOptionToken.sol" not found`.

- [ ] **Step 3: Tulis `contracts/src/pool/EquinoxOptionToken.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC1155 } from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import { ERC1155Supply } from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";

/// @title EquinoxOptionToken — satu id ERC-1155 per seri (expiry, strike, call/put) (§8.3, FR-18).
/// @notice Hanya pool yang boleh mint/burn; `totalSupply(id)` == open interest seri (INV-4).
contract EquinoxOptionToken is ERC1155Supply {
    address public pool;                 // diikat sekali oleh deployer (factory) setelah pool ada
    address public immutable deployer;

    error OnlyPool();
    error OnlyDeployer();
    error AlreadyBound();

    constructor() ERC1155("") {
        deployer = msg.sender;
    }

    /// @notice Mengikat pool sekali; dipanggil factory tepat setelah pool di-deploy (chicken-egg alamat).
    function bindPool(address pool_) external {
        if (msg.sender != deployer) revert OnlyDeployer();
        if (pool != address(0)) revert AlreadyBound();
        pool = pool_;
    }

    modifier onlyPool() {
        if (msg.sender != pool || pool == address(0)) revert OnlyPool();
        _;
    }

    function seriesId(address pool_, uint64 expiry, uint128 strike, bool isCall) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(pool_, expiry, strike, isCall)));
    }

    function mint(address to, uint256 id, uint256 amount) external onlyPool {
        _mint(to, id, amount, "");
    }

    function burn(address from, uint256 id, uint256 amount) external onlyPool {
        _burn(from, id, amount);
    }
}
```

- [ ] **Step 4: Jalankan — 3 lolos**

Run: `cd contracts && forge test --match-contract EquinoxOptionTokenTest 2>&1 | grep -E "^\[|Suite result"`
Expected: 3 × `[PASS]`, `Suite result: ok. 3 passed`.

- [ ] **Step 5: Commit**

```bash
cd ..
git add contracts/src/pool/EquinoxOptionToken.sol contracts/test/EquinoxOptionToken.t.sol
git commit -m "feat(contracts): EquinoxOptionToken ERC-1155 series token bound once to its pool"
```

### Task 4: `EquinoxVolEngine` — σ_base EWMA on-chain, σ_mark, parameter terbatas (FR-11..FR-15) + seed vektor EWMA eksak

**Files:**
- Modify: `tools/reference/gen_vectors.py` (satu baris: seed EWMA)
- Regenerate: `stylus/bs-math/tests/common/vectors_gen.rs`, `contracts/test/VectorsGen.sol` (hanya 5 baris `EWMA`/`ewmaV` berubah)
- Create: `contracts/src/pool/EquinoxVolEngine.sol`
- Test: `contracts/test/EquinoxVolEngine.t.sol`

**Interfaces:**
- Consumes: `IBlackScholes.ewmaUpdate/sqrt` (Plan 1), `IAggregatorV3`, `MockFeed`, `BlackScholesSol`.
- Produces: `contract EquinoxVolEngine is Ownable2Step { struct Params { uint64 lambdaPerDay; uint64 vrp; uint64 alpha; uint64 spread; uint64 sigmaMin; uint64 sigmaMax; }; constructor(address owner, address feed, address math, Params p, uint256 sigmaSeed); poke() → uint256 sigmaBase; sigmaBase() view; sigmaMark(uint256 utilWad) view; spread() view; setParams(Params) onlyOwner; varWad/lastPrice/lastRoundId/lastTs/params/lastParamsUpdate getters; MIN_OBS_INTERVAL = 60; PARAMS_MIN_INTERVAL = 6 hours }`; error `BadFeed`, `ParamOutOfBounds(uint8)`, `ParamDeltaTooLarge(uint8)`, `ParamsRateLimited`; event `Observed`, `ParamsUpdated`.

- [ ] **Step 1: Seed EWMA eksak di generator, regenerasi, Rust tetap hijau**

Di `tools/reference/gen_vectors.py` ganti baris
```python
var = W_(0.55**2); prices = [(4000, 0), (4020, .25), (3960, .5), (4100, 1.0), (4080, 1.5), (3900, 2.0)]
```
menjadi
```python
var = W("0.55") * W("0.55") // WAD  # seed persis seperti EquinoxVolEngine: sigmaSeed² / 1e18 dengan sigmaSeed = 0.55e18 eksak
prices = [(4000, 0), (4020, .25), (3960, .5), (4100, 1.0), (4080, 1.5), (3900, 2.0)]
```
lalu:
```bash
python3 tools/reference/gen_vectors.py stylus/bs-math/tests/common/vectors_gen.rs contracts/test/VectorsGen.sol
git diff --stat                                          # expected: hanya vectors_gen.rs (5 baris) dan VectorsGen.sol (5×6 nilai) berubah
grep -c "302500000000000000," stylus/bs-math/tests/common/vectors_gen.rs   # expected: ≥ 1 (seed 0.3025e18 eksak, bukan ...064)
cd stylus/bs-math && cargo test 2>&1 | grep -E "^test result" | awk '{p+=$4; f+=$6} END {print "passed="p" failed="f}' && cd ../..   # expected: passed=23 failed=0
```

- [ ] **Step 2: Tulis test yang gagal — `contracts/test/EquinoxVolEngine.t.sol`** (berdiri sendiri, tanpa pool)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { EquinoxVolEngine } from "../src/pool/EquinoxVolEngine.sol";
import { BlackScholesSol } from "../src/math/BlackScholesSol.sol";
import { MockFeed } from "../src/mocks/MockFeed.sol";
import { VectorsGen } from "./VectorsGen.sol";

/// @notice Skenario 10 (§6.4 direproduksi bit-eksak lewat vektor EWMA), FR-12, FR-13, FR-15. Berdiri sendiri (tanpa pool).
contract EquinoxVolEngineTest is Test {
    uint256 constant T0 = 1_789_718_400;
    MockFeed feed;
    EquinoxVolEngine vol;
    address trader = makeAddr("trader");

    function setUp() public {
        vm.warp(T0);
        feed = new MockFeed(8);
        feed.set(4000e8, T0);
        BlackScholesSol math = new BlackScholesSol();
        vol = new EquinoxVolEngine(address(this), address(feed), address(math),
            EquinoxVolEngine.Params(0.94e18, 1.15e18, 0.3e18, 0.05e18, 0.2e18, 3e18), 0.55e18);
    }

    function test_seed_state() public view {
        assertEq(vol.varWad(), 0.55e18 * 0.55e18 / 1e18);
        assertEq(vol.lastPrice(), 4000e18);
        assertEq(vol.lastTs(), T0);
        assertEq(vol.sigmaBase(), 0.55e18);
    }

    /// Urutan §6.4: (4020, +0,25 h) (3960, +0,25 h) (4100, +0,5 h) (4080, +0,5 h) (3900, +0,5 h) — var harus == vektor.
    function test_poke_matches_ewma_vectors() public {
        (int256[] memory vp, int256[] memory p0, int256[] memory p1, int256[] memory dt, , int256[] memory vn) = VectorsGen.ewmaV();
        for (uint256 i = 0; i < vp.length; i++) {
            assertEq(int256(vol.varWad()), vp[i], "varPrev");
            assertEq(int256(vol.lastPrice()), p0[i], "pPrev");
            uint256 ts = vol.lastTs() + uint256(dt[i]);
            vm.warp(ts);
            feed.set(p1[i] / 1e10, ts); // vektor dalam WAD; feed 8 desimal
            vol.poke();
            assertEq(int256(vol.varWad()), vn[i], "varNew");
        }
        // 58,60% pada akhir urutan (§6.4)
        assertApproxEqRel(vol.sigmaBase(), 0.586e18, 0.002e18);
    }

    function test_poke_ignores_old_round_and_short_interval() public {
        uint256 v0 = vol.varWad();
        vol.poke(); // round sama
        assertEq(vol.varWad(), v0);
        vm.warp(T0 + 30);
        feed.set(4100e8, T0 + 30); // round baru tapi dt < 60 s
        vol.poke();
        assertEq(vol.varWad(), v0);
        assertEq(vol.lastRoundId(), 1);
        vm.warp(T0 + 120);
        feed.set(4100e8, T0 + 120);
        vol.poke();
        assertGt(vol.varWad(), v0);
        assertEq(vol.lastRoundId(), 3);
    }

    function test_sigmaMark_formula_and_clamp() public view {
        // σ_mark(0) = σ_base × VRP
        assertEq(vol.sigmaMark(0), 0.55e18 * 1.15e18 / 1e18);
        // util 1 → × (1 + α)
        assertEq(vol.sigmaMark(1e18), 0.55e18 * 1.15e18 / 1e18 * 1.3e18 / 1e18);
        // util > 1 di-clamp ke 1
        assertEq(vol.sigmaMark(5e18), vol.sigmaMark(1e18));
    }

    function test_sigmaBase_clamped_to_bounds() public {
        // harga meledak → realized vol > σ_max → clamp 300%
        vm.warp(T0 + 3600);
        feed.set(8000e8, T0 + 3600);
        vol.poke();
        assertEq(vol.sigmaBase(), 3e18);
    }

    function test_setParams_bounds_and_rate_limit() public {
        EquinoxVolEngine.Params memory p = EquinoxVolEngine.Params(0.94e18, 1.15e18, 0.3e18, 0.05e18, 0.2e18, 3e18);
        vm.expectRevert(EquinoxVolEngine.ParamsRateLimited.selector);
        vol.setParams(p);
        vm.warp(T0 + 6 hours);
        p.vrp = 1.5e18; // +30% > 20%
        vm.expectRevert(abi.encodeWithSelector(EquinoxVolEngine.ParamDeltaTooLarge.selector, uint8(1)));
        vol.setParams(p);
        p.vrp = 1.3e18; // +13%
        p.alpha = 0.45e18; // +0,15 absolut ≤ 0,2
        vol.setParams(p);
        (, uint64 vrp, uint64 alpha, , , ) = vol.params();
        assertEq(vrp, 1.3e18);
        assertEq(alpha, 0.45e18);
        p.sigmaMax = 6e18; // > 500%
        vm.warp(T0 + 12 hours);
        vm.expectRevert(abi.encodeWithSelector(EquinoxVolEngine.ParamOutOfBounds.selector, uint8(5)));
        vol.setParams(p);
        vm.prank(trader);
        vm.expectRevert();
        vol.setParams(p);
    }
}
```

- [ ] **Step 3: Jalankan — harus gagal kompilasi**

Run: `cd contracts && forge test --match-contract EquinoxVolEngineTest 2>&1 | grep -E "Error|not found" | head -2`
Expected: `Source "../src/pool/EquinoxVolEngine.sol" not found`.

- [ ] **Step 4: Tulis `contracts/src/pool/EquinoxVolEngine.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable, Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { IAggregatorV3 } from "../interfaces/IAggregatorV3.sol";
import { IBlackScholes } from "../interfaces/IBlackScholes.sol";

/// @title EquinoxVolEngine — σ_base dari EWMA realized vol on-chain, σ_mark dari VRP × dampak inventaris (§6.4, §8.5).
/// @notice Tidak ada `setSigma`: σ_base hanya berubah lewat observasi harga (FR-11). Parameter dibatasi keras & rate-limited (FR-15).
contract EquinoxVolEngine is Ownable2Step {
    struct Params {
        uint64 lambdaPerDay; // WAD, ∈ [0.80, 0.99]
        uint64 vrp;          // WAD, ∈ [1.0, 2.0]
        uint64 alpha;        // WAD, ∈ [0, 1.0]
        uint64 spread;       // WAD, ∈ [0.5%, 20%]
        uint64 sigmaMin;     // WAD, ≥ 5%
        uint64 sigmaMax;     // WAD, ≤ 500%
    }

    uint256 private constant WAD = 1e18;
    uint64 public constant MIN_OBS_INTERVAL = 60;          // detik (FR-12)
    uint64 public constant PARAMS_MIN_INTERVAL = 6 hours;   // rate limit setParams
    uint256 public constant MAX_PARAM_DELTA_BPS = 2000;     // |Δ| ≤ 20% per update (relatif)
    uint64 public constant MAX_ALPHA_DELTA = 0.2e18;        // alpha: absolut (boleh mulai dari 0)

    IAggregatorV3 public immutable feed;
    IBlackScholes public immutable math;
    uint256 public immutable priceScale; // 10^(18 − feed.decimals())

    uint256 public varWad;      // varians tahunan (WAD)
    uint256 public lastPrice;   // WAD
    uint80 public lastRoundId;
    uint64 public lastTs;
    Params public params;
    uint64 public lastParamsUpdate;

    event Observed(uint80 indexed roundId, uint256 priceWad, uint256 dtSeconds, uint256 varWad, uint256 sigmaBase);
    event ParamsUpdated(Params params);

    error BadFeed();
    error ParamOutOfBounds(uint8 which);
    error ParamDeltaTooLarge(uint8 which);
    error ParamsRateLimited();

    constructor(address owner_, address feed_, address math_, Params memory p, uint256 sigmaSeed) Ownable(owner_) {
        feed = IAggregatorV3(feed_);
        math = IBlackScholes(math_);
        priceScale = 10 ** (18 - IAggregatorV3(feed_).decimals());
        _checkBounds(p);
        params = p;
        lastParamsUpdate = uint64(block.timestamp);
        (uint80 roundId, int256 answer, , uint256 updatedAt, ) = feed.latestRoundData();
        if (answer <= 0 || updatedAt == 0) revert BadFeed();
        lastPrice = uint256(answer) * priceScale;
        lastRoundId = roundId;
        lastTs = uint64(updatedAt);
        varWad = sigmaSeed * sigmaSeed / WAD; // seed σ → varians; satu-satunya input σ manusia, meluruh dengan λ
        emit ParamsUpdated(p);
    }

    /// @notice Permissionless. Mengabaikan round lama dan Δt < MIN_OBS_INTERVAL (FR-12).
    function poke() external returns (uint256) {
        (uint80 roundId, int256 answer, , uint256 updatedAt, ) = feed.latestRoundData();
        if (roundId <= lastRoundId || answer <= 0 || updatedAt <= lastTs) return sigmaBase();
        uint256 dt = updatedAt - lastTs;
        if (dt < MIN_OBS_INTERVAL) return sigmaBase();
        uint256 p = uint256(answer) * priceScale;
        uint256 v = math.ewmaUpdate(varWad, lastPrice, p, dt, params.lambdaPerDay);
        varWad = v;
        lastPrice = p;
        lastRoundId = roundId;
        lastTs = uint64(updatedAt);
        uint256 sb = sigmaBase();
        emit Observed(roundId, p, dt, v, sb);
        return sb;
    }

    /// @notice σ_base = clamp(√var, σ_min, σ_max).
    function sigmaBase() public view returns (uint256) {
        return _clamp(math.sqrt(varWad));
    }

    /// @notice σ_mark = clamp(σ_base × VRP × (1 + α·util)), util WAD ∈ [0, 1] (FR-13).
    function sigmaMark(uint256 utilWad) external view returns (uint256) {
        if (utilWad > WAD) utilWad = WAD;
        Params memory p = params;
        uint256 s = math.sqrt(varWad);
        s = s * p.vrp / WAD;
        s = s * (WAD + uint256(p.alpha) * utilWad / WAD) / WAD;
        return _clamp(s);
    }

    function spread() external view returns (uint256) {
        return params.spread;
    }

    /// @notice Batas keras + rate limit: ≥ 6 jam antar update, |Δ| ≤ 20% relatif (alpha: ≤ 0,2 absolut).
    function setParams(Params calldata p) external onlyOwner {
        if (block.timestamp - lastParamsUpdate < PARAMS_MIN_INTERVAL) revert ParamsRateLimited();
        _checkBounds(p);
        Params memory o = params;
        if (!_withinRel(o.lambdaPerDay, p.lambdaPerDay)) revert ParamDeltaTooLarge(0);
        if (!_withinRel(o.vrp, p.vrp)) revert ParamDeltaTooLarge(1);
        uint256 da = p.alpha > o.alpha ? p.alpha - o.alpha : o.alpha - p.alpha;
        if (da > MAX_ALPHA_DELTA) revert ParamDeltaTooLarge(2);
        if (!_withinRel(o.spread, p.spread)) revert ParamDeltaTooLarge(3);
        if (!_withinRel(o.sigmaMin, p.sigmaMin)) revert ParamDeltaTooLarge(4);
        if (!_withinRel(o.sigmaMax, p.sigmaMax)) revert ParamDeltaTooLarge(5);
        params = p;
        lastParamsUpdate = uint64(block.timestamp);
        emit ParamsUpdated(p);
    }

    function _checkBounds(Params memory p) internal pure {
        if (p.lambdaPerDay < 0.80e18 || p.lambdaPerDay > 0.99e18) revert ParamOutOfBounds(0);
        if (p.vrp < 1e18 || p.vrp > 2e18) revert ParamOutOfBounds(1);
        if (p.alpha > 1e18) revert ParamOutOfBounds(2);
        if (p.spread < 0.005e18 || p.spread > 0.2e18) revert ParamOutOfBounds(3);
        if (p.sigmaMin < 0.05e18) revert ParamOutOfBounds(4);
        if (p.sigmaMax > 5e18 || p.sigmaMax <= p.sigmaMin) revert ParamOutOfBounds(5);
    }

    function _withinRel(uint256 oldV, uint256 newV) internal pure returns (bool) {
        uint256 lo = oldV * (10_000 - MAX_PARAM_DELTA_BPS) / 10_000;
        uint256 hi = oldV * (10_000 + MAX_PARAM_DELTA_BPS) / 10_000;
        return newV >= lo && newV <= hi;
    }

    function _clamp(uint256 s) internal view returns (uint256) {
        Params memory p = params;
        if (s < p.sigmaMin) return p.sigmaMin;
        if (s > p.sigmaMax) return p.sigmaMax;
        return s;
    }
}
```

- [ ] **Step 5: Jalankan — 6 lolos (termasuk urutan §6.4 bit-eksak vs vektor)**

Run: `cd contracts && forge test --match-contract EquinoxVolEngineTest 2>&1 | grep -E "^\[|Suite result"`
Expected: `test_seed_state`, `test_poke_matches_ewma_vectors`, `test_poke_ignores_old_round_and_short_interval`, `test_sigmaMark_formula_and_clamp`, `test_sigmaBase_clamped_to_bounds`, `test_setParams_bounds_and_rate_limit` semua `[PASS]`; `Suite result: ok. 6 passed`.

- [ ] **Step 6: Commit**

```bash
cd ..
git add tools/reference/gen_vectors.py stylus/bs-math/tests/common/vectors_gen.rs contracts/test/VectorsGen.sol contracts/src/pool/EquinoxVolEngine.sol contracts/test/EquinoxVolEngine.t.sol
git commit -m "feat(contracts): EquinoxVolEngine (EWMA realized vol, VRP x inventory sigma_mark, bounded params); exact EWMA seed in vectors"
```

### Task 5: `EquinoxPool` + factory dua-level + fixture + skenario §12 (FR-17, FR-19..FR-37)

**Files:**
- Create: `contracts/src/pool/EquinoxPool.sol`, `contracts/src/pool/EquinoxFactory.sol` (berisi `PoolDeployer` dan `EquinoxFactory`)
- Test: `contracts/test/PoolFixture.sol`, `contracts/test/EquinoxPool.t.sol`

**Interfaces:**
- Consumes: `IBlackScholes` (`quote`, `cappedCall`, `markPortfolio`), `OracleLib`, `EquinoxOptionToken`, `EquinoxVolEngine`, OZ `ERC4626/Ownable2Step/ReentrancyGuard/SafeERC20/Math`.
- Produces: `EquinoxPool` (lihat kode: `Config`, `Series`, `Board`, `Deploy`; `constructor(Deploy d, address token, address vol)`; `totalAssets/deposit/mint/maxWithdraw/maxRedeem/freeLiquidity`; `createBoard(uint64 expiry, uint128[] strikes) onlyOwner → boardId`; `quoteBuy(id,size) → QuoteOut{premiumAssets, feeAssets, sigma, delta, vegaTotal, spotWad}`; `quoteClose(id,size) → (proceedsAssets, sigmaClose, spotWad)`; `buy(id,size,maxPremiumAssets) → premiumAssets`; `close(id,size,minProceedsAssets) → proceedsAssets`; `settle(boardId)`; `claim(id,amount) → payoutAssets`; `pauseTrading(bool)`, `setConfig`, `setTreasury`; views `reserved`, `escrowedPayouts`, `netVega`, `series(id)`, `board(id)`, `boardCount`, `openSeriesIds`, `spot`, `sigmaMarkNow`; `CAP_MULT = 2e18`). `PoolDeployer.deploy(Deploy, token, vol)` (hanya factory). `EquinoxFactory.createPool(Deploy) → pool` (deploy vol → token → pool → `bindPool`), `pools(i)`, `poolCount()`.

- [ ] **Step 1: Tulis fixture dan test yang gagal**

`contracts/test/PoolFixture.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { BlackScholesSol } from "../src/math/BlackScholesSol.sol";
import { IBlackScholes } from "../src/interfaces/IBlackScholes.sol";
import { EquinoxPool } from "../src/pool/EquinoxPool.sol";
import { EquinoxFactory } from "../src/pool/EquinoxFactory.sol";
import { EquinoxOptionToken } from "../src/pool/EquinoxOptionToken.sol";
import { EquinoxVolEngine } from "../src/pool/EquinoxVolEngine.sol";
import { MockUSDG } from "../src/mocks/MockUSDG.sol";
import { MockFeed } from "../src/mocks/MockFeed.sol";
import { MockSequencerFeed } from "../src/mocks/MockSequencerFeed.sol";

/// @notice Fixture bersama: pool dengan kontrol Solidity sebagai `math` (L3 tanpa node Stylus), parameter §6.8.
abstract contract PoolFixture is Test {
    uint256 internal constant WAD = 1e18;
    /// 2026-09-18 08:00:00 UTC — sebuah Jumat 08:00 (grid expiry), 115200 + 2959·604800.
    uint256 internal constant T0 = 1_789_718_400;
    uint256 internal constant WEEK = 604_800;

    MockUSDG internal usdg;
    MockFeed internal feed;
    MockSequencerFeed internal seq;
    BlackScholesSol internal mathSol;
    EquinoxFactory internal factory;
    EquinoxPool internal pool;
    EquinoxOptionToken internal token;
    EquinoxVolEngine internal vol;

    address internal lp = makeAddr("lp");
    address internal trader = makeAddr("trader");
    address internal treasury = makeAddr("treasury");

    function setUp() public virtual {
        vm.warp(T0);
        usdg = new MockUSDG();
        feed = new MockFeed(8);
        seq = new MockSequencerFeed();
        feed.set(4000e8, T0);
        seq.set(0, T0 - 2 hours);
        mathSol = new BlackScholesSol();
        factory = new EquinoxFactory();
        pool = EquinoxPool(factory.createPool(deployParams(address(mathSol))));
        token = pool.token();
        vol = pool.vol();
        usdg.mint(lp, 10_000_000e6);
        usdg.mint(trader, 10_000_000e6);
        vm.prank(lp);
        usdg.approve(address(pool), type(uint256).max);
        vm.prank(trader);
        usdg.approve(address(pool), type(uint256).max);
    }

    function deployParams(address math_) internal view returns (EquinoxPool.Deploy memory d) {
        d.owner = address(this);
        d.usdg = address(usdg);
        d.feed = address(feed);
        d.sequencerFeed = address(seq);
        d.math = math_;
        d.treasury = treasury;
        d.cfg = EquinoxPool.Config({
            feeBps: 300,
            maxUtilBps: 8000,
            vegaCapBps: 500,
            minPremiumBps: 5,
            heartbeat: 3600,
            staleMult: 3,
            sequencerGrace: 3600,
            maxOpenSeries: 32,
            tenorMax: 30 days,
            minSize: 1e16,
            settleBounty: 2e6
        });
        d.vol = EquinoxVolEngine.Params({
            lambdaPerDay: 0.94e18,
            vrp: 1.15e18,
            alpha: 0.3e18,
            spread: 0.05e18,
            sigmaMin: 0.2e18,
            sigmaMax: 3e18
        });
        d.sigmaSeed = 0.55e18;
        d.rWad = 0;
        d.name = "Equinox ETH/USDG LP";
        d.symbol = "eqETH";
    }

    /// @dev Board 7 hari dengan strike 3800 / 4000 / 4200 (call+put masing-masing → 6 seri).
    function listBoard7d() internal returns (uint256 boardId, uint64 expiry, uint256[] memory ids) {
        expiry = uint64(T0 + WEEK);
        uint128[] memory ks = new uint128[](3);
        ks[0] = 3800e18;
        ks[1] = 4000e18;
        ks[2] = 4200e18;
        boardId = pool.createBoard(expiry, ks);
        (, , , ids) = pool.board(boardId);
    }

    function sid(uint64 expiry, uint128 strike, bool isCall) internal view returns (uint256) {
        return token.seriesId(address(pool), expiry, strike, isCall);
    }

    function lpDeposit(uint256 assets) internal returns (uint256 shares) {
        vm.prank(lp);
        shares = pool.deposit(assets, lp);
    }

    function traderBuy(uint256 id, uint256 size) internal returns (uint256 premium) {
        vm.prank(trader);
        premium = pool.buy(id, size, type(uint256).max);
    }

    /// @dev Round Chainlink baru "sekarang" dengan harga tertentu (8 desimal).
    function tick(int256 price8) internal {
        feed.set(price8, block.timestamp);
    }
}
```

`contracts/test/EquinoxPool.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { PoolFixture } from "./PoolFixture.sol";
import { EquinoxPool } from "../src/pool/EquinoxPool.sol";
import { IBlackScholes } from "../src/interfaces/IBlackScholes.sol";

/// @notice Skenario wajib PRD §12 (1–13) + properti INV-1..4, INV-9, INV-11, INV-14 pada jalur happy/edge.
contract EquinoxPoolTest is PoolFixture {
    // ------------------------------------------------------------ LP

    function test_deposit_withdraw_no_positions() public {
        uint256 shares = lpDeposit(1_000_000e6);
        assertEq(pool.totalAssets(), 1_000_000e6);
        assertEq(pool.freeLiquidity(), 1_000_000e6);
        vm.prank(lp);
        pool.withdraw(400_000e6, lp, lp);
        assertEq(pool.totalAssets(), 600_000e6);
        assertLt(pool.balanceOf(lp), shares);
    }

    // ------------------------------------------------------------ kuotasi & buy

    /// Premi pool == formula §6.4/§8.4 yang dihitung ulang langsung lewat math + vol engine.
    function test_buy_premium_matches_formula() public {
        lpDeposit(1_000_000e6);
        (, uint64 expiry, ) = listBoard7d();
        uint256 id = sid(expiry, 4200e18, true);
        uint256 size = 10e18;
        // hitung ulang
        uint256 t = uint256(WEEK) * WAD / 31_536_000;
        uint256 sigmaNow = vol.sigmaMark(0);
        (, , int256 vegaUnit) = mathSol.cappedCall(4000e18, 4200e18, 8400e18, t, sigmaNow, 0);
        uint256 vegaTotal = uint256(vegaUnit) * size / WAD;
        uint256 vegaCap = 1_000_000e18 * 500 / 10_000;
        uint256 util = vegaTotal * WAD / vegaCap;
        uint256 sigmaBuy = vol.sigmaMark(util) * (WAD + 0.05e18) / WAD;
        (uint256 p, , ) = mathSol.cappedCall(4000e18, 4200e18, 8400e18, t, sigmaBuy, 0);
        uint256 premiumWad = p * size / WAD;
        uint256 expectedPremium = (premiumWad + 1e12 - 1) / 1e12;
        uint256 expectedFee = (premiumWad * 300 / 10_000 + 1e12 - 1) / 1e12;

        EquinoxPool.QuoteOut memory q = pool.quoteBuy(id, size);
        assertEq(q.premiumAssets, expectedPremium, "premium");
        assertEq(q.feeAssets, expectedFee, "fee");
        assertEq(q.sigma, sigmaBuy, "sigma");
        // dampak inventaris: sigma_buy > sigma_mark(0) × (1+s)
        assertGt(sigmaBuy, vol.sigmaMark(0) * (WAD + 0.05e18) / WAD);
        // sanity ekonomi: mid pada 63,25% ≈ 64,87/unit → beli 10 unit dengan spread+dampak antara 700 dan 800 USDG
        assertGt(q.premiumAssets, 700e6);
        assertLt(q.premiumAssets, 800e6);

        uint256 balBefore = usdg.balanceOf(trader);
        uint256 paid = traderBuy(id, size);
        assertEq(paid, expectedPremium);
        assertEq(balBefore - usdg.balanceOf(trader), expectedPremium + expectedFee);
        assertEq(usdg.balanceOf(treasury), expectedFee);
    }

    /// INV-2 dan INV-4 setelah buy.
    function test_buy_updates_reserved_oi_supply_netVega() public {
        lpDeposit(1_000_000e6);
        (, uint64 expiry, ) = listBoard7d();
        uint256 id = sid(expiry, 4200e18, true);
        traderBuy(id, 10e18);
        (, , , , , uint256 oi, uint256 vegaAcc, ) = pool.series(id);
        assertEq(oi, 10e18);
        assertEq(token.totalSupply(id), 10e18);
        assertEq(token.balanceOf(trader, id), 10e18);
        assertEq(pool.reserved(), 4200e18 * 10);
        assertEq(pool.netVega(), vegaAcc);
        assertGt(pool.netVega(), 0);
        assertEq(pool.freeLiquidity(), usdg.balanceOf(address(pool)) - 42_000e6, "free = cash - reserved");
    }

    /// Skenario 4 (INV-9): beli lalu tutup di blok yang sama → trader rugi ≥ 2·s·vega + fee; tidak ada round-trip gratis.
    function test_wash_trade_is_not_free() public {
        lpDeposit(1_000_000e6);
        (, uint64 expiry, ) = listBoard7d();
        uint256 id = sid(expiry, 4200e18, true);
        uint256 before = usdg.balanceOf(trader);
        traderBuy(id, 50e18);
        vm.prank(trader);
        uint256 proceeds = pool.close(id, 50e18, 0);
        uint256 loss = before - usdg.balanceOf(trader);
        assertGt(loss, 0, "round trip must cost");
        assertGt(loss, proceeds / 20, "loss >= ~5% (2x spread) of notional premium");
        // pool kembali bersih
        assertEq(pool.reserved(), 0);
        assertEq(pool.netVega(), 0);
        assertEq(token.totalSupply(id), 0);
        // INV-9 pada state yang sama: quoteClose < quoteBuy
        EquinoxPool.QuoteOut memory qb = pool.quoteBuy(id, 1e18);
        (uint256 qc, , ) = pool.quoteClose(id, 1e18);
        assertLt(qc, qb.premiumAssets);
    }

    // ------------------------------------------------------------ settlement

    /// Skenario 1: deposit → beli 10 C 4200 → expiry, S_T = 4.500 → settle → claim 3.000 → NAV LP = 1e6 + premi − 3.000.
    function test_scenario1_settle_claim_nav() public {
        lpDeposit(1_000_000e6);
        (uint256 boardId, uint64 expiry, ) = listBoard7d();
        uint256 id = sid(expiry, 4200e18, true);
        uint256 premium = traderBuy(id, 10e18);
        vm.warp(expiry);
        tick(4500e8);
        address keeper = makeAddr("keeper");
        vm.prank(keeper);
        pool.settle(boardId);
        assertEq(usdg.balanceOf(keeper), 2e6, "bounty");
        (, , , , bool settled, , , uint256 payoutPerUnit) = pool.series(id);
        assertTrue(settled);
        assertEq(payoutPerUnit, 300e18);
        assertEq(pool.escrowedPayouts(), 3000e18);
        assertEq(pool.reserved(), 0);
        vm.prank(trader);
        uint256 got = pool.claim(id, 10e18);
        assertEq(got, 3000e6);
        assertEq(pool.escrowedPayouts(), 0);
        assertEq(token.totalSupply(id), 0);
        assertEq(pool.totalAssets(), 1_000_000e6 + premium - 3000e6 - 2e6, "NAV LP");
        // LP bisa menarik semuanya sekarang
        uint256 lpShares = pool.balanceOf(lp);
        vm.prank(lp);
        pool.redeem(lpShares, lp, lp);
        assertEq(usdg.balanceOf(address(pool)), 0);
    }

    /// Skenario 2 (INV-1/INV-3): 200 C 4.000 (util 80%) lalu S_T = 40.000 → payout = cadangan; LP tersisa ≥ 200k + premi.
    function test_scenario2_solvency_extreme() public {
        lpDeposit(1_000_000e6);
        (uint256 boardId, uint64 expiry, ) = listBoard7d();
        uint256 id = sid(expiry, 4000e18, true);
        // pecah dalam 4 pembelian agar vega cap tidak mengunci lebih dulu; total 200 unit = 800k cadangan = 80%
        uint256 premiumTotal;
        for (uint256 i = 0; i < 4; i++) premiumTotal += traderBuy(id, 50e18);
        assertEq(pool.reserved(), 800_000e18);
        // kapital = cash - escrow (termasuk premi yang masuk); 80% x kapital < 800k + 80k
        uint256 capital = usdg.balanceOf(address(pool));
        assertLt(capital * 8000 / 10_000, 880_000e6);
        vm.expectRevert(EquinoxPool.UtilizationExceeded.selector);
        vm.prank(trader);
        pool.buy(id, 20e18, type(uint256).max);
        vm.warp(expiry);
        tick(40_000e8);
        pool.settle(boardId);
        assertEq(pool.escrowedPayouts(), 800_000e18, "payout = reserved (cap)");
        vm.prank(trader);
        pool.claim(id, 200e18);
        assertEq(usdg.balanceOf(address(pool)), 200_000e6 + premiumTotal - 2e6);
        assertGe(pool.totalAssets(), 200_000e6);
    }

    /// Skenario 3: P 2.600 → premi = floor 5 bps × K (tidak nol).
    function test_deep_otm_floor() public {
        lpDeposit(1_000_000e6);
        uint64 expiry = uint64(T0 + WEEK);
        uint128[] memory ks = new uint128[](1);
        ks[0] = 2600e18;
        pool.createBoard(expiry, ks);
        uint256 id = sid(expiry, 2600e18, false);
        EquinoxPool.QuoteOut memory q = pool.quoteBuy(id, 1e18);
        assertEq(q.premiumAssets, 2600e6 * 5 / 10_000, "floor 5 bps x K");
        traderBuy(id, 1e18);
    }

    /// Skenario 11: cap — S_T = 9.000 dan 8.400 membayar sama (K).
    function test_cap_payout_same_beyond_cap() public {
        lpDeposit(1_000_000e6);
        (uint256 boardId, uint64 expiry, ) = listBoard7d();
        uint256 id = sid(expiry, 4200e18, true);
        traderBuy(id, 1e18);
        vm.warp(expiry);
        tick(9000e8);
        pool.settle(boardId);
        (, , , , , , , uint256 payout) = pool.series(id);
        assertEq(payout, 4200e18);
    }

    /// Skenario 7: aturan round settlement.
    function test_settlement_round_rules() public {
        lpDeposit(1_000_000e6);
        (uint256 boardId, uint64 expiry, ) = listBoard7d();
        vm.expectRevert(EquinoxPool.BoardNotExpired.selector);
        pool.settle(boardId);
        vm.warp(expiry);
        // round terakhir masih dari sebelum expiry → belum siap
        vm.expectRevert(EquinoxPool.SettlementNotReady.selector);
        pool.settle(boardId);
        tick(4100e8);
        pool.settle(boardId);
        vm.expectRevert(EquinoxPool.BoardAlreadySettled.selector);
        pool.settle(boardId);
        (, bool settled, uint256 sp, ) = pool.board(boardId);
        assertTrue(settled);
        assertEq(sp, 4100e18);
        assertEq(pool.openSeriesIds().length, 0);
    }

    // ------------------------------------------------------------ oracle & pause

    /// Skenario 5 (FR-36): stale → buy/close/deposit revert; withdraw memakai NAV konservatif; claim seri settle tetap jalan.
    function test_oracle_stale_paths() public {
        lpDeposit(1_000_000e6);
        (uint256 boardId, uint64 expiry, ) = listBoard7d();
        uint256 id = sid(expiry, 4200e18, true);
        traderBuy(id, 10e18);
        uint256 navFresh = pool.totalAssets();
        vm.warp(block.timestamp + 4 hours); // > heartbeat × staleMult = 3 jam
        (, bool fresh) = pool.spot();
        assertFalse(fresh);
        vm.expectRevert(EquinoxPool.OracleStale.selector);
        vm.prank(trader);
        pool.buy(id, 1e18, type(uint256).max);
        vm.expectRevert(EquinoxPool.OracleStale.selector);
        vm.prank(trader);
        pool.close(id, 1e18, 0);
        vm.expectRevert(EquinoxPool.OracleStale.selector);
        vm.prank(lp);
        pool.deposit(1e6, lp);
        // NAV konservatif = cash − escrow − reserved < NAV segar (MtM)
        uint256 navStale = pool.totalAssets();
        assertLt(navStale, navFresh);
        assertEq(navStale, usdg.balanceOf(address(pool)) - 42_000e6);
        // withdraw tetap jalan (dibatasi likuiditas bebas)
        uint256 maxW = pool.maxWithdraw(lp);
        assertEq(maxW, pool.freeLiquidity());
        vm.prank(lp);
        pool.withdraw(1000e6, lp, lp);
        // settle & claim setelah round segar pasca-expiry
        vm.warp(expiry);
        tick(4300e8);
        pool.settle(boardId);
        vm.warp(block.timestamp + 5 hours); // stale lagi
        vm.prank(trader);
        assertEq(pool.claim(id, 10e18), 1000e6);
    }

    /// Skenario 6: sequencer down → stale; setelah grace → normal.
    function test_sequencer_down_and_grace() public {
        lpDeposit(1_000_000e6);
        (, uint64 expiry, ) = listBoard7d();
        uint256 id = sid(expiry, 4200e18, true);
        seq.set(1, block.timestamp);
        vm.expectRevert(EquinoxPool.OracleStale.selector);
        vm.prank(trader);
        pool.buy(id, 1e18, type(uint256).max);
        seq.set(0, block.timestamp);          // baru naik: masih dalam grace
        vm.expectRevert(EquinoxPool.OracleStale.selector);
        vm.prank(trader);
        pool.buy(id, 1e18, type(uint256).max);
        vm.warp(block.timestamp + 3600);
        tick(4000e8);
        traderBuy(id, 1e18);
    }

    /// Skenario 8 (INV-14): pause hanya memblokir buy & createBoard.
    function test_pause_semantics() public {
        lpDeposit(1_000_000e6);
        (uint256 boardId, uint64 expiry, ) = listBoard7d();
        uint256 id = sid(expiry, 4200e18, true);
        traderBuy(id, 5e18);
        pool.pauseTrading(true);
        vm.expectRevert(EquinoxPool.TradingIsPaused.selector);
        vm.prank(trader);
        pool.buy(id, 1e18, type(uint256).max);
        uint128[] memory ks = new uint128[](1);
        ks[0] = 4100e18;
        vm.expectRevert(EquinoxPool.TradingIsPaused.selector);
        pool.createBoard(uint64(T0 + 2 * WEEK), ks);
        vm.prank(trader);
        pool.close(id, 2e18, 0);
        vm.prank(lp);
        pool.withdraw(1000e6, lp, lp);
        vm.warp(expiry);
        tick(4300e8);
        pool.settle(boardId);
        vm.prank(trader);
        pool.claim(id, 3e18);
    }

    // ------------------------------------------------------------ batas

    function test_vega_cap() public {
        lpDeposit(100_000e6); // vegaCap = 5% x 100k = 5.000 USDG per 1,00 vol; ATM 28h vega ~ 450/unit -> ~11 unit
        uint64 expiry = uint64(T0 + 4 * WEEK);
        uint128[] memory ks = new uint128[](1);
        ks[0] = 4000e18;
        pool.createBoard(expiry, ks);
        uint256 id = sid(expiry, 4000e18, true);
        vm.expectRevert(EquinoxPool.VegaCapExceeded.selector);
        vm.prank(trader);
        pool.buy(id, 12e18, type(uint256).max);   // cadangan 48k < 80k (util ok), vega ~5.4k > 5k
        traderBuy(id, 8e18);
    }

    function test_createBoard_validation() public {
        lpDeposit(1_000_000e6);
        uint128[] memory ks = new uint128[](1);
        ks[0] = 4000e18;
        vm.expectRevert(EquinoxPool.BadExpiry.selector);
        pool.createBoard(uint64(T0 + WEEK + 1), ks);                   // bukan grid Jumat 08:00
        vm.expectRevert(EquinoxPool.BadExpiry.selector);
        pool.createBoard(uint64(T0 + 5 * WEEK), ks);                   // > tenorMax 30 hari
        uint128[] memory bad = new uint128[](1);
        bad[0] = 1000e18;                                              // < S/2
        vm.expectRevert(EquinoxPool.BadStrike.selector);
        pool.createBoard(uint64(T0 + WEEK), bad);
        uint128[] memory unsorted = new uint128[](2);
        unsorted[0] = 4200e18;
        unsorted[1] = 4000e18;
        vm.expectRevert(EquinoxPool.BadStrike.selector);
        pool.createBoard(uint64(T0 + WEEK), unsorted);
        uint128[] memory many = new uint128[](17);                     // 34 seri > 32
        for (uint256 i = 0; i < 17; i++) many[i] = uint128(3000e18 + i * 100e18);
        vm.expectRevert(EquinoxPool.TooManySeries.selector);
        pool.createBoard(uint64(T0 + WEEK), many);
        uint128[] memory ok = new uint128[](15);                       // 30 seri
        for (uint256 i = 0; i < 15; i++) ok[i] = uint128(3000e18 + i * 100e18);
        pool.createBoard(uint64(T0 + WEEK), ok);
        assertEq(pool.openSeriesIds().length, 30);
        uint128[] memory dup = new uint128[](1);
        dup[0] = 3000e18;                                              // seri (expiry, 3000, call) sudah ada
        vm.expectRevert(EquinoxPool.BadStrike.selector);
        pool.createBoard(uint64(T0 + WEEK), dup);
        uint128[] memory two = new uint128[](2);                       // 30 + 4 > 32
        two[0] = 5000e18;
        two[1] = 5100e18;
        vm.expectRevert(EquinoxPool.TooManySeries.selector);
        pool.createBoard(uint64(T0 + WEEK), two);
        uint128[] memory last = new uint128[](1);
        last[0] = 4500e18;                                             // 30 + 2 = 32 tepat
        pool.createBoard(uint64(T0 + WEEK), last);
        assertEq(pool.openSeriesIds().length, 32);
    }

    function test_min_size_and_unknown_series() public {
        lpDeposit(1_000_000e6);
        (, uint64 expiry, ) = listBoard7d();
        uint256 id = sid(expiry, 4200e18, true);
        vm.expectRevert(EquinoxPool.SizeTooSmall.selector);
        vm.prank(trader);
        pool.buy(id, 1e15, type(uint256).max);
        vm.expectRevert(EquinoxPool.SeriesUnknown.selector);
        vm.prank(trader);
        pool.buy(12345, 1e18, type(uint256).max);
    }

    /// NAV MtM: setelah buy, NAV ≈ cash − MtM(mid) → LP langsung mencatat spread sebagai laba; theta menaikkan NAV seiring waktu.
    function test_nav_marks_to_market() public {
        lpDeposit(1_000_000e6);
        (, uint64 expiry, ) = listBoard7d();
        uint256 id = sid(expiry, 4200e18, true);
        uint256 premium = traderBuy(id, 10e18);
        uint256 nav0 = pool.totalAssets();
        assertGt(nav0, 1_000_000e6, "spread realised");
        assertLt(nav0, 1_000_000e6 + premium, "liability marked");
        vm.warp(block.timestamp + 3 days);
        tick(4000e8);
        uint256 nav1 = pool.totalAssets();
        assertGt(nav1, nav0, "theta accrues to LP");
    }
}
```

- [ ] **Step 2: Jalankan — harus gagal kompilasi**

Run: `cd contracts && forge test --match-contract EquinoxPoolTest 2>&1 | grep -E "Error|not found" | head -2`
Expected: `Source "../src/pool/EquinoxPool.sol" not found`.

- [ ] **Step 3: Tulis `contracts/src/pool/EquinoxPool.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC4626, IERC20, IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable, Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IAggregatorV3 } from "../interfaces/IAggregatorV3.sol";
import { IBlackScholes } from "../interfaces/IBlackScholes.sol";
import { OracleLib } from "../oracle/OracleLib.sol";
import { EquinoxOptionToken } from "./EquinoxOptionToken.sol";
import { EquinoxVolEngine } from "./EquinoxVolEngine.sol";

/// @title EquinoxPool — vault ERC-4626 atas USDG yang menjual opsi ETH Eropa cash-settled (§8.4).
/// @notice Harga sepenuhnya on-chain: σ dari EquinoxVolEngine, Black-Scholes dari `math` (Stylus atau kontrol Solidity —
///         pool tidak tahu bedanya). Solvabilitas keras: `reserved = Σ OI × K` ≤ aset; call dibayar `min(S_T − K, K)`.
/// @dev Akuntansi internal dalam WAD (1e18); konversi ke desimal aset hanya di boundary transfer (FR-35):
///      premi dibulatkan ke atas, proceeds/payout ke bawah. Ukuran opsi (`size`) dalam WAD unit (1e18 = 1 ETH).
contract EquinoxPool is ERC4626, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- tipe
    struct Config {
        uint16 feeBps;          // fee atas premi → treasury (≤ 1000)
        uint16 maxUtilBps;      // reserved ≤ maxUtil × (cash − escrow) (≤ 9000)
        uint16 vegaCapBps;      // vegaCap = (cash − escrow) × bps/1e4, per 1,00 vol (≤ 5000)
        uint16 minPremiumBps;   // premi ≥ bps × K × size (≤ 100)
        uint32 heartbeat;       // detik
        uint8 staleMult;        // kuotasi revert bila umur spot > heartbeat × staleMult (≥ 1)
        uint32 sequencerGrace;  // detik setelah sequencer kembali
        uint8 maxOpenSeries;    // ≤ 32 (batas loop MtM / markPortfolio)
        uint32 tenorMax;        // detik (≤ 90 hari)
        uint128 minSize;        // WAD unit
        uint128 settleBounty;   // unit aset (mis. 2e6 = 2 USDG)
    }

    struct Series {
        uint32 boardId;
        uint64 expiry;
        uint128 strike;        // WAD
        bool isCall;
        bool settled;
        uint256 oi;            // WAD unit
        uint256 vegaAcc;       // Σ vega yang dibukukan saat trade (WAD per 1,00 vol)
        uint256 payoutPerUnit; // WAD USDG, diisi saat settle
    }

    struct Board {
        uint64 expiry;
        bool settled;
        uint256 settlementPrice; // WAD
        uint256[] seriesIds;
    }

    struct Deploy {
        address owner;
        address usdg;
        address feed;
        address sequencerFeed; // address(0) = tanpa cek sequencer
        address math;
        address treasury;
        Config cfg;
        EquinoxVolEngine.Params vol;
        uint256 sigmaSeed; // WAD
        int256 rWad;       // suku bunga (WAD), default 0
        string name;
        string symbol;
    }

    // ---------------------------------------------------------------- konstanta & immutables
    uint256 private constant WAD = 1e18;
    uint256 private constant SECONDS_PER_YEAR = 31_536_000;
    uint256 private constant T_MIN = 60;                 // detik; domain math (§6.6)
    uint256 private constant FRIDAY_0800 = 115_200;      // 1970-01-02 08:00 UTC
    uint256 private constant WEEK = 604_800;
    uint256 public constant CAP_MULT = 2e18;             // payout call dibatasi K (cap = 2K)

    IBlackScholes public immutable math;
    IAggregatorV3 public immutable feed;
    IAggregatorV3 public immutable sequencerFeed;
    EquinoxOptionToken public immutable token;
    EquinoxVolEngine public immutable vol;
    uint256 public immutable priceScale;  // 10^(18 − feed.decimals())
    uint256 public immutable assetScale;  // 10^(18 − asset.decimals())
    int256 public immutable rWad;

    // ---------------------------------------------------------------- state
    Config public cfg;
    address public treasury;
    bool public tradingPaused;
    uint256 public reserved;         // WAD USDG: Σ OI × K seri terbuka
    uint256 public escrowedPayouts;  // WAD USDG: payout pasti menunggu claim
    uint256 public netVega;          // WAD per 1,00 vol
    mapping(uint256 => Series) public series;
    Board[] internal _boards;
    uint256[] internal _openSeriesIds;

    // ---------------------------------------------------------------- events
    event BoardCreated(uint256 indexed boardId, uint64 expiry, uint256[] seriesIds);
    event Bought(uint256 indexed seriesId, address indexed trader, uint256 size, uint256 premiumAssets, uint256 feeAssets, uint256 sigmaBuy, uint256 spotWad);
    event Closed(uint256 indexed seriesId, address indexed trader, uint256 size, uint256 proceedsAssets, uint256 sigmaClose, uint256 spotWad);
    event Settled(uint256 indexed boardId, uint256 settlementPriceWad, uint256 escrowedAddedWad, uint256 reservedReleasedWad);
    event Claimed(uint256 indexed seriesId, address indexed holder, uint256 amount, uint256 payoutAssets);
    event TradingPaused(bool paused);
    event ConfigUpdated(Config cfg);
    event TreasuryUpdated(address treasury);

    // ---------------------------------------------------------------- errors
    error TradingIsPaused();
    error OracleStale();
    error SeriesUnknown();
    error SeriesSettled();
    error SeriesExpired();
    error SizeTooSmall();
    error SlippageExceeded();
    error UtilizationExceeded();
    error VegaCapExceeded();
    error BadExpiry();
    error BadStrike();
    error TooManySeries();
    error BoardNotExpired();
    error BoardAlreadySettled();
    error SettlementNotReady();
    error NotSettled();
    error ConfigOutOfBounds(uint8 which);

    // ---------------------------------------------------------------- constructor
    /// @param token_ EquinoxOptionToken yang akan di-`bindPool` ke pool ini oleh factory; vol_ = EquinoxVolEngine.
    constructor(Deploy memory d, address token_, address vol_)
        ERC20(d.name, d.symbol)
        ERC4626(IERC20(d.usdg))
        Ownable(d.owner)
    {
        math = IBlackScholes(d.math);
        feed = IAggregatorV3(d.feed);
        sequencerFeed = IAggregatorV3(d.sequencerFeed);
        priceScale = 10 ** (18 - IAggregatorV3(d.feed).decimals());
        assetScale = 10 ** (18 - IERC20Metadata(d.usdg).decimals());
        rWad = d.rWad;
        _setConfig(d.cfg);
        treasury = d.treasury;
        token = EquinoxOptionToken(token_);
        vol = EquinoxVolEngine(vol_);
    }

    // ================================================================ LP (ERC-4626)

    /// @notice NAV = cash − escrow − nilai wajar opsi terbuka (mark-to-market lewat satu panggilan `markPortfolio`).
    ///         Saat oracle stale atau `math` gagal: NAV konservatif = cash − escrow − reserved (FR-36).
    function totalAssets() public view override returns (uint256) {
        uint256 cash = IERC20(asset()).balanceOf(address(this)) * assetScale;
        uint256 base = cash > escrowedPayouts ? cash - escrowedPayouts : 0;
        uint256 liability = _liabilityWad(base);
        uint256 nav = base > liability ? base - liability : 0;
        return nav / assetScale;
    }

    function deposit(uint256 assets, address receiver) public override returns (uint256) {
        _requireFresh();
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver) public override returns (uint256) {
        _requireFresh();
        return super.mint(shares, receiver);
    }

    /// @notice Penarikan dibatasi likuiditas bebas: cash − escrow − reserved (FR-32). Tetap jalan saat stale (NAV konservatif).
    function maxWithdraw(address owner_) public view override returns (uint256) {
        return Math.min(super.maxWithdraw(owner_), freeLiquidity());
    }

    function maxRedeem(address owner_) public view override returns (uint256) {
        uint256 shares = super.maxRedeem(owner_);
        if (escrowedPayouts + reserved == 0) return shares; // tidak ada yang terkunci: hindari kehilangan 1 share oleh pembulatan
        return Math.min(shares, _convertToShares(freeLiquidity(), Math.Rounding.Floor));
    }

    /// @notice Likuiditas bebas dalam unit aset.
    function freeLiquidity() public view returns (uint256) {
        uint256 cash = IERC20(asset()).balanceOf(address(this)) * assetScale;
        uint256 locked = escrowedPayouts + reserved;
        return cash > locked ? (cash - locked) / assetScale : 0;
    }

    // ================================================================ listing

    /// @notice Board = satu expiry (Jumat 08:00 UTC, tenor ≤ tenorMax) dengan call+put per strike (FR-19).
    function createBoard(uint64 expiry, uint128[] calldata strikes) external onlyOwner returns (uint256 boardId) {
        if (tradingPaused) revert TradingIsPaused();
        if (expiry <= block.timestamp || expiry - block.timestamp > cfg.tenorMax) revert BadExpiry();
        if ((uint256(expiry) - FRIDAY_0800) % WEEK != 0) revert BadExpiry();
        uint256 s = _requireFresh();
        uint256 n = strikes.length;
        if (n == 0 || _openSeriesIds.length + 2 * n > cfg.maxOpenSeries) revert TooManySeries();
        boardId = _boards.length;
        _boards.push();
        Board storage b = _boards[boardId];
        b.expiry = expiry;
        uint128 prev = 0;
        for (uint256 i = 0; i < n; i++) {
            uint128 k = strikes[i];
            if (k <= prev || k < s / 2 || k > 2 * s) revert BadStrike();
            prev = k;
            for (uint256 c = 0; c < 2; c++) {
                bool isCall = c == 0;
                uint256 id = token.seriesId(address(this), expiry, k, isCall);
                if (series[id].expiry != 0) revert BadStrike();
                series[id] = Series({ boardId: uint32(boardId), expiry: expiry, strike: k, isCall: isCall, settled: false, oi: 0, vegaAcc: 0, payoutPerUnit: 0 });
                b.seriesIds.push(id);
                _openSeriesIds.push(id);
            }
        }
        emit BoardCreated(boardId, expiry, b.seriesIds);
    }

    // ================================================================ trading

    struct QuoteOut {
        uint256 premiumAssets;
        uint256 feeAssets;
        uint256 sigma;
        int256 delta;
        uint256 vegaTotal; // WAD per 1,00 vol untuk seluruh `size`
        uint256 spotWad;
    }

    /// @notice Kuotasi beli: σ_buy = σ_mark(util setelah trade) × (1 + spread); premi ≥ floor (FR-13, FR-14, FR-23).
    function quoteBuy(uint256 seriesId, uint256 size) public view returns (QuoteOut memory q) {
        Series storage sr = _openSeries(seriesId);
        uint256 s = _requireFresh();
        uint256 t = _years(sr.expiry);
        uint256 sigmaNow = vol.sigmaMark(_util(netVega));
        (, , uint256 vegaUnit) = _price(s, sr.strike, t, sigmaNow, sr.isCall);
        uint256 vegaTotal = vegaUnit * size / WAD;
        uint256 sigmaBuy = vol.sigmaMark(_util(netVega + vegaTotal)) * (WAD + vol.spread()) / WAD;
        (uint256 p, int256 delta, uint256 vegaBuy) = _price(s, sr.strike, t, sigmaBuy, sr.isCall);
        uint256 premiumWad = p * size / WAD;
        uint256 floorWad = uint256(sr.strike) * size / WAD * cfg.minPremiumBps / 10_000;
        if (premiumWad < floorWad) premiumWad = floorWad;
        q.premiumAssets = _ceilAssets(premiumWad);
        q.feeAssets = _ceilAssets(premiumWad * cfg.feeBps / 10_000);
        q.sigma = sigmaBuy;
        q.delta = delta;
        q.vegaTotal = vegaBuy * size / WAD;
        q.spotWad = s;
    }

    /// @notice Kuotasi tutup: σ_close = σ_mark(util setelah tutup) × (1 − spread); proceeds dibulatkan ke bawah.
    function quoteClose(uint256 seriesId, uint256 size) public view returns (uint256 proceedsAssets, uint256 sigmaClose, uint256 spotWad) {
        Series storage sr = _openSeries(seriesId);
        uint256 s = _requireFresh();
        uint256 t = _years(sr.expiry);
        uint256 rel = _vegaRelease(sr, size);
        sigmaClose = vol.sigmaMark(_util(netVega - rel)) * (WAD - vol.spread()) / WAD;
        (uint256 p, , ) = _price(s, sr.strike, t, sigmaClose, sr.isCall);
        proceedsAssets = (p * size / WAD) / assetScale;
        spotWad = s;
    }

    /// @notice Beli `size` unit (WAD) seri; membayar premi + fee dalam aset; mencetak ERC-1155 (FR-21, FR-24, FR-25).
    function buy(uint256 seriesId, uint256 size, uint256 maxPremiumAssets) external nonReentrant returns (uint256 premiumAssets) {
        if (tradingPaused) revert TradingIsPaused();
        if (size < cfg.minSize) revert SizeTooSmall();
        Series storage sr = _openSeries(seriesId);
        QuoteOut memory q = quoteBuy(seriesId, size);
        if (q.premiumAssets + q.feeAssets > maxPremiumAssets) revert SlippageExceeded();
        uint256 capital = _capitalWad();
        uint256 addReserve = uint256(sr.strike) * size / WAD;
        if (reserved + addReserve > capital * cfg.maxUtilBps / 10_000) revert UtilizationExceeded();
        if (netVega + q.vegaTotal > capital * cfg.vegaCapBps / 10_000) revert VegaCapExceeded();
        reserved += addReserve;
        netVega += q.vegaTotal;
        sr.oi += size;
        sr.vegaAcc += q.vegaTotal;
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), q.premiumAssets + q.feeAssets);
        if (q.feeAssets > 0) IERC20(asset()).safeTransfer(treasury, q.feeAssets);
        token.mint(msg.sender, seriesId, size);
        emit Bought(seriesId, msg.sender, size, q.premiumAssets, q.feeAssets, q.sigma, q.spotWad);
        return q.premiumAssets;
    }

    /// @notice Tutup `size` unit sebelum expiry; tidak pernah dijeda (FR-22, FR-33).
    function close(uint256 seriesId, uint256 size, uint256 minProceedsAssets) external nonReentrant returns (uint256 proceedsAssets) {
        Series storage sr = _openSeries(seriesId);
        if (size == 0 || size > sr.oi) revert SizeTooSmall();
        uint256 sigmaClose;
        uint256 s;
        (proceedsAssets, sigmaClose, s) = quoteClose(seriesId, size);
        if (proceedsAssets < minProceedsAssets) revert SlippageExceeded();
        uint256 rel = _vegaRelease(sr, size);
        token.burn(msg.sender, seriesId, size);
        sr.oi -= size;
        sr.vegaAcc -= rel;
        netVega -= rel;
        reserved -= uint256(sr.strike) * size / WAD;
        IERC20(asset()).safeTransfer(msg.sender, proceedsAssets);
        emit Closed(seriesId, msg.sender, size, proceedsAssets, sigmaClose, s);
    }

    // ================================================================ settlement

    /// @notice Permissionless setelah expiry; memakai round Chainlink dengan `updatedAt ≥ expiry` yang masih segar (FR-27..29).
    function settle(uint256 boardId) external nonReentrant {
        Board storage b = _boards[boardId];
        if (b.settled) revert BoardAlreadySettled();
        if (block.timestamp < b.expiry) revert BoardNotExpired();
        OracleLib.Spot memory sp = _spot();
        if (!sp.fresh || sp.updatedAt < b.expiry) revert SettlementNotReady();
        uint256 sT = sp.priceWad;
        uint256 added;
        uint256 released;
        uint256 n = b.seriesIds.length;
        for (uint256 i = 0; i < n; i++) {
            uint256 id = b.seriesIds[i];
            Series storage sr = series[id];
            uint256 k = sr.strike;
            uint256 payout;
            if (sr.isCall) {
                payout = sT > k ? sT - k : 0;
                if (payout > k) payout = k; // cap = 2K → payout maksimum K
            } else {
                payout = k > sT ? k - sT : 0;
            }
            sr.settled = true;
            sr.payoutPerUnit = payout;
            added += sr.oi * payout / WAD;
            released += sr.oi * k / WAD;
            netVega -= Math.min(netVega, sr.vegaAcc);
            sr.vegaAcc = 0;
            _removeOpen(id);
        }
        escrowedPayouts += added;
        reserved -= released;
        b.settled = true;
        b.settlementPrice = sT;
        emit Settled(boardId, sT, added, released);
        uint256 bounty = cfg.settleBounty;
        if (bounty > 0 && freeLiquidity() >= bounty) IERC20(asset()).safeTransfer(msg.sender, bounty);
    }

    /// @notice Klaim payout seri yang sudah settle; membakar token; tidak pernah bisa dijeda (FR-30).
    function claim(uint256 seriesId, uint256 amount) external nonReentrant returns (uint256 payoutAssets) {
        Series storage sr = series[seriesId];
        if (sr.expiry == 0) revert SeriesUnknown();
        if (!sr.settled) revert NotSettled();
        token.burn(msg.sender, seriesId, amount);
        sr.oi -= amount; // INV-4: totalSupply(id) == oi juga setelah settle
        uint256 payoutWad = amount * sr.payoutPerUnit / WAD;
        escrowedPayouts -= payoutWad;
        payoutAssets = payoutWad / assetScale;
        if (payoutAssets > 0) IERC20(asset()).safeTransfer(msg.sender, payoutAssets);
        emit Claimed(seriesId, msg.sender, amount, payoutAssets);
    }

    // ================================================================ admin

    /// @notice Hanya `buy` dan `createBoard` yang dijeda; `close`, `claim`, `withdraw`, `settle` tidak pernah (FR-33).
    function pauseTrading(bool paused) external onlyOwner {
        tradingPaused = paused;
        emit TradingPaused(paused);
    }

    function setConfig(Config calldata c) external onlyOwner {
        _setConfig(c);
    }

    function setTreasury(address t) external onlyOwner {
        treasury = t;
        emit TreasuryUpdated(t);
    }

    // ================================================================ views

    function boardCount() external view returns (uint256) {
        return _boards.length;
    }

    function board(uint256 boardId) external view returns (uint64 expiry, bool settled, uint256 settlementPrice, uint256[] memory seriesIds) {
        Board storage b = _boards[boardId];
        return (b.expiry, b.settled, b.settlementPrice, b.seriesIds);
    }

    function openSeriesIds() external view returns (uint256[] memory) {
        return _openSeriesIds;
    }

    /// @notice (spot WAD, segar?) — untuk UI/demo.
    function spot() external view returns (uint256 priceWad, bool fresh) {
        OracleLib.Spot memory sp = _spot();
        return (sp.priceWad, sp.fresh);
    }

    /// @notice σ_mark saat ini (mid, tanpa spread).
    function sigmaMarkNow() external view returns (uint256) {
        return vol.sigmaMark(_util(netVega));
    }

    // ================================================================ internal

    function _setConfig(Config memory c) internal {
        if (c.feeBps > 1000) revert ConfigOutOfBounds(0);
        if (c.maxUtilBps == 0 || c.maxUtilBps > 9000) revert ConfigOutOfBounds(1);
        if (c.vegaCapBps == 0 || c.vegaCapBps > 5000) revert ConfigOutOfBounds(2);
        if (c.minPremiumBps > 100) revert ConfigOutOfBounds(3);
        if (c.heartbeat == 0) revert ConfigOutOfBounds(4);
        if (c.staleMult == 0) revert ConfigOutOfBounds(5);
        if (c.maxOpenSeries == 0 || c.maxOpenSeries > 32) revert ConfigOutOfBounds(6);
        if (c.tenorMax == 0 || c.tenorMax > 90 days) revert ConfigOutOfBounds(7);
        if (c.minSize == 0) revert ConfigOutOfBounds(8);
        cfg = c;
        emit ConfigUpdated(c);
    }

    function _spot() internal view returns (OracleLib.Spot memory) {
        return OracleLib.read(feed, sequencerFeed, priceScale, cfg.heartbeat, cfg.staleMult, cfg.sequencerGrace);
    }

    function _requireFresh() internal view returns (uint256 priceWad) {
        OracleLib.Spot memory sp = _spot();
        if (!sp.fresh) revert OracleStale();
        return sp.priceWad;
    }

    function _openSeries(uint256 id) internal view returns (Series storage sr) {
        sr = series[id];
        if (sr.expiry == 0) revert SeriesUnknown();
        if (sr.settled) revert SeriesSettled();
        if (sr.expiry <= block.timestamp + T_MIN) revert SeriesExpired();
    }

    /// @dev T dalam tahun WAD; dijamin ≥ T_MIN oleh _openSeries.
    function _years(uint64 expiry) internal view returns (uint256) {
        return (uint256(expiry) - block.timestamp) * WAD / SECONDS_PER_YEAR;
    }

    /// @dev cash − escrow (WAD) — basis utilisasi & vega cap; sengaja tanpa MtM agar tidak rekursif.
    function _capitalWad() internal view returns (uint256) {
        uint256 cash = IERC20(asset()).balanceOf(address(this)) * assetScale;
        return cash > escrowedPayouts ? cash - escrowedPayouts : 0;
    }

    /// @dev util_vega = clamp(netVega / vegaCap, 0, 1); pool kosong → 1 (harga maksimal, dan buy tetap ditolak oleh cap).
    function _util(uint256 vega) internal view returns (uint256) {
        uint256 cap = _capitalWad() * cfg.vegaCapBps / 10_000;
        if (cap == 0) return WAD;
        uint256 u = vega * WAD / cap;
        return u > WAD ? WAD : u;
    }

    /// @dev Harga & Greeks satu unit: call = spread ter-cap C(K) − C(2K); put = BS biasa.
    function _price(uint256 s, uint256 k, uint256 t, uint256 sigma, bool isCall) internal view returns (uint256 p, int256 delta, uint256 vega) {
        if (isCall) {
            int256 v;
            (p, delta, v) = math.cappedCall(s, k, k * CAP_MULT / WAD, t, sigma, rWad);
            vega = v > 0 ? uint256(v) : 0;
        } else {
            (p, delta, , vega, ) = math.quote(s, k, t, sigma, rWad, false);
        }
    }

    /// @dev Pelepasan vega proporsional terhadap OI yang ditutup.
    function _vegaRelease(Series storage sr, uint256 size) internal view returns (uint256) {
        if (sr.oi == 0) return 0;
        uint256 rel = sr.vegaAcc * size / sr.oi;
        return Math.min(rel, netVega);
    }

    /// @dev Kewajiban (WAD): MtM via satu panggilan markPortfolio bila segar; `reserved` bila stale / math gagal (FR-36).
    function _liabilityWad(uint256 capitalWad) internal view returns (uint256) {
        uint256 n = _openSeriesIds.length;
        if (n == 0) return 0;
        OracleLib.Spot memory sp = _spot();
        if (!sp.fresh) return reserved;
        uint256[] memory k = new uint256[](n);
        uint256[] memory t = new uint256[](n);
        bool[] memory isCall = new bool[](n);
        uint256[] memory oi = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            Series storage sr = series[_openSeriesIds[i]];
            k[i] = sr.strike;
            uint256 secs = sr.expiry > block.timestamp ? sr.expiry - block.timestamp : 0;
            if (secs < T_MIN) secs = T_MIN; // seri di ambang expiry ≈ intrinsik; hindari revert domain
            t[i] = secs * WAD / SECONDS_PER_YEAR;
            isCall[i] = sr.isCall;
            oi[i] = sr.oi;
        }
        uint256 cap = capitalWad * cfg.vegaCapBps / 10_000;
        uint256 util = cap == 0 ? WAD : Math.min(netVega * WAD / cap, WAD);
        uint256 sigma = vol.sigmaMark(util);
        try math.markPortfolio(sp.priceWad, rWad, sigma, CAP_MULT, k, t, isCall, oi) returns (uint256 mid, int256) {
            return mid;
        } catch {
            return reserved;
        }
    }

    function _removeOpen(uint256 id) internal {
        uint256 n = _openSeriesIds.length;
        for (uint256 i = 0; i < n; i++) {
            if (_openSeriesIds[i] == id) {
                _openSeriesIds[i] = _openSeriesIds[n - 1];
                _openSeriesIds.pop();
                return;
            }
        }
    }

    function _ceilAssets(uint256 wad) internal view returns (uint256) {
        return (wad + assetScale - 1) / assetScale;
    }
}
```

- [ ] **Step 4: Tulis `contracts/src/pool/EquinoxFactory.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { EquinoxPool } from "./EquinoxPool.sol";
import { EquinoxOptionToken } from "./EquinoxOptionToken.sol";
import { EquinoxVolEngine } from "./EquinoxVolEngine.sol";

/// @title PoolDeployer — hanya `new EquinoxPool`. Dipisah agar initcode pool (~18 KB) tidak menumpuk di runtime factory (batas 24 KB).
contract PoolDeployer {
    address public immutable factory;

    error OnlyFactory();

    constructor(address factory_) {
        factory = factory_;
    }

    function deploy(EquinoxPool.Deploy calldata d, address token, address vol) external returns (address) {
        if (msg.sender != factory) revert OnlyFactory();
        return address(new EquinoxPool(d, token, vol));
    }
}

/// @title EquinoxFactory — men-deploy vol engine + token ERC-1155, lalu pool lewat PoolDeployer, mengikat token, mencatat (§8.6).
/// @notice Demo memanggilnya dua kali dengan `math` berbeda: kontrol Solidity (Pool A) dan Stylus (Pool B).
contract EquinoxFactory {
    PoolDeployer public immutable poolDeployer;
    address[] public pools;

    event PoolCreated(address indexed pool, address token, address vol, address indexed math, address usdg, address feed);

    constructor() {
        poolDeployer = new PoolDeployer(address(this));
    }

    function createPool(EquinoxPool.Deploy calldata d) external returns (address pool) {
        EquinoxVolEngine vol = new EquinoxVolEngine(d.owner, d.feed, d.math, d.vol, d.sigmaSeed);
        EquinoxOptionToken token = new EquinoxOptionToken();
        pool = poolDeployer.deploy(d, address(token), address(vol));
        token.bindPool(pool);
        pools.push(pool);
        emit PoolCreated(pool, address(token), address(vol), d.math, d.usdg, d.feed);
    }

    function poolCount() external view returns (uint256) {
        return pools.length;
    }
}
```

- [ ] **Step 5: Jalankan — 16 lolos, dan ukuran kontrak < 24.576 byte**

Run: `cd contracts && forge test --match-contract EquinoxPoolTest 2>&1 | grep -E "^\[|Suite result"`
Expected: 16 × `[PASS]` (`test_deposit_withdraw_no_positions`, `test_buy_premium_matches_formula`, `test_buy_updates_reserved_oi_supply_netVega`, `test_wash_trade_is_not_free`, `test_scenario1_settle_claim_nav`, `test_scenario2_solvency_extreme`, `test_deep_otm_floor`, `test_cap_payout_same_beyond_cap`, `test_settlement_round_rules`, `test_oracle_stale_paths`, `test_sequencer_down_and_grace`, `test_pause_semantics`, `test_vega_cap`, `test_createBoard_validation`, `test_min_size_and_unknown_series`, `test_nav_marks_to_market`); `Suite result: ok. 16 passed`.

Run: `cd contracts && forge build --sizes 2>&1 | grep -E "Equinox|PoolDeployer"`
Expected (±5 %): `EquinoxFactory` ≈ 13.806 B, `EquinoxOptionToken` ≈ 5.227, `EquinoxPool` ≈ 16.374, `EquinoxVolEngine` ≈ 4.714, `PoolDeployer` ≈ 21.325 — **semua Runtime Size < 24.576** (kolom "Runtime Margin" positif). Jika `PoolDeployer` atau `EquinoxFactory` melebihi batas, berhenti dan laporkan: jangan menaikkan `optimizer_runs` atau menghapus fungsi.

Run: `cd contracts && forge test 2>&1 | grep "Suite result"`
Expected: 5 suite `ok` (4 + 3 + 6 + 12 + 16 = 41 test).

- [ ] **Step 6: Commit**

```bash
cd ..
git add contracts/src/pool/EquinoxPool.sol contracts/src/pool/EquinoxFactory.sol contracts/test/PoolFixture.sol contracts/test/EquinoxPool.t.sol
git commit -m "feat(contracts): EquinoxPool (ERC-4626 USDG vault, on-chain priced options, hard solvency, MtM NAV) and two-level factory"
```

### Task 6: Invariant test (INV-1, INV-2, INV-4, INV-10, INV-11) + coverage ≥ 90 %

**Files:**
- Test: `contracts/test/EquinoxPool.invariants.t.sol`

**Interfaces:**
- Consumes: `PoolFixture` (Task 5). Handler `PoolHandler` mengacak deposit/withdraw/buy/close/tickTime/settle/claim; revert yang sah diabaikan (`try/catch`, `fail_on_revert = false`).

- [ ] **Step 1: Tulis test — `contracts/test/EquinoxPool.invariants.t.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { PoolFixture } from "./PoolFixture.sol";
import { EquinoxPool } from "../src/pool/EquinoxPool.sol";
import { MockFeed } from "../src/mocks/MockFeed.sol";
import { MockUSDG } from "../src/mocks/MockUSDG.sol";
import { Test } from "forge-std/Test.sol";

/// @notice Handler: aksi acak LP/trader/keeper + pergerakan harga & waktu. Revert yang sah (cap, stale, slippage) diabaikan.
contract PoolHandler is Test {
    EquinoxPool public pool;
    MockFeed public feed;
    MockUSDG public usdg;
    address public lp;
    address public trader;
    uint256[] public ids;
    uint256 public boards;
    int256 public price8 = 4000e8;

    constructor(EquinoxPool p, MockFeed f, MockUSDG u, address lp_, address trader_, uint256[] memory ids_, uint256 boards_) {
        pool = p;
        feed = f;
        usdg = u;
        lp = lp_;
        trader = trader_;
        ids = ids_;
        boards = boards_;
    }

    function deposit(uint256 amount) external {
        amount = bound(amount, 1e6, 500_000e6);
        vm.prank(lp);
        try pool.deposit(amount, lp) {} catch {}
    }

    function withdraw(uint256 amount) external {
        uint256 maxW = pool.maxWithdraw(lp);
        if (maxW == 0) return;
        amount = bound(amount, 1, maxW);
        vm.prank(lp);
        try pool.withdraw(amount, lp, lp) {} catch {}
    }

    function buy(uint256 idx, uint256 size) external {
        uint256 id = ids[idx % ids.length];
        size = bound(size, 1e16, 20e18);
        vm.prank(trader);
        try pool.buy(id, size, type(uint256).max) {} catch {}
    }

    function close(uint256 idx, uint256 size) external {
        uint256 id = ids[idx % ids.length];
        uint256 bal = pool.token().balanceOf(trader, id);
        if (bal == 0) return;
        size = bound(size, 1, bal);
        vm.prank(trader);
        try pool.close(id, size, 0) {} catch {}
    }

    /// Majukan waktu ≤ 1 hari dan gerakkan harga ±≤ 5%, lalu round baru + poke.
    function tickTime(uint256 dt, uint256 move) external {
        dt = bound(dt, 60, 1 days);
        move = bound(move, 0, 1000); // 0..1000 → −5%..+5%
        vm.warp(block.timestamp + dt);
        int256 delta = int256(move) - 500;
        price8 = price8 + price8 * delta / 10_000;
        if (price8 < 100e8) price8 = 100e8;
        feed.set(price8, block.timestamp);
        pool.vol().poke();
    }

    function settle(uint256 b) external {
        b = b % boards;
        try pool.settle(b) {} catch {}
    }

    function claim(uint256 idx) external {
        uint256 id = ids[idx % ids.length];
        uint256 bal = pool.token().balanceOf(trader, id);
        if (bal == 0) return;
        vm.prank(trader);
        try pool.claim(id, bal) {} catch {}
    }
}

/// @notice INV-1, INV-2, INV-4, INV-10, INV-11 di bawah urutan aksi acak (§12).
contract EquinoxPoolInvariants is PoolFixture {
    PoolHandler internal handler;
    uint256[] internal allIds;

    function setUp() public override {
        super.setUp();
        lpDeposit(500_000e6);
        // dua board: 7 hari (3800/4000/4200) dan 14 hari (3600/4400)
        (, , uint256[] memory a) = listBoard7d();
        uint128[] memory ks = new uint128[](2);
        ks[0] = 3600e18;
        ks[1] = 4400e18;
        uint256 b1 = pool.createBoard(uint64(T0 + 2 * WEEK), ks);
        (, , , uint256[] memory b) = pool.board(b1);
        for (uint256 i = 0; i < a.length; i++) allIds.push(a[i]);
        for (uint256 i = 0; i < b.length; i++) allIds.push(b[i]);
        handler = new PoolHandler(pool, feed, usdg, lp, trader, allIds, 2);
        targetContract(address(handler));
    }

    function _cashWad() internal view returns (uint256) {
        return usdg.balanceOf(address(pool)) * 1e12;
    }

    /// INV-1: reserved ≤ cash − escrow.
    function invariant_solvency() public view {
        assertLe(pool.reserved() + pool.escrowedPayouts(), _cashWad());
    }

    /// INV-2: reserved == Σ OI × K seri terbuka.
    function invariant_reserved_equals_sum_oi_k() public view {
        uint256[] memory open = pool.openSeriesIds();
        uint256 sum;
        for (uint256 i = 0; i < open.length; i++) {
            (, , uint128 k, , , uint256 oi, , ) = pool.series(open[i]);
            sum += oi * uint256(k) / 1e18;
        }
        assertEq(pool.reserved(), sum);
    }

    /// INV-4: totalSupply(id) == oi untuk setiap seri (terbuka maupun settle).
    function invariant_supply_equals_oi() public view {
        for (uint256 i = 0; i < allIds.length; i++) {
            (, , , , , uint256 oi, , ) = pool.series(allIds[i]);
            assertEq(token.totalSupply(allIds[i]), oi);
        }
    }

    /// INV-11: escrow == Σ oi × payout seri settle, dan ≤ cash.
    function invariant_escrow_matches_settled() public view {
        uint256 sum;
        for (uint256 i = 0; i < allIds.length; i++) {
            (, , , , bool settled, uint256 oi, , uint256 payout) = pool.series(allIds[i]);
            if (settled) sum += oi * payout / 1e18;
        }
        assertEq(pool.escrowedPayouts(), sum);
        assertLe(sum, _cashWad());
    }

    /// INV-10: σ_mark ∈ [σ_min, σ_max].
    function invariant_sigma_bounds() public view {
        uint256 s = pool.sigmaMarkNow();
        assertGe(s, 0.2e18);
        assertLe(s, 3e18);
    }
}
```

- [ ] **Step 2: Jalankan (konfigurasi default: 32 runs × 64 depth)**

Run: `cd contracts && forge test --match-contract EquinoxPoolInvariants 2>&1 | grep -E "^\[|Suite result"`
Expected: 5 × `[PASS] invariant_...` (`runs: 32, calls: 2048, reverts: 0`), `Suite result: ok. 5 passed`. (`reverts: 0` karena handler menelan revert; `calls` = runs × depth.)

- [ ] **Step 3: Run panjang sekali (target PRD §12 ≥ 50k panggilan) dan coverage**

Run: `cd contracts && FOUNDRY_INVARIANT_RUNS=256 FOUNDRY_INVARIANT_DEPTH=200 forge test --match-contract EquinoxPoolInvariants 2>&1 | grep -E "^\[|Suite result"`
Expected: 5 × `[PASS]` dengan `calls: 51200`.

Run: `cd contracts && forge coverage --ir-minimum --no-match-coverage "(lib/|mocks/|test/)" --report summary 2>&1 | grep -E "^\| src/(pool|oracle)/|^\| Total"`
Expected (±2 pp): `OracleLib` 100 %, `EquinoxOptionToken` 100 %, `EquinoxVolEngine` ≈ 98,6 %, `EquinoxPool` ≈ 93,8 %, `EquinoxFactory` ≈ 87,5 % (baris `poolCount`/`pools` tidak dipanggil), Total ≈ 95 % lines. Catat tabelnya di laporan.

- [ ] **Step 4: Commit**

```bash
cd ..
git add contracts/test/EquinoxPool.invariants.t.sol
git commit -m "test(contracts): invariant suite for solvency, reserved bookkeeping, supply==OI, escrow and sigma bounds"
```

### Task 7: L4 — dua pool identik (kontrol vs Stylus) di devnode, gas `buy`/`close`/`deposit` (§13 baris 7–8)

**Files:**
- Create: `contracts/src/mocks/PoolE2EDeployer.sol`, `tools/e2e/pool-e2e.sh`

**Interfaces:**
- Consumes: `deployments/devnode.json` (dari `tools/devnode/deploy.sh`, Plan 1), `EquinoxFactory`, mock.
- Produces: `PoolE2EDeployer(owner, mathA, mathB)` — satu `forge create` men-deploy mock + factory + Pool A (kontrol) + Pool B (Stylus) dan mint 4 juta USDG ke owner; view `nextExpiry(minTenor)`, `tick(price8)`. Skrip mencetak `quoteBuy identik`, 4 × `OK` (NAV, σ_mark, reserved, cash) dan tabel gas; exit ≠ 0 bila ada `BEDA`.

- [ ] **Step 1: Tulis deployer dan skrip**

`contracts/src/mocks/PoolE2EDeployer.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { EquinoxPool } from "../pool/EquinoxPool.sol";
import { EquinoxFactory } from "../pool/EquinoxFactory.sol";
import { EquinoxVolEngine } from "../pool/EquinoxVolEngine.sol";
import { MockUSDG } from "./MockUSDG.sol";
import { MockFeed } from "./MockFeed.sol";
import { MockSequencerFeed } from "./MockSequencerFeed.sol";

/// @title PoolE2EDeployer — satu `forge create` men-deploy mock + factory + dua pool identik (A = kontrol, B = Stylus).
/// @notice Dipakai tools/e2e/pool-e2e.sh di chain sungguhan (devnode/Sepolia). Tidak ada panggilan ke `math` di jalur deploy,
///         sehingga simulasi Foundry tidak menyentuh WASM (Foundry tidak bisa mengeksekusi program Stylus, §9.7).
contract PoolE2EDeployer {
    MockUSDG public immutable usdg;
    MockFeed public immutable feed;
    MockSequencerFeed public immutable seq;
    EquinoxFactory public immutable factory;
    EquinoxPool public immutable poolA;
    EquinoxPool public immutable poolB;

    constructor(address owner, address mathA, address mathB) {
        usdg = new MockUSDG();
        feed = new MockFeed(8);
        seq = new MockSequencerFeed();
        feed.set(4000e8, block.timestamp);
        seq.set(0, block.timestamp - 2 hours);
        factory = new EquinoxFactory();
        poolA = EquinoxPool(factory.createPool(_params(owner, mathA, "Equinox LP (control)", "eqA")));
        poolB = EquinoxPool(factory.createPool(_params(owner, mathB, "Equinox LP (Stylus)", "eqB")));
        usdg.mint(owner, 4_000_000e6);
    }

    /// @notice Round Chainlink baru "sekarang" (harga 8 desimal) — untuk demo/keeper.
    function tick(int256 price8) external {
        feed.set(price8, block.timestamp);
    }

    /// @notice Expiry grid berikutnya (Jumat 08:00 UTC) yang ≥ now + minTenor.
    function nextExpiry(uint256 minTenor) external view returns (uint64) {
        return uint64(((block.timestamp + minTenor - 115_200) / 604_800 + 1) * 604_800 + 115_200);
    }

    function _params(address owner, address math, string memory name, string memory symbol) internal view returns (EquinoxPool.Deploy memory d) {
        d.owner = owner;
        d.usdg = address(usdg);
        d.feed = address(feed);
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

`tools/e2e/pool-e2e.sh`:
```bash
#!/usr/bin/env bash
# L4 pool: dua pool identik (A = kontrol Solidity, B = Stylus) di chain sungguhan. Premi, proceeds, NAV, σ harus IDENTIK;
# gas `buy` dan `deposit` (dengan seri terbuka) dicatat untuk §13 baris 7–8. Tanpa forge script (Foundry tidak bisa eksekusi WASM).
# Pakai: tools/e2e/pool-e2e.sh deployments/<name>.json <private_key>
set -euo pipefail
DEP=$1; PK=$2
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RPC=$(jq -r .rpc "$DEP"); MATH_B=$(jq -r .blackScholesStylus "$DEP"); MATH_A=$(jq -r .blackScholesSol "$DEP")
ME=$(cast wallet address --private-key "$PK")
cd "$ROOT/contracts"
DEPLOYER=$(forge create --rpc-url "$RPC" --private-key "$PK" --broadcast src/mocks/PoolE2EDeployer.sol:PoolE2EDeployer --constructor-args "$ME" "$MATH_A" "$MATH_B" | grep "Deployed to" | awk '{print $3}')
[ -n "$DEPLOYER" ] || { echo "deploy gagal"; exit 1; }
USDG=$(cast call --rpc-url "$RPC" "$DEPLOYER" "usdg()(address)")
A=$(cast call --rpc-url "$RPC" "$DEPLOYER" "poolA()(address)")
B=$(cast call --rpc-url "$RPC" "$DEPLOYER" "poolB()(address)")
EXPIRY=$(cast call --rpc-url "$RPC" "$DEPLOYER" "nextExpiry(uint256)(uint64)" 604800 | awk '{print $1}')
echo "deployer=$DEPLOYER usdg=$USDG poolA=$A poolB=$B expiry=$EXPIRY"
MAX=115792089237316195423570985008687907853269984665640564039457584007913129639935
send() { # target sig args... → gasUsed
  cast send --rpc-url "$RPC" --private-key "$PK" "$@" 2>&1 | awk '/^gasUsed[[:space:]]/ {print $2}'
}
send "$USDG" "approve(address,uint256)" "$A" "$MAX" >/dev/null
send "$USDG" "approve(address,uint256)" "$B" "$MAX" >/dev/null
send "$A" "deposit(uint256,address)" 1000000000000 "$ME" >/dev/null
send "$B" "deposit(uint256,address)" 1000000000000 "$ME" >/dev/null
STRIKES="[3800000000000000000000,4000000000000000000000,4200000000000000000000]"
send "$A" "createBoard(uint64,uint128[])" "$EXPIRY" "$STRIKES" >/dev/null
send "$B" "createBoard(uint64,uint128[])" "$EXPIRY" "$STRIKES" >/dev/null
TOK_A=$(cast call --rpc-url "$RPC" "$A" "token()(address)"); TOK_B=$(cast call --rpc-url "$RPC" "$B" "token()(address)")
ID_A=$(cast call --rpc-url "$RPC" "$TOK_A" "seriesId(address,uint64,uint128,bool)(uint256)" "$A" "$EXPIRY" 4200000000000000000000 true | awk '{print $1}')
ID_B=$(cast call --rpc-url "$RPC" "$TOK_B" "seriesId(address,uint64,uint128,bool)(uint256)" "$B" "$EXPIRY" 4200000000000000000000 true | awk '{print $1}')
# kuotasi harus identik sebelum trade
QA=$(cast call --rpc-url "$RPC" "$A" "quoteBuy(uint256,uint256)((uint256,uint256,uint256,int256,uint256,uint256))" "$ID_A" 10000000000000000000)
QB=$(cast call --rpc-url "$RPC" "$B" "quoteBuy(uint256,uint256)((uint256,uint256,uint256,int256,uint256,uint256))" "$ID_B" 10000000000000000000)
[ "$QA" == "$QB" ] || { echo "BEDA quoteBuy: A=$QA B=$QB"; exit 1; }
echo "quoteBuy identik: $QA"
G_BUY_A=$(send "$A" "buy(uint256,uint256,uint256)" "$ID_A" 10000000000000000000 "$MAX")
G_BUY_B=$(send "$B" "buy(uint256,uint256,uint256)" "$ID_B" 10000000000000000000 "$MAX")
G_CLOSE_A=$(send "$A" "close(uint256,uint256,uint256)" "$ID_A" 5000000000000000000 0)
G_CLOSE_B=$(send "$B" "close(uint256,uint256,uint256)" "$ID_B" 5000000000000000000 0)
G_DEP_A=$(send "$A" "deposit(uint256,address)" 10000000000 "$ME")   # NAV MtM dengan seri terbuka
G_DEP_B=$(send "$B" "deposit(uint256,address)" 10000000000 "$ME")
NAV_A=$(cast call --rpc-url "$RPC" "$A" "totalAssets()(uint256)" | awk '{print $1}'); NAV_B=$(cast call --rpc-url "$RPC" "$B" "totalAssets()(uint256)" | awk '{print $1}')
SG_A=$(cast call --rpc-url "$RPC" "$A" "sigmaMarkNow()(uint256)" | awk '{print $1}'); SG_B=$(cast call --rpc-url "$RPC" "$B" "sigmaMarkNow()(uint256)" | awk '{print $1}')
RES_A=$(cast call --rpc-url "$RPC" "$A" "reserved()(uint256)" | awk '{print $1}'); RES_B=$(cast call --rpc-url "$RPC" "$B" "reserved()(uint256)" | awk '{print $1}')
BAL_A=$(cast call --rpc-url "$RPC" "$USDG" "balanceOf(address)(uint256)" "$A" | awk '{print $1}'); BAL_B=$(cast call --rpc-url "$RPC" "$USDG" "balanceOf(address)(uint256)" "$B" | awk '{print $1}')
fail=0
chk() { if [ "$2" == "$3" ]; then echo "OK   $1 = $2"; else echo "BEDA $1: A=$2 B=$3"; fail=1; fi; }
chk NAV "$NAV_A" "$NAV_B"; chk sigmaMark "$SG_A" "$SG_B"; chk reserved "$RES_A" "$RES_B"; chk poolCash "$BAL_A" "$BAL_B"
echo
echo "| Operasi (pool, on-chain) | Gas A (kontrol Solidity) | Gas B (Stylus) | Rasio |"
echo "|---|---|---|---|"
printf "| buy 10 C4200 (ERC-20 + ERC-1155 + 3 panggilan math) | %s | %s | %.2fx |\n" "$G_BUY_A" "$G_BUY_B" "$(echo "scale=2; $G_BUY_A/$G_BUY_B" | bc)"
printf "| close 5 | %s | %s | %.2fx |\n" "$G_CLOSE_A" "$G_CLOSE_B" "$(echo "scale=2; $G_CLOSE_A/$G_CLOSE_B" | bc)"
printf "| deposit dengan 6 seri terbuka (NAV markPortfolio) | %s | %s | %.2fx |\n" "$G_DEP_A" "$G_DEP_B" "$(echo "scale=2; $G_DEP_A/$G_DEP_B" | bc)"
exit $fail
```

- [ ] **Step 2: Ukuran initcode deployer < 49.152 byte**

Run: `cd contracts && forge build --sizes 2>&1 | grep PoolE2EDeployer`
Expected: Runtime ≈ 896 B, Initcode ≈ 42.198 B (Initcode Margin positif).

- [ ] **Step 3: Devnode + deploy Plan 1 + jalankan E2E** (devnode blocking → jalankan terlepas, tunggu `devnode siap`)

```bash
cd /home/mdlog/Project-MDlabs/Hackquest/arbitrum-sg/Equinox
chmod +x tools/e2e/pool-e2e.sh
setsid nohup tools/devnode/up.sh > /tmp/devnode-plan2.log 2>&1 &
until grep -q "devnode siap" /tmp/devnode-plan2.log; do sleep 5; done; grep "devnode siap" /tmp/devnode-plan2.log
tools/devnode/deploy.sh devnode http://127.0.0.1:8547 0xb6b15c8cb491557369f3c7d2c287b053eb229daa9c22138887752191c9520659
tools/bench/onchain-check.sh deployments/devnode.json | grep -c OK          # expected: 20
tools/e2e/pool-e2e.sh deployments/devnode.json 0xb6b15c8cb491557369f3c7d2c287b053eb229daa9c22138887752191c9520659; echo "exit=$?"
docker rm -f nitro-dev
```
Expected (angka gas ±3 %):
```
quoteBuy identik: (1240995203 [1.24e9], 37229857 [3.722e7], 675462337773664946 [6.754e17], 375455015372749460 [3.754e17], 2873673839353472627410 [2.873e21], 4000000000000000000000 [4e21])
OK   NAV = 1010152684349
OK   sigmaMark = 637894965169951562
OK   reserved = 21000000000000000000000
OK   poolCash = 1010719427911

| Operasi (pool, on-chain) | Gas A (kontrol Solidity) | Gas B (Stylus) | Rasio |
|---|---|---|---|
| buy 10 C4200 (ERC-20 + ERC-1155 + 3 panggilan math) | 375934 | 353329 | 1.06x |
| close 5 | 187171 | 188983 | 0.99x |
| deposit dengan 6 seri terbuka (NAV markPortfolio) | 208635 | 205523 | 1.01x |
exit=0
```
Catatan: premi/NAV bergantung pada jarak ke expiry grid berikutnya (≈ 7–14 hari dari waktu chain) — nilai persisnya boleh berbeda dari contoh, tetapi A dan B **harus identik** dan exit harus 0. Jika `forge create` deployer revert dengan `data: "0x"` → ada kontrak > 24 KB (cek `forge build --sizes`).

- [ ] **Step 4: Commit** (`deployments/devnode.json` tetap git-ignored)

```bash
git add contracts/src/mocks/PoolE2EDeployer.sol tools/e2e/pool-e2e.sh
git commit -m "test(e2e): two identical pools (Solidity control vs Stylus) on a live node via cast; pool gas rows"
```

### Task 8: Dokumentasi — BENCHMARK (baris pool), PRD v1.3, README status

**Files:**
- Modify: `docs/BENCHMARK.md`, `prd-arsitektur.md`, `README.md`

**Interfaces:**
- Consumes: keluaran Task 6 (coverage) dan Task 7 (tabel gas pool, angka aktual dari run Anda).

- [ ] **Step 1: `docs/BENCHMARK.md` — tambahkan seksi pool** (setelah tabel utama, sebelum seksi micro-benchmark), dengan angka dari run Task 7 Anda:

```markdown
## Transaksi pool end-to-end (devnode, dua pool identik, `tools/e2e/pool-e2e.sh`)

Pool A memakai `BlackScholesSol` (kontrol), Pool B memakai program Stylus; kuotasi, NAV, σ_mark, cadangan, dan kas keduanya identik.

| Operasi | Gas A (kontrol Solidity) | Gas B (Stylus) | Rasio |
|---|---|---|---|
| `buy` 10 C 4.200 (ERC-20 + ERC-1155 + 3 panggilan math) | <angka A> | <angka B> | <rasio>× |
| `close` 5 | <angka A> | <angka B> | <rasio>× |
| `deposit` dengan 6 seri terbuka (NAV via `markPortfolio`) | <angka A> | <angka B> | <rasio>× |

Seperti diprediksi PRD §13: transaksi end-to-end didominasi storage EVM, transfer ERC-20/ERC-1155, dan overhead panggilan; keunggulan Stylus pada matematika (2,6–2,9× untuk solver/MtM) hampir tidak terlihat di tingkat transaksi.
```
(Ganti `<angka …>` dengan keluaran skrip; jangan menyalin angka contoh dari rencana.)

- [ ] **Step 2: `prd-arsitektur.md` → v1.3** (hanya empat edit ini)

1. Header: `**Versi:** 1.2 — 19 September 2026 (v1.1 + rekonsiliasi benchmark dengan build repo; §6.6 diselaraskan dengan §9.5)` → `**Versi:** 1.3 — 19 September 2026 (v1.2 + pool terimplementasi: §8.3 bindPool, §8.6 factory dua-level & batas 24 KB, §13 baris pool terukur, §12 coverage)`.
2. §8.3, ganti kalimat `` `totalSupply(id) == OI(id)` selalu (INV-4). Satu token per pool; `pool` immutable. `` menjadi `` `totalSupply(id) == OI(id)` selalu (INV-4), juga setelah settle karena `claim` mengurangi `oi`. Satu token per pool; `pool` diikat sekali lewat `bindPool(address)` oleh deployer-nya (factory) karena alamat pool belum ada saat token dibuat. ``
3. §8.6, ganti paragraf `Men-deploy `EquinoxOptionToken` + `EquinoxVolEngine` + `EquinoxPool` dalam satu transaksi, mengikat `math` secara immutable. Demo memanggilnya dua kali: `math = BlackScholesSol` (Pool A) dan `math = Stylus` (Pool B).` menjadi `Men-deploy `EquinoxVolEngine` + `EquinoxOptionToken`, lalu `EquinoxPool` lewat kontrak `PoolDeployer` terpisah, lalu `token.bindPool(pool)` — semua dalam satu transaksi (`createPool(Deploy)`). Dua level diperlukan karena **batas kode 24.576 byte**: factory yang men-`new` pool langsung berukuran 33,5 KB (initcode pool tertanam di runtime factory); dengan pemisahan, factory 13,8 KB dan `PoolDeployer` 21,3 KB. Test Foundry tidak menegakkan batas ini — chain sungguhan iya (`forge build --sizes` wajib hijau). Demo memanggilnya dua kali: `math = BlackScholesSol` (Pool A) dan `math = Stylus` (Pool B).`
4. §13, ganti paragraf yang diawali `Yang masih harus diukur di Hari 9–10 (butuh pool):` menjadi `Baris pool (`buy`, `close`, `deposit` dengan seri terbuka) sudah diukur di devnode dengan dua pool identik — lihat docs/BENCHMARK.md seksi "Transaksi pool end-to-end": rasio ≈ 1,0–1,06× karena transaksi didominasi storage EVM dan transfer token, bukan matematika. Belum diukur: 32 × `quote` terpisah vs satu `markPortfolio` di dalam pool, dan biaya aktivasi aktual di Sepolia (0,000147 ETH per `cargo stylus check`).`
   Serta di §12, setelah kalimat `Target: **≥ 90% line coverage** ...` tambahkan kalimat: `Tercapai 19 Sep 2026 (Plan 2, `forge coverage --ir-minimum`): EquinoxPool 93,8 %, EquinoxVolEngine 98,6 %, EquinoxOptionToken 100 %, OracleLib 100 %; invariant 5 × 51.200 panggilan.` (isi dengan angka run Anda bila berbeda).

- [ ] **Step 3: `README.md` — baris status pool**

Ganti baris tabel `| Pool contracts: LP vault (ERC-4626), option series (ERC-1155), buy/close, settlement, claims, volatility engine | ⏳ next (Plan 2) |` menjadi `| Pool contracts: LP vault (ERC-4626), option series (ERC-1155), buy/close, settlement, claims, volatility engine, two-level factory | ✅ done — 46 Foundry tests incl. 5 invariants, ≥ 90 % coverage, two identical pools (control vs Stylus) verified on a devnode |`, dan di seksi "Repository layout" tambahkan baris `| `contracts/src/pool/`, `contracts/src/oracle/` | `EquinoxPool` (ERC-4626 vault + options AMM), `EquinoxVolEngine`, `EquinoxOptionToken`, two-level `EquinoxFactory`, `OracleLib`; tests under `contracts/test/` incl. invariants | ` setelah baris `contracts/`, serta di "Getting started" tambahkan setelah langkah 5: `tools/e2e/pool-e2e.sh deployments/devnode.json <dev-key>   # two identical pools, control vs Stylus`. Perbarui juga paragraf pertama "Status": ganti `So today this repository is the **pricing engine and its verification tooling**, not yet a tradable venue.` dengan `The pricing engine and the pool are implemented and verified; a demo, UI and testnet deployment are next (Plan 3).`

- [ ] **Step 4: Verifikasi & commit**

Run: `python3 tools/reference/gen_constants.py /tmp/c.rs /tmp/c.sol && diff /tmp/c.rs stylus/bs-math/src/constants.rs && diff /tmp/c.sol contracts/src/math/BsConstants.sol && python3 tools/reference/gen_vectors.py /tmp/v.rs /tmp/v.sol && diff /tmp/v.rs stylus/bs-math/tests/common/vectors_gen.rs && diff /tmp/v.sol contracts/test/VectorsGen.sol && echo drift-ok && cd contracts && forge test 2>&1 | grep -c "Suite result: ok"`
Expected: `drift-ok` dan `6` (enam suite hijau: OracleLibTest, EquinoxOptionTokenTest, EquinoxVolEngineTest, BlackScholesSolTest, EquinoxPoolTest, EquinoxPoolInvariants).

```bash
cd ..
git add docs/BENCHMARK.md prd-arsitektur.md README.md
git commit -m "docs: pool gas rows, PRD v1.3 (bindPool, two-level factory, 24 KB limit, coverage), README status"
```

---

## Self-review (dilakukan penulis rencana)

**Spec coverage.** FR-11..FR-16 → Task 4 (FR-16 skew κ adalah P1 dan sengaja tidak dibangun); FR-17..FR-20 → Task 5 (FR-20 `minListingDelta` P1, tidak dibangun); FR-21..FR-26 → Task 5 (`buy`/`close`/`quoteBuy`/`quoteClose`, util & vega cap, floor premi, fee); FR-27..FR-31 → Task 5 (`settle`/`claim`, bounty); FR-32..FR-36 → Task 5 (`maxWithdraw`/`maxRedeem`, pause semantics, `math` immutable, pembulatan, NAV konservatif); FR-37 cooldown P1 tidak dibangun. §8.3 → Task 3 (dengan `bindPool`, deviasi dari "pool immutable" yang didokumentasikan di Task 8); §8.4 → Task 5; §8.5 → Task 4; §8.6 → Task 5 (dua-level, deviasi dari satu factory — dijelaskan oleh batas 24 KB); §8.7 Lens sengaja tidak dibangun (P1); §8.8 mock → Task 1/7. INV-1, 2, 4, 10, 11 → Task 6; INV-9, INV-14 → Task 5 (`test_wash_trade_is_not_free`, `test_pause_semantics`); INV-3 → `test_scenario2_solvency_extreme`; INV-13 (versi PRD v1.1: settle tidak menciptakan kewajiban di atas cadangan) → `invariant_solvency` + skenario 2. Skenario §12 #1–#8, #10, #11 → Task 5/4; #9 (solver grid) dan #12 (program belum aktif) milik Plan 1/L4. §13 baris 7–8 → Task 7.

**Deviasi dari PRD (semua tercatat di Task 8):** (1) token `bindPool` alih-alih `pool` immutable; (2) factory dua-level; (3) `netVega` adalah akumulasi vega saat trade per seri (`vegaAcc`), dilepas proporsional saat close dan seluruhnya saat settle — aproksimasi orde pertama yang sudah disebut §6.4; (4) `claim` mengurangi `oi` (memperkuat INV-4); (5) `_liabilityWad` meng-clamp `t` ke 60 s untuk seri di ambang expiry agar MtM tidak jatuh ke fallback konservatif.

**Placeholder scan.** Angka contoh di Task 7 dan Task 8 ditandai "angka dari run Anda"; tidak ada TBD/TODO. Semua berkas kode lengkap dan sudah dieksekusi.

**Type consistency.** `EquinoxPool.Deploy` dipakai identik di `PoolFixture.deployParams`, `PoolE2EDeployer._params`, `EquinoxFactory.createPool(Deploy calldata)` dan `PoolDeployer.deploy(Deploy calldata, address, address)`; `series(id)` getter mengembalikan `(boardId, expiry, strike, isCall, settled, oi, vegaAcc, payoutPerUnit)` — test men-destructure 8 nilai dalam urutan itu; `board(id)` → `(expiry, settled, settlementPrice, seriesIds)`; `QuoteOut` 6 field sesuai `quoteBuy` di skrip E2E (`(uint256,uint256,uint256,int256,uint256,uint256)`); `EquinoxVolEngine.Params` 6 × `uint64` dalam urutan `(lambdaPerDay, vrp, alpha, spread, sigmaMin, sigmaMax)` di semua pemanggil; `ewmaV()` vektor `(varPrev, pPrev, pNow, dt, lambda, varNew)` dibaca sebagai 6 array di test vol engine.

**Dependensi antar-task.** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 (linear; Task 2 dan 3 bisa paralel, Task 4 butuh Task 1).
