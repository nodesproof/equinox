// test/pages/contracts.test.tsx — Contracts dari fixture ChainContext (tanpa provider/jaringan): setiap alamat manifest (pool/token/math per
// POOL_KEYS, engine, math A/B, feed, USDG mock, USDG Paxos bila C ada, sequencer, deployer) dengan tautan Arbiscan + Sourcify, tanpa factory;
// cfg() live per pool dengan satuan (kolom diringkas bila identik, per pool bila berbeda), params() engine, kerangka tanpa angka, build, docs,
// paragraf kejujuran (kalimat footer klasik), tanpa kata "mainnet".
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BUILD_TIME, CHAIN_ID, COMMIT, DEPLOYED_AT_BLOCK, DEPLOYER, FEED, MATH_SOL, MATH_STYLUS, POOLS, POOL_KEYS, RPC_URL, SEQ, USDG, VOL as VOL_ADDR, explorerAddress } from '@chain/deployment';
import { pct, usdg, utc, wad } from '@chain/ui/format';
import Contracts from '@/pages/Contracts';
import { bpsPct, buildStamp } from '@/lib/format';
import { CFG_FIELDS, DOCS, REPO, addressRows, cfgIdentical, cfgRows, cfgValue, commitUrl, docUrl, engineRows, honestySentences, sourcifyUrl } from '@/lib/contracts';
import { renderWithChain } from '../render';
import { BLOCK, CFG, VOL, liveSnapshot } from '../fixtures/snapshot';

afterEach(() => { cleanup(); window.location.hash = ''; });

const addressRow = (addr: string) => document.querySelector<HTMLElement>(`tr[data-address="${addr}"]`);
const cfgRow = (key: string) => document.querySelector<HTMLElement>(`tr[data-cfg="${key}"]`)!;
const cfgCells = (key: string) => Array.from(cfgRow(key).querySelectorAll('td')).map((td) => td.textContent!.trim());

describe('Contracts — addresses from the manifest', () => {
  it('lists every pool address (pool, option token, math), the shared contracts and Paxos USDG when Pool C exists — with Arbiscan and Sourcify links', () => {
    const s = liveSnapshot();
    renderWithChain(<Contracts />, { snapshot: s, nowMs: s.fetchedAtMs });
    expect(screen.getByRole('heading', { level: 2, name: 'Contracts & protocol' })).toBeInTheDocument();
    const expected: [string, string][] = [];
    for (const k of POOL_KEYS) expected.push([POOLS[k].label, POOLS[k].pool], [`Option token ${k}`, POOLS[k].token], [`Math ${k}`, POOLS[k].math]);
    expected.push(['Shared vol engine (EWMA from Chainlink)', VOL_ADDR], ['Math A — BlackScholesSol', MATH_SOL], ['Math B — Stylus program (cached)', MATH_STYLUS], ['Chainlink ETH/USD (real)', FEED], ['MockUSDG', USDG], ['MockSequencerFeed (no L2 uptime feed on Sepolia)', SEQ], ['Deployer / treasury (EOA)', DEPLOYER]);
    if (POOL_KEYS.includes('C')) expected.push([`${POOLS.C.assetSymbol} (Paxos, real testnet token — asset of Pool C)`, POOLS.C.asset]);
    for (const [label, addr] of expected) {
      const trs = Array.from(document.querySelectorAll<HTMLElement>(`tr[data-address="${addr}"]`));
      const tr = trs.find((r) => r.textContent!.includes(label));
      expect(tr, `${label} → ${addr}`).toBeDefined();
      expect(within(tr!).getByText(addr)).toBeInTheDocument();
      expect(within(tr!).getByRole('link', { name: /Arbiscan/ })).toHaveAttribute('href', explorerAddress(addr));
      expect(within(tr!).getByRole('link', { name: /Sourcify/ })).toHaveAttribute('href', `https://repo.sourcify.dev/${CHAIN_ID}/${addr}`);
      expect(within(tr!).getByRole('link', { name: /Sourcify/ })).toHaveAttribute('rel', 'noopener noreferrer');
    }
    // Table rows = helper rows; groups per pool + shared; the factory is not in the manifest → no row for it.
    const rows = addressRows();
    expect(document.querySelectorAll('.contracts-table tr.series-row')).toHaveLength(rows.length);
    expect(rows.some((r) => /factory/i.test(r.label))).toBe(false);
    for (const k of POOL_KEYS) expect(screen.getByRole('rowgroup', { name: `Pool ${k}` })).toBeInTheDocument();
    expect(screen.getByRole('rowgroup', { name: 'Shared' })).toBeInTheDocument();
    expect(screen.getByText(`${rows.length} contracts · from block ${DEPLOYED_AT_BLOCK}`)).toBeInTheDocument();
    // Paxos USDG only when a Paxos pool exists; USDG mock row names the mint pools.
    const paxosRows = rows.filter((r) => r.label.includes('Paxos, real testnet token'));
    expect(paxosRows).toHaveLength(POOL_KEYS.filter((k) => POOLS[k].faucet === 'paxos').length);
    expect(rows.find((r) => r.address === USDG)!.label).toContain(`asset of Pools ${POOL_KEYS.filter((k) => POOLS[k].faucet === 'mint').join(' and ')}`);
    expect(sourcifyUrl(FEED)).toBe(`https://repo.sourcify.dev/${CHAIN_ID}/${FEED}`);
    // The whole page never says "mainnet".
    expect(document.body.textContent).not.toMatch(/mainnet/i);
  });
});

