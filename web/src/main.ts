import './styles.css';
import { client } from './chain/client';
import { readSnapshot, type Snapshot } from './chain/snapshot';
import { readParity } from './chain/parity';
import { readGas } from './chain/gas';
import { el, mount } from './ui/dom';
import { startPolling } from './ui/poll';
import { createHeader } from './panels/header';
import { createNav } from './panels/nav';
import { createBoard } from './panels/board';
import { createFooter } from './panels/footer';
import type { Meta, Panel } from './panels/types';

const app = document.querySelector<HTMLDivElement>('#app')!;
const banner = el('div', { class: 'banner hidden', role: 'status' });
const board = createBoard();
const panels: Panel[] = [createHeader(), createNav(), board, createFooter()];
mount(app, banner, ...panels.map((p) => p.root));

let snapshot: Snapshot | null = null;
const meta: Meta = { nowMs: Date.now(), lastOkMs: null, error: null };
function paint() {
  meta.nowMs = Date.now();
  for (const p of panels) p.render(snapshot, meta);
  const show = meta.error !== null && snapshot !== null;
  banner.classList.toggle('hidden', !show);
  if (show) banner.textContent = `RPC unreachable — showing data fetched ${new Date(meta.lastOkMs ?? 0).toISOString().slice(11, 19)} UTC`;
}
startPolling(async () => {
  const s = await readSnapshot(client);
  snapshot = s; meta.lastOkMs = Date.now(); meta.error = null; paint();
  // Paritas K5 dan estimasi gas menyusul setelah snapshot; kegagalannya tidak menggagalkan refresh.
  try { board.setParity(await readParity(client, s)); } catch (e) { console.warn('parity:', e); }
  try { board.setGas(await readGas(client, s)); } catch (e) { console.warn('gas:', e); }
}, (e) => { meta.error = e instanceof Error ? e.message : String(e); paint(); });
setInterval(paint, 1000);
