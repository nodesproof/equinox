import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import {
  Activity,
  BarChart3,
  ChevronRight,
  CircleHelp,
  Code2,
  ExternalLink,
  LayoutDashboard,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  Wallet,
  Zap,
} from "lucide-react";

import { BUILD_TIME, CHAIN_ID, COMMIT, POOL_KEYS, POOLS } from "@chain/deployment";
import { AppMark } from "@/components/primitives";

// Cangkang aplikasi: sidebar (nav 6 rute hash) + topbar + strip testnet + footer.
// Semua fakta chain di sini (chain id, pool/aset, commit) dibaca dari data layer, bukan literal.
const REPO = "https://github.com/nodesproof/equinox";

const NAV: { href: string; label: string; icon: typeof LayoutDashboard }[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/boards", label: "Boards", icon: BarChart3 },
  { href: "/trade", label: "Trade", icon: Zap },
  { href: "/portfolio", label: "Portfolio", icon: Wallet },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/contracts", label: "Contracts", icon: Code2 },
];

/** Kalimat mock (brief §7.1), diturunkan dari manifest: pool ber-faucet `mint` = mock, `paxos` = USDG Paxos asli (testnet). */
export function assetSentence(): string {
  const mock = POOL_KEYS.filter((k) => POOLS[k].faucet === "mint");
  const paxos = POOL_KEYS.filter((k) => POOLS[k].faucet === "paxos");
  const parts: string[] = [];
  if (mock.length) parts.push(`mock USDG on ${mock.join("/")}`);
  if (paxos.length) parts.push(`Pool ${paxos.join("/")} settles in Paxos USDG (testnet)`);
  return parts.join(" · ");
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
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [location]);

  const active = NAV.find((item) => item.href === location) ?? NAV[0]!;
  const build = COMMIT || "dev";

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "sidebar--open" : "sidebar--collapsed"} ${mobileNavOpen ? "sidebar--mobile-open" : ""}`}>
        <div className="sidebar__brand">
          <AppMark />
          <div className="brand-copy"><strong>equinox</strong><span>options vault</span></div>
          <button className="sidebar-toggle" onClick={() => setSidebarOpen((v) => !v)} aria-label="Toggle sidebar" aria-expanded={sidebarOpen}>
            {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
        </div>
        <div className="network-card">
          <div className="network-card__dot" />
          <div><span>Network</span><strong>Arbitrum Sepolia</strong></div>
          <span className="network-card__id">{CHAIN_ID}</span>
        </div>
        <nav className="main-nav" aria-label="Main navigation">
          <span className="nav-label">Workspace</span>
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={`nav-item ${location === href ? "nav-item--active" : ""}`} aria-current={location === href ? "page" : undefined}>
              <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar__bottom">
          <div className="sidebar-callout">
            <div className="sidebar-callout__icon"><Radio size={15} /></div>
            <div><strong>Testnet only</strong><span>{assetSentence()}. No real money.</span></div>
          </div>
          <Link href="/contracts" className="nav-item"><CircleHelp size={17} /><span>Help & docs</span></Link>
          <div className="sidebar-footer"><AppMark small /><span>Build <strong>{build}</strong></span></div>
        </div>
      </aside>
      {mobileNavOpen ? <button className="mobile-backdrop" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" /> : null}
      <main className="main-shell">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><Menu size={19} /></button>
          <div className="breadcrumbs"><span>Equinox</span><ChevronRight size={14} /><strong>{active.label}</strong></div>
          <div className="topbar__actions">
            <div className="sync-status" aria-live="polite"><span className="sync-status__dot" /><span>Waiting for snapshot</span></div>
            <button className="connect-button" onClick={() => toast.info("Wallet connection is not wired in this build yet.")}><Wallet size={15} /> Connect wallet</button>
          </div>
        </header>
        <div className="testnet-strip">
          <span><Radio size={13} /> Arbitrum Sepolia <b>·</b> {CHAIN_ID}</span>
          <span>Testnet <b>·</b> {assetSentence()}</span>
        </div>
        <div className="content-wrap">{children}</div>
        <footer className="site-footer">
          <div><AppMark small /><span>Equinox · open protocol surface</span></div>
          <div>
            <span>Commit <strong>{build}</strong></span>
            <span>Built <strong>{BUILD_TIME}</strong></span>
            <a href={REPO} target="_blank" rel="noopener noreferrer">GitHub <ExternalLink size={12} /></a>
          </div>
        </footer>
      </main>
    </div>
  );
}