describe('Contracts — live configuration', () => {
  it('shows cfg() with units from the snapshot (one column when every pool is identical), params() of the engine and the snapshot block', () => {
    const s = liveSnapshot();
    renderWithChain(<Contracts />, { snapshot: s, nowMs: s.fetchedAtMs });
    const config = screen.getByLabelText('Live pool configuration');
    expect(within(config).getByText(`block ${BLOCK}`)).toHaveClass('status-pill--good');
    // cfg() identical across pools (fixture) → a single "all pools" column.
    const rows = cfgRows(Object.fromEntries(POOL_KEYS.map((k) => [k, s.pools[k].cfg])) as Parameters<typeof cfgRows>[0]);
    expect(cfgIdentical(rows)).toBe(true);
    expect(within(config).getByRole('columnheader', { name: `all pools (${POOL_KEYS.join(', ')})` })).toBeInTheDocument();
    expect(within(config).queryByRole('columnheader', { name: 'Pool A' })).toBeNull();
    expect(document.querySelectorAll('.config-table tr[data-cfg]')).toHaveLength(CFG_FIELDS.length);
    // Every value = fixture cfg through the formatters (bps → %, seconds + duration, units, asset).
    const k0 = POOL_KEYS[0]!;
    expect(cfgCells('feeBps')[0]).toBe(bpsPct(CFG.feeBps));
    expect(cfgCells('maxUtilBps')[0]).toBe(bpsPct(CFG.maxUtilBps));
    expect(cfgCells('vegaCapBps')[0]).toBe(bpsPct(CFG.vegaCapBps));
    expect(cfgCells('minPremiumBps')[0]).toBe(bpsPct(CFG.minPremiumBps));
    expect(cfgCells('heartbeat')[0]).toBe(`${CFG.heartbeat.toLocaleString('en-US')} s (1h 0m)`);
    expect(cfgCells('staleMult')[0]).toBe(`${CFG.staleMult}×`);
    expect(cfgCells('sequencerGrace')[0]).toBe(`${CFG.sequencerGrace.toLocaleString('en-US')} s (1h 0m)`);
    expect(cfgCells('maxOpenSeries')[0]).toBe(`${CFG.maxOpenSeries}`);
    expect(cfgCells('tenorMax')[0]).toBe(`${CFG.tenorMax.toLocaleString('en-US')} s (30d 0h 0m)`);
    expect(cfgCells('minSize')[0]).toBe(`${wad(CFG.minSize, 2)} units`);
    expect(cfgCells('settleBounty')[0]).toBe(`${usdg(CFG.settleBounty)} ${POOLS[k0].assetSymbol}`);
    for (const f of CFG_FIELDS) expect(cfgCells(f.key)[0]).toBe(cfgValue(f.key, CFG, k0));
    // params() of the shared engine.
    const engine = screen.getByLabelText('Live engine parameters');
    expect(within(engine).getByText(`${wad(VOL.lambdaPerDay, 2)} / day`)).toBeInTheDocument();
    expect(within(engine).getByText(`${wad(VOL.vrp, 2)}×`)).toBeInTheDocument();
    expect(within(engine).getByText(wad(VOL.alpha, 2))).toBeInTheDocument();
    expect(within(engine).getByText(pct(VOL.spread))).toBeInTheDocument();
    expect(within(engine).getByText(`${wad(VOL.sigmaMin, 2)} – ${wad(VOL.sigmaMax, 2)}`)).toBeInTheDocument();
    expect(within(engine).getByText(wad(VOL.sigmaBase))).toBeInTheDocument();
    expect(within(engine).getByText(`…${VOL.lastRoundId.toString().slice(-5)}`)).toBeInTheDocument();
    expect(within(engine).getByText(utc(VOL.lastTs))).toBeInTheDocument();
    expect(engineRows(VOL).every((r) => r.value !== null)).toBe(true);
    expect(engineRows(null).every((r) => r.value === null)).toBe(true);
  });

  it('splits the columns per pool when cfg() differs between pools', () => {
    const s = liveSnapshot();
    const kB = POOL_KEYS[1] ?? POOL_KEYS[0]!;
    s.pools[kB] = { ...s.pools[kB], cfg: { ...s.pools[kB].cfg, feeBps: s.pools[kB].cfg.feeBps + 100 } };
    renderWithChain(<Contracts />, { snapshot: s, nowMs: s.fetchedAtMs });
    const config = screen.getByLabelText('Live pool configuration');
    for (const k of POOL_KEYS) expect(within(config).getByRole('columnheader', { name: `Pool ${k}` })).toBeInTheDocument();
    expect(within(config).queryByRole('columnheader', { name: /all pools/ })).toBeNull();
    const fee = cfgCells('feeBps');
    expect(fee.slice(0, POOL_KEYS.length)).toEqual(POOL_KEYS.map((k) => bpsPct(s.pools[k].cfg.feeBps)));
    expect(fee[POOL_KEYS.indexOf(kB)]).toBe(bpsPct(CFG.feeBps + 100));
  });

  it('before the first snapshot every config value is "—" with the reason while the addresses are already listed; a failed first load says so', () => {
    const { unmount } = renderWithChain(<Contracts />, { snapshot: null });
    for (const f of CFG_FIELDS) for (const c of cfgCells(f.key).slice(0, -1)) expect(c).not.toMatch(/\d/);
    expect(screen.getAllByText('Awaiting snapshot').length).toBeGreaterThanOrEqual(CFG_FIELDS.length + engineRows(null).length);
    const engine = screen.getByLabelText('Live engine parameters');
    for (const strong of Array.from(engine.querySelectorAll('.config-list strong'))) expect(strong.textContent).not.toMatch(/\d/);
    for (const k of POOL_KEYS) expect(addressRow(POOLS[k].pool)).not.toBeNull();
    expect(screen.queryByText(`block ${BLOCK}`)).toBeNull();
    unmount();
    renderWithChain(<Contracts />, { snapshot: null, meta: { error: 'HTTP request failed.' } });
    expect(screen.getAllByText('RPC error — retrying').length).toBeGreaterThanOrEqual(CFG_FIELDS.length);
    expect(screen.queryByText('Awaiting snapshot')).toBeNull();
  });
});

