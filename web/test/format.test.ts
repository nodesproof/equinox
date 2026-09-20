// test/format.test.ts
import { describe, expect, it } from 'vitest';
import { fmtCountdown, relDiff, usdg, usdg6, wad } from '../src/ui/format';
describe('format', () => {
  it('usdg / wad', () => { expect(usdg6(268_181_826n)).toBe('268.181826'); expect(usdg(1_000_000_000_000n, 0)).toBe('1,000,000'); expect(wad(632_500_000_000_000_000n)).toBe('0.6325'); });
  it('relDiff', () => { expect(relDiff(25_141_500n, 25_140_896n)).toBe('2.4e-5'); expect(relDiff(5n, 5n)).toBe('0'); });
  it('countdown', () => { expect(fmtCountdown(90_061)).toBe('1d 1h 1m'); expect(fmtCountdown(59)).toBe('0m 59s'); });
});
