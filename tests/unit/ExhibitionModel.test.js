import { describe, it, expect } from 'vitest';
import {
  CellType, BoothStatus, Orientation,
  createExhibition, createFloor, createBooth
} from '../../src/data/ExhibitionModel.js';

describe('ExhibitionModel Enums', () => {
  it('CellType has all expected values', () => {
    expect(CellType.EMPTY).toBe('empty');
    expect(CellType.CORRIDOR).toBe('corridor');
    expect(CellType.RESTRICTED).toBe('restricted');
    expect(CellType.ENTRANCE).toBe('entrance');
    expect(CellType.BOOTH).toBe('booth');
    expect(CellType.ELEVATOR).toBe('elevator');
    expect(CellType.ESCALATOR).toBe('escalator');
    expect(CellType.LED_SCREEN).toBe('ledScreen');
    expect(Object.keys(CellType)).toHaveLength(8);
  });

  it('BoothStatus has all expected values', () => {
    expect(BoothStatus.IDLE).toBe('idle');
    expect(BoothStatus.RESERVED).toBe('reserved');
    expect(BoothStatus.SOLD).toBe('sold');
    expect(Object.keys(BoothStatus)).toHaveLength(3);
  });

  it('Orientation has all expected values', () => {
    expect(Orientation.STANDARD).toBe('standard');
    expect(Orientation.ENTRANCE_FACING).toBe('entrance-facing');
    expect(Orientation.MAIN_CORRIDOR).toBe('main-corridor');
    expect(Orientation.CORNER).toBe('corner');
    expect(Object.keys(Orientation)).toHaveLength(4);
  });
});

describe('createExhibition', () => {
  it('creates exhibition with default values', () => {
    const ex = createExhibition();
    expect(ex.id).toBeTruthy();
    expect(ex.name).toBe('New Exhibition');
    expect(ex.startTime).toBe('');
    expect(ex.endTime).toBe('');
    expect(ex.description).toBe('');
    expect(ex.floors).toEqual([]);
    expect(ex.escalatorLinks).toEqual([]);
  });

  it('applies overrides', () => {
    const ex = createExhibition({
      name: 'My Expo',
      startTime: '2025-01-01',
      description: 'Test'
    });
    expect(ex.name).toBe('My Expo');
    expect(ex.startTime).toBe('2025-01-01');
    expect(ex.description).toBe('Test');
  });

  it('uses provided id', () => {
    const ex = createExhibition({ id: 'custom-id' });
    expect(ex.id).toBe('custom-id');
  });
});

describe('createFloor', () => {
  it('creates floor with default 30x30 grid of EMPTY cells', () => {
    const floor = createFloor();
    expect(floor.width).toBe(30);
    expect(floor.depth).toBe(30);
    expect(floor.grid.length).toBe(30);
    expect(floor.grid[0].length).toBe(30);
    for (let x = 0; x < 30; x++) {
      for (let z = 0; z < 30; z++) {
        expect(floor.grid[x][z]).toBe(CellType.EMPTY);
      }
    }
  });

  it('creates floor with custom dimensions', () => {
    const floor = createFloor({ width: 5, depth: 3 });
    expect(floor.width).toBe(5);
    expect(floor.depth).toBe(3);
    expect(floor.grid.length).toBe(5);
    expect(floor.grid[0].length).toBe(3);
  });

  it('has default label L1', () => {
    const floor = createFloor();
    expect(floor.label).toBe('L1');
  });

  it('has empty booths array', () => {
    const floor = createFloor();
    expect(floor.booths).toEqual([]);
  });

  it('generates an id', () => {
    const floor = createFloor();
    expect(floor.id).toBeTruthy();
  });
});

describe('createBooth', () => {
  it('calculates area from cells', () => {
    const booth = createBooth({
      cells: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }]
    });
    expect(booth.area).toBe(3);
  });

  it('calculates totalPrice from pricePerUnit * area', () => {
    const booth = createBooth({
      cells: [{ x: 0, z: 0 }, { x: 1, z: 0 }],
      pricePerUnit: 100
    });
    expect(booth.totalPrice).toBe(200);
  });

  it('has default power configuration', () => {
    const booth = createBooth();
    expect(booth.power).toEqual({ type: 'standard', voltage: 220, wattage: 0 });
  });

  it('defaults to IDLE status', () => {
    const booth = createBooth();
    expect(booth.status).toBe(BoothStatus.IDLE);
  });

  it('defaults to STANDARD orientation', () => {
    const booth = createBooth();
    expect(booth.orientation).toBe(Orientation.STANDARD);
  });

  it('defaults brandName and contact fields to empty strings', () => {
    const booth = createBooth();
    expect(booth.brandName).toBe('');
    expect(booth.contactName).toBe('');
    expect(booth.companyName).toBe('');
    expect(booth.website).toBe('');
    expect(booth.contactEmail).toBe('');
  });

  it('boothRent defaults to totalPrice when not specified', () => {
    const booth = createBooth({
      cells: [{ x: 0, z: 0 }],
      pricePerUnit: 50
    });
    expect(booth.boothRent).toBe(50);
  });

  it('boothRent can be overridden', () => {
    const booth = createBooth({
      cells: [{ x: 0, z: 0 }],
      pricePerUnit: 50,
      boothRent: 999
    });
    expect(booth.boothRent).toBe(999);
  });

  it('boothRent can be set to 0 explicitly', () => {
    const booth = createBooth({
      cells: [{ x: 0, z: 0 }],
      pricePerUnit: 50,
      boothRent: 0
    });
    expect(booth.boothRent).toBe(0);
  });
});
