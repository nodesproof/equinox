#!/usr/bin/env bash
# Seed LP (1.000.000 USDG per pool) + dua board identik di Pool A dan B. Idempoten per expiry.
# Pakai: tools/sepolia/list-boards.sh [EXPIRY:K1,K2,K3 …]   default: 1790323200:2400,2600,2800 1790928000:2200,2600,3000
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; source "$ROOT/tools/sepolia/lib.sh"
A=$(jq -r .pools.A.pool "$DEP"); B=$(jq -r .pools.B.pool "$DEP"); USDG=$(jq -r .pools.usdg "$DEP")
TOK_A=$(jq -r .pools.A.token "$DEP"); TOK_B=$(jq -r .pools.B.token "$DEP")
[ "$A" != "null" ] || die "jalankan deploy-pools.sh dulu"
SPECS=("$@"); [ ${#SPECS[@]} -gt 0 ] || SPECS=("1790323200:2400,2600,2800" "1790928000:2200,2600,3000")
MAX=115792089237316195423570985008687907853269984665640564039457584007913129639935
SEED=1000000000000   # 1.000.000 USDG (6 dp)
# --- seed LP (sekali per pool) ---
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
  if jq -e --arg e "$EXP" '.pools.boards[] | select(.expiry == ($e|tonumber))' "$DEP" >/dev/null; then echo "board $EXP sudah tercatat — lewati"; continue; fi
  python3 - "$SPOT" "$KS" <<'PY' || die "strike di luar [S/2, 2S] untuk spot saat ini — pilih strike lain secara sadar"
import sys; s=int(sys.argv[1]); ks=[int(k)*10**18 for k in sys.argv[2].split(',')]
assert ks==sorted(ks) and len(set(ks))==len(ks), "strike harus naik & unik"
for k in ks: assert s//2 <= k <= 2*s, f"{k/1e18} di luar [{s/2e18:.0f}, {2*s/1e18:.0f}]"
print("strike ok, spot", s/1e18)
PY
  STRIKES="[$(python3 -c "print(','.join(str(int(k)*10**18) for k in '$KS'.split(',')))")]"
  res=$(send "$A" "createBoard(uint64,uint128[])" "$EXP" "$STRIKES"); txa=${res%% *}; gasa=${res##* }
  res=$(send "$B" "createBoard(uint64,uint128[])" "$EXP" "$STRIKES"); txb=${res%% *}; gasb=${res##* }
  IDA=$(( $(num "$A" "boardCount()(uint256)") - 1 )); IDB=$(( $(num "$B" "boardCount()(uint256)") - 1 ))
  [ "$IDA" == "$IDB" ] || die "boardId A ($IDA) != B ($IDB)"
  # seri: derivasi deterministik (sama dengan board(id).seriesIds — urutan C,P per strike), lalu cek expiry on-chain
  SA="[]"; SB="[]"
  for k in ${KS//,/ }; do for c in true false; do
    ia=$(num "$TOK_A" "seriesId(address,uint64,uint128,bool)(uint256)" "$A" "$EXP" "${k}000000000000000000" "$c")
    ib=$(num "$TOK_B" "seriesId(address,uint64,uint128,bool)(uint256)" "$B" "$EXP" "${k}000000000000000000" "$c")
    [ "$(cast call --rpc-url "$RPC" "$A" "series(uint256)(uint32,uint64,uint128,bool,bool,uint256,uint256,uint256)" "$ia" | sed -n 2p | awk '{print $1}')" == "$EXP" ] || die "seri $ia tidak terdaftar di A"
    SA=$(jq -cn --argjson a "$SA" --arg v "$ia" '$a + [$v]'); SB=$(jq -cn --argjson b "$SB" --arg v "$ib" '$b + [$v]')
  done; done
  jq_set '.pools.boards += [{id:($id|tonumber), expiry:($e|tonumber), expiryIso:$iso, strikes:($ks|split(",")), seriesIds:{A:$sa, B:$sb}, listTx:{A:$txa, B:$txb}}]' \
    --arg id "$IDA" --arg e "$EXP" --arg iso "$(date -u -d @"$EXP" +%Y-%m-%dT%H:%M:%SZ)" --arg ks "$KS" --argjson sa "$SA" --argjson sb "$SB" --arg txa "$txa" --arg txb "$txb"
  echo "board $IDA expiry $EXP strikes $KS: A $(arbiscan "$txa") (gas $gasa) | B $(arbiscan "$txb") (gas $gasb)"
done
jq '.pools.boards' "$DEP"
