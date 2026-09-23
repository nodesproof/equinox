/**
 * Reads the live chain (read-only) and writes out/take.json: every value the narration or the recorder depends on. Aborts when the take
 * would not be true on camera (a parameter the narration names has changed, the on-chain exactness check fails, the filming account
 * cannot trade). Before the first settlement the take is "pending"; after it, the settlement numbers come from board() and the pools'
 * Settled events, never from memory.
 *
 *   set -a; source .env; set +a          # the filming account is derived from SEPOLIA_PRIVATE_KEY (address only in the take)
 *   node --experimental-strip-types video/select.ts
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseAbiItem, type Address } from "viem";
import { equinoxVolEngineAbi } from "../web/src/abi/equinoxVolEngine.ts";
import { equinoxOptionTokenAbi } from "../web/src/abi/equinoxOptionToken.ts";
import { ALL_SERIES, ASSET_SCALE, EXPLORER, MANIFEST, OUT_DIR, POOL_KEYS, ROOT, client, filmingAccount, poolAbi, poolAddress, seriesLabel, usdg, wadFixed, type SeriesRef } from "./lib.ts";
import type { Settled, Take } from "./script.ts";

const BASE = (process.env.EQUINOX_BASE ?? "https://nodesproof.github.io/equinox/").replace(/\/?$/, "/");
const SETTLEMENT_BOARD = 0;
const TRADE = { pool: "B" as const, strike: 2600, size: "0.1", closeSize: "0.05" };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const usd = (wadPrice: bigint) => (Number(wadPrice) / 1e18).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fail = (msg: string): never => { console.error(`not filmable: ${msg}`); process.exit(1); };

/** Real output of the 20 bit-exact checks (both math contracts vs the Python spec). */
function gasCheck(): Take["gasCheck"] {
  const args = ["tools/bench/onchain-check.sh", "deployments/arbitrum-sepolia.json"];
  let out = "";
  try { out = execFileSync("bash", args, { cwd: ROOT, encoding: "utf8", timeout: 300_000 }); } catch (e) { fail(`onchain-check.sh failed: ${String(e).split("\n")[0]}`); }
  const lines = out.split("\n").filter((l) => /^(== target|OK |BEDA )/.test(l));
  const ok = lines.filter((l) => l.startsWith("OK ")).length;
  if (lines.some((l) => l.startsWith("BEDA")) || ok !== 20) fail(`onchain-check.sh: ${ok} OK lines, expected 20`);
  return { command: args.join(" "), lines, ok };
}

/** Bought events of `who` on `pool` for `ids`, scanned backwards in 50k-block windows (the public RPC rate-limits wider ranges). */
async function boughtBy(pool: Address, who: Address, ids: bigint[], fromBlock: bigint, toBlock: bigint) {
  const ev = parseAbiItem("event Bought(uint256 indexed seriesId, address indexed trader, uint256 size, uint256 premiumAssets, uint256 feeAssets, uint256 sigmaBuy, uint256 spotWad)");
  const hits: { seriesId: bigint; block: bigint; tx: `0x${string}` }[] = [];
  for (let hi = toBlock; hi >= fromBlock && hits.length === 0; hi -= 50_000n) {
    const lo = hi - 49_999n > fromBlock ? hi - 49_999n : fromBlock;
    const logs = await client.getLogs({ address: pool, event: ev, args: { trader: who }, fromBlock: lo, toBlock: hi });
    for (const l of logs) if (ids.includes(l.args.seriesId!)) hits.push({ seriesId: l.args.seriesId!, block: l.blockNumber!, tx: l.transactionHash! });
  }
  return hits;
}

