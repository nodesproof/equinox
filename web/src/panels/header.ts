import { el, setText } from '../ui/dom';
import { CHAIN_ID, POOLS, explorerAddress } from '../deployment';
import { isStale } from '../ui/poll';
import type { Panel } from './types';

export function createHeader(): Panel {
  const status = el('span', { class: 'badge badge-wait' }, el('i', { class: 'lamp' }), el('span', { class: 'badge-text', text: 'connecting' }));
  const statusText = status.querySelector('.badge-text')!;
  const block = el('span', { class: 'mono muted', text: '' });
  const root = el('header', { class: 'site-header' },
    el('div', { class: 'brand' },
      el('div', {},
        el('h1', { text: 'Equinox' }),
        el('p', { class: 'tagline', text: 'On-chain ETH options priced by Black-Scholes in Arbitrum Stylus — volatility from Chainlink prints, no IV oracle' }),
      ),
    ),
    el('div', { class: 'header-right' },
      el('span', { class: 'badge', text: `Arbitrum Sepolia · ${CHAIN_ID}` }),
      status, block,
      el('a', { class: 'link', href: 'https://github.com/nodesproof/equinox', target: '_blank', rel: 'noopener', text: 'GitHub ↗' }),
      el('a', { class: 'link', href: explorerAddress(POOLS.B.pool), target: '_blank', rel: 'noopener', text: 'Pool B on Arbiscan ↗' }),
    ),
  );
  return {
    root,
    render(s, meta) {
      const stale = meta.lastOkMs === null || isStale(meta.lastOkMs, meta.nowMs);
      const state = s === null ? 'wait' : stale ? 'stale' : 'live';
      setText(statusText, s === null ? 'connecting' : stale ? 'stale' : 'live');
      status.className = `badge badge-${state}`;
      setText(block, s ? `block ${s.blockNumber}` : '');
    },
  };
}
