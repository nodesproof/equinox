// scripts/seed-events.ts — tulis public/events-seed.json: semua event pool + Observed dari DEPLOYED_AT_BLOCK sampai blok saat ini.
// Dijalankan `npm run seed` (vite-node) sebelum `vite build`; memakai client dan readEvents yang sama dengan halaman agar logika pindai tidak bercabang.
// Gagal apa pun → keluar non-nol tanpa menulis (tidak ada lastBlock optimistis); halaman lalu memindai penuh sendiri.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { client } from '../src/chain/client';
import { readEvents, serializeSeed } from '../src/chain/events';
import { DEPLOYED_AT_BLOCK } from '../src/deployment';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'events-seed.json');
try {
  const lastBlock = await client.getBlockNumber();
  const { trades, observed } = await readEvents(client, lastBlock, DEPLOYED_AT_BLOCK);
  const json = serializeSeed({ lastBlock, generatedAt: new Date().toISOString(), trades, observed });
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, json);
  console.log(`seed: ${out}\n  lastBlock ${lastBlock} (${lastBlock - DEPLOYED_AT_BLOCK + 1n} blocks since deploy) · ${trades.length} trades · ${observed.length} observed · ${Buffer.byteLength(json)} bytes`);
} catch (e) {
  console.error('seed failed — nothing written:', e instanceof Error ? e.message : e);
  process.exit(1);
}
