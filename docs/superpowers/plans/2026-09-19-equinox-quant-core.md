# Equinox Quant Core (Plan 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun inti kuant Equinox sebagai perangkat lunak yang berjalan dan teruji: pustaka Rust `bs-math` (no_std) + program Stylus `bs-stylus`, kontrol Solidity `BlackScholesSol` yang bit-identik, emulasi Python sebagai spesifikasi eksekusi, deployment ke devnode & Arbitrum Sepolia, dan benchmark gas apples-to-apples — yaitu §5.1, §6, §8.1–8.2, §9, §10.1, §13 (baris matematika), dan V1–V5/V10 §18 dari PRD.

**Architecture:** Satu algoritma, tiga implementasi yang harus bit-identik: (1) `tools/reference/wad_emul.py` — emulasi integer eksak (spesifikasi; menghasilkan konstanta & vektor uji), (2) `stylus/bs-math` — crate Rust murni `I256` WAD (port PRBMath `exp/ln/sqrt` + Cody erfc + BS/Greeks + solver + EWMA + batch MtM) dibungkus `stylus/bs-stylus` (`#[public]`, ABI Solidity), (3) `contracts/src/math/BlackScholesSol.sol` — kontrol Solidity memakai PRBMath v4 asli. Test L1 (cargo, native) dan L3 (Foundry) menuntut kesetaraan eksak dengan vektor; L4 (`cast call` ke devnode/Sepolia) menuntut kesetaraan eksak on-chain; `Bench.sol` mengukur gas kedua implementasi lewat `STATICCALL` yang sama.

**Tech Stack:** Rust 1.92 (target `wasm32-unknown-unknown`), `alloy-primitives` 1.x (`default-features = false`), `stylus-sdk` 0.10.9, `cargo-stylus` 0.10.9, Foundry ≥ 1.5 (`solc` 0.8.28 via-IR), PRBMath v4.1.0, Python 3.12 (stdlib saja), Docker + `nitro-devnode` (`offchainlabs/nitro-node:v3.11.4-7d5ac27`), `jq`, `bc`.

**Spec:** `prd-arsitektur.md` v1.1 (direktori proyek). Rencana ini mengimplementasikan bagian-bagian yang disebut di Goal; pool (§8.3–8.8) adalah Plan 2, demo & submission Plan 3.

**Catatan penting untuk eksekutor:** seluruh kode di rencana ini **sudah dijalankan dan lolos** (19 Sep 2026) dalam spike di luar repo: 21 test Rust, 8 test Foundry, 16/16 cek on-chain, benchmark tereproduksi. Tugas Anda adalah memindahkannya ke repo dengan disiplin TDD (test dulu, lihat gagal, implementasi, lihat lolos, commit) — bukan mendesain ulang. Jika sebuah langkah "expected" tidak terjadi, berhenti dan laporkan; jangan mengubah algoritma.

## Global Constraints

- Direktori proyek = root repo: `/home/mdlog/Project-MDlabs/Hackquest/arbitrum-sg/Equinox` (belum git; Task 1 membuatnya). Semua path di bawah relatif terhadap root itu.
- **Tidak ada floating point** di Rust maupun Solidity (§9.5); Stylus VM tidak mendukung float. `f64` hanya boleh di test Rust untuk pembanding referensi.
- Unit: WAD = 1e18 untuk harga, σ, T (tahun), Φ; `r` WAD boleh negatif; `dt_seconds` integer detik. Pembagian selalu trunc-toward-zero (semantik Solidity `int256`).
- Domain (§6.6, FR-9): `S, K ∈ [1e12, 1e30]` wei; `T ∈ [1902587519025, 1e18]`; `σ ∈ [1e16, 5e18]`; `|r| ≤ 1e18`; di luar → error bertipe `OutOfDomain(uint8 arg)`.
- Solver (FR-6): Newton + bracket + bisection, ≤ 40 iterasi, toleransi `max(target/1e8, S/1e14)`, seed Brenner-Subrahmanyam.
- Ketiga implementasi MUST bit-identik terhadap `tests/common/vectors_gen.rs` / `test/VectorsGen.sol` (INV-12). Toleransi float hanya di `price_vs_float_reference`.
- Versi dipatok: `stylus-sdk = "0.10.9"`, `cargo-stylus` 0.10.9, `alloy-primitives`/`alloy-sol-types` `"1.5.7"` (caret; SDK memaksa ≥ 1.5.7), PRBMath `v4.1.0`, `solc_version = "0.8.28"`, `rust-toolchain` `1.92.0` di `bs-stylus`.
- Nama fungsi ABI Stylus di-camelCase oleh SDK (`norm_cdf` → `normCdf`); semua `cast call` MUST memakai nama camelCase.
- `Stylus.toml` MUST ada di `stylus/bs-stylus` (tanpa `[wasm-opt]` — wasm-opt ditolak aktivasi). Stack WASM MUST 16 KiB (`.cargo/config.toml`), `opt-level = 3`.
- Deployment multi-fragmen butuh ArbOS ≥ 61 (Stylus v3). Devnode resmi lahir di ArbOS 59: `tools/devnode/up.sh` meng-upgrade otomatis.
- Commit: pesan polos, **tanpa** trailer `Co-Authored-By`/atribusi AI apa pun (aturan global pengguna). Satu commit per task.
- Bahasa dokumentasi & komentar: Indonesia; identifier & istilah teknis: Inggris.
- Jangan menaruh file sementara di repo; scratch di `/tmp/claude-1000/.../scratchpad`.

---

### Task 1: Inisialisasi repo, toolchain, dan catatan verifikasi

**Files:**
- Create: `.gitignore`, `docs/VERIFICATION.md`
- Existing (biarkan): `prd-arsitektur.md`, `tools/reference/bs_numbers.py`, `tools/reference/bs_extra.py`

**Interfaces:**
- Produces: repo git di root proyek; `cargo stylus` 0.10.9 terpasang; catatan hasil V1–V5, V10, V15 (§18) untuk dipakai task berikutnya.

- [ ] **Step 1: Inisialisasi git dan `.gitignore`**

```bash
cd /home/mdlog/Project-MDlabs/Hackquest/arbitrum-sg/Equinox
git init -b main
cat > .gitignore <<'EOF'
target/
out/
cache/
node_modules/
.env
__pycache__/
*.pyc
deployments/devnode.json
EOF
```

- [ ] **Step 2: Pasang cargo-stylus 0.10.9 dan verifikasi toolchain**

```bash
cargo install cargo-stylus --version 0.10.9 --locked
cargo stylus --version          # expected: stylus 0.10.9
rustup target add wasm32-unknown-unknown
rustc --version                 # expected: 1.92.x (rust-toolchain.toml bs-stylus akan memakai 1.92.0)
forge --version                 # expected: ≥ 1.5
docker ps >/dev/null && echo docker-ok
jq --version && bc --version | head -1
```

- [ ] **Step 3: Jalankan verifikasi V1–V2 terhadap Sepolia (catat hasilnya)**

```bash
SEP=https://sepolia-rollup.arbitrum.io/rpc
cast chain-id --rpc-url $SEP                                                                        # expected: 421614
cast call --rpc-url $SEP 0x0000000000000000000000000000000000000071 "stylusVersion()(uint16)"      # expected: 3
cast call --rpc-url $SEP 0x0000000000000000000000000000000000000064 "arbOSVersion()(uint64)"       # expected: 116 (ArbOS 61)
cast call --rpc-url $SEP 0x000000000000000000000000000000000000006b "getMaxStylusContractFragments()(uint256)"   # expected: 4
cast call --rpc-url $SEP 0x0000000000000000000000000000000000000071 "expiryDays()(uint16)"         # expected: 365
cast call --rpc-url $SEP 0x0000000000000000000000000000000000000071 "keepaliveDays()(uint16)"      # expected: 31
cast call --rpc-url $SEP 0x0000000000000000000000000000000000000071 "pageGas()(uint16)"            # expected: 1000
```

- [ ] **Step 4: Tulis `docs/VERIFICATION.md`** (baris ⬜ diisi manusia di Hari 1; V5/V10 dikonfirmasi ulang di Task 11/13)

```markdown
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
```

- [ ] **Step 5: Commit**

```bash
git add .gitignore docs/VERIFICATION.md prd-arsitektur.md tools/reference/bs_numbers.py tools/reference/bs_extra.py
git commit -m "chore: init repo, toolchain check, verification record"
```

### Task 2: Emulasi integer eksak (Python) + generator konstanta & vektor

**Files:**
- Create: `tools/reference/wad_emul.py`, `tools/reference/gen_constants.py`, `tools/reference/gen_vectors.py`
- Generate: `stylus/bs-math/src/constants.rs`, `contracts/src/math/BsConstants.sol`, `stylus/bs-math/tests/common/vectors_gen.rs`, `contracts/test/VectorsGen.sol`

**Interfaces:**
- Consumes: `tools/reference/bs_numbers.py` (`bs()` referensi float, sudah ada).
- Produces: fungsi Python `exp_wad, ln_wad, sqrt_wad, norm_cdf_wad, norm_pdf_wad, bs_quote_wad, capped_call_wad, implied_vol_wad, ewma_update_wad` (semantik identik dengan Rust/Solidity) dan empat berkas generated yang menjadi oracle test Task 3–12. Konstanta Rust: `EXP2_TABLE: [u128; 64]`, `CODY_A/B/C/D/P/Q: [i128; N]`, `SQRPI, INV_SQRT2, INV_SQRT_2PI, CODY_THRESH, TWO_PI: i128`. Vektor Rust: `EXP, LN: &[(i128,i128)]`, `SQRT: &[(u128,u128)]`, `PHI, PDF`, `QUOTE: &[(i128,i128,i128,i128,i128,bool,i128,i128,i128,i128,i128)]`, `FLOAT_PRICE`, `CAPPED`, `IV: &[(i128,i128,i128,i128,i128,bool,i128,u8)]`, `EWMA`.

- [ ] **Step 1: Tulis `tools/reference/wad_emul.py`** (emulasi + selftest)

```python
"""Emulasi eksak aritmetika I256/U256 WAD (trunc toward zero) untuk memverifikasi
algoritma yang akan ditransliterasi ke Rust. Referensi float: math.*"""
import math
from decimal import Decimal, getcontext
getcontext().prec = 80

WAD = 10**18
HALF_WAD = WAD // 2
WAD2 = WAD * WAD
LOG2_E = 1_442695040888963407            # PRBMath uLOG2_E
EXP_MAX_INPUT = 133_084258667509499440
EXP_MIN_THRESHOLD = -41_446531673892822322
EXP2_MAX_INPUT = 192 * WAD - 1
EXP2_MIN_THRESHOLD = -59_794705707972522261
U256_MAX = 2**256 - 1

def tdiv(a, b):                      # truncate toward zero (Solidity / Rust semantics)
    q = abs(a) // abs(b)
    return q if (a >= 0) == (b >= 0) else -q
def mul_wad(a, b): return tdiv(a * b, WAD)
def div_wad(a, b): return tdiv(a * WAD, b)

# ---- exp2 constants: C_j = round(2^(2^-(j+1)) * 2^64), j = 0..63 (PRBMath Common.exp2 table) ----
def gen_exp2_table():
    tbl = []
    for j in range(64):
        v = Decimal(2) ** (Decimal(1) / (Decimal(2) ** (j + 1)))
        tbl.append(int((v * (Decimal(2) ** 64)).to_integral_value(rounding="ROUND_HALF_UP")))
    return tbl
EXP2_TABLE = gen_exp2_table()
assert EXP2_TABLE[0] == 0x16A09E667F3BCC909, hex(EXP2_TABLE[0])
assert EXP2_TABLE[1] == 0x1306FE0A31B7152DF, hex(EXP2_TABLE[1])

def exp2_192x64(x):                  # PRBMath Common.exp2 ; x dalam 192.64
    result = 0x800000000000000000000000000000000000000000000000   # 2^191 (0.5 dalam 192.64)
    for j in range(64):
        if x & (1 << (63 - j)):
            result = (result * EXP2_TABLE[j]) >> 64
    result *= WAD
    result >>= (191 - (x >> 64))
    assert result <= U256_MAX
    return result

def exp2_wad(x):                     # PRBMath SD59x18.exp2
    if x < 0:
        if x < EXP2_MIN_THRESHOLD: return 0
        return tdiv(WAD2, exp2_wad(-x))
    if x > EXP2_MAX_INPUT: raise OverflowError("exp2 input")
    x_192x64 = (x << 64) // WAD
    return exp2_192x64(x_192x64)

def exp_wad(x):                      # PRBMath SD59x18.exp
    if x > EXP_MAX_INPUT: raise OverflowError("exp input")
    if x < EXP_MIN_THRESHOLD: return 0
    return exp2_wad(tdiv(x * LOG2_E, WAD))

def msb(x):
    return x.bit_length() - 1

def log2_wad(x):                     # PRBMath SD59x18.log2
    if x <= 0: raise ValueError("log2 domain")
    if x >= WAD: sign = 1
    else: sign = -1; x = WAD2 // x
    n = msb(x // WAD)
    result = n * WAD
    y = x >> n
    if y == WAD: return result * sign
    delta = HALF_WAD
    while delta > 0:
        y = (y * y) // WAD
        if y >= 2 * WAD:
            result += delta
            y >>= 1
        delta >>= 1
    return result * sign

def ln_wad(x): return tdiv(log2_wad(x) * WAD, LOG2_E)

def sqrt_u(x):                       # PRBMath Common.sqrt (floor)
    if x == 0: return 0
    xa, result = x, 1
    for shift, add in ((128, 64), (64, 32), (32, 16), (16, 8), (8, 4), (4, 2), (2, 1)):
        if xa >= 1 << shift:
            xa >>= shift; result <<= add
    for _ in range(7):
        result = (result + x // result) >> 1
    rounded = x // result
    return rounded if result >= rounded else result
def sqrt_wad(x): return sqrt_u(x * WAD)

# ---- Normal CDF via Cody/calerf (SPECFUN) dalam WAD ----
def W(v): return int((Decimal(v) * WAD).to_integral_value(rounding="ROUND_HALF_UP"))
A = [W("3.16112374387056560"), W("113.864154151050156"), W("377.485237685302021"), W("3209.37758913846947"), W("0.185777706184603153")]
B = [W("23.6012909523441209"), W("244.024637934444173"), W("1282.61652607737228"), W("2844.23683343917062")]
C = [W("0.564188496988670089"), W("8.88314979438837594"), W("66.1191906371416295"), W("298.635138197400131"),
     W("881.952221241769090"), W("1712.04761263407058"), W("2051.07837782607147"), W("1230.33935479799725"), W("2.15311535474403846e-8")]
D = [W("15.7449261107098347"), W("117.693950891312499"), W("537.181101862009858"), W("1621.38957456669019"),
     W("3290.79923573345963"), W("4362.61909014324716"), W("3439.36767414372164"), W("1230.33935480374942")]
P = [W("0.305326634961232344"), W("0.360344899949804439"), W("0.125781726111229246"), W("0.0160837851487422766"),
     W("0.000658749161529837803"), W("0.0163153871373020978")]
Q = [W("2.56852019228982242"), W("1.87295284992346725"), W("0.527905102951428412"), W("0.0605183413124413191"), W("0.00233520497626869185")]
SQRPI = W("0.56418958354775628695")     # 1/sqrt(pi)
INV_SQRT2 = W("0.70710678118654752440")
THRESH = W("0.46875")
FOUR = 4 * WAD

def erfc_wad(x):                      # erfc untuk x apa pun (WAD)
    y = abs(x)
    if y <= THRESH:
        ysq = mul_wad(y, y) if y > W("1.11e-16") else 0
        xnum = mul_wad(A[4], ysq); xden = ysq
        for i in range(3):
            xnum = mul_wad(xnum + A[i], ysq); xden = mul_wad(xden + B[i], ysq)
        erf = mul_wad(x, div_wad(xnum + A[3], xden + B[3]))
        return WAD - erf
    if y <= FOUR:
        xnum = mul_wad(C[8], y); xden = y
        for i in range(7):
            xnum = mul_wad(xnum + C[i], y); xden = mul_wad(xden + D[i], y)
        r = div_wad(xnum + C[7], xden + D[7])
        r = mul_wad(exp_wad(-mul_wad(y, y)), r)
    else:
        ysq = div_wad(WAD, mul_wad(y, y))
        xnum = mul_wad(P[5], ysq); xden = ysq
        for i in range(4):
            xnum = mul_wad(xnum + P[i], ysq); xden = mul_wad(xden + Q[i], ysq)
        r = mul_wad(ysq, div_wad(xnum + P[4], xden + Q[4]))
        r = div_wad(SQRPI - r, y)
        r = mul_wad(exp_wad(-mul_wad(y, y)), r)
    return r if x >= 0 else 2 * WAD - r

def norm_cdf_wad(x):
    if x < -8 * WAD: return 0
    if x > 8 * WAD: return WAD
    return tdiv(erfc_wad(mul_wad(-x, INV_SQRT2)), 2)

INV_SQRT_2PI = W("0.39894228040143267794")
TWO_PI = W("6.283185307179586476")
def norm_pdf_wad(x):
    return mul_wad(INV_SQRT_2PI, exp_wad(-tdiv(mul_wad(x, x), 2)))

# ---- Black-Scholes ----
def bs_quote_wad(s, k, t, sigma, r, is_call):
    sq = mul_wad(sigma, sqrt_wad(t))
    d1 = div_wad(ln_wad(div_wad(s, k)) + mul_wad(r + tdiv(mul_wad(sigma, sigma), 2), t), sq)
    d2 = d1 - sq
    disc = exp_wad(-mul_wad(r, t))
    kd = mul_wad(k, disc)
    nd1, nd2 = norm_cdf_wad(d1), norm_cdf_wad(d2)
    if is_call:
        price = mul_wad(s, nd1) - mul_wad(kd, nd2); delta = nd1
    else:
        price = mul_wad(kd, WAD - nd2) - mul_wad(s, WAD - nd1); delta = nd1 - WAD
    pdf = norm_pdf_wad(d1)
    gamma = div_wad(pdf, mul_wad(s, sq))
    vega = mul_wad(mul_wad(s, pdf), sqrt_wad(t))
    theta = -div_wad(mul_wad(mul_wad(s, pdf), sigma), 2 * sqrt_wad(t)) - mul_wad(mul_wad(r, kd), nd2 if is_call else -(WAD - nd2))
    return max(price, 0), delta, gamma, vega, theta

def capped_call_wad(s, k, cap, t, sigma, r):
    p1, d1_, _, v1, _ = bs_quote_wad(s, k, t, sigma, r, True)
    p2, d2_, _, v2, _ = bs_quote_wad(s, cap, t, sigma, r, True)
    return p1 - p2, d1_ - d2_, v1 - v2

def implied_vol_wad(target, s, k, t, r, is_call, lo=WAD // 100, hi=5 * WAD, max_iter=40):
    if target <= 0 or lo <= 0 or hi <= lo: raise ValueError("domain")
    tol = max(target // 10**8, s // 10**14)          # relatif untuk harga mikro (FR-6)
    # seed Brenner-Subrahmanyam: sqrt(2π/T)·price/S
    seed = mul_wad(sqrt_wad(div_wad(TWO_PI, t)), div_wad(target, s))
    sigma = min(max(seed, lo), hi)
    for it in range(1, max_iter + 1):
        price, _, _, vega, _ = bs_quote_wad(s, k, t, sigma, r, is_call)
        diff = price - target
        if abs(diff) <= tol: return sigma, it
        if diff > 0: hi = sigma
        else: lo = sigma
        if vega > 10**9:                       # 1e-9 WAD
            cand = sigma - div_wad(diff, vega)
            if lo < cand < hi:
                sigma = cand; continue
        sigma = (lo + hi) // 2
    raise ArithmeticError("no convergence")

SECONDS_PER_DAY = 86400
SECONDS_PER_YEAR = 31_536_000
def ewma_update_wad(var_prev, p_prev, p_now, dt_seconds, lam_per_day):
    dt_days = dt_seconds * WAD // SECONDS_PER_DAY               # WAD hari
    w = exp_wad(mul_wad(dt_days, ln_wad(lam_per_day)))          # λ^(Δt hari)
    r = ln_wad(div_wad(p_now, p_prev))
    dt_years = dt_seconds * WAD // SECONDS_PER_YEAR
    inst = div_wad(mul_wad(r, r), dt_years)
    return mul_wad(w, var_prev) + mul_wad(WAD - w, inst)

# ======================= VERIFIKASI =======================
def selftest():
    """Verifikasi emulasi terhadap referensi float; keluar non-nol jika ambang dilanggar."""
    print("exp2 table j=0..3:", [hex(v) for v in EXP2_TABLE[:4]])
    worst = {}
    def chk(name, got, ref, rel=True):
        # relatif hanya bila |ref| ≥ 1e-12 (di bawah itu granularitas WAD 1e-18 mendominasi → absolut)
        if rel and abs(ref) >= 1e-12: err = abs(got / WAD - ref) / abs(ref)
        else: err = abs(got / WAD - ref)
        worst[name] = max(worst.get(name, 0), err)

    for xf in [-40.0, -20.0, -5.0, -1.0, -0.5, -1e-6, 0.0, 1e-6, 0.5, 1.0, 3.0, 10.0, 50.0, 100.0, 133.0]:
        chk("exp", exp_wad(int(xf * WAD)), math.exp(xf))
    for xf in [1e-12, 1e-6, 0.001, 0.5, 0.95, 1.0, 1.05, 2.0, 10.0, 4000.0, 1e12, 1e18]:
        x = int(round(xf * WAD)); chk("ln", ln_wad(x), math.log(xf))
    for xf in [1e-18, 1e-9, 0.25, 1.0, 2.0, 4000.0, 1e12, 1e20]:
        chk("sqrt", sqrt_wad(int(xf * WAD)), math.sqrt(xf))
    for xf in [i / 100 for i in range(-800, 801)]:
        chk("Phi_abs", norm_cdf_wad(int(round(xf * WAD))), 0.5 * math.erfc(-xf / math.sqrt(2)), rel=False)
        chk("pdf_abs", norm_pdf_wad(int(round(xf * WAD))), math.exp(-xf * xf / 2) / math.sqrt(2 * math.pi), rel=False)
    sym = max(abs(norm_cdf_wad(int(x * WAD)) + norm_cdf_wad(-int(x * WAD)) - WAD) for x in [0.1, 0.5, 1, 2, 3, 4, 5, 6, 7])
    print(f"Φ(x)+Φ(−x)−1 max = {sym} wei ; Φ(0) = {norm_cdf_wad(0)}")
    mono = all(norm_cdf_wad(int(round((i)/100*WAD))) <= norm_cdf_wad(int(round((i+1)/100*WAD))) for i in range(-800, 800))
    print("Φ monoton:", mono)

    # BS vs float
    from bs_numbers import bs
    S = 4000.0; T7 = 7 / 365
    for K, sig, call, Td in [(4200, .6, True, 7), (3800, .6, False, 7), (4000, .6, True, 7), (3000, .6, False, 7), (5200, .6, True, 7),
                            (2600, .6, False, 7), (4200, 1.2, True, 30), (4000, .1, True, 365), (1600, 3.0, False, 1/24)]:
        T = Td / 365
        ref = bs(S, K, T, sig, 0.0, call)
        p, d, g, v, th = bs_quote_wad(int(S * WAD), int(K * WAD), int(round(T * WAD)), int(sig * WAD), 0, call)
        chk("price", p, ref["price"]); chk("delta_abs", d, ref["delta"], rel=False)
        chk("gamma", g, ref["gamma"]); chk("vega", v, ref["vega"] * 100); chk("theta", th, ref["theta"] * 365)
    # parity
    c = bs_quote_wad(4000 * WAD, 4200 * WAD, int(T7 * WAD), 6 * WAD // 10, 0, True)[0]
    p = bs_quote_wad(4000 * WAD, 4200 * WAD, int(T7 * WAD), 6 * WAD // 10, 0, False)[0]
    print(f"parity |C−P−(S−K)| = {abs(c - p - (4000 - 4200) * WAD)} wei")
    # capped
    cp, _, _ = capped_call_wad(4000 * WAD, 4200 * WAD, 8400 * WAD, int(T7 * WAD), 6 * WAD // 10, 0)
    print(f"capped C(4200) 7d 60% = {cp / WAD:.6f} (float 58.623930)")
    # solver
    for K, sig, call in [(4200, .6, True), (4000, .6, False), (3000, .6, False), (5200, .6, True), (2600, .6, False), (4200, 1.2, True), (4200, .3, True)]:
        tgt = bs_quote_wad(4000 * WAD, K * WAD, int(T7 * WAD), int(sig * WAD), 0, call)[0]
        iv, it = implied_vol_wad(tgt, 4000 * WAD, K * WAD, int(T7 * WAD), 0, call)
        chk("iv", iv, sig); print(f"  iv K={K} σ={sig}: {iv/WAD:.10f} in {it} iter")
    # ewma
    var = int(0.55**2 * WAD); prices = [(4000, 0), (4020, .25), (3960, .5), (4100, 1.0), (4080, 1.5), (3900, 2.0)]
    for i in range(1, len(prices)):
        p0, t0 = prices[i-1]; p1, t1 = prices[i]
        var = ewma_update_wad(var, p0 * WAD, p1 * WAD, int((t1 - t0) * 86400), int(0.94 * WAD))
    print(f"  ewma σ akhir = {math.sqrt(var / WAD):.4%} (float 58.60%)")
    print("\nWORST ERRORS:")
    for k_, v_ in worst.items(): print(f"  {k_:10s} {v_:.3e}")
    limits = {"exp": 1e-9, "ln": 1e-14, "sqrt": 1e-13, "Phi_abs": 1e-15, "pdf_abs": 1e-15,
              "price": 1e-9, "delta_abs": 1e-14, "gamma": 1e-9, "vega": 1e-9, "theta": 1e-9, "iv": 1e-8}
    bad = [k for k, lim in limits.items() if worst.get(k, 0) > lim]
    assert sym <= 1 and mono, "Φ simetri/monoton gagal"
    assert not bad, f"ambang dilanggar: {bad}"
    print("SELFTEST OK")

if __name__ == "__main__":
    selftest()
```

