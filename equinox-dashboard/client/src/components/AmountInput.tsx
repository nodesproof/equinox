// AmountInput.tsx — input jumlah desimal berlabel (USDG / shares / units) dengan sufiks satuan dan tombol "max" opsional.
// Nilai tetap string (dikendalikan halaman); parsing ke bigint dilakukan pemanggil lewat `parseAmount` agar guard/pratinjau melihat input mentah.
import type { ReactNode } from 'react';

export interface AmountInputProps {
  id: string;
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  /** Satuan di kanan input: `USDG`, `shares`, `units`. */
  suffix: string;
  placeholder?: string;
  disabled?: boolean;
  /** id elemen pratinjau/guard yang menjelaskan input (aria-describedby). */
  describedBy?: string;
  /** Tombol "max" (redeem): mengisi nilai maksimum; `null` = tanpa tombol. */
  max?: { onClick: () => void; disabled?: boolean; title?: string } | null;
}

export function AmountInput({ id, label, value, onChange, suffix, placeholder, disabled = false, describedBy, max = null }: AmountInputProps) {
  return (
    <div className="amount-input">
      <label className="control-label" htmlFor={id}>{label}</label>
      <div className={`input-with-suffix ${max ? 'input-with-suffix--max' : ''}`}>
        <input id={id} type="text" inputMode="decimal" autoComplete="off" spellCheck={false} value={value} placeholder={placeholder} disabled={disabled}
          aria-describedby={describedBy} onChange={(e) => onChange(e.target.value)} />
        {/* Hiasan kanan (tombol max + satuan) satu baris rata kanan; padding-right input mengikuti modifier --max agar placeholder tidak tertutup. */}
        <div className="input-adorn">
          {max ? <button type="button" className="input-max" onClick={max.onClick} disabled={max.disabled} title={max.title} aria-label={`${max.title ?? 'Use the maximum'}`}>max</button> : null}
          <span aria-hidden="true">{suffix}</span>
        </div>
      </div>
    </div>
  );
}
