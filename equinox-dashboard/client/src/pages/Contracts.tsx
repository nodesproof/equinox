// Contracts.tsx — halaman Contracts & protocol: tabel alamat dari manifest (pool/token/math per POOL_KEYS, engine, math A/B, feed, USDG mock,
// USDG Paxos bila ada pool C, sequencer mock, deployer; factory tidak ada di manifest → tidak ditampilkan) dengan tautan Arbiscan + Sourcify,
// konfigurasi live `cfg()` per pool dan `params()` engine dari snapshot (tanpa snapshot → "—" + alasan, bukan angka), build commit/time,
// tautan dokumentasi, dan paragraf kejujuran (mock/testnet/K5/gas) dari footer klasik. Tidak ada alamat/angka yang ditanam di file ini.
import { BookOpen, ExternalLink, FileCode2, GitCommitHorizontal, ScrollText, ShieldCheck } from 'lucide-react';
import { BUILD_TIME, CHAIN_ID, COMMIT, DEPLOYED_AT_BLOCK, POOLS, POOL_KEYS, RPC_URL, explorerAddress, type PoolKey } from '@chain/deployment';
import { rpcOverride } from '@chain/chain/client';
import type { PoolCfg } from '@chain/chain/snapshot';
import { utc } from '@chain/ui/format';
import { useSnapshot } from '@/chain/useSnapshot';
import { NETWORK_NAME } from '@/components/Layout';
import { EmptyValue, SectionHeading, StatusPill } from '@/components/primitives';
import { buildStamp } from '@/lib/format';
import { CFG_FIELDS, DOCS, REPO, addressGroups, addressRows, cfgIdentical, cfgRows, commitUrl, docUrl, engineRows, honestySentences, sourcifyUrl, type ParamRow } from '@/lib/contracts';