- [ ] **Step 2: Jalankan selftest — harus lolos ambang**

Run: `python3 tools/reference/wad_emul.py | tail -14`
Expected (angka boleh sedikit berbeda di digit terakhir, baris terakhir wajib `SELFTEST OK`):
```
WORST ERRORS:
  exp        2.128e-10
  ln         1.138e-15
  sqrt       2.507e-14
  Phi_abs    1.110e-16
  pdf_abs    1.110e-16
  price      3.465e-10
  delta_abs  3.331e-16
  gamma      3.110e-10
  vega       2.714e-12
  theta      2.712e-12
  iv         1.034e-10
SELFTEST OK
```

- [ ] **Step 3: Tulis `tools/reference/gen_constants.py`**

```python
"""Emit konstanta Rust & Solidity (WAD integer) dari wad_emul.py — hindari transkripsi manual.
Pakai: python3 gen_constants.py <out_rust> <out_sol>"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wad_emul import EXP2_TABLE, A, B, C, D, P, Q, SQRPI, INV_SQRT2, THRESH, INV_SQRT_2PI, WAD, W
def limbs(v):
    return ", ".join(str((v >> (64 * i)) & ((1 << 64) - 1)) + "u64" for i in range(4))
out = []
out.append("// GENERATED by tools/reference/gen_constants.py — JANGAN diedit manual.")
out.append("// Tabel PRBMath Common.exp2: C_j = round(2^(2^-(j+1)) * 2^64), j = 0..63 (format 64.64).")
out.append("pub const EXP2_TABLE: [u128; 64] = [")
for j in range(0, 64, 2):
    out.append(f"    0x{EXP2_TABLE[j]:X}, 0x{EXP2_TABLE[j+1]:X},")
out.append("];")
def arr(name, vals):
    out.append(f"pub const {name}: [i128; {len(vals)}] = [{', '.join(str(v) for v in vals)}];")
out.append("// Koefisien Cody (SPECFUN calerf) diskalakan WAD (1e18), dibulatkan ke integer terdekat.")
arr("CODY_A", A); arr("CODY_B", B); arr("CODY_C", C); arr("CODY_D", D); arr("CODY_P", P); arr("CODY_Q", Q)
out.append(f"pub const SQRPI: i128 = {SQRPI}; // 1/sqrt(pi)")
out.append(f"pub const INV_SQRT2: i128 = {INV_SQRT2}; // 1/sqrt(2)")
out.append(f"pub const INV_SQRT_2PI: i128 = {INV_SQRT_2PI}; // 1/sqrt(2*pi)")
out.append(f"pub const CODY_THRESH: i128 = {THRESH}; // 0.46875")
out.append("pub const TWO_PI: i128 = %d; // 2*pi" % W("6.283185307179586476"))
out.append(f"// limbs U256 untuk 1e36: [{limbs(WAD*WAD)}]")
import sys
out_rs = sys.argv[1] if len(sys.argv) > 1 else "constants_gen.rs"
open(out_rs, "w").write("\n".join(out) + "\n")

# ---- Solidity: library konstanta untuk BlackScholesSol (kontrol) ----
def sol_arr(name, vals, ty="int256"):
    return "\n".join(f"    {ty} internal constant {name}{k} = {v};" for k, v in enumerate(vals))
sol = ["// SPDX-License-Identifier: MIT",
       "// GENERATED by tools/reference/gen_constants.py — JANGAN diedit manual.",
       "pragma solidity ^0.8.24;",
       "", "/// @notice Konstanta WAD identik dengan crate bs-math (Rust).", "library BsConstants {",
       sol_arr("A", A), sol_arr("B", B), sol_arr("C", C), sol_arr("D", D), sol_arr("P", P), sol_arr("Q", Q),
       f"    int256 internal constant SQRPI = {SQRPI};",
       f"    int256 internal constant INV_SQRT2 = {INV_SQRT2};",
       f"    int256 internal constant INV_SQRT_2PI = {INV_SQRT_2PI};",
       f"    int256 internal constant CODY_THRESH = {THRESH};",
       f"    int256 internal constant TWO_PI = {W('6.283185307179586476')};",
       "    int256 internal constant EXP_MAX_INPUT = 133084258667509499440;",
       "    int256 internal constant EXP_MIN_THRESHOLD = -41446531673892822322;",
       "    int256 internal constant S_MIN = 1e12;",
       "    int256 internal constant S_MAX = 1e30;",
       "    int256 internal constant T_MIN = 1902587519025;",
       "    int256 internal constant T_MAX = 1e18;",
       "    int256 internal constant SIGMA_MIN = 1e16;",
       "    int256 internal constant SIGMA_MAX = 5e18;",
       "    int256 internal constant R_ABS_MAX = 1e18;",
       "}"]
out_sol = sys.argv[2] if len(sys.argv) > 2 else "BsConstants.sol"
open(out_sol, "w").write("\n".join(sol) + "\n")
print(f"wrote {out_rs} dan {out_sol}")
```

- [ ] **Step 4: Tulis `tools/reference/gen_vectors.py`**

```python
"""Emit vektor uji (WAD integer eksak dari wad_emul.py + referensi float) sebagai Rust & Solidity.
Pakai: python3 gen_vectors.py <out_rust> <out_sol>"""
import math, sys
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wad_emul import *
from bs_numbers import bs

out_rs, out_sol = sys.argv[1], sys.argv[2]
W_ = lambda f: int(round(f * WAD))

exp_v = [(W_(x), exp_wad(W_(x))) for x in [-41.4, -40, -30, -20, -10, -5, -2, -1, -0.5, -0.1, -1e-6, 0, 1e-6, 0.1, 0.5, 1, 2, 5, 10, 20, 30, 40]]
ln_v  = [(W_(x), ln_wad(W_(x))) for x in [1e-12, 1e-9, 1e-6, 1e-3, 0.1, 0.5, 0.9, 0.95, 0.999, 1, 1.001, 1.05, 1.1, 2, 2.718281828459045, 10, 100, 4000, 1e6, 1e12]]
sqrt_v = [(W_(x), sqrt_wad(W_(x))) for x in [0, 1e-18, 1e-12, 1e-9, 0.01, 0.25, 0.5, 1, 2, 3, 4, 100, 4000, 1e6, 1e12]]
phi_v = [(W_(x), norm_cdf_wad(W_(x))) for x in [i / 20 for i in range(-170, 171)]]  # −8.5..8.5 langkah 0.05
pdf_v = [(W_(x), norm_pdf_wad(W_(x))) for x in [i / 10 for i in range(-80, 81)]]

S = 4000.0
quote_cases = []
for K in [2600, 3000, 3800, 4000, 4200, 5200, 6000]:
    for sig in [0.1, 0.3, 0.6, 1.2, 3.0]:
        for Td in [1/24, 1, 7, 30, 365]:
            for r in [0.0, 0.05]:
                for call in [True, False]:
                    quote_cases.append((K, sig, Td, r, call))
quote_v, float_v = [], []
for (K, sig, Td, r, call) in quote_cases:
    T = Td / 365
    s_, k_, t_, sg_, r_ = W_(S), W_(K), W_(T), W_(sig), W_(r)
    p, d, g, v, th = bs_quote_wad(s_, k_, t_, sg_, r_, call)
    quote_v.append((s_, k_, t_, sg_, r_, call, p, d, g, v, th))
    ref = bs(S, K, T, sig, r, call)
    float_v.append((s_, k_, t_, sg_, r_, call, ref["price"]))
capped_v = []
for (K, sig, Td) in [(4200, .6, 7), (4000, .6, 7), (4200, .6, 30), (4000, 1.0, 30), (4000, 1.5, 30), (3000, .6, 7)]:
    T = Td / 365
    args = (W_(S), W_(K), W_(2 * K), W_(T), W_(sig), 0)
    p, d, v = capped_call_wad(*args)
    capped_v.append(args + (p, d, v))
iv_v = []
for (K, sig, call, Td) in [(4200,.6,True,7),(4000,.6,False,7),(3000,.6,False,7),(5200,.6,True,7),(2600,.6,False,7),(4200,1.2,True,7),(4200,.3,True,7),(2000,.6,False,30),(6000,.6,True,7),(4000,.1,True,365),(4000,3.0,True,1)]:
    T = Td / 365
    tgt = bs_quote_wad(W_(S), W_(K), W_(T), W_(sig), 0, call)[0]
    sg, it = implied_vol_wad(tgt, W_(S), W_(K), W_(T), 0, call)
    iv_v.append((tgt, W_(S), W_(K), W_(T), 0, call, sg, it))
ewma_v = []
var = W_(0.55**2); prices = [(4000, 0), (4020, .25), (3960, .5), (4100, 1.0), (4080, 1.5), (3900, 2.0)]
for i_ in range(1, len(prices)):
    p0, t0 = prices[i_-1]; p1, t1 = prices[i_]
    dt = int((t1 - t0) * 86400)
    nv = ewma_update_wad(var, W_(p0), W_(p1), dt, W_(0.94))
    ewma_v.append((var, W_(p0), W_(p1), dt, W_(0.94), nv)); var = nv

def rs_tuple(t):
    return "(" + ", ".join(("true" if x is True else "false") if isinstance(x, bool) else (repr(x) if isinstance(x, float) else str(x)) for x in t) + ")"
def rs_arr(name, ty, rows):
    return f"pub const {name}: &[{ty}] = &[\n" + "".join(f"    {rs_tuple(r)},\n" for r in rows) + "];\n"
rs = "// GENERATED by tools/reference/gen_vectors.py — JANGAN diedit manual.\n"
rs += rs_arr("EXP", "(i128, i128)", exp_v)
rs += rs_arr("LN", "(i128, i128)", ln_v)
rs += rs_arr("SQRT", "(u128, u128)", sqrt_v)
rs += rs_arr("PHI", "(i128, i128)", phi_v)
rs += rs_arr("PDF", "(i128, i128)", pdf_v)
rs += rs_arr("QUOTE", "(i128, i128, i128, i128, i128, bool, i128, i128, i128, i128, i128)", quote_v)
rs += rs_arr("FLOAT_PRICE", "(i128, i128, i128, i128, i128, bool, f64)", float_v)
rs += rs_arr("CAPPED", "(i128, i128, i128, i128, i128, i128, i128, i128, i128)", capped_v)
rs += rs_arr("IV", "(i128, i128, i128, i128, i128, bool, i128, u8)", iv_v)
rs += rs_arr("EWMA", "(i128, i128, i128, i128, i128, i128)", ewma_v)
open(out_rs, "w").write(rs)

# Solidity: subset (Foundry) — array literal besar mahal untuk kompilasi; ambil sampel.
def sol_rows(name, rows, fields):
    lines = [f"    function {name}() internal pure returns ({', '.join(f'{ty}[] memory' for ty,_ in fields)}) {{"]
    n = len(rows)
    for j, (ty, _) in enumerate(fields):
        lines.append(f"        {ty}[] memory v{j} = new {ty}[]({n});")
    for i_, r in enumerate(rows):
        for j, (ty, idx) in enumerate(fields):
            val = r[idx]
            val = ("true" if val else "false") if isinstance(val, bool) else str(val)
            lines.append(f"        v{j}[{i_}] = {val};")
    lines.append(f"        return ({', '.join(f'v{j}' for j in range(len(fields)))});")
    lines.append("    }")
    return "\n".join(lines)
sol = "// SPDX-License-Identifier: MIT\n// GENERATED by tools/reference/gen_vectors.py — JANGAN diedit manual.\npragma solidity ^0.8.24;\n\nlibrary VectorsGen {\n"
sol += sol_rows("expV", exp_v, [("int256", 0), ("int256", 1)]) + "\n"
sol += sol_rows("lnV", ln_v, [("int256", 0), ("int256", 1)]) + "\n"
sol += sol_rows("sqrtV", sqrt_v, [("uint256", 0), ("uint256", 1)]) + "\n"
sol += sol_rows("phiV", phi_v[::5], [("int256", 0), ("int256", 1)]) + "\n"
sol += sol_rows("quoteV", quote_v[::7], [("int256", 0), ("int256", 1), ("int256", 2), ("int256", 3), ("int256", 4), ("bool", 5), ("int256", 6), ("int256", 7), ("int256", 9)]) + "\n"
sol += "}\n"
open(out_sol, "w").write(sol)
print(f"rust: exp {len(exp_v)} ln {len(ln_v)} sqrt {len(sqrt_v)} phi {len(phi_v)} pdf {len(pdf_v)} quote {len(quote_v)} capped {len(capped_v)} iv {len(iv_v)} ewma {len(ewma_v)}")
print(f"sol: phi {len(phi_v[::5])} quote {len(quote_v[::7])}")
```

- [ ] **Step 5: Generate keempat berkas dan periksa**

