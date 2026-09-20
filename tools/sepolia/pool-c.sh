#!/usr/bin/env bash
# Pool C — Equinox di atas USDG Paxos asli (Arbitrum Sepolia): pool identik dengan Pool B (math Stylus, engine vol bersama,
# cfg sama) tetapi asset() = USDG 0xFFC9…1892 (faucet.paxos.com, 100 USDG/wallet/hari; mint tertutup). Tidak ada kontrak baru.
# Pakai: tools/sepolia/pool-c.sh deploy | boards | seed [USDG=100] [--keeper] | redeem [USDG=10] | trade [SIZE=0.01] | status
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; source "$ROOT/tools/sepolia/lib.sh"
USDG_REAL=0xFFC95faa3d63Cde504a05B567C600B78C0b41892
FACTORY=$(addr "$(jq -r .pools.deployer "$DEP")" "factory()(address)")
VOL=$(jq -r .pools.vol "$DEP"); FEED=$(jq -r .pools.feed "$DEP"); SEQ=$(jq -r .pools.sequencerFeed "$DEP")
STYLUS=$(jq -r .blackScholesStylus "$DEP"); B=$(jq -r .pools.B.pool "$DEP")
C=$(jq -r '.pools.C.pool // empty' "$DEP"); TOK_C=$(jq -r '.pools.C.token // empty' "$DEP")
CFGSIG="cfg()(uint16,uint16,uint16,uint16,uint32,uint8,uint32,uint8,uint32,uint128,uint128)"
PSIG="params()(uint64,uint64,uint64,uint64,uint64,uint64)"
DSIG='createPoolWithVol((address,address,address,address,address,address,(uint16,uint16,uint16,uint16,uint32,uint8,uint32,uint8,uint32,uint128,uint128),(uint64,uint64,uint64,uint64,uint64,uint64),uint256,int256,string,string),address)'
MAX=115792089237316195423570985008687907853269984665640564039457584007913129639935
tuple() { cast call --rpc-url "$RPC" "$1" "$2" | awk '{print $1}' | paste -sd, | sed 's/^/(/; s/$/)/'; }   # "(a,b,…)" dari keluaran multi-baris
need_c() { [ -n "$C" ] || die "pools.C belum ada — jalankan: $0 deploy"; }
case "${1:-}" in
deploy)
  [ -z "$C" ] || die "pools.C sudah ada ($C)"
  [ "$(num "$USDG_REAL" "decimals()(uint8)")" == "6" ] || die "USDG asli bukan 6 dp?"
  CFG=$(tuple "$B" "$CFGSIG"); VP=$(tuple "$VOL" "$PSIG"); RW=$(num "$B" "rWad()(int256)")
  D="($ME,$USDG_REAL,$FEED,$SEQ,$STYLUS,$ME,$CFG,$VP,550000000000000000,$RW,\"Equinox LP (USDG)\",\"eqC\")"
  echo "Deploy: factory $FACTORY · vol $VOL · cfg B $CFG · rWad $RW"
  res=$(send "$FACTORY" "$DSIG" "$D" "$VOL"); tx=${res%% *}; gas=${res##* }
  N=$(num "$FACTORY" "poolCount()(uint256)"); C=$(addr "$FACTORY" "pools(uint256)(address)" $((N - 1))); TOK_C=$(addr "$C" "token()(address)")
  # verifikasi wiring: hanya asset yang boleh berbeda dari B
  [ "$(addr "$C" "asset()(address)")" == "$(lower "$USDG_REAL")" ] || die "asset() C ≠ USDG asli"
  [ "$(addr "$C" "math()(address)")" == "$(lower "$STYLUS")" ] || die "math() C ≠ Stylus"
  [ "$(addr "$C" "vol()(address)")" == "$(lower "$VOL")" ] || die "vol() C ≠ engine bersama"
  [ "$(tuple "$C" "$CFGSIG")" == "$CFG" ] || die "cfg() C ≠ cfg() B"
  [ "$(addr "$TOK_C" "pool()(address)")" == "$C" ] || die "token C tidak terikat ke pool C"
  BLK=$(cast receipt --rpc-url "$RPC" "$tx" blockNumber)
  jq_set '.pools.C = {label:"Equinox (Stylus, real USDG)", pool:$p, token:$t, math:$m, asset:$a, assetSymbol:"USDG", assetKind:"paxos", createTx:$tx, createdAtBlock:($b|tonumber)}' \
    --arg p "$C" --arg t "$TOK_C" --arg m "$(lower "$STYLUS")" --arg a "$(lower "$USDG_REAL")" --arg tx "$tx" --arg b "$BLK"
  echo "Pool C $C · token $TOK_C · $(arbiscan "$tx") gas=$gas blok=$BLK"
  ;;
boards)
  need_c; NOW=$(date -u +%s)
  for i in $(jq -r '.pools.boards | keys[]' "$DEP"); do
    EXP=$(jq -r ".pools.boards[$i].expiry" "$DEP"); KS=$(jq -r ".pools.boards[$i].strikes | join(\",\")" "$DEP")
    if jq -e ".pools.boards[$i].seriesIds.C" "$DEP" >/dev/null; then echo "board $i ($EXP): seriesIds.C sudah ada — lewati"; continue; fi
    [ "$EXP" -gt "$NOW" ] || { echo "board $i ($EXP) sudah lewat — tidak dibuat di C"; continue; }
    STRIKES="[$(python3 -c "print(','.join(str(int(k)*10**18) for k in '$KS'.split(',')))")]"
    res=$(send "$C" "createBoard(uint64,uint128[])" "$EXP" "$STRIKES"); tx=${res%% *}; gas=${res##* }
    IDC=$(( $(num "$C" "boardCount()(uint256)") - 1 )); [ "$IDC" == "$(jq -r ".pools.boards[$i].id" "$DEP")" ] || die "boardId C ($IDC) ≠ manifest ($i)"
    SC="[]"
    for k in ${KS//,/ }; do for c in true false; do
      id=$(num "$TOK_C" "seriesId(address,uint64,uint128,bool)(uint256)" "$C" "$EXP" "${k}000000000000000000" "$c")
      [ "$(cast call --rpc-url "$RPC" "$C" "series(uint256)(uint32,uint64,uint128,bool,bool,uint256,uint256,uint256)" "$id" | sed -n 2p | awk '{print $1}')" == "$EXP" ] || die "seri $id tidak terdaftar di C"
      SC=$(jq -cn --argjson a "$SC" --arg v "$id" '$a + [$v]')
    done; done
    jq_set ".pools.boards[$i].seriesIds.C = \$sc | .pools.boards[$i].listTx.C = \$tx" --argjson sc "$SC" --arg tx "$tx"
    echo "board $i expiry $EXP strikes $KS di C: $(arbiscan "$tx") gas=$gas"
  done
  ;;
seed)
  need_c; AMT=${2:-100}; [[ "$AMT" =~ ^[0-9]+$ ]] || die "jumlah USDG bulat"; UNITS=$((AMT * 1000000))
  if [ "${3:-}" == "--keeper" ]; then : "${KEEPER_PRIVATE_KEY:?}"; PK="$KEEPER_PRIVATE_KEY"; ME=$(cast wallet address --private-key "$PK"); fi
  BAL=$(num "$USDG_REAL" "balanceOf(address)(uint256)" "$ME")
  [ "$BAL" -ge "$UNITS" ] || { echo "DITUNDA: saldo USDG asli $ME = $BAL (butuh $UNITS). Minta 100 USDG/hari di https://faucet.paxos.com/ (USDG → Arbitrum Sepolia)."; exit 3; }
  [ "$(num "$USDG_REAL" "allowance(address,address)(uint256)" "$ME" "$C")" -ge "$UNITS" ] || { res=$(send "$USDG_REAL" "approve(address,uint256)" "$C" "$MAX"); echo "approve: $(arbiscan "${res%% *}")"; }
  res=$(send "$C" "deposit(uint256,address)" "$UNITS" "$ME"); tx=${res%% *}; gas=${res##* }
  echo "deposit $AMT USDG → Pool C dari $ME: $(arbiscan "$tx") gas=$gas · shares $(num "$C" "balanceOf(address)(uint256)" "$ME") · NAV $(num "$C" "totalAssets()(uint256)") · capitalRefPrev $(num "$C" "capitalRefPrev()(uint256)")"
  ;;
redeem)
  # Owner saja (LP == owner kunci); tarik sebagian kapital LP kembali jadi USDG asli di wallet owner supaya wallet yang
  # sama juga bisa jadi trader (bayar premi) — lihat catatan blokir di DEMO_LOG. UNITS dalam unit shares (6 dp), 1:1
  # dengan aset selama belum ada P&L; maxRedeem/freeLiquidity dicek dulu, exit keras (die) bila kurang — tidak ada
  # penyesuaian jumlah otomatis, sama seperti seed menolak jumlah lebih kecil sendiri.
  need_c; AMT=${2:-10}; [[ "$AMT" =~ ^[0-9]+$ ]] || die "jumlah USDG bulat"; UNITS=$((AMT * 1000000))
  [ "$(num "$C" "maxRedeem(address)(uint256)" "$ME")" -ge "$UNITS" ] || die "maxRedeem($ME) < $UNITS shares"
  [ "$(num "$C" "freeLiquidity()(uint256)")" -ge "$UNITS" ] || die "freeLiquidity() < $UNITS"
  res=$(send "$C" "redeem(uint256,address,address)" "$UNITS" "$ME" "$ME"); tx=${res%% *}; gas=${res##* }
  echo "redeem $AMT USDG (shares) dari Pool C ke $ME: $(arbiscan "$tx") gas=$gas · shares sisa $(num "$C" "balanceOf(address)(uint256)" "$ME") · NAV $(num "$C" "totalAssets()(uint256)") · USDG asli owner $(num "$USDG_REAL" "balanceOf(address)(uint256)" "$ME")"
  ;;
trade)
  need_c; SIZE=${2:-0.01}; SW=$(python3 -c "print(int(round(float('$SIZE')*10**18)))")
  ID=$(jq -r '.pools.boards[1].seriesIds.C[2]' "$DEP"); [ "$ID" != "null" ] || die "board 1 belum ada di C — jalankan: $0 boards"   # C K1 board 1 (2 Okt)
  # Batas dari JALUR EKSEKUSI (buy/close mem-poke engine dulu): premi = eth_call buy(id,size,MAX) dari ME; fee diskalakan dari rasio quoteBuy (+1 pembulatan); ×1,01.
  Q=$(cast call --rpc-url "$RPC" "$C" "quoteBuy(uint256,uint256)((uint256,uint256,uint256,int256,uint256,uint256))" "$ID" "$SW"); PQ=$(field "$Q" 1); FQ=$(field "$Q" 2)
  PE=$(cast call --rpc-url "$RPC" --from "$ME" "$C" "buy(uint256,uint256,uint256)(uint256)" "$ID" "$SW" "$MAX" | awk '{print $1}')
  FE=$(( PQ == 0 ? FQ : FQ * PE / PQ + 1 )); MAXP=$(( (PE + FE) * 10100 / 10000 ))
  [ "$(num "$USDG_REAL" "allowance(address,address)(uint256)" "$ME" "$C")" -ge "$MAXP" ] || send "$USDG_REAL" "approve(address,uint256)" "$C" "$MAX" >/dev/null
  res=$(send "$C" "buy(uint256,uint256,uint256)" "$ID" "$SW" "$MAXP"); txb=${res%% *}; gb=${res##* }
  echo "buy $SIZE C(board 1, K1) di C: quote $PQ+$FQ · exec $PE · max $MAXP · $(arbiscan "$txb") gas=$gb"
  CE=$(cast call --rpc-url "$RPC" --from "$ME" "$C" "close(uint256,uint256,uint256)(uint256)" "$ID" "$SW" 0 | awk '{print $1}'); MINP=$(( CE * 9900 / 10000 ))
  res=$(send "$C" "close(uint256,uint256,uint256)" "$ID" "$SW" "$MINP"); txc=${res%% *}; gc=${res##* }
  echo "close $SIZE di C: exec $CE · min $MINP · $(arbiscan "$txc") gas=$gc · posisi sisa $(num "$TOK_C" "balanceOf(address,uint256)(uint256)" "$ME" "$ID")"
  ;;
status)
  need_c
  echo "Pool C $C · asset $(addr "$C" "asset()(address)") · math $(addr "$C" "math()(address)") · vol $(addr "$C" "vol()(address)")"
  echo "cfg C == cfg B: $([ "$(tuple "$C" "$CFGSIG")" == "$(tuple "$B" "$CFGSIG")" ] && echo ya || echo TIDAK)"
  echo "NAV $(num "$C" "totalAssets()(uint256)") · free $(num "$C" "freeLiquidity()(uint256)") · reserved $(num "$C" "reserved()(uint256)") · capitalRefPrev $(num "$C" "capitalRefPrev()(uint256)") · boards $(num "$C" "boardCount()(uint256)")"
  echo "USDG asli: owner $(num "$USDG_REAL" "balanceOf(address)(uint256)" "$ME") · keeper $(num "$USDG_REAL" "balanceOf(address)(uint256)" "${KEEPER_ADDRESS:-0x2e5607862E1c42C24Ea91d50C5737715a71ba89B}") · pool $(num "$USDG_REAL" "balanceOf(address)(uint256)" "$C")"
  ;;
*) echo "pakai: $0 deploy | boards | seed [USDG] [--keeper] | redeem [USDG] | trade [SIZE] | status"; exit 2 ;;
esac
