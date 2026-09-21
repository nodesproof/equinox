// Layout.tsx — cangkang aplikasi HIDUP: sidebar (nav 6 rute hash + tag board/seri dari manifest, kartu jaringan + status connecting|live|stale
// + blok, callout testnet), topbar (breadcrumb, umur snapshot, tombol connect / alamat / "Switch to Arbitrum Sepolia"), strip testnet,
// banner RPC global, footer build. Fakta chain (chain id, pool/aset, commit) dari data layer; status dari ChainState + jam useNow() (bukan meta.nowMs).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { toast } from 'sonner';
import { Activity, BarChart3, ChevronRight, CircleHelp, Code2, ExternalLink, LayoutDashboard, Menu, PanelLeftClose, PanelLeftOpen, Radio, AlertTriangle, Wallet, Zap } from 'lucide-react';
import { ALL_SERIES, BOARDS, BUILD_TIME, CHAIN_ID, COMMIT, POOL_KEYS, POOLS, explorerAddress } from '@chain/deployment';
import { fmtAge, shortAddr } from '@chain/ui/format';
import { useChain } from '@/chain/provider';
import { useNow } from '@/chain/clock';
import { AppMark } from '@/components/primitives';
import { RpcBanner } from '@/components/Banner';
import { buildStamp } from '@/lib/format';
import { syncStatus } from '@/lib/sync';
import { REPO } from '@/lib/contracts';

/** Nama jaringan untuk chrome & tombol switch — chain id-nya dari manifest (CHAIN_ID). */
export const NETWORK_NAME = 'Arbitrum Sepolia';

const NAV: { href: string; label: string; icon: typeof LayoutDashboard; tag?: string; tagTitle?: string }[] = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  // Tag = jumlah board / seri dari manifest (BOARDS, ALL_SERIES) — board baru ditambahkan tiap Jumat, tidak pernah hard-coded.
  { href: '/boards', label: 'Boards', icon: BarChart3, tag: `${BOARDS.length} / ${ALL_SERIES.length}`, tagTitle: `${BOARDS.length} boards · ${ALL_SERIES.length} series in the manifest` },
  { href: '/trade', label: 'Trade', icon: Zap },
  { href: '/portfolio', label: 'Portfolio', icon: Wallet },
  { href: '/activity', label: 'Activity', icon: Activity },
  { href: '/contracts', label: 'Contracts', icon: Code2 },
];

const mockPools = () => POOL_KEYS.filter((k) => POOLS[k].faucet === 'mint');
const paxosPools = () => POOL_KEYS.filter((k) => POOLS[k].faucet === 'paxos');

/** Kalimat strip testnet (brief §7.1), diturunkan dari manifest: "mock USDG on A/B · Pool C settles in Paxos USDG (testnet)". */
export function assetSentence(): string {
  const parts: string[] = [];
  if (mockPools().length) parts.push(`mock USDG on ${mockPools().join('/')}`);
  if (paxosPools().length) parts.push(`Pool ${paxosPools().join('/')} settles in Paxos USDG (testnet)`);
  return parts.join(' · ');
}
/** Callout sidebar: "USDG on A/B is a mock; Pool C settles in Paxos USDG — testnet, no real money." */
export function calloutSentence(): string {
  const parts: string[] = [];
  if (mockPools().length) parts.push(`USDG on ${mockPools().join('/')} is a mock`);
  if (paxosPools().length) parts.push(`Pool ${paxosPools().join('/')} settles in Paxos USDG`);
  return `${parts.join('; ')} — testnet, no real money.`;
}

/** Kartu jaringan sidebar: titik berwarna status + "live · block N" (badge aria-live ada di topbar agar tidak diumumkan dua kali). */
function NetworkCard() {
  const { snapshot, meta } = useChain();
  const status = syncStatus({ snapshot, meta }, useNow());
  return (
    <div className={`network-card network-card--${status.kind}`} title={status.error ?? undefined}>
      <div className="network-card__dot" />
      <div>
        <span>Network</span>
        <strong>{NETWORK_NAME}</strong>
        <span className="network-card__status mono">{status.label}{snapshot ? ` · block ${snapshot.blockNumber}` : ''}</span>
      </div>
      <span className="network-card__id">{CHAIN_ID}</span>
    </div>
  );
}

/** Badge topbar (brief §8.4: aria-live="polite" untuk live/stale): kata status di region live, umur snapshot di luar region agar detak tidak diumumkan. */
function SyncStatus() {
  const { snapshot, meta } = useChain();
  const status = syncStatus({ snapshot, meta }, useNow());
  return (
    <div className={`sync-status sync-status--${status.kind}`} title={status.error ?? undefined}>
      <span className="sync-status__dot" />
      <b aria-live="polite">{status.label}</b>
      <span>{status.ageS === null ? (status.kind === 'failed' ? 'no snapshot yet' : 'waiting for the first snapshot') : `snapshot ${fmtAge(status.ageS)} · block ${snapshot!.blockNumber}`}</span>
    </div>
  );
}

