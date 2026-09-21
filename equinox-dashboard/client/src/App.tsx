import { Router, Route, Switch } from 'wouter';
import type { Client } from '@chain/chain/client';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import ErrorBoundary from '@/components/ErrorBoundary';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ChainProvider } from '@/chain/provider';
import { ClockProvider } from '@/chain/clock';
import { Layout } from '@/components/Layout';
import { useHashRoute } from '@/lib/route';
import Overview from '@/pages/Overview';
import Boards from '@/pages/Boards';
import ComingSoon from '@/pages/ComingSoon';

// Komposisi: ChainProvider (satu snapshot per poll, brief §5) → ClockProvider (detak 1 s terpisah) → router hash → Layout → halaman.
// Router memakai `useHashRoute` (lokasi hash tanpa `?…`) agar tautan prefill `#/trade?pool=B&series=3` / `#/boards?board=1` cocok dengan rutenya.
// `client` hanya di-inject oleh test (stub tanpa jaringan); produksi memakai client publik default provider.
// Halaman lain ditambahkan Task 5–6; sampai itu ada, rute menampilkan placeholder "coming next" TANPA angka.
export default function App({ client }: { client?: Client } = {}) {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster theme="dark" position="bottom-right" />
          <ChainProvider client={client}>
            <ClockProvider>
              <Router hook={useHashRoute}>
                <Layout>
                  <Switch>
                    <Route path="/" component={Overview} />
                    <Route path="/boards" component={Boards} />
                    <Route path="/trade"><ComingSoon title="Trade" detail="Pool switch, faucet or Paxos link per asset, approve, deposit and redeem, buy and close with indicative and executed previews, and a transaction log with decoded reverts." /></Route>
                    <Route path="/portfolio"><ComingSoon title="Portfolio" detail="Asset balance per pool, LP shares valued at NAV per share, option positions with their current close value and claimable payout, and your own history." /></Route>
                    <Route path="/activity"><ComingSoon title="Activity" detail="Event feed across pools with filters, the σ_base chart on a time axis from Observed events, and settlement markers." /></Route>
                    <Route path="/contracts"><ComingSoon title="Contracts & protocol" detail="Every address from the deployment manifest with explorer links, live cfg() and params(), build commit, Sourcify status and documentation links." /></Route>
                    <Route>Not found — <a href="#/">back to overview</a></Route>
                  </Switch>
                </Layout>
              </Router>
            </ClockProvider>
          </ChainProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
