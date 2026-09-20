# Equinox dashboard

Live, read-mostly view of the two Equinox option pools on Arbitrum Sepolia — Pool A (Solidity control, `BlackScholesSol`) and Pool B (Stylus program, cached) — sharing one Chainlink-derived volatility engine. The page reads every address from `../deployments/arbitrum-sepolia.json` (aliased as `@deployment`), polls the public RPC with viem, and shows block/quote/NAV state, K5 math parity per series, gas estimates A vs B, an activity feed built from pool events (`Bought`/`Closed`/`Settled`/`Claimed` on both pools) with a σ_base chart from the engine's `Observed` events, plus contract links. No framework: Vite 6 + TypeScript 5 + viem 2.

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

## Checks

```sh
npm run typecheck          # tsc --noEmit
npm test                   # unit tests (manifest shape, series-id derivation, ABI surface, formatting, ATM pick, event chunking/labels/merge)
npm run test:network       # parity + event-read tests against Arbitrum Sepolia (needs network; EQUINOX_NETWORK_TESTS=1)
npm run abi                # regenerate src/abi/*.ts from ../contracts/out (run `forge build` in contracts/ first)
```

CI regenerates the ABIs from the Foundry artifacts and fails on drift, so commit `src/abi/*` whenever a contract interface changes.

## Build

```sh
npm run seed               # scan events since deploy → public/events-seed.json (exits non-zero and writes nothing on error)
npm run build              # → dist/ (index.html + assets/ + events-seed.json if seeded), served under /equinox/
npm run preview            # serve dist/ at http://localhost:4173/equinox/
```

The footer shows the commit (`GITHUB_SHA` in CI, `git rev-parse` locally) and build time baked in at build.
