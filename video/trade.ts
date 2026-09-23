/**
 * Off-camera trades from the filming account, with the dashboard's own write path: quote → simulate the executed path → cap = (premium +
 * scaled fee) × 1.01 → gas estimate × 1.5 → send → receipt must be `success`. Used once before the settlement take (the straddle whose
 * claim the video shows); the on-camera trade goes through the dashboard itself (record.ts).
 *
 *   set -a; source .env; set +a
 *   node --experimental-strip-types video/trade.ts buy B "C 2600 #0" 0.1
 */
import { parseUnits } from "viem";
import { ALL_SERIES, EXPLORER, client, filmingAccount, poolAbi, poolAddress, seriesLabel, usdg, walletFor, type PoolKey } from "./lib.ts";

const MAX_UINT = 2n ** 256n - 1n;
const SLIPPAGE_BPS = 100n;

export async function buy(k: PoolKey, labelPrefix: string, size: string) {
  const account = filmingAccount();
  if (!account) throw new Error("SEPOLIA_PRIVATE_KEY is not set — load .env into this shell first");
  const series = ALL_SERIES.find((s) => seriesLabel(s).startsWith(labelPrefix));
  if (!series) throw new Error(`no series "${labelPrefix}" in the manifest`);
  const id = series.ids[k], units = parseUnits(size, 18), pool = poolAddress(k);
  const q = await client.readContract({ address: pool, abi: poolAbi, functionName: "quoteBuy", args: [id, units] });
  const { result: premExec } = await client.simulateContract({ address: pool, abi: poolAbi, functionName: "buy", args: [id, units, MAX_UINT], account });
  const feeExec = q.premiumAssets === 0n ? q.feeAssets : (q.feeAssets * premExec) / q.premiumAssets + 1n;
  const cap = ((premExec + feeExec) * (10_000n + SLIPPAGE_BPS)) / 10_000n;
  const { request } = await client.simulateContract({ address: pool, abi: poolAbi, functionName: "buy", args: [id, units, cap], account });
  const gas = await client.estimateContractGas({ address: pool, abi: poolAbi, functionName: "buy", args: [id, units, cap], account });
  const hash = await walletFor(account).writeContract({ ...request, gas: (gas * 3n) / 2n });
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`buy reverted on-chain: ${EXPLORER}/tx/${hash}`);
  console.log(`buy ${size} ${seriesLabel(series)} on ${k}: premium ${usdg(premExec, 6)} + fee ≈ ${usdg(feeExec, 6)} (cap ${usdg(cap, 6)}) · gas ${receipt.gasUsed} · block ${receipt.blockNumber}`);
  console.log(`${EXPLORER}/tx/${hash}`);
  return { hash, block: receipt.blockNumber, series: series.index };
}

const isMain = process.argv[1] && new URL(import.meta.url).pathname === process.argv[1];
if (isMain) {
  const [cmd, k, label, size] = process.argv.slice(2);
  if (cmd !== "buy" || !k || !label || !size || !["A", "B", "C"].includes(k)) {
    console.error('usage: trade.ts buy <A|B|C> "<series label prefix, e.g. C 2600 #0>" <size, e.g. 0.1>');
    process.exit(2);
  }
  buy(k as PoolKey, label, size).catch((e) => { console.error(e instanceof Error ? e.message.split("\n")[0] : e); process.exit(1); });
}
