// test/abi.test.ts
import { describe, expect, it } from 'vitest';
import { equinoxPoolAbi } from '../src/abi/equinoxPool';
import { equinoxVolEngineAbi } from '../src/abi/equinoxVolEngine';
import { equinoxOptionTokenAbi } from '../src/abi/equinoxOptionToken';
import { mockUsdgAbi } from '../src/abi/mockUsdg';
import { blackScholesAbi } from '../src/abi/blackScholes';
import { aggregatorV3Abi } from '../src/abi/aggregatorV3';
const names = (abi: readonly { type: string; name?: string }[], t = 'function') => abi.filter((i) => i.type === t).map((i) => i.name!);
describe('generated ABIs', () => {
  it('pool exposes what the dashboard reads and writes', () => {
    expect(names(equinoxPoolAbi)).toEqual(expect.arrayContaining(['quoteBuy', 'quoteClose', 'buy', 'close', 'claim', 'deposit', 'redeem', 'previewDeposit', 'previewRedeem', 'totalAssets', 'totalSupply', 'balanceOf', 'reserved', 'escrowedPayouts', 'netVega', 'freeLiquidity', 'sigmaMarkNow', 'capitalRefPrev', 'tradingPaused', 'board', 'series', 'openSeriesIds', 'spot', 'owner']));
    expect(names(equinoxPoolAbi, 'event')).toEqual(expect.arrayContaining(['Bought', 'Closed', 'Settled', 'Claimed']));
    expect(names(equinoxPoolAbi, 'error')).toEqual(expect.arrayContaining(['OracleStale', 'UtilizationExceeded', 'VegaCapExceeded', 'SlippageExceeded', 'SeriesExpired']));
  });
  it('engine, token, usdg, math, feed', () => {
    expect(names(equinoxVolEngineAbi)).toEqual(expect.arrayContaining(['sigmaBase', 'sigmaMark', 'params', 'varWad', 'poke']));
    expect(names(equinoxVolEngineAbi, 'event')).toContain('Observed');
    expect(names(equinoxOptionTokenAbi)).toEqual(expect.arrayContaining(['balanceOf', 'seriesId']));
    expect(names(mockUsdgAbi)).toEqual(expect.arrayContaining(['mint', 'approve', 'allowance', 'balanceOf']));
    expect(names(blackScholesAbi)).toEqual(expect.arrayContaining(['cappedCall', 'quote']));
    expect(names(aggregatorV3Abi)).toContain('latestRoundData');
  });
});
