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
# sama, di-pin pada blok: numat BLK addr sig args…
numat() { cast call --rpc-url "$RPC" --block "$1" "$2" "$3" "${@:4}" | awk '{print $1}'; }
# field ke-i (1-based) dari tuple cast "(a [x], b [y], …)", tanpa anotasi
field() { tr -d '()' <<< "$1" | awk -F', ' -v i="$2" '{print $i}' | awk '{print $1}'; }
# kirim tx; cetak "txhash gasUsed"; gagal keras bila revert. Pakai lewat command substitution — res=$(send …) —
# supaya kegagalan menghentikan skrip (errexit); JANGAN lewat process substitution (< <(send …)), yang menelan exit code.
# Gas limit = 1,5 × eth_estimateGas: estimasi Nitro adalah gas minimum tanpa margin, dan gas minimum `buy`/`close`
# naik bersama `block.timestamp` (demo 20 Sep: 0x1262c6cb…, limit == estimasi 349.720, tx masuk 2 s kemudian, kurang
# ≈ 750 gas → out-of-gas). Bahaya kedua: round Chainlink baru di antara estimasi dan eksekusi membuat `vol.poke()`
# menempuh jalur penuh (≈ +25k gas). Bantalan 1,5× menutup keduanya; gas sisa dikembalikan.
# `cast send` keluar 0 walau receipt status 0, maka status dicek eksplisit.
send() {
  local est out
  est=$(cast estimate --rpc-url "$RPC" --from "$ME" "$@" 2>/dev/null) || { cast estimate --rpc-url "$RPC" --from "$ME" "$@" 2>&1 >/dev/null | tail -3 >&2; die "estimate $1 $2 (revert?)"; }
  [[ "$est" =~ ^[0-9]+$ ]] || die "estimate: $est"
  out=$(cast send --rpc-url "$RPC" --private-key "$PK" --gas-limit $(( est * 3 / 2 )) "$@" 2>&1) || { echo "$out" | tail -3 >&2; die "cast send $1 $2"; }
  grep -Eq '^status[[:space:]]+1' <<< "$out" || { grep -E '^(transactionHash|status|gasUsed)[[:space:]]' <<< "$out" >&2; die "tx gagal (revert/out-of-gas) $1 $2"; }
  echo "$out" | awk '/^transactionHash[[:space:]]/ {h=$2} /^gasUsed[[:space:]]/ {g=$2} END {print h, g}'
}
# tulis JSON in-place: jq_set '<filter>' [--arg k v …]
jq_set() { local f=$1; shift; local tmp; tmp=$(mktemp); jq "$@" "$f" "$DEP" > "$tmp" && mv "$tmp" "$DEP"; }
lower() { echo "$1" | tr '[:upper:]' '[:lower:]'; }
arbiscan() { echo "https://sepolia.arbiscan.io/tx/$1"; }