```bash
mkdir -p stylus/bs-math/src stylus/bs-math/tests/common contracts/src/math contracts/test
python3 tools/reference/gen_constants.py stylus/bs-math/src/constants.rs contracts/src/math/BsConstants.sol
python3 tools/reference/gen_vectors.py stylus/bs-math/tests/common/vectors_gen.rs contracts/test/VectorsGen.sol
head -4 stylus/bs-math/src/constants.rs
grep -c "^    0x" stylus/bs-math/src/constants.rs      # expected: 32 (64 konstanta, 2 per baris)
grep "TWO_PI" stylus/bs-math/src/constants.rs          # expected: pub const TWO_PI: i128 = 6283185307179586476; // 2*pi
```
Expected output generator: `rust: exp 22 ln 20 sqrt 15 phi 341 pdf 161 quote 700 capped 6 iv 11 ewma 5` dan `sol: phi 69 quote 100`. Sanity: `EXP2_TABLE[0]` harus `0x16A09E667F3BCC909` (konstanta pertama PRBMath `Common.exp2`).

- [ ] **Step 6: Commit**

```bash
git add tools/reference stylus/bs-math/src/constants.rs stylus/bs-math/tests/common/vectors_gen.rs contracts/src/math/BsConstants.sol contracts/test/VectorsGen.sol
git commit -m "feat(reference): exact WAD emulation, constants and test-vector generators"
```

### Task 3: Crate `bs-math` — kerangka, `error`, dan primitif `fixed`

**Files:**
- Create: `stylus/bs-math/Cargo.toml`, `stylus/bs-math/src/lib.rs`, `stylus/bs-math/src/error.rs`, `stylus/bs-math/src/fixed.rs`, `stylus/bs-math/tests/common/mod.rs`
- Test: `stylus/bs-math/tests/t_fixed.rs`

**Interfaces:**
- Consumes: `src/constants.rs` dan `tests/common/vectors_gen.rs` (Task 2).
- Produces: `MathError { OutOfDomain(u8), NoConvergence(u8), LengthMismatch, Overflow }`; `fixed::{WAD_U, WAD2_U, WAD, WAD2, HALF_WAD_U}`; `fn i(i128) -> I256`, `fn u(u128) -> U256`, `fn to_u(I256) -> U256`, `fn to_i(U256) -> Result<I256, MathError>`, `fn mul_wad(I256, I256) -> Result<I256, MathError>`, `fn div_wad(I256, I256) -> Result<I256, MathError>`, `fn sqrt_u(U256) -> U256`, `fn sqrt_wad(U256) -> Result<U256, MathError>`, `fn sqrt_wad_i(I256) -> Result<I256, MathError>`.

- [ ] **Step 1: Tulis `Cargo.toml` dan helper test bersama**

`stylus/bs-math/Cargo.toml`:
```toml
[package]
name = "bs-math"
version = "0.1.0"
edition = "2021"
description = "Pure no_std Black-Scholes math in WAD fixed point (I256), bit-identical to PRBMath exp/ln/sqrt"
license = "MIT"

[dependencies]
alloy-primitives = { version = "1", default-features = false }

[features]
default = []
std = ["alloy-primitives/std"]
```

`stylus/bs-math/tests/common/mod.rs`:
```rust
//! Helper bersama untuk test integrasi (di-include lewat `mod common;`).
//! `vectors_gen.rs` dihasilkan oleh tools/reference/gen_vectors.py — jangan diedit manual.
#![allow(dead_code)]
pub mod vectors_gen;
use bs_math::I256;

/// I256 WAD → f64 (hanya untuk pembanding referensi float).
pub fn f(x: I256) -> f64 {
    let neg = x.is_negative();
    let mag: u128 = x.unsigned_abs().to::<u128>();
    let v = mag as f64 / 1e18;
    if neg { -v } else { v }
}
```

- [ ] **Step 2: Tulis test yang gagal — `stylus/bs-math/tests/t_fixed.rs`**

```rust
//! Task 3: primitif WAD — semantik trunc-toward-zero dan sqrt bit-eksak.
mod common;
use bs_math::fixed::{div_wad, i, mul_wad, sqrt_wad, u, WAD};
use bs_math::{I256, MathError};
use common::vectors_gen::SQRT;

#[test]
fn mul_div_truncate_toward_zero() {
    assert_eq!(mul_wad(i(2) * WAD, i(3) * WAD).unwrap(), i(6) * WAD);
    assert_eq!(mul_wad(-i(7), i(2)).unwrap(), I256::ZERO);            // −14 / 1e18 → 0 (bukan −1)
    assert_eq!(div_wad(-i(7) * WAD, i(2) * WAD).unwrap(), -i(35) * WAD / i(10));
    assert_eq!(div_wad(-i(1), i(3) * WAD).unwrap(), I256::ZERO);     // −0,33 → 0
    assert_eq!(div_wad(WAD, I256::ZERO), Err(MathError::OutOfDomain(1)));
}
#[test]
fn mul_overflow_is_error() {
    let big = i(i128::MAX) * i(i128::MAX);
    assert_eq!(mul_wad(big, big), Err(MathError::Overflow));
}
#[test]
fn sqrt_bit_exact() {
    for &(x, y) in SQRT { assert_eq!(sqrt_wad(u(x)).unwrap(), u(y), "sqrt({x})"); }
}
```

- [ ] **Step 3: Jalankan — harus gagal kompilasi (modul belum ada)**

Run: `cd stylus/bs-math && cargo test --test t_fixed 2>&1 | head -5`
Expected: error `unresolved import`/`could not find` untuk `bs_math::fixed` (atau "no targets" bila `src/lib.rs` belum ada).

- [ ] **Step 4: Tulis `src/error.rs`, `src/fixed.rs`, dan `src/lib.rs` (versi Task 3)**

`src/error.rs`:
```rust
/// Error bertipe; wrapper Stylus memetakannya ke `SolidityError` (FR-9).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MathError {
    /// Argumen ke-`n` (0-based) di luar domain §6.6.
    OutOfDomain(u8),
    /// Solver tidak konvergen dalam `n` iterasi.
    NoConvergence(u8),
    /// Panjang array tidak sama (mark_portfolio).
    LengthMismatch,
    /// Overflow aritmetika 256-bit.
    Overflow,
}
```

`src/fixed.rs`:
```rust
//! Primitif WAD: konstanta, konversi, mul/div trunc-toward-zero (semantik PRBMath/Solidity), sqrt.
use crate::error::MathError;
use alloy_primitives::{I256, U256};

/// 1e18 sebagai U256.
pub const WAD_U: U256 = U256::from_limbs([1_000_000_000_000_000_000u64, 0, 0, 0]);
/// 1e36 sebagai U256 (limbs dihitung oleh gen_constants.py).
pub const WAD2_U: U256 = U256::from_limbs([12919594847110692864u64, 54210108624275221u64, 0, 0]);
/// 1e18 sebagai I256.
pub const WAD: I256 = I256::from_raw(WAD_U);
/// 1e36 sebagai I256.
pub const WAD2: I256 = I256::from_raw(WAD2_U);
/// 0.5e18.
pub const HALF_WAD_U: U256 = U256::from_limbs([500_000_000_000_000_000u64, 0, 0, 0]);

/// i128 → I256 (tidak pernah gagal untuk 128-bit).
#[inline]
pub fn i(x: i128) -> I256 {
    let mag = U256::from(x.unsigned_abs());
    let v = I256::from_raw(mag);
    if x < 0 { -v } else { v }
}
/// u128 → U256.
#[inline]
pub fn u(x: u128) -> U256 { U256::from(x) }
/// I256 non-negatif → U256 (panik jika negatif — hanya untuk nilai yang sudah divalidasi).
#[inline]
pub fn to_u(x: I256) -> U256 {
    debug_assert!(!x.is_negative());
    x.into_raw()
}
/// U256 → I256 (Overflow jika ≥ 2^255).
#[inline]
pub fn to_i(x: U256) -> Result<I256, MathError> {
    I256::try_from(x).map_err(|_| MathError::Overflow)
}

/// a·b / 1e18, trunc toward zero (identik dengan PRBMath `mul` dan Solidity `(a*b)/1e18`).
#[inline]
pub fn mul_wad(a: I256, b: I256) -> Result<I256, MathError> {
    let p = a.checked_mul(b).ok_or(MathError::Overflow)?;
    Ok(p / WAD)
}
/// a·1e18 / b, trunc toward zero.
#[inline]
pub fn div_wad(a: I256, b: I256) -> Result<I256, MathError> {
    if b.is_zero() { return Err(MathError::OutOfDomain(1)); }
    let p = a.checked_mul(WAD).ok_or(MathError::Overflow)?;
    Ok(p / b)
}

/// floor(sqrt(x)) untuk U256 — port PRBMath `Common.sqrt` (tebakan msb + 7 iterasi Babylonian).
pub fn sqrt_u(x: U256) -> U256 {
    if x.is_zero() { return U256::ZERO; }
    let one = U256::from(1u64);
    let mut xa = x;
    let mut result = one;
    if xa >= (one << 128) { xa >>= 128; result <<= 64; }
    if xa >= (one << 64)  { xa >>= 64;  result <<= 32; }
    if xa >= (one << 32)  { xa >>= 32;  result <<= 16; }
    if xa >= (one << 16)  { xa >>= 16;  result <<= 8; }
    if xa >= (one << 8)   { xa >>= 8;   result <<= 4; }
    if xa >= (one << 4)   { xa >>= 4;   result <<= 2; }
    if xa >= (one << 2)   { result <<= 1; }
    for _ in 0..7 { result = (result + x / result) >> 1; }
    let rounded = x / result;
    if result >= rounded { rounded } else { result }
}
/// sqrt dalam WAD: sqrt(x·1e18) — port PRBMath `UD60x18.sqrt`.
pub fn sqrt_wad(x: U256) -> Result<U256, MathError> {
    let y = x.checked_mul(WAD_U).ok_or(MathError::Overflow)?;
    Ok(sqrt_u(y))
}
/// sqrt untuk I256 non-negatif.
pub fn sqrt_wad_i(x: I256) -> Result<I256, MathError> {
    if x.is_negative() { return Err(MathError::OutOfDomain(0)); }
    to_i(sqrt_wad(to_u(x))?)
}
```

`src/lib.rs` (hanya modul yang sudah ada; baris `pub mod` lain ditambah per task):
```rust
//! bs-math — Black-Scholes, Greeks, implied-vol solver, EWMA dan batch mark-to-market
//! dalam fixed-point WAD (1e18) atas `I256`/`U256`, tanpa float, tanpa std.
//! Semua fungsi murni; wrapper Stylus ada di crate `bs-stylus`.
#![no_std]
#![deny(unsafe_code)]

#[cfg(test)]
extern crate std;

pub mod constants;
pub mod error;
pub mod fixed;

pub use alloy_primitives::{I256, U256};
pub use error::MathError;
```

- [ ] **Step 5: Jalankan — lolos**

Run: `cd stylus/bs-math && cargo test --test t_fixed`
Expected: `test result: ok. 3 passed; 0 failed`

- [ ] **Step 6: Commit**

```bash
git add stylus/bs-math
git commit -m "feat(bs-math): crate skeleton, typed errors, WAD fixed-point primitives"
```

### Task 4: `exp` / `exp2` — port bit-identik PRBMath

**Files:**
- Create: `stylus/bs-math/src/exp.rs`
- Modify: `stylus/bs-math/src/lib.rs` (tambah `pub mod exp;`)
- Test: `stylus/bs-math/tests/t_exp.rs`

**Interfaces:**
- Consumes: Task 3 (`fixed`, `error`, `constants`).
- Produces: `exp::exp2_wad(I256) -> Result<I256, MathError>`, `exp::exp_wad(I256) -> Result<I256, MathError>`, konstanta `EXP_MAX_INPUT, EXP_MIN_THRESHOLD, EXP2_MAX_INPUT, EXP2_MIN_THRESHOLD, LOG2_E: i128`.

- [ ] **Step 1: Tulis test yang gagal — `tests/t_exp.rs`**

```rust
//! Task 4: exp/exp2 — port bit-identik PRBMath.
mod common;
use bs_math::exp::{exp_wad, EXP_MAX_INPUT, EXP_MIN_THRESHOLD};
use bs_math::fixed::{i, WAD};
use bs_math::{I256, MathError};
use common::vectors_gen::EXP;

#[test]
fn exp_bit_exact() {
    for &(x, y) in EXP { assert_eq!(exp_wad(i(x)).unwrap(), i(y), "exp({x})"); }
}
#[test]
fn exp_domain() {
    assert!(exp_wad(i(EXP_MAX_INPUT)).is_ok());
    assert_eq!(exp_wad(i(EXP_MAX_INPUT + 1)), Err(MathError::OutOfDomain(0)));
    assert_eq!(exp_wad(i(EXP_MIN_THRESHOLD - 1)).unwrap(), I256::ZERO);
    assert_eq!(exp_wad(I256::ZERO).unwrap(), WAD);
}
```

- [ ] **Step 2: Jalankan — harus gagal kompilasi**

Run: `cd stylus/bs-math && cargo test --test t_exp 2>&1 | grep -E "^error" | head -3`
Expected: `error[E0432]: unresolved import` (modul `exp` belum ada).

- [ ] **Step 3: Tulis `src/exp.rs` dan daftarkan di `lib.rs`**

```rust
//! exp dan exp2 — port bit-identik PRBMath v4 `SD59x18.exp` / `exp2` / `Common.exp2`.
use crate::constants::EXP2_TABLE;
use crate::error::MathError;
use crate::fixed::{i, to_i, WAD, WAD2, WAD_U};
use alloy_primitives::{I256, U256};

pub const EXP_MAX_INPUT: i128 = 133_084258667509499440;      // 133.084…e18
pub const EXP_MIN_THRESHOLD: i128 = -41_446531673892822322;  // −41.446…e18 → hasil 0
pub const EXP2_MAX_INPUT: i128 = 192_000000000000000000 - 1;
pub const EXP2_MIN_THRESHOLD: i128 = -59_794705707972522261;
pub const LOG2_E: i128 = 1_442695040888963407;

/// 2^x untuk x dalam format 192.64 (Common.exp2). Hasil dalam WAD.
fn exp2_192x64(x: U256) -> Result<U256, MathError> {
    let mut result = U256::from(1u64) << 191usize; // 0.5 dalam 192.64
    for (j, c) in EXP2_TABLE.iter().enumerate() {
        if x.bit(63 - j) {
            result = result.checked_mul(U256::from(*c)).ok_or(MathError::Overflow)? >> 64usize;
        }
    }
    result = result.checked_mul(WAD_U).ok_or(MathError::Overflow)?;
    let n: usize = (x >> 64usize).to::<usize>();
    Ok(result >> (191 - n))
}

/// 2^x, x WAD (boleh negatif). Port `SD59x18.exp2`.
pub fn exp2_wad(x: I256) -> Result<I256, MathError> {
    if x.is_negative() {
        if x < i(EXP2_MIN_THRESHOLD) { return Ok(I256::ZERO); }
        let pos = exp2_wad(-x)?;
        return Ok(WAD2 / pos);
    }
    if x > i(EXP2_MAX_INPUT) { return Err(MathError::OutOfDomain(0)); }
    let x_192x64 = (x.into_raw() << 64usize) / WAD_U;
    to_i(exp2_192x64(x_192x64)?)
}

/// e^x, x WAD. Port `SD59x18.exp`: exp2(x·log2(e)).
pub fn exp_wad(x: I256) -> Result<I256, MathError> {
    if x > i(EXP_MAX_INPUT) { return Err(MathError::OutOfDomain(0)); }
    if x < i(EXP_MIN_THRESHOLD) { return Ok(I256::ZERO); }
    let dbl = x.checked_mul(i(LOG2_E)).ok_or(MathError::Overflow)?;
    exp2_wad(dbl / WAD)
}
```

`src/lib.rs` menjadi:
```rust
//! bs-math — Black-Scholes, Greeks, implied-vol solver, EWMA dan batch mark-to-market
//! dalam fixed-point WAD (1e18) atas `I256`/`U256`, tanpa float, tanpa std.
//! Semua fungsi murni; wrapper Stylus ada di crate `bs-stylus`.
#![no_std]
#![deny(unsafe_code)]

#[cfg(test)]
extern crate std;

pub mod constants;
pub mod error;
pub mod fixed;
pub mod exp;

pub use alloy_primitives::{I256, U256};
pub use error::MathError;
```

- [ ] **Step 4: Jalankan — lolos**

Run: `cd stylus/bs-math && cargo test --test t_exp`
Expected: `test result: ok. 2 passed; 0 failed`

- [ ] **Step 5: Commit**

```bash
git add stylus/bs-math
git commit -m "feat(bs-math): exp/exp2 bit-identical port of PRBMath"
```

### Task 5: `log2` / `ln` — port bit-identik PRBMath

**Files:**
- Create: `stylus/bs-math/src/ln.rs`
- Modify: `stylus/bs-math/src/lib.rs` (tambah `pub mod ln;`)
- Test: `stylus/bs-math/tests/t_ln.rs`

**Interfaces:**
- Consumes: Task 3 (`fixed`, `error`, `constants`) dan modul sebelumnya.
- Produces: `ln::log2_wad(I256) -> Result<I256, MathError>`, `ln::ln_wad(I256) -> Result<I256, MathError>` (x ≤ 0 → `OutOfDomain(0)`).

- [ ] **Step 1: Tulis test yang gagal — `tests/t_ln.rs`**

```rust
//! Task 5: log2/ln — port bit-identik PRBMath.
mod common;
use bs_math::fixed::{i, WAD};
use bs_math::ln::ln_wad;
use bs_math::{I256, MathError};
use common::vectors_gen::LN;

#[test]
fn ln_bit_exact() {
    for &(x, y) in LN { assert_eq!(ln_wad(i(x)).unwrap(), i(y), "ln({x})"); }
}
#[test]
fn ln_domain_and_identity() {
    assert_eq!(ln_wad(I256::ZERO), Err(MathError::OutOfDomain(0)));
    assert_eq!(ln_wad(-WAD), Err(MathError::OutOfDomain(0)));
    assert_eq!(ln_wad(WAD).unwrap(), I256::ZERO);
}
```

- [ ] **Step 2: Jalankan — harus gagal kompilasi**

Run: `cd stylus/bs-math && cargo test --test t_ln 2>&1 | grep -E "^error" | head -3`
Expected: `error[E0432]: unresolved import` (modul `ln` belum ada).

- [ ] **Step 3: Tulis `src/ln.rs` dan daftarkan di `lib.rs`**

```rust
//! log2 dan ln — port bit-identik PRBMath v4 `SD59x18.log2` / `ln`.
use crate::error::MathError;
use crate::exp::LOG2_E;
use crate::fixed::{i, HALF_WAD_U, WAD, WAD2_U, WAD_U};
use alloy_primitives::{I256, U256};

#[inline]
fn msb(x: U256) -> usize { 255 - x.leading_zeros() }

/// log2(x), x WAD > 0.
pub fn log2_wad(x: I256) -> Result<I256, MathError> {
    if x <= I256::ZERO { return Err(MathError::OutOfDomain(0)); }
    let mut xu = x.into_raw();
    let neg = xu < WAD_U;
    if neg { xu = WAD2_U / xu; }
    let n = msb(xu / WAD_U);
    let mut result = U256::from(n as u64) * WAD_U;
    let mut y = xu >> n;
    if y != WAD_U {
        let two_wad = WAD_U << 1usize;
        let mut delta = HALF_WAD_U;
        while !delta.is_zero() {
            y = (y * y) / WAD_U;
            if y >= two_wad { result += delta; y >>= 1usize; }
            delta >>= 1usize;
        }
    }
    let r = I256::from_raw(result);
    Ok(if neg { -r } else { r })
}

/// ln(x) = log2(x)·1e18 / log2(e).
pub fn ln_wad(x: I256) -> Result<I256, MathError> {
    Ok(log2_wad(x)? * WAD / i(LOG2_E))
}
```

