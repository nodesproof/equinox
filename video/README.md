# Demo video pipeline

Produces `out/equinox-demo.mp4` (1920×1080, 30 fps, ≤ 3:00, burned-in captions) plus `out/equinox-demo.srt` and `out/youtube.md` from the **public dashboard** (https://nodesproof.github.io/equinox/) and the live chain. Nothing is screen-recorded by hand, and no voice is recorded: Playwright drives the page, edge-tts reads the narration, and ffmpeg assembles the cut. That makes the whole video re-shootable in about 15 minutes when the chain state changes, for example after the first settlement.

The narration is `script.ts`, taken from `docs/VIDEO_SCRIPT.md` with the deviations listed below. It is also the clock: every on-screen action is anchored to a phrase in the TTS word timings, and every beat is held at least as long as its speech. Live values are read by `select.ts` into `out/take.json` and never typed in.

## One-time setup

    npm --prefix video install                      # playwright 1.61.1 (browsers already in ~/.cache/ms-playwright), viem 2.56.8
    python3 -m venv video/.venv && video/.venv/bin/pip install edge-tts

## Shoot, start to finish

    set -a; source .env; set +a                     # SEPOLIA_PRIVATE_KEY = the filming account (the owner); never printed
    node --experimental-strip-types video/select.ts         # → out/take.json (aborts when the take would not be true)
    video/.venv/bin/python video/tts.py                     # → out/audio/*.mp3 + index.json (+6 % if over 172 s)
    node --experimental-strip-types video/record.ts --probe # every selector resolves, no video, no transaction
    node --experimental-strip-types video/record.ts         # → out/clips/*.webm; beat 05 sends ONE real buy on Sepolia
    video/.venv/bin/python video/captions.py                # → out/captions.ass + .srt + timeline.json
    video/.venv/bin/python video/build.py                   # → out/equinox-demo.mp4, contact.png, youtube.md
    bash video/verify.sh                                    # duration, cues, narrated values vs take, tx status, nothing staged

Tests (the filming-wallet allowlist, the phrase clock, the series order, the number words): `node --experimental-strip-types --test video/test/*.test.ts`.

Beats can be re-recorded individually: `record.ts --only=04-boards,06-confirmed`. Beat 06 shows the Arbiscan page of the buy that beat 05 sent. Its hash is kept in `out/tx.json`.

## The filming wallet

The page gets an EIP-1193 provider (`record.ts` › `PROVIDER`):

- It answers accounts and the chain id itself.
- It forwards reads to the public RPC, like the dashboard does.
- It hands every `eth_sendTransaction` to this Node process through a Playwright binding.

There, `vet()` refuses anything that is not a call to **pool B**. The call must also be one of these:

- `buy` of at most the take's size;
- `claim`.

The allowed selectors are derived with `toFunctionSelector`, not typed in. The transaction is then signed with the key from the shell, so the key never enters the browser. The dashboard's own write path runs unchanged: simulate, then cap from the executed path, then gas × 1.5, then send, then receipt. Because of this, the narration says "browser wallet" and not "MetaMask": no popup exists to film.

`trade.ts` is the same write path for off-camera trades. It bought the straddle on board 0 whose claim the settlement beats show (`docs/DEMO_LOG.md` › 2026-09-22).

## Deviations from docs/VIDEO_SCRIPT.md

Each deviation keeps a claim true or keeps the cut under 3:00.

| Beat | Script | Here | Why |
|---|---|---|---|
| 04 | "Twelve series, two pools, side by side … the same buy on both pools" | "{N} live series, three pools, side by side … the same buy on pools A and B" | Three pool columns are on screen; parity and gas are still A vs B. N is taken from the take. |
| 05 | "Trading from MetaMask … before the wallet opens"; "Confirm." opens 3b | "Trading from a browser wallet … before the wallet signs. Confirm." closes beat 05 | The headless signer has no popup. The click lands on "Confirm". |
| 07 | reserved "fell from ⟨before⟩ to ⟨after⟩" | "released ⟨X⟩ USDG of reserve and escrowed ⟨Y⟩" | The public RPC has no historical state. The pool's `Settled` event carries both amounts exactly. |
| 07 | "settled both pools at ⟨S_T⟩" | "settled all three pools at ⟨S_T⟩" (or each price) | Pool C settles too. Prices are read from `board(0)` on every pool. |
| 10 | "Single calls are cheaper in Solidity … one percent cheaper in Solidity on deposit" | "Small single calls … a fraction of a percent the other way on deposit" | `quote` is 1.65× cheaper in Stylus. `deposit` is 219,538 vs 220,352 = 0.37 %. |
| 02, 03, 04 | "so you can check the math yourself", "held on-chain by one shared engine", "pool A's put was refilled …" | cut | To fit 3:00 with the settlement beats. |

The cards (`cards.html`) carry measured numbers with their source in the foot:

- the premium sensitivity from PRD §6.7 (40.22 / 58.62 / 78.14, re-derived with Black-Scholes, r = 0);
- the gas rows from `docs/BENCHMARK.md`. Ratios are computed from the shown numbers to 2–3 decimals.

## Status and the Friday re-shoot

**Draft (22 Sep 2026, 172.7 s).** Beats 01–06 and 09–10 are final quality. Beat 07 is a truthful placeholder: the card "First real settlement — Fri 25 Sep 2026 08:00 UTC", narrated as scheduled and not yet happened. Beat 08 (the claim) does not exist yet.

**After Fri 25 Sep 2026 08:00 UTC**, once the keeper has settled board 0 on all pools, run the whole shoot again from `select.ts`:

1. The take turns `settled`. The price per pool comes from `board(0)`; the settler (keeper wallet or not) and pool B's released reserve and escrow come from the `Settled` events; the straddle's paying leg and its payout come from `series(id).payoutPerUnit`.
2. Beats 07 (terminal: the real `cast call board(0)` on each pool, then Boards and Overview) and 08 (a real `claim` of the straddle on camera, then Activity) are added.
3. The longer narration re-renders at +6 %.

Re-recording every beat keeps the actions aligned with the new speech rate. It also films the dashboard after settlement: board 0 settled, and the new boards listed. It costs one more on-camera buy (≈ 22 mock USDG).

## Deliverables

- `out/equinox-demo.mp4` — upload it to HackQuest `demoVideo` (and `pitchVideo`). The mp4 is not committed; copy it next to the other submission assets in `../docs/assets/` (outside the repo).
- `out/equinox-demo.srt`
- `out/youtube.md` — title, description, chapters.
- `out/contact.png` — one frame every 5 s. Read it before calling a cut done.
