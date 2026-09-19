# Referensi numerik lanjutan untuk prd-arsitektur.md §6.5–6.7 — Python 3, hanya stdlib.
# Jalankan: python3 bs_extra.py
import math
from bs_numbers import bs, Phi, phi

S=4000.0; T7=7/365

def iv_safeguarded(target,S,K,T,call,lo=0.01,hi=5.0,tol=1e-10,maxit=60):
    # Newton dari seed BS dengan bracket; jika langkah keluar bracket / vega kecil -> bisection step
    f = lambda s: bs(S,K,T,s,0,call)['price']-target
    flo, fhi = f(lo), f(hi)
    sigma = min(max(math.sqrt(2*math.pi/T)*target/S, lo), hi)
    n_newton = n_bisect = 0
    for i in range(1,maxit+1):
        q = bs(S,K,T,sigma,0,call); diff=q['price']-target
        if abs(diff)<tol: return sigma,i,n_newton,n_bisect
        if diff>0: hi=sigma
        else: lo=sigma
        v=q['vega']*100
        step_ok = v>1e-9
        if step_ok:
            cand = sigma-diff/v
            if lo<cand<hi:
                sigma=cand; n_newton+=1; continue
        sigma=0.5*(lo+hi); n_bisect+=1
    return sigma,maxit,n_newton,n_bisect

print("=== IV SOLVE: Newton + bracket/bisection fallback ===")
for K,sig,call in [(4200,.6,True),(4000,.6,False),(3000,.6,False),(5200,.6,True),(2600,.6,False),(4200,1.2,True),(4200,.3,True)]:
    tgt=bs(S,K,T7,sig,0,call)['price']
    iv,it,nn,nb=iv_safeguarded(tgt,S,K,T7,call)
    print(f"K={K} sig={sig:.2f} {'C' if call else 'P'}: price={tgt:.6f} -> iv={iv:.8f} iter={it} (newton {nn}, bisect {nb})")

print("\n=== SENSITIVITAS: salah 10 poin vol ===")
for K,call,Td in [(4000,True,7),(4200,True,7),(4000,True,30)]:
    T=Td/365
    p60=bs(S,K,T,.60,0,call)['price']; p70=bs(S,K,T,.70,0,call)['price']; p50=bs(S,K,T,.50,0,call)['price']
    print(f"K={K} T={Td}d: C@50%={p50:.2f}  C@60%={p60:.2f}  C@70%={p70:.2f}  -> +10 vol = {(p70-p60)/p60*100:+.1f}% premi; -10 vol = {(p50-p60)/p60*100:+.1f}%")

print("\n=== SKENARIO SETTLEMENT (10 call K=4200 dijual @ sigma_quote 63.25%) ===")
prem=bs(S,4200,T7,.6325,0,True)['price']*10
for ST in [3800,4200,4300,4500,5000,8400,9000]:
    payout=min(max(ST-4200,0),4200)*10
    print(f"S_T={ST}: premi diterima={prem:.2f}  payout={payout:.2f}  PnL LP={prem-payout:+.2f}  (cadangan 42,000)")

print("\n=== LYRA-STYLE TRUNCATION: Phi(x)=0 untuk x<-4.5 -> harga call deep OTM ===")
def Phi_trunc(x): return 0.0 if x<-4.5 else Phi(x)
for K in [5200,5600,6000]:
    e=bs(S,K,T7,.6,0,True,Phi)['price']; t=bs(S,K,T7,.6,0,True,Phi_trunc)['price']
    d2=bs(S,K,T7,.6,0,True)['d2']
    print(f"CALL K={K} d2={d2:+.2f}: eksak={e:.6f}  truncated={t:.6f}")
