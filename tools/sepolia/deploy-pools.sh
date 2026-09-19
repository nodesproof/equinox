#!/usr/bin/env bash
# Deploy PoolE2EDeployer ke Arbitrum Sepolia: MockUSDG + MockSequencerFeed + factory + Pool B (Stylus, engine baru) +
# Pool A (kontrol, engine bersama — K4), feed Chainlink ETH/USD asli. Idempoten: berhenti bila .pools sudah ada.
# Pakai: tools/sepolia/deploy-pools.sh          (.env: SEPOLIA_PRIVATE_KEY, SEPOLIA_RPC_URL)
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; source "$ROOT/tools/sepolia/lib.sh"
FEED=0xd30e2101a97dcbaebcbc04f14c3f624e67a35165   # Chainlink ETH/USD, Arbitrum Sepolia (spec §1)
MATH_A=$(jq -r .blackScholesSol "$DEP"); MATH_B=$(jq -r .blackScholesStylus "$DEP")
[ "$(jq -r '.pools.deployer // empty' "$DEP")" == "" ] || { echo "pools sudah ada di $DEP (deployer $(jq -r .pools.deployer "$DEP")) — hapus blok .pools untuk deploy ulang"; exit 0; }
# feed harus hidup & segar sebelum deploy (constructor engine membaca latestRoundData)
FEED_TS=$(cast call --rpc-url "$RPC" "$FEED" "latestRoundData()(uint80,int256,uint256,uint256,uint80)" | sed -n 4p | awk '{print $1}')
NOW=$(date -u +%s); [ $((NOW - FEED_TS)) -le 3600 ] || die "feed Chainlink tidak segar (umur $((NOW - FEED_TS)) s)"
cd "$ROOT/contracts"
OUT=$(forge create --rpc-url "$RPC" --private-key "$PK" --broadcast src/mocks/PoolE2EDeployer.sol:PoolE2EDeployer \
      --constructor-args "$ME" "$MATH_A" "$MATH_B" "$FEED" true)
DEPLOYER=$(echo "$OUT" | awk '/Deployed to/ {print tolower($3)}'); TX=$(echo "$OUT" | awk '/Transaction hash/ {print $3}')
[ -n "$DEPLOYER" ] && [ -n "$TX" ] || { echo "$OUT"; die "forge create"; }
BLOCK=$(cast receipt --rpc-url "$RPC" "$TX" blockNumber)
A=$(addr "$DEPLOYER" "poolA()(address)"); B=$(addr "$DEPLOYER" "poolB()(address)")
USDG=$(addr "$DEPLOYER" "usdg()(address)"); SEQ=$(addr "$DEPLOYER" "seq()(address)")
VOL=$(addr "$B" "vol()(address)"); TOK_A=$(addr "$A" "token()(address)"); TOK_B=$(addr "$B" "token()(address)")
# verifikasi K4 + kabel
[ "$(addr "$A" "vol()(address)")" == "$VOL" ] || die "engine tidak bersama"
[ "$(addr "$VOL" "feed()(address)")" == "$FEED" ] || die "feed engine bukan Chainlink"
[ "$(addr "$A" "asset()(address)")" == "$USDG" ] && [ "$(addr "$B" "asset()(address)")" == "$USDG" ] || die "asset"
[ "$(addr "$A" "math()(address)")" == "$(lower "$MATH_A")" ] && [ "$(addr "$B" "math()(address)")" == "$(lower "$MATH_B")" ] || die "math"
SB=$(num "$VOL" "sigmaBase()(uint256)"); [ "$SB" != "0" ] || die "sigmaBase 0"
jq_set '.pools = {deployer:$dep, deployTx:$tx, usdg:$usdg, feed:$feed, sequencerFeed:$seq, vol:$vol,
        A:{label:"control (BlackScholesSol)", pool:$a, token:$ta, math:$ma},
        B:{label:"Equinox (Stylus)", pool:$b, token:$tb, math:$mb},
        deployedAtBlock:($blk|tonumber), deployedAt:$ts, boards:[]}' \
  --arg dep "$DEPLOYER" --arg tx "$TX" --arg usdg "$USDG" --arg feed "$FEED" --arg seq "$SEQ" --arg vol "$VOL" \
  --arg a "$A" --arg ta "$TOK_A" --arg ma "$(lower "$MATH_A")" --arg b "$B" --arg tb "$TOK_B" --arg mb "$(lower "$MATH_B")" \
  --arg blk "$BLOCK" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "deployer=$DEPLOYER (blok $BLOCK, $(arbiscan "$TX"))"; echo "poolA=$A poolB=$B vol=$VOL usdg=$USDG seq=$SEQ"
echo "sigmaBase=$SB ($(python3 -c "print(f'{$SB/1e18:.4f}')"))"; jq .pools "$DEP"
