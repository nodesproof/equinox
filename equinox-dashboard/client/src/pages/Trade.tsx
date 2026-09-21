// Trade.tsx — halaman Trade HIDUP: port tata letak, guard dan kalimat panel klasik `web/src/panels/trade.ts` di atas useTrade()/useWallet()/
// useSeriesRows(). Pool switch (aset per pool), status akun (connect / switch / read-only), faucet mint (A/B) atau tautan Paxos (C), approve bila
// allowance < ALLOWANCE_MIN, deposit/redeem (+ preview), buy (seri open, preview indikatif + jalur eksekusi "executed ≈ … (max …)"), close
// (posisi, "(min …)"), claim (seri settled), log tx. Semua tombol aksi digerbangi `canAct` (wallet, akun, jaringan, busy) lalu guard useTrade.
// Prefill `#/trade?pool=B&series=3` saat mount dan setiap hashchange; keempat pratinjau diterbitkan ulang setiap snapshot baru (putusan Task 2).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { formatUnits, type Address } from 'viem';
import { ChevronDown, Droplets, ShieldCheck, Zap } from 'lucide-react';
import { CHAIN_ID, PAXOS_FAUCET, POOLS, type PoolKey } from '@chain/deployment';
import { usdg, usdg6, wad } from '@chain/ui/format';
import { assetLabel, seriesLabel } from '@chain/chain/trade';
import { useSnapshot } from '@/chain/useSnapshot';
import { useWallet } from '@/chain/useWallet';
import { parseAmount, useTrade } from '@/chain/useTrade';
import { useSeriesRows, type UserView } from '@/chain/selectors';
import { NETWORK_NAME, WalletButton } from '@/components/Layout';
import { AmountInput } from '@/components/AmountInput';
import { PoolSwitch } from '@/components/PoolSwitch';
import { PreviewLine } from '@/components/PreviewLine';
import { TxLog } from '@/components/TxLog';
import { SectionHeading, StatusPill } from '@/components/primitives';
import { DEFAULT_TRADE_POOL } from '@/lib/boards';
import { queryPool, querySeries, useHashQuery } from '@/lib/route';
import {
  ALLOWANCE_MIN_TEXT, ETH_FAUCET, FAUCET_LABEL, PAXOS_FAUCET_LABEL, SLIPPAGE_PCT, buyPreviewText, claimPreviewText, closePreviewText, depositPreviewText,
  heldOptions, listPools, mintPools, openSeriesOptions, paxosPools, pickOption, redeemPreviewText, type SelectOption,
} from '@/lib/trade';

type Form = 'faucet' | 'approve' | 'deposit' | 'redeem' | 'buy' | 'close' | 'claim';
interface Picks { buy: number | null; close: number | null; claim: number | null }

const ext = (href: string, text: string) => <a href={href} target="_blank" rel="noopener noreferrer">{text}</a>;

/** Paragraf `noWallet` / `gasNote` panel klasik (kalimat dipertahankan; daftar pool dari manifest, 1 % dari SLIPPAGE_BPS). */
export function TradeNote({ hasWallet }: { hasWallet: boolean }) {
  const mock = mintPools(), paxos = paxosPools();
  if (!hasWallet) {
    return (
      <p className="trade-note" data-testid="trade-note" data-kind="no-wallet">
        No injected wallet found — the panel is read-only. Install MetaMask, add {NETWORK_NAME} (chain {CHAIN_ID}) and fund it with Sepolia ETH from the {ext(ETH_FAUCET, 'QuickNode faucet ↗')}, then reload.
        {mock.length ? <> USDG on {mock.length > 1 ? 'pools' : 'pool'} {listPools(mock)} is a mock token minted from the faucet button below (no real value);</> : null}
        {paxos.length ? <> Pool {listPools(paxos)} settles in real Paxos USDG (testnet) — {ext(PAXOS_FAUCET, 'faucet.paxos.com ↗')} gives 100 USDG per wallet per day.</> : null}
      </p>
    );
  }
  return (
    <p className="trade-note" data-testid="trade-note" data-kind="gas">
      Gas is Sepolia ETH ({ext(ETH_FAUCET, 'faucet ↗')}); every action is simulated first (eth_call) so a revert is decoded here before the wallet opens.
      {' '}Buy/close previews are indicative (view quotes at the last observed Chainlink round); execution observes the newest round first, so the {SLIPPAGE_PCT} slippage caps (max premium + fee, min proceeds) come from a simulation of the executed path.
      {mock.length ? <> {mock.length > 1 ? 'Pools' : 'Pool'} {listPools(mock)} settle in mock USDG (faucet button);</> : null}
      {paxos.length ? <> Pool {listPools(paxos)} settles in real Paxos USDG — no mint here, get 100 USDG/day at {ext(PAXOS_FAUCET, 'faucet.paxos.com ↗')}.</> : null}
    </p>
  );
}

