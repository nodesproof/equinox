/**
 * The single source of truth for the Equinox demo video: ten beats, their on-screen actions and their narration. Nothing else under
 * video/ contains narration. The words are docs/VIDEO_SCRIPT.md's, with the deviations listed in video/README.md (a browser wallet signs
 * instead of a MetaMask popup; "Confirm." closes beat 5; three pools on screen; "small single calls"; deposit "a fraction of a percent").
 * Every live value comes from out/take.json (select.ts) — never typed here. Every UI string a selector quotes was checked against
 * equinox-dashboard/client/src on 2026-09-23; run `record.ts --probe` after changing one.
 */
import fs from "node:fs";
import path from "node:path";
import { OUT_DIR, capitalized, decimalWords, words } from "./lib.ts";

export type Settled = {
  state: "settled";
  boardId: number;
  expiryUtc: string;
  /** "all three pools at 2,771.02" or "the pools at 2,771.02, 2,771.02 and 2,772.10" — built by select.ts from board(id) per pool. */
  settledText: string;
  /** Who sent the settle transactions: the keeper wallet (cron), or anyone else (permissionless). */
  settler: "keeper" | "other";
  /** From pool B's Settled event (reservedReleasedWad, escrowedAddedWad), 2-dp USDG strings. */
  released: string;
  escrowed: string;
  terminal: { title: string; lines: string[] };
  claim: { series: number; label: string; units: string; payout: string } | null;
  straddleDay: string;
};
export type Take = {
  base: string;
  chipHost: string;
  explorer: string;
  capturedAt: string;
  block: string;
  account: string | null;
  liveSeries: number;
  vrp: string;
  trade: { pool: "B"; series: number; label: string; size: string; closeSize: string };
  gasCheck: { command: string; lines: string[]; ok: number };
  settlement: { state: "pending"; boardId: number; expiryUtc: string } | Settled;
};

/** `at` = do not start this action before the narration reaches this phrase. `prep` = run before the clip's t0 (page loads, snapshot
 *  reads): build.py cuts that lead-in, so the narration never waits for the network on camera. */
export type Action = (
  | { kind: "card"; name: string; ms: number }
  | { kind: "terminal"; title: string; source: "gasCheck" | "settlement"; ms: number }
  | { kind: "explorer"; ms: number }
  | { kind: "explorerOverlay"; ms: number }
  | { kind: "clearOverlay" }
  | { kind: "goto"; path: string }
  | { kind: "connect" }
  | { kind: "wait"; ms: number }
  | { kind: "hover"; selector: string; ms?: number }
  | { kind: "sweep"; selector: string; ms: number }
  | { kind: "scrollTo"; selector: string; ms?: number }
  | { kind: "fill"; selector: string; value: string; ms?: number }
  | { kind: "select"; selector: string; labelPrefix: string; ms?: number }
  | { kind: "waitText"; selector: string; text: string; ms?: number }
  | { kind: "send"; button: string; ms?: number }
) & { at?: string; prep?: boolean };

export type Beat = { id: string; minVisualMs: number; narrationDelayMs: number; narration: string; actions: Action[] };

const OPTIONS_PANEL = 'article[aria-label="Options"]';
const primary = (name: string) => `${OPTIONS_PANEL} button.button-primary:text-is("${name}")`;

