// test/chain/clock.test.tsx — ClockProvider/useNow: detak 1 s di context sendiri (putusan pengendali Task 3), jam beku untuk test, guard di luar provider.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClockProvider, TICK_MS, useNow } from '@/chain/clock';

afterEach(() => { cleanup(); vi.useRealTimers(); });

function Now() { return <span data-testid="now">{useNow()}</span>; }

describe('ClockProvider / useNow', () => {
  it('ticks every TICK_MS with wall-clock time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    render(<ClockProvider><Now /></ClockProvider>);
    expect(screen.getByTestId('now')).toHaveTextContent('1000000');
    act(() => { vi.advanceTimersByTime(TICK_MS); });
    expect(screen.getByTestId('now')).toHaveTextContent(String(1_000_000 + TICK_MS));
    act(() => { vi.advanceTimersByTime(3 * TICK_MS); });
    expect(screen.getByTestId('now')).toHaveTextContent(String(1_000_000 + 4 * TICK_MS));
  });

  it('a frozen clock (nowMs) never ticks and follows the prop', () => {
    vi.useFakeTimers();
    const { rerender } = render(<ClockProvider nowMs={42}><Now /></ClockProvider>);
    expect(screen.getByTestId('now')).toHaveTextContent('42');
    act(() => { vi.advanceTimersByTime(5 * TICK_MS); });
    expect(screen.getByTestId('now')).toHaveTextContent('42');
    rerender(<ClockProvider nowMs={43}><Now /></ClockProvider>);
    expect(screen.getByTestId('now')).toHaveTextContent('43');
  });

  it('useNow() outside a ClockProvider throws a wiring error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Now />)).toThrow('useNow() must be used inside <ClockProvider>');
    spy.mockRestore();
  });
});
