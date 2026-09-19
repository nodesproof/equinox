# Referensi numerik untuk prd-arsitektur.md §6 — Python 3, hanya stdlib.
# Jalankan: python3 bs_numbers.py
import math

SQRT2 = math.sqrt(2.0)
def Phi(x):            # exact (double) standard normal CDF via erfc
    return 0.5 * math.erfc(-x / SQRT2)
def phi(x):
    return math.exp(-0.5 * x * x) / math.sqrt(2 * math.pi)

def Phi_AS(x):         # Abramowitz-Stegun 26.2.17 (|err| < 7.5e-8), typical Solidity choice
    p = 0.2316419
    b = [0.319381530, -0.356563782, 1.781477937, -1.821255978, 1.330274429]
    if x < 0:
        return 1.0 - Phi_AS(-x)
    t = 1.0 / (1.0 + p * x)
    poly = t*(b[0] + t*(b[1] + t*(b[2] + t*(b[3] + t*b[4]))))
    return 1.0 - phi(x) * poly

def bs(S, K, T, sigma, r=0.0, call=True, cdf=Phi):
    sq = sigma * math.sqrt(T)
    d1 = (math.log(S / K) + (r + 0.5 * sigma**2) * T) / sq
    d2 = d1 - sq
    disc = math.exp(-r * T)
    if call:
        price = S * cdf(d1) - K * disc * cdf(d2)
        delta = cdf(d1)
    else:
        price = K * disc * cdf(-d2) - S * cdf(-d1)
        delta = cdf(d1) - 1.0
    gamma = phi(d1) / (S * sq)
    vega  = S * phi(d1) * math.sqrt(T)          # per 1.00 of vol (i.e. per 100 vol points)
    theta = (-S * phi(d1) * sigma / (2 * math.sqrt(T))
             - (r * K * disc * cdf(d2) if call else -r * K * disc * cdf(-d2)))
    return dict(price=price, d1=d1, d2=d2, delta=delta, gamma=gamma, vega=vega/100, theta=theta/365)

def implied_vol(target, S, K, T, r=0.0, call=True, tol=1e-10, maxit=50):
    # Brenner-Subrahmanyam seed, then Newton with vega; count iterations
    sigma = math.sqrt(2 * math.pi / T) * target / S
    sigma = min(max(sigma, 0.05), 3.0)
    for i in range(1, maxit + 1):
        q = bs(S, K, T, sigma, r, call)
        diff = q['price'] - target
        if abs(diff) < tol:
            return sigma, i
        v = q['vega'] * 100
        if v < 1e-12:
            break
        sigma -= diff / v
        sigma = min(max(sigma, 0.01), 5.0)
    return sigma, maxit

