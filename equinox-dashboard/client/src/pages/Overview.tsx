// Overview.tsx — halaman ringkasan HIDUP: setiap angka datang dari snapshot/selector ChainProvider (satu blok per refresh), format via @chain/ui/format.
// State: snapshot null → skeleton tanpa angka ("Awaiting snapshot" / "RPC error — retrying"); stale/error → data lama tetap (banner di Layout); live.
// Umur & countdown memakai jam useNow() hanya di sub-komponen kecil (FeedMetric, ExpiryMetric) — panel berat di-memo pada data snapshot.
import { Link } from 'wouter';
import { Activity, ArrowUpRight, BookOpen, Clock3, Gauge, LineChart, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { BOARDS, POOL_KEYS } from '@chain/deployment';
import type { Snapshot, VolState } from '@chain/chain/snapshot';
import { fmtAge, fmtCountdown, pct, utc, wad } from '@chain/ui/format';
import { useSnapshot } from '@/chain/useSnapshot';
import { useEvents } from '@/chain/useEvents';
import { T_MIN, useBoards, usePools, useSeriesRows, type BoardView } from '@/chain/selectors';
import { useNow } from '@/chain/clock';
import { MetricCard } from '@/components/MetricCard';
import { PoolCard } from '@/components/PoolCard';
import { SigmaChart } from '@/components/SigmaChart';
import { ParityPanel } from '@/components/ParityPanel';
import { EventsPreview } from '@/components/EventsPreview';
import { BoardSummary } from '@/components/BoardSummary';
import { EmptyValue, SectionHeading } from '@/components/primitives';
import { usd } from '@/lib/format';

/** Alasan nilai kosong: memuat vs muat pertama gagal (banner + retry ada di Layout). */
const emptyReason = (failed: boolean) => (failed ? 'RPC error — retrying' : 'Awaiting snapshot');

/** ETH/USD Chainlink + umur round (jam dinding) + peringatan bila round lebih tua dari heartbeat × staleMult (`cfg()` pool pertama) relatif ke blockTime — kuotasi revert OracleStale. */
function FeedMetric({ snapshot, emptyLabel }: { snapshot: Snapshot | null; emptyLabel: string }) {
  const now = useNow();
  if (!snapshot) return <MetricCard label="ETH / USD" meta="Chainlink ETH/USD · real testnet feed" tone="gold" icon={LineChart} emptyLabel={emptyLabel} />;
  const cfg = snapshot.pools[POOL_KEYS[0]!].cfg;
  const maxAge = cfg.heartbeat * cfg.staleMult;
  const oracleStale = snapshot.blockTime - snapshot.feed.updatedAt > maxAge;
  return (
    <MetricCard label="ETH / USD" value={usd(snapshot.feed.answer)} suffix="USD" tone={oracleStale ? 'warn' : 'gold'} icon={LineChart}
      meta={oracleStale
        ? <>Chainlink round {utc(snapshot.feed.updatedAt)} is older than heartbeat × staleMult ({fmtCountdown(maxAge)}) at block time — quotes revert <b>OracleStale</b></>
        : <>Chainlink · updated {fmtAge(now / 1000 - snapshot.feed.updatedAt)} · {utc(snapshot.feed.updatedAt)}</>} />
  );
}

/** Board berikutnya yang belum settle: countdown dari blockTime, dimajukan oleh detik dinding sejak snapshot diambil (anchor = waktu blok, bukan jam). */
export function nextBoard(boards: BoardView[]): BoardView | null {
  return boards.find((b) => b.status === 'open' || b.status === 'blackout') ?? boards.find((b) => b.status === 'expired') ?? null;
}
function ExpiryMetric({ snapshot, boards, emptyLabel }: { snapshot: Snapshot | null; boards: BoardView[]; emptyLabel: string }) {
  const now = useNow();
  const meta = 'Friday 08:00 UTC boards · countdown from block time';
  if (!snapshot) return <MetricCard label="Next expiry" meta={meta} tone="green" icon={Clock3} emptyLabel={emptyLabel} />;
  const b = nextBoard(boards);
  if (!b) return <MetricCard label="Next expiry" meta="Every manifest board is settled — new boards are listed after each Friday settlement" tone="green" icon={Clock3} emptyLabel="No open board" />;
  if (b.status === 'expired') {
    return <MetricCard label="Next expiry" value="expired" tone="warn" icon={Clock3} meta={<>Board #{b.board.id} · {utc(b.board.expiry)} · awaiting settle (permissionless <b>settle</b> after expiry)</>} />;
  }
  const elapsed = Math.max(0, (now - snapshot.fetchedAtMs) / 1000);
  const left = b.secondsToExpiry - elapsed;
  return (
    <MetricCard label="Next expiry" value={left <= 0 ? 'now' : fmtCountdown(left)} tone={b.status === 'blackout' ? 'warn' : 'green'} icon={Clock3}
      meta={<>Board #{b.board.id} · {utc(b.board.expiry)} · {b.status === 'blackout' ? `blackout — no trades in the last ${T_MIN} s` : `from block ${snapshot.blockNumber} time`}</>} />
  );
}

/** Panel engine: rumus σ_mark(u) + parameter `params()` dari snapshot.vol (VRP, α, spread, σ_min/σ_max, λ) dan observasi terakhir — tidak ada literal. */
function EnginePanel({ vol, emptyLabel }: { vol: VolState | null; emptyLabel: string }) {
  const row = (label: string, value: string | null, unit?: string) => (
    <div><span>{label}</span><strong>{value === null ? <EmptyValue label={emptyLabel} /> : <>{value}{unit ? <span className="param-unit">{unit}</span> : null}</>}</strong></div>
  );
  return (
    <article className="panel engine-panel">
      <div className="panel-header"><div><div className="eyebrow">Engine parameters</div><h3>Endogenous volatility</h3></div><span className="chip chip--muted">params() on-chain</span></div>
      <div className="engine-equation"><span>σ_mark(u)</span><strong>= clamp(σ_base, σ_min, σ_max) × VRP × (1 + α·u)</strong></div>
      <div className="param-list">
        {row('VRP multiplier', vol ? wad(vol.vrp, 2) : null, '×')}
        {row('Inventory sensitivity α', vol ? wad(vol.alpha, 2) : null)}
        {row('Buy / close spread', vol ? pct(vol.spread) : null)}
        {row('σ clamp [σ_min, σ_max]', vol ? `${wad(vol.sigmaMin, 2)} – ${wad(vol.sigmaMax, 2)}` : null)}
        {row('EWMA decay λ', vol ? wad(vol.lambdaPerDay, 2) : null, '/ day')}
        {row('Last observation', vol ? utc(vol.lastTs) : null)}
      </div>
      <div className="engine-note"><ShieldCheck size={15} /><span>One engine shared by every pool · same Chainlink feed · pool quotes may diverge by inventory (σ_mark(util)), never by math</span></div>
    </article>
  );
}

export default function Overview() {
  const { snapshot, parity, gas, failed } = useSnapshot();
  const pools = usePools();
  const boards = useBoards();
  const rows = useSeriesRows();
  const { trades, observed, eventsState } = useEvents();
  const emptyLabel = emptyReason(failed);
  const vol = snapshot?.vol ?? null;

  return (
    <div className="page-stack">
      <div className="hero-row">
        <div>
          <div className="eyebrow eyebrow--accent"><Sparkles size={13} /> On-chain options infrastructure</div>
          <h1>The options edge,<br /><em>read at the source.</em></h1>
          <p className="hero-copy">A transparent control surface for European ETH options priced on-chain, endogenous volatility derived from Chainlink prints, and the byte-identical math parity behind it. Every number below is read from one block-pinned snapshot of Arbitrum Sepolia.</p>
        </div>
        <div className="hero-actions">
          <Link href="/trade" className="button-primary"><Zap size={16} /> Explore trade</Link>
          <Link href="/contracts" className="button-ghost"><BookOpen size={16} /> Read the protocol</Link>
        </div>
      </div>

      <section className="metrics-grid" aria-label="Key metrics">
        <FeedMetric snapshot={snapshot} emptyLabel={emptyLabel} />
        <MetricCard label="σ base" value={vol ? wad(vol.sigmaBase) : undefined} icon={Activity} emptyLabel={emptyLabel}
          meta={vol ? <>Annualised EWMA of realised variance · λ {wad(vol.lambdaPerDay, 2)}/day · clamp [{wad(vol.sigmaMin, 2)}, {wad(vol.sigmaMax, 2)}]</> : 'Annualised · EWMA of realised variance'} />
        <MetricCard label="σ mark (0)" value={vol ? wad(vol.sigmaMark0) : undefined} tone="violet" icon={Gauge} emptyLabel={emptyLabel}
          meta={vol ? <>= σ_base × VRP <b>{wad(vol.vrp, 2)}</b> · α <b>{wad(vol.alpha, 2)}</b> · spread <b>{pct(vol.spread)}</b> · zero utilisation</> : 'VRP applied · zero utilisation'} />
        <ExpiryMetric snapshot={snapshot} boards={boards} emptyLabel={emptyLabel} />
      </section>

      <div className="two-col two-col--wide">
        <SigmaChart observed={observed} eventsState={eventsState} vol={vol} />
        <EnginePanel vol={vol} emptyLabel={emptyLabel} />
      </div>

      <section>
        <SectionHeading eyebrow="Capital layer" title="One vault per pool, one source of truth"
          detail="Pools differ only in the math implementation (Solidity vs Stylus) and, for the Paxos pool, the settlement asset. Every pool metric below is pinned to the snapshot block; caps use the bps from each pool's cfg()."
          action={<Link href="/boards" className="button-ghost button-small">Compare series <ArrowUpRight size={14} /></Link>} />
        <div className="pool-grid">
          {POOL_KEYS.map((k) => <PoolCard key={k} k={k} pool={pools.find((p) => p.k === k) ?? null} emptyLabel={emptyLabel} />)}
        </div>
      </section>

      <section>
        <SectionHeading eyebrow="Boards" title="Series around the money"
          detail={`ATM ± 2 rows per board (${BOARDS.length} boards in the manifest); buy quotes are per 1.0 unit at each pool's inventory — the full table with close, Δ, OI and Greeks lives on Boards.`}
          action={<Link href="/boards" className="button-ghost button-small">All series <ArrowUpRight size={14} /></Link>} />
        <BoardSummary boards={boards} spotWad={snapshot?.feed.spotWad ?? null} emptyLabel={emptyLabel} />
      </section>

      <div className="two-col">
        <ParityPanel rows={rows} parityRead={parity.length > 0} gas={gas} blockNumber={snapshot?.blockNumber ?? null} emptyLabel={emptyLabel} />
        <EventsPreview trades={trades} eventsState={eventsState} />
      </div>
    </div>
  );
}
