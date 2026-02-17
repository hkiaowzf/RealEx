import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../../src/utils/EventBus.js';

describe('EventBus', () => {
  let eventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  it('on/emit basic subscribe and trigger', () => {
    const received = [];
    eventBus.on('test', data => received.push(data));
    eventBus.emit('test', 'hello');
    expect(received).toEqual(['hello']);
  });

  it('supports multiple listeners on the same event', () => {
    const a = [];
    const b = [];
    eventBus.on('evt', data => a.push(data));
    eventBus.on('evt', data => b.push(data));
    eventBus.emit('evt', 42);
    expect(a).toEqual([42]);
    expect(b).toEqual([42]);
  });

  it('off removes a specific listener', () => {
    const received = [];
    const fn = data => received.push(data);
    eventBus.on('evt', fn);
    eventBus.emit('evt', 1);
    eventBus.off('evt', fn);
    eventBus.emit('evt', 2);
    expect(received).toEqual([1]);
  });

  it('on() returns an unsubscribe function', () => {
    const received = [];
    const unsub = eventBus.on('evt', data => received.push(data));
    eventBus.emit('evt', 1);
    unsub();
    eventBus.emit('evt', 2);
    expect(received).toEqual([1]);
  });

  it('emit on non-existent event does not throw', () => {
    expect(() => eventBus.emit('nonexistent', 'data')).not.toThrow();
  });

  it('different events do not interfere', () => {
    const a = [];
    const b = [];
    eventBus.on('eventA', data => a.push(data));
    eventBus.on('eventB', data => b.push(data));
    eventBus.emit('eventA', 'a');
    eventBus.emit('eventB', 'b');
    expect(a).toEqual(['a']);
    expect(b).toEqual(['b']);
  });

  it('off on non-existent event does not throw', () => {
    expect(() => eventBus.off('nonexistent', () => {})).not.toThrow();
  });

  it('emit passes data correctly including objects', () => {
    const received = [];
    eventBus.on('data', d => received.push(d));
    const obj = { key: 'value', num: 123 };
    eventBus.emit('data', obj);
    expect(received[0]).toBe(obj);
  });
});
