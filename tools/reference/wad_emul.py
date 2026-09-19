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