export function beats(take: Take): Beat[] {
  const t = take.trade;
  const tradePath = `#/trade?pool=${t.pool}&series=${t.series}`;
  const live = take.liveSeries;
  const s = take.settlement;
  const out: Beat[] = [
    {
      id: "01-problem",
      minVisualMs: 13000,
      narrationDelayMs: 300,
      narration: "Every on-chain options venue we know of gets implied volatility — the one Black-Scholes input nobody can observe — from a server or a team-run oracle. On a seven-day, five-percent-out-of-the-money ETH call, ten vol points move the premium thirty-three percent.",
      actions: [{ kind: "card", name: "problem", ms: 1000 }],
    },
    {
      id: "02-claim",
      minVisualMs: 15000,
      narrationDelayMs: 0,
      narration: "Equinox removes the IV oracle. Black-Scholes runs in Rust inside Arbitrum Stylus, and volatility is computed on-chain from Chainlink prints; the only external input is spot. Two identical pools are live on Arbitrum Sepolia — Stylus versus a Solidity control.",
      actions: [{ kind: "card", name: "claim", ms: 1000 }],
    },
    {
      id: "03-overview",
      minVisualMs: 14000,
      narrationDelayMs: 0,
      narration: `The live dashboard reads Arbitrum Sepolia every fifteen seconds. Chainlink ETH-USD, refreshed at least every two minutes. Sigma-base is an exponentially weighted realized volatility of those prints; sigma-mark multiplies it by a vol risk premium of ${decimalWords(take.vrp)}.`,
      actions: [
        { kind: "goto", path: "", prep: true },
        { kind: "hover", selector: ".sync-status", ms: 1200 },
        { kind: "hover", selector: 'article[aria-label="ETH / USD"]', at: "Chainlink ETH-USD", ms: 2200 },
        { kind: "hover", selector: 'article[aria-label="σ base"]', at: "Sigma-base is", ms: 2200 },
        { kind: "hover", selector: 'article[aria-label="σ mark (0)"]', at: "sigma-mark multiplies", ms: 1800 },
      ],
    },
    {
      id: "04-boards",
      minVisualMs: 22000,
      narrationDelayMs: 0,
      narration: `${capitalized(words(live))} live series, three pools, side by side. The parity column calls both math contracts with identical inputs at the same block and compares the full tuple: ${words(live)} ticks. The delta between pool quotes is inventory, not math. The gas line estimates the same buy on pools A and B; the Stylus program is cached.`,
      actions: [
        { kind: "goto", path: "#/boards", prep: true },
        { kind: "waitText", selector: "tr.series-row [data-parity]", text: "✓", prep: true },
        { kind: "hover", selector: 'th:text-is("Buy C")', at: "three pools", ms: 1200 },
        { kind: "hover", selector: 'th:text-is("Parity")', at: "The parity column", ms: 700 },
        { kind: "sweep", selector: 'tr.series-row [data-parity="ok"]', at: "calls both math contracts", ms: 3200 },
        { kind: "hover", selector: 'tr.series-row [data-delta]:not([data-delta="="])', at: "The delta between", ms: 2000 },
        { kind: "scrollTo", selector: ".gas-line", at: "The gas line", ms: 900 },
        { kind: "hover", selector: ".gas-line", ms: 2500 },
      ],
    },
    {
      id: "05-trade",
      minVisualMs: 24800,
      narrationDelayMs: 0,
      narration: "Trading from a browser wallet. Mock USDG from the faucet, approve once, then buy a tenth of a call at twenty-six hundred on the Stylus pool. The premium in the preview was just computed by the WASM program from sigma-mark; every write is simulated first, so a revert is decoded before the wallet signs. Confirm.",
      actions: [
        { kind: "goto", path: tradePath, prep: true },
        { kind: "connect" },
        { kind: "hover", selector: 'button:has-text("Faucet 100,000 USDG")', at: "Mock USDG from the faucet", ms: 1500 },
        { kind: "hover", selector: '.wallet-summary dd:text-is("approved")', at: "approve once", ms: 1200 },
        { kind: "fill", selector: "#buy-size", value: t.size, at: "then buy a tenth", ms: 600 },
        { kind: "waitText", selector: "#buy-preview", text: "executed ≈" },
        { kind: "hover", selector: "#buy-preview", at: "The premium in the preview", ms: 2000 },
        { kind: "hover", selector: primary("Buy"), at: "every write is simulated", ms: 800 },
        { kind: "send", button: primary("Buy"), at: "Confirm" },
      ],
    },
    {
      id: "06-confirmed",
      minVisualMs: 17000,
      narrationDelayMs: 0,
      narration: "The transaction is on Arbiscan, the position appears, and the close quote sits below the buy quote on the same state — no free round-trips. Puts are reserved at the strike, calls are capped at the strike: the pool can never owe more than it holds.",
      actions: [
        { kind: "goto", path: tradePath, prep: true },
        { kind: "connect", prep: true },
        { kind: "waitText", selector: ".wallet-summary", text: t.label, prep: true },
        { kind: "explorerOverlay", ms: 0 },
        { kind: "clearOverlay", at: "the position appears" },
        { kind: "hover", selector: `.wallet-summary dd:has-text("${t.label}")`, ms: 900 },
        { kind: "select", selector: "#close-series", labelPrefix: t.label, at: "and the close quote", ms: 300 },
        { kind: "fill", selector: "#close-size", value: t.closeSize, ms: 400 },
        { kind: "waitText", selector: "#close-preview", text: "executed ≈" },
        { kind: "hover", selector: "#close-preview", ms: 1500 },
        { kind: "goto", path: "", at: "Puts are reserved" },
        { kind: "hover", selector: 'article[data-pool="B"] .pool-stats', ms: 2500 },
      ],
    },
  ];
  if (s.state === "settled") {
    const who = s.settler === "keeper" ? "The keeper — a fifteen-minute GitHub Actions cron — settled" : "A permissionless call settled";
    out.push({
      id: "07-settlement",
      minVisualMs: 19000,
      narrationDelayMs: 0,
      narration: `Friday, eight UTC: the first board expired on the real Chainlink grid. ${who} ${s.settledText} dollars; settle is permissionless. On pool B the settlement released ${s.released} USDG of reserve and escrowed ${s.escrowed} — exactly what the winning positions can claim.`,
      actions: [
        { kind: "terminal", title: s.terminal.title, source: "settlement", ms: 5000 },
        { kind: "goto", path: "#/boards", at: "settle is permissionless" },
        { kind: "hover", selector: `article.board-panel[aria-label="Board #${s.boardId}"] .status-pill`, ms: 2500 },
        { kind: "goto", path: "", at: "On pool B" },
        { kind: "hover", selector: 'article[data-pool="B"] .pool-stats', ms: 2500 },
      ],
    });
    if (s.claim) {
      const c = s.claim;
      out.push({
        id: "08-claim",
        minVisualMs: 9000,
        narrationDelayMs: 0,
        narration: `The straddle bought on ${s.straddleDay} claims ${c.payout} USDG from the browser. Every hash is in the demo log.`,
        actions: [
          { kind: "goto", path: `#/trade?pool=B&series=${c.series}` },
          { kind: "connect" },
          { kind: "select", selector: "#claim-series", labelPrefix: c.label, ms: 300 },
          { kind: "waitText", selector: "#claim-preview", text: "units ×" },
          { kind: "hover", selector: "#claim-preview", ms: 1200 },
          { kind: "send", button: primary("Claim") },
          { kind: "goto", path: "#/activity", at: "Every hash" },
          { kind: "hover", selector: 'tbody tr:has-text("Claimed")', ms: 1500 },
        ],
      });
    }
  } else {
    out.push({
      id: "07-settlement",
      minVisualMs: 12000,
      narrationDelayMs: 0,
      narration: "Friday, eight UTC: the first board expires on the real Chainlink grid, and the keeper — a fifteen-minute GitHub Actions cron — settles it; settle is permissionless, the bounty two USDG. This part of the video is filmed after that settlement.",
      actions: [{ kind: "card", name: "settlement-pending", ms: 1000 }],
    });
  }
  out.push(
    {
      id: "09-honest-gas",
      minVisualMs: 17000,
      narrationDelayMs: 0,
      narration: `The honest part. Both implementations are byte-identical on ${words(take.gasCheck.ok)} on-chain checks. Stylus wins where it loops: a twenty-iteration implied-vol solve costs two hundred twenty-three thousand gas against six hundred seventeen thousand in Solidity; marking thirty-two series, four hundred twenty-seven thousand against one point two four million.`,
      actions: [
        { kind: "terminal", title: take.gasCheck.command, source: "gasCheck", ms: 1000 },
        { kind: "card", name: "gas", at: "Stylus wins where it loops", ms: 1000 },
      ],
    },
    {
      id: "10-end",
      minVisualMs: 17000,
      narrationDelayMs: 0,
      narration: "Small single calls are cheaper in Solidity, and whole pool transactions differ by a few percent — five and eight percent on buy and close, a fraction of a percent the other way on deposit — because storage dominates. Not ten times. We measured it and shipped the benchmark.",
      actions: [
        { kind: "card", name: "gas-tx", ms: 1000 },
        { kind: "card", name: "end", at: "Not ten times", ms: 1000 },
      ],
    },
  );
  return out;
}

export function narrationFor(take: Take) {
  return beats(take).map((b) => ({ id: b.id, text: b.narration, delayMs: b.narrationDelayMs, minVisualMs: b.minVisualMs }));
}

export function readTake(): Take {
  return JSON.parse(fs.readFileSync(path.join(OUT_DIR, "take.json"), "utf8")) as Take;
}

const isMain = process.argv[1] && new URL(import.meta.url).pathname === path.resolve(process.argv[1]);
if (isMain && process.argv.includes("--narration")) process.stdout.write(JSON.stringify(narrationFor(readTake()), null, 2) + "\n");
