import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Store } from '../../src/data/Store.js';
import { CellType, BoothStatus, Orientation } from '../../src/data/ExhibitionModel.js';
import { resetCounters } from '../../src/utils/IdGenerator.js';
import { bus } from '../../src/utils/EventBus.js';

describe('Store', () => {
  let store;

  beforeEach(() => {
    store = new Store();
    resetCounters();
    bus._listeners = {};
  });

  // --- Exhibition Management ---
  describe('Exhibition Management', () => {
    it('initExhibition creates exhibition and emits event', () => {
      const events = [];
      bus.on('exhibition-changed', d => events.push(d));
      store.initExhibition({ name: 'My Expo' });
      expect(store.exhibition).not.toBeNull();
      expect(store.exhibition.name).toBe('My Expo');
      expect(store.undoStack).toEqual([]);
      expect(events).toHaveLength(1);
    });

    it('initExhibition resets preview presets', () => {
      store.initExhibition();
      store.previewViewPresets = [{ id: 'p1' }];
      store.initExhibition();
      expect(store.previewViewPresets).toEqual([]);
      expect(store.activePreviewViewPresetId).toBeNull();
    });

    it('updateExhibition updates properties and emits', () => {
      store.initExhibition({ name: 'Old' });
      const events = [];
      bus.on('exhibition-changed', d => events.push(d));
      store.updateExhibition({ name: 'New', description: 'Updated' });
      expect(store.exhibition.name).toBe('New');
      expect(store.exhibition.description).toBe('Updated');
      expect(events).toHaveLength(1);
    });

    it('updateExhibition captures undo snapshot', () => {
      store.initExhibition({ name: 'Before' });
      store.updateExhibition({ name: 'After' });
      expect(store.undoStack).toHaveLength(1);
    });
  });

  // --- Floor Management ---
  describe('Floor Management', () => {
    beforeEach(() => {
      store.initExhibition();
    });

    it('addFloor adds a floor and emits events', () => {
      const events = [];
      bus.on('floor-added', d => events.push(d));
      const floor = store.addFloor({ width: 10, depth: 8 });
      expect(floor).not.toBeNull();
      expect(floor.width).toBe(10);
      expect(floor.depth).toBe(8);
      expect(floor.label).toBe('L1');
      expect(store.floors).toHaveLength(1);
      expect(events).toHaveLength(1);
    });

    it('addFloor auto-labels floors sequentially', () => {
      store.addFloor();
      store.addFloor();
      expect(store.floors[0].label).toBe('L1');
      expect(store.floors[1].label).toBe('L2');
    });

    it('addFloor rejects when maxFloors (9) reached', () => {
      for (let i = 0; i < 9; i++) store.addFloor();
      const result = store.addFloor();
      expect(result).toBeNull();
      expect(store.floors).toHaveLength(9);
      expect(store.lastConstraintError).toContain('9');
    });

    it('addFloor rejects when area exceeds maxFloorArea (30000)', () => {
      const result = store.addFloor({ width: 200, depth: 200 });
      expect(result).toBeNull();
      expect(store.lastConstraintError).toContain('30000');
    });

    it('addFloor sets active floor to new floor', () => {
      store.addFloor();
      store.addFloor();
      expect(store.activeFloorIndex).toBe(1);
    });

    it('removeFloor removes floor and adjusts active index', () => {
      store.addFloor();
      store.addFloor();
      store.removeFloor(0);
      expect(store.floors).toHaveLength(1);
    });

    it('removeFloor does not remove last floor', () => {
      store.addFloor();
      store.removeFloor(0);
      expect(store.floors).toHaveLength(1);
    });

    it('removeFloor cleans up escalator links referencing removed floor', () => {
      store.addFloor({ width: 5, depth: 5 });
      store.addFloor({ width: 5, depth: 5 });
      store.addFloor({ width: 5, depth: 5 });
      // Set escalator cells on floors 0 and 1
      store.setActiveFloor(0);
      store.setCell(0, 0, CellType.ESCALATOR);
      store.setActiveFloor(1);
      store.setCell(0, 0, CellType.ESCALATOR);
      // Manually add a link between floor 0 and 1
      store.addEscalatorLink(0, 0, 0, 1, 0, 0);
      expect(store.escalatorLinks.length).toBeGreaterThan(0);
      store.removeFloor(0);
      // Links referencing floor 0 should be removed
      const linksRefOld = store.escalatorLinks.filter(l => l.floorA === 0 && l.xA === 0 && l.zA === 0);
      // After removal, floor indices are adjusted
      expect(store.floors).toHaveLength(2);
    });

    it('setActiveFloor changes active floor', () => {
      store.addFloor();
      store.addFloor();
      store.setActiveFloor(0);
      expect(store.activeFloorIndex).toBe(0);
    });

    it('setActiveFloor ignores out-of-bounds index', () => {
      store.addFloor();
      store.setActiveFloor(0);
      store.setActiveFloor(-1);
      expect(store.activeFloorIndex).toBe(0);
      store.setActiveFloor(99);
      expect(store.activeFloorIndex).toBe(0);
    });

    it('setActiveFloor clears selection', () => {
      store.addFloor();
      store.addFloor();
      store.selectBooth('test');
      store.setActiveFloor(0);
      expect(store.selectedBoothId).toBeNull();
      expect(store.selectedCell).toBeNull();
    });

    it('updateFloorSize rebuilds grid', () => {
      store.addFloor({ width: 5, depth: 5 });
      store.setActiveFloor(0);
      store.setCell(2, 2, CellType.CORRIDOR);
      store.updateFloorSize(10, 10);
      const floor = store.activeFloor;
      expect(floor.width).toBe(10);
      expect(floor.depth).toBe(10);
      // Old cell preserved
      expect(floor.grid[2][2]).toBe(CellType.CORRIDOR);
      // New cells are EMPTY
      expect(floor.grid[9][9]).toBe(CellType.EMPTY);
    });

    it('updateFloorSize removes out-of-bounds booths', () => {
      store.addFloor({ width: 10, depth: 10 });
      store.setActiveFloor(0);
      store.addBooth([{ x: 8, z: 8 }]);
      expect(store.activeFloor.booths).toHaveLength(1);
      store.updateFloorSize(5, 5);
      expect(store.activeFloor.booths).toHaveLength(0);
    });

    it('updateFloorSize rejects area exceeding maxFloorArea', () => {
      store.addFloor({ width: 5, depth: 5 });
      store.setActiveFloor(0);
      const result = store.updateFloorSize(200, 200);
      expect(result).toBe(false);
      expect(store.activeFloor.width).toBe(5);
    });
  });

  // --- Grid Operations ---
  describe('Grid Operations', () => {
    beforeEach(() => {
      store.initExhibition();
      store.addFloor({ width: 10, depth: 10 });
      store.setActiveFloor(0);
    });

    it('setCell sets cell type', () => {
      store.setCell(0, 0, CellType.CORRIDOR);
      expect(store.activeFloor.grid[0][0]).toBe(CellType.CORRIDOR);
    });

    it('setCell ignores out-of-bounds coordinates', () => {
      store.setCell(-1, 0, CellType.CORRIDOR);
      store.setCell(0, -1, CellType.CORRIDOR);
      store.setCell(99, 0, CellType.CORRIDOR);
      store.setCell(0, 99, CellType.CORRIDOR);
      // No crash, grid unchanged
      expect(store.activeFloor.grid[0][0]).toBe(CellType.EMPTY);
    });

    it('setCell protects BOOTH cells from being overwritten (except to EMPTY)', () => {
      store.addBooth([{ x: 0, z: 0 }]);
      expect(store.activeFloor.grid[0][0]).toBe(CellType.BOOTH);
      store.setCell(0, 0, CellType.CORRIDOR);
      expect(store.activeFloor.grid[0][0]).toBe(CellType.BOOTH);
    });

    it('setCell does nothing when type is same as current', () => {
      const stackBefore = store.undoStack.length;
      store.setCell(0, 0, CellType.EMPTY);
      expect(store.undoStack.length).toBe(stackBefore);
    });

    it('setCell captures undo patch', () => {
      const stackBefore = store.undoStack.length;
      store.setCell(0, 0, CellType.CORRIDOR);
      expect(store.undoStack).toHaveLength(stackBefore + 1);
      expect(store.undoStack[store.undoStack.length - 1].kind).toBe('patch');
    });

    it('setCells batch sets multiple cells', () => {
      store.setCells([{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }], CellType.CORRIDOR);
      expect(store.activeFloor.grid[0][0]).toBe(CellType.CORRIDOR);
      expect(store.activeFloor.grid[1][0]).toBe(CellType.CORRIDOR);
      expect(store.activeFloor.grid[2][0]).toBe(CellType.CORRIDOR);
    });

    it('setCells skips out-of-bounds and same-type cells', () => {
      store.setCell(0, 0, CellType.CORRIDOR);
      const stackBefore = store.undoStack.length;
      store.setCells([{ x: 0, z: 0 }, { x: -1, z: 0 }], CellType.CORRIDOR);
      // No new undo entry since no actual changes
      expect(store.undoStack.length).toBe(stackBefore);
    });
  });

  // --- Booth Management ---
  describe('Booth Management', () => {
    beforeEach(() => {
      store.initExhibition();
      store.addFloor({ width: 10, depth: 10 });
      store.setActiveFloor(0);
    });

    it('addBooth creates booth, marks cells as BOOTH, generates ID', () => {
      const cells = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }];
      const booth = store.addBooth(cells);
      expect(booth).not.toBeNull();
      expect(booth.id).toBe('L001');
      expect(booth.cells).toEqual(cells);
      expect(booth.area).toBe(3);
      expect(store.activeFloor.grid[0][0]).toBe(CellType.BOOTH);
      expect(store.activeFloor.grid[1][0]).toBe(CellType.BOOTH);
      expect(store.activeFloor.grid[2][0]).toBe(CellType.BOOTH);
      expect(store.activeFloor.booths).toHaveLength(1);
    });

    it('addBooth rejects when cells are not EMPTY', () => {
      store.setCell(0, 0, CellType.CORRIDOR);
      const result = store.addBooth([{ x: 0, z: 0 }]);
      expect(result).toBeNull();
    });

    it('addBooth rejects non-contiguous cells', () => {
      const result = store.addBooth([{ x: 0, z: 0 }, { x: 5, z: 5 }]);
      expect(result).toBeNull();
    });

    it('addBooth rejects out-of-bounds cells', () => {
      const result = store.addBooth([{ x: -1, z: 0 }]);
      expect(result).toBeNull();
    });

    it('addBooth emits booth-added and grid-changed', () => {
      const boothEvents = [];
      const gridEvents = [];
      bus.on('booth-added', d => boothEvents.push(d));
      bus.on('grid-changed', d => gridEvents.push(d));
      store.addBooth([{ x: 0, z: 0 }]);
      expect(boothEvents).toHaveLength(1);
      expect(gridEvents.length).toBeGreaterThan(0);
    });

    it('removeBooth removes booth and restores cells to EMPTY', () => {
      const booth = store.addBooth([{ x: 0, z: 0 }, { x: 1, z: 0 }]);
      store.removeBooth(booth.id);
      expect(store.activeFloor.booths).toHaveLength(0);
      expect(store.activeFloor.grid[0][0]).toBe(CellType.EMPTY);
      expect(store.activeFloor.grid[1][0]).toBe(CellType.EMPTY);
    });

    it('removeBooth clears selection if removed booth was selected', () => {
      const booth = store.addBooth([{ x: 0, z: 0 }]);
      store.selectBooth(booth.id);
      store.removeBooth(booth.id);
      expect(store.selectedBoothId).toBeNull();
    });

    it('updateBooth updates properties', () => {
      const booth = store.addBooth([{ x: 0, z: 0 }]);
      store.updateBooth(booth.id, { brandName: '  Acme Corp  ' });
      const updated = store.activeFloor.booths[0];
      expect(updated.brandName).toBe('Acme Corp'); // trimmed
    });

    it('updateBooth recalculates totalPrice when pricePerUnit changes', () => {
      const booth = store.addBooth([{ x: 0, z: 0 }, { x: 1, z: 0 }]);
      store.updateBooth(booth.id, { pricePerUnit: 100 });
      const updated = store.activeFloor.booths[0];
      expect(updated.totalPrice).toBe(200); // 100 * 2 cells
    });

    it('updateBooth trims string fields', () => {
      const booth = store.addBooth([{ x: 0, z: 0 }]);
      store.updateBooth(booth.id, {
        contactName: '  John  ',
        companyName: '  Corp  ',
        website: '  http://x.com  ',
        contactEmail: '  a@b.com  '
      });
      const b = store.activeFloor.booths[0];
      expect(b.contactName).toBe('John');
      expect(b.companyName).toBe('Corp');
      expect(b.website).toBe('http://x.com');
      expect(b.contactEmail).toBe('a@b.com');
    });

    it('selectBooth sets selectedBoothId and clears selectedCell', () => {
      store.selectBooth('B001');
      expect(store.selectedBoothId).toBe('B001');
      expect(store.selectedCell).toBeNull();
    });

    it('clearSelection clears both booth and cell selection', () => {
      store.selectBooth('B001');
      store.clearSelection();
      expect(store.selectedBoothId).toBeNull();
      expect(store.selectedCell).toBeNull();
    });

    it('findBoothAt finds booth by coordinate', () => {
      store.addBooth([{ x: 3, z: 4 }, { x: 4, z: 4 }]);
      const found = store.findBoothAt(3, 4);
      expect(found).not.toBeNull();
      expect(found.id).toBe('L001');
    });

    it('findBoothAt returns null for empty cell', () => {
      expect(store.findBoothAt(0, 0)).toBeNull();
    });
  });

  // --- Escalator Links ---
  describe('Escalator Links', () => {
    beforeEach(() => {
      store.initExhibition();
      store.addFloor({ width: 10, depth: 10 });
      store.addFloor({ width: 10, depth: 10 });
      store.setActiveFloor(0);
    });

    it('addEscalatorLink adds link between adjacent floors', () => {
      const link = store.addEscalatorLink(0, 1, 1, 1, 1, 1);
      expect(link).not.toBeNull();
      expect(link.floorA).toBe(0);
      expect(link.floorB).toBe(1);
      expect(store.escalatorLinks).toHaveLength(1);
    });

    it('addEscalatorLink rejects non-adjacent floors', () => {
      store.addFloor({ width: 10, depth: 10 }); // floor index 2
      const link = store.addEscalatorLink(0, 1, 1, 2, 1, 1);
      expect(link).toBeNull();
    });

    it('autoDetectEscalatorLink auto-links matching escalator cells', () => {
      // Place escalator on floor 0
      store.setActiveFloor(0);
      store.setCell(3, 3, CellType.ESCALATOR);
      // Place escalator on floor 1 at same position
      store.setActiveFloor(1);
      store.setCell(3, 3, CellType.ESCALATOR);
      // Auto-detect should have created a link
      const links = store.escalatorLinks.filter(l =>
        l.xA === 3 && l.zA === 3 && l.xB === 3 && l.zB === 3
      );
      expect(links.length).toBeGreaterThan(0);
    });

    it('removeEscalatorLinksForCell removes links at cell', () => {
      store.setActiveFloor(0);
      store.setCell(2, 2, CellType.ESCALATOR);
      store.setActiveFloor(1);
      store.setCell(2, 2, CellType.ESCALATOR);
      // Should have auto-detected link
      const before = store.escalatorLinks.length;
      store.removeEscalatorLinksForCell(0, 2, 2);
      expect(store.escalatorLinks.length).toBeLessThan(before);
    });

    it('sanitizeEscalatorLinks removes invalid links', () => {
      // Manually push an invalid link (non-adjacent floors)
      store.addFloor({ width: 10, depth: 10 }); // floor 2
      store.exhibition.escalatorLinks.push({
        id: 'bad', floorA: 0, xA: 0, zA: 0, floorB: 2, xB: 0, zB: 0
      });
      const removed = store.sanitizeEscalatorLinks();
      expect(removed).toBeGreaterThan(0);
    });

    it('sanitizeEscalatorLinks deduplicates links', () => {
      store.setActiveFloor(0);
      store.setCell(1, 1, CellType.ESCALATOR);
      store.setActiveFloor(1);
      store.setCell(1, 1, CellType.ESCALATOR);
      // Add duplicate
      store.exhibition.escalatorLinks.push({
        ...store.escalatorLinks[0], id: 'dup'
      });
      const before = store.escalatorLinks.length;
      store.sanitizeEscalatorLinks();
      expect(store.escalatorLinks.length).toBeLessThan(before);
    });

    it('moveEscalatorCellGroup moves escalator and updates links', () => {
      store.setActiveFloor(0);
      store.setCell(1, 1, CellType.ESCALATOR);
      store.setActiveFloor(1);
      store.setCell(1, 1, CellType.ESCALATOR);
      // There should be an auto-detected link
      const linksBefore = store.escalatorLinks.length;
      expect(linksBefore).toBeGreaterThan(0);
      // Move escalator on floor 0 from (1,1) to (2,2)
      const result = store.moveEscalatorCellGroup(0, 1, 1, 2, 2);
      expect(result).toBe(true);
      expect(store.floors[0].grid[1][1]).toBe(CellType.EMPTY);
      expect(store.floors[0].grid[2][2]).toBe(CellType.ESCALATOR);
    });

    it('moveEscalatorCellGroup rejects move to non-empty cell', () => {
      store.setActiveFloor(0);
      store.setCell(1, 1, CellType.ESCALATOR);
      store.setCell(2, 2, CellType.CORRIDOR);
      store.setActiveFloor(1);
      store.setCell(1, 1, CellType.ESCALATOR);
      const result = store.moveEscalatorCellGroup(0, 1, 1, 2, 2);
      expect(result).toBe(false);
    });

    it('moveEscalatorCellGroup rejects out-of-bounds target', () => {
      store.setActiveFloor(0);
      store.setCell(1, 1, CellType.ESCALATOR);
      const result = store.moveEscalatorCellGroup(0, 1, 1, -1, 0);
      expect(result).toBe(false);
    });
  });

  // --- Undo/Redo ---
  describe('Undo', () => {
    beforeEach(() => {
      store.initExhibition();
      store.addFloor({ width: 10, depth: 10 });
      store.setActiveFloor(0);
    });

    it('undo reverts addFloor (snapshot)', () => {
      expect(store.floors).toHaveLength(1);
      store.addFloor({ width: 5, depth: 5 });
      expect(store.floors).toHaveLength(2);
      store.undo();
      expect(store.floors).toHaveLength(1);
    });

    it('undo reverts addBooth (snapshot)', () => {
      store.addBooth([{ x: 0, z: 0 }]);
      expect(store.activeFloor.booths).toHaveLength(1);
      store.undo();
      expect(store.activeFloor.booths).toHaveLength(0);
      expect(store.activeFloor.grid[0][0]).toBe(CellType.EMPTY);
    });

    it('undo reverts removeBooth (snapshot)', () => {
      const booth = store.addBooth([{ x: 0, z: 0 }]);
      store.removeBooth(booth.id);
      expect(store.activeFloor.booths).toHaveLength(0);
      store.undo();
      expect(store.activeFloor.booths).toHaveLength(1);
    });

    it('undo reverts setCell (patch)', () => {
      store.setCell(0, 0, CellType.CORRIDOR);
      expect(store.activeFloor.grid[0][0]).toBe(CellType.CORRIDOR);
      store.undo();
      expect(store.activeFloor.grid[0][0]).toBe(CellType.EMPTY);
    });

    it('undo reverts setCells (patch)', () => {
      store.setCells([{ x: 0, z: 0 }, { x: 1, z: 0 }], CellType.CORRIDOR);
      store.undo();
      expect(store.activeFloor.grid[0][0]).toBe(CellType.EMPTY);
      expect(store.activeFloor.grid[1][0]).toBe(CellType.EMPTY);
    });

    it('undo reverts updateBooth (patch)', () => {
      const booth = store.addBooth([{ x: 0, z: 0 }]);
      store.updateBooth(booth.id, { brandName: 'NewBrand' });
      expect(store.activeFloor.booths[0].brandName).toBe('NewBrand');
      store.undo();
      expect(store.activeFloor.booths[0].brandName).toBe('');
    });

    it('undoStack respects limit of 20', () => {
      for (let i = 0; i < 25; i++) {
        store.setCell(i % 10, 0, i % 2 === 0 ? CellType.CORRIDOR : CellType.EMPTY);
      }
      expect(store.undoStack.length).toBeLessThanOrEqual(20);
    });

    it('undo returns false on empty stack', () => {
      store.undoStack = [];
      expect(store.undo()).toBe(false);
    });

    it('undo returns true on successful undo', () => {
      store.setCell(0, 0, CellType.CORRIDOR);
      expect(store.undo()).toBe(true);
    });
  });

  // --- Contiguity Check ---
  describe('Contiguity (_isContiguous via addBooth)', () => {
    beforeEach(() => {
      store.initExhibition();
      store.addFloor({ width: 10, depth: 10 });
      store.setActiveFloor(0);
    });

    it('single cell is contiguous', () => {
      const booth = store.addBooth([{ x: 0, z: 0 }]);
      expect(booth).not.toBeNull();
    });

    it('adjacent cells (horizontal) are contiguous', () => {
      const booth = store.addBooth([{ x: 0, z: 0 }, { x: 1, z: 0 }]);
      expect(booth).not.toBeNull();
    });

    it('adjacent cells (vertical) are contiguous', () => {
      const booth = store.addBooth([{ x: 0, z: 0 }, { x: 0, z: 1 }]);
      expect(booth).not.toBeNull();
    });

    it('diagonal-only cells are NOT contiguous', () => {
      const booth = store.addBooth([{ x: 0, z: 0 }, { x: 1, z: 1 }]);
      expect(booth).toBeNull();
    });

    it('L-shaped cells are contiguous', () => {
      const booth = store.addBooth([
        { x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }
      ]);
      expect(booth).not.toBeNull();
    });

    it('two separated groups are NOT contiguous', () => {
      const booth = store.addBooth([
        { x: 0, z: 0 }, { x: 0, z: 1 },
        { x: 5, z: 5 }, { x: 5, z: 6 }
      ]);
      expect(booth).toBeNull();
    });

    it('large rectangular block is contiguous', () => {
      const cells = [];
      for (let x = 0; x < 3; x++) {
        for (let z = 0; z < 3; z++) {
          cells.push({ x, z });
        }
      }
      const booth = store.addBooth(cells);
      expect(booth).not.toBeNull();
      expect(booth.area).toBe(9);
    });
  });
});