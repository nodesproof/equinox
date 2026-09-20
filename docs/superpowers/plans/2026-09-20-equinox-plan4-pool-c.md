# Equinox Plan 4 — Pool C di atas USDG Paxos asli, dashboard N-pool, koreksi klaim USDG (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pool ketiga ("C") yang identik dengan Pool B tetapi ber-aset **USDG Paxos asli** di Arbitrum Sepolia (`0xFFC95faa3d63Cde504a05B567C600B78C0b41892`), dengan board yang sama, disettle keeper yang sama, tampil dan bisa ditrade di dashboard (aset per pool), dibuktikan dengan satu trade nyata di USDG asli, dan klaim "no USDG on Sepolia" dikoreksi di semua dokumen.

**Architecture:** tidak ada kontrak baru — `EquinoxFactory(0x2014077542088eCeFf980221CFc7Fa6b96A4F2e5).createPoolWithVol(Deploy{usdg: USDG asli, math: Stylus, cfg = cfg B}, vol bersama)`; skrip bash `tools/sepolia/pool-c.sh` (pola `lib.sh`: `send` = estimate × 1,5 + cek status) menulis `pools.C` + `boards[].seriesIds.C` ke manifest; keeper/verify/list-boards membaca daftar pool dari manifest; web: `POOL_KEYS` dari manifest, `POOLS[k].asset/faucet`, snapshot/trade/panel iterasi `POOL_KEYS`.

**Tech Stack:** bash + Foundry `cast` 1.5.x + `jq` + python3; web Vite 6 / TypeScript 5 / viem 2.21 / vitest 2; tidak ada dependensi baru.

**Spec:** `docs/superpowers/specs/2026-09-20-equinox-plan4-pool-c-usdg-design.md` (P1–P8). Plan 3b selesai: PR #6 (`feat/plan-3b` → `feat/plan-3a`).

## Global Constraints

- Root `/home/mdlog/Project-MDlabs/Hackquest/arbitrum-sg/Equinox`; branch **`feat/plan-4`** dari `feat/plan-3b` (HEAD awal `7595551`). Perintah npm dari `web/`; skrip Sepolia dari root.
- **Kontrak beku:** tidak ada perubahan di `contracts/`; ABI di `web/src/abi/` tidak berubah (job drift CI tetap hijau).
- **Kunci** hanya lewat `.env` (git-ignored) yang dimuat `tools/sepolia/lib.sh` (`SEPOLIA_PRIVATE_KEY` owner `0x90351bB1E85a17D5f70c62C0cC076D39D897076D`; `KEEPER_PRIVATE_KEY`/`KEEPER_ADDRESS` `0x2e5607862E1c42C24Ea91d50C5737715a71ba89B`). Tidak pernah dicetak, di-echo, di-grep, disalin ke laporan.
- **Transaksi nyata** hanya yang disebut tugas: `createPoolWithVol` (≈ 5,05 M gas), `createBoard` ×2 di C, `approve`/`deposit` USDG asli, satu `buy` + satu `close` 0,01 unit di board 1 Pool C. **Tidak ada** trade di board 0 pool mana pun sebelum Jumat 25 Sep; tidak ada tx di Pool A/B.
- USDG asli: `0xFFC95faa3d63Cde504a05B567C600B78C0b41892` (6 dp; `mint` tertutup; faucet `https://faucet.paxos.com/` 100 USDG/wallet/hari). Saldo owner bisa 0 sampai pengguna meminta faucet — tugas yang membutuhkannya memeriksa saldo dan **ditunda** (bukan gagal) bila 0.
- Manifest `deployments/arbitrum-sepolia.json` = satu-satunya sumber alamat; `pools.usdg` tetap mock (aset A/B); `pools.C.asset` = USDG asli. Tidak ada alamat hard-coded di `web/src` selain Multicall3/explorer; URL faucet Paxos boleh sebagai konstanta di `web/src/chain/trade.ts`.
- Konfigurasi Pool C **identik** dengan B (dibaca on-chain dari B dan diverifikasi setelah deploy): `cfg()`, `rWad()`, `feed()`, `sequencerFeed()`, `vol()`, `math()`; hanya `asset()` yang berbeda.
- Web: `PoolKey = 'A' | 'B' | 'C'`; `POOL_KEYS` = kunci yang **ada di manifest**; tidak ada hard-code jumlah pool/board/seri; paritas K5 dan counter gas tetap A vs B; jumlah unit test **tetap 33** (tambahkan assertion di dalam `it` yang ada); `npm run typecheck && npm test && npm run build` hijau; `npm run test:network` 3 lulus.
- Commit: pesan polos TANPA trailer/atribusi AI; `git add` path eksplisit; identitas repo-lokal `nodesproof`. Bahasa: komentar & dokumen Indonesia (README/UI/JUDGE_QA/SUBMISSION Inggris); identifier Inggris.
- Kejujuran: "Pool C settles in Paxos USDG (testnet)"; tidak ada kata "mainnet"/"production USDG"; angka faucet (100/hari) dan skala pool (ratusan USDG) disebut di mana pun Pool C dijelaskan.

