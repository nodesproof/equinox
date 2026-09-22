// test/lib/contrast.test.ts — WCAG 2.1 AA untuk warna teks di index.css. Lighthouse/axe tidak bisa mengukurnya: panel dan kartu memakai latar
// gradien, jadi axe menandai kontrasnya "incomplete" dan tidak menilainya (review akhir Plan 5). Test ini menghitung rasio kontras setiap
// deklarasi `color: #hex` terhadap latar solid di aturan yang sama, atau — tanpa latar solid — terhadap setiap permukaan gelap aplikasi
// (yang paling terang, #18253a, yang mengikat). Pengecualian WCAG 1.4.3 saja: kontrol nonaktif dan ikon dekoratif.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(path.resolve(import.meta.dirname, '../../client/src/index.css'), 'utf8');
/** Permukaan tempat teks duduk: latar halaman, sidebar, panel, input, kartu/pill/chip. */
const SURFACES = ['#0b1220', '#0e1726', '#111a2b', '#152036', '#18253a'];
/** Dikecualikan WCAG 1.4.3: teks komponen UI nonaktif, dan ikon murni dekoratif (bukan teks). */
const EXEMPT = [/:disabled\b/, /^\.metric-card__icon$/, /^\.tx-empty svg$/];

const hex6 = (h: string) => (h.length === 4 ? `#${[...h.slice(1)].map((c) => c + c).join('')}` : h).toLowerCase();
function luminance(h: string): number {
  const v = hex6(h);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

interface TextRule { selector: string; color: string; background: string | null; large: boolean }
/** Aturan paling dalam `selector { deklarasi }` (termasuk yang di dalam @media) dengan `color: #hex`. */
function textRules(css: string): TextRule[] {
  const out: TextRule[] = [];
  for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const color = body!.match(/(?<![-\w])color\s*:\s*(#[0-9a-f]{3,6})\b/i)?.[1];
    if (!color) continue;
    const background = body!.match(/background(?:-color)?\s*:\s*(#[0-9a-f]{3,6})\s*(?:;|!|$)/i)?.[1] ?? null;
    const px = Number(body!.match(/font(?:-size)?\s*:[^;]*?(\d+(?:\.\d+)?)px/)?.[1] ?? 0);
    const bold = /font-weight\s*:\s*(bold|[6-9]00)/.test(body!);
    // Selektor setelah pembungkus @media dan komentar dibuang; daftar dipisah koma dinilai per bagian.
    for (const s of sel!.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*$/, '').split(',').map((x) => x.trim()).filter(Boolean))
      out.push({ selector: s, color, background, large: px >= 24 || (bold && px >= 18.66) });
  }
  return out;
}

describe('index.css text colours meet WCAG 2.1 AA', () => {
  it('parses the stylesheet (sanity: the known primary and secondary text colours are found)', () => {
    const colors = new Set(textRules(CSS).map((r) => hex6(r.color)));
    expect(colors).toContain('#e6edf7');
    expect(colors).toContain('#8fa0bb');
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrast('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('every text colour reaches 4.5:1 (3:1 for large text) against its own solid background, or else against every app surface', () => {
    const failures: string[] = [];
    for (const r of textRules(CSS)) {
      if (EXEMPT.some((re) => re.test(r.selector))) continue;
      const min = r.large ? 3 : 4.5;
      const against = r.background ? [r.background] : SURFACES;
      for (const bg of against) {
        const c = contrast(r.color, bg);
        if (c < min) failures.push(`${r.selector}: ${r.color} on ${bg} = ${c.toFixed(2)}:1 (< ${min})`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('placeholders are readable text too (inputs sit on #152036)', () => {
    const placeholders = textRules(CSS).filter((r) => /::placeholder/.test(r.selector));
    expect(placeholders.length).toBeGreaterThan(0);
    for (const r of placeholders) expect(contrast(r.color, '#152036'), r.selector).toBeGreaterThanOrEqual(4.5);
  });
});
