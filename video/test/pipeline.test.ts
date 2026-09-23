// node --experimental-strip-types --test video/test/*.test.ts — the pieces of the pipeline that decide what is signed and when things
// happen on camera: the filming-wallet allowlist, the phrase clock, the series order and the narration's number words.
import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeFunctionData, parseUnits } from "viem";
import { ALLOWED_SELECTORS, ALL_SERIES, decimalWords, phraseStart, poolAbi, poolAddress, seriesLabel, vet, words } from "../lib.ts";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const TAKE = { trade: { pool: "B" as const, size: "0.1" } };
const buyData = (size: string) => encodeFunctionData({ abi: poolAbi, functionName: "buy", args: [ALL_SERIES[8]!.ids.B, parseUnits(size, 18), 21_779_589n] });

test("allowlist: selectors are the real buy/claim selectors (as `cast sig` prints them)", () => {
  assert.deepEqual(Object.keys(ALLOWED_SELECTORS).sort(), ["0x40993b26", "0xc3490263"]);
});

test("vet() lets a buy of at most the take's size on pool B through, and a claim", () => {
  assert.match(vet({ from: ACCOUNT, to: poolAddress("B"), data: buyData("0.1") }, TAKE, ACCOUNT), /^buy\(series \d+…, size 0\.1, max 21\.779589 USDG\)$/);
  const claim = encodeFunctionData({ abi: poolAbi, functionName: "claim", args: [ALL_SERIES[2]!.ids.B, parseUnits("0.1", 18)] });
  assert.match(vet({ to: poolAddress("B"), data: claim }, TAKE, ACCOUNT), /^claim\(/);
});

test("vet() refuses another pool, another sender, a bigger buy and any other call", () => {
  assert.throws(() => vet({ to: poolAddress("A"), data: buyData("0.1") }, TAKE, ACCOUNT), /not pool B/);
  assert.throws(() => vet({ from: "0x2222222222222222222222222222222222222222", to: poolAddress("B"), data: buyData("0.1") }, TAKE, ACCOUNT), /filming account/);
  assert.throws(() => vet({ to: poolAddress("B"), data: buyData("0.2") }, TAKE, ACCOUNT), /above the take's 0\.1/);
  const close = encodeFunctionData({ abi: poolAbi, functionName: "close", args: [ALL_SERIES[8]!.ids.B, parseUnits("0.1", 18), 0n] });
  assert.throws(() => vet({ to: poolAddress("B"), data: close }, TAKE, ACCOUNT), /is not buy\/claim/);
  const redeem = encodeFunctionData({ abi: poolAbi, functionName: "redeem", args: [1n, ACCOUNT, ACCOUNT] });
  assert.throws(() => vet({ to: poolAddress("B"), data: redeem }, TAKE, ACCOUNT), /is not buy\/claim/);
});

test("phraseStart() finds phrases across TTS words that hold several tokens", () => {
  const w = [{ start: 0.1, text: "Chainlink" }, { start: 0.6, text: "ETH-USD," }, { start: 1.2, text: "refreshed" }, { start: 1.9, text: "Sigma-base" }, { start: 2.4, text: "is" }];
  assert.equal(phraseStart(w, "Chainlink ETH-USD"), 0.1);
  assert.equal(phraseStart(w, "Sigma-base is"), 1.9);
  assert.equal(phraseStart(w, "base is"), 1.9);
  assert.throws(() => phraseStart(w, "sigma-mark"), /not found/);
});

test("series order and labels follow the dashboard (board, strike, call before put)", () => {
  assert.equal(seriesLabel(ALL_SERIES[0]!), "C 2400 #0 (25 Sep)");
  assert.equal(seriesLabel(ALL_SERIES[1]!), "P 2400 #0 (25 Sep)");
  assert.equal(seriesLabel(ALL_SERIES[8]!), "C 2600 #1 (2 Oct)");
  assert.ok(ALL_SERIES.every((s, i) => s.index === i));
});

test("number words used in the narration", () => {
  assert.equal(words(12), "twelve");
  assert.equal(words(20), "twenty");
  assert.equal(words(24), "twenty-four");
  assert.equal(decimalWords("1.15"), "one point one five");
  assert.throws(() => words(1000));
});
