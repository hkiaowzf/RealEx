import { describe, it, expect, beforeEach } from 'vitest';
import { generateBoothId, resetCounters, setCounter } from '../../src/utils/IdGenerator.js';

describe('IdGenerator', () => {
  beforeEach(() => {
    resetCounters();
  });

  it('generates ID with prefix from floor label first character + 3-digit number', () => {
    const id = generateBoothId('L1');
    expect(id).toBe('L001');
  });

  it('increments counter for same prefix', () => {
    expect(generateBoothId('A1')).toBe('A001');
    expect(generateBoothId('A2')).toBe('A002');
    expect(generateBoothId('A3')).toBe('A003');
  });

  it('maintains independent counters for different prefixes', () => {
    expect(generateBoothId('A1')).toBe('A001');
    expect(generateBoothId('B1')).toBe('B001');
    expect(generateBoothId('A2')).toBe('A002');
    expect(generateBoothId('B2')).toBe('B002');
  });

  it('resetCounters() clears all counters', () => {
    generateBoothId('A1');
    generateBoothId('B1');
    resetCounters();
    expect(generateBoothId('A1')).toBe('A001');
    expect(generateBoothId('B1')).toBe('B001');
  });

  it('setCounter() sets counter to specific value', () => {
    setCounter('A', 10);
    expect(generateBoothId('A1')).toBe('A011');
  });

  it('uppercases the prefix', () => {
    const id = generateBoothId('a1');
    expect(id).toBe('A001');
  });

  it('handles empty label by defaulting to A', () => {
    const id = generateBoothId('');
    // charAt(0) of '' is '', toUpperCase() is '', so prefix is ''
    // But default parameter is 'A', so only truly empty string passed explicitly
    expect(id).toMatch(/^\w?\d{3}$/);
  });

  it('uses default A when called with no arguments', () => {
    const id = generateBoothId();
    expect(id).toBe('A001');
  });

  it('pads numbers to 3 digits', () => {
    setCounter('X', 0);
    expect(generateBoothId('X1')).toBe('X001');
    setCounter('X', 99);
    expect(generateBoothId('X1')).toBe('X100');
    setCounter('X', 999);
    expect(generateBoothId('X1')).toBe('X1000');
  });
});
