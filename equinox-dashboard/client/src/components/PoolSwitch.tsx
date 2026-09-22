// PoolSwitch.tsx — pemilih pool (segmented control) untuk halaman Trade: satu tombol per POOL_KEYS dengan label pool + aset per pool
// ("mock USDG · open faucet" / "Paxos USDG (testnet)"). Pola radiogroup: aria-checked, roving tabindex, panah kiri/kanan berpindah pool.
import type { CSSProperties, KeyboardEvent } from 'react';
import { POOL_KEYS, type PoolKey } from '@chain/deployment';
import { accent, poolTagline } from '@/components/PoolCard';
import { assetWord } from '@/lib/trade';

export interface PoolSwitchProps {
  value: PoolKey;
  onChange: (k: PoolKey) => void;
  /** Dinonaktifkan selama aksi berjalan (radio klasik `disabled = busy`). */
  disabled?: boolean;
  /** id elemen judul yang melabeli grup (aria-labelledby); tanpa itu aria-label "Pool". */
  labelledBy?: string;
}

export function PoolSwitch({ value, onChange, disabled = false, labelledBy }: PoolSwitchProps) {
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0 || disabled) return;
    e.preventDefault();
    const next = POOL_KEYS[(idx + step + POOL_KEYS.length) % POOL_KEYS.length]!;
    onChange(next);
    (e.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`button[data-pool="${next}"]`))?.focus();
  };
  return (
    <div className="segmented-control pool-switch" role="radiogroup" aria-label={labelledBy ? undefined : 'Pool'} aria-labelledby={labelledBy} style={{ '--pools': POOL_KEYS.length } as CSSProperties}>
      {POOL_KEYS.map((k, idx) => (
        <button type="button" key={k} role="radio" aria-checked={k === value} tabIndex={k === value ? 0 : -1} data-pool={k} disabled={disabled}
          className={k === value ? 'is-selected' : ''} onClick={() => onChange(k)} onKeyDown={(e) => onKey(e, idx)}>
          <span><i className={`pool-dot ${accent(k) === 'violet' ? 'pool-dot--violet' : ''}`} aria-hidden="true" />Pool {k}</span>
          <small>{poolTagline(k)} · {assetWord(k)}</small>
        </button>
      ))}
    </div>
  );
}