`src/lib.rs` menjadi:
```rust
//! bs-math — Black-Scholes, Greeks, implied-vol solver, EWMA dan batch mark-to-market
//! dalam fixed-point WAD (1e18) atas `I256`/`U256`, tanpa float, tanpa std.
//! Semua fungsi murni; wrapper Stylus ada di crate `bs-stylus`.
#![no_std]
#![deny(unsafe_code)]

#[cfg(test)]
extern crate std;

pub mod constants;
pub mod error;
pub mod fixed;
pub mod exp;
pub mod ln;

pub use alloy_primitives::{I256, U256};
pub use error::MathError;
```

- [ ] **Step 4: Jalankan — lolos**

Run: `cd stylus/bs-math && cargo test --test t_ln`
Expected: `test result: ok. 2 passed; 0 failed`

- [ ] **Step 5: Commit**

```bash
git add stylus/bs-math
git commit -m "feat(bs-math): log2/ln bit-identical port of PRBMath"
```

### Task 6: Φ dan φ — erfc Cody dalam WAD (FR-3, INV-5)

**Files:**
- Create: `stylus/bs-math/src/normal.rs`
- Modify: `stylus/bs-math/src/lib.rs` (tambah `pub mod normal;`)
- Test: `stylus/bs-math/tests/t_normal.rs`

**Interfaces:**
- Consumes: Task 3 (`fixed`, `error`, `constants`) dan modul sebelumnya.
- Produces: `normal::erfc_wad(I256) -> Result<I256, MathError>`, `normal::norm_cdf(I256) -> Result<I256, MathError>` (|x| > 8e18 → 0/1e18), `normal::norm_pdf(I256) -> Result<I256, MathError>`.

- [ ] **Step 1: Tulis test yang gagal — `tests/t_normal.rs`**

```rust
//! Task 6: Φ dan φ — Cody erfc; FR-3 dan INV-5.
mod common;
use bs_math::fixed::{i, WAD};
use bs_math::normal::{norm_cdf, norm_pdf};
use bs_math::I256;
use common::vectors_gen::{PDF, PHI};

#[test]
fn phi_bit_exact_monotone_bounded() {
    let mut prev = I256::ZERO;
    for &(x, y) in PHI {
        let got = norm_cdf(i(x)).unwrap();
        assert_eq!(got, i(y), "Phi({x})");
        assert!(got >= prev, "Phi monoton di {x}");
        assert!(got >= I256::ZERO && got <= WAD);
        prev = got;
    }
}
#[test]
fn phi_symmetry_and_tails() {
    assert_eq!(norm_cdf(I256::ZERO).unwrap(), WAD / i(2));
    for x in [1i128, 5, 10, 20, 30, 40, 50, 60, 70] {
        let x = i(x) * WAD / i(10);
        let s = norm_cdf(x).unwrap() + norm_cdf(-x).unwrap();
        assert!((s - WAD).abs() <= I256::ONE, "simetri di {x}");   // ± 1 wei
    }
    assert_eq!(norm_cdf(i(-9) * WAD).unwrap(), I256::ZERO);
    assert_eq!(norm_cdf(i(9) * WAD).unwrap(), WAD);
}
#[test]
fn pdf_bit_exact() {
    for &(x, y) in PDF { assert_eq!(norm_pdf(i(x)).unwrap(), i(y), "pdf({x})"); }
}
```

- [ ] **Step 2: Jalankan — harus gagal kompilasi**

Run: `cd stylus/bs-math && cargo test --test t_normal 2>&1 | grep -E "^error" | head -3`
Expected: `error[E0432]: unresolved import` (modul `normal` belum ada).

- [ ] **Step 3: Tulis `src/normal.rs` dan daftarkan di `lib.rs`**

```rust
//! Φ (CDF) dan φ (PDF) normal standar dalam WAD. erfc via aproksimasi rasional Cody (calerf).
use crate::constants::*;
use crate::error::MathError;
use crate::exp::exp_wad;
use crate::fixed::{div_wad, i, mul_wad, WAD};
use alloy_primitives::I256;

/// erfc(x), x WAD, hasil WAD ∈ [0, 2].
pub fn erfc_wad(x: I256) -> Result<I256, MathError> {
    let y = if x.is_negative() { -x } else { x };
    let four = i(4) * WAD;
    let r = if y <= i(CODY_THRESH) {
        let ysq = if y > i(111_000) { mul_wad(y, y)? } else { I256::ZERO }; // 1.11e-16 → 111000 wei
        let mut xnum = mul_wad(i(CODY_A[4]), ysq)?;
        let mut xden = ysq;
        for k in 0..3 {
            xnum = mul_wad(xnum + i(CODY_A[k]), ysq)?;
            xden = mul_wad(xden + i(CODY_B[k]), ysq)?;
        }
        let erf = mul_wad(x, div_wad(xnum + i(CODY_A[3]), xden + i(CODY_B[3]))?)?;
        return Ok(WAD - erf);
    } else if y <= four {
        let mut xnum = mul_wad(i(CODY_C[8]), y)?;
        let mut xden = y;
        for k in 0..7 {
            xnum = mul_wad(xnum + i(CODY_C[k]), y)?;
            xden = mul_wad(xden + i(CODY_D[k]), y)?;
        }
        let q = div_wad(xnum + i(CODY_C[7]), xden + i(CODY_D[7]))?;
        mul_wad(exp_wad(-mul_wad(y, y)?)?, q)?
    } else {
        let ysq = div_wad(WAD, mul_wad(y, y)?)?;
        let mut xnum = mul_wad(i(CODY_P[5]), ysq)?;
        let mut xden = ysq;
        for k in 0..4 {
            xnum = mul_wad(xnum + i(CODY_P[k]), ysq)?;
            xden = mul_wad(xden + i(CODY_Q[k]), ysq)?;
        }
        let q = mul_wad(ysq, div_wad(xnum + i(CODY_P[4]), xden + i(CODY_Q[4]))?)?;
        let q = div_wad(i(SQRPI) - q, y)?;
        mul_wad(exp_wad(-mul_wad(y, y)?)?, q)?
    };
    Ok(if x.is_negative() { i(2) * WAD - r } else { r })
}

/// Φ(x) = ½·erfc(−x/√2); |x| > 8 → 0/1 (tanpa revert).
pub fn norm_cdf(x: I256) -> Result<I256, MathError> {
    let eight = i(8) * WAD;
    if x < -eight { return Ok(I256::ZERO); }
    if x > eight { return Ok(WAD); }
    let arg = mul_wad(-x, i(INV_SQRT2))?;
    Ok(erfc_wad(arg)? / i(2))
}

/// φ(x) = exp(−x²/2)/√(2π).
pub fn norm_pdf(x: I256) -> Result<I256, MathError> {
    let e = exp_wad(-(mul_wad(x, x)? / i(2)))?;
    mul_wad(i(INV_SQRT_2PI), e)
}
```

`src/lib.rs` menjadi:
```rust
//! bs-math — Black-Scholes, Greeks, implied-vol solver, EWMA dan batch mark-to-market
//! dalam fixed-point WAD (1e18) atas `I256`/`U256`, tanpa float, tanpa std.
//! Semua fungsi murni; wrapper Stylus ada di crate `bs-stylus`.
#![no_std]
#![deny(unsafe_code)]

#[cfg(test)]
extern crate std;

pub mod constants;
pub mod error;
pub mod fixed;
pub mod exp;
pub mod ln;
pub mod normal;

pub use alloy_primitives::{I256, U256};
pub use error::MathError;
```

- [ ] **Step 4: Jalankan — lolos**

Run: `cd stylus/bs-math && cargo test --test t_normal`
Expected: `test result: ok. 3 passed; 0 failed`

- [ ] **Step 5: Commit**

```bash
git add stylus/bs-math
git commit -m "feat(bs-math): normal CDF/PDF via Cody erfc, symmetric to 1 wei"
```

### Task 7: Black-Scholes: `quote`, `price`, `capped_call` (FR-4, FR-5, FR-9)

**Files:**
- Create: `stylus/bs-math/src/bs.rs`
- Modify: `stylus/bs-math/src/lib.rs` (tambah `pub mod bs;` dan re-export)
- Test: `stylus/bs-math/tests/t_bs.rs`

**Interfaces:**
- Consumes: Task 3 (`fixed`, `error`, `constants`) dan modul sebelumnya.
- Produces: `bs::Quote { price, delta, gamma, vega, theta: I256 }`, `bs::CappedQuote { price, delta, vega: I256 }`, `bs::check_domain(s,k,t,sigma,r) -> Result<(), MathError>`, `bs::quote(s,k,t,sigma,r,is_call) -> Result<Quote, MathError>`, `bs::price(...) -> Result<I256, MathError>`, `bs::capped_call(s,k,cap,t,sigma,r) -> Result<CappedQuote, MathError>` (cap ≤ k → `OutOfDomain(2)`); konstanta domain `S_MIN, S_MAX, T_MIN, T_MAX, SIGMA_MIN, SIGMA_MAX, R_ABS_MAX: i128`. Re-export di root crate.

- [ ] **Step 1: Tulis test yang gagal — `tests/t_bs.rs`**

```rust
//! Task 7: harga, Greeks, capped call — bit-eksak, toleransi float, INV-6..8, FR-9.
mod common;
use bs_math::fixed::{i, WAD};
use bs_math::{capped_call, price, quote, I256, MathError};
use common::f;
use common::vectors_gen::{CAPPED, FLOAT_PRICE, QUOTE};

#[test]
fn quote_bit_exact() {
    for &(s, k, t, sg, r, c, p, d, g, v, th) in QUOTE {
        let q = quote(i(s), i(k), i(t), i(sg), i(r), c).unwrap();
        assert_eq!(q.price, i(p), "price k={k} sg={sg} t={t} r={r} c={c}");
        assert_eq!(q.delta, i(d), "delta");
        assert_eq!(q.gamma, i(g), "gamma");
        assert_eq!(q.vega, i(v), "vega");
        assert_eq!(q.theta, i(th), "theta");
    }
}
#[test]
fn price_vs_float_reference() {
    // ≤ 1e-9 relatif bila harga ≥ 1e-6·S; selain itu ≤ 1e-12·S absolut (granularitas WAD)
    for &(s, k, t, sg, r, c, ref_price) in FLOAT_PRICE {
        let got = f(price(i(s), i(k), i(t), i(sg), i(r), c).unwrap());
        let sf = f(i(s));
        if ref_price >= 1e-6 * sf {
            assert!(((got - ref_price) / ref_price).abs() <= 1e-9, "k={k} sg={sg} t={t}: {got} vs {ref_price}");
        } else {
            assert!((got - ref_price).abs() <= 1e-12 * sf, "k={k} sg={sg} t={t}: {got} vs {ref_price}");
        }
    }
}
#[test]
fn bounds_parity_monotone() {
    let s = i(4000) * WAD; let k = i(4200) * WAD; let t = i(7) * WAD / i(365); let r = I256::ZERO;
    let sg = i(6) * WAD / i(10);
    let c = price(s, k, t, sg, r, true).unwrap();
    let p = price(s, k, t, sg, r, false).unwrap();
    assert!(c >= I256::ZERO && c <= s);                                    // INV-6
    assert!(p >= I256::ZERO && p <= k);
    assert!(((c - p) - (s - k)).abs() <= s / i(1_000_000_000), "parity");  // INV-7
    assert!(price(s, k, t, i(7) * WAD / i(10), r, true).unwrap() > c);     // INV-8: σ ↑
    assert!(price(s, k, i(30) * WAD / i(365), sg, r, true).unwrap() > c);  // T ↑
    assert!(price(s, i(4300) * WAD, t, sg, r, true).unwrap() < c);         // K ↑ → call ↓
}
#[test]
fn domain_errors() {
    let s = i(4000) * WAD; let k = i(4200) * WAD; let t = i(7) * WAD / i(365); let sg = i(6) * WAD / i(10);
    assert_eq!(quote(I256::ZERO, k, t, sg, I256::ZERO, true).unwrap_err(), MathError::OutOfDomain(0));
    assert_eq!(quote(s, k, i(1), sg, I256::ZERO, true).unwrap_err(), MathError::OutOfDomain(2));
    assert_eq!(quote(s, k, t, i(6) * WAD, I256::ZERO, true).unwrap_err(), MathError::OutOfDomain(3));
    assert_eq!(quote(s, k, t, sg, i(2) * WAD, true).unwrap_err(), MathError::OutOfDomain(4));
}
#[test]
fn capped_bit_exact_and_domain() {
    for &(s, k, cap, t, sg, r, p, d, v) in CAPPED {
        let c = capped_call(i(s), i(k), i(cap), i(t), i(sg), i(r)).unwrap();
        assert_eq!(c.price, i(p)); assert_eq!(c.delta, i(d)); assert_eq!(c.vega, i(v));
    }
    let s = i(4000) * WAD;
    assert_eq!(capped_call(s, s, s, WAD, WAD, I256::ZERO).unwrap_err(), MathError::OutOfDomain(2));
}
```

- [ ] **Step 2: Jalankan — harus gagal kompilasi**

Run: `cd stylus/bs-math && cargo test --test t_bs 2>&1 | grep -E "^error" | head -3`
Expected: `error[E0432]: unresolved import` (modul `bs` belum ada).

- [ ] **Step 3: Tulis `src/bs.rs` dan daftarkan di `lib.rs`**

```rust
//! Black-Scholes: harga, Greeks, capped call. Semua nilai WAD; r WAD (boleh negatif); T dalam tahun WAD.
use crate::error::MathError;
use crate::exp::exp_wad;
use crate::fixed::{div_wad, i, mul_wad, sqrt_wad_i, WAD};
use crate::ln::ln_wad;
use crate::normal::{norm_cdf, norm_pdf};
use alloy_primitives::I256;

/// Batas domain (§6.6, FR-9). Semua WAD.
pub const S_MIN: i128 = 1_000_000_000_000;                     // 1e-6
pub const S_MAX: i128 = 1_000_000_000_000_000_000_000_000_000_000; // 1e12
pub const T_MIN: i128 = 1_902_587_519_025;                     // 60 s / 31 536 000 s
pub const T_MAX: i128 = 1_000_000_000_000_000_000;             // 1 tahun
pub const SIGMA_MIN: i128 = 10_000_000_000_000_000;            // 1%
pub const SIGMA_MAX: i128 = 5_000_000_000_000_000_000;         // 500%
pub const R_ABS_MAX: i128 = 1_000_000_000_000_000_000;         // |r| ≤ 100%

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Quote {
    pub price: I256,
    pub delta: I256,
    pub gamma: I256,
    /// per 1,00 vol (bagi 100 untuk per poin)
    pub vega: I256,
    /// per tahun (bagi 365 untuk per hari)
    pub theta: I256,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CappedQuote {
    pub price: I256,
    pub delta: I256,
    pub vega: I256,
}

/// Validasi domain; indeks argumen: 0=s 1=k 2=t 3=sigma 4=r.
pub fn check_domain(s: I256, k: I256, t: I256, sigma: I256, r: I256) -> Result<(), MathError> {
    if s < i(S_MIN) || s > i(S_MAX) { return Err(MathError::OutOfDomain(0)); }
    if k < i(S_MIN) || k > i(S_MAX) { return Err(MathError::OutOfDomain(1)); }
    if t < i(T_MIN) || t > i(T_MAX) { return Err(MathError::OutOfDomain(2)); }
    if sigma < i(SIGMA_MIN) || sigma > i(SIGMA_MAX) { return Err(MathError::OutOfDomain(3)); }
    if r < -i(R_ABS_MAX) || r > i(R_ABS_MAX) { return Err(MathError::OutOfDomain(4)); }
    Ok(())
}

/// Harga + lima Greeks dalam satu evaluasi (FR-4).
pub fn quote(s: I256, k: I256, t: I256, sigma: I256, r: I256, is_call: bool) -> Result<Quote, MathError> {
    check_domain(s, k, t, sigma, r)?;
    let sqrt_t = sqrt_wad_i(t)?;
    let sq = mul_wad(sigma, sqrt_t)?;                         // σ√T
    let half_var = mul_wad(sigma, sigma)? / i(2);
    let d1 = div_wad(ln_wad(div_wad(s, k)?)? + mul_wad(r + half_var, t)?, sq)?;
    let d2 = d1 - sq;
    let disc = exp_wad(-mul_wad(r, t)?)?;
    let kd = mul_wad(k, disc)?;
    let nd1 = norm_cdf(d1)?;
    let nd2 = norm_cdf(d2)?;
    let (price, delta, theta_r) = if is_call {
        (mul_wad(s, nd1)? - mul_wad(kd, nd2)?, nd1, nd2)
    } else {
        (mul_wad(kd, WAD - nd2)? - mul_wad(s, WAD - nd1)?, nd1 - WAD, -(WAD - nd2))
    };
    let pdf = norm_pdf(d1)?;
    let s_pdf = mul_wad(s, pdf)?;
    let gamma = div_wad(pdf, mul_wad(s, sq)?)?;
    let vega = mul_wad(s_pdf, sqrt_t)?;
    let theta = -div_wad(mul_wad(s_pdf, sigma)?, sqrt_t * i(2))? - mul_wad(mul_wad(r, kd)?, theta_r)?;
    let price = if price.is_negative() { I256::ZERO } else { price };
    Ok(Quote { price, delta, gamma, vega, theta })
}

/// Hanya harga.
pub fn price(s: I256, k: I256, t: I256, sigma: I256, r: I256, is_call: bool) -> Result<I256, MathError> {
    Ok(quote(s, k, t, sigma, r, is_call)?.price)
}

/// Call dengan payout cap: C(k) − C(cap); delta & vega gabungan (§6.3, FR-5). cap > k wajib.
pub fn capped_call(s: I256, k: I256, cap: I256, t: I256, sigma: I256, r: I256) -> Result<CappedQuote, MathError> {
    if cap <= k { return Err(MathError::OutOfDomain(2)); }
    let a = quote(s, k, t, sigma, r, true)?;
    let b = quote(s, cap, t, sigma, r, true)?;
    Ok(CappedQuote { price: a.price - b.price, delta: a.delta - b.delta, vega: a.vega - b.vega })
}
```

`src/lib.rs` menjadi:
```rust
//! bs-math — Black-Scholes, Greeks, implied-vol solver, EWMA dan batch mark-to-market
//! dalam fixed-point WAD (1e18) atas `I256`/`U256`, tanpa float, tanpa std.
//! Semua fungsi murni; wrapper Stylus ada di crate `bs-stylus`.
#![no_std]
#![deny(unsafe_code)]

#[cfg(test)]
extern crate std;

pub mod constants;
pub mod error;
pub mod fixed;
pub mod exp;
pub mod ln;
pub mod normal;
pub mod bs;

pub use alloy_primitives::{I256, U256};
pub use error::MathError;
pub use bs::{quote, price, capped_call, Quote, CappedQuote};
```

- [ ] **Step 4: Jalankan — lolos**

Run: `cd stylus/bs-math && cargo test --test t_bs`
Expected: `test result: ok. 5 passed; 0 failed`

- [ ] **Step 5: Commit**

```bash
git add stylus/bs-math
git commit -m "feat(bs-math): Black-Scholes price, Greeks and capped call, bit-exact vs 700 vectors"
```

### Task 8: Implied-vol solver (FR-6)

**Files:**
- Create: `stylus/bs-math/src/solver.rs`
- Modify: `stylus/bs-math/src/lib.rs` (tambah `pub mod solver;` dan re-export)
- Test: `stylus/bs-math/tests/t_solver.rs`

**Interfaces:**
- Consumes: Task 3 (`fixed`, `error`, `constants`) dan modul sebelumnya.
- Produces: `solver::implied_vol(target, s, k, t, r, is_call, lo, hi) -> Result<(I256, u8), MathError>`; `solver::MAX_ITER = 40`. Re-export `implied_vol` di root.