/** Select seri/posisi: opsi dari `SelectOption[]`; daftar kosong → satu opsi placeholder bernilai '' dan select dinonaktifkan (`fill()` klasik). */
function SeriesSelect({ id, label, options, value, onChange, empty, describedBy }: { id: string; label: string; options: SelectOption[]; value: number | null; onChange: (i: number | null) => void; empty: string; describedBy?: string }) {
  return (
    <div className="series-select">
      <label className="control-label" htmlFor={id}>{label}</label>
      <div className="select-like">
        <select id={id} value={value === null ? '' : String(value)} disabled={options.length === 0} aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
          {options.length ? options.map((o) => <option key={o.i} value={String(o.i)}>{o.text}</option>) : <option value="">{empty}</option>}
        </select>
        <ChevronDown size={15} aria-hidden="true" />
      </div>
    </div>
  );
}

/** Baris aksi: tombol + pesan guard inline (`role=status`) — guard useTrade tidak dicatat ke log, ditampilkan di dekat tombolnya. */
function Actions({ children, guard }: { children: ReactNode; guard?: string }) {
  return <div className="trade-field__actions">{children}<span className="form-guard" role="status">{guard ?? ''}</span></div>;
}

/** Ringkasan akun untuk pool terpilih (summary panel klasik, per pool): saldo aset, share LP, allowance, posisi; tanpa akun → CTA, tanpa angka. */
function WalletSummary({ k, user, account, hasWallet, wrongChain, emptyLabel }: { k: PoolKey; user: UserView | null; account: Address | null; hasWallet: boolean; wrongChain: boolean; emptyLabel: string }) {
  const symbol = POOLS[k].assetSymbol;
  let body: ReactNode;
  if (!hasWallet) body = <p className="panel-copy wallet-summary__note">No injected wallet — balances, positions and claims need a connected wallet (the boards and quotes stay readable).</p>;
  else if (!account) body = <p className="panel-copy wallet-summary__note">Connect a wallet to read its {assetLabel(k)} balance, LP shares, allowance and positions on Pool {k}.</p>;
  else if (!user) body = <p className="panel-copy wallet-summary__note">{wrongChain ? `Wrong network — switch to ${NETWORK_NAME} (chain ${CHAIN_ID}).` : `Reading your balances with the next snapshot — ${emptyLabel.toLowerCase()}.`}</p>;
  else {
    const u = user.user;
    const held = user.positions.filter((p) => p.k === k);
    body = (
      <dl className="wallet-summary">
        <div><dt>Asset balance</dt><dd>{usdg(u.asset[k])} {assetLabel(k)}</dd></div>
        <div><dt>LP shares</dt><dd>{usdg6(u.shares[k])}</dd></div>
        <div><dt>Allowance for pool {k}</dt><dd>{user.approved[k] ? 'approved' : 'not approved'}</dd></div>
        <div><dt>Positions</dt><dd>{held.length ? held.map((p) => `${wad(p.units, 2)} ${seriesLabel(p.ref)}`).join(', ') : '—'}</dd></div>
      </dl>
    );
  }
  return (
    <article className="panel wallet-panel" aria-label={`Your wallet on pool ${k}`}>
      <div className="panel-header">
        <div><div className="eyebrow">Your wallet</div><h3>On Pool {k} · {assetLabel(k)}</h3></div>
        <a className="soft-button" href="#/portfolio">Full portfolio</a>
      </div>
      {body}
      <div className="board-panel__foot"><span>{POOLS[k].faucet === 'paxos' ? `Pool ${k} settles in Paxos ${symbol} (testnet) — faucet scale, 100 ${symbol} per wallet per day.` : `Pool ${k} settles in mock ${symbol} — minted from the faucet button, no real value.`}</span></div>
    </article>
  );
}

