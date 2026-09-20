# Equinox dashboard

Live view of the two Equinox option pools on Arbitrum Sepolia — Pool A (Solidity control, `BlackScholesSol`) and Pool B (Stylus program, cached) — sharing one Chainlink-derived volatility engine. The page reads every address from `../deployments/arbitrum-sepolia.json` (aliased as `@deployment`), polls the public RPC with viem, and shows block/quote/NAV state, K5 math parity per series, gas estimates A vs B, an activity feed built from pool events (`Bought`/`Closed`/`Settled`/`Claimed` on both pools) with a σ_base chart from the engine's `Observed` events, plus contract links. With an injected wallet (MetaMask) the Trade panel lets you mint mock USDG, approve, deposit/redeem LP shares, buy/close options and claim after settlement. No framework: Vite 6 + TypeScript 5 + viem 2.

Published at <https://nodesproof.github.io/equinox/> (GitHub Pages, `base: /equinox/`).

## Run locally

```sh
cd web
npm ci
npm run seed       # optional: public/events-seed.json (event scan since deploy) so the page skips the cold scan
npm run dev        # http://localhost:5173/equinox/
```

Query parameters:

- `?rpc=http://127.0.0.1:8545` — point the page at a local node (nitro devnode / anvil fork). Only loopback hosts (`127.0.0.1`, `localhost`) are honoured; anything else falls back to the manifest RPC.
- `?poll=4000` — shorten the poll interval in ms (floor 2000, default 15000). Handy while filming a script that changes state.

Events are read with `eth_getLogs` in 50,000-block windows. `npm run seed` scans everything since the pools' deploy block once and writes `public/events-seed.json` (served at `/equinox/events-seed.json`; git-ignored, regenerated at every build); the page loads that seed first and then only reads the delta from the seed's `lastBlock + 1` — on the first successful snapshot and every 4th refresh. Without a seed (404, or the seed step failed) the page falls back to the full scan from the deploy block. The public RPC answers a 50k window in well under a second but rate-limits (HTTP 429) much wider ranges, which is why the cold scan is done at build time.

## Trade panel (wallet)

`src/chain/trade.ts` builds every write call (`buy`, `close`, `claim`, `deposit`, `redeem`, `approve`, faucet `mint`) as a plain `{ address, abi, functionName, args }` — pure, no DOM, no client — and is the single source of calldata for both the panel and the smoke test. `src/chain/wallet.ts` wraps the injected provider: `connect()` (requestAddresses + switch/add Arbitrum Sepolia), `write(call, account)` = `simulateContract` on the public RPC (so a revert is decoded before the wallet opens) → `writeContract` through the wallet → `waitForTransactionReceipt` (status must be `success`; a timeout or a failed receipt lookup throws `TxFailed` with the hash so the log keeps the Arbiscan link), and `decodeRevert(e)` maps custom error names (`UtilizationExceeded`, `SeriesExpired`, …) to human messages. The slippage caps come from a simulation of the **executed** path right before the write, not from the view quotes: `buy`/`close` call `_pokeVol()` first, so they price at the newest Chainlink round, while `quoteBuy`/`quoteClose` are views at the last round the engine observed — after hours without a poke the two differ by more than 1 % and view-based caps revert `SlippageExceeded`. `executedBuy`/`executedClose` simulate `buy(id, size, MAX_UINT)` / `close(id, size, 0)` from the account and return the premium/proceeds the call would actually settle at; the fee is scaled from the view quote's ratio (`scaleFee`, +1 for the on-chain ceil); then 1 % slack on top (`maxPremiumAssets = (premium + fee) × 1.01`, `minProceedsAssets = proceeds × 0.99`). Previews show the view quote labelled *indicative* and, with a wallet connected, the executed value and cap. The panel listens to `accountsChanged`/`chainChanged`; after connect or any action `main.ts` re-reads the snapshot with the account so balances, allowance, LP shares and positions refresh at once. Without a wallet the panel is read-only (previews still work) and links to a Sepolia ETH faucet.

## Checks

```sh
npm run typecheck          # tsc --noEmit
npm test                   # unit tests (manifest shape, series-id derivation, ABI surface, formatting, ATM pick, event chunking/labels/merge)
npm run test:network       # parity (+ pool.math() == manifest, R3-a buy ≥ σ₀ mark ≥ close per live series) + event-read + user-path (snapshot with the owner account) tests against Arbitrum Sepolia (needs network; EQUINOX_NETWORK_TESTS=1)
npm run smoke              # REAL transactions from SEPOLIA_PRIVATE_KEY on Pool B, board 1, 0.01 units (EQUINOX_SMOKE=1): faucet → approve if needed → deposit → buy → close → redeem
npm run abi                # regenerate src/abi/*.ts from ../contracts/out (run `forge build` in contracts/ first)
```

CI regenerates the ABIs from the Foundry artifacts and fails on drift, so commit `src/abi/*` whenever a contract interface changes.

The smoke test is the headless proof of the write path with the exact calldata the UI builds. Run it deliberately, once, from `web/` with the key loaded only into that shell: `set -a; source ../.env; set +a; npm run smoke`. Each step is `simulateContract` → `estimateContractGas × 1.5` (Nitro's estimate has no margin and rises when a new Chainlink round lands before inclusion) → `writeContract` → receipt `success`; the buy/close caps come from `executedBuy`/`executedClose` exactly as in the panel; it prints the Arbiscan link and gas per transaction and asserts the series balance is back to 0 and the LP shares to their pre-deposit value. Never board 0 (the settlement demo).

## Build

```sh
npm run seed               # scan events since deploy → public/events-seed.json (exits non-zero and writes nothing on error)
npm run build              # → dist/ (index.html + assets/ + events-seed.json if seeded), served under /equinox/
npm run preview            # serve dist/ at http://localhost:4173/equinox/
```

The footer shows the commit (`GITHUB_SHA` in CI, `git rev-parse` locally) and build time baked in at build.

## Pages

`.github/workflows/pages.yml` builds and deploys this site on every push to `main` that touches `web/**`, `deployments/**` or the workflow file itself (also `workflow_dispatch`): `npm ci` → `npm run seed` (failure tolerated — a failed or skipped seed just falls back to the live full scan described above) → `npm run typecheck && npm test && npm run build` → `actions/upload-pages-artifact@v3` on `web/dist` → `actions/deploy-pages@v4`. The repo's Pages source is set to `workflow` (`gh api repos/nodesproof/equinox/pages`, build type `workflow`), so the deploy only runs from this Actions workflow, never from a branch push directly. Both this workflow and `keeper.yml` are branch-gated by GitHub Actions itself and only run once they are on `main` — the dashboard goes live at <https://nodesproof.github.io/equinox/> after the Plan 3b PRs merge.
