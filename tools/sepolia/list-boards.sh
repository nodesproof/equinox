#!/usr/bin/env bash
# Seed LP (1.000.000 USDG mock per pool — hanya A dan B) + board identik di semua pool dari manifest (A, B, dan C bila ada;
# Pool C ber-aset USDG Paxos asli, seed-nya lewat tools/sepolia/pool-c.sh seed). Idempoten per expiry × kunci pool.
# Pakai: tools/sepolia/list-boards.sh [EXPIRY:K1,K2,K3 …]   default: 1790323200:2400,2600,2800 1790928000:2200,2600,3000
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; source "$ROOT/tools/sepolia/lib.sh"
A=$(jq -r .pools.A.pool "$DEP"); B=$(jq -r .pools.B.pool "$DEP"); USDG=$(jq -r .pools.usdg "$DEP")
[ "$A" != "null" ] || die "jalankan deploy-pools.sh dulu"
KEYS=(A B); [ "$(jq -r '.pools.C.pool // empty' "$DEP")" ] && KEYS+=(C)   # kunci pool dari manifest, urut A, B, C
SPECS=("$@"); [ ${#SPECS[@]} -gt 0 ] || SPECS=("1790323200:2400,2600,2800" "1790928000:2200,2600,3000")
MAX=115792089237316195423570985008687907853269984665640564039457584007913129639935
SEED=1000000000000   # 1.000.000 USDG (6 dp)
# --- seed LP (sekali per pool) — hanya pool ber-aset mock (A, B); C memakai USDG asli dari faucet ---
for P in "$A" "$B"; do
  if [ "$(num "$P" "balanceOf(address)(uint256)" "$ME")" == "0" ]; then
    [ "$(num "$USDG" "allowance(address,address)(uint256)" "$ME" "$P")" != "0" ] || send "$USDG" "approve(address,uint256)" "$P" "$MAX" >/dev/null
    res=$(send "$P" "deposit(uint256,address)" "$SEED" "$ME"); tx=${res%% *}; gas=${res##* }; echo "deposit 1.000.000 USDG → $P: $(arbiscan "$tx") gas=$gas"
  else echo "seed LP sudah ada di $P"; fi
done
# --- board ---
SPOT=$(num "$A" "spot()(uint256,bool)" | head -1)   # WAD
for spec in "${SPECS[@]}"; do
  EXP=${spec%%:*}; KS=${spec#*:}
  [ $(( (EXP - 115200) % 604800 )) -eq 0 ] || die "expiry $EXP bukan grid Jumat 08:00 UTC"
  # kunci yang belum punya board expiry ini (seriesIds.<K> belum tercatat) — sisanya dilewati
  TODO=()
  for K in "${KEYS[@]}"; do
    if jq -e --arg e "$EXP" --arg k "$K" '.pools.boards[] | select(.expiry == ($e|tonumber)) | .seriesIds[$k]' "$DEP" >/dev/null; then echo "board $EXP di $K sudah tercatat — lewati"; else TODO+=("$K"); fi
  done
  [ ${#TODO[@]} -gt 0 ] || continue
  python3 - "$SPOT" "$KS" <<'PY' || die "strike di luar [S/2, 2S] untuk spot saat ini — pilih strike lain secara sadar"
import sys; s=int(sys.argv[1]); ks=[int(k)*10**18 for k in sys.argv[2].split(',')]
assert ks==sorted(ks) and len(set(ks))==len(ks), "strike harus naik & unik"
for k in ks: assert s//2 <= k <= 2*s, f"{k/1e18} di luar [{s/2e18:.0f}, {2*s/1e18:.0f}]"
print("strike ok, spot", s/1e18)
PY
  STRIKES="[$(python3 -c "print(','.join(str(int(k)*10**18) for k in '$KS'.split(',')))")]"
  # boardId harus sama di semua pool (dan sama dengan entri manifest bila expiry ini sudah tercatat di kunci lain)
  BID=$(jq -r --arg e "$EXP" '.pools.boards[] | select(.expiry == ($e|tonumber)) | .id' "$DEP")
  SIDS='{}'; LTX='{}'
  for K in "${TODO[@]}"; do
    P=$(jq -r ".pools.$K.pool" "$DEP"); T=$(jq -r ".pools.$K.token" "$DEP")
    res=$(send "$P" "createBoard(uint64,uint128[])" "$EXP" "$STRIKES"); tx=${res%% *}; gas=${res##* }
    ID=$(( $(num "$P" "boardCount()(uint256)") - 1 )); [ -n "$BID" ] || BID=$ID
    [ "$ID" == "$BID" ] || die "boardId $K ($ID) != $BID"
    # seri: derivasi deterministik (sama dengan board(id).seriesIds — urutan C,P per strike), lalu cek expiry on-chain
    S="[]"
    for k in ${KS//,/ }; do for c in true false; do
      id=$(num "$T" "seriesId(address,uint64,uint128,bool)(uint256)" "$P" "$EXP" "${k}000000000000000000" "$c")
      [ "$(cast call --rpc-url "$RPC" "$P" "series(uint256)(uint32,uint64,uint128,bool,bool,uint256,uint256,uint256)" "$id" | sed -n 2p | awk '{print $1}')" == "$EXP" ] || die "seri $id tidak terdaftar di $K"
      S=$(jq -cn --argjson a "$S" --arg v "$id" '$a + [$v]')
    done; done
    SIDS=$(jq -cn --argjson o "$SIDS" --arg k "$K" --argjson v "$S" '$o + {($k): $v}'); LTX=$(jq -cn --argjson o "$LTX" --arg k "$K" --arg v "$tx" '$o + {($k): $v}')
    echo "board $ID expiry $EXP strikes $KS di $K: $(arbiscan "$tx") (gas $gas)"
  done
  # tulis manifest: entri baru bila expiry belum ada, selain itu gabungkan seriesIds/listTx kunci baru ke entri yang ada
  if jq -e --arg e "$EXP" '.pools.boards[] | select(.expiry == ($e|tonumber))' "$DEP" >/dev/null; then
    jq_set '(.pools.boards[] | select(.expiry == ($e|tonumber))) |= (.seriesIds += $sids | .listTx += $ltx)' --arg e "$EXP" --argjson sids "$SIDS" --argjson ltx "$LTX"
  else
    jq_set '.pools.boards += [{id:($id|tonumber), expiry:($e|tonumber), expiryIso:$iso, strikes:($ks|split(",")), seriesIds:$sids, listTx:$ltx}]' \
      --arg id "$BID" --arg e "$EXP" --arg iso "$(date -u -d @"$EXP" +%Y-%m-%dT%H:%M:%SZ)" --arg ks "$KS" --argjson sids "$SIDS" --argjson ltx "$LTX"
  fi
done
jq '.pools.boards' "$DEP"
