#!/usr/bin/env bash
# Demo live di Arbitrum Sepolia: narasi identik di Pool A (kontrol) dan B (Stylus) — kuotasi harus identik pada blok yang sama.
# Pakai: tools/demo/sepolia-demo.sh [--trade|--claim] [BOARD_IDX=0]
#   --trade : beli 10 C K_hi, beli 1 P K_lo (cetak mid vs floor 5 bps × K — mana yang menang), tutup 5 C K_hi; catat gas & tx hash
#   --claim : setelah expiry — settle bila perlu (permissionless), claim semua posisi owner, catat payout
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; source "$ROOT/tools/sepolia/lib.sh"
MODE=${1:---trade}; BI=${2:-0}; LOG="$ROOT/docs/DEMO_LOG.md"
A=$(jq -r .pools.A.pool "$DEP"); B=$(jq -r .pools.B.pool "$DEP"); USDG=$(jq -r .pools.usdg "$DEP"); VOL=$(jq -r .pools.vol "$DEP")
SEQ=$(jq -r .pools.sequencerFeed "$DEP")
TOK_A=$(jq -r .pools.A.token "$DEP"); TOK_B=$(jq -r .pools.B.token "$DEP")
EXP=$(jq -r ".pools.boards[$BI].expiry" "$DEP"); KS=($(jq -r ".pools.boards[$BI].strikes[]" "$DEP")); BID=$(jq -r ".pools.boards[$BI].id" "$DEP")
KLO=${KS[0]}; KHI=${KS[${#KS[@]}-1]}
ida() { jq -r ".pools.boards[$BI].seriesIds.A[$1]" "$DEP"; }; idb() { jq -r ".pools.boards[$BI].seriesIds.B[$1]" "$DEP"; }
C_A=$(ida $(( (${#KS[@]}-1)*2 ))); C_B=$(idb $(( (${#KS[@]}-1)*2 ))); P_A=$(ida 1); P_B=$(idb 1)
MAX=115792089237316195423570985008687907853269984665640564039457584007913129639935
QSIG="quoteBuy(uint256,uint256)((uint256,uint256,uint256,int256,uint256,uint256))"
usd() { python3 -c "print(f'{$1/1e6:,.6f}')"; }; wad() { python3 -c "print(f'{$1/1e18:.6f}')"; }
row() { printf '| %s | %s | %s |\n' "$1" "$2" "$3" >> "$LOG"; }
[ -f "$LOG" ] || printf '# Equinox — log demo live di Arbitrum Sepolia\n\nSetiap bagian = satu run `tools/demo/sepolia-demo.sh`. Pool A = kontrol `BlackScholesSol`, Pool B = Stylus; engine σ bersama (K4). Tautan = Arbiscan Sepolia.\n' > "$LOG"
BLK=$(cast block-number --rpc-url "$RPC"); TS=$(date -u +%FT%TZ)
printf '\n## %s — `%s` board %s (expiry %s) @ blok %s\n\n' "$TS" "$MODE" "$BID" "$(jq -r ".pools.boards[$BI].expiryIso" "$DEP")" "$BLK" >> "$LOG"
SPOT=$(num "$A" "spot()(uint256,bool)" | head -1); printf 'Spot Chainlink: **%s USD**; σ_base %s; σ_mark(0) %s.\n\n' "$(wad "$SPOT")" "$(wad "$(num "$VOL" "sigmaBase()(uint256)")")" "$(wad "$(num "$VOL" "sigmaMark(uint256)(uint256)" 0)")" >> "$LOG"
printf '| Langkah | Pool A (kontrol) | Pool B (Stylus) |\n|---|---|---|\n' >> "$LOG"
if [ "$MODE" == "--trade" ]; then
  [ "$(num "$USDG" "allowance(address,address)(uint256)" "$ME" "$A")" != "0" ] || send "$USDG" "approve(address,uint256)" "$A" "$MAX" >/dev/null
  [ "$(num "$USDG" "allowance(address,address)(uint256)" "$ME" "$B")" != "0" ] || send "$USDG" "approve(address,uint256)" "$B" "$MAX" >/dev/null
  # kuotasi pada blok yang sama
  QA=$(cast call --rpc-url "$RPC" --block "$BLK" "$A" "$QSIG" "$C_A" 10000000000000000000); QB=$(cast call --rpc-url "$RPC" --block "$BLK" "$B" "$QSIG" "$C_B" 10000000000000000000)
  [ "$QA" == "$QB" ] || die "BEDA quoteBuy 10 C $KHI pada blok $BLK: A=$QA B=$QB"
  PREM=$(echo "$QA" | tr -d '()' | awk -F', ' '{print $1}' | awk '{print $1}'); SIG=$(echo "$QA" | tr -d '()' | awk -F', ' '{print $3}' | awk '{print $1}')
  row "quoteBuy 10 C $KHI (blok $BLK)" "premi $(usd "$PREM") USDG @ σ_buy $(wad "$SIG")" "identik ✓"
  res=$(send "$A" "buy(uint256,uint256,uint256)" "$C_A" 10000000000000000000 "$MAX"); txa=${res%% *}; ga=${res##* }
  res=$(send "$B" "buy(uint256,uint256,uint256)" "$C_B" 10000000000000000000 "$MAX"); txb=${res%% *}; gb=${res##* }
  row "buy 10 C $KHI" "[$ga gas]($(arbiscan "$txa"))" "[$gb gas]($(arbiscan "$txb"))  rasio $(python3 -c "print(f'{$ga/$gb:.2f}')")×"
  QPA=$(cast call --rpc-url "$RPC" "$A" "$QSIG" "$P_A" 1000000000000000000); PP=$(echo "$QPA" | tr -d '()' | awk -F', ' '{print $1}' | awk '{print $1}')
  FLOOR=$(python3 -c "print(int($KLO*10**6*5//10000))")   # minPremiumBps 5 × K × 1 unit, dalam 6 dp
  row "quoteBuy 1 P $KLO" "premi $(usd "$PP") USDG (floor 5 bps × K = $(usd "$FLOOR"): $([ "$PP" == "$FLOOR" ] && echo 'floor menang' || echo 'mid > floor'))" "—"
  res=$(send "$A" "buy(uint256,uint256,uint256)" "$P_A" 1000000000000000000 "$MAX"); txa=${res%% *}; ga=${res##* }
  res=$(send "$B" "buy(uint256,uint256,uint256)" "$P_B" 1000000000000000000 "$MAX"); txb=${res%% *}; gb=${res##* }
  row "buy 1 P $KLO" "[$ga gas]($(arbiscan "$txa"))" "[$gb gas]($(arbiscan "$txb"))"
  res=$(send "$A" "close(uint256,uint256,uint256)" "$C_A" 5000000000000000000 0); txa=${res%% *}; ga=${res##* }
  res=$(send "$B" "close(uint256,uint256,uint256)" "$C_B" 5000000000000000000 0); txb=${res%% *}; gb=${res##* }
  row "close 5 C $KHI" "[$ga gas]($(arbiscan "$txa"))" "[$gb gas]($(arbiscan "$txb"))  rasio $(python3 -c "print(f'{$ga/$gb:.2f}')")×"
else
  # sequencer mock: `MockSequencerFeed.set()` permissionless (artefak testnet) — bila ada yang menandai "down" atau memasang ulang
  # grace 3600 s, settle revert SettlementNotReady/OracleStale; pulihkan dulu (predikat OracleLib.sequencerUp; keeper melakukan hal sama)
  SQ=$(cast call --rpc-url "$RPC" "$SEQ" "latestRoundData()(uint80,int256,uint256,uint256,uint80)"); SQA=$(sed -n 2p <<< "$SQ" | awk '{print $1}'); SQS=$(sed -n 3p <<< "$SQ" | awk '{print $1}'); NOW=$(date -u +%s)
  if [ "$SQA" != "0" ] || [ "$SQS" == "0" ] || [ $((NOW - SQS)) -lt 3600 ]; then
    echo "!! sequencer mock: answer=$SQA startedAt=$SQS (umur $((NOW - SQS)) s) — pulihkan: set(0, $((NOW - 7200)))"
    res=$(send "$SEQ" "set(int256,uint256)" 0 $((NOW - 7200))); row "sequencer mock dipulihkan: set(0, now − 7200)" "[${res##* } gas]($(arbiscan "${res%% *}"))" "—"
  fi
  for P in "$A" "$B"; do
    if [ "$(cast call --rpc-url "$RPC" "$P" "board(uint256)(uint64,bool,uint256,uint256[])" "$BID" | sed -n 2p)" == "false" ]; then
      res=$(send "$P" "settle(uint256)" "$BID"); tx=${res%% *}; g=${res##* }; row "settle board $BID ($P)" "[$g gas]($(arbiscan "$tx"))" "—"; fi
  done
  # harga settlement dibaca per pool: A dan B settle di tx terpisah, masing-masing memakai round Chainlink saat panggilannya
  SPA=$(cast call --rpc-url "$RPC" "$A" "board(uint256)(uint64,bool,uint256,uint256[])" "$BID" | sed -n 3p | awk '{print $1}'); SPB=$(cast call --rpc-url "$RPC" "$B" "board(uint256)(uint64,bool,uint256,uint256[])" "$BID" | sed -n 3p | awk '{print $1}')
  row "harga settlement board $BID (round Chainlink pertama yang segar, updatedAt ≥ expiry)" "$(wad "$SPA") USD" "$(wad "$SPB") USD $([ "$SPA" == "$SPB" ] && echo '✓' || echo '(≠ — round settlement berbeda)')"
  SSIG="series(uint256)(uint32,uint64,uint128,bool,bool,uint256,uint256,uint256)"   # baris 8 = payoutPerUnit (WAD)
  for pair in "C_$KHI:$C_A:$C_B" "P_$KLO:$P_A:$P_B"; do
    NAME=${pair%%:*}; r=${pair#*:}; SA_ID=${r%%:*}; SB_ID=${r#*:}
    BALA=$(num "$TOK_A" "balanceOf(address,uint256)(uint256)" "$ME" "$SA_ID"); BALB=$(num "$TOK_B" "balanceOf(address,uint256)(uint256)" "$ME" "$SB_ID")
    [ "$BALA" != "0" ] || [ "$BALB" != "0" ] || { row "claim $NAME" "tidak ada posisi" "tidak ada posisi"; continue; }
    CA="tidak ada posisi"; CB="tidak ada posisi"   # klaim per pool, hanya bila saldo pool itu > 0; payout/unit dibaca per pool
    if [ "$BALA" != "0" ]; then
      PAYA=$(cast call --rpc-url "$RPC" "$A" "$SSIG" "$SA_ID" | sed -n 8p | awk '{print $1}')
      res=$(send "$A" "claim(uint256,uint256)" "$SA_ID" "$BALA"); txa=${res%% *}; ga=${res##* }; CA="$(wad "$BALA") unit × payout $(wad "$PAYA") USDG: [$ga gas]($(arbiscan "$txa"))"
    fi
    if [ "$BALB" != "0" ]; then
      PAYB=$(cast call --rpc-url "$RPC" "$B" "$SSIG" "$SB_ID" | sed -n 8p | awk '{print $1}')
      res=$(send "$B" "claim(uint256,uint256)" "$SB_ID" "$BALB"); txb=${res%% *}; gb=${res##* }; CB="$(wad "$BALB") unit × payout $(wad "$PAYB") USDG: [$gb gas]($(arbiscan "$txb"))"
    fi
    row "claim $NAME" "$CA" "$CB"
  done
fi
# --- keadaan akhir (blok yang sama untuk A dan B) ---
BLK2=$(cast block-number --rpc-url "$RPC")
for m in totalAssets reserved netVega escrowedPayouts freeLiquidity; do
  va=$(cast call --rpc-url "$RPC" --block "$BLK2" "$A" "$m()(uint256)" | awk '{print $1}'); vb=$(cast call --rpc-url "$RPC" --block "$BLK2" "$B" "$m()(uint256)" | awk '{print $1}')
  row "$m @ blok $BLK2" "$va" "$vb $([ "$va" == "$vb" ] && echo '✓' || echo '(≠ — timestamp tx A/B berbeda, lihat BENCHMARK)')"
done
row "sigmaMarkNow @ blok $BLK2" "$(cast call --rpc-url "$RPC" --block "$BLK2" "$A" "sigmaMarkNow()(uint256)" | awk '{print $1}')" "$(cast call --rpc-url "$RPC" --block "$BLK2" "$B" "sigmaMarkNow()(uint256)" | awk '{print $1}')"
echo "log ditulis ke $LOG"; tail -n 20 "$LOG"
