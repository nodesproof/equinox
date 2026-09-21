# Equinox dashboard (React)

The React frontend for the Equinox option pools on Arbitrum Sepolia — a static Vite 7 + React 19 + Tailwind 4 site on top of the **existing data layer in `../web/src`** (viem 2, block-pinned snapshots, event scan, trade builders, wallet wrapper). No backend, no telemetry, no third-party scripts: the only network calls are the public RPC and, later, the injected wallet. Contract: [`docs/FRONTEND_BRIEF.md`](../docs/FRONTEND_BRIEF.md); design: [`docs/superpowers/specs/2026-09-20-equinox-plan5-react-frontend-design.md`](../docs/superpowers/specs/2026-09-20-equinox-plan5-react-frontend-design.md).

State of this folder: the shell (sidebar, topbar, testnet strip, RPC banner, footer), the Overview and the Boards page are **live** on `ChainProvider` (one block-pinned snapshot per 15-s poll, parity, gas, events); loading, first-load error, stale and live states are explicit (`—` + reason, never a fabricated number). Trade, Portfolio, Activity and Contracts are placeholders until Tasks 5–6.

Routes keep any query **inside the hash** (`#/trade?pool=B&series=3`, `#/boards?board=1`): `client/src/lib/route.ts` builds those links (`tradeHref`, `boardsHref`), parses them (`hashQuery`, `useHashQuery`, validators against the manifest) and provides the router hook `useHashRoute` (path without `?…`). Such links are plain `<a href>`; wouter's `navigate()` would move the query into `location.search`, where the data layer reads `?rpc=`/`?poll=`.

## Commands

```sh
cd equinox-dashboard
(cd ../web && npm ci)   # the data layer resolves viem from web/node_modules
npm ci
npm run dev             # http://localhost:5174/equinox/  (hash routes: /#/, /#/boards, /#/trade, /#/portfolio, /#/activity, /#/contracts)
npm run check           # tsc --noEmit — type-checks client/src, test/ and ../web/src together
npm test                # vitest (jsdom, @testing-library/react)
npm run build           # vite build → dist/, then scripts/size.mjs (fails above 250 KB gzip of JS)
npm run preview         # serves dist/ at http://localhost:4174/equinox/
npm run seed            # ../web `npm run seed` → client/public/events-seed.json (git-ignored)
npm run size            # re-run the bundle budget check on an existing dist/
```

## Aliases (single source of chain access)

| Alias | Target | Why |
|---|---|---|
| `@` | `client/src` | app code |
| `@chain` | `../web/src` | `chain/*`, `deployment.ts`, `abi/*`, `ui/format.ts`, `ui/poll.ts` — imported, never copied |
| `@deployment` | `../deployments/arbitrum-sepolia.json` | the manifest: pools, assets, engine, boards, series ids |

`vite.config.ts` and `vitest.config.ts` define the aliases; `tsconfig.json` mirrors them in `paths` and includes `../web/src` (minus `main.ts` and `panels/`, the classic UI) so the data layer is type-checked with the app. `__COMMIT__` / `__BUILD_TIME__` are `define`d at build time (their ambient declarations live in `web/src/vite-env.d.ts`; `client/src/vite-env.d.ts` only references `vite/client`). `resolve.dedupe` keeps one copy of `viem`, `react` and `react-dom` at runtime.

Rules that follow: no chain logic in components (hooks over `@chain` only), no hard-coded addresses, counts or parameters (grep-checked at acceptance), copy per brief §7 (testnet always visible, mock USDG on A/B vs Paxos USDG on C, indicative vs executed, K5 = math parity not quote parity).

## Fallback rule

GitHub Pages keeps deploying the classic UI in `web/` until this app passes **every** item of brief §9 against the live chain (recorded in `ACCEPTANCE.md`); the switch is one commit in `.github/workflows/pages.yml`. If the app has not passed by 28 Sep 2026 the submission uses the classic UI. CI job `app` in `.github/workflows/ci.yml` runs `check`, `test` and `build` (with the bundle budget) on every push.

## Layout