- [ ] **Step 1: Tulis test yang gagal — `tests/t_solver.rs`**

```rust
//! Task 8: implied vol — bit-eksak (σ dan jumlah iterasi), FR-6.
mod common;
use bs_math::fixed::{i, WAD};
use bs_math::{implied_vol, I256, MathError};
use common::vectors_gen::IV;

#[test]
fn implied_vol_bit_exact() {
    let lo = WAD / i(100); let hi = i(5) * WAD;
    for &(tgt, s, k, t, r, c, sg_exp, it_exp) in IV {
        let (sg, it) = implied_vol(i(tgt), i(s), i(k), i(t), i(r), c, lo, hi).unwrap();
        assert_eq!(sg, i(sg_exp), "sigma k={k}");
        assert_eq!(it, it_exp, "iter k={k}");
        assert!(it <= 40);
    }
}
#[test]
fn implied_vol_no_convergence_and_domain() {
    let lo = WAD / i(100); let hi = i(5) * WAD;
    let s = i(4000) * WAD;
    let e = implied_vol(s * i(2), s, s, WAD / i(52), I256::ZERO, true, lo, hi).unwrap_err();
    assert_eq!(e, MathError::NoConvergence(40));                          // target > S mustahil
    assert_eq!(implied_vol(I256::ZERO, s, s, WAD, I256::ZERO, true, lo, hi).unwrap_err(), MathError::OutOfDomain(0));
    assert_eq!(implied_vol(WAD, s, s, WAD, I256::ZERO, true, hi, lo).unwrap_err(), MathError::OutOfDomain(0));
}
```

- [ ] **Step 2: Jalankan — harus gagal kompilasi**

Run: `cd stylus/bs-math && cargo test --test t_solver 2>&1 | grep -E "^error" | head -3`
Expected: `error[E0432]: unresolved import` (modul `solver` belum ada).

- [ ] **Step 3: Tulis `src/solver.rs` dan daftarkan di `lib.rs`**

```rust
//! Implied-vol solver: Newton dengan bracket + fallback bisection (§6.5, FR-6).
use crate::bs::quote;
use crate::constants::TWO_PI;
use crate::error::MathError;
use crate::fixed::{div_wad, i, mul_wad, sqrt_wad_i};
use alloy_primitives::I256;

pub const MAX_ITER: u8 = 40;
/// Vega minimum (WAD) agar langkah Newton dipakai.
const VEGA_MIN: i128 = 1_000_000_000; // 1e-9

/// Mengembalikan (sigma, iterasi). `lo`/`hi` bracket awal (WAD), mis. 1% dan 500%.
/// Toleransi: |ΔP| ≤ max(target/1e8, s/1e14) — relatif untuk harga mikro, absolut untuk harga besar.
pub fn implied_vol(
    target: I256, s: I256, k: I256, t: I256, r: I256, is_call: bool, lo: I256, hi: I256,
) -> Result<(I256, u8), MathError> {
    if target <= I256::ZERO || lo <= I256::ZERO || hi <= lo { return Err(MathError::OutOfDomain(0)); }
    let tol = core::cmp::max(target / i(100_000_000), s / i(100_000_000_000_000));
    // seed Brenner–Subrahmanyam: √(2π/T) · price/S
    let seed = mul_wad(sqrt_wad_i(div_wad(i(TWO_PI), t)?)?, div_wad(target, s)?)?;
    let mut sigma = seed.clamp(lo, hi);
    let (mut lo, mut hi) = (lo, hi);
    for it in 1..=MAX_ITER {
        let q = quote(s, k, t, sigma, r, is_call)?;
        let diff = q.price - target;
        if diff.abs() <= tol { return Ok((sigma, it)); }
        if diff > I256::ZERO { hi = sigma } else { lo = sigma }
        if q.vega > i(VEGA_MIN) {
            let cand = sigma - div_wad(diff, q.vega)?;
            if cand > lo && cand < hi { sigma = cand; continue; }
        }
        sigma = (lo + hi) / i(2);
    }
    Err(MathError::NoConvergence(MAX_ITER))
}
```

`src/lib.rs` menjadi:
```rust
//! bs-math — Black-Scholes, Greeks, implied-vol solver, EWMA dan batch mark-to-market
//! dalam fixed-point WAD (1e18) atas `I256`/`U256`, tanpa float, tanpa std.
//! Semua fungsi murni; wrapper Stylus ada di crate `bs-stylus`.
#![no_std]
#![deny(unsafe_code)]

#[cfg(test)]
extern crate std;

pub mod constants;
pub mod error;
pub mod fixed;
pub mod exp;
pub mod ln;
pub mod normal;
pub mod bs;
pub mod solver;

pub use alloy_primitives::{I256, U256};
pub use error::MathError;
pub use bs::{quote, price, capped_call, Quote, CappedQuote};
pub use solver::implied_vol;
```

- [ ] **Step 4: Jalankan — lolos**

Run: `cd stylus/bs-math && cargo test --test t_solver`
Expected: `test result: ok. 2 passed; 0 failed`

- [ ] **Step 5: Commit**

```bash
git add stylus/bs-math
git commit -m "feat(bs-math): implied vol solver (Newton + bracket + bisection), bit-exact iterations"
```

### Task 9: EWMA realized variance (FR-7)

**Files:**
- Create: `stylus/bs-math/src/ewma.rs`
- Modify: `stylus/bs-math/src/lib.rs` (tambah `pub mod ewma;` dan re-export)
- Test: `stylus/bs-math/tests/t_ewma.rs`

**Interfaces:**
- Consumes: Task 3 (`fixed`, `error`, `constants`) dan modul sebelumnya.
- Produces: `ewma::ewma_update(var_prev, p_prev, p_now, dt_seconds, lambda_per_day) -> Result<I256, MathError>`; `SECONDS_PER_DAY = 86_400`, `SECONDS_PER_YEAR = 31_536_000`. Re-export di root.

- [ ] **Step 1: Tulis test yang gagal — `tests/t_ewma.rs`**

```rust
//! Task 9: EWMA — bit-eksak terhadap urutan §6.4, FR-7.
mod common;
use bs_math::fixed::{i, WAD};
use bs_math::{ewma_update, I256, MathError};
use common::vectors_gen::EWMA;

#[test]
fn ewma_bit_exact() {
    for &(vp, p0, p1, dt, lam, vn) in EWMA {
        assert_eq!(ewma_update(i(vp), i(p0), i(p1), i(dt), i(lam)).unwrap(), i(vn));
    }
}
#[test]
fn ewma_domain() {
    let v = WAD / i(4); let p = i(4000) * WAD;
    assert_eq!(ewma_update(v, I256::ZERO, p, i(60), WAD / i(2)).unwrap_err(), MathError::OutOfDomain(1));
    assert_eq!(ewma_update(v, p, p, I256::ZERO, WAD / i(2)).unwrap_err(), MathError::OutOfDomain(3));
    assert_eq!(ewma_update(v, p, p, i(60), WAD).unwrap_err(), MathError::OutOfDomain(4));
}
```

- [ ] **Step 2: Jalankan — harus gagal kompilasi**

Run: `cd stylus/bs-math && cargo test --test t_ewma 2>&1 | grep -E "^error" | head -3`
Expected: `error[E0432]: unresolved import` (modul `ewma` belum ada).

- [ ] **Step 3: Tulis `src/ewma.rs` dan daftarkan di `lib.rs`**

```rust
//! EWMA realized variance dengan Δt tak beraturan (§6.4, FR-7).
use crate::error::MathError;
use crate::exp::exp_wad;
use crate::fixed::{div_wad, i, mul_wad, WAD};
use crate::ln::ln_wad;
use alloy_primitives::I256;

pub const SECONDS_PER_DAY: i128 = 86_400;
pub const SECONDS_PER_YEAR: i128 = 31_536_000;

/// var_t = λ^(Δt_hari)·var_prev + (1 − λ^(Δt_hari))·r²/Δt_tahun, r = ln(p_now/p_prev).
/// Semua WAD kecuali dt_seconds (integer detik). lambda_per_day ∈ (0, 1).
pub fn ewma_update(var_prev: I256, p_prev: I256, p_now: I256, dt_seconds: I256, lambda_per_day: I256)
    -> Result<I256, MathError>
{
    if var_prev.is_negative() { return Err(MathError::OutOfDomain(0)); }
    if p_prev <= I256::ZERO { return Err(MathError::OutOfDomain(1)); }
    if p_now <= I256::ZERO { return Err(MathError::OutOfDomain(2)); }
    if dt_seconds <= I256::ZERO { return Err(MathError::OutOfDomain(3)); }
    if lambda_per_day <= I256::ZERO || lambda_per_day >= WAD { return Err(MathError::OutOfDomain(4)); }
    let dt_days = dt_seconds * WAD / i(SECONDS_PER_DAY);
    let w = exp_wad(mul_wad(dt_days, ln_wad(lambda_per_day)?)?)?;
    let r = ln_wad(div_wad(p_now, p_prev)?)?;
    let dt_years = dt_seconds * WAD / i(SECONDS_PER_YEAR);
    let inst = div_wad(mul_wad(r, r)?, dt_years)?;
    Ok(mul_wad(w, var_prev)? + mul_wad(WAD - w, inst)?)
}
```

`src/lib.rs` menjadi:
```rust
//! bs-math — Black-Scholes, Greeks, implied-vol solver, EWMA dan batch mark-to-market
//! dalam fixed-point WAD (1e18) atas `I256`/`U256`, tanpa float, tanpa std.
//! Semua fungsi murni; wrapper Stylus ada di crate `bs-stylus`.
#![no_std]
#![deny(unsafe_code)]

#[cfg(test)]
extern crate std;

pub mod constants;
pub mod error;
pub mod fixed;
pub mod exp;
pub mod ln;
pub mod normal;
pub mod bs;
pub mod solver;
pub mod ewma;

pub use alloy_primitives::{I256, U256};
pub use error::MathError;
pub use bs::{quote, price, capped_call, Quote, CappedQuote};
pub use solver::implied_vol;
pub use ewma::ewma_update;
```

- [ ] **Step 4: Jalankan — lolos**

Run: `cd stylus/bs-math && cargo test --test t_ewma`
Expected: `test result: ok. 2 passed; 0 failed`

- [ ] **Step 5: Commit**

```bash
git add stylus/bs-math
git commit -m "feat(bs-math): EWMA realized variance with irregular dt"
```

### Task 10: Batch mark-to-market (FR-8) + build wasm32

**Files:**
- Create: `stylus/bs-math/src/portfolio.rs`
- Modify: `stylus/bs-math/src/lib.rs` (tambah `pub mod portfolio;` dan re-export)
- Test: `stylus/bs-math/tests/t_portfolio.rs`

**Interfaces:**
- Consumes: Task 3 (`fixed`, `error`, `constants`) dan modul sebelumnya.
- Produces: `portfolio::mark_portfolio(s, r, sigma, cap_mult, k: &[I256], t: &[I256], is_call: &[bool], oi: &[I256]) -> Result<(I256, I256), MathError>` (Σ oi·mid, Σ oi·vega; n > 32 → `OutOfDomain(4)`; panjang beda → `LengthMismatch`). Ini `lib.rs` final.

- [ ] **Step 1: Tulis test yang gagal — `tests/t_portfolio.rs`**

```rust
//! Task 10: batch mark-to-market — Σ sama dengan jumlah kuotasi individual, FR-8.
use bs_math::fixed::{i, mul_wad, WAD};
use bs_math::{capped_call, mark_portfolio, quote, I256, MathError};

#[test]
fn portfolio_equals_sum_of_quotes() {
    let s = i(4000) * WAD; let r = I256::ZERO; let sg = i(6) * WAD / i(10); let t7 = i(7) * WAD / i(365);
    let k = [i(4200) * WAD, i(3800) * WAD, i(4000) * WAD];
    let t = [t7, t7, i(30) * WAD / i(365)];
    let is_call = [true, false, true];
    let oi = [i(10) * WAD, i(5) * WAD, I256::ZERO];                       // seri ke-3 OI 0 → dilewati
    let (mid, vega) = mark_portfolio(s, r, sg, i(2) * WAD, &k, &t, &is_call, &oi).unwrap();
    let a = capped_call(s, k[0], k[0] * i(2), t[0], sg, r).unwrap();
    let b = quote(s, k[1], t[1], sg, r, false).unwrap();
    assert_eq!(mid, mul_wad(oi[0], a.price).unwrap() + mul_wad(oi[1], b.price).unwrap());
    assert_eq!(vega, mul_wad(oi[0], a.vega).unwrap() + mul_wad(oi[1], b.vega).unwrap());
}
#[test]
fn portfolio_length_and_size_limits() {
    let s = i(4000) * WAD; let sg = i(6) * WAD / i(10); let t7 = i(7) * WAD / i(365);
    let k = [s, s]; let t = [t7, t7, t7]; let c = [true, false]; let oi = [WAD, WAD];
    assert_eq!(mark_portfolio(s, I256::ZERO, sg, i(2) * WAD, &k, &t, &c, &oi).unwrap_err(), MathError::LengthMismatch);
    let k33 = [s; 33]; let t33 = [t7; 33]; let c33 = [false; 33]; let oi33 = [WAD; 33];
    assert_eq!(mark_portfolio(s, I256::ZERO, sg, i(2) * WAD, &k33, &t33, &c33, &oi33).unwrap_err(), MathError::OutOfDomain(4));
}
```

- [ ] **Step 2: Jalankan — harus gagal kompilasi**

Run: `cd stylus/bs-math && cargo test --test t_portfolio 2>&1 | grep -E "^error" | head -3`
Expected: `error[E0432]: unresolved import` (modul `portfolio` belum ada).

- [ ] **Step 3: Tulis `src/portfolio.rs` dan daftarkan di `lib.rs`**

```rust
//! Batch mark-to-market: Σ OI·mid dan Σ OI·vega dalam satu panggilan (FR-8).
use crate::bs::{capped_call, quote};
use crate::error::MathError;
use crate::fixed::mul_wad;
use alloy_primitives::I256;

/// `cap_mult` WAD (mis. 2e18 → cap = 2K) untuk call; put tanpa cap.
/// Mengembalikan (Σ oi_i·mid_i, Σ oi_i·vega_i). Panjang k/t/is_call/oi harus sama, ≤ 32.
pub fn mark_portfolio(
    s: I256, r: I256, sigma: I256, cap_mult: I256,
    k: &[I256], t: &[I256], is_call: &[bool], oi: &[I256],
) -> Result<(I256, I256), MathError> {
    let n = k.len();
    if t.len() != n || is_call.len() != n || oi.len() != n { return Err(MathError::LengthMismatch); }
    if n > 32 { return Err(MathError::OutOfDomain(4)); }
    let mut sum_mid = I256::ZERO;
    let mut sum_vega = I256::ZERO;
    for idx in 0..n {
        if oi[idx].is_zero() { continue; }
        let (mid, vega) = if is_call[idx] {
            let cap = mul_wad(k[idx], cap_mult)?;
            let c = capped_call(s, k[idx], cap, t[idx], sigma, r)?;
            (c.price, c.vega)
        } else {
            let q = quote(s, k[idx], t[idx], sigma, r, false)?;
            (q.price, q.vega)
        };
        sum_mid = sum_mid + mul_wad(oi[idx], mid)?;
        sum_vega = sum_vega + mul_wad(oi[idx], vega)?;
    }
    Ok((sum_mid, sum_vega))
}
```

`src/lib.rs` menjadi:
```rust
//! bs-math — Black-Scholes, Greeks, implied-vol solver, EWMA dan batch mark-to-market
//! dalam fixed-point WAD (1e18) atas `I256`/`U256`, tanpa float, tanpa std.
//! Semua fungsi murni; wrapper Stylus ada di crate `bs-stylus`.
#![no_std]
#![deny(unsafe_code)]

#[cfg(test)]
extern crate std;

pub mod constants;
pub mod error;
pub mod fixed;
pub mod exp;
pub mod ln;
pub mod normal;
pub mod bs;
pub mod solver;
pub mod ewma;
pub mod portfolio;

pub use alloy_primitives::{I256, U256};
pub use error::MathError;
pub use bs::{quote, price, capped_call, Quote, CappedQuote};
pub use solver::implied_vol;
pub use ewma::ewma_update;
pub use portfolio::mark_portfolio;
```

- [ ] **Step 3b: Seluruh suite dan build wasm32 (bukti no_std bersih)**

Run: `cd stylus/bs-math && cargo test 2>&1 | grep -E "^test result" | awk '{p+=$4; f+=$6} END {print "passed="p" failed="f}'`
Expected: `passed=21 failed=0`

Run: `cd stylus/bs-math && cargo build --release --target wasm32-unknown-unknown 2>&1 | tail -1`
Expected: `Finished \`release\` profile [optimized] target(s)`

- [ ] **Step 4: Jalankan — lolos**

Run: `cd stylus/bs-math && cargo test --test t_portfolio`
Expected: `test result: ok. 2 passed; 0 failed`

- [ ] **Step 5: Commit**

```bash
git add stylus/bs-math
git commit -m "feat(bs-math): batch mark-to-market over up to 32 series; no_std wasm32 build"
```

### Task 11: Program Stylus `bs-stylus` — wrapper ABI, `cargo stylus check`, ekspor `IBlackScholes.sol`

**Files:**
- Create: `stylus/bs-stylus/Cargo.toml`, `stylus/bs-stylus/Stylus.toml`, `stylus/bs-stylus/rust-toolchain.toml`, `stylus/bs-stylus/.cargo/config.toml`, `stylus/bs-stylus/src/lib.rs`, `stylus/bs-stylus/src/main.rs`
- Generate: `contracts/src/interfaces/IBlackScholes.sol`

**Interfaces:**
- Consumes: crate `bs-math` (Task 3–10) lewat `path = "../bs-math"`.
- Produces: kontrak Stylus dengan ABI (nama camelCase): `exp(int256)→uint256`, `ln(uint256)→int256`, `sqrt(uint256)→uint256`, `normCdf(int256)→uint256`, `normPdf(int256)→uint256`, `price(uint256,uint256,uint256,uint256,int256,bool)→uint256`, `quote(...)→(uint256,int256,uint256,uint256,int256)`, `cappedCall(uint256,uint256,uint256,uint256,uint256,int256)→(uint256,int256,int256)`, `impliedVol(uint256,uint256,uint256,uint256,int256,bool,uint256,uint256)→(uint256,uint8)`, `ewmaUpdate(uint256,uint256,uint256,uint256,uint256)→uint256`, `markPortfolio(uint256,int256,uint256,uint256,uint256[],uint256[],bool[],uint256[])→(uint256,int256)`; error `OutOfDomain(uint8)`, `NoConvergence(uint8)`, `LengthMismatch()`, `Overflow()`. Berkas `IBlackScholes.sol` dipakai Task 12.

- [ ] **Step 1: Tulis berkas konfigurasi**

`stylus/bs-stylus/Cargo.toml`:
```toml
[package]
name = "bs-stylus"
version = "0.1.0"
edition = "2024"
description = "Stateless Stylus program exposing bs-math (Black-Scholes, Greeks, IV solver, EWMA) with a Solidity ABI"
license = "MIT"

[dependencies]
alloy-primitives = { version = "1.5.7", default-features = false }
alloy-sol-types = { version = "1.5.7", default-features = false }
stylus-sdk = "0.10.9"
bs-math = { path = "../bs-math" }

[lib]
crate-type = ["lib", "cdylib"]

[features]
default = ["mini-alloc"]
export-abi = ["stylus-sdk/export-abi"]
debug = ["stylus-sdk/debug"]
mini-alloc = ["stylus-sdk/mini-alloc"]
contract-client-gen = []

[profile.release]
codegen-units = 1
strip = true
lto = true
panic = "abort"
opt-level = 3
```

