// panels/trade.ts — panel Trade: connect wallet, faucet, approve, deposit/redeem, buy/close/claim; setiap aksi simulate → write → log.
// Pool dipilih dari `POOL_KEYS`; aset (saldo, allowance, approve, faucet) mengikuti `POOLS[k].asset` — A/B MockUSDG (faucet = mint), C USDG Paxos (faucet eksternal).
import { formatUnits, parseUnits, type Address } from 'viem';
import { el, setText } from '../ui/dom';
import { shortAddr, shortHash, usdg, usdg6, wad } from '../ui/format';
import { ALL_SERIES, PAXOS_FAUCET, POOLS, POOL_KEYS, explorerAddress, explorerTx, type PoolKey } from '../deployment';
import { chain, client } from '../chain/client';
import { equinoxPoolAbi } from '../abi/equinoxPool';
import { TxFailed, connect, decodeRevert, ensureChain, executedBuy, executedClose, hasWallet, onWalletEvents, write } from '../chain/wallet';
import {
  ALLOWANCE_MIN, FAUCET_AMOUNT, MIN_SIZE, approveCall, assetLabel, buyCall, claimCall, closeCall, depositCall, faucetCall, maxPremium, minProceeds, redeemCall, scaleFee,
  seriesLabel, type TradeCall,
} from '../chain/trade';
import type { Panel } from './types';
import type { Snapshot } from '../chain/snapshot';

export interface TradePanel extends Panel {
  /** Dipanggil setelah connect/accountsChanged (null = wallet terputus); main.ts menyimpan akun dan me-refresh snapshot. */
  onConnected: (a: Address | null) => void;
  /** Dipanggil setelah setiap aksi selesai (berhasil atau gagal) agar snapshot dengan akun dibaca ulang segera. */
  onChange: () => void;
}
export const ETH_FAUCET = 'https://faucet.quicknode.com/arbitrum/sepolia';
const MAX_LOG = 50;
const DEBOUNCE_MS = 250;

/** Parse desimal pengguna → bigint dengan `decimals`; null bila kosong/invalid/≤ 0. */
function parse(v: string, decimals: number): bigint | null {
  const t = v.trim();
  if (t === '') return null;
  try { const x = parseUnits(t, decimals); return x > 0n ? x : null; } catch { return null; }
}
const opt = (value: string, text: string, selected = false) => { const o = el('option', { value, text }); o.selected = selected; return o; };

