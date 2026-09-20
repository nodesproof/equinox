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
