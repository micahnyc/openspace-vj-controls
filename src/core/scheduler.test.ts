import { describe, expect, it } from 'vitest';
import { SendScheduler, type OutMsg } from './scheduler';

function setup() {
  const sent: OutMsg[] = [];
  let open = true;
  const s = new SendScheduler({ send: (m) => sent.push(m), canSend: () => open });
  return { s, sent, block: (b: boolean) => (open = !b) };
}
const set = (uri: string, value: unknown): OutMsg => ({ kind: 'set', uri, value });

describe('queue mode', () => {
  it('sends nothing until the tick, then events in order before values', () => {
    const { s, sent } = setup();
    s.setValue('prop:A', set('A', 0.1), 0, 0);
    s.pushEvent({ kind: 'action', id: 'one' }, 1, 1);
    s.pushEvent({ kind: 'action', id: 'two' }, 2, 2);
    expect(sent).toHaveLength(0);
    s.tick(10);
    expect(sent).toEqual([{ kind: 'action', id: 'one' }, { kind: 'action', id: 'two' }, set('A', 0.1)]);
  });

  it('coalesces a fader sweep to the latest value per target', () => {
    const { s, sent } = setup();
    for (let i = 0; i <= 100; i++) s.setValue('prop:A', set('A', i / 100), i * 0.1, i * 0.1);
    s.setValue('prop:B', set('B', 1), 5, 5);
    s.tick(10);
    expect(sent).toEqual([set('A', 1), set('B', 1)]);
    expect(s.metrics().pendingValues).toBe(0);
  });

  it('respects the interval between ticks', () => {
    const { s, sent } = setup();
    s.tick(0);
    s.setValue('prop:A', set('A', 1), 1, 1);
    s.tick(5);
    expect(sent).toHaveLength(0);
    s.tick(10);
    expect(sent).toHaveLength(1);
  });

  it('skips values that did not change', () => {
    const { s, sent } = setup();
    s.setValue('prop:A', set('A', 0.5), 0, 0);
    s.tick(10);
    s.setValue('prop:A', set('A', 0.5), 11, 11);
    s.tick(20);
    expect(sent).toHaveLength(1);
  });

  it('never coalesces events', () => {
    const { s, sent } = setup();
    for (let i = 0; i < 5; i++) s.pushEvent(set('Bool', i % 2 === 0), i, i);
    s.tick(10);
    expect(sent.map((m) => (m as { value: boolean }).value)).toEqual([true, false, true, false, true]);
  });

  it('skips ticks under backpressure and catches up with the latest value', () => {
    const { s, sent, block } = setup();
    block(true);
    s.setValue('prop:A', set('A', 0.2), 0, 0);
    s.tick(10);
    s.setValue('prop:A', set('A', 0.9), 12, 12);
    s.tick(20);
    expect(sent).toHaveLength(0);
    block(false);
    s.tick(30);
    expect(sent).toEqual([set('A', 0.9)]);
  });
});

describe('direct mode', () => {
  it('sends the first value at once and the trailing value when the window ends', () => {
    const { s, sent } = setup();
    s.setMode('direct', 0);
    s.throttleMs = 10;
    s.setValue('prop:A', set('A', 0.1), 0, 0);
    expect(sent).toEqual([set('A', 0.1)]);
    s.setValue('prop:A', set('A', 0.2), 2, 2);
    s.setValue('prop:A', set('A', 0.3), 4, 4);
    expect(sent).toHaveLength(1);
    s.tick(9);
    expect(sent).toHaveLength(1);
    s.tick(10);
    expect(sent).toEqual([set('A', 0.1), set('A', 0.3)]);
  });

  it('throttles per target, not globally', () => {
    const { s, sent } = setup();
    s.setMode('direct', 0);
    s.setValue('prop:A', set('A', 0.1), 0, 0);
    s.setValue('prop:B', set('B', 0.1), 1, 1);
    expect(sent).toHaveLength(2);
  });

  it('sends events immediately, never throttled', () => {
    const { s, sent } = setup();
    s.setMode('direct', 0);
    s.pushEvent({ kind: 'action', id: 'a' }, 0, 0);
    s.pushEvent({ kind: 'action', id: 'b' }, 0.1, 0.1);
    expect(sent).toHaveLength(2);
  });
});

describe('mode switching and metrics', () => {
  it('flushes pending values when switching modes', () => {
    const { s, sent } = setup();
    s.setValue('prop:A', set('A', 0.4), 0, 0);
    s.setMode('direct', 3);
    expect(sent).toEqual([set('A', 0.4)]);
  });

  it('clear() drops everything pending', () => {
    const { s, sent } = setup();
    s.setValue('prop:A', set('A', 0.4), 0, 0);
    s.pushEvent({ kind: 'action', id: 'x' }, 0, 0);
    s.clear();
    s.tick(10);
    expect(sent).toHaveLength(0);
  });

  it('reports rates and input-to-send delay', () => {
    const { s } = setup();
    s.tick(0);
    s.setValue('prop:A', set('A', 0.1), 1, 1);
    s.setValue('prop:A', set('A', 0.2), 2, 2);
    s.tick(10);
    s.tick(1000);
    const m = s.metrics();
    expect(m.sentPerSec).toBe(1);
    expect(m.coalescedPerSec).toBe(1);
    expect(m.delayWorstMs).toBe(9);
  });
});
