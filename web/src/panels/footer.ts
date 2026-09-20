import { el } from '../ui/dom';
import { BUILD_TIME, COMMIT, FEED, MATH_SOL, MATH_STYLUS, POOLS, SEQ, USDG, VOL, explorerAddress } from '../deployment';
import type { Panel } from './types';

const row = (label: string, addr: string) => el('li', {}, el('span', { class: 'muted', text: `${label} ` }), el('a', { class: 'mono', href: explorerAddress(addr), target: '_blank', rel: 'noopener', text: addr }));

export function createFooter(): Panel {
  const root = el('footer', { class: 'site-footer' },
    el('h2', { text: 'Contracts' }),
    el('ul', { class: 'addr-list' },
      row('Pool A (control, BlackScholesSol)', POOLS.A.pool), row('Pool B (Equinox, Stylus)', POOLS.B.pool),
      row('Shared vol engine (EWMA from Chainlink)', VOL), row('Math A — BlackScholesSol', MATH_SOL), row('Math B — Stylus program (cached)', MATH_STYLUS),
      row('Chainlink ETH/USD (real)', FEED), row('MockUSDG (6 dp, open mint = faucet)', USDG), row('MockSequencerFeed (no L2 uptime feed on Sepolia)', SEQ),
    ),
    el('p', { class: 'muted small' },
      'Mocked on purpose: USDG and the sequencer uptime feed have no Sepolia equivalents; the price feed is the real Chainlink ETH/USD. ',
      'Both pools share one volatility engine (σ_base / σ_mark(0) identical by construction); pool quotes may differ through the inventory term of σ_mark once trade histories diverge — the live identity claim is math parity (both math contracts return byte-identical prices for identical inputs). ',
      'Stylus gas numbers are with the program cached. Treasury = deployer wallet on this testnet deployment. ',
      el('a', { href: 'https://github.com/nodesproof/equinox/blob/main/docs/BENCHMARK.md', target: '_blank', rel: 'noopener', text: 'Benchmark' }), ' · ',
      el('a', { href: 'https://github.com/nodesproof/equinox/blob/main/docs/DEMO_LOG.md', target: '_blank', rel: 'noopener', text: 'Demo log' }), ' · ',
      el('a', { href: 'https://github.com/nodesproof/equinox/blob/main/prd-arsitektur.md', target: '_blank', rel: 'noopener', text: 'PRD' }),
    ),
    el('p', { class: 'muted small mono', text: `build ${COMMIT} · ${BUILD_TIME}` }),
  );
  return { root, render() {} };
}
