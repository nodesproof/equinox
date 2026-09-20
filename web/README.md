# Equinox dashboard

Live, read-mostly view of the two Equinox option pools on Arbitrum Sepolia — Pool A (Solidity control, `BlackScholesSol`) and Pool B (Stylus program, cached) — sharing one Chainlink-derived volatility engine. The page reads every address from `../deployments/arbitrum-sepolia.json` (aliased as `@deployment`), polls the public RPC with viem, and shows block/quote/NAV state plus contract links. No framework: Vite 6 + TypeScript 5 + viem 2.

Published at <https://nodesproof.github.io/equinox/> (GitHub Pages, `base: /equinox/`).

## Run locally

```sh
cd web
npm ci
npm run dev        # http://localhost:5173/equinox/
```

Query parameters:

- `?rpc=http://127.0.0.1:8545` — point the page at a local node (nitro devnode / anvil fork). Only loopback hosts (`127.0.0.1`, `localhost`) are honoured; anything else falls back to the manifest RPC.
- `?poll=4000` — shorten the poll interval in ms (floor 2000, default 15000). Handy while filming a script that changes state.

## Checks

```sh
npm run typecheck          # tsc --noEmit
npm test                   # unit tests (manifest shape, series-id derivation, ABI surface, formatting)
npm run test:network       # parity tests against Arbitrum Sepolia (needs network; EQUINOX_NETWORK_TESTS=1)
npm run abi                # regenerate src/abi/*.ts from ../contracts/out (run `forge build` in contracts/ first)
```

CI regenerates the ABIs from the Foundry artifacts and fails on drift, so commit `src/abi/*` whenever a contract interface changes.

## Build

```sh
npm run build              # → dist/ (index.html + assets/), served under /equinox/
npm run preview            # serve dist/ at http://localhost:4173/equinox/
```

The footer shows the commit (`GITHUB_SHA` in CI, `git rev-parse` locally) and build time baked in at build.
