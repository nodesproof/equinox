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
printf "| buy 10 C4200 (ERC-20 + ERC-1155 + 5 panggilan math: 3× sqrt + 2× cappedCall) | %s | %s | %.2fx |\n" "$G_BUY_A" "$G_BUY_B" "$(echo "scale=2; $G_BUY_A/$G_BUY_B" | bc)"
printf "| close 5 (ERC-20 + ERC-1155 + 5 panggilan math: 3× sqrt + 2× cappedCall) | %s | %s | %.2fx |\n" "$G_CLOSE_A" "$G_CLOSE_B" "$(echo "scale=2; $G_CLOSE_A/$G_CLOSE_B" | bc)"
printf "| deposit dengan 6 seri terbuka (NAV MtM; 5 panggilan math: 3× sqrt + 2× markPortfolio) | %s | %s | %.2fx |\n" "$G_DEP_A" "$G_DEP_B" "$(echo "scale=2; $G_DEP_A/$G_DEP_B" | bc)"
exit $fail
