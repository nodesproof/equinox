#!/usr/bin/env bash
# Deploy program Stylus (bs-stylus), kontrol BlackScholesSol, dan Bench ke sebuah RPC; tulis deployments/<name>.json.
# Pakai: tools/devnode/deploy.sh <name> <rpc> <private_key>      contoh: tools/devnode/deploy.sh devnode http://127.0.0.1:8547 0xb6b1...
set -euo pipefail
NAME=$1; RPC=$2; PK=$3
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/stylus/bs-stylus"
OUT=$(cargo stylus deploy --endpoint "$RPC" --private-key "$PK" --no-verify 2>&1 | sed 's/\x1b\[[0-9;]*m//g') || true
echo "$OUT" | grep -E "contract size|deployed code at|activated" || { echo "$OUT"; exit 1; }
STYLUS=$(echo "$OUT" | grep "deployed code at address" | awk '{print $NF}')
cd "$ROOT/contracts"
SOL=$(forge create --rpc-url "$RPC" --private-key "$PK" --broadcast src/math/BlackScholesSol.sol:BlackScholesSol | grep "Deployed to" | awk '{print $3}')
BENCH=$(forge create --rpc-url "$RPC" --private-key "$PK" --broadcast src/Bench.sol:Bench | grep "Deployed to" | awk '{print $3}')
[ -n "$STYLUS" ] && [ -n "$SOL" ] && [ -n "$BENCH" ] || { echo "deploy gagal: STYLUS='$STYLUS' SOL='$SOL' BENCH='$BENCH'"; exit 1; }
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
