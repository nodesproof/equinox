import { Router, Route, Switch } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import ErrorBoundary from '@/components/ErrorBoundary';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { Layout } from '@/components/Layout';
import Overview from '@/pages/Overview';
import ComingSoon from '@/pages/ComingSoon';
// Halaman lain ditambahkan Task 3–6; sampai itu ada, rute menampilkan placeholder "coming next" TANPA angka.
export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster theme="dark" position="bottom-right" />
          <Router hook={useHashLocation}>
            <Layout>
              <Switch>
                <Route path="/" component={Overview} />
                <Route path="/boards"><ComingSoon title="Boards & series" detail="One table per expiry board: buy and close quotes per pool, inventory delta, K5 parity, open interest and σ_buy — all read from the chain at one block." /></Route>
                <Route path="/trade"><ComingSoon title="Trade" detail="Pool switch, faucet or Paxos link per asset, approve, deposit and redeem, buy and close with indicative and executed previews, and a transaction log with decoded reverts." /></Route>
                <Route path="/portfolio"><ComingSoon title="Portfolio" detail="Asset balance per pool, LP shares valued at NAV per share, option positions with their current close value and claimable payout, and your own history." /></Route>
                <Route path="/activity"><ComingSoon title="Activity" detail="Event feed across pools with filters, the σ_base chart on a time axis from Observed events, and settlement markers." /></Route>
                <Route path="/contracts"><ComingSoon title="Contracts & protocol" detail="Every address from the deployment manifest with explorer links, live cfg() and params(), build commit, Sourcify status and documentation links." /></Route>
                <Route>Not found — <a href="#/">back to overview</a></Route>
              </Switch>
            </Layout>
          </Router>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