export default function Trade() {
  const { snapshot, failed } = useSnapshot();
  const { account, wrongChain, hasWallet, busy, txLog, canAct } = useWallet();
  const { previews, preview, claimPreview, actions, user, needsApprove } = useTrade();
  const rows = useSeriesRows();
  const query = useHashQuery();
  const qPool = queryPool(query), qSeries = querySeries(query);

  const [pool, setPool] = useState<PoolKey>(() => qPool ?? DEFAULT_TRADE_POOL);
  const [picks, setPicks] = useState<Picks>(() => ({ buy: qSeries, close: qSeries, claim: qSeries }));
  const [fields, setFields] = useState({ deposit: '', redeem: '', buySize: '0.1', closeSize: '' });
  const [guards, setGuards] = useState<Partial<Record<Form, string>>>({});
  // Prefill dari kueri hash (tautan Trade di Boards/Portfolio) — saat mount dan setiap hashchange, tanpa remount.
  useEffect(() => {
    if (qPool) setPool(qPool);
    if (qSeries !== null) setPicks((p) => (p.buy === qSeries && p.close === qSeries && p.claim === qSeries ? p : { buy: qSeries, close: qSeries, claim: qSeries }));
  }, [qPool, qSeries]);

  const info = POOLS[pool], symbol = info.assetSymbol;
  const emptyLabel = failed ? 'RPC error — retrying' : 'Awaiting snapshot';
  const positions = user?.positions;
  const buyOptions = useMemo(() => openSeriesOptions(rows, pool), [rows, pool]);
  const closeOptions = useMemo(() => heldOptions(positions ?? [], pool, false), [positions, pool]);
  const claimOptions = useMemo(() => heldOptions(positions ?? [], pool, true), [positions, pool]);
  const buySel = pickOption(buyOptions, picks.buy), closeSel = pickOption(closeOptions, picks.close), claimSel = pickOption(claimOptions, picks.claim);
  const depositAmt = parseAmount(fields.deposit, 6), redeemAmt = parseAmount(fields.redeem, 6), buyAmt = parseAmount(fields.buySize, 18), closeAmt = parseAmount(fields.closeSize, 18);

  // Pratinjau (debounce 250 ms + penjaga urutan di useTrade). `snapshot`/`account` ikut kunci efek agar pratinjau diterbitkan ulang setiap poll
  // dan saat akun berganti — nilai yang tampil tidak pernah lebih tua dari satu snapshot (putusan pengendali Task 2).
  useEffect(() => { preview.deposit(pool, depositAmt); }, [preview, pool, depositAmt, snapshot]);
  useEffect(() => { preview.redeem(pool, redeemAmt); }, [preview, pool, redeemAmt, snapshot]);
  useEffect(() => { preview.buy(pool, buySel, buyAmt); }, [preview, pool, buySel, buyAmt, snapshot, account]);
  useEffect(() => { preview.close(pool, closeSel, closeAmt); }, [preview, pool, closeSel, closeAmt, snapshot, account]);
  const claim = claimPreview(pool, claimSel);

  // Setiap klik menangkap pool & pilihan SAAT INI (sinkron); guard (string) tampil inline, null = aksi diserahkan ke ChainState.run (hasil di log).
  const act = (form: Form, guard: string | null) => setGuards((g) => (g[form] === (guard ?? undefined) ? g : { ...g, [form]: guard ?? undefined }));
  const field = (name: keyof typeof fields) => (v: string) => setFields((f) => ({ ...f, [name]: v }));
  const switchPool = (k: PoolKey) => { setPool(k); setGuards({}); };
  const mint = info.faucet === 'mint';
  const approve = needsApprove(pool);

  return (
    <div className="page-stack">
      <SectionHeading eyebrow={`Trade from your wallet · ${NETWORK_NAME}`} title="Trade"
        detail={`Every action is simulated first (eth_call) and written through your wallet; one action at a time. Buy and close previews are indicative view quotes — the ${SLIPPAGE_PCT} caps in the calldata come from a simulation of the executed path (newest Chainlink round).`}
        action={<div className="trade-status">{wrongChain ? <StatusPill tone="warn">wrong network</StatusPill> : account ? <StatusPill tone="good">connected</StatusPill> : hasWallet ? <StatusPill tone="muted">not connected</StatusPill> : <StatusPill tone="warn" title="No injected wallet found — the panel is read-only">read-only · no wallet</StatusPill>}{hasWallet ? <WalletButton /> : null}</div>} />
      <TradeNote hasWallet={hasWallet} />

      <article className="panel pool-panel">
        <div className="field-group pool-panel__group">
          <div className="control-heading" id="pool-switch-label">Pool<span>{info.label} · asset {assetLabel(pool)}</span></div>
          <PoolSwitch value={pool} onChange={switchPool} disabled={busy} labelledBy="pool-switch-label" />
        </div>
      </article>

      <div className="trade-layout">
        <article className="panel trade-form" aria-label="Liquidity">
          <div className="trade-form__head"><div><span className="step-number">01 · LP</span><h3>Liquidity on Pool {pool}</h3></div><StatusPill tone={mint ? 'gold' : 'warn'} title={mint ? 'Mock token with an open mint (faucet button)' : 'Real Paxos USDG on testnet — no mint here'}>{assetLabel(pool)}</StatusPill></div>

          <fieldset className="trade-field">
            <legend className="trade-field__legend"><Droplets size={12} aria-hidden="true" /> {mint ? `Faucet (${info.assetSymbol} mock, open mint)` : `Faucet — ${assetLabel(pool)}, 100 ${info.assetSymbol} per wallet per day`}</legend>
            <Actions guard={guards.faucet}>
              {mint
                ? <button type="button" className="soft-button" disabled={!canAct} onClick={() => act('faucet', actions.faucet(pool))}>{FAUCET_LABEL}</button>
                : <a className="soft-button" href={PAXOS_FAUCET} target="_blank" rel="noopener noreferrer" data-testid="paxos-faucet">{PAXOS_FAUCET_LABEL}</a>}
              {!mint ? <span className="field-hint">{assetLabel(pool)} has no open mint — the faucet is Paxos's own form.</span> : null}
            </Actions>
          </fieldset>

          <fieldset className="trade-field">
            <legend className="trade-field__legend"><ShieldCheck size={12} aria-hidden="true" /> Allowance</legend>
            {approve ? (
              <>
                <p className="field-hint">{assetLabel(pool)} allowance for pool {pool} is below {ALLOWANCE_MIN_TEXT} — approve once (MAX).</p>
                <Actions guard={guards.approve}><button type="button" className="button-ghost button-small" disabled={!canAct} onClick={() => act('approve', actions.approve(pool))}>Approve {assetLabel(pool)} for pool {pool}</button></Actions>
              </>
            ) : <p className="field-hint">{user ? `${assetLabel(pool)} allowance for pool ${pool}: approved.` : account ? 'Allowance is read with your first snapshot.' : 'Connect a wallet to see whether this pool is approved.'}</p>}
          </fieldset>

          <fieldset className="trade-field">
            <legend className="trade-field__legend">Deposit <span>{info.assetSymbol} → LP shares</span></legend>
            <AmountInput id="deposit-assets" label={`Amount (${assetLabel(pool)})`} value={fields.deposit} onChange={field('deposit')} suffix={info.assetSymbol} placeholder={`${info.assetSymbol}, e.g. 100`} describedBy="deposit-preview" />
            <PreviewLine id="deposit-preview" preview={previews.deposit} render={depositPreviewText} active={depositAmt !== null} idle={`enter a ${info.assetSymbol} amount for a share preview (previewDeposit)`} />
            <Actions guard={guards.deposit}><button type="button" className="button-primary button-small" disabled={!canAct} onClick={() => act('deposit', actions.deposit(pool, depositAmt))}>Deposit</button></Actions>
          </fieldset>

          <fieldset className="trade-field">
            <legend className="trade-field__legend">Redeem <span>shares → {info.assetSymbol}</span></legend>
            <AmountInput id="redeem-shares" label="Shares" value={fields.redeem} onChange={field('redeem')} suffix="shares" placeholder="shares, e.g. 100" describedBy="redeem-preview"
              max={{ onClick: () => setFields((f) => ({ ...f, redeem: user ? formatUnits(user.user.shares[pool], 6) : f.redeem })), disabled: !user, title: 'Redeem all your LP shares on this pool' }} />
            <PreviewLine id="redeem-preview" preview={previews.redeem} render={(a) => redeemPreviewText(a, symbol)} active={redeemAmt !== null} idle={`enter a share amount for a ${info.assetSymbol} preview (previewRedeem)`} />
            <Actions guard={guards.redeem}><button type="button" className="button-primary button-small" disabled={!canAct} onClick={() => act('redeem', actions.redeem(pool, redeemAmt))}>Redeem</button></Actions>
          </fieldset>
        </article>

        <article className="panel trade-form quote-panel" aria-label="Options">
          <div className="trade-form__head"><div><span className="step-number">02 · Options</span><h3>Buy, close, claim on Pool {pool}</h3></div><StatusPill tone={snapshot ? 'good' : 'muted'}>{snapshot ? `${buyOptions.length} open series` : emptyLabel}</StatusPill></div>

          <fieldset className="trade-field">
            <legend className="trade-field__legend"><Zap size={12} aria-hidden="true" /> Buy <span>open series</span></legend>
            <div className="trade-field__row">
              <SeriesSelect id="buy-series" label="Series" options={buyOptions} value={buySel} onChange={(i) => setPicks((p) => ({ ...p, buy: i }))} empty={snapshot ? 'no open series' : emptyLabel} describedBy="buy-preview" />
              <AmountInput id="buy-size" label="Size" value={fields.buySize} onChange={field('buySize')} suffix="units" placeholder="units, e.g. 0.1" describedBy="buy-preview" />
            </div>
            <PreviewLine id="buy-preview" preview={previews.buy} render={(p) => buyPreviewText(p, symbol)} active={buySel !== null && buyAmt !== null} idle="pick a series and a size for an indicative quote (quoteBuy)" />
            <Actions guard={guards.buy}><button type="button" className="button-primary button-small" disabled={!canAct} onClick={() => act('buy', actions.buy(pool, buySel, buyAmt))}>Buy</button></Actions>
          </fieldset>

          <fieldset className="trade-field">
            <legend className="trade-field__legend">Close <span>your positions</span></legend>
            <div className="trade-field__row">
              <SeriesSelect id="close-series" label="Position" options={closeOptions} value={closeSel} onChange={(i) => setPicks((p) => ({ ...p, close: i }))} empty={account ? (user ? 'no open positions' : emptyLabel) : 'connect wallet to see positions'} describedBy="close-preview" />
              <AmountInput id="close-size" label="Size" value={fields.closeSize} onChange={field('closeSize')} suffix="units" placeholder="units ≤ position" describedBy="close-preview" />
            </div>
            <PreviewLine id="close-preview" preview={previews.close} render={(p) => closePreviewText(p, symbol)} active={closeSel !== null && closeAmt !== null} idle="pick a position and a size for an indicative quote (quoteClose)" />
            <Actions guard={guards.close}><button type="button" className="button-primary button-small" disabled={!canAct} onClick={() => act('close', actions.close(pool, closeSel, closeAmt))}>Close</button></Actions>
          </fieldset>

          <fieldset className="trade-field">
            <legend className="trade-field__legend">Claim <span>settled series</span></legend>
            <SeriesSelect id="claim-series" label="Settled position" options={claimOptions} value={claimSel} onChange={(i) => setPicks((p) => ({ ...p, claim: i }))} empty={account ? (user ? 'nothing to claim' : emptyLabel) : 'connect wallet to see positions'} describedBy="claim-preview" />
            <p id="claim-preview" className={`preview-line ${claim ? 'mono' : 'preview-line--idle'}`} data-state={claim ? 'value' : 'idle'}>{claim ? claimPreviewText(claim, symbol) : 'units × payoutPerUnit = payout, for settled series you hold'}</p>
            <Actions guard={guards.claim}><button type="button" className="button-primary button-small" disabled={!canAct} onClick={() => act('claim', actions.claim(pool, claimSel))}>Claim</button></Actions>
          </fieldset>
        </article>
      </div>

      <div className="two-col">
        <WalletSummary k={pool} user={user} account={account} hasWallet={hasWallet} wrongChain={wrongChain} emptyLabel={emptyLabel} />
        <TxLog entries={txLog} busy={busy} />
      </div>
    </div>
  );
}