`stylus/bs-stylus/Stylus.toml` (wajib ada; **tanpa** `[wasm-opt]`):
```toml
[workspace]

[workspace.networks]

[contract]
```

`stylus/bs-stylus/rust-toolchain.toml`:
```toml
[toolchain]
channel = "1.92.0"
targets = ["wasm32-unknown-unknown"]
```

`stylus/bs-stylus/.cargo/config.toml` (stack 16 KiB → 1 halaman memori = hemat ~15k gas/panggilan):
```toml
# Stylus menagih ~1000 gas per halaman memori WASM (64 KiB) pada setiap panggilan.
# Stack default Rust 1 MiB = 16 halaman. Matematika kita tidak rekursif dan butuh < 16 KiB.
[target.wasm32-unknown-unknown]
rustflags = ["-C", "link-arg=-zstack-size=16384"]
```

- [ ] **Step 2: Tulis `src/main.rs` dan `src/lib.rs`**

`src/main.rs`:
```rust
#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]

#[cfg(not(any(test, feature = "export-abi")))]
#[unsafe(no_mangle)]
pub extern "C" fn main() {}

#[cfg(feature = "export-abi")]
fn main() {
    bs_stylus::print_from_args();
}
```

`src/lib.rs`:
```rust
//! bs-stylus — program Stylus stateless yang membungkus `bs-math` dengan ABI Solidity (§8.1).
//! Semua fungsi `view` (&self); tidak ada storage, tidak ada panggilan keluar, tidak ada float.
#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]
#![cfg_attr(not(any(test, feature = "export-abi")), no_std)]
extern crate alloc;

use alloc::vec;
use alloc::vec::Vec;
use bs_math::fixed::{to_i};
use bs_math::MathError;
use stylus_sdk::{
    alloy_primitives::{I256, U256},
    alloy_sol_types::sol,
    prelude::*,
};

sol! {
    /// Argumen ke-`arg` (0-based) di luar domain §6.6.
    error OutOfDomain(uint8 arg);
    /// Solver tidak konvergen dalam `iters` iterasi.
    error NoConvergence(uint8 iters);
    /// Panjang array tidak sama.
    error LengthMismatch();
    /// Overflow aritmetika 256-bit.
    error Overflow();
}

#[derive(SolidityError)]
pub enum BsError {
    OutOfDomain(OutOfDomain),
    NoConvergence(NoConvergence),
    LengthMismatch(LengthMismatch),
    Overflow(Overflow),
}

impl From<MathError> for BsError {
    fn from(e: MathError) -> Self {
        match e {
            MathError::OutOfDomain(a) => BsError::OutOfDomain(OutOfDomain { arg: a }),
            MathError::NoConvergence(n) => BsError::NoConvergence(NoConvergence { iters: n }),
            MathError::LengthMismatch => BsError::LengthMismatch(LengthMismatch {}),
            MathError::Overflow => BsError::Overflow(Overflow {}),
        }
    }
}

/// U256 (ABI) → I256; ≥ 2^255 dianggap overflow.
#[inline]
fn si(x: U256) -> Result<I256, BsError> {
    I256::try_from(x).map_err(|_| BsError::Overflow(Overflow {}))
}
/// I256 non-negatif → U256 (ABI). Negatif = bug internal → Overflow.
#[inline]
fn ui(x: I256) -> Result<U256, BsError> {
    if x.is_negative() { return Err(BsError::Overflow(Overflow {})); }
    Ok(x.into_raw())
}

sol_storage! {
    #[entrypoint]
    pub struct BlackScholes {}
}

#[public]
impl BlackScholes {
    /// e^x, x WAD (boleh negatif).
    pub fn exp(&self, x: I256) -> Result<U256, BsError> { ui(bs_math::exp::exp_wad(x)?) }
    /// ln(x), x WAD > 0.
    pub fn ln(&self, x: U256) -> Result<I256, BsError> { Ok(bs_math::ln::ln_wad(si(x)?)?) }
    /// sqrt(x), x WAD.
    pub fn sqrt(&self, x: U256) -> Result<U256, BsError> { Ok(bs_math::fixed::sqrt_wad(x)?) }
    /// Φ(x), x WAD → [0, 1e18].
    pub fn norm_cdf(&self, x: I256) -> Result<U256, BsError> { ui(bs_math::normal::norm_cdf(x)?) }
    /// φ(x), x WAD.
    pub fn norm_pdf(&self, x: I256) -> Result<U256, BsError> { ui(bs_math::normal::norm_pdf(x)?) }

    /// Harga opsi Eropa (WAD).
    pub fn price(&self, s: U256, k: U256, t: U256, sigma: U256, r: I256, is_call: bool) -> Result<U256, BsError> {
        ui(bs_math::price(si(s)?, si(k)?, si(t)?, si(sigma)?, r, is_call)?)
    }
    /// (price, delta, gamma, vega, theta) — WAD; vega per 1,00 vol; theta per tahun.
    pub fn quote(&self, s: U256, k: U256, t: U256, sigma: U256, r: I256, is_call: bool)
        -> Result<(U256, I256, U256, U256, I256), BsError>
    {
        let q = bs_math::quote(si(s)?, si(k)?, si(t)?, si(sigma)?, r, is_call)?;
        Ok((ui(q.price)?, q.delta, ui(q.gamma)?, ui(q.vega)?, q.theta))
    }
    /// (price, delta, vega) untuk C(k) − C(cap). vega bisa negatif (deep-ITM).
    pub fn capped_call(&self, s: U256, k: U256, cap: U256, t: U256, sigma: U256, r: I256)
        -> Result<(U256, I256, I256), BsError>
    {
        let c = bs_math::capped_call(si(s)?, si(k)?, si(cap)?, si(t)?, si(sigma)?, r)?;
        Ok((ui(c.price)?, c.delta, c.vega))
    }
    /// (sigma, iterasi). lo/hi bracket WAD.
    pub fn implied_vol(&self, target: U256, s: U256, k: U256, t: U256, r: I256, is_call: bool, lo: U256, hi: U256)
        -> Result<(U256, u8), BsError>
    {
        let (sg, it) = bs_math::implied_vol(si(target)?, si(s)?, si(k)?, si(t)?, r, is_call, si(lo)?, si(hi)?)?;
        Ok((ui(sg)?, it))
    }
    /// var_new (WAD) — lihat §6.4.
    pub fn ewma_update(&self, var_prev: U256, p_prev: U256, p_now: U256, dt_seconds: U256, lambda_per_day: U256)
        -> Result<U256, BsError>
    {
        ui(bs_math::ewma_update(si(var_prev)?, si(p_prev)?, si(p_now)?, si(dt_seconds)?, si(lambda_per_day)?)?)
    }
    /// (Σ oi·mid, Σ oi·vega) untuk ≤ 32 seri; cap_mult WAD untuk call.
    pub fn mark_portfolio(&self, s: U256, r: I256, sigma: U256, cap_mult: U256,
                          k: Vec<U256>, t: Vec<U256>, is_call: Vec<bool>, oi: Vec<U256>)
        -> Result<(U256, I256), BsError>
    {
        let conv = |v: &Vec<U256>| -> Result<Vec<I256>, BsError> { v.iter().map(|x| si(*x)).collect() };
        let (k, t, oi) = (conv(&k)?, conv(&t)?, conv(&oi)?);
        let (mid, vega) = bs_math::mark_portfolio(si(s)?, r, si(sigma)?, si(cap_mult)?, &k, &t, &is_call, &oi)?;
        Ok((ui(mid)?, vega))
    }
}

// `to_i` dipakai crate lain; simpan re-export kecil agar tidak ada warning unused.
#[allow(dead_code)]
fn _keep(x: U256) -> Result<I256, MathError> { to_i(x) }
```

- [ ] **Step 3: Build wasm dan `cargo stylus check` terhadap Sepolia (test = validasi on-chain oleh node)**

```bash
cd stylus/bs-stylus
cargo build --release --target wasm32-unknown-unknown 2>&1 | tail -1     # expected: Finished `release` ...
cargo stylus check --endpoint https://sepolia-rollup.arbitrum.io/rpc 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "contract size|data fee"
```
Expected (±1 KB): `contract size: 34.3 KB (34346 bytes) (2 fragments)` dan `wasm data fee: 0.0001xx ETH`. Jika muncul `wasm-opt failed` → Anda menaruh `[wasm-opt]` di `Stylus.toml`; hapus. Jika `missing Stylus.toml` → Step 1 belum lengkap.

- [ ] **Step 4: Ekspor ABI dan periksa nama camelCase**

```bash
mkdir -p ../../contracts/src/interfaces
cargo stylus export-abi 2>/dev/null > ../../contracts/src/interfaces/IBlackScholes.sol
grep -c "function" ../../contracts/src/interfaces/IBlackScholes.sol      # expected: 11
grep -E "normCdf|cappedCall|markPortfolio" ../../contracts/src/interfaces/IBlackScholes.sol | wc -l   # expected: 3
head -3 ../../contracts/src/interfaces/IBlackScholes.sol                  # expected: dimulai dengan "/**"
```

- [ ] **Step 5: Commit**

```bash
cd ../..
git add stylus/bs-stylus contracts/src/interfaces/IBlackScholes.sol
git commit -m "feat(bs-stylus): stateless Stylus program exposing bs-math; ABI exported"
```

### Task 12: Kontrol Solidity `BlackScholesSol` + `Bench` + test L3 (Foundry)

**Files:**
- Create: `contracts/foundry.toml`, `contracts/src/math/BlackScholesSol.sol`, `contracts/src/Bench.sol`
- Test: `contracts/test/BlackScholesSol.t.sol` (memakai `contracts/test/VectorsGen.sol` dari Task 2 dan `contracts/src/interfaces/IBlackScholes.sol` dari Task 11)

**Interfaces:**
- Consumes: `IBlackScholes` (Task 11), `BsConstants` (Task 2), PRBMath v4.1.0 (`@prb/math/src/SD59x18.sol`, `UD60x18.sol`).
- Produces: `contract BlackScholesSol is IBlackScholes` (semua fungsi `pure`), `contract Bench { function bench(address target, bytes calldata data) external view returns (uint256 gasUsed, bytes memory ret); }`.

- [ ] **Step 1: Inisialisasi Foundry (tanpa git) dan dependensi**

```bash
cd contracts
forge init . --no-git --force 2>/dev/null || true
rm -f src/Counter.sol test/Counter.t.sol script/Counter.s.sol
forge install foundry-rs/forge-std --no-git
forge install PaulRBerg/prb-math@v4.1.0 --no-git
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
]
EOF
```
(`via_ir = true` wajib: `_quote` menyebabkan "stack too deep" tanpa IR — ini sendiri argumen ergonomi Rust di §16.)

- [ ] **Step 2: Tulis test yang gagal — `test/BlackScholesSol.t.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { BlackScholesSol } from "../src/math/BlackScholesSol.sol";
import { IBlackScholes } from "../src/interfaces/IBlackScholes.sol";
import { VectorsGen } from "./VectorsGen.sol";

/// L3: kontrol Solidity harus BIT-IDENTIK dengan vektor (emulasi Python == crate Rust).
contract BlackScholesSolTest is Test {
    IBlackScholes bs;

    function setUp() public { bs = IBlackScholes(address(new BlackScholesSol())); }

    function test_exp_bit_exact() public view {
        (int256[] memory x, int256[] memory y) = VectorsGen.expV();
        for (uint256 i = 0; i < x.length; i++) assertEq(int256(bs.exp(x[i])), y[i], "exp");
    }
    function test_ln_bit_exact() public view {
        (int256[] memory x, int256[] memory y) = VectorsGen.lnV();
        for (uint256 i = 0; i < x.length; i++) assertEq(bs.ln(uint256(x[i])), y[i], "ln");
    }
    function test_sqrt_bit_exact() public view {
        (uint256[] memory x, uint256[] memory y) = VectorsGen.sqrtV();
        for (uint256 i = 0; i < x.length; i++) assertEq(bs.sqrt(x[i]), y[i], "sqrt");
    }
    function test_phi_bit_exact() public view {
        (int256[] memory x, int256[] memory y) = VectorsGen.phiV();
        for (uint256 i = 0; i < x.length; i++) assertEq(int256(bs.normCdf(x[i])), y[i], "phi");
    }
    function test_quote_bit_exact() public view {
        (int256[] memory s, int256[] memory k, int256[] memory t, int256[] memory sg, int256[] memory r,
         bool[] memory c, int256[] memory p, int256[] memory d, int256[] memory v) = VectorsGen.quoteV();
        for (uint256 i = 0; i < s.length; i++) {
            (uint256 price, int256 delta, , uint256 vega, ) = bs.quote(uint256(s[i]), uint256(k[i]), uint256(t[i]), uint256(sg[i]), r[i], c[i]);
            assertEq(int256(price), p[i], "price");
            assertEq(delta, d[i], "delta");
            assertEq(int256(vega), v[i], "vega");
        }
    }
    function test_parity_and_bounds() public view {
        uint256 s = 4000e18; uint256 k = 4200e18; uint256 t = uint256(7e18) / 365; uint256 sg = 0.6e18;
        uint256 c = bs.price(s, k, t, sg, 0, true);
        uint256 p = bs.price(s, k, t, sg, 0, false);
        assertLe(c, s); assertLe(p, k);
        assertApproxEqAbs(int256(c) - int256(p), int256(s) - int256(k), 4e9, "parity"); // 1e-9·S
    }
    function test_implied_vol_recovers_sigma() public view {
        uint256 s = 4000e18; uint256 t = uint256(7e18) / 365;
        uint256[3] memory ks = [uint256(4200e18), 3000e18, 2600e18];
        bool[3] memory cs = [true, false, false];
        for (uint256 i = 0; i < 3; i++) {
            uint256 target = bs.price(s, ks[i], t, 0.6e18, 0, cs[i]);
            (uint256 sg, uint8 it) = bs.impliedVol(target, s, ks[i], t, 0, cs[i], 0.01e18, 5e18);
            assertApproxEqRel(sg, 0.6e18, 1e9, "iv"); // ≤ 1e-9 relatif
            assertLe(it, 40);
        }
    }
    function test_domain_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(IBlackScholes.OutOfDomain.selector, uint8(3)));
        bs.quote(4000e18, 4200e18, uint256(7e18) / 365, 6e18, 0, true);
        vm.expectRevert(abi.encodeWithSelector(IBlackScholes.OutOfDomain.selector, uint8(0)));
        bs.ln(0);
    }
}
```

- [ ] **Step 3: Jalankan — harus gagal kompilasi**

Run: `cd contracts && forge test 2>&1 | grep -E "Error|not found" | head -2`
Expected: `Source "../src/math/BlackScholesSol.sol" not found` (atau sejenis).

- [ ] **Step 4: Tulis `src/math/BlackScholesSol.sol` dan `src/Bench.sol`**

