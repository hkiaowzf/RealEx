import { describe, it, expect, beforeEach } from 'vitest';
import { exportExhibition } from '../../src/utils/JsonExporter.js';
import { CellType, BoothStatus, Orientation } from '../../src/data/ExhibitionModel.js';

function makeStore(overrides = {}) {
  return {
    exhibition: {
      id: 'ex-1',
      name: 'Test Expo',
      startTime: '2025-01-01',
      endTime: '2025-01-05',
      description: 'A test exhibition',
      floors: overrides.floors || [],
      escalatorLinks: overrides.escalatorLinks || []
    }
  };
}

function makeBooth(overrides = {}) {
  return {
    id: overrides.id || 'A001',
    floorId: overrides.floorId || 'f1',
    cells: overrides.cells || [{ x: 0, z: 0 }],
    area: overrides.area || 1,
    pricePerUnit: overrides.pricePerUnit || 100,
    totalPrice: overrides.totalPrice || 100,
    brandName: overrides.brandName,
    contactName: overrides.contactName,
    companyName: overrides.companyName,
    website: overrides.website,
    contactEmail: overrides.contactEmail,
    boothRent: overrides.boothRent,
    orientation: overrides.orientation || Orientation.STANDARD,
    power: overrides.power || { type: 'standard', voltage: 220, wattage: 0 },
    status: overrides.status || BoothStatus.IDLE
  };
}

describe('JsonExporter', () => {
  it('exports complete exhibition structure', () => {
    const store = makeStore({
      floors: [{
        id: 'f1', label: 'L1', width: 12, depth: 8,
        grid: [], booths: []
      }]
    });
    const result = exportExhibition(store);
    expect(result.id).toBe('ex-1');
    expect(result.name).toBe('Test Expo');
    expect(result.startTime).toBe('2025-01-01');
    expect(result.endTime).toBe('2025-01-05');
    expect(result.description).toBe('A test exhibition');
    expect(result.floors).toHaveLength(1);
    expect(result.escalatorLinks).toEqual([]);
  });

  it('exports floor fields correctly', () => {
    const store = makeStore({
      floors: [{
        id: 'f1', label: 'L1', width: 10, depth: 6,
        grid: [[CellType.EMPTY]], booths: []
      }]
    });
    const floor = exportExhibition(store).floors[0];
    expect(floor.id).toBe('f1');
    expect(floor.label).toBe('L1');
    expect(floor.width).toBe(10);
    expect(floor.depth).toBe(6);
    expect(floor.grid).toEqual([[CellType.EMPTY]]);
  });

  it('exports booth fields with defaults for optional fields', () => {
    const booth = makeBooth({ brandName: undefined, contactName: undefined });
    const store = makeStore({
      floors: [{
        id: 'f1', label: 'L1', width: 12, depth: 8,
        grid: [], booths: [booth]
      }]
    });
    const exported = exportExhibition(store).floors[0].booths[0];
    expect(exported.id).toBe('A001');
    expect(exported.brandName).toBe('');
    expect(exported.contactName).toBe('');
    expect(exported.companyName).toBe('');
    expect(exported.website).toBe('');
    expect(exported.contactEmail).toBe('');
  });

  it('boothRent falls back to totalPrice when undefined', () => {
    const booth = makeBooth({ boothRent: undefined, totalPrice: 500 });
    const store = makeStore({
      floors: [{
        id: 'f1', label: 'L1', width: 12, depth: 8,
        grid: [], booths: [booth]
      }]
    });
    const exported = exportExhibition(store).floors[0].booths[0];
    expect(exported.boothRent).toBe(500);
  });

  it('exports escalator links', () => {
    const store = makeStore({
      escalatorLinks: [{
        id: 'link-1', floorA: 0, xA: 1, zA: 2, floorB: 1, xB: 1, zB: 2
      }]
    });
    const links = exportExhibition(store).escalatorLinks;
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({
      id: 'link-1', floorA: 0, xA: 1, zA: 2, floorB: 1, xB: 1, zB: 2
    });
  });

  it('handles empty exhibition (no floors)', () => {
    const store = makeStore();
    const result = exportExhibition(store);
    expect(result.floors).toEqual([]);
    expect(result.escalatorLinks).toEqual([]);
  });

  it('handles floor with no booths', () => {
    const store = makeStore({
      floors: [{
        id: 'f1', label: 'L1', width: 5, depth: 5,
        grid: [], booths: []
      }]
    });
    const floor = exportExhibition(store).floors[0];
    expect(floor.booths).toEqual([]);
  });

  it('exports power as a copy (not reference)', () => {
    const power = { type: 'high', voltage: 380, wattage: 5000 };
    const booth = makeBooth({ power });
    const store = makeStore({
      floors: [{
        id: 'f1', label: 'L1', width: 12, depth: 8,
        grid: [], booths: [booth]
      }]
    });
    const exported = exportExhibition(store).floors[0].booths[0];
    expect(exported.power).toEqual(power);
    expect(exported.power).not.toBe(power);
  });

  it('handles missing escalatorLinks on exhibition', () => {
    const store = {
      exhibition: {
        id: 'ex-1', name: 'Test', startTime: '', endTime: '',
        description: '', floors: []
        // escalatorLinks intentionally missing
      }
    };
    const result = exportExhibition(store);
    expect(result.escalatorLinks).toEqual([]);
  });
});
