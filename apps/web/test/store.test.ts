import { beforeEach, describe, expect, test } from 'vitest';
import { miniTimeframe, selectActiveSetups, selectJournal, useDeskStore } from '@/store/desk-store';
import { analysis, setup, T0 } from './fixtures';

const candle = (i: number) => ({ time: T0 + i * 60, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 });

beforeEach(() => {
  useDeskStore.setState(useDeskStore.getInitialState());
});

describe('desk store message handling', () => {
  test('hello sets symbol, feed and connection', () => {
    useDeskStore.getState().handleMessage({
      type: 'hello',
      serverTime: new Date().toISOString(),
      symbol: 'XAUUSD',
      feed: { provider: 'replay', isMock: false, source: 'csv', connected: true, lastCandleTime: null, lagSec: null },
      activePlaybook: 'scalp_m15_m5',
    });
    expect(useDeskStore.getState().connection).toBe('open');
    expect(useDeskStore.getState().feed?.provider).toBe('replay');
  });

  test('candle updates replace the last bar or append, never reorder', () => {
    const { handleMessage } = useDeskStore.getState();
    handleMessage({ type: 'candles', tf: 'M1', candles: [candle(0), candle(1)] });
    handleMessage({ type: 'candle', tf: 'M1', candle: { ...candle(1), close: 9 }, closed: false });
    expect(useDeskStore.getState().candles.M1).toHaveLength(2);
    expect(useDeskStore.getState().candles.M1[1]?.close).toBe(9);
    handleMessage({ type: 'candle', tf: 'M1', candle: candle(2), closed: true });
    expect(useDeskStore.getState().candles.M1).toHaveLength(3);
    handleMessage({ type: 'candle', tf: 'M1', candle: candle(0), closed: true }); // stale
    expect(useDeskStore.getState().candles.M1).toHaveLength(3);
  });

  test('setup upsert records transitions; selectors split active and journal', () => {
    const { handleMessage } = useDeskStore.getState();
    handleMessage({ type: 'setup', setup, transition: 'valid' });
    handleMessage({ type: 'setup', setup: { ...setup, status: 'tp2', realizedR: 1.75, closedAt: setup.updatedAt }, transition: 'tp2' });
    const state = useDeskStore.getState();
    expect(state.setups).toHaveLength(1);
    expect(state.lastTransition?.transition).toBe('tp2');
    expect(selectActiveSetups(state)).toHaveLength(0);
    expect(selectJournal(state)).toHaveLength(1);
  });

  test('agent events are deduplicated by id (hello re-sends recent events on reconnect)', () => {
    const { handleMessage } = useDeskStore.getState();
    const event = { id: 'evt_1', ts: new Date().toISOString(), agent: 'zones' as const, level: 'info' as const, summary: 'x' };
    handleMessage({ type: 'agentEvent', event });
    handleMessage({ type: 'agentEvent', event });
    expect(useDeskStore.getState().events).toHaveLength(1);
  });

  test('analysis snapshots are stored per timeframe', () => {
    useDeskStore.getState().handleMessage({ type: 'analysis', snapshot: analysis });
    expect(useDeskStore.getState().analysis.M15?.zones).toHaveLength(1);
  });

  test('chat tokens stream into one assistant message with tool-call chips', () => {
    const { handleMessage } = useDeskStore.getState();
    handleMessage({ type: 'chatToken', messageId: 'm1', token: 'Halo ' });
    handleMessage({ type: 'chatToken', messageId: 'm1', toolCall: { id: 't1', name: 'getSetups', args: {}, status: 'running' } });
    handleMessage({ type: 'chatToken', messageId: 'm1', token: 'dunia', done: true });
    const [msg] = useDeskStore.getState().chat;
    expect(msg?.content).toBe('Halo dunia');
    expect(msg?.toolCalls?.[0]?.name).toBe('getSetups');
    expect(useDeskStore.getState().chatStreaming).toBeNull();
  });

  test('focusSetup switches to the setup playbook and entry timeframe', () => {
    const { handleMessage, focusSetup } = useDeskStore.getState();
    handleMessage({ type: 'setup', setup: { ...setup, playbook: 'intraday_m30_m15' }, transition: null });
    focusSetup(setup.id);
    const ui = useDeskStore.getState().ui;
    expect(ui.focusedSetupId).toBe(setup.id);
    expect(ui.playbook).toBe('intraday_m30_m15');
    expect(ui.tf).toBe('M15');
    expect(ui.focusNonce).toBe(1);
  });

  test('drawings add/remove/clear', () => {
    const { handleMessage } = useDeskStore.getState();
    handleMessage({ type: 'drawing', action: 'add', drawing: { kind: 'hline', id: 'x', price: 1, style: 'dashed' } });
    expect(useDeskStore.getState().drawings).toHaveLength(1);
    handleMessage({ type: 'drawing', action: 'remove', drawingId: 'x' });
    expect(useDeskStore.getState().drawings).toHaveLength(0);
  });
});

describe('miniTimeframe', () => {
  test('shows the other timeframe of the playbook', () => {
    expect(miniTimeframe('M30', 'intraday_m30_m15')).toBe('M15');
    expect(miniTimeframe('M15', 'intraday_m30_m15')).toBe('M30');
    expect(miniTimeframe('M5', 'scalp_m15_m5')).toBe('M15');
    expect(miniTimeframe('M1', 'scalp_m15_m5')).toBe('M5');
  });
});
