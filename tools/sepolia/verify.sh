#!/usr/bin/env bash
# Verifikasi sumber kontrak Solidity Equinox di Arbitrum Sepolia lewat Sourcify — tanpa API key, tanpa kunci, tanpa tx.
# Alamat luar dari deployments/arbitrum-sepolia.json; alamat dalam dibaca on-chain (`factory()`, `factory.poolDeployer()`,
# `pool.token()`, `pool.vol()`). Sourcify mencocokkan bytecode + metadata dari kompilasi lokal (foundry.toml: solc 0.8.28,
# via-IR, 200 runs) sehingga argumen konstruktor tidak perlu dikirim — termasuk struct `EquinoxPool.Deploy` untuk kedua pool.
# Setiap kontrak dilaporkan sendiri-sendiri: `verified` (exact_match: metadata identik), `partial` (match: bytecode sama, metadata
# beda), atau `failed: <alasan>`; kegagalan satu kontrak tidak menghentikan yang lain, dan skrip selalu keluar 0 (laporan, bukan gate).
# Idempoten: kontrak yang sudah exact_match di Sourcify dilaporkan dari statusnya, tidak dikirim ulang; partial dikirim lagi.
# Pakai: tools/sepolia/verify.sh [deployments/arbitrum-sepolia.json]      env opsional: SEPOLIA_RPC_URL, SOURCIFY_URL
# Arbiscan (opsional, butuh ETHERSCAN_API_KEY): `forge verify-contract --chain 421614 --verifier etherscan --etherscan-api-key
#   "$ETHERSCAN_API_KEY" <alamat> <path:Kontrak> --constructor-args <abi-encoded>` per kontrak dari direktori contracts/ —
#   Etherscan butuh argumen konstruktor eksplisit (`cast abi-encode`), termasuk tuple `Deploy` lengkap untuk EquinoxPool; tidak
#   dijalankan skrip ini.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEP="${1:-$ROOT/deployments/arbitrum-sepolia.json}"
[ -f "$DEP" ] || { echo "tidak ada $DEP"; exit 1; }
RPC="${SEPOLIA_RPC_URL:-$(jq -r .rpc "$DEP")}"
SOURCIFY="${SOURCIFY_URL:-https://sourcify.dev/server}"
FORGE_URL=(); [ -z "${SOURCIFY_URL:-}" ] || FORGE_URL=(--verifier-url "$SOURCIFY_URL")   # default forge = sourcify.dev
CHAIN=$(jq -r .chainId "$DEP"); [ "$CHAIN" == "421614" ] || { echo "chainId $CHAIN bukan Arbitrum Sepolia (421614)"; exit 1; }

addr() { cast call --rpc-url "$RPC" "$1" "$2" | awk '{print tolower($1)}'; }
lower() { echo "$1" | tr '[:upper:]' '[:lower:]'; }

# --- alamat: luar dari JSON, dalam dari chain ---
j() { lower "$(jq -r "$1" "$DEP")"; }
SOL=$(j .blackScholesSol); BENCH=$(j .bench)
DEPLOYER=$(j .pools.deployer); USDG=$(j .pools.usdg); SEQ=$(j .pools.sequencerFeed)
VOL=$(j .pools.vol); A=$(j .pools.A.pool); B=$(j .pools.B.pool)
[ "$DEPLOYER" != "null" ] || { echo "blok .pools belum ada di $DEP (jalankan deploy-pools.sh dulu)"; exit 1; }
FACTORY=$(addr "$DEPLOYER" "factory()(address)") || { echo "gagal membaca factory() dari $DEPLOYER via $RPC"; exit 1; }
POOL_DEPLOYER=$(addr "$FACTORY" "poolDeployer()(address)")
TOK_A=$(addr "$A" "token()(address)"); TOK_B=$(addr "$B" "token()(address)")
VOL_A=$(addr "$A" "vol()(address)"); VOL_B=$(addr "$B" "vol()(address)")
[ "$VOL_A" == "$VOL_B" ] && [ "$VOL_A" == "$VOL" ] || echo "peringatan: vol() A=$VOL_A B=$VOL_B JSON=$VOL — engine tidak bersama?"
[ "$(j .pools.A.token)" == "$TOK_A" ] && [ "$(j .pools.B.token)" == "$TOK_B" ] || echo "peringatan: token() on-chain ≠ JSON"

