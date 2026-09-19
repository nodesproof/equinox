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