`src/math/BlackScholesSol.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { SD59x18, sd, exp as prbExp, ln as prbLn } from "@prb/math/src/SD59x18.sol";
import { UD60x18, ud, sqrt as prbSqrt } from "@prb/math/src/UD60x18.sol";
import { IBlackScholes } from "../interfaces/IBlackScholes.sol";
import { BsConstants as K_ } from "./BsConstants.sol";

/// @title BlackScholesSol — implementasi KONTROL (Solidity) dari bs-math.
/// @notice Algoritma dan urutan operasi identik dengan crate Rust `bs-math` agar hasil bit-identik
///         (INV-12) dan perbandingan gas apples-to-apples (§13). exp/ln/sqrt memakai PRBMath v4,
///         yang di-port ke Rust. Tidak untuk produksi — hanya benchmark, test L3, dan Rencana B3.
contract BlackScholesSol is IBlackScholes {
    int256 private constant WAD = 1e18;
    uint8 private constant MAX_ITER = 40;

    // ---------- primitif WAD (trunc toward zero, sama dengan I256 Rust) ----------
    function _mul(int256 a, int256 b) internal pure returns (int256) { return (a * b) / WAD; }
    function _div(int256 a, int256 b) internal pure returns (int256) {
        if (b == 0) revert OutOfDomain(1);
        return (a * WAD) / b;
    }
    function _abs(int256 a) internal pure returns (int256) { return a < 0 ? -a : a; }
    function _si(uint256 x) internal pure returns (int256) {
        if (x > uint256(type(int256).max)) revert Overflow();
        return int256(x);
    }
    function _ui(int256 x) internal pure returns (uint256) {
        if (x < 0) revert Overflow();
        return uint256(x);
    }

    // ---------- exp / ln / sqrt (PRBMath v4) ----------
    function _exp(int256 x) internal pure returns (int256) {
        if (x > K_.EXP_MAX_INPUT) revert OutOfDomain(0);
        if (x < K_.EXP_MIN_THRESHOLD) return 0;
        return prbExp(sd(x)).unwrap();
    }
    function _ln(int256 x) internal pure returns (int256) {
        if (x <= 0) revert OutOfDomain(0);
        return prbLn(sd(x)).unwrap();
    }
    function _sqrt(uint256 x) internal pure returns (uint256) {
        return prbSqrt(ud(x)).unwrap();
    }
    function _sqrtI(int256 x) internal pure returns (int256) {
        if (x < 0) revert OutOfDomain(0);
        return _si(_sqrt(uint256(x)));
    }

    function exp(int256 x) external pure returns (uint256) { return _ui(_exp(x)); }
    function ln(uint256 x) external pure returns (int256) { return _ln(_si(x)); }
    function sqrt(uint256 x) external pure returns (uint256) { return _sqrt(x); }

    // ---------- Φ, φ (Cody / calerf) ----------
    function _erfc(int256 x) internal pure returns (int256) {
        int256 y = _abs(x);
        int256 r;
        if (y <= K_.CODY_THRESH) {
            int256 ysq = y > 111000 ? _mul(y, y) : int256(0);
            int256 xnum = _mul(K_.A4, ysq);
            int256 xden = ysq;
            xnum = _mul(xnum + K_.A0, ysq); xden = _mul(xden + K_.B0, ysq);
            xnum = _mul(xnum + K_.A1, ysq); xden = _mul(xden + K_.B1, ysq);
            xnum = _mul(xnum + K_.A2, ysq); xden = _mul(xden + K_.B2, ysq);
            int256 erf = _mul(x, _div(xnum + K_.A3, xden + K_.B3));
            return WAD - erf;
        } else if (y <= 4 * WAD) {
            int256 xnum = _mul(K_.C8, y);
            int256 xden = y;
            xnum = _mul(xnum + K_.C0, y); xden = _mul(xden + K_.D0, y);
            xnum = _mul(xnum + K_.C1, y); xden = _mul(xden + K_.D1, y);
            xnum = _mul(xnum + K_.C2, y); xden = _mul(xden + K_.D2, y);
            xnum = _mul(xnum + K_.C3, y); xden = _mul(xden + K_.D3, y);
            xnum = _mul(xnum + K_.C4, y); xden = _mul(xden + K_.D4, y);
            xnum = _mul(xnum + K_.C5, y); xden = _mul(xden + K_.D5, y);
            xnum = _mul(xnum + K_.C6, y); xden = _mul(xden + K_.D6, y);
            int256 q = _div(xnum + K_.C7, xden + K_.D7);
            r = _mul(_exp(-_mul(y, y)), q);
        } else {
            int256 ysq = _div(WAD, _mul(y, y));
            int256 xnum = _mul(K_.P5, ysq);
            int256 xden = ysq;
            xnum = _mul(xnum + K_.P0, ysq); xden = _mul(xden + K_.Q0, ysq);
            xnum = _mul(xnum + K_.P1, ysq); xden = _mul(xden + K_.Q1, ysq);
            xnum = _mul(xnum + K_.P2, ysq); xden = _mul(xden + K_.Q2, ysq);
            xnum = _mul(xnum + K_.P3, ysq); xden = _mul(xden + K_.Q3, ysq);
            int256 q = _mul(ysq, _div(xnum + K_.P4, xden + K_.Q4));
            q = _div(K_.SQRPI - q, y);
            r = _mul(_exp(-_mul(y, y)), q);
        }
        return x < 0 ? 2 * WAD - r : r;
    }
    function _normCdf(int256 x) internal pure returns (int256) {
        if (x < -8 * WAD) return 0;
        if (x > 8 * WAD) return WAD;
        return _erfc(_mul(-x, K_.INV_SQRT2)) / 2;
    }
    function _normPdf(int256 x) internal pure returns (int256) {
        return _mul(K_.INV_SQRT_2PI, _exp(-(_mul(x, x) / 2)));
    }
    function normCdf(int256 x) external pure returns (uint256) { return _ui(_normCdf(x)); }
    function normPdf(int256 x) external pure returns (uint256) { return _ui(_normPdf(x)); }

    // ---------- Black-Scholes ----------
    struct Q { int256 price; int256 delta; int256 gamma; int256 vega; int256 theta; }

    function _checkDomain(int256 s, int256 k, int256 t, int256 sigma, int256 r) internal pure {
        if (s < K_.S_MIN || s > K_.S_MAX) revert OutOfDomain(0);
        if (k < K_.S_MIN || k > K_.S_MAX) revert OutOfDomain(1);
        if (t < K_.T_MIN || t > K_.T_MAX) revert OutOfDomain(2);
        if (sigma < K_.SIGMA_MIN || sigma > K_.SIGMA_MAX) revert OutOfDomain(3);
        if (r < -K_.R_ABS_MAX || r > K_.R_ABS_MAX) revert OutOfDomain(4);
    }

    function _quote(int256 s, int256 k, int256 t, int256 sigma, int256 r, bool isCall) internal pure returns (Q memory q) {
        _checkDomain(s, k, t, sigma, r);
        int256 sqrtT = _sqrtI(t);
        int256 sq = _mul(sigma, sqrtT);
        int256 halfVar = _mul(sigma, sigma) / 2;
        int256 d1 = _div(_ln(_div(s, k)) + _mul(r + halfVar, t), sq);
        int256 d2 = d1 - sq;
        int256 disc = _exp(-_mul(r, t));
        int256 kd = _mul(k, disc);
        int256 nd1 = _normCdf(d1);
        int256 nd2 = _normCdf(d2);
        int256 thetaR;
        if (isCall) {
            q.price = _mul(s, nd1) - _mul(kd, nd2); q.delta = nd1; thetaR = nd2;
        } else {
            q.price = _mul(kd, WAD - nd2) - _mul(s, WAD - nd1); q.delta = nd1 - WAD; thetaR = -(WAD - nd2);
        }
        int256 pdf = _normPdf(d1);
        int256 sPdf = _mul(s, pdf);
        q.gamma = _div(pdf, _mul(s, sq));
        q.vega = _mul(sPdf, sqrtT);
        q.theta = -_div(_mul(sPdf, sigma), sqrtT * 2) - _mul(_mul(r, kd), thetaR);
        if (q.price < 0) q.price = 0;
    }

    function price(uint256 s, uint256 k, uint256 t, uint256 sigma, int256 r, bool isCall) external pure returns (uint256) {
        return _ui(_quote(_si(s), _si(k), _si(t), _si(sigma), r, isCall).price);
    }
    function quote(uint256 s, uint256 k, uint256 t, uint256 sigma, int256 r, bool isCall)
        external pure returns (uint256, int256, uint256, uint256, int256)
    {
        Q memory q = _quote(_si(s), _si(k), _si(t), _si(sigma), r, isCall);
        return (_ui(q.price), q.delta, _ui(q.gamma), _ui(q.vega), q.theta);
    }
    function _capped(int256 s, int256 k, int256 cap, int256 t, int256 sigma, int256 r)
        internal pure returns (int256 p, int256 d, int256 v)
    {
        if (cap <= k) revert OutOfDomain(2);
        Q memory a = _quote(s, k, t, sigma, r, true);
        Q memory b = _quote(s, cap, t, sigma, r, true);
        return (a.price - b.price, a.delta - b.delta, a.vega - b.vega);
    }
    function cappedCall(uint256 s, uint256 k, uint256 cap, uint256 t, uint256 sigma, int256 r)
        external pure returns (uint256, int256, int256)
    {
        (int256 p, int256 d, int256 v) = _capped(_si(s), _si(k), _si(cap), _si(t), _si(sigma), r);
        return (_ui(p), d, v);
    }

    // ---------- implied vol (Newton + bracket + bisection) ----------
    function impliedVol(uint256 target_, uint256 s_, uint256 k_, uint256 t_, int256 r, bool isCall, uint256 lo_, uint256 hi_)
        external pure returns (uint256, uint8)
    {
        int256 target = _si(target_); int256 s = _si(s_); int256 k = _si(k_); int256 t = _si(t_);
        int256 lo = _si(lo_); int256 hi = _si(hi_);
        if (target <= 0 || lo <= 0 || hi <= lo) revert OutOfDomain(0);
        int256 tolA = target / 1e8; int256 tolB = s / 1e14;
        int256 tol = tolA > tolB ? tolA : tolB;
        int256 sigma = _mul(_sqrtI(_div(K_.TWO_PI, t)), _div(target, s));
        if (sigma < lo) sigma = lo;
        if (sigma > hi) sigma = hi;
        for (uint8 it = 1; it <= MAX_ITER; it++) {
            Q memory q = _quote(s, k, t, sigma, r, isCall);
            int256 diff = q.price - target;
            if (_abs(diff) <= tol) return (_ui(sigma), it);
            if (diff > 0) hi = sigma; else lo = sigma;
            if (q.vega > 1e9) {
                int256 cand = sigma - _div(diff, q.vega);
                if (cand > lo && cand < hi) { sigma = cand; continue; }
            }
            sigma = (lo + hi) / 2;
        }
        revert NoConvergence(MAX_ITER);
    }

    // ---------- EWMA ----------
    function ewmaUpdate(uint256 varPrev_, uint256 pPrev_, uint256 pNow_, uint256 dt_, uint256 lambda_) external pure returns (uint256) {
        int256 varPrev = _si(varPrev_); int256 pPrev = _si(pPrev_); int256 pNow = _si(pNow_);
        int256 dt = _si(dt_); int256 lambda = _si(lambda_);
        if (pPrev <= 0) revert OutOfDomain(1);
        if (pNow <= 0) revert OutOfDomain(2);
        if (dt <= 0) revert OutOfDomain(3);
        if (lambda <= 0 || lambda >= WAD) revert OutOfDomain(4);
        int256 dtDays = dt * WAD / 86400;
        int256 w = _exp(_mul(dtDays, _ln(lambda)));
        int256 lr = _ln(_div(pNow, pPrev));
        int256 dtYears = dt * WAD / 31536000;
        int256 inst = _div(_mul(lr, lr), dtYears);
        return _ui(_mul(w, varPrev) + _mul(WAD - w, inst));
    }

    // ---------- batch mark-to-market ----------
    function markPortfolio(uint256 s_, int256 r, uint256 sigma_, uint256 capMult_,
        uint256[] memory k, uint256[] memory t, bool[] memory isCall, uint256[] memory oi)
        external pure returns (uint256, int256)
    {
        uint256 n = k.length;
        if (t.length != n || isCall.length != n || oi.length != n) revert LengthMismatch();
        if (n > 32) revert OutOfDomain(4);
        int256 s = _si(s_); int256 sigma = _si(sigma_); int256 capMult = _si(capMult_);
        int256 sumMid; int256 sumVega;
        for (uint256 i = 0; i < n; i++) {
            if (oi[i] == 0) continue;
            int256 oiI = _si(oi[i]);
            int256 mid; int256 vega;
            if (isCall[i]) {
                int256 kk = _si(k[i]);
                (mid, , vega) = _capped(s, kk, _mul(kk, capMult), _si(t[i]), sigma, r);
            } else {
                Q memory q = _quote(s, _si(k[i]), _si(t[i]), sigma, r, false);
                (mid, vega) = (q.price, q.vega);
            }
            sumMid += _mul(oiI, mid);
            sumVega += _mul(oiI, vega);
        }
        return (_ui(sumMid), sumVega);
    }
}
```

`src/Bench.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Harness gas: mengukur biaya STATICCALL ke `target` (termasuk overhead panggilan & init program Stylus).
contract Bench {
    function bench(address target, bytes calldata data) external view returns (uint256 gasUsed, bytes memory ret) {
        uint256 g0 = gasleft();
        (bool ok, bytes memory r) = target.staticcall(data);
        gasUsed = g0 - gasleft();
        require(ok, "target reverted");
        ret = r;
    }
}
```

- [ ] **Step 5: Jalankan — 8 lolos (bit-identik dengan vektor = dengan Rust)**

Run: `cd contracts && forge test -vv 2>&1 | grep -E "^\[|Suite result"`
Expected:
```
[PASS] test_domain_reverts() ...
[PASS] test_exp_bit_exact() ...
[PASS] test_implied_vol_recovers_sigma() ...
[PASS] test_ln_bit_exact() ...
[PASS] test_parity_and_bounds() ...
[PASS] test_phi_bit_exact() ...
[PASS] test_quote_bit_exact() ...
[PASS] test_sqrt_bit_exact() ...
Suite result: ok. 8 passed; 0 failed; 0 skipped
```
Catatan gas dari laporan Foundry (rujukan §13): `test_quote_bit_exact` ≈ 2,65M untuk 100 kuotasi → ≈ 26k per `quote`; `test_phi_bit_exact` ≈ 514k / 69 → ≈ 7,4k per `normCdf`.

- [ ] **Step 6: Commit**

```bash
cd ..
git add contracts/foundry.toml contracts/src contracts/test contracts/.gitignore contracts/README.md 2>/dev/null
git add contracts
git commit -m "feat(contracts): Solidity control BlackScholesSol (PRBMath v4 + Cody), Bench harness, L3 exact tests"
```
(`contracts/lib/` di-commit sebagai salinan biasa karena `--no-git`; jika ingin submodule, ganti ke `forge install` tanpa `--no-git` setelah repo punya remote.)

### Task 13: Devnode (ArbOS 61), deployment, dan cek on-chain bit-eksak (L4)

**Files:**
- Create: `tools/devnode/up.sh`, `tools/devnode/deploy.sh`, `tools/bench/onchain-check.sh`
- Generate (gitignored): `deployments/devnode.json`

**Interfaces:**
- Consumes: `bs-stylus` (Task 11), `BlackScholesSol` & `Bench` (Task 12), `wad_emul.py` (Task 2).
- Produces: `deployments/<name>.json` dengan kunci `rpc, chainId, arbOSVersion, stylusVersion, blackScholesStylus, blackScholesSol, bench, programInitGas ("<uncached> <cached>"), programMemoryFootprintPages`; skrip cek yang exit ≠ 0 bila ada selisih.

- [ ] **Step 1: Tulis `tools/devnode/up.sh`**

```bash
#!/usr/bin/env bash
# Menjalankan nitro-devnode (Docker) dengan Stylus v3 + fragmen, lalu meng-upgrade ArbOS ke 61.
# Pakai: tools/devnode/up.sh            (blocking; Ctrl-C mematikan container)
# Env:   NITRO_NODE_VERSION (default v3.11.4-7d5ac27), ARBOS_TARGET (default 61)
set -euo pipefail
NITRO_NODE_VERSION="${NITRO_NODE_VERSION:-v3.11.4-7d5ac27}"
ARBOS_TARGET="${ARBOS_TARGET:-61}"
RPC=http://127.0.0.1:8547
PK=0xb6b15c8cb491557369f3c7d2c287b053eb229daa9c22138887752191c9520659   # akun dev pre-funded (publik)
DIR="$(cd "$(dirname "$0")" && pwd)/.nitro-devnode"
if [ ! -d "$DIR" ]; then git clone --depth 1 https://github.com/OffchainLabs/nitro-devnode.git "$DIR"; fi
export NITRO_NODE_VERSION
( cd "$DIR" && ./run-dev-node.sh ) &
NODE_PID=$!
trap 'kill $NODE_PID 2>/dev/null || true; docker rm -f nitro-dev >/dev/null 2>&1 || true' INT TERM EXIT
for _ in $(seq 1 120); do
  if grep -q "Nitro node is running... (press" <(docker logs nitro-dev 2>&1 || true) 2>/dev/null; then break; fi
  if cast call --rpc-url $RPC 0x0000000000000000000000000000000000000071 "stylusVersion()(uint16)" >/dev/null 2>&1 \
     && cast code --rpc-url $RPC 0xcEcba2F1DC234f70Dd89F2041029807F8D03A990 2>/dev/null | grep -qv "^0x$"; then break; fi
  sleep 3
done
CUR=$(cast call --rpc-url $RPC 0x0000000000000000000000000000000000000064 "arbOSVersion()(uint64)")
if [ "$CUR" -lt $((ARBOS_TARGET + 55)) ]; then
  echo "Upgrade ArbOS $((CUR - 55)) → $ARBOS_TARGET (dibutuhkan untuk deployment multi-fragmen)"
  cast send --rpc-url $RPC --private-key $PK 0x0000000000000000000000000000000000000070 \
    "scheduleArbOSUpgrade(uint64,uint64)" $ARBOS_TARGET 0 >/dev/null
  cast send --rpc-url $RPC --private-key $PK 0x0000000000000000000000000000000000000001 --value 1 >/dev/null
fi
echo "devnode siap: chain $(cast chain-id --rpc-url $RPC), arbOSVersion $(cast call --rpc-url $RPC 0x0000000000000000000000000000000000000064 'arbOSVersion()(uint64)'), stylusVersion $(cast call --rpc-url $RPC 0x0000000000000000000000000000000000000071 'stylusVersion()(uint16)'), maxFragments $(cast call --rpc-url $RPC 0x000000000000000000000000000000000000006b 'getMaxStylusContractFragments()(uint256)')"
wait $NODE_PID
```

- [ ] **Step 2: Tulis `tools/devnode/deploy.sh`**

```bash
#!/usr/bin/env bash
# Deploy program Stylus (bs-stylus), kontrol BlackScholesSol, dan Bench ke sebuah RPC; tulis deployments/<name>.json.
# Pakai: tools/devnode/deploy.sh <name> <rpc> <private_key>      contoh: tools/devnode/deploy.sh devnode http://127.0.0.1:8547 0xb6b1...
set -euo pipefail
NAME=$1; RPC=$2; PK=$3
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/stylus/bs-stylus"
OUT=$(cargo stylus deploy --endpoint "$RPC" --private-key "$PK" --no-verify 2>&1 | sed 's/\x1b\[[0-9;]*m//g')
echo "$OUT" | grep -E "contract size|deployed code at|activated" || { echo "$OUT"; exit 1; }
STYLUS=$(echo "$OUT" | grep "deployed code at address" | awk '{print $NF}')
cd "$ROOT/contracts"
SOL=$(forge create --rpc-url "$RPC" --private-key "$PK" --broadcast src/math/BlackScholesSol.sol:BlackScholesSol | grep "Deployed to" | awk '{print $3}')
BENCH=$(forge create --rpc-url "$RPC" --private-key "$PK" --broadcast src/Bench.sol:Bench | grep "Deployed to" | awk '{print $3}')
mkdir -p "$ROOT/deployments"
cat > "$ROOT/deployments/$NAME.json" <<JSON
{
  "network": "$NAME",
  "rpc": "$RPC",
  "chainId": $(cast chain-id --rpc-url "$RPC"),
  "arbOSVersion": $(cast call --rpc-url "$RPC" 0x0000000000000000000000000000000000000064 "arbOSVersion()(uint64)"),
  "stylusVersion": $(cast call --rpc-url "$RPC" 0x0000000000000000000000000000000000000071 "stylusVersion()(uint16)"),
  "blackScholesStylus": "$STYLUS",
  "blackScholesSol": "$SOL",
  "bench": "$BENCH",
  "programInitGas": "$(cast call --rpc-url "$RPC" 0x0000000000000000000000000000000000000071 "programInitGas(address)(uint64,uint64)" "$STYLUS" | awk "{print \$1}" | tr "\n" " " | sed "s/ *$//")",
  "programMemoryFootprintPages": $(cast call --rpc-url "$RPC" 0x0000000000000000000000000000000000000071 "programMemoryFootprint(address)(uint16)" "$STYLUS"),
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
cat "$ROOT/deployments/$NAME.json"
```

- [ ] **Step 3: Tulis test on-chain — `tools/bench/onchain-check.sh`**

```bash
#!/usr/bin/env bash
# L4: bandingkan keluaran on-chain (Stylus DAN kontrol Solidity) dengan emulasi Python (bit-eksak). Exit ≠ 0 bila beda.
# Pakai: tools/bench/onchain-check.sh deployments/<name>.json
set -euo pipefail
DEP=$1
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RPC=$(jq -r .rpc "$DEP"); STYLUS=$(jq -r .blackScholesStylus "$DEP"); SOL=$(jq -r .blackScholesSol "$DEP")
WAD=1000000000000000000; S=4000000000000000000000; K=4200000000000000000000; T7=$((7*WAD/365)); SG=600000000000000000
readarray -t EXP < <(cd "$ROOT/tools/reference" && python3 -c "
from wad_emul import *
W=10**18; T7=7*W//365
print(norm_cdf_wad(-545600000000000000)); print(exp_wad(-W)); print(ln_wad(2*W)); print(sqrt_wad(2*W))
print(*bs_quote_wad(4000*W, 4200*W, T7, 6*W//10, 0, True))
print(*capped_call_wad(4000*W, 4200*W, 8400*W, T7, 6*W//10, 0))
print(*implied_vol_wad(bs_quote_wad(4000*W, 4200*W, T7, 6*W//10, 0, True)[0], 4000*W, 4200*W, T7, 0, True))
print(ewma_update_wad(302500000000000000, 4000*W, 4020*W, 21600, 94*W//100))")
fail=0
check() { # label expected actual
  if [ "$2" == "$3" ]; then echo "OK   $1"; else echo "BEDA $1: expected=$2 actual=$3"; fail=1; fi
}
for T in "$STYLUS" "$SOL"; do
  echo "== target $T =="
  check normCdf "${EXP[0]}" "$(cast call --rpc-url $RPC $T 'normCdf(int256)(uint256)' -- -545600000000000000 | awk '{print $1}')"
  check exp     "${EXP[1]}" "$(cast call --rpc-url $RPC $T 'exp(int256)(uint256)' -- -$WAD | awk '{print $1}')"
  check ln      "${EXP[2]}" "$(cast call --rpc-url $RPC $T 'ln(uint256)(int256)' $((2*WAD)) | awk '{print $1}')"
  check sqrt    "${EXP[3]}" "$(cast call --rpc-url $RPC $T 'sqrt(uint256)(uint256)' $((2*WAD)) | awk '{print $1}')"
  check quote   "${EXP[4]}" "$(cast call --rpc-url $RPC $T 'quote(uint256,uint256,uint256,uint256,int256,bool)(uint256,int256,uint256,uint256,int256)' $S $K $T7 $SG 0 true | awk '{print $1}' | tr '\n' ' ' | sed 's/ *$//')"
  check capped  "${EXP[5]}" "$(cast call --rpc-url $RPC $T 'cappedCall(uint256,uint256,uint256,uint256,uint256,int256)(uint256,int256,int256)' $S $K 8400000000000000000000 $T7 $SG 0 | awk '{print $1}' | tr '\n' ' ' | sed 's/ *$//')"
  PRICE=${EXP[4]%% *}
  check iv      "${EXP[6]}" "$(cast call --rpc-url $RPC $T 'impliedVol(uint256,uint256,uint256,uint256,int256,bool,uint256,uint256)(uint256,uint8)' $PRICE $S $K $T7 0 true 10000000000000000 5000000000000000000 | awk '{print $1}' | tr '\n' ' ' | sed 's/ *$//')"
  check ewma    "${EXP[7]}" "$(cast call --rpc-url $RPC $T 'ewmaUpdate(uint256,uint256,uint256,uint256,uint256)(uint256)' 302500000000000000 $S 4020000000000000000000 21600 940000000000000000 | awk '{print $1}')"
done
exit $fail
```

