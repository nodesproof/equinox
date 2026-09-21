// test/lib/route.test.tsx — kueri di dalam hash: `tradeHref`/`boardsHref`, `hashQuery` + validator (pool/series/board dari manifest), `useHashRoute`
// (rute cocok walau ada `?…`, `location.search` tidak tersentuh), `useHashQuery` reaktif terhadap hashchange. Tanpa jaringan (client stub menolak).
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Router } from 'wouter';
import type { Client } from '@chain/chain/client';
import { ALL_SERIES, BOARDS, POOL_KEYS } from '@chain/deployment';
import App from '@/App';
import { boardsHref, hashQuery, queryBoard, queryPool, querySeries, tradeHref, useHashQuery, useHashRoute } from '@/lib/route';

const offline = { getBlock: () => Promise.reject(new Error('offline (test stub)')) } as unknown as Client;
afterEach(() => { cleanup(); window.location.hash = ''; });

describe('route helpers', () => {
  it('builds prefill links with the query inside the hash and parses them back', () => {
    const k = POOL_KEYS[POOL_KEYS.length - 1]!, i = ALL_SERIES.length - 1;
    expect(tradeHref(k, i)).toBe(`#/trade?pool=${k}&series=${i}`);
    expect(boardsHref()).toBe('#/boards');
    expect(boardsHref(BOARDS[0]!.id)).toBe(`#/boards?board=${BOARDS[0]!.id}`);
    const q = hashQuery(tradeHref(k, i));
    expect(q.get('pool')).toBe(k);
    expect(q.get('series')).toBe(String(i));
    expect(queryPool(q)).toBe(k);
    expect(querySeries(q)).toBe(i);
    expect(Array.from(hashQuery('#/trade').keys())).toEqual([]);
    expect(Array.from(hashQuery('').keys())).toEqual([]);
    // Default source = window.location.hash.
    window.location.hash = boardsHref(BOARDS[0]!.id);
    expect(queryBoard(hashQuery())).toBe(BOARDS[0]!.id);
  });

  it('rejects values outside the manifest (unknown pool, series index out of range, unknown board, non-integers)', () => {
    expect(queryPool(new URLSearchParams('pool=Z'))).toBeNull();
    expect(queryPool(new URLSearchParams(''))).toBeNull();
    expect(querySeries(new URLSearchParams(`series=${ALL_SERIES.length}`))).toBeNull();
    expect(querySeries(new URLSearchParams('series=-1'))).toBeNull();
    expect(querySeries(new URLSearchParams('series=1.5'))).toBeNull();
    expect(querySeries(new URLSearchParams('series=0'))).toBe(0);
    expect(queryBoard(new URLSearchParams('board=999999'))).toBeNull();
    expect(queryBoard(new URLSearchParams('board=x'))).toBeNull();
    expect(queryBoard(new URLSearchParams(`board=${BOARDS[BOARDS.length - 1]!.id}`))).toBe(BOARDS[BOARDS.length - 1]!.id);
  });
});

describe('useHashRoute / useHashQuery', () => {
  it('matches #/trade?pool=B&series=3 to the /trade route and marks Trade as the current page; location.search stays untouched', () => {
    window.location.hash = tradeHref(POOL_KEYS[0]!, 0);
    render(<App client={offline} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Trade' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Trade/, current: 'page' })).toHaveAttribute('href', '#/trade');
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe(tradeHref(POOL_KEYS[0]!, 0));
    expect(screen.queryByText(/Not found/)).toBeNull();
  });

  it('matches #/boards?board=<id> to the Boards page', () => {
    window.location.hash = boardsHref(BOARDS[0]!.id);
    render(<App client={offline} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Boards & series' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Boards/, current: 'page' })).toHaveAttribute('href', '#/boards');
  });

  it('useHashQuery re-reads the query on hashchange; useHashRoute strips it from the path', () => {
    function Probe() {
      const [path] = useHashRoute();
      const q = useHashQuery();
      return <p data-testid="probe">{path}|{q.get('board') ?? 'none'}</p>;
    }
    window.location.hash = '#/boards';
    render(<Router hook={useHashRoute}><Probe /></Router>);
    expect(screen.getByTestId('probe')).toHaveTextContent('/boards|none');
    act(() => { window.location.hash = boardsHref(BOARDS[0]!.id); window.dispatchEvent(new Event('hashchange')); });
    expect(screen.getByTestId('probe')).toHaveTextContent(`/boards|${BOARDS[0]!.id}`);
    act(() => { window.location.hash = ''; window.dispatchEvent(new Event('hashchange')); });
    expect(screen.getByTestId('probe')).toHaveTextContent('/|none');
  });
});
