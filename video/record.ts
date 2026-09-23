/**
 * Drives the public dashboard through the beats and records one clip per beat. Waits are driven by the narration: an action with `at`
 * does not start before the TTS reaches that phrase, and every beat is held to its segment length so build.py never freezes a frame.
 *
 * The browser gets an EIP-1193 provider whose signer lives in this Node process: `eth_sendTransaction` crosses a Playwright binding,
 * is checked against an allowlist (pool B, `buy` of at most the take's size, or `claim`) and is signed with SEPOLIA_PRIVATE_KEY here —
 * the key never reaches the page. Reads go to the public RPC, exactly like the dashboard's own.
 *
 *   --probe        run every action with no waits, no video and no transaction; list selectors that fail
 *   --only=<id>[,<id>…]  record these beats and merge them into clips/index.json (06-confirmed reads the buy hash from out/tx.json)
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { type Hex } from "viem";
import { MANIFEST, OUT_DIR, ROOT, VIDEO_DIR, client, filmingAccount, phraseStart, vet, walletFor } from "./lib.ts";
import { beats, readTake, type Action, type Take } from "./script.ts";

const PROBE = process.argv.includes("--probe");
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const CLIPS = path.join(OUT_DIR, "clips");
const RAW = path.join(OUT_DIR, "raw");
const TX_FILE = path.join(OUT_DIR, "tx.json");
const NAV_TIMEOUT = 30_000;
const CHAIN_ID_HEX = `0x${Number(MANIFEST.chainId).toString(16)}`;

type AudioRow = { id: string; words: string; delayMs: number; segmentS: number };
type Word = { start: number; end: number; text: string };
type RouteMark = { atS: number; route: string };

// Fonts: the dashboard's self-hosted files, inlined so cards and terminal render identically on about:blank.
const FONT_DIR = path.join(ROOT, "equinox-dashboard", "client", "public", "fonts");
const FONTS = [
  ["Instrument Sans", "instrument-sans-latin.woff2", "400 700"],
  ["Martian Mono", "martian-mono-latin.woff2", "100 800"],
].map(([family, file, weight]) => `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${fs.readFileSync(path.join(FONT_DIR, file!)).toString("base64")}) format("woff2");}`).join("\n");
const withFonts = (file: string) => fs.readFileSync(path.join(VIDEO_DIR, file), "utf8").replace("/*FONTS*/", FONTS);
const CARDS_HTML = withFonts("cards.html");
const TERMINAL_HTML = withFonts("terminal.html");

// A visible pointer in the dashboard's gold: headless Chromium draws none, and a hover nobody can see is not a demonstration.
const CURSOR = `
  (() => {
    const make = () => {
      if (document.getElementById("__cursor") || !document.documentElement) return;
      const c = document.createElement("div");
      c.id = "__cursor";
      c.style.cssText = "position:fixed;left:-100px;top:-100px;width:22px;height:22px;border:3px solid #f2c94c;border-radius:50%;box-shadow:0 0 0 2px rgba(11,18,32,.85);pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%);transition:transform .12s ease;";
      document.documentElement.appendChild(c);
      document.addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
      document.addEventListener("mousedown", () => { c.style.transform = "translate(-50%,-50%) scale(.6)"; }, true);
      document.addEventListener("mouseup", () => { c.style.transform = "translate(-50%,-50%)"; }, true);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", make); else make();
  })();`;

// The filming wallet as seen by the page: accounts and chain answered locally, reads forwarded to the public RPC, sends handed to Node.
const PROVIDER = ({ account, chainId, rpc }: { account: string; chainId: string; rpc: string }) => {
  const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
  let id = 0;
  (window as unknown as { ethereum: unknown }).ethereum = {
    isEquinoxFilmingWallet: true,
    on(ev: string, cb: (...a: unknown[]) => void) { (listeners[ev] ??= []).push(cb); },
    removeListener(ev: string, cb: (...a: unknown[]) => void) { listeners[ev] = (listeners[ev] ?? []).filter((f) => f !== cb); },
    async request({ method, params }: { method: string; params?: unknown[] }) {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
      if (method === "eth_chainId") return chainId;
      if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
      if (method === "eth_sendTransaction") return (window as unknown as { __eqxSend: (tx: unknown) => Promise<string> }).__eqxSend(params?.[0]);
      if (/sign/i.test(method)) throw Object.assign(new Error("signing is not part of this demo"), { code: 4200 });
      const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params ?? [] }) });
      const j = await r.json();
      if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code, data: j.error.data });
      return j.result;
    },
  };
};