export function createTrade(): TradePanel {
  let account: Address | null = null;
  let wrongChain = false;
  let pool: PoolKey = 'B';
  let last: Snapshot | null = null;
  let busy = false;
  const hooks = { onConnected: (_a: Address | null) => {}, onChange: () => {} };

  // --- wallet ---
  const connectBtn = el('button', { type: 'button', class: 'primary', text: 'Connect wallet' });
  const who = el('a', { class: 'who mono', target: '_blank', rel: 'noopener', text: '' });
  const summary = el('dl', { class: 'kv' });
  const noWallet = el('p', { class: 'muted small' },
    'No injected wallet found — the panel is read-only. Install MetaMask, add Arbitrum Sepolia (chain 421614) and fund it with Sepolia ETH from the ',
    el('a', { href: ETH_FAUCET, target: '_blank', rel: 'noopener', text: 'QuickNode faucet ↗' }),
    ', then reload. USDG on pools A and B is a mock token minted from the faucet button below (no real value); Pool C settles in real Paxos USDG (testnet) — ',
    el('a', { href: PAXOS_FAUCET, target: '_blank', rel: 'noopener', text: 'faucet.paxos.com ↗' }), ' gives 100 USDG per wallet per day.');
  const gasNote = el('p', { class: 'muted small' }, 'Gas is Sepolia ETH (', el('a', { href: ETH_FAUCET, target: '_blank', rel: 'noopener', text: 'faucet ↗' }),
    '); every action is simulated first (eth_call) so a revert is decoded here before the wallet opens. Buy/close previews are indicative (view quotes at the last observed ',
    'Chainlink round); execution observes the newest round first, so the 1 % slippage caps (max premium + fee, min proceeds) come from a simulation of the executed path. ',
    'Pools A and B settle in mock USDG (faucet button); Pool C settles in real Paxos USDG — no mint here, get 100 USDG/day at ',
    el('a', { href: PAXOS_FAUCET, target: '_blank', rel: 'noopener', text: 'faucet.paxos.com ↗' }), '.');

  // --- form ---
  const radios = POOL_KEYS.map((k) => el('input', { type: 'radio', name: 'pool', value: k, checked: k === pool }));
  const poolLabel = el('span', { class: 'muted small', text: POOLS[pool].label });
  // Faucet per jenis aset pool: MockUSDG → tombol mint; USDG Paxos → tautan faucet.paxos.com (100/hari, tanpa mint terbuka). Judul label ikut aset.
  const faucetHead = el('span', { text: 'Faucet' });
  const faucetBtn = el('button', { type: 'button', text: `Faucet ${usdg(FAUCET_AMOUNT, 0)} USDG` });
  const faucetLink = el('a', { class: 'link hidden', href: PAXOS_FAUCET, target: '_blank', rel: 'noopener', text: 'Get 100 USDG/day at faucet.paxos.com ↗' });
  const approveBtn = el('button', { type: 'button', text: 'Approve USDG' });
  const approveNote = el('span', { class: 'muted small', text: 'USDG allowance for this pool is below 1,000,000 — approve once (MAX).' });
  const approveBox = el('label', { class: 'hidden' }, 'Allowance', approveNote, approveBtn);
  const depositIn = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'USDG, e.g. 100' });
  const depositPrev = el('span', { class: 'mono small', text: '' });
  const depositBtn = el('button', { type: 'button', class: 'primary', text: 'Deposit' });
  const redeemIn = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'shares, e.g. 100' });
  const redeemMax = el('button', { type: 'button', text: 'max' });
  const redeemPrev = el('span', { class: 'mono small', text: '' });
  const redeemBtn = el('button', { type: 'button', class: 'primary', text: 'Redeem' });
  const buySel = el('select');
  const buyIn = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'units, e.g. 0.1', value: '0.1' });
  const buyPrev = el('span', { class: 'mono small', text: '' });
  const buyBtn = el('button', { type: 'button', class: 'primary', text: 'Buy' });
  const closeSel = el('select');
  const closeIn = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'units ≤ position' });
  const closePrev = el('span', { class: 'mono small', text: '' });
  const closeBtn = el('button', { type: 'button', class: 'primary', text: 'Close' });
  const claimSel = el('select');
  const claimPrev = el('span', { class: 'mono small', text: '' });
  const claimBtn = el('button', { type: 'button', class: 'primary', text: 'Claim' });
  const log = el('div', { class: 'txlog' }, el('span', { class: 'muted', text: 'No transactions yet.' }));
  const form = el('form', { class: 'trade' },
    el('label', {}, 'Pool', el('span', {}, ...radios.flatMap((r, i) => [r, ` ${POOL_KEYS[i]} `])), poolLabel),
    el('label', {}, faucetHead, faucetBtn, faucetLink),
    approveBox,
    el('label', {}, 'Deposit (USDG → LP shares)', depositIn, depositPrev, depositBtn),
    el('label', {}, 'Redeem (shares → USDG)', el('span', { class: 'row' }, redeemIn, redeemMax), redeemPrev, redeemBtn),
    el('label', {}, 'Buy (open series)', buySel, buyIn, buyPrev, buyBtn),
    el('label', {}, 'Close (your positions)', closeSel, closeIn, closePrev, closeBtn),
    el('label', {}, 'Claim (settled series)', claimSel, claimPrev, claimBtn),
  );
  form.addEventListener('submit', (e) => e.preventDefault());
  const root = el('section', {}, el('h2', { text: 'Trade — from your wallet (Arbitrum Sepolia)' }),
    el('div', { class: 'header-right' }, connectBtn, who), summary, hasWallet() ? gasNote : noWallet, form, log);

  // --- helpers ---
  const poolCallOf = (k: PoolKey) => ({ address: POOLS[k].pool, abi: equinoxPoolAbi } as const);
  const poolCall = () => poolCallOf(pool);
  const user = () => (last && account && last.user && last.user.address.toLowerCase() === account.toLowerCase() ? last.user : null);
  const openRows = () => (last ? last.series.map((r, i) => ({ r, i })).filter(({ r }) => !r[pool].settled && r.ref.expiry > last!.blockTime + 60) : []);
  const heldRows = (settled: boolean) => {
    const u = user(); if (!last || !u) return [];
    return last.series.map((r, i) => ({ r, i, pos: u.positions[pool][i] ?? 0n })).filter(({ r, pos }) => pos > 0n && r[pool].settled === settled);
  };
  // Opsi placeholder bernilai '' (Number('') === 0 — jangan sampai terbaca sebagai seri indeks 0).
  const selected = (sel: HTMLSelectElement) => { if (sel.value === '') return null; const i = Number(sel.value); return Number.isInteger(i) && ALL_SERIES[i] ? i : null; };
  function fill(sel: HTMLSelectElement, rows: { i: number; text: string }[], empty: string) {
    // Bangun ulang hanya bila daftar opsi berubah (snapshot tiap 15 s; replaceChildren menutup dropdown yang sedang dibuka).
    const next = rows.length ? rows.map(({ i, text }) => `${i}|${text}`) : [`|${empty}`];
    const cur = Array.from(sel.options, (o) => `${o.value}|${o.text}`);
    if (next.length === cur.length && next.every((x, j) => x === cur[j])) return;
    const prev = sel.value;
    sel.replaceChildren(...(rows.length ? rows.map(({ i, text }) => opt(String(i), text, String(i) === prev)) : [opt('', empty)]));
    if (rows.length && !rows.some(({ i }) => String(i) === prev)) sel.selectedIndex = 0;
  }
  /** `✓ what — tx 0x… ↗` bila sukses; `✗ what — pesan` bila gagal, ditambah tautan explorer bila tx-nya sempat terkirim (status 0 / timeout). */
  function logLine(ok: boolean, what: string, tail: string, hash?: `0x${string}`) {
    if (log.firstElementChild?.classList.contains('muted')) log.replaceChildren();
    const link = hash ? el('a', { href: explorerTx(hash), target: '_blank', rel: 'noopener', text: `tx ${shortHash(hash)} ↗` }) : null;
    const line = el('div', { class: ok ? 'ok' : 'bad' }, `${ok ? '✓' : '✗'} ${what} — `, tail ? el('span', { class: 'muted', text: tail }) : null, tail && link ? ' ' : null, link);
    log.prepend(line);
    while (log.childElementCount > MAX_LOG) log.lastElementChild?.remove();
  }
  /** Satu aksi: `acct`/`k` ditangkap pemanggil saat klik (bukan dibaca ulang setelah await) → bangun call (boleh membaca quote segar) →
   *  write (simulate → wallet → receipt) → log → onChange. Tx yang terkirim tapi gagal/timeout tetap dicatat dengan tautannya. */
  async function run(what: string, acct: Address, k: PoolKey, build: (k: PoolKey, acct: Address) => Promise<TradeCall> | TradeCall) {
    if (busy) return;
    busy = true; paintEnabled();
    try { const hash = await write(await build(k, acct), acct); logLine(true, what, '', hash); }
    catch (e) {
      let msg = decodeRevert(e);
      // Pool ber-aset faucet (C, ≈ 90 USDG): cap cadangan 80 % × kapital (≈ 72 USDG) sudah tercapai oleh K × 0,03 unit — arahkan ke ukuran kecil atau A/B.
      if (POOLS[k].faucet === 'paxos' && /^(Reserve cap|Vega cap)/.test(msg)) msg += ' Pool C is a faucet-scale pool — try 0.01 units or use A/B.';
      logLine(false, what, msg, e instanceof TxFailed ? e.hash : undefined);
    }
    finally { busy = false; paintEnabled(); hooks.onChange(); }
  }

  // --- pratinjau (debounce + penjaga urutan agar balasan lama tidak menimpa yang baru) ---
  const seq = { deposit: 0, redeem: 0, buy: 0, close: 0 };
  const timers: Partial<Record<keyof typeof seq, ReturnType<typeof setTimeout>>> = {};
  const debounce = (k: keyof typeof seq, fn: () => void) => { clearTimeout(timers[k]); timers[k] = setTimeout(fn, DEBOUNCE_MS); };
  async function previewDeposit() {
    const n = ++seq.deposit, assets = parse(depositIn.value, 6);
    if (!assets) return setText(depositPrev, '');
    try { const sh = await client.readContract({ ...poolCall(), functionName: 'previewDeposit', args: [assets] }); if (n === seq.deposit) setText(depositPrev, `→ ${usdg6(sh)} shares`); }
    catch (e) { if (n === seq.deposit) setText(depositPrev, decodeRevert(e)); }
  }
  async function previewRedeem() {
    const n = ++seq.redeem, shares = parse(redeemIn.value, 6);
    if (!shares) return setText(redeemPrev, '');
    try { const a = await client.readContract({ ...poolCall(), functionName: 'previewRedeem', args: [shares] }); if (n === seq.redeem) setText(redeemPrev, `→ ${usdg6(a)} USDG`); }
    catch (e) { if (n === seq.redeem) setText(redeemPrev, decodeRevert(e)); }
  }
  // Kuotasi view = indikatif (round terakhir yang diobservasi engine); nilai eksekusi (post-poke) ditampilkan bila ada akun dan simulasinya lolos —
  // simulasi yang gagal (belum approve/tanpa USDG) tidak menutupi kuotasi indikatif.
  async function previewBuy() {
    const n = ++seq.buy, i = selected(buySel), size = parse(buyIn.value, 18), k = pool, acct = account;
    if (i === null || !size) return setText(buyPrev, '');
    if (size < MIN_SIZE) return setText(buyPrev, 'minimum size is 0.01 units');
    const id = ALL_SERIES[i]!.id[k];
    try {
      const [q, exec] = await Promise.all([
        client.readContract({ ...poolCallOf(k), functionName: 'quoteBuy', args: [id, size] }),
        acct ? executedBuy(k, id, size, acct).catch(() => null) : Promise.resolve(null),
      ]);
      if (n !== seq.buy) return;
      const fee = exec === null ? null : scaleFee(q.feeAssets, q.premiumAssets, exec);
      setText(buyPrev, `premium ${usdg6(q.premiumAssets)} + fee ${usdg6(q.feeAssets)} = ${usdg6(q.premiumAssets + q.feeAssets)} USDG (indicative) · σ ${wad(q.sigma, 3)} · Δ ${wad(q.delta, 2)}`
        + (exec === null || fee === null ? '' : ` · executed ≈ ${usdg6(exec + fee)} USDG (max ${usdg6(maxPremium(exec, fee))})`));
    } catch (e) { if (n === seq.buy) setText(buyPrev, decodeRevert(e)); }
  }
  async function previewClose() {
    const n = ++seq.close, i = selected(closeSel), size = parse(closeIn.value, 18), k = pool, acct = account;
    if (i === null || !size) return setText(closePrev, '');
    const pos = user()?.positions[k][i] ?? 0n;
    if (size > pos) return setText(closePrev, `size exceeds position (${wad(pos, 2)})`);
    const id = ALL_SERIES[i]!.id[k];
    try {
      const [[proceeds, sigma], exec] = await Promise.all([
        client.readContract({ ...poolCallOf(k), functionName: 'quoteClose', args: [id, size] }),
        acct ? executedClose(k, id, size, acct).catch(() => null) : Promise.resolve(null),
      ]);
      if (n !== seq.close) return;
      setText(closePrev, `proceeds ${usdg6(proceeds)} USDG (indicative) · σ_close ${wad(sigma, 3)}`
        + (exec === null ? '' : ` · executed ≈ ${usdg6(exec)} USDG (min ${usdg6(minProceeds(exec))})`));
    } catch (e) { if (n === seq.close) setText(closePrev, decodeRevert(e)); }
  }
  function previewClaim() {
    const i = selected(claimSel), u = user();
    if (i === null || !u || !last) return setText(claimPrev, '');
    const pos = u.positions[pool][i] ?? 0n, ppu = last.series[i]![pool].payoutPerUnit;
    // payoutPerUnit WAD per unit × posisi WAD → aset 6 dp: ÷ 1e18 (unit) ÷ 1e12 (assetScale).
    setText(claimPrev, `${wad(pos, 2)} units × ${usdg6(ppu / 10n ** 12n)} = ${usdg6((pos * ppu) / 10n ** 18n / 10n ** 12n)} USDG`);
  }
  const previews = () => { void previewDeposit(); void previewRedeem(); void previewBuy(); void previewClose(); previewClaim(); };

  // --- render ---
  function paintSnapshot() {
    const u = user();
    fill(buySel, openRows().map(({ r, i }) => ({ i, text: seriesLabel(r.ref) })), 'no open series');
    fill(closeSel, heldRows(false).map(({ r, i, pos }) => ({ i, text: `${seriesLabel(r.ref)} — ${wad(pos, 2)} units` })), account ? 'no open positions' : 'connect wallet to see positions');
    fill(claimSel, heldRows(true).map(({ r, i, pos }) => ({ i, text: `${seriesLabel(r.ref)} — ${wad(pos, 2)} units` })), account ? 'nothing to claim' : 'connect wallet to see positions');
    approveBox.classList.toggle('hidden', !u || u.allowance[pool] >= ALLOWANCE_MIN);
    setText(approveBtn, `Approve ${assetLabel(pool)} for pool ${pool}`);
    setText(approveNote, `${assetLabel(pool)} allowance for pool ${pool} is below 1,000,000 — approve once (MAX).`);
    setText(poolLabel, POOLS[pool].label);
    const mint = POOLS[pool].faucet === 'mint';
    setText(faucetHead, mint ? 'Faucet (MockUSDG, open mint)' : `Faucet — ${assetLabel(pool)}, 100 USDG per wallet per day`);
    faucetBtn.classList.toggle('hidden', !mint); faucetLink.classList.toggle('hidden', mint);
    if (!account) { summary.replaceChildren(); return; }
    const positions = (k: PoolKey) => { const xs = u ? ALL_SERIES.flatMap((s, i) => ((u.positions[k][i] ?? 0n) > 0n ? [`${wad(u.positions[k][i]!, 2)} ${seriesLabel(s)}`] : [])) : []; return xs.length ? xs.join(', ') : '—'; };
    // Ringkasan per pool dari POOL_KEYS: saldo aset pool itu (A/B sama-sama MockUSDG, C USDG Paxos), share LP, allowance, posisi.
    const rows: [string, string][] = u
      ? [...POOL_KEYS.map((k): [string, string] => [`Asset balance ${k}`, `${usdg(u.asset[k])} ${assetLabel(k)}`]),
        [`LP shares ${POOL_KEYS.join(' | ')}`, POOL_KEYS.map((k) => usdg6(u.shares[k])).join(' | ')],
        [`Allowance ${POOL_KEYS.join(' | ')}`, POOL_KEYS.map((k) => (u.allowance[k] >= ALLOWANCE_MIN ? 'approved' : 'not approved')).join(' | ')],
        ...POOL_KEYS.map((k): [string, string] => [`Positions ${k}`, positions(k)])]
      : [['Account', wrongChain ? 'wrong network — switch to Arbitrum Sepolia' : 'loading…']];
    summary.replaceChildren(...rows.flatMap(([a, b]) => [el('dt', { text: a }), el('dd', { text: b })]));
  }
  function paintEnabled() {
    const can = hasWallet() && account !== null && !wrongChain && !busy;
    for (const b of [faucetBtn, approveBtn, depositBtn, redeemBtn, buyBtn, closeBtn, claimBtn]) b.disabled = !can;
    // Tombol faucet hanya hidup pada pool ber-mint terbuka (tombol tersembunyi tetap kontrol label-nya — dinonaktifkan agar klik pada teks label tidak memicunya).
    faucetBtn.disabled = !can || POOLS[pool].faucet !== 'mint';
    for (const r of radios) r.disabled = busy;
    redeemMax.disabled = !user();
    connectBtn.classList.toggle('hidden', !hasWallet() || (account !== null && !wrongChain));
    setText(connectBtn, wrongChain ? 'Switch to Arbitrum Sepolia' : 'Connect wallet');
    connectBtn.disabled = busy;
    who.classList.toggle('hidden', !account);
    if (account) { setText(who, `${shortAddr(account)}${wrongChain ? ' (wrong network)' : ''}`); who.setAttribute('href', explorerAddress(account)); }
  }
  function render(s: Snapshot | null) {
    if (s !== last) { last = s; paintSnapshot(); previews(); }
    paintEnabled();
  }
  const setAccount = (a: Address | null) => { if (a === account) return; account = a; paintSnapshot(); paintEnabled(); hooks.onConnected(a); };

  // --- events ---
  connectBtn.addEventListener('click', async () => {
    busy = true; paintEnabled();
    try {
      // Sudah connect tapi salah jaringan → cukup pindah chain; selain itu requestAddresses + ensureChain.
      const a = wrongChain && account ? (await ensureChain(), account) : await connect();
      wrongChain = false; busy = false;
      if (a !== account) setAccount(a); else { paintSnapshot(); hooks.onChange(); }
    } catch (e) { busy = false; logLine(false, 'connect', decodeRevert(e)); }
    finally { busy = false; paintEnabled(); }
  });
  onWalletEvents({
    accounts: (a) => setAccount(a[0] ?? null),
    chain: (id) => { wrongChain = id !== chain.id; paintSnapshot(); paintEnabled(); if (!wrongChain) hooks.onChange(); },
  });
  // Ganti pool → repaint snapshot DAN status tombol (faucet hanya hidup pada pool ber-mint) sebelum tick render berikutnya.
  radios.forEach((r) => r.addEventListener('change', () => { if (r.checked) { pool = r.value as PoolKey; paintSnapshot(); paintEnabled(); previews(); } }));
  depositIn.addEventListener('input', () => debounce('deposit', () => void previewDeposit()));
  redeemIn.addEventListener('input', () => debounce('redeem', () => void previewRedeem()));
  redeemMax.addEventListener('click', () => { const u = user(); if (u) { redeemIn.value = formatUnits(u.shares[pool], 6); void previewRedeem(); } });
  buySel.addEventListener('change', () => void previewBuy());
  buyIn.addEventListener('input', () => debounce('buy', () => void previewBuy()));
  closeSel.addEventListener('change', () => void previewClose());
  closeIn.addEventListener('input', () => debounce('close', () => void previewClose()));
  claimSel.addEventListener('change', previewClaim);

  // Setiap handler menangkap pool dan akun SAAT KLIK (k, acct) sebelum await apa pun; penjaga ukuran dijalankan sebelum RPC mana pun.
  faucetBtn.addEventListener('click', () => {
    const k = pool, acct = account; if (!acct || POOLS[k].faucet !== 'mint') return;
    void run(`faucet ${usdg(FAUCET_AMOUNT, 0)} USDG (mock)`, acct, k, (kk, a) => faucetCall(kk, a));
  });
  approveBtn.addEventListener('click', () => {
    const k = pool, acct = account; if (!acct) return;
    void run(`approve ${assetLabel(k)} for ${k}`, acct, k, (kk) => approveCall(kk));
  });
  depositBtn.addEventListener('click', () => {
    const k = pool, acct = account; if (!acct) return;
    const assets = parse(depositIn.value, 6); if (!assets) return setText(depositPrev, 'enter a USDG amount');
    void run(`deposit ${usdg(assets)} USDG into ${k}`, acct, k, (kk, a) => depositCall(kk, assets, a));
  });
  redeemBtn.addEventListener('click', () => {
    const k = pool, acct = account; if (!acct) return;
    const shares = parse(redeemIn.value, 6); if (!shares) return setText(redeemPrev, 'enter a share amount');
    void run(`redeem ${usdg6(shares)} shares from ${k}`, acct, k, (kk, a) => redeemCall(kk, shares, a));
  });
  buyBtn.addEventListener('click', () => {
    const k = pool, acct = account; if (!acct) return;
    const i = selected(buySel), size = parse(buyIn.value, 18);
    if (i === null || !size) return setText(buyPrev, 'pick a series and a size');
    const ref = ALL_SERIES[i]!, what = `buy ${wad(size, size < MIN_SIZE ? 4 : 2)} ${seriesLabel(ref)} on ${k}`;
    if (size < MIN_SIZE) return logLine(false, what, 'Minimum size is 0.01 units.');
    // Batas dari JALUR EKSEKUSI tepat sebelum tulis: premi = simulasi `buy(id, size, MAX_UINT)` (post-poke, round Chainlink terbaru), fee diskalakan
    // dari rasio kuotasi view; maxPremium = (premi + fee) × 1,01. Kuotasi view saja bisa gagal SlippageExceeded bila engine lama tidak di-poke (I-1).
    void run(what, acct, k, async (kk, a) => {
      const q = await client.readContract({ ...poolCallOf(kk), functionName: 'quoteBuy', args: [ref.id[kk], size] });
      const premExec = await executedBuy(kk, ref.id[kk], size, a);
      return buyCall(kk, ref.id[kk], size, premExec, scaleFee(q.feeAssets, q.premiumAssets, premExec));
    });
  });
  closeBtn.addEventListener('click', () => {
    const k = pool, acct = account; if (!acct) return;
    const i = selected(closeSel), size = parse(closeIn.value, 18);
    if (i === null || !size) return setText(closePrev, 'pick a position and a size');
    const ref = ALL_SERIES[i]!, what = `close ${wad(size, 2)} ${seriesLabel(ref)} on ${k}`;
    const pos = user()?.positions[k][i] ?? 0n;
    if (size > pos) return logLine(false, what, `size exceeds your position (${wad(pos, 2)} units)`);
    // minProceeds = proceeds eksekusi (simulasi `close(id, size, 0)`, post-poke) × 0,99 — bukan dari `quoteClose` (I-1).
    void run(what, acct, k, async (kk, a) => closeCall(kk, ref.id[kk], size, await executedClose(kk, ref.id[kk], size, a)));
  });
  claimBtn.addEventListener('click', () => {
    const k = pool, acct = account; if (!acct) return;
    const i = selected(claimSel), pos = i === null ? 0n : (user()?.positions[k][i] ?? 0n);
    if (i === null || pos === 0n) return setText(claimPrev, 'nothing to claim');
    const ref = ALL_SERIES[i]!;
    void run(`claim ${wad(pos, 2)} ${seriesLabel(ref)} on ${k}`, acct, k, (kk) => claimCall(kk, ref.id[kk], pos));
  });

  paintSnapshot(); paintEnabled();
  return {
    root, render,
    get onConnected() { return hooks.onConnected; }, set onConnected(f) { hooks.onConnected = f; },
    get onChange() { return hooks.onChange; }, set onChange(f) { hooks.onChange = f; },
  };
}