if __name__ == "__main__":
    S = 4000.0
    T7 = 7 / 365
    print("=== KUOTASI CONTOH (S=4000, T=7 hari, sigma=60%, r=0) ===")
    for K, call in [(4200, True), (3800, False), (4000, True), (4000, False), (3000, False), (5200, True)]:
        q = bs(S, K, T7, 0.60, 0.0, call)
        print(f"{'CALL' if call else 'PUT '} K={K}: price={q['price']:.4f}  d1={q['d1']:.4f} d2={q['d2']:.4f} "
              f"delta={q['delta']:.4f} gamma={q['gamma']:.6f} vega/1vol={q['vega']:.4f} theta/day={q['theta']:.4f}")

    print("\n=== PUT-CALL PARITY CHECK K=4200 ===")
    c = bs(S, 4200, T7, 0.60, 0, True)['price']; p = bs(S, 4200, T7, 0.60, 0, False)['price']
    print(f"C - P = {c-p:.6f} ; S - K = {S-4200:.6f}")

    print("\n=== CAPPED CALL: C(K) - C(2K) vs C(K) ===")
    for K, sig, T in [(4200, 0.60, T7), (4000, 0.60, T7), (4200, 0.60, 30/365), (4000, 1.00, 30/365), (4000, 1.50, 30/365)]:
        ck = bs(S, K, T, sig, 0, True)['price']; c2k = bs(S, 2*K, T, sig, 0, True)['price']
        print(f"K={K} sigma={sig:.0%} T={T*365:.0f}d: C(K)={ck:.4f}  C(2K)={c2k:.6f}  cap discount={c2k/ck*100:.5f}%")

    print("\n=== PRESISI EKOR: Phi A&S (err~7.5e-8) vs eksak; dampak harga put deep-OTM ===")
    print("d      Phi_exact        Phi_AS           abs err      rel err")
    for d in [-1, -2, -3, -4, -4.5, -5, -5.5, -6]:
        e = Phi(d); a = Phi_AS(d)
        print(f"{d:5.1f}  {e:.6e}  {a:.6e}  {a-e:+.2e}  {(a-e)/e*100:+8.3f}%")

    print("\nHarga put deep-OTM, S=4000, sigma=60%, r=0 — eksak vs A&S:")
    print("K      T(d)  d2        P_exact       P_AS        rel err   (per 1 ETH notional)")
    for K, Td in [(3000, 7), (2600, 7), (2400, 7), (2200, 7), (3000, 3), (2600, 3), (2000, 30), (1600, 30)]:
        T = Td / 365
        pe = bs(S, K, T, 0.60, 0, False, Phi); pa = bs(S, K, T, 0.60, 0, False, Phi_AS)
        print(f"{K:5d}  {Td:3d}   {pe['d2']:+.3f}  {pe['price']:.6f}  {pa['price']:.6f}  {(pa['price']-pe['price'])/pe['price']*100:+8.2f}%")

    print("\n=== NEWTON IV SOLVE (iterasi sampai |dP|<1e-10) ===")
    for K, sig, call in [(4200, 0.60, True), (4000, 0.60, False), (3000, 0.60, False), (5200, 0.60, True), (4200, 1.20, True), (4200, 0.30, True)]:
        target = bs(S, K, T7, sig, 0, call)['price']
        iv, it = implied_vol(target, S, K, T7, 0, call)
        print(f"K={K} sigma_true={sig:.2f} {'C' if call else 'P'}: price={target:.6f} -> iv={iv:.8f} in {it} iterasi")

    print("\n=== EWMA realized vol (lambda=0.94/hari), sampel tak beraturan ===")
    # annualised variance from log return r over dt days: r^2 / (dt/365)
    lam = 0.94
    var = 0.55**2
    prices = [(4000, 0), (4020, 0.25), (3960, 0.5), (4100, 1.0), (4080, 1.5), (3900, 2.0)]
    for i in range(1, len(prices)):
        p0, t0 = prices[i-1]; p1, t1 = prices[i]
        dt = t1 - t0
        r = math.log(p1 / p0)
        inst = r * r / (dt / 365)
        lam_dt = lam ** dt
        var = lam_dt * var + (1 - lam_dt) * inst
        print(f"t={t1:4.2f}d  P={p1}  r={r:+.5f}  inst_vol={math.sqrt(inst):.2%}  ewma_vol={math.sqrt(var):.2%}")

    print("\n=== DAMPAK INVENTARIS (Lyra-style) ===")
    # sigma_quote = sigma_base * VRP * (1 + alpha * netVegaUtil)
    sigma_base, VRP, alpha = 0.55, 1.15, 0.30
    for util in [0.0, 0.2, 0.5, 0.8, -0.3]:
        sq = sigma_base * VRP * (1 + alpha * util)
        c = bs(S, 4200, T7, sq, 0, True)['price']
        print(f"netVegaUtil={util:+.1f}: sigma_quote={sq:.2%}  C(4200,7d)={c:.4f}")

    print("\n=== CADANGAN & UTILISASI ===")
    pool = 1_000_000
    for n, K in [(10, 4200), (50, 4200), (100, 4000)]:
        print(f"jual {n} kontrak K={K}: reserve = {n*K:,} USDG = {n*K/pool:.1%} dari pool 1,000,000")
