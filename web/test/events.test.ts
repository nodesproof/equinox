// test/events.test.ts — unit tanpa jaringan: pembagian jendela eth_getLogs, label seri dari id JSON, gabungan inkremental, seed hasil build.
import { describe, expect, it } from 'vitest';
import { ALL_SERIES, DEPLOYED_AT_BLOCK } from '../src/deployment';
import { CHUNK, chunked, loadSeed, mergeEvents, parseSeed, seriesLabel, serializeSeed, type EventSeed, type Events, type ObservedEvent, type TradeEvent } from '../src/chain/events';

describe('chunked', () => {
  it('splits a 120,001-block range into 3 inclusive windows without gaps or overlap', async () => {
    const calls: [bigint, bigint][] = [];
    const from = 310_687_948n, to = from + 120_000n; // 120.001 blok inklusif
    const out = await chunked(from, to, async (a, b) => { calls.push([a, b]); return [calls.length]; });
    expect(CHUNK).toBe(50_000n);
    expect(calls).toEqual([[from, from + 49_999n], [from + 50_000n, from + 99_999n], [from + 100_000n, to]]);
    for (const [a, b] of calls) expect(b - a + 1n).toBeLessThanOrEqual(CHUNK);
    for (let i = 1; i < calls.length; i++) expect(calls[i]![0]).toBe(calls[i - 1]![1] + 1n);
    expect(out).toEqual([1, 2, 3]); // hasil digabung urut panggilan
  });
  it('makes one call for a range inside a single chunk and none when from > to', async () => {
    const calls: [bigint, bigint][] = [];
    await chunked(100n, 100n + CHUNK - 1n, async (a, b) => { calls.push([a, b]); return []; });
    expect(calls).toEqual([[100n, 100n + CHUNK - 1n]]);
    calls.length = 0;
    expect(await chunked(200n, 199n, async (a, b) => { calls.push([a, b]); return [1]; })).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe('seriesLabel', () => {
  const c2800 = ALL_SERIES.find((s) => s.boardId === 0 && s.strike === 2800 && s.isCall)!;
  const p2400 = ALL_SERIES.find((s) => s.boardId === 0 && s.strike === 2400 && !s.isCall)!;
  it('maps JSON ids of pool A and pool B to "C 2800 #0" / "P 2400 #0"', () => {
    expect(seriesLabel('A', c2800.id.A)).toBe('C 2800 #0');
    expect(seriesLabel('B', c2800.id.B)).toBe('C 2800 #0');
    expect(seriesLabel('A', p2400.id.A)).toBe('P 2400 #0');
    expect(seriesLabel('B', p2400.id.B)).toBe('P 2400 #0');
  });
  it('does not match a pool-A id against pool B (ids differ per pool) and truncates unknown ids', () => {
    expect(seriesLabel('B', c2800.id.A)).toBe(`series ${c2800.id.A.toString().slice(0, 8)}…`);
    expect(seriesLabel('A', 123_456_789_012n)).toBe('series 12345678…');
  });
});

describe('mergeEvents', () => {
  const trade = (block: bigint, logIndex: number, tx: `0x${string}`): TradeEvent => ({ pool: 'A', kind: 'Bought', block, logIndex, tx, who: null, label: 'C 2800 #0', amount: '' });
  const obs = (block: bigint, logIndex: number): ObservedEvent => ({ block, logIndex, roundId: block, priceWad: 0n, sigmaBase: 0n });
  it('dedupes by tx+logIndex, keeps trades newest first and observed in chain order', () => {
    const prev: Events = { trades: [trade(10n, 2, '0xaa'), trade(5n, 0, '0xbb')], observed: [obs(3n, 0), obs(7n, 1)] };
    const next: Events = { trades: [trade(12n, 0, '0xcc'), trade(10n, 2, '0xaa'), trade(10n, 9, '0xdd')], observed: [obs(7n, 1), obs(9n, 0)] };
    const m = mergeEvents(prev, next);
    expect(m.trades.map((t) => [t.block, t.logIndex])).toEqual([[12n, 0], [10n, 9], [10n, 2], [5n, 0]]);
    expect(m.observed.map((o) => o.block)).toEqual([3n, 7n, 9n]);
  });
  it('is the identity for an empty increment', () => {
    const prev: Events = { trades: [trade(1n, 0, '0x01')], observed: [obs(1n, 0)] };
    expect(mergeEvents(prev, { trades: [], observed: [] })).toEqual(prev);
  });
  it('prefers `next` on a key collision for trades and observed alike', () => {
    const prev: Events = { trades: [{ ...trade(10n, 2, '0xaa'), amount: 'stale' }], observed: [{ ...obs(7n, 1), sigmaBase: 1n }] };
    const next: Events = { trades: [{ ...trade(10n, 2, '0xaa'), amount: 'fresh' }], observed: [{ ...obs(7n, 1), sigmaBase: 2n }] };
    const m = mergeEvents(prev, next);
    expect(m.trades).toHaveLength(1); expect(m.trades[0]!.amount).toBe('fresh');
    expect(m.observed).toHaveLength(1); expect(m.observed[0]!.sigmaBase).toBe(2n);
  });
});

describe('event seed', () => {
  const fixture: EventSeed = {
    lastBlock: DEPLOYED_AT_BLOCK + 92_738n, generatedAt: '2026-09-20T07:30:00.000Z',
    trades: [{ pool: 'A', kind: 'Bought', block: 310_703_386n, logIndex: 25, tx: '0x64bc18c558346d3250fd7d78ea01642cff4b5f6161d507a85906cd48f5f562b7', who: '0x90351bB1E85a17D5f70c62C0cC076D39D897076D', label: 'P 2400 #0', amount: '1.00 units · 12.73 USDG @ σ 0.67' }],
    observed: [{ block: 310_728_592n, logIndex: 40, roundId: 18446744073710941461n, priceWad: 2613908736560000000000n, sigmaBase: 548930159383211337n }],
  };
  it('round-trips through serializeSeed/parseSeed with bigints restored and logIndex numeric', () => {
    const json = serializeSeed(fixture);
    const raw = JSON.parse(json);
    expect(raw.lastBlock).toBe(fixture.lastBlock.toString()); expect(raw.trades[0].block).toBe('310703386'); expect(raw.observed[0].roundId).toBe('18446744073710941461');
    expect(raw.trades[0].logIndex).toBe(25); expect(raw.observed[0].logIndex).toBe(40);
    expect(parseSeed(json)).toEqual(fixture);
  });
  it('rejects a malformed document instead of yielding NaN/strings', () => {
    expect(() => parseSeed('{"lastBlock":1}')).toThrow(/shape/);
    expect(() => parseSeed(JSON.stringify({ lastBlock: 'abc', generatedAt: '', trades: [], observed: [] }))).toThrow(/decimal/);
    expect(() => parseSeed(JSON.stringify({ lastBlock: '1', generatedAt: '', trades: [], observed: [{ block: '1', logIndex: '40', roundId: '1', priceWad: '1', sigmaBase: '1' }] }))).toThrow(/integer/);
  });
  const mockFetch = (body: string | null, status = 200): typeof fetch & { urls: string[] } => {
    const urls: string[] = [];
    const fn = (async (url: string | URL | Request) => { urls.push(String(url)); if (body === null) throw new Error('offline'); return new Response(body, { status }); }) as unknown as typeof fetch & { urls: string[] };
    fn.urls = urls; return fn;
  };
  it('loadSeed fetches events-seed.json under the app base path and parses it', async () => {
    const f = mockFetch(serializeSeed(fixture));
    expect(await loadSeed(f)).toEqual(fixture);
    expect(f.urls).toEqual([`${import.meta.env.BASE_URL}events-seed.json`]);
    expect(f.urls[0]).toMatch(/^\/.*\/events-seed\.json$/); // dilayani di bawah base (/equinox/), bukan /events-seed.json polos
  });
  it('loadSeed returns null on 404, bad JSON, network error, or a seed older than the deploy block', async () => {
    expect(await loadSeed(mockFetch('not found', 404))).toBeNull();
    expect(await loadSeed(mockFetch('{ nope'))).toBeNull();
    expect(await loadSeed(mockFetch(null))).toBeNull();
    expect(await loadSeed(mockFetch(serializeSeed({ ...fixture, lastBlock: DEPLOYED_AT_BLOCK - 1n })))).toBeNull();
  });
});
