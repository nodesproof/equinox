// PreviewLine.tsx — satu baris pratinjau di bawah form (deposit/redeem/buy/close): nilai terakhir yang valid (diredupkan selama permintaan baru
// menunggu debounce/RPC), pesan guard/revert (merah), "…" saat menunggu tanpa nilai lama, atau teks idle bila input kosong. Tidak pernah kosong diam-diam.
import type { Preview } from '@/chain/useTrade';

export interface PreviewLineProps<T> {
  id?: string;
  preview: Preview<T>;
  /** Nilai → teks (helper `lib/trade.ts`, kalimat panel klasik). */
  render: (value: T) => string;
  /** Input terisi (ada yang dipratinjau); false → teks idle. */
  active: boolean;
  /** Teks saat tidak ada input, mis. "enter an amount for a preview". */
  idle: string;
}

export type PreviewState = 'value' | 'error' | 'loading' | 'idle';

export function previewState<T>(p: Preview<T>, active: boolean): PreviewState {
  if (p.value !== null) return 'value';
  if (p.error !== null) return 'error';
  return active && p.loading ? 'loading' : 'idle';
}

export function PreviewLine<T>({ id, preview, render, active, idle }: PreviewLineProps<T>) {
  const state = previewState(preview, active);
  const text = state === 'value' ? render(preview.value as T) : state === 'error' ? preview.error! : state === 'loading' ? '…' : idle;
  return (
    <p id={id} className={`preview-line ${state === 'error' ? 'preview-line--bad' : ''} ${state === 'idle' ? 'preview-line--idle' : 'mono'} ${preview.loading && state === 'value' ? 'preview-line--loading' : ''}`}
      data-state={state} title={preview.loading && state === 'value' ? 'Refreshing the preview…' : undefined}>
      {text}
    </p>
  );
}
