#!/usr/bin/env bash
# Keeper Equinox (Sepolia): poke engine vol bersama, settle board yang sudah expiry (round segar ≥ expiry), laporan kesehatan.
# Sistem tidak bergantung padanya untuk keselamatan (§10.3) — ia hanya mempercepat. Idempoten; revert settle yang sah ditoleransi.
# Settle adalah jalur kritis: kegagalan kesehatan (RPC), poke, atau satu settle tidak boleh menghentikan settle berikutnya.
# Pakai: KEEPER_PRIVATE_KEY=0x… [SEPOLIA_RPC_URL=…] [DRY_RUN=1] tools/keeper/keeper.sh [deployments/arbitrum-sepolia.json]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEP="${1:-$ROOT/deployments/arbitrum-sepolia.json}"
: "${KEEPER_PRIVATE_KEY:?KEEPER_PRIVATE_KEY tidak ada}"
PK="$KEEPER_PRIVATE_KEY"; RPC="${SEPOLIA_RPC_URL:-$(jq -r .rpc "$DEP")}"; DRY="${DRY_RUN:-0}"
ME=$(cast wallet address --private-key "$PK")
VOL=$(jq -r .pools.vol "$DEP"); A=$(jq -r .pools.A.pool "$DEP"); B=$(jq -r .pools.B.pool "$DEP")
FEED=$(jq -r .pools.feed "$DEP"); SEQ=$(jq -r .pools.sequencerFeed "$DEP"); STYLUS=$(jq -r .blackScholesStylus "$DEP")
num() { cast call --rpc-url "$RPC" "$1" "$2" "${@:3}" | awk '{print $1}'; }
# kirim tx dari wallet keeper: estimasi dulu (revert → return 1, tidak ada tx), gas limit 1,5× estimasi (estimasi Nitro tanpa margin;
# round Chainlink baru antara estimasi dan eksekusi menambah ≈ 25k gas lewat jalur EWMA penuh), receipt harus status 1.
ksend() {  # target sig args... → "txhash gasUsed" | return 1
  local est out
  est=$(cast estimate --rpc-url "$RPC" --from "$ME" "$@" 2>/dev/null) || { echo "  estimasi gagal: $(cast estimate --rpc-url "$RPC" --from "$ME" "$@" 2>&1 >/dev/null | tail -1)" >&2; return 1; }
  [[ "$est" =~ ^[0-9]+$ ]] || { echo "  estimasi bukan angka: $est" >&2; return 1; }
  out=$(cast send --rpc-url "$RPC" --private-key "$PK" --gas-limit $(( est * 3 / 2 )) "$@" 2>&1) || { echo "$out" | tail -2 >&2; return 1; }
  grep -Eq '^status[[:space:]]+1' <<< "$out" || { echo "  receipt status 0: $(awk '/^transactionHash[[:space:]]/ {print $2}' <<< "$out")" >&2; return 1; }
  awk '/^transactionHash[[:space:]]/ {h=$2} /^gasUsed[[:space:]]/ {g=$2} END {print h, g}' <<< "$out"
}
# nama error kustom EquinoxPool dari selector revert `cast call` (cast sig "Nama()"); selain itu selector/baris pesan mentah
errname() {
  local sel; sel=$(grep -oE 'data: "0x[0-9a-fA-F]{8}' <<< "$1" | head -1 | grep -oE '0x[0-9a-fA-F]{8}' || true)
  case "$sel" in
    0xc03deffd) echo "SettlementNotReady — round segar ≥ expiry belum ada" ;;
    0xc1529454) echo "BoardNotExpired" ;;
    0x6b962bce) echo "BoardAlreadySettled" ;;
    0x04578698) echo "OracleStale" ;;
    "") tail -1 <<< "$1" ;;
    *) echo "revert $sel" ;;
  esac
}
NOW=$(date -u +%s)
echo "== keeper $ME @ $(date -u +%FT%TZ) (DRY_RUN=$DRY) saldo $(cast balance --rpc-url "$RPC" "$ME" --ether) ETH"
# --- kesehatan: laporan saja; gagal dibaca (RPC) → lewati, tidak boleh memblokir settle ---
health() {
  local RD PRICE UPD TL
  RD=$(cast call --rpc-url "$RPC" "$FEED" "latestRoundData()(uint80,int256,uint256,uint256,uint80)") || return 1
  PRICE=$(echo "$RD" | sed -n 2p | awk '{print $1}'); UPD=$(echo "$RD" | sed -n 4p | awk '{print $1}')
  echo "feed: $(python3 -c "print(f'{$PRICE/1e8:.2f}')") USD, umur $((NOW - UPD)) s $([ $((NOW - UPD)) -gt 10800 ] && echo '!! STALE (>3 jam)')"
  TL=$(num 0x0000000000000000000000000000000000000071 "programTimeLeft(address)(uint64)" "$STYLUS") || return 1
  echo "stylus programTimeLeft: $((TL / 86400)) hari $([ "$TL" -lt 2592000 ] && echo '!! < 30 hari — aktivasi ulang diperlukan')"
  echo "sigmaBase: $(num "$VOL" "sigmaBase()(uint256)")  NAV A: $(num "$A" "totalAssets()(uint256)")  NAV B: $(num "$B" "totalAssets()(uint256)")"
  echo "reserved A/B: $(num "$A" "reserved()(uint256)") / $(num "$B" "reserved()(uint256)")  escrow A/B: $(num "$A" "escrowedPayouts()(uint256)") / $(num "$B" "escrowedPayouts()(uint256)")"
}
health || echo "kesehatan: gagal dibaca — lanjut"
# --- poke (engine bersama): gagal → lanjut ke settle ---
if [ "$DRY" == "1" ]; then echo "poke (simulasi): $(cast call --rpc-url "$RPC" --from "$ME" "$VOL" "poke()(uint256)" | awk '{print $1}')"
elif res=$(ksend "$VOL" "poke()"); then echo "poke: $res lastRoundId=$(num "$VOL" "lastRoundId()(uint80)")"
else echo "poke GAGAL — lanjut ke settle"; fi
# --- sequencer mock: `MockSequencerFeed.set()` permissionless (artefak testnet) — siapa pun bisa menandai "down" (answer 1) atau
#     memasang ulang grace 3600 s, yang membuat settle revert SettlementNotReady (kuotasi/deposit: OracleStale) dan memblokir sampai
#     di-reset. Predikat = OracleLib.sequencerUp: answer == 0, startedAt ∈ (0, now], now − startedAt ≥ grace; selain itu pulihkan. ---
seq_heal() {
  local SQ ANS ST res
  SQ=$(cast call --rpc-url "$RPC" "$SEQ" "latestRoundData()(uint80,int256,uint256,uint256,uint80)") || return 1
  ANS=$(echo "$SQ" | sed -n 2p | awk '{print $1}'); ST=$(echo "$SQ" | sed -n 3p | awk '{print $1}')
  [[ "$ANS" =~ ^-?[0-9]+$ && "$ST" =~ ^[0-9]+$ ]] || return 1   # hasil baca cacat → jangan bertindak
  if [ "$ANS" == "0" ] && [ "$ST" != "0" ] && [ $((NOW - ST)) -ge 3600 ]; then echo "sequencer mock: up, startedAt $ST (umur $((NOW - ST)) s) — ok"; return 0; fi
  echo "!! sequencer mock: answer=$ANS startedAt=$ST (umur $((NOW - ST)) s) — kuotasi/settle terblokir; pulihkan: set(0, $((NOW - 7200)))"
  if [ "$DRY" == "1" ]; then echo "sequencer set (simulasi): $SEQ set(int256,uint256) 0 $((NOW - 7200))"
  elif res=$(ksend "$SEQ" "set(int256,uint256)" 0 $((NOW - 7200))); then echo "sequencer set: $res"
  else echo "sequencer set GAGAL — lanjut (settle akan revert SettlementNotReady)"; fi
}
seq_heal || echo "sequencer mock: gagal dibaca — lanjut"
# --- settle board yang sudah expiry: pre-flight `cast call` (nama error bila belum bisa) → ksend; gagal → board/pool berikutnya ---
BSIG="board(uint256)(uint64,bool,uint256,uint256[])"
for P in "$A" "$B"; do
  for ID in $(jq -r '.pools.boards[].id' "$DEP"); do
    BD=$(cast call --rpc-url "$RPC" "$P" "$BSIG" "$ID") || { echo "board $ID @ $P: gagal dibaca — lewati"; continue; }
    EXP=$(echo "$BD" | sed -n 1p | awk '{print $1}'); SETTLED=$(echo "$BD" | sed -n 2p)
    [ "$SETTLED" == "false" ] || { echo "board $ID @ $P: sudah settle (harga $(echo "$BD" | sed -n 3p | awk '{print $1}'))"; continue; }
    if ! pre=$(cast call --rpc-url "$RPC" --from "$ME" "$P" "settle(uint256)" "$ID" 2>&1); then
      name=$(errname "$pre"); [ "$name" != "BoardNotExpired" ] || name="BoardNotExpired — expiry dalam $(( (EXP - NOW) / 3600 )) jam"
      echo "board $ID @ $P: belum bisa settle ($name)"; continue
    fi
    if [ "$DRY" == "1" ]; then echo "board $ID @ $P: settle SIAP (simulasi)"; continue; fi
    if res=$(ksend "$P" "settle(uint256)" "$ID"); then
      BD=$(cast call --rpc-url "$RPC" "$P" "$BSIG" "$ID" 2>/dev/null) || BD=""
      echo "board $ID @ $P: SETTLED $res → settled=$(echo "$BD" | sed -n 2p) harga=$(echo "$BD" | sed -n 3p | awk '{print $1}')"
    else echo "board $ID @ $P: settle GAGAL — coba lagi run berikutnya"; continue; fi
  done
done
