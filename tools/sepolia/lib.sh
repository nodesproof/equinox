#!/usr/bin/env bash
# Pustaka bersama skrip Sepolia. Sumber: .env (kunci, RPC) + deployments/arbitrum-sepolia.json (alamat).
# Kunci hanya lewat env var; tidak pernah dicetak. Pakai: source tools/sepolia/lib.sh (setelah ROOT diset).
set -euo pipefail
ROOT="${ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
DEP="$ROOT/deployments/arbitrum-sepolia.json"
[ -f "$ROOT/.env" ] && { set -a; source "$ROOT/.env"; set +a; }
: "${SEPOLIA_PRIVATE_KEY:?SEPOLIA_PRIVATE_KEY tidak ada — isi .env (git-ignored)}"
PK="$SEPOLIA_PRIVATE_KEY"
RPC="${SEPOLIA_RPC_URL:-$(jq -r .rpc "$DEP")}"
ME=$(cast wallet address --private-key "$PK")
CHAIN=$(cast chain-id --rpc-url "$RPC"); [ "$CHAIN" == "421614" ] || { echo "chain $CHAIN bukan Arbitrum Sepolia (421614)"; exit 1; }

die() { echo "GAGAL: $*" >&2; exit 1; }
# alamat huruf kecil dari cast call
addr() { cast call --rpc-url "$RPC" "$1" "$2" "${@:3}" | awk '{print tolower($1)}'; }
# angka tanpa anotasi [1.2e3]
num() { cast call --rpc-url "$RPC" "$1" "$2" "${@:3}" | awk '{print $1}'; }
# kirim tx; cetak "txhash gasUsed"; gagal keras bila revert. Pakai lewat command substitution — res=$(send …) —
# supaya kegagalan menghentikan skrip (errexit); JANGAN lewat process substitution (< <(send …)), yang menelan exit code.
send() {
  local out; out=$(cast send --rpc-url "$RPC" --private-key "$PK" "$@" 2>&1) || { echo "$out" | tail -3 >&2; die "cast send $1 $2"; }
  echo "$out" | awk '/^transactionHash[[:space:]]/ {h=$2} /^gasUsed[[:space:]]/ {g=$2} END {print h, g}'
}
# tulis JSON in-place: jq_set '<filter>' [--arg k v …]
jq_set() { local f=$1; shift; local tmp; tmp=$(mktemp); jq "$@" "$f" "$DEP" > "$tmp" && mv "$tmp" "$DEP"; }
lower() { echo "$1" | tr '[:upper:]' '[:lower:]'; }
arbiscan() { echo "https://sepolia.arbiscan.io/tx/$1"; }