---

### Task 1: `tools/sepolia/pool-c.sh` — deploy Pool C, board, manifest; keeper/verify/list-boards membaca pool dari manifest

**Files:**
- Create: `tools/sepolia/pool-c.sh`
- Modify: `tools/keeper/keeper.sh` (loop settle), `tools/sepolia/verify.sh` (TARGETS + token/vol check), `tools/sepolia/list-boards.sh` (board di C, seed mock hanya A/B), `deployments/arbitrum-sepolia.json` (ditulis skrip), `docs/DEMO_LOG.md` (entri deploy)

**Interfaces:**
- Produces: manifest `pools.C = { label, pool, token, math, asset, assetSymbol: "USDG", assetKind: "paxos", createTx, createdAtBlock }`, `pools.boards[i].seriesIds.C: string[6]`, `pools.boards[i].listTx.C`. Dipakai Task 2–4.
- Consumes: `tools/sepolia/lib.sh` (`send`, `addr`, `num`, `field`, `jq_set`, `die`, `arbiscan`, `ME`, `PK`, `RPC`, `DEP`).

- [ ] **Step 1: Tulis `tools/sepolia/pool-c.sh`**

```bash
#!/usr/bin/env bash
# Pool C — Equinox di atas USDG Paxos asli (Arbitrum Sepolia): pool identik dengan Pool B (math Stylus, engine vol bersama,
# cfg sama) tetapi asset() = USDG 0xFFC9…1892 (faucet.paxos.com, 100 USDG/wallet/hari; mint tertutup). Tidak ada kontrak baru.
# Pakai: tools/sepolia/pool-c.sh deploy | boards | seed [USDG=100] [--keeper] | trade [SIZE=0.01] | status
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
*) echo "pakai: $0 deploy | boards | seed [USDG] [--keeper] | trade [SIZE] | status"; exit 2 ;;
esac
```