# nama | alamat | path:Kontrak — urutan = urutan deploy
TARGETS=(
  "BlackScholesSol|$SOL|src/math/BlackScholesSol.sol:BlackScholesSol"
  "Bench|$BENCH|src/Bench.sol:Bench"
  "PoolE2EDeployer|$DEPLOYER|src/mocks/PoolE2EDeployer.sol:PoolE2EDeployer"
  "MockUSDG|$USDG|src/mocks/MockUSDG.sol:MockUSDG"
  "MockSequencerFeed|$SEQ|src/mocks/MockSequencerFeed.sol:MockSequencerFeed"
  "EquinoxFactory|$FACTORY|src/pool/EquinoxFactory.sol:EquinoxFactory"
  "PoolDeployer|$POOL_DEPLOYER|src/pool/EquinoxFactory.sol:PoolDeployer"
  "EquinoxVolEngine|$VOL_B|src/pool/EquinoxVolEngine.sol:EquinoxVolEngine"
  "EquinoxOptionToken (B)|$TOK_B|src/pool/EquinoxOptionToken.sol:EquinoxOptionToken"
  "EquinoxPool (B, Stylus)|$B|src/pool/EquinoxPool.sol:EquinoxPool"
  "EquinoxOptionToken (A)|$TOK_A|src/pool/EquinoxOptionToken.sol:EquinoxOptionToken"
  "EquinoxPool (A, kontrol)|$A|src/pool/EquinoxPool.sol:EquinoxPool"
)

# status Sourcify v2: exact_match | match | null (belum) | error
status() { curl -sS --max-time 30 "$SOURCIFY/v2/contract/$CHAIN/$1" | jq -r '.match // "null"' 2>/dev/null || echo "error"; }
word() { case "$1" in exact_match) echo verified ;; match) echo partial ;; *) echo "$1" ;; esac; }
# baris terakhir keluaran forge yang bukan boilerplate = alasan gagal
reason() { grep -vE '^\s*$|^Start verifying|^Attempting|^Submitting|^Submitted|^\s+(Verification Job|URL)|^Warning: Verification is still pending' <<< "$1" | tail -1 | cut -c1-160; }

cd "$ROOT/contracts"
echo "== verifikasi Sourcify ($SOURCIFY) chain $CHAIN — $(date -u +%FT%TZ)"
printf '%-26s %-42s %s\n' "Kontrak" "Alamat" "Hasil"
NV=0; NP=0; NF=0
for t in "${TARGETS[@]}"; do
  IFS='|' read -r NAME ADDRESS TARGET <<< "$t"
  if [ -z "$ADDRESS" ] || [ "$ADDRESS" == "null" ]; then printf '%-26s %-42s %s\n' "$NAME" "-" "failed: alamat tidak ada"; NF=$((NF+1)); continue; fi
  pre=$(status "$ADDRESS")
  if [ "$pre" == "exact_match" ]; then
    res="verified (sudah terverifikasi)"
  else
    # `match` (partial) tetap dikirim: Sourcify menaikkan partial → exact bila sumber kita menghasilkan metadata identik
    # (mis. MockUSDG sempat tercatat partial dari bytecode MockUSDC proyek lain lewat pencocokan otomatis Sourcify).
    out=$(forge verify-contract --chain "$CHAIN" --verifier sourcify ${FORGE_URL[@]+"${FORGE_URL[@]}"} --skip-is-verified-check --watch "$ADDRESS" "$TARGET" 2>&1)
    st=$(grep -oE 'Status: `[a-z_]+`' <<< "$out" | tail -1 | grep -oE '[a-z_]+`$' | tr -d '`')
    if [ "$st" == "exact_match" ] || [ "$st" == "match" ]; then res=$(word "$st")
    else
      post=$(status "$ADDRESS")   # forge bisa gagal mem-parsing padahal Sourcify sudah menyimpan hasilnya
      if [ "$post" == "exact_match" ]; then res=verified
      elif [ "$post" == "match" ]; then res="partial ($(reason "$out"))"
      else r=$(reason "$out"); res="failed: ${r:-tanpa pesan}"; fi
    fi
  fi
  case "$res" in verified*) NV=$((NV+1)) ;; partial*) NP=$((NP+1)) ;; *) NF=$((NF+1)) ;; esac
  printf '%-26s %-42s %s\n' "$NAME" "$ADDRESS" "$res"
done
echo "== ringkasan: verified $NV, partial $NP, failed $NF dari ${#TARGETS[@]} kontrak; lihat https://repo.sourcify.dev/$CHAIN/<alamat>"
exit 0