- [ ] **Step 4: Nyalakan devnode (terminal terpisah, blocking) dan tunggu "devnode siap"**

```bash
chmod +x tools/devnode/*.sh tools/bench/*.sh
tools/devnode/up.sh
```
Expected (setelah pull image ± beberapa menit): `devnode siap: chain 412346, arbOSVersion 116, stylusVersion 3, maxFragments 4`. Jika `arbOSVersion` tetap 114, upgrade gagal — cek bahwa akun dev adalah chain owner (skrip nitro-devnode memanggil `becomeChainOwner`).

- [ ] **Step 5: Deploy dan jalankan cek — semua `OK`**

```bash
tools/devnode/deploy.sh devnode http://127.0.0.1:8547 0xb6b15c8cb491557369f3c7d2c287b053eb229daa9c22138887752191c9520659
tools/bench/onchain-check.sh deployments/devnode.json; echo "exit=$?"
```
Expected: `deployments/devnode.json` berisi `"programMemoryFootprintPages": 1` dan `"programInitGas": "313xx 49xx"`; cek mencetak 16 baris `OK` (8 untuk Stylus, 8 untuk Solidity) dan `exit=0`. Jika `deploy` revert dengan `data: "0x"` → ArbOS belum 61 (fragmen tidak didukung). Jika `cast call` revert kosong → nama fungsi bukan camelCase.

- [ ] **Step 6: Commit** (`deployments/devnode.json` sengaja di-gitignore — alamat devnode tidak stabil)

```bash
git add tools/devnode tools/bench/onchain-check.sh
git commit -m "feat(tools): devnode bring-up with ArbOS 61, deployment script, on-chain exactness check"
```

### Task 14: Benchmark gas apples-to-apples → `docs/BENCHMARK.md`

**Files:**
- Create: `tools/bench/bench.sh`, `docs/BENCHMARK.md`

**Interfaces:**
- Consumes: `deployments/devnode.json` (Task 13), `Bench.bench(address,bytes)`.
- Produces: tabel markdown §13 (kolom Solidity, Stylus tanpa cache, Stylus cached turunan, rasio).

- [ ] **Step 1: Tulis `tools/bench/bench.sh`**

```bash
#!/usr/bin/env bash
# Benchmark gas: STATICCALL ke target via Bench.bench(address,bytes) — apples-to-apples (§13).
set -euo pipefail
# Pakai: tools/bench/bench.sh deployments/<name>.json   → tabel markdown ke stdout
DEP=$1
RPC=$(jq -r .rpc "$DEP"); STYLUS=$(jq -r .blackScholesStylus "$DEP"); SOL=$(jq -r .blackScholesSol "$DEP"); BENCH=$(jq -r .bench "$DEP")
INIT=$(cast call --rpc-url $RPC 0x0000000000000000000000000000000000000071 "programInitGas(address)(uint64,uint64)" $STYLUS | awk '{print $1}')
INIT_UNCACHED=$(echo "$INIT" | sed -n 1p); INIT_CACHED=$(echo "$INIT" | sed -n 2p)
DELTA=$((INIT_UNCACHED - INIT_CACHED))
WAD=1000000000000000000
S=4000000000000000000000; K=4200000000000000000000; T7=$((7*WAD/365)); SG=600000000000000000
P2600=2600000000000000000000
bench() { # name calldata
  local name=$1 data=$2
  local a b
  a=$(cast call --rpc-url $RPC $BENCH "bench(address,bytes)(uint256,bytes)" $SOL $data | head -1 | awk '{print $1}')
  b=$(cast call --rpc-url $RPC $BENCH "bench(address,bytes)(uint256,bytes)" $STYLUS $data | head -1 | awk '{print $1}')
  local c=$((b - DELTA))
  printf "| %-42s | %9s | %9s | %9s | %5.1f× |\n" "$name" "$a" "$b" "$c" "$(echo "scale=2; $a/$c" | bc)"
}
echo "programInitGas: uncached=$INIT_UNCACHED cached=$INIT_CACHED (kolom cached = terukur − $DELTA, turunan)"
echo
echo "| Operasi | Solidity (kontrol) | Stylus tanpa cache | Stylus cached (turunan) | Rasio cached |"
echo "|---|---|---|---|---|"
bench "normCdf(-0.5456)" "$(cast calldata 'normCdf(int256)' -- -545600000000000000)"
bench "exp(-1)" "$(cast calldata 'exp(int256)' -- -1000000000000000000)"
bench "ln(2)" "$(cast calldata 'ln(uint256)' 2000000000000000000)"
bench "quote C4200 7d 60% (harga+4 Greeks)" "$(cast calldata 'quote(uint256,uint256,uint256,uint256,int256,bool)' $S $K $T7 $SG 0 true)"
bench "cappedCall C4200 cap 8400" "$(cast calldata 'cappedCall(uint256,uint256,uint256,uint256,uint256,int256)' $S $K 8400000000000000000000 $T7 $SG 0)"
PRICE=$(cast call --rpc-url $RPC $SOL "price(uint256,uint256,uint256,uint256,int256,bool)(uint256)" $S $K $T7 $SG 0 true | awk '{print $1}')
bench "impliedVol C4200 (5 iterasi)" "$(cast calldata 'impliedVol(uint256,uint256,uint256,uint256,int256,bool,uint256,uint256)' $PRICE $S $K $T7 0 true 10000000000000000 5000000000000000000)"
PRICE2=$(cast call --rpc-url $RPC $SOL "price(uint256,uint256,uint256,uint256,int256,bool)(uint256)" $S $P2600 $T7 $SG 0 false | awk '{print $1}')
bench "impliedVol P2600 deep-OTM (20 iterasi)" "$(cast calldata 'impliedVol(uint256,uint256,uint256,uint256,int256,bool,uint256,uint256)' $PRICE2 $S $P2600 $T7 0 false 10000000000000000 5000000000000000000)"
bench "ewmaUpdate" "$(cast calldata 'ewmaUpdate(uint256,uint256,uint256,uint256,uint256)' 302500000000000000 4000000000000000000000 4020000000000000000000 21600 940000000000000000)"
# markPortfolio 32 seri: 16 call + 16 put, strike 3400..5880 step 80, OI 1 ETH (python: bash int 64-bit overflow)
ARR=$(python3 -c "
W=10**18; T7=7*W//365
ks=[3400*W+i*80*W for i in range(32)]
print('['+','.join(map(str,ks))+']', '['+','.join([str(T7)]*32)+']', '['+','.join(['true' if i%2==0 else 'false' for i in range(32)])+']', '['+','.join([str(W)]*32)+']')")
set -- $ARR; KS=$1; TS=$2; CS=$3; OIS=$4
bench "markPortfolio 32 seri (1 panggilan)" "$(cast calldata 'markPortfolio(uint256,int256,uint256,uint256,uint256[],uint256[],bool[],uint256[])' $S 0 $SG 2000000000000000000 "$KS" "$TS" "$CS" "$OIS")"
```

- [ ] **Step 2: Jalankan (devnode dari Task 13 masih hidup)**

Run: `tools/bench/bench.sh deployments/devnode.json`
Expected (toleransi ±2% per sel; rasio harus sama pada satu desimal):
```
programInitGas: uncached=31376 cached=4997 (kolom cached = terukur − 26379, turunan)

| Operasi | Solidity (kontrol) | Stylus tanpa cache | Stylus cached (turunan) | Rasio cached |
|---|---|---|---|---|
| normCdf(-0.5456)                           |      5435 |     35080 |      8701 |   0.6× |
| exp(-1)                                    |      6144 |     35713 |      9334 |   0.6× |
| ln(2)                                      |      3559 |     34431 |      8052 |   0.4× |
| quote C4200 7d 60% (harga+4 Greeks)        |     24536 |     41590 |     15211 |   1.6× |
| cappedCall C4200 cap 8400                  |     40886 |     46968 |     20589 |   2.0× |
| impliedVol C4200 (5 iterasi)               |    121321 |     73942 |     47563 |   2.5× |
| impliedVol P2600 deep-OTM (20 iterasi)     |    616839 |    250126 |    223747 |   2.8× |
| ewmaUpdate                                 |     22082 |     41178 |     14799 |   1.5× |
| markPortfolio 32 seri (1 panggilan)        |   1242892 |    454201 |    427822 |   2.9× |
```
Jika `normCdf` Stylus > 45k → `programMemoryFootprint` bukan 1 (stack flag tidak terpakai; cek `.cargo/config.toml` ada di `stylus/bs-stylus`). Jika rasio `markPortfolio` < 2,5× → `opt-level` bukan 3.

- [ ] **Step 3: Tulis `docs/BENCHMARK.md`** (tempel keluaran Step 2 di bawah header ini)

```markdown
# Benchmark gas — Stylus vs Solidity (bit-identik)

Lingkungan: `nitro-devnode` `offchainlabs/nitro-node:v3.11.4-7d5ac27` di-upgrade ke ArbOS 61 (Stylus v3), L1 fee = 0;
`cargo-stylus`/`stylus-sdk` 0.10.9, rustc 1.92, `opt-level = 3`, stack 16 KiB, 2 fragmen, tanpa cache;
kontrol `solc 0.8.28` via-IR (200 runs), PRBMath v4.1.0. Pengukuran: `gasleft()` di sekitar `STATICCALL` dari `Bench.sol`.
Kolom "cached" = terukur − (programInitGas uncached − cached), turunan (CacheManager devnode adalah stub).
Semua keluaran identik antara kedua implementasi (`tools/bench/onchain-check.sh`).

<tempel tabel dari tools/bench/bench.sh di sini>

## Micro-benchmark biaya marjinal (gas per pasangan mul_wad + div_wad, loop 1.000 iterasi)

| Tipe | gas / pasangan |
|---|---|
| EVM Solidity (`MUL`/`DIV` 5 gas) | ≈ 30–40 |
| Stylus `I256` (ruint, limb 64-bit) | 105 |
| Stylus `i128` Q64.64 | 29 |
| Stylus `u64` | 0,5 |

Kesimpulan: rasio 2,6–2,9× pada lingkaran datang dari alur kontrol/loop/ABI yang murah di WASM; aritmetika 256-bit itu sendiri 3× lebih mahal daripada opcode EVM. Bukan 10×. Lihat PRD §13 dan §2.4.
```

- [ ] **Step 4: Commit**

```bash
git add tools/bench/bench.sh docs/BENCHMARK.md
git commit -m "docs: measured Stylus vs Solidity gas benchmark (2.6-2.9x on loops, <1x single calls uncached)"
```

### Task 15: Deploy ke Arbitrum Sepolia dan cek on-chain

**Files:**
- Create: `deployments/arbitrum-sepolia.json` (di-commit), `.env` (gitignored, berisi `PRIVATE_KEY=0x…` akun testnet berdana ≥ 0,01 ETH)

**Interfaces:**
- Consumes: `tools/devnode/deploy.sh`, `tools/bench/onchain-check.sh` (Task 13) — keduanya generik terhadap RPC.
- Produces: alamat publik `blackScholesStylus`, `blackScholesSol`, `bench` di Sepolia untuk Plan 2/3 (`MATH_ADDR`).

- [ ] **Step 1: Siapkan kunci dan dana**

```bash
echo "PRIVATE_KEY=0x<kunci testnet>" > .env          # jangan pernah commit; .gitignore sudah mencakup .env
grep -q "^.env$" .gitignore && echo ignored
source .env
cast balance --rpc-url https://sepolia-rollup.arbitrum.io/rpc $(cast wallet address --private-key $PRIVATE_KEY)   # expected: ≥ 10000000000000000 (0,01 ETH); jika 0 → faucet (V8)
```

- [ ] **Step 2: Deploy (aktivasi ≈ 0,00015 ETH + deploy 2 fragmen + 2 kontrak Solidity)**

Run: `tools/devnode/deploy.sh arbitrum-sepolia https://sepolia-rollup.arbitrum.io/rpc $PRIVATE_KEY`
Expected: JSON dengan `"chainId": 421614`, `"arbOSVersion": 116`, `"stylusVersion": 3`, `"programMemoryFootprintPages": 1`, tiga alamat non-kosong.

- [ ] **Step 3: Cek on-chain bit-eksak di Sepolia**

Run: `tools/bench/onchain-check.sh deployments/arbitrum-sepolia.json; echo "exit=$?"`
Expected: 16 × `OK`, `exit=0`.

- [ ] **Step 4 (opsional): Coba cache program di Sepolia**

Run: `cd stylus/bs-stylus && cargo stylus cache bid --endpoint https://sepolia-rollup.arbitrum.io/rpc --private-key $PRIVATE_KEY $(jq -r .blackScholesStylus ../../deployments/arbitrum-sepolia.json) 0; cd ../..`
Lalu: `CH=$(cast keccak $(cast code --rpc-url https://sepolia-rollup.arbitrum.io/rpc $(jq -r .blackScholesStylus deployments/arbitrum-sepolia.json))); cast call --rpc-url https://sepolia-rollup.arbitrum.io/rpc 0x0000000000000000000000000000000000000072 "codehashIsCached(bytes32)(bool)" $CH`
Expected: `true` bila slot cache tersedia dengan bid 0; bila `false`, catat di `docs/BENCHMARK.md` ("cache tidak diperoleh dengan bid 0") — bukan kegagalan task. Jika `true`, jalankan `tools/bench/bench.sh deployments/arbitrum-sepolia.json` dan tambahkan hasilnya (kolom "tanpa cache" kini adalah angka cached sesungguhnya) ke `docs/BENCHMARK.md`.

- [ ] **Step 5: Commit**

```bash
git add deployments/arbitrum-sepolia.json docs/BENCHMARK.md
git commit -m "deploy: bs-stylus, BlackScholesSol and Bench on Arbitrum Sepolia; on-chain exactness verified"
```

### Task 16: CI — emulasi, generator, Rust, `cargo stylus check`, Foundry

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: semua task sebelumnya.
- Produces: pipeline yang gagal bila berkas generated tidak identik dengan generator (mencegah edit manual pada konstanta/vektor), bila test Rust/Foundry gagal, atau bila program tidak lagi lolos `cargo stylus check`.

- [ ] **Step 1: Tulis workflow**

`.github/workflows/ci.yml`:
```yaml
name: ci
on: [push, pull_request]
jobs:
  reference:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - name: selftest emulasi WAD
        run: python3 tools/reference/wad_emul.py
      - name: konstanta & vektor yang di-commit harus identik dengan generator
        run: |
          python3 tools/reference/gen_constants.py /tmp/c.rs /tmp/c.sol
          diff /tmp/c.rs stylus/bs-math/src/constants.rs && diff /tmp/c.sol contracts/src/math/BsConstants.sol
          python3 tools/reference/gen_vectors.py /tmp/v.rs /tmp/v.sol
          diff /tmp/v.rs stylus/bs-math/tests/common/vectors_gen.rs && diff /tmp/v.sol contracts/test/VectorsGen.sol
  rust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with: { targets: wasm32-unknown-unknown }
      - name: bs-math L1
        run: cd stylus/bs-math && cargo test
      - name: bs-stylus wasm build
        run: cd stylus/bs-stylus && cargo build --release --target wasm32-unknown-unknown
      - name: cargo stylus check (Sepolia publik)
        run: |
          cargo install cargo-stylus --version 0.10.9 --locked
          cd stylus/bs-stylus && cargo stylus check --endpoint https://sepolia-rollup.arbitrum.io/rpc
  foundry:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: foundry-rs/foundry-toolchain@v1
      - name: L3 kontrol Solidity
        run: |
          cd contracts
          forge install foundry-rs/forge-std --no-git
          forge install PaulRBerg/prb-math@v4.1.0 --no-git
          forge test
```

- [ ] **Step 2: Reproduksi lokal langkah "reference" (test-nya adalah `diff` kosong)**

```bash
python3 tools/reference/gen_constants.py /tmp/c.rs /tmp/c.sol && diff /tmp/c.rs stylus/bs-math/src/constants.rs && diff /tmp/c.sol contracts/src/math/BsConstants.sol && echo constants-identik
python3 tools/reference/gen_vectors.py /tmp/v.rs /tmp/v.sol && diff /tmp/v.rs stylus/bs-math/tests/common/vectors_gen.rs && diff /tmp/v.sol contracts/test/VectorsGen.sol && echo vectors-identik
```
Expected: `constants-identik` dan `vectors-identik` tanpa keluaran diff.

- [ ] **Step 3: Commit dan (bila remote ada) push untuk melihat CI hijau**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: reference selftest, generated-file drift check, cargo test, stylus check, forge test"
```

---

## Self-review (dilakukan penulis rencana)

**Spec coverage.** §5.1 FR-1..FR-10 → Task 3–11 (FR-1 stateless: `sol_storage!` kosong & `&self`; FR-2 integer only; FR-3 `t_normal.rs`; FR-4 `quote`; FR-5 `capped_call`; FR-6 `t_solver.rs`; FR-7 `t_ewma.rs`; FR-8 `t_portfolio.rs` + `markPortfolio` ABI; FR-9 `domain_errors`; FR-10 Task 12). §6 seluruh rumus → modul terkait; §6.7 angka → vektor. §8.1–8.2 → Task 11–12. §9.1–9.7 → Task 1, 11, 13 (upgrade ArbOS, stack, fragmen, camelCase, CacheManager stub). §10.1 → Task 2. §13 baris matematika → Task 14; baris `buy`/`deposit` sengaja ditunda ke Plan 2 (butuh pool). §18 V1–V5, V10, V15 → Task 1/11/13; V6–V9, V11–V14 adalah verifikasi manusia (ditandai ⬜). INV-5..8, INV-12 → test L1/L3/L4. Tidak ada FR/INV di ruang lingkup Plan 1 yang tanpa task.

**Placeholder scan.** Tidak ada TBD/TODO; setiap langkah kode memuat berkas lengkap yang sudah dieksekusi. Satu-satunya isian manusia: `.env` (kunci) dan baris ⬜ di `docs/VERIFICATION.md`.

**Type consistency.** Nama & tipe diperiksa silang: `mark_portfolio` mengembalikan `(I256, I256)` di Rust ↔ `(uint256, int256)` di ABI/Solidity (Σvega bisa negatif); `capped_call` `CappedQuote.vega: I256` ↔ `int256`; `implied_vol` `(I256, u8)` ↔ `(uint256, uint8)`; `ewma_update` argumen `dt_seconds: I256` ↔ `uint256`; konstanta `TWO_PI` identik (Decimal, bukan float) di Rust, Solidity, Python. Nama fungsi ABI camelCase di semua `cast call`.

**Dependensi antar-task.** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 (linear; Task 12 bisa dikerjakan paralel dengan 11 jika `IBlackScholes.sol` diambil dari §8.2 PRD, tetapi urutan linear lebih aman).