- [ ] **Step 2: Dry-run tanpa transaksi** — `bash -n tools/sepolia/pool-c.sh`; lalu, dari root dengan `.env` termuat oleh lib.sh, cek encoding tanpa mengirim: ulangi `cast call --from $ME $FACTORY "$DSIG" "$D" $VOL` (hasil = alamat pool prediktif, seperti dry-run 20 Sep: `0xebd255c8…`) dan `cast estimate` (≈ 5,05 M). Paste keduanya ke laporan.
- [ ] **Step 3: `tools/sepolia/pool-c.sh deploy`** (tx nyata, owner). Lalu `tools/sepolia/pool-c.sh boards` (2 tx: board 25 Sep dan 2 Okt di C). Lalu `tools/sepolia/pool-c.sh status`. Paste keluaran (tanpa kunci).
- [ ] **Step 4: Keeper membaca semua pool** — di `tools/keeper/keeper.sh` ganti `for P in "$A" "$B"; do` dengan `for P in $(jq -r '[.pools.A.pool, .pools.B.pool, .pools.C.pool // empty] | .[]' "$DEP"); do` (baris ~73) dan tambahkan ke baris 12 `C=$(jq -r '.pools.C.pool // empty' "$DEP")` (dipakai di log). Uji: `DRY_RUN=1 tools/keeper/keeper.sh` harus menampilkan tiga pool ("board 0 @ <C>: belum bisa settle (BoardNotExpired — …)").
- [ ] **Step 5: `verify.sh`** — setelah `A=$(j .pools.A.pool); B=$(j .pools.B.pool)` tambahkan `C=$(j '.pools.C.pool // empty')`; bila `C` tidak kosong tambahkan ke `TARGETS` `"EquinoxPool C|$C|src/pool/EquinoxPool.sol:EquinoxPool"` dan `"EquinoxOptionToken C|$(addr "$C" "token()(address)")|src/token/EquinoxOptionToken.sol:EquinoxOptionToken"` (path kontrak token: lihat entri A/B yang sudah ada di TARGETS dan tiru persis); cek `vol()` C == VOL. Jalankan `tools/sepolia/verify.sh` → dua baris baru `verified`/exact match; paste.
- [ ] **Step 6: `list-boards.sh`** — generalisasi: `KEYS=(A B); [ "$(jq -r '.pools.C.pool // empty' "$DEP")" ] && KEYS+=(C)`; seed 1.000.000 USDG mock hanya untuk A dan B (loop `for P in "$A" "$B"` tetap); `createBoard` dan derivasi seri untuk setiap kunci (token per kunci dari manifest); `jq_set` menulis `seriesIds` dan `listTx` sebagai objek dari semua kunci (bangun `SIDS='{}'`/`LTX='{}'` dengan `jq -cn --argjson o "$SIDS" --arg k "$K" --argjson v "$S" '$o + {($k): $v}'`). Uji tanpa tx: `bash -n` + jalankan dengan spec expiry yang **sudah tercatat** (`tools/sepolia/list-boards.sh 1790323200:2400,2600,2800`) → "sudah tercatat — lewati" untuk semua kunci, tidak ada tx.
- [ ] **Step 7: DEMO_LOG** — tambahkan bagian "Pool C — USDG Paxos asli (20 Sep 2026)": temuan (alamat USDG, Sourcify, faucet 100/hari, mint tertutup), tx deploy (hash, gas, blok), dua tx board, keluaran `status`; kalimat jujur "seed menunggu faucet; skala pool ratusan USDG".
- [ ] **Step 8: Commit** — `git add tools/sepolia/pool-c.sh tools/keeper/keeper.sh tools/sepolia/verify.sh tools/sepolia/list-boards.sh deployments/arbitrum-sepolia.json docs/DEMO_LOG.md && git commit -m "sepolia: Pool C on real Paxos USDG via the existing factory; keeper/verify/list-boards read pools from the manifest"`.

---

### Task 2: Web — pool dari manifest, aset per pool, Pool C di dashboard dan panel Trade

**Files:**
- Modify: `web/src/deployment.ts`, `web/src/chain/snapshot.ts`, `web/src/chain/gas.ts`, `web/src/chain/trade.ts`, `web/src/chain/events.ts` (hanya bila perlu tipe), `web/src/panels/{nav,board,trade,footer,header}.ts`, `web/src/styles.css`, `web/test/{deployment,seriesId,snapshot,trade,parity.network}.test.ts`, `web/README.md`
- Tidak diubah: `web/src/abi/*`, `web/src/chain/parity.ts` (A vs B), `web/src/chain/wallet.ts`, `web/scripts/*`, `web/test/smoke.network.test.ts` (Pool B, aset mock).

