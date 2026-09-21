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
import Trade from '@/pages/Trade';
import Portfolio from '@/pages/Portfolio';
import Activity from '@/pages/Activity';
import Contracts from '@/pages/Contracts';

// Komposisi: ChainProvider (satu snapshot per poll, brief §5) → ClockProvider (detak 1 s terpisah) → router hash → Layout → halaman.
// Router memakai `useHashRoute` (lokasi hash tanpa `?…`) agar tautan prefill `#/trade?pool=B&series=3` / `#/boards?board=1` cocok dengan rutenya.
// `client` hanya di-inject oleh test (stub tanpa jaringan); produksi memakai client publik default provider.
// Enam rute hash = enam entri nav Layout; semua halaman hidup di atas provider yang sama (tidak ada placeholder lagi).
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
                    <Route path="/trade" component={Trade} />
                    <Route path="/portfolio" component={Portfolio} />
                    <Route path="/activity" component={Activity} />
                    <Route path="/contracts" component={Contracts} />
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