```
client/index.html            fonts (Instrument Sans, Martian Mono), favicon, no analytics
client/src/main.tsx          StrictMode → App
client/src/App.tsx           ThemeProvider (dark) → TooltipProvider → Toaster → ChainProvider → ClockProvider → Router(useHashRoute) → Layout → routes
client/src/chain/            ChainProvider + useChain, useSnapshot/useEvents/useWallet/useTrade, selectors (pure + hooks), clock (1-s ClockProvider/useNow, separate from the chain context)
client/src/components/       Layout (live shell), Banner (RpcBanner), MetricCard, PoolCard, SigmaChart (JSX port of web/src/ui/svg.ts — no recharts), ParityPanel, EventsPreview, BoardSummary, BoardTable (one board panel: full series table, expand, Trade link), SeriesDetail (Greeks per pool + K5 prices), primitives (AppMark, SectionHeading, EmptyValue, SkeletonLine, StatusPill, MiniSparkline), ErrorBoundary, ui/* (shadcn: button, badge, input, tooltip, sonner, select, tabs, dialog, skeleton, table)
client/src/lib/              sync (connecting|live|stale|failed + banner model), format (grouping, bps → %, exact WAD, build stamp), boards (cell semantics of web/src/panels/board.ts, filters, footnote), route (query-in-hash links, parsers, useHashRoute/useHashQuery)
client/src/pages/            Overview (live), Boards (live), ComingSoon (placeholder for the routes not built yet)
client/src/index.css         Tailwind 4 + the "dark observatory" design system (custom classes)
test/                        vitest + jsdom (test/setup.ts loads jest-dom matchers); fixtures/ (snapshot + events from Appendix C), render.tsx (ChainContext + frozen clock), chain/, components/, lib/, pages/
scripts/size.mjs, seed.sh    bundle budget, event seed copy
```

## History

- **20 Sep 2026 — scaffold.** Generated by Manus from `docs/FRONTEND_BRIEF.md` (React 19, Vite 7, Tailwind 4, shadcn/Radix, pnpm; 87 files). Its own visual verification notes: desktop overview at 1280 px renders the dark observatory direction consistently (fixed sidebar, topbar, testnet strip, hero, metric cards, chart panel, pool cards, board tables, parity panel, activity panel, footer); mobile overview at 375 px collapses the sidebar behind a hamburger, the connect button becomes icon-only, the top strip wraps, metric cards go two-column without horizontal page scroll; numeric on-chain values were intentionally `—`/empty because no RPC adapter existed, surfaced by a visible notice; `pnpm check` and `pnpm build` passed with a Vite size warning (660.10 kB raw / 174.98 kB gzip JS).
- **21 Sep 2026 — Plan 5 Task 1.** Manus runtime, Express server, OAuth constants, analytics, patches and 43 unused shadcn components removed; pnpm → npm; `@chain`/`@deployment` aliases; wouter hash router; `Home.tsx` split into `Layout`, `primitives` and `Overview` with every hard-coded value replaced by `—` + reason; vitest smoke test; CI job `app`. Bundle after the split: 341 KB raw / 108 KB gzip JS (budget 250 KB).
- **21 Sep 2026 — Plan 5 Task 2.** `ChainProvider` (port of `web/src/main.ts` + wallet part of `panels/trade.ts`), thin hooks, selectors, `useTrade`, fixtures; `web/src/chain/snapshot.ts` extended with `cfg()` and the full `params()`.
- **21 Sep 2026 — Plan 5 Task 3.** Layout and Overview bound to the provider: sync status (connecting/live/stale/RPC error) with a separate 1-s `ClockProvider`, RPC banner (first-load error with retry; "RPC unreachable — showing data fetched HH:MM:SS UTC" with the data kept), pool cards from `cfg()` bps, σ_base chart from `Observed` events (JSX, recharts dropped), parity n ✓ / n live + gas line, ATM ± 2 board summary, 5-event preview. 77 tests; bundle 680 KB raw / 205 KB gzip JS.
- **21 Sep 2026 — Plan 5 Task 4.** Boards page: one panel per manifest board with the full series table (Buy per pool or the human revert text, Δ A|B, Close, K5 parity, OI, σ_buy), row states (open / blackout / expired — awaiting settle / settled @ payout), ATM highlight, expandable Greeks per pool with the Solidity/Stylus prices (exact WAD on a mismatch), filter bar (board, calls/puts, open only), `#/boards?board=` deep link and `#/trade?pool=&series=` prefill links; `useHashRoute` keeps queries inside the hash. 98 tests; bundle 694 KB raw / 208 KB gzip JS.