**Interfaces:**
- Produces (`deployment.ts`): `type PoolKey = 'A' | 'B' | 'C'`; `type FaucetKind = 'mint' | 'paxos'`; `interface PoolInfo { pool; token; math; label; asset; assetSymbol; faucet: FaucetKind }`; `POOL_KEYS: PoolKey[]` (kunci yang ada di manifest, urut A,B,C); `POOLS: Record<PoolKey, PoolInfo>` (hanya kunci di `POOL_KEYS` yang terisi — jangan mengindeks kunci lain); `GAS_KEYS: readonly ['A','B']`; `Board.seriesIds: Record<PoolKey, bigint[]>`; `SeriesRef.id: Record<PoolKey, bigint>` (id kunci yang tidak ada di manifest dihitung `seriesId(POOLS[k].pool, expiry, K·1e18, isCall)`); `PAXOS_FAUCET = 'https://faucet.paxos.com/'`.
- Produces (`snapshot.ts`): `SeriesRow = { ref: SeriesRef } & Record<PoolKey, SeriesState>`; `UserState = { address; asset: Record<PoolKey, bigint>; allowance; shares; positions }` (`usdg` dihapus → `asset[k]`); `PoolState.cash` = saldo `POOLS[k].asset` di pool.
- Produces (`trade.ts`): `approveCall(k)` → `{ address: POOLS[k].asset, … }`; `faucetCall(k, to, amount?)` → `{ address: POOLS[k].asset, functionName: 'mint' }` (pemanggil hanya untuk `faucet === 'mint'`); `assetLabel(k)` = `${POOLS[k].assetSymbol}${POOLS[k].faucet === 'paxos' ? ' (Paxos)' : ' (mock)'}`.

- [ ] **Step 1: `deployment.ts`** — ganti bagian pool/board/seri dengan:

```ts
export type PoolKey = 'A' | 'B' | 'C';
export type FaucetKind = 'mint' | 'paxos';
export interface PoolInfo { pool: Address; token: Address; math: Address; label: string; asset: Address; assetSymbol: string; faucet: FaucetKind }
type RawPool = { pool: string; token: string; math: string; asset?: string; assetSymbol?: string; assetKind?: string };
const P = manifest.pools;
// Pool C opsional di manifest (ada setelah tools/sepolia/pool-c.sh deploy); A/B ber-aset mock (`pools.usdg`, faucet = mint terbuka).
const RAW: Partial<Record<PoolKey, RawPool>> = { A: P.A, B: P.B, C: (P as { C?: RawPool }).C };
const LABEL: Record<PoolKey, string> = { A: 'Pool A — control (BlackScholesSol)', B: 'Pool B — Equinox (Stylus, cached)', C: 'Pool C — Equinox on real USDG (Stylus, cached)' };
export const POOL_KEYS: PoolKey[] = (['A', 'B', 'C'] as PoolKey[]).filter((k) => RAW[k] !== undefined);
export const POOLS = Object.fromEntries(POOL_KEYS.map((k) => {
  const r = RAW[k]!;
  return [k, { pool: getAddress(r.pool), token: getAddress(r.token), math: getAddress(r.math), label: LABEL[k],
    asset: getAddress(r.asset ?? P.usdg), assetSymbol: r.assetSymbol ?? 'USDG', faucet: r.assetKind === 'paxos' ? 'paxos' : 'mint' } satisfies PoolInfo];
})) as Record<PoolKey, PoolInfo>;
/** Counter gas & paritas K5 selalu A (Solidity) vs B (Stylus); C memakai math yang sama dengan B. */
export const GAS_KEYS = ['A', 'B'] as const;
export const PAXOS_FAUCET = 'https://faucet.paxos.com/';
export const WAD = 10n ** 18n;
export interface Board { id: number; expiry: number; strikes: number[]; seriesIds: Record<PoolKey, bigint[]> }
export interface SeriesRef { boardId: number; expiry: number; strike: number; isCall: boolean; idx: number; id: Record<PoolKey, bigint> }
export function seriesId(pool: `0x${string}`, expiry: number, strikeWad: bigint, isCall: boolean): bigint { /* tidak berubah */ }
type RawBoard = { id: number; expiry: number; strikes: string[]; seriesIds: Partial<Record<PoolKey, string[]>> };
/** Id seri per pool: dari manifest bila ada, selain itu diturunkan (deterministik, sama dengan EquinoxOptionToken.seriesId). */
export const BOARDS: Board[] = (P.boards as RawBoard[]).map((b) => ({
  id: b.id, expiry: b.expiry, strikes: b.strikes.map(Number),
  seriesIds: Object.fromEntries(POOL_KEYS.map((k) => [k, b.seriesIds[k]?.map(BigInt)
    ?? b.strikes.flatMap((s) => [true, false].map((c) => seriesId(POOLS[k].pool, b.expiry, BigInt(s) * WAD, c)))])) as Record<PoolKey, bigint[]>,
}));
export const ALL_SERIES: SeriesRef[] = BOARDS.flatMap((b) => b.strikes.flatMap((strike, i) => [true, false].map((isCall, c) => {
  const idx = 2 * i + c;
  return { boardId: b.id, expiry: b.expiry, strike, isCall, idx, id: Object.fromEntries(POOL_KEYS.map((k) => [k, b.seriesIds[k][idx]!])) as Record<PoolKey, bigint> };
})));
```
(`USDG` tetap diekspor = mock, dipakai footer/tests; `WAD` dideklarasikan sebelum `BOARDS`.)