/** Tombol wallet: tanpa wallet → penjelasan read-only (toast); tanpa akun → connect; salah jaringan → switch; ada akun → alamat (tautan explorer).
 *  Diekspor untuk status akun di heading halaman Trade/Portfolio (satu perilaku connect di seluruh aplikasi). */
export function WalletButton() {
  const { account, wrongChain, hasWallet, busy, connect } = useChain();
  if (!hasWallet) {
    return (
      <button type="button" className="connect-button" title="No injected wallet found — the dashboard is read-only"
        onClick={() => toast.info(`No injected wallet found — the dashboard stays read-only. Install MetaMask and add ${NETWORK_NAME} (chain ${CHAIN_ID}) to trade.`)}>
        <Wallet size={15} /> Connect wallet
      </button>
    );
  }
  if (wrongChain) {
    return (
      <button type="button" className="connect-button connect-button--warn" disabled={busy} onClick={() => void connect()} title={`Switch your wallet to ${NETWORK_NAME} (chain ${CHAIN_ID})`}>
        <AlertTriangle size={15} /> Switch to {NETWORK_NAME}
      </button>
    );
  }
  if (account) {
    return (
      <a className="connect-button connect-button--account mono" href={explorerAddress(account)} target="_blank" rel="noopener noreferrer" title={`${account} on Arbiscan`}>
        <Wallet size={15} /> {shortAddr(account)}
      </a>
    );
  }
  return (
    <button type="button" className="connect-button" disabled={busy} onClick={() => void connect()}>
      <Wallet size={15} /> {busy ? 'Connecting…' : 'Connect wallet'}
    </button>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const previous = useRef(location);

  // Pindah rute: tutup nav mobile dan gulir ke atas (bukan pada mount pertama).
  useEffect(() => {
    if (previous.current === location) return;
    previous.current = location;
    setMobileNavOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [location]);

  const active = NAV.find((item) => item.href === location) ?? NAV[0]!;
  const build = COMMIT || 'dev';

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : 'sidebar--collapsed'} ${mobileNavOpen ? 'sidebar--mobile-open' : ''}`}>
        <div className="sidebar__brand">
          <AppMark />
          <div className="brand-copy"><strong>equinox</strong><span>options vault</span></div>
          <button type="button" className="sidebar-toggle" onClick={() => setSidebarOpen((v) => !v)} aria-label="Toggle sidebar" aria-expanded={sidebarOpen}>
            {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
        </div>
        <NetworkCard />
        <nav className="main-nav" aria-label="Main navigation">
          <span className="nav-label">Workspace</span>
          {NAV.map(({ href, label, icon: Icon, tag, tagTitle }) => (
            <Link key={href} href={href} className={`nav-item ${location === href ? 'nav-item--active' : ''}`} aria-current={location === href ? 'page' : undefined}>
              <Icon size={17} strokeWidth={1.8} /><span>{label}</span>{tag ? <small title={tagTitle} aria-label={tagTitle}>{tag}</small> : null}
            </Link>
          ))}
        </nav>
        <div className="sidebar__bottom">
          <div className="sidebar-callout">
            <div className="sidebar-callout__icon"><Radio size={15} /></div>
            <div><strong>Testnet only</strong><span>{calloutSentence()}</span></div>
          </div>
          <Link href="/contracts" className="nav-item"><CircleHelp size={17} /><span>Help & docs</span></Link>
          <div className="sidebar-footer"><AppMark small /><span>Build <strong>{build}</strong></span></div>
        </div>
      </aside>
      {mobileNavOpen ? <button type="button" className="mobile-backdrop" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" /> : null}
      <main className="main-shell">
        <header className="topbar">
          <button type="button" className="mobile-menu" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><Menu size={19} /></button>
          <div className="breadcrumbs"><span>Equinox</span><ChevronRight size={14} /><strong>{active.label}</strong></div>
          <div className="topbar__actions">
            <SyncStatus />
            <WalletButton />
          </div>
        </header>
        <div className="testnet-strip" data-testid="testnet-strip">
          <span><Radio size={13} /> {NETWORK_NAME} <b>·</b> {CHAIN_ID}</span>
          {' '}
          <span><b>·</b> {assetSentence()}</span>
        </div>
        <RpcBanner />
        <div className="content-wrap">{children}</div>
        <footer className="site-footer">
          <div><AppMark small /><span>Equinox · open protocol surface · times in UTC</span></div>
          <div>
            <span className="mono">build <strong>{build}</strong> · <strong>{buildStamp(BUILD_TIME)}</strong></span>
            <a href={REPO} target="_blank" rel="noopener noreferrer">GitHub <ExternalLink size={12} /></a>
          </div>
        </footer>
      </main>
    </div>
  );
}
