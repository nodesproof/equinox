// test/smoke.network.test.ts — bukti headless jalur TULIS: beberapa transaksi nyata kecil dari wallet owner di Pool B, board 1 (2 Okt), 0,01 unit.
// Hanya jalan bila EQUINOX_SMOKE=1 dan SEPOLIA_PRIVATE_KEY ada di env proses (`set -a; source ../.env; set +a; npm run smoke`). Kunci tidak pernah dicetak.
// Calldata dibangun oleh src/chain/trade.ts — sumber yang sama dengan panel Trade — sehingga yang diuji adalah argumen yang dipakai UI.
import { describe, expect, it } from 'vitest';
import { createWalletClient, http, type Hash } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { chain, client } from '../src/chain/client';
import { ALL_SERIES, POOLS, RPC_URL, USDG, explorerTx } from '../src/deployment';
import { equinoxPoolAbi } from '../src/abi/equinoxPool';
import { equinoxOptionTokenAbi } from '../src/abi/equinoxOptionToken';
import { mockUsdgAbi } from '../src/abi/mockUsdg';
import { ALLOWANCE_MIN, approveCall, buyCall, closeCall, depositCall, faucetCall, redeemCall, scaleFee, seriesLabel, type TradeCall } from '../src/chain/trade';
import { decodeRevert, executedBuy, executedClose } from '../src/chain/wallet';

const enabled = process.env.EQUINOX_SMOKE === '1';
const POOL = 'B' as const;
const SIZE = 10n ** 16n;          // 0,01 unit = cfg.minSize
const FAUCET = 100n * 10n ** 6n;  // 100 USDG
const DEPOSIT = 10n * 10n ** 6n;  // 10 USDG

describe.skipIf(!enabled)('smoke: real transactions on Pool B, board 1, from the owner wallet', () => {
  it('faucet → (approve) → deposit → buy 0.01 → close 0.01 → redeem; every receipt success; position and shares restored', async () => {
    const pk = process.env.SEPOLIA_PRIVATE_KEY as `0x${string}` | undefined;
    expect(pk, 'SEPOLIA_PRIVATE_KEY missing in the process env').toBeTruthy();
    const account = privateKeyToAccount(pk!);
    const me = account.address;
    const wallet = createWalletClient({ account, chain, transport: http(RPC_URL) });
    // Board 1 (2 Okt) saja — board 0 (25 Sep) adalah demo settlement dan tidak boleh disentuh. K tengah = C 2600 (idx 2).
    const ref = ALL_SERIES.filter((s) => s.boardId === 1).find((s) => s.isCall && s.strike === 2600)!;
    expect(ref).toBeDefined();
    expect(ref.boardId).toBe(1);
    const id = ref.id[POOL];
    const pool = { address: POOLS[POOL].pool, abi: equinoxPoolAbi } as const;
    const token = { address: POOLS[POOL].token, abi: equinoxOptionTokenAbi } as const;
    const usdg = { address: USDG, abi: mockUsdgAbi } as const;
    const read = async () => ({
      usdg: await client.readContract({ ...usdg, functionName: 'balanceOf', args: [me] }),
      allowance: await client.readContract({ ...usdg, functionName: 'allowance', args: [me, POOLS[POOL].pool] }),
      shares: await client.readContract({ ...pool, functionName: 'balanceOf', args: [me] }),
      position: await client.readContract({ ...token, functionName: 'balanceOf', args: [me, id] }),
    });
    const sent: { step: string; hash: Hash; gasUsed: bigint; block: bigint }[] = [];
    // simulate (revert didekode) → estimateGas × 1,5 (Nitro tanpa margin; gas naik bila round Chainlink baru masuk sebelum inklusi) → write → receipt.
    const send = async (step: string, call: TradeCall) => {
      let hash: Hash;
      try {
        const { request } = await client.simulateContract({ ...call, account });
        const gas = await client.estimateContractGas({ ...call, account });
        hash = await wallet.writeContract({ ...request, gas: (gas * 3n) / 2n });
      } catch (e) { throw new Error(`${step}: ${decodeRevert(e)}`); }
      const rc = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
      console.log(`${step}: ${explorerTx(hash)} status=${rc.status} gasUsed=${rc.gasUsed} block=${rc.blockNumber}`);
      expect(rc.status, step).toBe('success');
      sent.push({ step, hash, gasUsed: rc.gasUsed, block: rc.blockNumber });
    };

    const before = await read();
    console.log(`me=${me} pool=${POOL} series=${seriesLabel(ref)} before: usdg=${before.usdg} allowance=${before.allowance} shares=${before.shares} position=${before.position}`);
    expect(before.position, 'no pre-existing position on the smoke series').toBe(0n);

    await send('faucet 100 USDG', faucetCall(me, FAUCET));
    if (before.allowance < ALLOWANCE_MIN) await send('approve USDG (MAX)', approveCall(POOL));
    else console.log('approve: skipped (allowance already ≥ 1e12)');

    await send('deposit 10 USDG', depositCall(POOL, DEPOSIT, me));
    const minted = (await read()).shares - before.shares;
    expect(minted > 0n, 'deposit minted shares').toBe(true);
    console.log(`deposit minted ${minted} shares`);

    // Batas slippage dari jalur eksekusi (post-poke), sama dengan panel Trade: kuotasi view hanya untuk rasio fee dan log (I-1).
    const q = await client.readContract({ ...pool, functionName: 'quoteBuy', args: [id, SIZE] });
    const premExec = await executedBuy(POOL, id, SIZE, me);
    console.log(`quoteBuy 0.01: premium=${q.premiumAssets} fee=${q.feeAssets} sigma=${q.sigma} spot=${q.spotWad}; executed premium=${premExec}`);
    await send(`buy 0.01 ${seriesLabel(ref)}`, buyCall(POOL, id, SIZE, premExec, scaleFee(q.feeAssets, q.premiumAssets, premExec)));
    expect((await read()).position).toBe(SIZE);

    const [proceeds, sigmaClose] = await client.readContract({ ...pool, functionName: 'quoteClose', args: [id, SIZE] });
    const proceedsExec = await executedClose(POOL, id, SIZE, me);
    console.log(`quoteClose 0.01: proceeds=${proceeds} sigmaClose=${sigmaClose}; executed proceeds=${proceedsExec}`);
    await send(`close 0.01 ${seriesLabel(ref)}`, closeCall(POOL, id, SIZE, proceedsExec));

    await send(`redeem ${minted} shares`, redeemCall(POOL, minted, me));

    const after = await read();
    console.log(`after: usdg=${after.usdg} shares=${after.shares} position=${after.position} (usdg delta ${after.usdg - before.usdg})`);
    expect(after.position).toBe(0n);
    expect(after.shares).toBe(before.shares);
    expect(sent.length).toBeGreaterThanOrEqual(5);
    console.log(JSON.stringify(sent.map((t) => ({ step: t.step, tx: explorerTx(t.hash), gasUsed: t.gasUsed.toString(), block: t.block.toString() })), null, 1));
  }, 300_000);
});