- [ ] **Step 2: `snapshot.ts`** — (a) `coreCalls` per pool: `balanceOf` memakai `POOLS[k].asset` (bukan `USDG`); (b) seri: `const st = (k: PoolKey, j: number)` dengan `o = (i * POOL_KEYS.length + j) * 3`; baris `{ ref, ...Object.fromEntries(POOL_KEYS.map((k, j) => [k, st(k, j)])) } as SeriesRow`; (c) pengguna: per pool `[asset.balanceOf(account), asset.allowance(account, pool), pool.balanceOf(account), ...token.balanceOf(account, id)…]`, `n = 3 + ALL_SERIES.length`, `user = { address, asset: {}, allowance: {}, shares: {}, positions: {} } as UserState` diisi lewat `POOL_KEYS.forEach`; (d) `atmSeries`: `const k0 = POOL_KEYS[0]!` lalu `r[k0].settled`. Tipe: `export type SeriesRow = { ref: SeriesRef } & Record<PoolKey, SeriesState>`.
- [ ] **Step 3: `gas.ts`** — `const gas = Object.fromEntries(GAS_KEYS.map((k) => [k, null])) as Record<(typeof GAS_KEYS)[number], bigint | null>`; iterasi `GAS_KEYS`; `GasEstimate.gas` bertipe itu. `board.ts` baris gas memakai `gas.gas.A`/`gas.gas.B` (tetap).
- [ ] **Step 4: `trade.ts`** — `approveCall`/`faucetCall` per pool (lihat Interfaces); `REVERT_TEXT.ERC20InsufficientBalance = 'Not enough USDG in your wallet for this pool — mock pools (A, B): use the faucet button; Pool C: get 100 USDG/day at faucet.paxos.com.'`; `assetLabel(k)`.
- [ ] **Step 5: Panel** — `nav.ts`: kartu per `POOL_KEYS` (kontainer `.cards` dengan `grid-template-columns:repeat(auto-fit,minmax(300px,1fr))` di `styles.css`), label NAV `${usdg(p.totalAssets)} ${POOLS[k].assetSymbol}`; `board.ts`: kolom `Buy ${k}` per pool, `Δ A|B` (relDiff A vs B, tetap), `Close ${k}`, `Parity` (A vs B), `OI ${k}`, `σ_buy A | B | C` — status baris memakai `POOL_KEYS[0]`; catatan kaki tambah kalimat "Pool C: same Stylus math and engine as B, settled in Paxos USDG (testnet)"; `trade.ts` (panel): radio per `POOL_KEYS`; tombol faucet hanya bila `POOLS[pool].faucet === 'mint'`, selain itu tautan `Get 100 USDG/day at faucet.paxos.com ↗` (`PAXOS_FAUCET`, `target=_blank`); teks approve `Approve ${assetLabel(k)} for pool ${k}`; ringkasan akun: baris `Asset balance` per pool (`${usdg(u.asset[k])} ${assetLabel(k)}`), `LP shares`, `Allowance`, `Positions` per pool dibangun dari `POOL_KEYS`; `noWallet`/`gasNote` menyebut Pool C; `footer.ts`: baris pool dari `POOL_KEYS` + baris `USDG (Paxos, real testnet token — asset of Pool C)` bila `POOLS.C` ada, dan kalimat "Mocked on purpose" diperbarui: "USDG on A/B and the sequencer feed are mocks (Paxos USDG exists on Sepolia but its mint is permissioned and the faucet gives 100/day; Pool C uses the real token)". `header.ts` tidak berubah.
- [ ] **Step 6: Tests (tetap 33)** — `deployment.test.ts`: `POOL_KEYS` ⊆ ['A','B','C'], setiap `POOLS[k].asset` alamat valid, `POOLS.A.asset === USDG`, bila `POOL_KEYS.includes('C')` maka `POOLS.C.faucet === 'paxos'` dan `POOLS.C.asset !== USDG`; setiap `ALL_SERIES[i].id[k]` terdefinisi untuk semua `POOL_KEYS`. `seriesId.test.ts`: loop `POOL_KEYS`. `snapshot.test.ts`: `pools: Object.fromEntries(POOL_KEYS.map((k) => [k, pool()]))`, baris seri dibangun dari `POOL_KEYS`. `trade.test.ts`: `approveCall(k).address === POOLS[k].asset` untuk semua `POOL_KEYS`; `faucetCall('A', addr).address === USDG`. `parity.network.test.ts`: user path `for k of POOL_KEYS: positions[k].length === ALL_SERIES.length`; `shares.A === shares.B === 1e12`; bila C ada: `s.pools.C.owner === owner` dan `POOLS.C.asset` = `readContract(asset())` C.
- [ ] **Step 7: Gate + browser** — `npm run typecheck && npm test && npm run build && npm run test:network`; `npx vite preview --port 4173 --strictPort --host 127.0.0.1` + Playwright dari scratchpad (stub provider 4001): (i) tiga kartu NAV, papan dengan kolom C, footer alamat C; (ii) pilih Pool C → tombol faucet hilang, tautan Paxos muncul, approve memakai USDG asli (calldata `approve` ke `0xffc9…`); (iii) 375 px tanpa scroll halaman. Hentikan preview dengan `fuser -k 4173/tcp`.
- [ ] **Step 8: `web/README.md`** — paragraf pool ("three pools; Pool C settles in real Paxos USDG, faucet 100/day"), aset per pool di bagian Trade panel. Commit: `git add web/src web/test web/README.md && git commit -m "web: pools from the manifest, asset per pool, Pool C (real USDG) in the board and trade panel"`.