async function settlement(blockNumber: bigint, blockTime: number, account: Address | null): Promise<Take["settlement"]> {
  const board = MANIFEST.pools.boards.find((b: { id: number }) => b.id === SETTLEMENT_BOARD);
  const expiryUtc = new Date(board.expiry * 1000).toISOString().replace(".000Z", "Z");
  const states = await Promise.all(POOL_KEYS.map((k) => client.readContract({ address: poolAddress(k), abi: poolAbi, functionName: "board", args: [BigInt(SETTLEMENT_BOARD)] })));
  if (!states.every((b) => b[1])) return { state: "pending", boardId: SETTLEMENT_BOARD, expiryUtc };

  const prices = states.map((b) => usd(b[2]));
  const settledText = prices.every((p) => p === prices[0])
    ? `all ${POOL_KEYS.length === 3 ? "three" : "the"} pools at ${prices[0]}`
    : `the pools at ${prices.slice(0, -1).join(", ")} and ${prices.at(-1)} — one Chainlink round per settle call`;
  // Settled events from the expiry block onwards: who sent them, and pool B's released reserve / added escrow.
  const ev = parseAbiItem("event Settled(uint256 indexed boardId, uint256 settlementPriceWad, uint256 escrowedAddedWad, uint256 reservedReleasedWad)");
  const since = blockNumber - BigInt(Math.ceil((blockTime - board.expiry) / 0.25)) - 20_000n;
  const settledLogs: { k: string; from: Address; released: bigint; escrowed: bigint }[] = [];
  for (const k of POOL_KEYS) {
    for (let lo = since; lo <= blockNumber && !settledLogs.some((s) => s.k === k); lo += 50_000n) {
      const hi = lo + 49_999n < blockNumber ? lo + 49_999n : blockNumber;
      const logs = await client.getLogs({ address: poolAddress(k), event: ev, args: { boardId: BigInt(SETTLEMENT_BOARD) }, fromBlock: lo, toBlock: hi });
      for (const l of logs) {
        const tx = await client.getTransaction({ hash: l.transactionHash! });
        settledLogs.push({ k, from: tx.from, released: l.args.reservedReleasedWad!, escrowed: l.args.escrowedAddedWad! });
      }
    }
  }
  const b = settledLogs.find((s) => s.k === "B") ?? fail("no Settled event for pool B since the expiry");
  const keeper = (process.env.KEEPER_ADDRESS ?? "").toLowerCase();
  const settler: Settled["settler"] = keeper && settledLogs.every((s) => s.from.toLowerCase() === keeper) ? "keeper" : "other";

  // Terminal shot: the real `cast call board(0)` on each pool.
  const lines: string[] = [];
  for (const k of POOL_KEYS) {
    const addr = poolAddress(k);
    lines.push(`$ cast call ${addr.slice(0, 10)}… "board(uint256)(uint64,bool,uint256,uint256[])" ${SETTLEMENT_BOARD}   # pool ${k}`);
    const out = execFileSync("cast", ["call", "--rpc-url", MANIFEST.rpc, addr, "board(uint256)(uint64,bool,uint256,uint256[])", String(SETTLEMENT_BOARD)], { encoding: "utf8" });
    lines.push(...out.trim().split("\n").slice(0, 3).map((l) => l.replace(/\s+\[.*$/, "")));
  }

  // The straddle's paying leg (pool B, the filming account): positions × payoutPerUnit.
  let claim: Settled["claim"] = null, straddleDay = "";
  if (account) {
    const legs = ALL_SERIES.filter((s) => s.boardId === SETTLEMENT_BOARD && s.strike === TRADE.strike);
    const token = MANIFEST.pools.B.token as Address;
    for (const leg of legs) {
      const units = await client.readContract({ address: token, abi: equinoxOptionTokenAbi, functionName: "balanceOf", args: [account, leg.ids.B] });
      const ser = await client.readContract({ address: poolAddress("B"), abi: poolAbi, functionName: "series", args: [leg.ids.B] });
      const payout = (units * ser[7]) / 10n ** 18n / ASSET_SCALE;
      if (units > 0n && payout > 0n && !claim) claim = { series: leg.index, label: seriesLabel(leg), units: wadFixed(units, 2), payout: usdg(payout, 2) };
    }
    const bought = await boughtBy(poolAddress("B"), account, legs.map((l) => l.ids.B), BigInt(MANIFEST.pools.deployedAtBlock), blockNumber);
    if (bought.length) straddleDay = DAYS[new Date(Number((await client.getBlock({ blockNumber: bought[0]!.block })).timestamp) * 1000).getUTCDay()]!;
  }
  return {
    state: "settled", boardId: SETTLEMENT_BOARD, expiryUtc, settledText, settler,
    released: usdg(b.released / ASSET_SCALE), escrowed: usdg(b.escrowed / ASSET_SCALE),
    terminal: { title: `cast call board(${SETTLEMENT_BOARD}) on every pool — Arbitrum Sepolia`, lines },
    claim, straddleDay: straddleDay || "the day before",
  };
}

async function main() {
  const block = await client.getBlock();
  const blockTime = Number(block.timestamp);
  const account = filmingAccount()?.address ?? null;

  const liveSeries = ALL_SERIES.filter((s) => s.expiry > blockTime + 60).length;
  const params = await client.readContract({ address: MANIFEST.pools.vol, abi: equinoxVolEngineAbi, functionName: "params" });
  const vrp = (Number(params[1]) / 1e18).toFixed(2);   // params() = (lambdaPerDay, vrp, alpha, spread, sigmaMin, sigmaMax), WAD
  if (vrp !== "1.15") fail(`params().vrp is ${vrp}; the overview narration and card say 1.15`);

  // The on-camera trade: a call at the narrated strike on the earliest open board other than the settlement board.
  const pick: SeriesRef | undefined = ALL_SERIES.filter((s) => s.isCall && s.strike === TRADE.strike && s.boardId !== SETTLEMENT_BOARD && s.expiry > blockTime + 86_400)
    .sort((a, b) => a.expiry - b.expiry)[0];
  if (!pick) fail(`no open C ${TRADE.strike} series outside board ${SETTLEMENT_BOARD}`);
  if (account) {
    const usdgAddr = MANIFEST.pools.usdg as Address;
    const erc20 = [
      { type: "function", name: "balanceOf", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
      { type: "function", name: "allowance", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
    ] as const;
    const [bal, alw, eth] = await Promise.all([
      client.readContract({ address: usdgAddr, abi: erc20, functionName: "balanceOf", args: [account] }),
      client.readContract({ address: usdgAddr, abi: erc20, functionName: "allowance", args: [account, poolAddress("B")] }),
      client.getBalance({ address: account }),
    ]);
    // "approve once" is narrated over the wallet card's "approved" — the take refuses an account that would need the approve on camera.
    if (alw < 1_000_000n * 10n ** 6n) fail("the filming account has not approved pool B (the narration says it was approved once)");
    if (bal < 1_000n * 10n ** 6n) fail("the filming account holds < 1,000 mock USDG");
    if (eth < 10n ** 15n) fail("the filming account holds < 0.001 Sepolia ETH for gas");
  }

  const take: Take = {
    base: BASE,
    chipHost: new URL(BASE).host + new URL(BASE).pathname.replace(/\/$/, ""),
    explorer: EXPLORER,
    capturedAt: new Date().toISOString(),
    block: block.number.toString(),
    account,
    liveSeries,
    vrp,
    trade: { pool: TRADE.pool, series: pick!.index, label: seriesLabel(pick!), size: TRADE.size, closeSize: TRADE.closeSize },
    gasCheck: gasCheck(),
    settlement: await settlement(block.number, blockTime, account),
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "take.json"), JSON.stringify(take, null, 1));
  console.log(`take @ block ${take.block}: ${liveSeries} live series · vrp ${vrp} · trade ${take.trade.size} ${take.trade.label} on B · gas check ${take.gasCheck.ok}/20 · settlement ${take.settlement.state}` + (account ? "" : " · NO filming account (trade beats cannot be recorded)"));
}

main().catch((e) => { console.error(e instanceof Error ? e.message.split("\n")[0] : e); process.exit(1); });
