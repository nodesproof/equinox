import { Link } from "wouter";
import { Activity, ArrowUpRight, BookOpen, ChevronRight, Clock3, ExternalLink, Gauge, LineChart, Radio, ShieldCheck, Sparkles, Zap } from "lucide-react";

import { POOL_KEYS, POOLS, explorerAddress, type PoolKey } from "@chain/deployment";
import { EmptyValue, MetricCard, SectionHeading, StatusPill } from "@/components/primitives";

// Overview statis (Task 1): kerangka + state kosong yang jujur. Tidak ada angka on-chain di sumber —
// setiap nilai "—" menunggu snapshot (hook data layer datang di task berikutnya).

/** Aksen kartu per pool: A (Solidity) emas, pool Stylus ungu. */
const accent = (k: PoolKey) => (k === "A" ? "gold" : "violet");
/** "Pool A — control (BlackScholesSol)" → "control (BlackScholesSol)". */
const poolTagline = (k: PoolKey) => POOLS[k].label.split(" — ")[1] ?? POOLS[k].label;
const assetTagline = (k: PoolKey) => (POOLS[k].faucet === "paxos" ? `${POOLS[k].assetSymbol} · Paxos (testnet)` : `${POOLS[k].assetSymbol} · mock, open faucet`);

function PoolCard({ k }: { k: PoolKey }) {
  const tone = accent(k);
  return (
    <article className={`pool-card pool-card--${tone}`}>
      <div className="pool-card__top">
        <div className="pool-card__identity">
          <div className={`pool-orb pool-orb--${tone}`}>{k}</div>
          <div>
            <div className="pool-card__name">Pool {k} <span>{poolTagline(k)}</span></div>
            <div className="pool-card__math">{assetTagline(k)}</div>
          </div>
        </div>
        <a className="icon-link" href={explorerAddress(POOLS[k].pool)} target="_blank" rel="noopener noreferrer" aria-label={`Open Pool ${k} on Arbiscan`}><ExternalLink size={15} /></a>
      </div>
      <div className="pool-card__nav">
        <div><span className="data-label">NAV</span><strong><EmptyValue /></strong></div>
        <div><span className="data-label">Free liquidity</span><strong><EmptyValue /></strong></div>
      </div>
      <div className="pool-card__meter">
        <div className="meter-heading"><span>Utilisation</span><span className="mono">—</span></div>
        <div className="meter-track"><div className="meter-fill" style={{ width: "0%" }} /></div>
        <div className="meter-foot"><span>Vega cap —</span><span>Reserve cap —</span></div>
      </div>
      <Link href="/boards" className="text-button">Inspect series <ChevronRight size={14} /></Link>
    </article>
  );
}

function SigmaChartPanel() {
  return (
    <article className="panel chart-panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Volatility engine</div>
          <h3>Observed σ_base</h3>
        </div>
        <div className="chart-legend"><span className="legend-dot legend-dot--gold" />σ_base <span className="legend-dot legend-dot--muted" />no events yet</div>
      </div>
      <div className="chart-wrap">
        <div className="chart-y-labels" aria-hidden="true" />
        <svg className="engine-chart" viewBox="0 0 720 220" preserveAspectRatio="none" role="img" aria-label="Sigma base chart awaiting Observed events">
          {[28, 82, 136, 190].map((y) => <line key={y} x1="0" x2="720" y1={y} y2={y} className="chart-grid" />)}
        </svg>
        <div className="chart-empty"><Radio size={18} /><span>No Observed events loaded</span><small>Seed + chain scan populate this view once the data layer is wired</small></div>
      </div>
      <div className="chart-footer"><span>Chain time · UTC</span><span className="mono">lastRoundId —</span></div>
    </article>
  );
}