---

### Task 3: Seed Pool C dan trade nyata pertama di USDG asli (kondisional pada saldo faucet)

**Files:**
- Modify: `docs/DEMO_LOG.md`, `deployments/arbitrum-sepolia.json` (tidak berubah kecuali skrip menulis), tidak ada file lain.

- [ ] **Step 1:** `tools/sepolia/pool-c.sh status` → baca saldo USDG asli owner & keeper. Bila owner < 100 USDG: tulis "DITUNDA — menunggu faucet" di laporan dan **selesai** (task dicatat "deferred" di ledger; dijalankan ulang oleh controller).
- [ ] **Step 2:** `tools/sepolia/pool-c.sh seed 100` (owner; cap aktif seketika — `capitalRefPrev` harus > 0 setelahnya); bila keeper punya ≥ 100: `tools/sepolia/pool-c.sh seed 100 --keeper` (LP kedua; lag 1 hari).
- [ ] **Step 3:** `tools/sepolia/pool-c.sh trade 0.01` — buy lalu close 0,01 unit C K1 board 1 (2 Okt) di Pool C. Paste keluaran; verifikasi `Bought`/`Closed` di explorer dan `tools/demo/sepolia-demo.sh --check` masih hijau untuk A/B (read-only).
- [ ] **Step 4:** DEMO_LOG: entri seed (hash, shares, NAV, capitalRefPrev) dan trade (quote view vs exec, cap, hash, gas) + kalimat "premi dibayar dalam USDG Paxos asli". Commit `docs/DEMO_LOG.md`: `demo: Pool C seeded from the Paxos faucet; first buy/close settled in real USDG`.

---

### Task 4: Dokumen — koreksi klaim USDG, Pool C di semua dokumen, PRD v1.5, brief frontend

**Files:**
- Modify: `README.md`, `docs/SUBMISSION.md`, `docs/JUDGE_QA.md`, `prd-arsitektur.md`, `docs/VERIFICATION.md`, `docs/OPS_SEPOLIA.md`, `docs/DEMO_RUNBOOK.md`, `docs/FRONTEND_BRIEF.md`, `docs/VIDEO_SCRIPT.md` (satu kalimat), `docs/RUBRIC_SCORECARD.md` (bila menyebut mock USDG)

