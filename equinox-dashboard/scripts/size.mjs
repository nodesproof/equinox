// scripts/size.mjs — gagal bila total JS gzip > 250 KB (brief §8.4)
import { gzipSync } from 'node:zlib'; import { readdirSync, readFileSync } from 'node:fs'; import path from 'node:path';
const dir = path.resolve(import.meta.dirname, '..', 'dist', 'assets'); let raw = 0, gz = 0;
for (const f of readdirSync(dir)) if (f.endsWith('.js')) { const b = readFileSync(path.join(dir, f)); raw += b.length; gz += gzipSync(b).length; }
console.log(`js: ${(raw / 1024).toFixed(0)} KB raw · ${(gz / 1024).toFixed(0)} KB gzip (budget 250 KB)`);
if (gz > 250 * 1024) { console.error('bundle over budget'); process.exit(1); }
