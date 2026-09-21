// Scroller.tsx — pembungkus tabel lebar: `.table-scroll` (overflow-x, container query untuk baris detail) di dalam `.table-frame` yang menggambar
// pudar tepi kanan (`--more`) hanya selama masih ada kolom tersembunyi di kanan — isyarat "geser" di tablet/telepon; hilang di ujung gulir & saat muat.
import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Scroller({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => { el.removeEventListener('scroll', update); ro?.disconnect(); };
  }, [children]);
  return (
    <div className={`table-frame ${more ? 'table-frame--more' : ''}`}>
      <div ref={ref} className={`table-scroll ${className}`}>{children}</div>
    </div>
  );
}
