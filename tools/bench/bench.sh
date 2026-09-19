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
ret_mismatch=0   # 1 bila bytes return (baris ke-2 keluaran Bench.bench) berbeda antara kedua implementasi
bench() { # name calldata
  local name=$1 data=$2
  local oa ob a b ra rb
  oa=$(cast call --rpc-url $RPC $BENCH "bench(address,bytes)(uint256,bytes)" $SOL $data)
  ob=$(cast call --rpc-url $RPC $BENCH "bench(address,bytes)(uint256,bytes)" $STYLUS $data)
  a=$(echo "$oa" | awk 'NR==1{print $1}'); ra=$(echo "$oa" | awk 'NR==2{print $1}')
  b=$(echo "$ob" | awk 'NR==1{print $1}'); rb=$(echo "$ob" | awk 'NR==2{print $1}')
  if [ "$ra" != "$rb" ]; then echo "BEDA-RET $name" >&2; ret_mismatch=1; fi
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
exit $ret_mismatch