Semua angka/alamat dari manifest, `pool-c.sh status`, DEMO_LOG Task 1/3, dan spec §0 (verifikasi 20 Sep). Verify-before-write: tiap alamat/hash di-grep dari manifest atau DEMO_LOG.

- [ ] **Step 1: README** — tabel "Live on Sepolia": kolom/baris Pool C (pool, token, asset USDG Paxos `0xFFC9…1892`, math = Stylus, vol bersama); paragraf "Mocked on purpose" dikoreksi (USDG ada di Sepolia; faucet 100/hari; mint tertutup; A/B mock agar juri bisa trading dan seed 1 juta; C = jalur aset asli); baris Sourcify: "14 contracts" bila verify.sh Task 1 exact match untuk pool C + token C (angka dari keluaran verify.sh).
- [ ] **Step 2: SUBMISSION** — field 4: alamat USDG asli sebagai aset Pool C + mock untuk A/B; checkbox Paxos → **centang** dengan alasan (Pool C settle dalam USDG Paxos, tx hash dari DEMO_LOG bila Task 3 sudah jalan, atau "seeded/first trade pending faucet" bila belum); daftar "jangan klaim": hapus "Paxos has no USDG on Sepolia", tambah "jangan klaim mainnet/production USDG; skala Pool C ratusan USDG".
- [ ] **Step 3: JUDGE_QA** — Q25 ditulis ulang (fakta faucet/mint/supply, alasan mock di A/B, Pool C); Q26 disesuaikan; satu Q baru "Is Pool C really settling in Paxos USDG?" (≤ 60 kata; jawaban: asset() = 0xFFC9…, Sourcify, faucet 100/day, first buy/close hash) — total 30 Q, perbarui pernyataan jumlah dan cross-ref (VIDEO_SCRIPT Q12, SUBMISSION Q18 tidak bergeser bila Q baru ditambahkan di **akhir** tabel terkait; pastikan dengan grep).
- [ ] **Step 4: PRD v1.5** — header versi/tanggal; §10.3 tabel deployment + Pool C; §16 V9 → "USDG di Sepolia terverifikasi" (alamat, Sourcify, faucet) dan baris V-baru "Pool C settle di USDG asli" dengan hash; §18 catatan Plan 4; kalimat "USDG tidak ada di Sepolia" di mana pun dikoreksi (grep `USDG` di PRD).
- [ ] **Step 5: VERIFICATION.md** — baris V9 diperbarui (Sepolia: ✅ alamat + Sourcify; One: tetap belum diverifikasi) + baris faucet Paxos.
- [ ] **Step 6: OPS_SEPOLIA & DEMO_RUNBOOK** — keeper settle 3 pool; board mingguan harus dibuat di C (`pool-c.sh boards` setelah `list-boards.sh`, atau `list-boards.sh` yang sudah mencakup C); permintaan faucet harian (owner + keeper) sampai Kamis; `--claim` Jumat hanya A/B (C: claim posisi bila ada).
- [ ] **Step 7: FRONTEND_BRIEF** — §2 tabel + Pool C dan USDG asli; §3.9 `asset` per pool; §6.1 faucet per pool; §7 aturan copy Pool C; Appendix C nilai C (dari `status`).
- [ ] **Step 8: Gate & commit** — `grep -rn "no USDG on\|has no USDG\|tidak ada USDG" README.md docs prd-arsitektur.md web/src` harus kosong; `cd web && npm test` (33); commit `docs: Pool C on real Paxos USDG; correct the USDG-on-Sepolia claim; PRD v1.5`.

---

### Task 5: Gate akhir

- [ ] `cd contracts && forge test` (87), `cd web && npm run typecheck && npm test && npm run build && npm run test:network`, `DRY_RUN=1 tools/keeper/keeper.sh` (tiga pool), `tools/sepolia/pool-c.sh status`, `git status` bersih. Tidak ada commit baru kecuali perbaikan.