async function captureExplorer(browser: Browser, take: Take, hash: string) {
  const url = `${take.explorer}/tx/${hash}`;
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36" });
  const page = await ctx.newPage();
  const shot = path.join(OUT_DIR, "explorer.png");
  try {
    // A fresh transaction can take a few seconds to be indexed: reload until the page shows the hash and a status.
    for (let i = 0; i < 8; i++) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      const ok = await page.getByText("Success", { exact: true }).first().waitFor({ timeout: 12_000 }).then(() => true).catch(() => false);
      if (ok) break;
      if (i === 7) throw new Error("Arbiscan never showed the transaction as Success");
      await page.waitForTimeout(5000);
    }
    // Site chrome that is not the transaction: the cookie notice and the announcement bar (removed from the DOM, the page is untouched otherwise).
    await page.evaluate(() => {
      const fixedAncestor = (el: HTMLElement | null) => { for (let e = el; e && e !== document.body; e = e.parentElement) { const p = getComputedStyle(e).position; if (p === "fixed" || p === "sticky") return e; } return null; };
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
        const t = el.innerText ?? "";
        if (/uses cookies/i.test(t) && el.children.length < 6) fixedAncestor(el)?.remove();
        if (/trading competition/i.test(t) && el.offsetHeight < 80) el.remove();
      }
    });
    await page.waitForTimeout(800);
    await page.screenshot({ path: shot });
    return { url, shot };
  } finally {
    await ctx.close();
  }
}

/** Wait for the page to settle, then refuse the states that must never be filmed. */
async function settled(page: Page) {
  await page.waitForLoadState("load", { timeout: NAV_TIMEOUT }).catch(() => {});
  await page.waitForFunction(() => document.querySelector(".sync-status b")?.textContent === "live", null, { timeout: NAV_TIMEOUT });
  await page.waitForTimeout(500);
  const bad = await page.evaluate(() => {
    const banner = document.querySelector(".notice-banner")?.textContent ?? "";
    if (/RPC|stale/i.test(banner)) return banner.trim().slice(0, 80);
    if (/404|not found/i.test(document.title)) return "404";
    return null;
  });
  if (bad) throw new Error(`not filmable: page shows "${bad}" at ${page.url()}`);
}