/** Tabel alamat: kelompok per pool + bersama; setiap baris label, alamat penuh (mono), catatan, Arbiscan ↗, Sourcify ↗. */
function AddressPanel() {
  const rows = addressRows();
  const groups = addressGroups(rows);
  return (
    <article className="panel address-panel" aria-label="Contract addresses">
      <div className="panel-header">
        <div><div className="eyebrow">Deployment manifest</div><h3>Addresses on {NETWORK_NAME} · {CHAIN_ID}</h3></div>
        <StatusPill tone="muted" title={`deployments/arbitrum-sepolia.json · deployed at block ${DEPLOYED_AT_BLOCK}`}>{rows.length} contracts · from block {DEPLOYED_AT_BLOCK.toString()}</StatusPill>
      </div>
      <div className="table-scroll">
        <table className="series-table contracts-table">
          <thead><tr><th scope="col">Contract</th><th scope="col">Address</th><th scope="col">Role</th><th scope="col">Links</th></tr></thead>
          {groups.map((g) => (
            <tbody key={g} data-group={g} aria-label={g}>
              <tr className="contracts-group"><th scope="rowgroup" colSpan={4}>{g}</th></tr>
              {rows.filter((r) => r.group === g).map((r) => (
                <tr key={`${g}:${r.label}`} className="series-row" data-address={r.address}>
                  <td><strong>{r.label}</strong></td>
                  <td className="mono contracts-address" title={r.address}>{r.address}</td>
                  <td className="muted-text">{r.note}</td>
                  <td><span className="row-actions">
                    <a className="soft-button" href={explorerAddress(r.address)} target="_blank" rel="noopener noreferrer" title={`${r.address} on Arbiscan`}>Arbiscan <ExternalLink size={11} /></a>
                    <a className="soft-button" href={sourcifyUrl(r.address)} target="_blank" rel="noopener noreferrer" title={`Verified source on Sourcify (chain ${CHAIN_ID})`}>Sourcify <ExternalLink size={11} /></a>
                  </span></td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      <div className="board-panel__foot"><span>Every address is read from <strong>deployments/arbitrum-sepolia.json</strong> — the same manifest the data layer uses; nothing on this page is typed by hand. The pool factory is not recorded in the manifest, so it is not listed. Sourcify links open the verified-source repository for chain {CHAIN_ID}; a 404 there means that contract has not been verified yet.</span></div>
    </article>
  );
}

/** Konfigurasi live: `cfg()` per pool (kolom per POOL_KEYS, satu kolom "all pools" bila identik) + `params()` engine; tanpa snapshot → EmptyValue. */
function ConfigPanel({ cfgs, emptyLabel, blockNumber, blockTime }: { cfgs: Record<PoolKey, PoolCfg> | null; emptyLabel: string; blockNumber: bigint | null; blockTime: number | null }) {
  const rows = cfgs ? cfgRows(cfgs) : null;
  const collapsed = rows ? cfgIdentical(rows) : false;
  const cols: string[] = collapsed ? [`all pools (${POOL_KEYS.join(', ')})`] : POOL_KEYS.map((k) => `Pool ${k}`);
  return (
    <article className="panel config-panel" aria-label="Live pool configuration">
      <div className="panel-header">
        <div><div className="eyebrow">Live configuration</div><h3>cfg() per pool</h3></div>
        {blockNumber !== null && blockTime !== null ? <StatusPill tone="good" title={utc(blockTime)}>block {blockNumber.toString()}</StatusPill> : <StatusPill tone="muted">{emptyLabel}</StatusPill>}
      </div>
      <div className="table-scroll">
        <table className="series-table config-table">
          <thead><tr><th scope="col">Parameter</th>{cols.map((c) => <th scope="col" key={c}>{c}</th>)}<th scope="col">Meaning</th></tr></thead>
          <tbody>
            {(rows ?? CFG_FIELDS).map((f, i) => (
              <tr key={f.key} className="series-row" data-cfg={f.key}>
                <th scope="row">{f.label}</th>
                {rows ? (collapsed ? [rows[i]!.values[0]!] : rows[i]!.values).map((v, j) => <td className="mono" key={j}>{v}</td>) : cols.map((c) => <td key={c}><EmptyValue label={emptyLabel} /></td>)}
                <td className="muted-text">{f.hint}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="config-foot"><span>Read with the block-pinned snapshot (one <strong>cfg()</strong> call per pool in the multicall); bps shown as %, seconds with their duration, sizes in option units, the bounty in each pool's asset.</span></div>
    </article>
  );
}

function EnginePanel({ rows, emptyLabel }: { rows: ParamRow[]; emptyLabel: string }) {
  return (
    <article className="panel config-panel" aria-label="Live engine parameters">
      <div className="panel-header"><div><div className="eyebrow">Live configuration</div><h3>params() of the shared engine</h3></div><span className="chip chip--muted">one engine · every pool</span></div>
      <div className="config-list">
        {rows.map((r) => <div key={r.label} title={r.hint}><span>{r.label}</span><strong>{r.value === null ? <EmptyValue label={emptyLabel} /> : r.value}</strong></div>)}
      </div>
      <div className="config-foot"><span>σ_mark(u) = clamp(σ_base, σ_min, σ_max) × VRP × (1 + α·u) — the same engine address quotes every pool; only the inventory term u differs per pool.</span></div>
    </article>
  );
}

function BuildPanel() {
  const url = commitUrl(COMMIT);
  const rpc = rpcOverride() ?? RPC_URL;
  return (
    <article className="panel docs-panel" aria-label="Build">
      <div className="panel-header"><div><div className="eyebrow">Build</div><h3>This dashboard</h3></div><GitCommitHorizontal size={16} className="muted-text" /></div>
      <div className="config-list">
        <div><span>Commit</span><strong className="mono">{url ? <a href={url} target="_blank" rel="noopener noreferrer" title={url}>{COMMIT} ↗</a> : COMMIT}</strong></div>
        <div><span>Built</span><strong className="mono">{buildStamp(BUILD_TIME)}</strong></div>
        <div><span>Network</span><strong className="mono">{NETWORK_NAME} · {CHAIN_ID}</strong></div>
        <div><span>RPC in use</span><strong className="mono" title={rpc}>{new URL(rpc).host}{rpc === RPC_URL ? '' : ' (?rpc= override)'}</strong></div>
        <div><span>Deploy block</span><strong className="mono">{DEPLOYED_AT_BLOCK.toString()}</strong></div>
      </div>
      <div className="config-foot"><span>Static site — no backend, no telemetry; the only network calls are the public RPC and, when connected, the injected wallet.</span></div>
    </article>
  );
}

function DocsPanel() {
  const icons = [BookOpen, FileCode2, ScrollText, BookOpen, ScrollText, ShieldCheck];
  return (
    <article className="panel docs-panel" aria-label="Documentation">
      <div className="panel-header"><div><div className="eyebrow">Documentation</div><h3>Read the protocol</h3></div><a className="soft-button" href={REPO} target="_blank" rel="noopener noreferrer">GitHub <ExternalLink size={11} /></a></div>
      <div className="docs-grid">
        {DOCS.map((d, i) => { const Icon = icons[i] ?? BookOpen; return (
          <a key={d.path} href={docUrl(d)} target="_blank" rel="noopener noreferrer" title={docUrl(d)}><Icon size={15} /><span><strong>{d.label}</strong><small>{d.detail}</small></span><ExternalLink /></a>
        ); })}
      </div>
    </article>
  );
}

function HonestyPanel() {
  const paxos = POOL_KEYS.filter((k) => POOLS[k].faucet === 'paxos');
  return (
    <article className="panel" aria-label="What is mocked and what is real">
      <div className="panel-header"><div><div className="eyebrow">Testnet honesty</div><h3>What is mocked, what is real</h3></div><StatusPill tone="warn">testnet · no real money</StatusPill></div>
      <p className="panel-copy" data-testid="honesty">{honestySentences().join(' ')}</p>
      <div className="board-panel__foot"><span>{paxos.length ? `Pool ${paxos.join('/')} settles in Paxos USDG at faucet scale (100 USDG per wallet per day) — real token, testnet value only. ` : ''}Quote parity across pools is not the claim: K5 is math parity — byte-identical prices from the Solidity and Stylus math for identical inputs, checked live on the Boards page.</span></div>
    </article>
  );
}

export default function Contracts() {
  const { snapshot, failed } = useSnapshot();
  const emptyLabel = failed ? 'RPC error — retrying' : 'Awaiting snapshot';
  const cfgs = snapshot ? (Object.fromEntries(POOL_KEYS.map((k) => [k, snapshot.pools[k].cfg])) as Record<PoolKey, PoolCfg>) : null;
  return (
    <div className="page-stack">
      <SectionHeading eyebrow={`Contracts · ${NETWORK_NAME} · ${CHAIN_ID}`} title="Contracts & protocol"
        detail={`Every address from the deployment manifest with Arbiscan and Sourcify links, the live cfg() of each pool (${POOL_KEYS.join(', ')}) and params() of the shared engine read from the block-pinned snapshot, the build of this dashboard, the documentation, and what is mocked on this testnet.`}
        action={<StatusPill tone="muted" title={`build ${COMMIT} · ${buildStamp(BUILD_TIME)}`}>build {COMMIT}</StatusPill>} />
      <AddressPanel />
      <div className="contracts-grid">
        <ConfigPanel cfgs={cfgs} emptyLabel={emptyLabel} blockNumber={snapshot?.blockNumber ?? null} blockTime={snapshot?.blockTime ?? null} />
        <EnginePanel rows={engineRows(snapshot?.vol ?? null)} emptyLabel={emptyLabel} />
      </div>
      <div className="contracts-grid">
        <DocsPanel />
        <BuildPanel />
      </div>
      <HonestyPanel />
    </div>
  );
}
