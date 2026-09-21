// test/viewport.ts — mock `window.matchMedia` untuk jsdom (yang tidak menyediakannya): mengevaluasi kueri `(max-width: Npx)` / `(min-width: Npx)`
// terhadap lebar semu, dan memancarkan `change` ke pendengar saat `resize()`. `restore()` menghapus mock agar test lain kembali ke tampilan desktop.
export interface Viewport { resize(width: number): void; restore(): void }

export function mockViewport(width: number): Viewport {
  const listeners = new Map<string, Set<() => void>>();
  let current = width;
  const evaluate = (q: string) => {
    const max = /\(max-width:\s*(\d+)px\)/.exec(q);
    if (max) return current <= Number(max[1]);
    const min = /\(min-width:\s*(\d+)px\)/.exec(q);
    if (min) return current >= Number(min[1]);
    return false;
  };
  const matchMedia = (query: string): MediaQueryList => {
    const set = listeners.get(query) ?? new Set<() => void>();
    listeners.set(query, set);
    return {
      get matches() { return evaluate(query); },
      media: query, onchange: null,
      addEventListener: (_type: string, cb: EventListenerOrEventListenerObject | null) => { if (typeof cb === 'function') set.add(cb as () => void); },
      removeEventListener: (_type: string, cb: EventListenerOrEventListenerObject | null) => { if (typeof cb === 'function') set.delete(cb as () => void); },
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => true,
    } as unknown as MediaQueryList;
  };
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: matchMedia });
  return {
    resize(w) { current = w; for (const set of listeners.values()) for (const cb of set) cb(); },
    restore() { delete (window as unknown as { matchMedia?: unknown }).matchMedia; },
  };
}