export default function Overview() {
  return (
    <div className="page-stack">
      <div className="hero-row">
        <div>
          <div className="eyebrow eyebrow--accent"><Sparkles size={13} /> On-chain options infrastructure</div>
          <h1>The options edge,<br /><em>read at the source.</em></h1>
          <p className="hero-copy">A transparent control surface for European ETH options priced on-chain, endogenous volatility derived from Chainlink prints, and the byte-identical math parity behind it.</p>
        </div>
        <div className="hero-actions">
          <Link href="/trade" className="button-primary"><Zap size={16} /> Explore trade</Link>
          <Link href="/contracts" className="button-ghost"><BookOpen size={16} /> Read the protocol</Link>
        </div>
      </div>

      <div className="notice-banner" role="status">
        <div className="notice-banner__icon"><Radio size={16} /></div>
        <div>
          <strong>Chain snapshot not wired in this build</strong>
          <span>Numeric fields stay empty by design until the block-pinned snapshot hooks land. Nothing on this page is fabricated.</span>
        </div>
      </div>

      <section className="metrics-grid" aria-label="Key metrics">
        <MetricCard label="ETH / USD" meta="Chainlink · age —" tone="gold" icon={LineChart} />
        <MetricCard label="σ base" meta="Annualised · EWMA of realised variance" icon={Activity} />
        <MetricCard label="σ mark (0)" meta="VRP applied · zero utilisation" tone="violet" icon={Gauge} />
        <MetricCard label="Next expiry" meta="Friday 08:00 UTC · countdown from block time" tone="green" icon={Clock3} />
      </section>

      <div className="two-col two-col--wide">
        <SigmaChartPanel />
        <article className="panel engine-panel">
          <div className="panel-header"><div><div className="eyebrow">Engine parameters</div><h3>Endogenous volatility</h3></div><span className="chip chip--muted">On-chain</span></div>
          <div className="engine-equation"><span>σ_mark(u)</span><strong>= clamp(σ_base) × VRP × (1 + α·u)</strong></div>
          <div className="param-list">
            <div><span>VRP multiplier</span><strong><EmptyValue label="Awaiting params()" /></strong></div>
            <div><span>Inventory sensitivity α</span><strong><EmptyValue label="Awaiting params()" /></strong></div>
            <div><span>Buy / close spread</span><strong><EmptyValue label="Awaiting params()" /></strong></div>
            <div><span>Observation interval</span><strong><EmptyValue label="Awaiting params()" /></strong></div>
          </div>
          <div className="engine-note"><ShieldCheck size={15} /><span>Shared engine · same Chainlink feed · pool quotes may diverge by inventory</span></div>
        </article>
      </div>

      <section>
        <SectionHeading eyebrow="Capital layer" title="One vault per pool, one source of truth" detail="Pools differ only in the math implementation (Solidity vs Stylus) and, for the Paxos pool, the settlement asset. Every pool metric below is block-pinned when live." action={<Link href="/boards" className="button-ghost button-small">Compare series <ArrowUpRight size={14} /></Link>} />
        <div className="pool-grid">{POOL_KEYS.map((k) => <PoolCard key={k} k={k} />)}</div>
      </section>

      <div className="two-col">
        <article className="panel parity-panel">
          <div className="panel-header"><div><div className="eyebrow">K5 verification</div><h3>Byte-identical math</h3></div><StatusPill tone="muted">Parity —</StatusPill></div>
          <div className="parity-visual">
            <div className="parity-node"><span>A</span><small>Solidity</small></div>
            <div className="parity-line"><span>same inputs</span><i /><i /><i /></div>
            <div className="parity-node"><span>B</span><small>Stylus</small></div>
          </div>
          <p className="panel-copy">Both math contracts return byte-identical price and Greeks tuples for identical inputs. Pool quotes can still differ because inventory diverges.</p>
          <Link href="/contracts" className="text-button">View verification surface <ChevronRight size={14} /></Link>
        </article>
        <article className="panel activity-empty">
          <div className="panel-header"><div><div className="eyebrow">Latest activity</div><h3>Events feed</h3></div><StatusPill tone="muted">No scan yet</StatusPill></div>
          <div className="empty-state">
            <div className="empty-state__icon"><Activity size={19} /></div>
            <strong>No events loaded</strong>
            <span>Trades, settlements, claims and observations will appear here once the event seed and chain scan are wired.</span>
            <Link href="/activity" className="soft-button">Open activity <ArrowUpRight size={14} /></Link>
          </div>
        </article>
      </div>
    </div>
  );
}
