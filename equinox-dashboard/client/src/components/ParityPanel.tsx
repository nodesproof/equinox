// ParityPanel.tsx — K5 di Overview: n ✓ / n live dari baris paritas (`SeriesView.parity`, dibaca setelah snapshot di blok yang sama),
// ✗ merah + daftar seri bila ada selisih, dan satu baris gas A vs B (`eth_estimateGas` dari buy(1 unit) seri ATM). Kata-kata brief §7.3/§7.4.
import { memo } from 'react';
import { Link } from 'wouter';
import { ChevronRight } from 'lucide-react';
import { GAS_KEYS, POOL_KEYS } from '@chain/deployment';
import type { GasEstimate } from '@chain/chain/gas';
import { relDiff, utc, wad } from '@chain/ui/format';
import type { SeriesView } from '@/chain/selectors';
import { StatusPill, type PillTone } from '@/components/primitives';
import { gasUnits, refLabel } from '@/lib/format';

export interface ParitySummary {
  /** Seri yang diperiksa readParity = seri hidup (expiry > blockTime + 60 → status `open` pada pool pertama). */
  live: number;
  ok: number;
  bad: number;
  /** Seri hidup yang salah satu panggilan math-nya gagal (ok null) — "unavailable", bukan ✗. */
  unavailable: number;
  mismatches: SeriesView[];
}
export function paritySummary(rows: SeriesView[]): ParitySummary {
  const k0 = POOL_KEYS[0]!;
  const live = rows.filter((r) => r.status[k0] === 'open');
  const checked = rows.filter((r) => r.parity !== null && r.parity.ok !== null);
  const mismatches = checked.filter((r) => r.parity!.ok === false);
  return { live: live.length, ok: checked.filter((r) => r.parity!.ok === true).length, bad: mismatches.length, unavailable: live.filter((r) => r.parity === null || r.parity.ok === null).length, mismatches };
}

export interface ParityPanelProps {
  rows: SeriesView[];
  /** Paritas sudah pernah dibaca (readParity menyusul setelah snapshot; [] sebelum itu). */
  parityRead: boolean;
  gas: GasEstimate | null;
  blockNumber: bigint | null;
  /** Belum ada snapshot → pill "Parity —" + alasan. */
  emptyLabel?: string;
}

function ParityPanelView({ rows, parityRead, gas, blockNumber, emptyLabel = 'Awaiting snapshot' }: ParityPanelProps) {
  const sum = paritySummary(rows);
  let tone: PillTone = 'muted', text = `Parity — ${emptyLabel.toLowerCase()}`;
  if (blockNumber !== null) {
    if (!parityRead) text = 'Parity pending — reading both math contracts…';
    else if (sum.bad > 0) { tone = 'bad'; text = `${sum.bad} ✗ · ${sum.ok} ✓ / ${sum.live} live`; }
    else if (sum.unavailable > 0) { tone = 'warn'; text = `${sum.ok} ✓ / ${sum.live} live · ${sum.unavailable} unavailable`; }
    else if (sum.live === 0) text = 'No live series to compare';
    else { tone = 'good'; text = `${sum.ok} ✓ / ${sum.live} live`; }
  }
  const gasA = gas ? gas.gas[GAS_KEYS[0]] : null, gasB = gas ? gas.gas[GAS_KEYS[1]] : null;
  const ratio = gasA !== null && gasB !== null && gasB !== 0n ? `${(Number(gasA) / Number(gasB)).toFixed(2)}×` : '—';
  return (
    <article className="panel parity-panel">
      <div className="panel-header">
        <div><div className="eyebrow">K5 verification</div><h3>Byte-identical math</h3></div>
        <StatusPill tone={tone} title={blockNumber !== null ? `Compared at block ${blockNumber} with σ_mark(0) and t = (expiry − blockTime) / 31 536 000` : undefined}>{text}</StatusPill>
      </div>
      <div className="parity-visual">
        <div className="parity-node"><span>{GAS_KEYS[0]}</span><small>Solidity</small></div>
        <div className="parity-line"><span>same inputs</span><i /><i /><i /></div>
        <div className="parity-node"><span>{GAS_KEYS[1]}</span><small>Stylus (cached)</small></div>
      </div>
      {sum.mismatches.length > 0 ? (
        <ul className="parity-list" aria-label="Series with a parity mismatch">
          {sum.mismatches.map((r) => (
            <li key={r.i}>
              <span className="mono">{refLabel(r.ref)}</span>
              <span>Sol {r.parity!.priceSol === null ? '—' : wad(r.parity!.priceSol)} · Stylus {r.parity!.priceStylus === null ? '—' : wad(r.parity!.priceStylus)}{r.parity!.priceSol !== null && r.parity!.priceStylus !== null ? ` · rel. diff ${relDiff(r.parity!.priceSol, r.parity!.priceStylus)}` : ''}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="panel-copy">
        K5 = byte-identical math for identical inputs: both math contracts (Solidity control vs Stylus, program cached) return the same price and Greeks tuple for
        (S, K, t, σ_mark(0)){blockNumber !== null ? ` at block ${blockNumber}` : ''}, compared with zero tolerance. Pool quotes can still differ — Δ is inventory, not math.
      </p>
      <div className="gas-line">
        <span>
          {gas
            ? <>Gas <strong>buy(1 C {gas.strike}, {utc(gas.expiry)})</strong>: {GAS_KEYS[0]} <strong>{gasUnits(gasA)}</strong> · {GAS_KEYS[1]} <strong>{gasUnits(gasB)}</strong> · ratio <strong>{ratio}</strong></>
            : <>Gas: — {blockNumber === null ? emptyLabel.toLowerCase() : 'no open board or estimate not read yet'}</>}
        </span>
        <small>eth_estimateGas of buy(1 unit) from the pool owner wallet — an estimate, not a measurement; single calls are ≈ 1×, the loop benchmarks live in docs/BENCHMARK.md.</small>
      </div>
      <Link href="/boards" className="text-button">Per-series parity on the boards <ChevronRight size={14} /></Link>
    </article>
  );
}

/** Memo pada rows/gas (identitas stabil per snapshot + parity) — detak jam tidak merender ulang panel. */
export const ParityPanel = memo(ParityPanelView);
