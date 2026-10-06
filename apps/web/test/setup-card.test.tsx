import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { FeedStatusChip } from '@/components/FeedStatusChip';
import { SetupCard, rProgress } from '@/components/SetupCard';
import { setup } from './fixtures';

describe('SetupCard', () => {
  test('renders direction, levels with two decimals and status chip; click focuses', () => {
    const onFocus = vi.fn();
    render(<SetupCard setup={setup} lastPrice={4595} focused={false} onFocus={onFocus} />);
    expect(screen.getByText('▲ LONG')).toBeInTheDocument();
    expect(screen.getByText('4592.10')).toBeInTheDocument();
    expect(screen.getByText('4587.90')).toBeInTheDocument();
    expect(screen.getByText('4598.40')).toBeInTheDocument();
    expect(screen.getByText('4600.50')).toBeInTheDocument();
    expect(screen.getByTestId('setup-status')).toHaveTextContent('valid');
    fireEvent.click(screen.getByTestId('setup-card'));
    expect(onFocus).toHaveBeenCalledWith(setup.id);
  });

  test('shows the R progress bar only while in a trade', () => {
    expect(rProgress(setup, 4595)).toBeNull();
    expect(rProgress({ ...setup, status: 'triggered' }, 4596.3)).toBeCloseTo(1);
    expect(rProgress({ ...setup, status: 'triggered', direction: 'short' }, 4596.3)).toBeCloseTo(-1);
    expect(rProgress({ ...setup, status: 'tp1' }, 4700)).toBe(2); // clamped
  });

  test('realized R is shown for closed setups', () => {
    render(<SetupCard setup={{ ...setup, status: 'tp2', realizedR: 1.75 }} lastPrice={null} focused={false} onFocus={() => undefined} />);
    expect(screen.getByText('+1.75R')).toBeInTheDocument();
  });
});

describe('FeedStatusChip', () => {
  test('shows a loud MOCK DATA badge only for the mock provider', () => {
    const { rerender } = render(<FeedStatusChip connection="open" feed={{ provider: 'mock', isMock: true, source: 'mock', connected: true, lastCandleTime: null, lagSec: null }} />);
    expect(screen.getByTestId('mock-badge')).toHaveTextContent('MOCK DATA');
    rerender(<FeedStatusChip connection="open" feed={{ provider: 'replay', isMock: false, source: 'csv:sample', connected: true, lastCandleTime: null, lagSec: null }} />);
    expect(screen.queryByTestId('mock-badge')).toBeNull();
    expect(screen.getByTestId('feed-label')).toHaveTextContent('replay · csv:sample');
    rerender(<FeedStatusChip connection="closed" feed={null} />);
    expect(screen.getByTestId('feed-label')).toHaveTextContent('terputus');
  });
});
