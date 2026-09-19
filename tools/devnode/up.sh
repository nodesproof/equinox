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
