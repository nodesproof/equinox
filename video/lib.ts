/**
 * Shared pieces of the video pipeline: the deployment manifest (the single source of addresses and series ids — nothing is typed here),
 * the series list in the dashboard's order, the read client, and the filming wallet (a local signer; the key never enters the browser).
 */
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, decodeFunctionData, formatUnits, http, toFunctionSelector, type Address, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { equinoxPoolAbi } from "../web/src/abi/equinoxPool.ts";

export const VIDEO_DIR = path.dirname(new URL(import.meta.url).pathname);
export const ROOT = path.resolve(VIDEO_DIR, "..");
export const OUT_DIR = path.join(VIDEO_DIR, "out");
export const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments", "arbitrum-sepolia.json"), "utf8"));
export const RPC: string = MANIFEST.rpc;
export const EXPLORER = "https://sepolia.arbiscan.io";
export const WAD = 10n ** 18n;
export const ASSET_SCALE = 10n ** 12n;

export type PoolKey = "A" | "B" | "C";
export const POOL_KEYS = (["A", "B", "C"] as const).filter((k) => MANIFEST.pools[k]);
export const poolAddress = (k: PoolKey): Address => MANIFEST.pools[k].pool;

export type SeriesRef = { index: number; boardId: number; expiry: number; strike: number; isCall: boolean; ids: Record<PoolKey, bigint> };
/** Same order as the dashboard's ALL_SERIES (web/src/deployment.ts): board by board, strike by strike, call before put. */
export const ALL_SERIES: SeriesRef[] = (() => {
  const out: SeriesRef[] = [];
  for (const b of MANIFEST.pools.boards) {
    b.strikes.forEach((s: string, si: number) => {
      for (const isCall of [true, false]) {
        const ids = Object.fromEntries(POOL_KEYS.map((k) => [k, BigInt(b.seriesIds[k][si * 2 + (isCall ? 0 : 1)])])) as Record<PoolKey, bigint>;
        out.push({ index: out.length, boardId: b.id, expiry: b.expiry, strike: Number(s), isCall, ids });
      }
    });
  }
  return out;
})();
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** The dashboard's seriesLabel: `C 2600 #1 (2 Oct)`. */
export function seriesLabel(s: SeriesRef): string {
  const d = new Date(s.expiry * 1000);
  return `${s.isCall ? "C" : "P"} ${s.strike} #${s.boardId} (${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]})`;
}

export const client = createPublicClient({ chain: arbitrumSepolia, transport: http(RPC, { timeout: 20_000, retryCount: 2 }) });

/** The filming account, from SEPOLIA_PRIVATE_KEY (load .env into the shell: `set -a; source .env; set +a`). Never logged. */
export function filmingAccount(): PrivateKeyAccount | null {
  const key = process.env.SEPOLIA_PRIVATE_KEY;
  if (!key) return null;
  return privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
}
export function walletFor(account: PrivateKeyAccount) {
  return createWalletClient({ account, chain: arbitrumSepolia, transport: http(RPC, { timeout: 30_000, retryCount: 1 }) });
}

/** Selectors of the calls the filming wallet may send (anything else is refused — see record.ts), derived, not typed. */
export const ALLOWED_SELECTORS: Record<string, string> = Object.fromEntries(
  ["buy(uint256,uint256,uint256)", "claim(uint256,uint256)"].map((sig) => [toFunctionSelector(sig), sig]),
);

/** Number words for the narration (0–999). */
const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
export function words(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999) throw new Error(`words(): ${n} out of range`);
  if (n < 20) return ONES[n]!;
  if (n < 100) return TENS[Math.floor(n / 10)]! + (n % 10 ? `-${ONES[n % 10]}` : "");
  return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${words(n % 100)}` : ""}`;
}
export const capitalized = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "1.15" → "one point one five" (a decimal is read digit by digit after the point). */
export function decimalWords(x: string): string {
  const [i, f] = x.split(".");
  return words(Number(i)) + (f ? ` point ${[...f].map((d) => ONES[Number(d)]).join(" ")}` : "");
}
/** 6-dp asset units → "16,400.00". */
export const usdg = (v: bigint, dp = 2) => (Number(v) / 1e6).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
/** WAD → fixed string. */
export const wadFixed = (v: bigint, dp: number) => (Number(v) / 1e18).toFixed(dp);

export const poolAbi = equinoxPoolAbi;

// ---------------------------------------------------------------- narration clock and the filming wallet guard

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
/** Seconds from narration start at which `phrase` begins, per the TTS word boundaries. */
export function phraseStart(words: { start: number; text: string }[], phrase: string): number {
  const target = norm(phrase).split(" ");
  // One TTS word can hold several tokens ("ETH-USD" → "eth usd"): flatten, remembering which word each token starts in.
  const toks = words.flatMap((w) => norm(w.text).split(" ").filter(Boolean).map((t) => ({ t, start: w.start })));
  for (let i = 0; i + target.length <= toks.length; i++) if (target.every((t, k) => toks[i + k]!.t === t)) return toks[i]!.start;
  throw new Error(`phrase not found in narration: "${phrase}"`);
}

/** Checks one transaction request from the page against the allowlist; returns a human description or throws. */
export function vet(tx: { from?: string; to?: string; data?: Hex }, take: { trade: { pool: PoolKey; size: string } }, account: string): string {
  if (!tx.to || tx.to.toLowerCase() !== poolAddress(take.trade.pool).toLowerCase()) throw new Error(`refused: target ${tx.to} is not pool ${take.trade.pool}`);
  if (tx.from && tx.from.toLowerCase() !== account.toLowerCase()) throw new Error("refused: from is not the filming account");
  const sel = (tx.data ?? "0x").slice(0, 10);
  if (!ALLOWED_SELECTORS[sel]) throw new Error(`refused: selector ${sel} is not buy/claim`);
  const { functionName, args } = decodeFunctionData({ abi: poolAbi, data: tx.data! });
  if (functionName === "buy") {
    const size = args![1] as bigint;
    if (size > (BigInt(Math.round(Number(take.trade.size) * 1e6)) * WAD) / 1_000_000n) throw new Error(`refused: buy size ${size} above the take's ${take.trade.size}`);
  }
  const a = (args ?? []) as bigint[];
  return functionName === "buy" ? `buy(series ${String(a[0]).slice(0, 10)}…, size ${formatUnits(a[1]!, 18)}, max ${formatUnits(a[2]!, 6)} USDG)` : `${functionName}(series ${String(a[0]).slice(0, 10)}…, ${formatUnits(a[1]!, 18)})`;
}
