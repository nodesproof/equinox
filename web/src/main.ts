import './styles.css';
import type { Address } from 'viem';
import { client } from './chain/client';
import { DEPLOYED_AT_BLOCK } from './deployment';
import { readSnapshot, type Snapshot } from './chain/snapshot';
import { readParity } from './chain/parity';
import { readGas } from './chain/gas';
import { loadSeed, mergeEvents, readEvents, type Events } from './chain/events';
import { el, mount } from './ui/dom';
import { startPolling } from './ui/poll';
import { createHeader } from './panels/header';
import { createNav } from './panels/nav';
import { createBoard } from './panels/board';
import { createActivity } from './panels/activity';
import { createTrade } from './panels/trade';
import { createFooter } from './panels/footer';
import type { Meta, Panel } from './panels/types';

const app = document.querySelector<HTMLDivElement>('#app')!;
const banner = el('div', { class: 'banner hidden', role: 'status' });
const board = createBoard();
const trade = createTrade();
const activity = createActivity();
const panels: Panel[] = [createHeader(), createNav(), board, trade, activity, createFooter()];
mount(app, banner, ...panels.map((p) => p.root));

let snapshot: Snapshot | null = null;
/** Akun wallet yang terhubung (null = tanpa wallet); snapshot dibaca dengan akun ini agar `s.user` terisi. */
let account: Address | null = null;
const meta: Meta = { nowMs: Date.now(), lastOkMs: null, error: null };
function paint() {
  meta.nowMs = Date.now();
  for (const p of panels) p.render(snapshot, meta);
  const show = meta.error !== null && snapshot !== null;
  banner.classList.toggle('hidden', !show);
  if (show) banner.textContent = `RPC unreachable — showing data fetched ${new Date(meta.lastOkMs ?? 0).toISOString().slice(11, 19)} UTC`;
}

// Event dibaca pada snapshot pertama yang berhasil, lalu tiap EVENTS_EVERY refresh (≈ 60 s pada interval 15 s), inkremental dari
// `lastEventsBlock + 1` sampai blok snapshot dan digabung (dedupe per tx+logIndex). Gagal → lastEventsBlock tidak maju, dicoba lagi.
const EVENTS_EVERY = 4;
let events: Events = { trades: [], observed: [] };
let lastEventsBlock: bigint | null = null;
let refreshes = 0;
setInterval(paint, 1000);
// Seed hasil build (public/events-seed.json, `npm run seed`): umpan tampil seketika dan pemindaian pertama hanya dari lastBlock + 1,
// bukan dari blok deploy. Tanpa seed (404/rusak) perilaku persis pemindaian penuh; placeholder "loading events…" panel menutup jendela fetch ini.
try {
  const seed = await loadSeed();
  if (seed) { events = { trades: seed.trades, observed: seed.observed }; lastEventsBlock = seed.lastBlock; activity.setEvents(events); }
} catch (e) { console.warn('seed:', e); }
async function refresh() {
  const s = await readSnapshot(client, account ?? undefined);
  snapshot = s; meta.lastOkMs = Date.now(); meta.error = null; paint();
  // Paritas K5 dan estimasi gas menyusul setelah snapshot; kegagalannya tidak menggagalkan refresh.
  try { board.setParity(await readParity(client, s)); } catch (e) { console.warn('parity:', e); }
  try { board.setGas(await readGas(client, s)); } catch (e) { console.warn('gas:', e); }
  const n = refreshes++;
  if (lastEventsBlock === null || n % EVENTS_EVERY === 0) {
    try {
      const from = lastEventsBlock === null ? DEPLOYED_AT_BLOCK : lastEventsBlock + 1n;
      events = mergeEvents(events, await readEvents(client, s.blockNumber, from));
      lastEventsBlock = s.blockNumber;
      activity.setEvents(events);
    } catch (e) { console.warn('events:', e); }
  }
}
const onError = (e: unknown) => { meta.error = e instanceof Error ? e.message : String(e); paint(); };
// Satu refresh pada satu waktu: poll dan refreshNow berbagi promise yang sedang berjalan.
let running: Promise<void> | null = null;
const refreshOnce = () => running ?? (running = refresh().finally(() => { running = null; }));
/** Refresh segera (connect / setelah aksi): bila ada yang sedang berjalan, jalankan lagi sesudahnya agar akun & saldo terbaru terbaca. */
function refreshNow() { (running ? running.then(refreshOnce, refreshOnce) : refreshOnce()).catch(onError); }
trade.onConnected = (a) => { account = a; refreshNow(); };
trade.onChange = refreshNow;
startPolling(refreshOnce, onError);