async function main() {
  const take = readTake();
  const account = filmingAccount();
  const audio: AudioRow[] = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "audio", "index.json"), "utf8"));
  const wordsOf = (id: string): Word[] => {
    const row = audio.find((a) => a.id === id);
    if (!row) throw new Error(`no audio for ${id}; run tts.py first`);
    return JSON.parse(fs.readFileSync(path.join(OUT_DIR, "audio", row.words), "utf8"));
  };
  const sends = beats(take).some((b) => b.actions.some((a) => a.kind === "send"));
  if (sends && !PROBE && !account) throw new Error("SEPOLIA_PRIVATE_KEY is not set — the trade beats send real transactions from the filming account");
  if (account && take.account && account.address.toLowerCase() !== take.account.toLowerCase()) throw new Error("the key in this shell is not the take's filming account");
  const wallet = account ? walletFor(account) : null;
  fs.mkdirSync(CLIPS, { recursive: true });
  fs.mkdirSync(RAW, { recursive: true });

  const browser = await chromium.launch();
  const index: { id: string; clip: string; headS: number; recordedS: number; routes: RouteMark[] }[] = [];
  const missing: string[] = [];
  let lastTx: string | null = fs.existsSync(TX_FILE) ? JSON.parse(fs.readFileSync(TX_FILE, "utf8")).hash : null;

  for (const beat of beats(take)) {
    if (ONLY && !ONLY.includes(beat.id)) continue;
    const row = audio.find((a) => a.id === beat.id)!;
    const words = wordsOf(beat.id);
    const delayS = row.delayMs / 1000;

    // Off-camera: the explorer screenshot of the transaction the previous beat sent.
    const explorerShot = !PROBE && beat.actions.some((a) => a.kind === "explorer" || a.kind === "explorerOverlay")
      ? (lastTx ? await captureExplorer(browser, take, lastTx) : (() => { throw new Error(`${beat.id}: no transaction hash to show on the explorer (record 05 first)`); })())
      : null;

    const context: BrowserContext = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      colorScheme: "dark",
      reducedMotion: "no-preference",
      ...(PROBE ? {} : { recordVideo: { dir: RAW, size: { width: 1920, height: 1080 } } }),
    });
    await context.addInitScript(CURSOR);
    if (account) await context.addInitScript(PROVIDER, { account: account.address, chainId: CHAIN_ID_HEX, rpc: MANIFEST.rpc });
    await context.exposeBinding("__eqxSend", async (_src, tx: { from?: string; to?: string; data?: Hex; gas?: Hex }) => {
      if (PROBE || !wallet) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
      const what = vet(tx, take, account!.address);
      const hash = await wallet.sendTransaction({ to: tx.to as Hex, data: tx.data, gas: tx.gas ? BigInt(tx.gas) : undefined });
      lastTx = hash;
      fs.writeFileSync(TX_FILE, JSON.stringify({ hash, what, beat: beat.id, at: new Date().toISOString() }, null, 1));
      console.log(`  sent ${what} → ${take.explorer}/tx/${hash}`);
      return hash;
    });
    const page = await context.newPage();
    const tRec = Date.now();   // the video starts with the page; everything before t0 is lead-in that build.py cuts
    let t0 = tRec;
    const elapsedS = () => (Date.now() - t0) / 1000;
    const routes: RouteMark[] = [];
    const setRoute = (route: string) => routes.push({ atS: Number(elapsedS().toFixed(2)), route });
    let doc: "blank" | "cards" | "terminal" | "app" | "image" = "blank";
    let appRoute = "";
    const wait = (ms: number) => (PROBE ? Promise.resolve() : page.waitForTimeout(ms));
    const loc = (sel: string) => page.locator(sel).first();
    const ready = async (sel: string) => {
      try { await loc(sel).waitFor({ timeout: 20_000 }); } catch {
        console.warn(`  ${sel} not visible after 20 s — reloading once`);
        await page.reload({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
        await settled(page);
        await loc(sel).waitFor({ timeout: 20_000 });
      }
    };
    const showCard = async (name: string, data: Record<string, unknown> = {}) => {
      if (doc !== "cards") { await page.setContent(CARDS_HTML); doc = "cards"; }
      await page.evaluate(({ name, data }) => (window as unknown as { render: (o: unknown) => Promise<void> }).render({ card: name, data }), { name, data });
    };

    console.log(`\n▶ ${beat.id} (${PROBE ? "probe" : `hold ${row.segmentS}s`})`);
    const run = async (a: Action) => {
        switch (a.kind) {
          case "card": {
            setRoute("");
            const data = a.name === "settlement-pending" && take.settlement.state === "pending"
              ? { expiryUtc: new Date(take.settlement.expiryUtc).toUTCString().replace(":00 GMT", " UTC").replace(/^(\w+), /, "$1 "), boardId: take.settlement.boardId } : {};
            await showCard(a.name, data);
            await wait(a.ms);
            break;
          }
          case "terminal": {
            setRoute("");
            const src = a.source === "gasCheck" ? { command: take.gasCheck.command, lines: take.gasCheck.lines, columns: true }
              : take.settlement.state === "settled" ? { command: "", lines: take.settlement.terminal.lines, columns: false } : null;
            if (!src) throw new Error("no settlement terminal in a pending take");
            await page.setContent(TERMINAL_HTML); doc = "terminal";
            await page.evaluate((o) => (window as unknown as { render: (o: unknown) => Promise<void> }).render(o), { title: a.title, ...src, intervalMs: PROBE ? 0 : 110 });
            await wait(a.ms);
            break;
          }
          case "explorer": {
            if (PROBE) break;
            const png = fs.readFileSync(explorerShot!.shot).toString("base64");
            await page.setContent(`<html style="margin:0;background:#fff"><body style="margin:0"><img src="data:image/png;base64,${png}" style="display:block;width:1920px;height:1080px"></body></html>`);
            doc = "image";
            const u = new URL(explorerShot!.url);
            setRoute(u.host + u.pathname);
            await wait(a.ms);
            break;
          }
          case "explorerOverlay": {
            if (PROBE) break;
            const png = fs.readFileSync(explorerShot!.shot).toString("base64");
            await page.evaluate((src) => {
              document.getElementById("__overlay")?.remove();
              const cursor = document.getElementById("__cursor");
              if (cursor) cursor.style.display = "none";
              const img = document.createElement("img");
              img.id = "__overlay";
              img.src = src;
              img.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483646;object-fit:cover;background:#fff;";
              document.documentElement.appendChild(img);
            }, `data:image/png;base64,${png}`);
            const u = new URL(explorerShot!.url);
            setRoute(u.host + u.pathname);
            await wait(a.ms);
            break;
          }
          case "clearOverlay":
            await page.evaluate(() => {
              document.getElementById("__overlay")?.remove();
              const cursor = document.getElementById("__cursor");
              if (cursor) cursor.style.display = "";
            });
            setRoute(appRoute);
            break;
          case "goto": {
            await page.goto(take.base + a.path, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
            doc = "app";
            await settled(page);
            appRoute = "/" + a.path.replace(/\?.*$/, "");
            setRoute(appRoute);
            await page.mouse.move(960, 540);
            break;
          }
          case "connect": {
            const btn = page.locator('.trade-status button:has-text("Connect wallet"), .connect-button:has-text("Connect")').first();
            await btn.waitFor({ timeout: 15_000 });
            await btn.hover({ steps: PROBE ? 1 : 15 });
            await wait(250);
            await btn.click();
            await page.locator(".wallet-summary").first().waitFor({ timeout: 30_000 });
            await wait(600);
            break;
          }
          case "wait":
            await wait(a.ms);
            break;
          case "hover":
            await ready(a.selector);
            await loc(a.selector).scrollIntoViewIfNeeded();
            await loc(a.selector).hover({ steps: PROBE ? 1 : 25 });
            await wait(a.ms ?? 1500);
            break;
          case "sweep": {
            await ready(a.selector);
            const n = await page.locator(a.selector).count();
            for (let i = 0; i < n; i++) {
              await page.locator(a.selector).nth(i).scrollIntoViewIfNeeded();
              await page.locator(a.selector).nth(i).hover({ steps: PROBE ? 1 : 6 });
              await wait(Math.max(60, a.ms / Math.max(1, n)));
            }
            break;
          }
          case "scrollTo":
            await ready(a.selector);
            await loc(a.selector).evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
            await wait(a.ms ?? 1200);
            break;
          case "fill": {
            await ready(a.selector);
            await loc(a.selector).click();
            await loc(a.selector).fill("");
            await loc(a.selector).pressSequentially(a.value, { delay: PROBE ? 0 : 140 });
            await wait(a.ms ?? 500);
            break;
          }
          case "select": {
            await ready(a.selector);
            const label = await page.locator(`${a.selector} option`).evaluateAll((opts, p) => (opts as HTMLOptionElement[]).map((o) => o.textContent ?? "").find((t) => t.startsWith(p as string)) ?? null, a.labelPrefix);
            if (!label) throw new Error(`no option starting with "${a.labelPrefix}" in ${a.selector}`);
            await loc(a.selector).hover({ steps: PROBE ? 1 : 15 });
            await loc(a.selector).selectOption({ label });
            await wait(a.ms ?? 400);
            break;
          }
          case "waitText":
            await page.waitForFunction(({ sel, text }) => (document.querySelector(sel)?.textContent ?? "").includes(text), { sel: a.selector, text: a.text }, { timeout: 45_000 });
            await wait(a.ms ?? 0);
            break;
          case "send": {
            await ready(a.button);
            if (PROBE) { if (!(await loc(a.button).isEnabled())) throw new Error("button disabled"); break; }
            const before = await page.locator(".txlog__line").count();
            await loc(a.button).hover({ steps: 10 });
            await loc(a.button).click();
            await page.waitForFunction((n) => {
              const lines = Array.from(document.querySelectorAll(".txlog__line"));
              return lines.length > n && lines[0]?.getAttribute("data-state") !== "pending";
            }, before, { timeout: 120_000 });
            const state = await page.locator(".txlog__line").first().getAttribute("data-state");
            const text = (await page.locator(".txlog__line").first().textContent())?.replace(/\s+/g, " ").trim();
            if (state !== "ok") throw new Error(`transaction failed on camera: ${text}`);
            console.log(`  ✓ ${text}`);
            await page.locator(".txlog__line").first().hover({ steps: 12 });
            await wait(a.ms ?? 1200);
            break;
          }
        }
    };
    const attempt = async (a: Action): Promise<void> => {
      try { await run(a); } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (PROBE && ("selector" in a || "button" in a)) { missing.push(`${beat.id}: ${a.kind} ${"selector" in a ? a.selector : a.button} — ${msg.split("\n")[0]}`); return; }
        await context.close();
        await browser.close();
        throw new Error(`${beat.id} / ${a.kind}: ${msg}`);
      }
    };
    // Lead-in (off the final cut): page loads and snapshot reads. Then t0: the narration clock starts.
    for (const a of beat.actions.filter((x) => x.prep)) await attempt(a);
    t0 = Date.now();
    const headS = Number(((t0 - tRec) / 1000).toFixed(3));
    for (const r of routes) r.atS = 0;
    for (const a of beat.actions.filter((x) => !x.prep)) {
      if (a.at && !PROBE) {
        const dt = delayS + phraseStart(words, a.at) - elapsedS();
        if (dt > 0) await page.waitForTimeout(dt * 1000);
        else console.warn(`  ${a.kind}: "${a.at}" already passed by ${(-dt).toFixed(1)}s — earlier actions ran long`);
      }
      await attempt(a);
    }
    void doc;

    if (PROBE) { await context.close(); continue; }
    const holdS = row.segmentS + 0.3 - elapsedS();
    if (holdS > 0) await page.waitForTimeout(holdS * 1000);
    else console.warn(`  actions overran the segment by ${(-holdS).toFixed(1)}s; build.py trims the tail`);
    const recordedS = elapsedS();
    const video = page.video();
    await context.close();
    const raw = await video!.path();
    const clip = `${beat.id}.webm`;
    fs.renameSync(raw, path.join(CLIPS, clip));
    index.push({ id: beat.id, clip, headS, recordedS: Number(recordedS.toFixed(2)), routes });
    console.log(`  recorded ${recordedS.toFixed(1)}s after a ${headS.toFixed(1)}s lead-in → ${clip}`);
  }
  await browser.close();

  if (PROBE) {
    if (missing.length) { console.error("\nunresolved selectors:\n  " + missing.join("\n  ")); process.exit(1); }
    console.log("\nprobe ok: every selector resolved");
    return;
  }
  const indexPath = path.join(CLIPS, "index.json");
  const prev: typeof index = ONLY && fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, "utf8")) : [];
  const merged = [...prev.filter((p) => !index.some((n) => n.id === p.id)), ...index].sort((a, b) => a.id.localeCompare(b.id));
  fs.writeFileSync(indexPath, JSON.stringify(merged, null, 1));
  console.log("\nwrote", indexPath);
  void client;
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});