describe('Contracts — build, docs and honesty', () => {
  it('shows the build commit and time, the RPC host, the six documentation links on GitHub main, and the classic honesty paragraph', () => {
    const s = liveSnapshot();
    renderWithChain(<Contracts />, { snapshot: s, nowMs: s.fetchedAtMs });
    expect(screen.getByText(`build ${COMMIT}`)).toBeInTheDocument();
    const build = screen.getByLabelText('Build');
    expect(within(build).getByText(COMMIT)).toBeInTheDocument();
    expect(within(build).queryByRole('link', { name: new RegExp(COMMIT) })).toBeNull(); // "test" is not a SHA → no commit link
    expect(commitUrl('84e14d0')).toBe(`${REPO}/commit/84e14d0`);
    expect(commitUrl('dev')).toBeNull();
    expect(within(build).getByText(buildStamp(BUILD_TIME))).toBeInTheDocument();
    expect(within(build).getByText(`Arbitrum Sepolia · ${CHAIN_ID}`)).toBeInTheDocument();
    expect(within(build).getByText(new URL(RPC_URL).host)).toBeInTheDocument();
    expect(within(build).getByText(DEPLOYED_AT_BLOCK.toString())).toBeInTheDocument();
    const docs = screen.getByLabelText('Documentation');
    expect(DOCS.map((d) => d.path)).toEqual(['README.md', 'docs/BENCHMARK.md', 'docs/DEMO_LOG.md', 'prd-arsitektur.md', 'docs/OPS_SEPOLIA.md', 'docs/VERIFICATION.md']);
    for (const d of DOCS) {
      const a = within(docs).getByRole('link', { name: new RegExp(`^${d.label}`) });
      expect(a).toHaveAttribute('href', `${REPO}/blob/main/${d.path}`);
      expect(a).toHaveAttribute('href', docUrl(d));
      expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    }
    expect(within(docs).getByRole('link', { name: /GitHub/ })).toHaveAttribute('href', REPO);
    const honesty = screen.getByTestId('honesty');
    expect(honesty).toHaveTextContent(honestySentences().join(' '));
    const mint = POOL_KEYS.filter((k) => POOLS[k].faucet === 'mint').join('/');
    expect(honesty).toHaveTextContent(`Mocked on purpose: USDG on ${mint} and the sequencer feed are mocks`);
    if (POOL_KEYS.includes('C')) expect(honesty).toHaveTextContent('Paxos USDG exists on Sepolia but its mint is permissioned and the faucet gives 100/day; Pool C uses the real token');
    expect(honesty).toHaveTextContent('the price feed is the real Chainlink ETH/USD.');
    expect(honesty).toHaveTextContent('the live identity claim is math parity (both math contracts return byte-identical prices for identical inputs).');
    expect(honesty).toHaveTextContent('Stylus gas numbers are with the program cached.');
    expect(honesty).toHaveTextContent('Treasury = deployer wallet on this testnet deployment.');
    expect(screen.getByText('testnet · no real money')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/mainnet/i);
  });
});
