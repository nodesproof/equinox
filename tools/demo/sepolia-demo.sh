#!/usr/bin/env bash
# Demo live di Arbitrum Sepolia: narasi identik di Pool A (kontrol) dan B (Stylus). Klaim identitas (K5) = paritas matematika:
# kedua kontrak `math` memberi harga byte-identik untuk input identik (S, K, t, σ); kuotasi pool dibandingkan byte-per-byte
# hanya bila inventaris kedua pool sama pada blok itu, selain itu Δ kuotasi dicetak (inventaris berbeda adalah sah).
# Pakai: tools/demo/sepolia-demo.sh [--trade|--claim|--check] [BOARD_IDX=0]
#   --trade : beli 10 C K_hi, beli 1 P K_lo (cetak mid vs floor 5 bps × K — mana yang menang), tutup 5 C K_hi; catat gas & tx hash
#   --claim : setelah expiry — settle bila perlu (permissionless), claim semua posisi owner, catat payout
#   --check : hanya blok kuotasi/paritas pada blok terbaru — read-only (tanpa tx, tidak menulis DEMO_LOG), baris ke stdout
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; source "$ROOT/tools/sepolia/lib.sh"
MODE=${1:---trade}; BI=${2:-0}; LOG="$ROOT/docs/DEMO_LOG.md"
A=$(jq -r .pools.A.pool "$DEP"); B=$(jq -r .pools.B.pool "$DEP"); USDG=$(jq -r .pools.usdg "$DEP"); VOL=$(jq -r .pools.vol "$DEP")
SEQ=$(jq -r .pools.sequencerFeed "$DEP"); MATH_A=$(jq -r .pools.A.math "$DEP"); MATH_B=$(jq -r .pools.B.math "$DEP")
TOK_A=$(jq -r .pools.A.token "$DEP"); TOK_B=$(jq -r .pools.B.token "$DEP")
EXP=$(jq -r ".pools.boards[$BI].expiry" "$DEP"); KS=($(jq -r ".pools.boards[$BI].strikes[]" "$DEP")); BID=$(jq -r ".pools.boards[$BI].id" "$DEP")
KLO=${KS[0]}; KHI=${KS[${#KS[@]}-1]}
ida() { jq -r ".pools.boards[$BI].seriesIds.A[$1]" "$DEP"; }; idb() { jq -r ".pools.boards[$BI].seriesIds.B[$1]" "$DEP"; }
C_A=$(ida $(( (${#KS[@]}-1)*2 ))); C_B=$(idb $(( (${#KS[@]}-1)*2 ))); P_A=$(ida 1); P_B=$(idb 1)
MAX=115792089237316195423570985008687907853269984665640564039457584007913129639935
QSIG="quoteBuy(uint256,uint256)((uint256,uint256,uint256,int256,uint256,uint256))"
CSIG="cappedCall(uint256,uint256,uint256,uint256,uint256,int256)(uint256,int256,int256)"
PSIG="quote(uint256,uint256,uint256,uint256,int256,bool)(uint256,int256,uint256,uint256,int256)"
SIZE_C=10000000000000000000; SIZE_P=1000000000000000000   # 10 unit call, 1 unit put (WAD)
usd() { python3 -c "print(f'{$1/1e6:,.6f}')"; }; wad() { python3 -c "print(f'{$1/1e18:.6f}')"; }
OUT="$LOG"; [ "$MODE" == "--check" ] && OUT=/dev/stdout   # --check: baris ke stdout, DEMO_LOG tidak disentuh
row() { printf '| %s | %s | %s |\n' "$1" "$2" "$3" >> "$OUT"; }
# premi pool (6 dp) == ceil(max(harga_math × size / 1e18, K × size / 1e18 × 5 / 1e4) / 1e12)?  — rumus quoteBuy, minPremiumBps = 5
pm_ok() { python3 -c "
p, px, sz, k = int('$1'), int('$2'), int('$3'), int('$4')
w = max(px * sz // 10**18, k * sz // 10**18 * 5 // 10000)
raise SystemExit(0 if p == (w + 10**12 - 1) // 10**12 else 1)"; }
# kapital untuk util/cap pada blok: min(max(kas × 1e12 − escrow, 0), capitalRefPrev) — sama dengan EquinoxPool._capitalForCaps
capfor() { python3 -c "print(min(max(int('$(numat "$1" "$USDG" "balanceOf(address)(uint256)" "$2")') * 10**12 - int('$(numat "$1" "$2" "escrowedPayouts()(uint256)")'), 0), int('$(numat "$1" "$2" "capitalRefPrev()(uint256)")')))"; }
delta() { python3 -c "a, b = int('$1'), int('$2'); d = abs(a - b); print(f'Δ {d/1e6:.6f} USDG ({d/min(a,b):.1e} relatif)')"; }
# --- K5 (R1): kuotasi 10 C K_hi & 1 P K_lo di A dan B pada blok $1, semua pembacaan di-pin pada blok itu.
#     (1) paritas math — selalu: kedua `math` pada input identik (S, K, t, σ dari tuple kuotasi) harus byte-identik, call dan put → die;
#     (2) pool↔math per pool: premi_P == ceil(max(harga_math_P(σ_P) × size, floor) / 1e12) → die;
#     (3) kuotasi pool dibandingkan byte-per-byte HANYA bila netVega dan kapital-untuk-cap A == B (predikat identitas); selain itu
#         cetak premi A | premi B dengan Δ — inventaris berbeda adalah sah (K5). ---
parity_check() {
  local BLK=$1 TS T S QA QB QPA QPB SIGA SIGB SIGPA SIGPB KC KC2 KP PMA PMB PMB2 PPA PPB PPB2 NVA NVB CAPA CAPB PC_A PC_B PP_A PP_B FLOOR pred
  TS=$(cast block --rpc-url "$RPC" "$BLK" -f timestamp); T=$(python3 -c "print(($EXP - $TS) * 10**18 // 31536000)")
  QA=$(cast call --rpc-url "$RPC" --block "$BLK" "$A" "$QSIG" "$C_A" "$SIZE_C"); QB=$(cast call --rpc-url "$RPC" --block "$BLK" "$B" "$QSIG" "$C_B" "$SIZE_C")
  QPA=$(cast call --rpc-url "$RPC" --block "$BLK" "$A" "$QSIG" "$P_A" "$SIZE_P"); QPB=$(cast call --rpc-url "$RPC" --block "$BLK" "$B" "$QSIG" "$P_B" "$SIZE_P")
  S=$(field "$QA" 6); SIGA=$(field "$QA" 3); SIGB=$(field "$QB" 3); SIGPA=$(field "$QPA" 3); SIGPB=$(field "$QPB" 3)
  PC_A=$(field "$QA" 1); PC_B=$(field "$QB" 1); PP_A=$(field "$QPA" 1); PP_B=$(field "$QPB" 1)
  KC="${KHI}000000000000000000"; KC2="$((KHI * 2))000000000000000000"; KP="${KLO}000000000000000000"   # WAD; cap call = 2K
  # (1) paritas math pada σ_A (input identik ke kedua math)
  PMA=$(cast call --rpc-url "$RPC" --block "$BLK" "$MATH_A" "$CSIG" "$S" "$KC" "$KC2" "$T" "$SIGA" 0); PMB=$(cast call --rpc-url "$RPC" --block "$BLK" "$MATH_B" "$CSIG" "$S" "$KC" "$KC2" "$T" "$SIGA" 0)
  [ "$PMA" == "$PMB" ] || die "BEDA paritas math (cappedCall) blok $BLK, S=$S K=$KC t=$T σ=$SIGA: A=$PMA B=$PMB"
  PPA=$(cast call --rpc-url "$RPC" --block "$BLK" "$MATH_A" "$PSIG" "$S" "$KP" "$T" "$SIGPA" 0 false); PPB=$(cast call --rpc-url "$RPC" --block "$BLK" "$MATH_B" "$PSIG" "$S" "$KP" "$T" "$SIGPA" 0 false)
  [ "$PPA" == "$PPB" ] || die "BEDA paritas math (quote put) blok $BLK, S=$S K=$KP t=$T σ=$SIGPA: A=$PPA B=$PPB"
  # harga pada σ_B dari math B (untuk pool↔math B); bila σ_B ≠ σ_A, paritas diuji lagi pada input itu
  PMB2=$(cast call --rpc-url "$RPC" --block "$BLK" "$MATH_B" "$CSIG" "$S" "$KC" "$KC2" "$T" "$SIGB" 0); PPB2=$(cast call --rpc-url "$RPC" --block "$BLK" "$MATH_B" "$PSIG" "$S" "$KP" "$T" "$SIGPB" 0 false)
  [ "$SIGB" == "$SIGA" ] || [ "$(cast call --rpc-url "$RPC" --block "$BLK" "$MATH_A" "$CSIG" "$S" "$KC" "$KC2" "$T" "$SIGB" 0)" == "$PMB2" ] || die "BEDA paritas math (cappedCall @ σ_B) blok $BLK"
  [ "$SIGPB" == "$SIGPA" ] || [ "$(cast call --rpc-url "$RPC" --block "$BLK" "$MATH_A" "$PSIG" "$S" "$KP" "$T" "$SIGPB" 0 false)" == "$PPB2" ] || die "BEDA paritas math (quote put @ σ_B) blok $BLK"
  # (2) pool↔math: premi tiap pool direproduksi dari math-nya sendiri pada σ efektif kuotasi
  pm_ok "$PC_A" "$(head -1 <<< "$PMA" | awk '{print $1}')" "$SIZE_C" "$KC" || die "pool A ≠ math A: premi 10 C $KHI $PC_A vs harga $(head -1 <<< "$PMA")"
  pm_ok "$PC_B" "$(head -1 <<< "$PMB2" | awk '{print $1}')" "$SIZE_C" "$KC" || die "pool B ≠ math B: premi 10 C $KHI $PC_B vs harga $(head -1 <<< "$PMB2")"
  pm_ok "$PP_A" "$(head -1 <<< "$PPA" | awk '{print $1}')" "$SIZE_P" "$KP" || die "pool A ≠ math A: premi 1 P $KLO $PP_A vs harga $(head -1 <<< "$PPA")"
  pm_ok "$PP_B" "$(head -1 <<< "$PPB2" | awk '{print $1}')" "$SIZE_P" "$KP" || die "pool B ≠ math B: premi 1 P $KLO $PP_B vs harga $(head -1 <<< "$PPB2")"
  # (3) predikat identitas kuotasi: netVega dan kapital-untuk-cap sama → kuotasi harus byte-identik
  NVA=$(numat "$BLK" "$A" "netVega()(uint256)"); NVB=$(numat "$BLK" "$B" "netVega()(uint256)"); CAPA=$(capfor "$BLK" "$A"); CAPB=$(capfor "$BLK" "$B")
  FLOOR=$(python3 -c "print(int($KLO*10**6*5//10000))")   # minPremiumBps 5 × K × 1 unit, dalam 6 dp
  row "spot / t (blok $BLK)" "S $(wad "$S") USD, t $(wad "$T") thn (ts $TS)" "sama (feed & expiry sama)"
  row "paritas math (blok $BLK)" "cappedCall(S, $KHI, 2K, t, σ_A) & quote(S, $KLO, t, σ_A, put)" "byte-identik ✓ (3-tuple / 5-tuple)"
  if [ "$NVA" == "$NVB" ] && [ "$CAPA" == "$CAPB" ]; then
    pred="sama"
    [ "$QA" == "$QB" ] || die "BEDA quoteBuy 10 C $KHI pada blok $BLK (inventaris sama): A=$QA B=$QB"
    [ "$QPA" == "$QPB" ] || die "BEDA quoteBuy 1 P $KLO pada blok $BLK (inventaris sama): A=$QPA B=$QPB"
    row "quoteBuy 10 C $KHI (blok $BLK)" "premi $(usd "$PC_A") USDG @ σ_buy $(wad "$SIGA")" "identik ✓ (inventaris sama; pool↔math ✓)"
    row "quoteBuy 1 P $KLO (blok $BLK)" "premi $(usd "$PP_A") USDG (floor 5 bps × K = $(usd "$FLOOR"): $([ "$PP_A" == "$FLOOR" ] && echo 'floor menang' || echo 'mid > floor'))" "identik ✓ (inventaris sama; pool↔math ✓)"
  else
    pred="berbeda"
    row "quoteBuy 10 C $KHI (blok $BLK)" "premi $(usd "$PC_A") USDG @ σ_buy $(wad "$SIGA")" "premi $(usd "$PC_B") USDG @ σ_buy $(wad "$SIGB")  $(delta "$PC_A" "$PC_B") — inventaris berbeda (paritas math ✓, pool↔math ✓)"
    row "quoteBuy 1 P $KLO (blok $BLK)" "premi $(usd "$PP_A") USDG (floor 5 bps × K = $(usd "$FLOOR"): $([ "$PP_A" == "$FLOOR" ] && echo 'floor menang' || echo 'mid > floor'))" "premi $(usd "$PP_B") USDG  $(delta "$PP_A" "$PP_B") — inventaris berbeda (paritas math ✓, pool↔math ✓)"
  fi
  row "predikat identitas kuotasi (blok $BLK)" "netVega $(wad "$NVA"), kapital cap $(wad "$CAPA")" "netVega $(wad "$NVB"), kapital cap $(wad "$CAPB") → inventaris $pred$([ "$pred" == "sama" ] && echo ' (kuotasi wajib identik)' || echo ' (kuotasi boleh berbeda; paritas math yang diuji)')"
}
if [ "$MODE" == "--check" ]; then
  BLK=$(cast block-number --rpc-url "$RPC")
  echo "== --check board $BID (expiry $(jq -r ".pools.boards[$BI].expiryIso" "$DEP")) @ blok $BLK — read-only, tanpa tx, $LOG tidak disentuh"
  printf '| Langkah | Pool A (kontrol) | Pool B (Stylus) |\n|---|---|---|\n'
  parity_check "$BLK"; exit 0
fi
[ -f "$LOG" ] || printf '# Equinox — log demo live di Arbitrum Sepolia\n\nSetiap bagian = satu run `tools/demo/sepolia-demo.sh`. Pool A = kontrol `BlackScholesSol`, Pool B = Stylus; engine σ bersama (K4). Tautan = Arbiscan Sepolia.\n' > "$LOG"
BLK=$(cast block-number --rpc-url "$RPC"); TS=$(date -u +%FT%TZ)
printf '\n## %s — `%s` board %s (expiry %s) @ blok %s\n\n' "$TS" "$MODE" "$BID" "$(jq -r ".pools.boards[$BI].expiryIso" "$DEP")" "$BLK" >> "$LOG"
SPOT=$(num "$A" "spot()(uint256,bool)" | head -1); printf 'Spot Chainlink: **%s USD**; σ_base %s; σ_mark(0) %s.\n\n' "$(wad "$SPOT")" "$(wad "$(num "$VOL" "sigmaBase()(uint256)")")" "$(wad "$(num "$VOL" "sigmaMark(uint256)(uint256)" 0)")" >> "$LOG"
printf '| Langkah | Pool A (kontrol) | Pool B (Stylus) |\n|---|---|---|\n' >> "$LOG"
if [ "$MODE" == "--trade" ]; then
  [ "$(num "$USDG" "allowance(address,address)(uint256)" "$ME" "$A")" != "0" ] || send "$USDG" "approve(address,uint256)" "$A" "$MAX" >/dev/null
  [ "$(num "$USDG" "allowance(address,address)(uint256)" "$ME" "$B")" != "0" ] || send "$USDG" "approve(address,uint256)" "$B" "$MAX" >/dev/null
  parity_check "$BLK"   # kuotasi C & P pada blok yang sama, sebelum trade (K5)
  res=$(send "$A" "buy(uint256,uint256,uint256)" "$C_A" "$SIZE_C" "$MAX"); txa=${res%% *}; ga=${res##* }
  res=$(send "$B" "buy(uint256,uint256,uint256)" "$C_B" "$SIZE_C" "$MAX"); txb=${res%% *}; gb=${res##* }
  row "buy 10 C $KHI" "[$ga gas]($(arbiscan "$txa"))" "[$gb gas]($(arbiscan "$txb"))  rasio $(python3 -c "print(f'{$ga/$gb:.2f}')")×"
  res=$(send "$A" "buy(uint256,uint256,uint256)" "$P_A" "$SIZE_P" "$MAX"); txa=${res%% *}; ga=${res##* }
  res=$(send "$B" "buy(uint256,uint256,uint256)" "$P_B" "$SIZE_P" "$MAX"); txb=${res%% *}; gb=${res##* }
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
  row "harga settlement board $BID (round segar terakhir saat \`settle\` — \`updatedAt ≥ expiry\`, T2 PRD)" "$(wad "$SPA") USD" "$(wad "$SPB") USD $([ "$SPA" == "$SPB" ] && echo '✓' || echo '(≠ — round settlement berbeda)')"
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
