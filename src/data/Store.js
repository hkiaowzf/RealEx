import { bus } from '../utils/EventBus.js';
import {
  CellType, BoothStatus, createExhibition, createFloor, createBooth
} from './ExhibitionModel.js';
import { generateBoothId, setCounter } from '../utils/IdGenerator.js';

export class Store {
  constructor() {
    this.maxFloors = 9;
    this.maxFloorArea = 30000;
    this.lastConstraintError = '';
    this.undoLimit = 20;
    this.undoStack = [];
    this._isApplyingUndo = false;
    this.exhibition = null;
    this.activeFloorIndex = 0;
    this.editMode = 'edit'; // 'edit' | 'preview'
    this.viewFilter = 'all';
    this.showFloorAnnotations = true;
    this.previewViewPresets = [];
    this.activePreviewViewPresetId = null;
    this.previewViewPresetLimit = 3;
    this.snapshotNameSeq = 1;
    this.editTool = 'select'; // select|corridor|restricted|entrance|ledScreen|boothTemplate|boothDraw
    this.boothTemplate = { w: 3, h: 3 };
    this.selectedBoothId = null;
    this.selectedCell = null; // { x, z, type, cells? } for public-area selection
    this.drawingCells = [];
    this._boothCellIndexByFloorId = new Map(); // floorId -> Map("x,z" -> booth)
    this._boothByIdIndexByFloorId = new Map(); // floorId -> Map(boothId -> booth)
    this._boothPosIndexByFloorId = new Map(); // floorId -> Map(boothId -> array index)
    this._escalatorLinkIndex = null; // { byEndpoint: Map, pairSet: Set }
  }

  // --- Exhibition ---
  initExhibition(overrides) {
    this.exhibition = createExhibition(overrides);
    this.undoStack = [];
    this._invalidateBoothIndices();
    this._invalidateEscalatorLinkIndex();
    this.previewViewPresets = [];
    this.activePreviewViewPresetId = null;
    bus.emit('exhibition-changed', this.exhibition);
    bus.emit('preview-views-changed', {
      presets: this.previewViewPresets,
      activeId: this.activePreviewViewPresetId
    });
  }

  updateExhibition(props) {
    this._captureUndoSnapshot();
    Object.assign(this.exhibition, props);
    bus.emit('exhibition-changed', this.exhibition);
  }

  // --- Floors ---
  get floors() { return this.exhibition ? this.exhibition.floors : []; }
  get activeFloor() { return this.floors[this.activeFloorIndex] || null; }

  _setConstraintError(message = '') {
    this.lastConstraintError = message;
  }

  addFloor(overrides = {}) {
    if (this.floors.length >= this.maxFloors) {
      this._setConstraintError(`最多只能创建 ${this.maxFloors} 层`);
      return null;
    }
    const width = Number(overrides.width) || 12;
    const depth = Number(overrides.depth) || 8;
    if (width * depth > this.maxFloorArea) {
      this._setConstraintError(`单层面积不能超过 ${this.maxFloorArea} 平方米`);
      return null;
    }
    this._captureUndoSnapshot();
    const idx = this.floors.length;
    const label = overrides.label || `L${idx + 1}`;
    const floor = createFloor({ ...overrides, width, depth, label });
    this.exhibition.floors.push(floor);
    this._setConstraintError('');
    bus.emit('floor-added', { floor, index: idx });
    this.setActiveFloor(idx);
    return floor;
  }

  removeFloor(index) {
    if (this.floors.length <= 1) return;
    this._captureUndoSnapshot();
    const [removed] = this.exhibition.floors.splice(index, 1);
    if (removed?.id) this._invalidateBoothIndices(removed.id);
    // Clean up escalator links referencing the removed floor
    this.exhibition.escalatorLinks = this.exhibition.escalatorLinks.filter(l =>
      l.floorA !== index && l.floorB !== index
    );
    // Adjust floor indices in remaining links
    this.exhibition.escalatorLinks.forEach(l => {
      if (l.floorA > index) l.floorA--;
      if (l.floorB > index) l.floorB--;
    });
    this.sanitizeEscalatorLinks();
    bus.emit('floor-removed', { floor: removed, index });
    if (this.activeFloorIndex >= this.floors.length) {
      this.activeFloorIndex = this.floors.length - 1;
    }
    bus.emit('active-floor-changed', this.activeFloorIndex);
    bus.emit('escalator-links-changed', this.escalatorLinks);
  }

  setActiveFloor(index) {
    if (index < 0 || index >= this.floors.length) return;
    this.activeFloorIndex = index;
    this.selectedBoothId = null;
    this.selectedCell = null;
    bus.emit('active-floor-changed', this.activeFloorIndex);
  }

  updateFloorSize(width, depth) {
    const floor = this.activeFloor;
    if (!floor) return false;
    if (width * depth > this.maxFloorArea) {
      this._setConstraintError(`单层面积不能超过 ${this.maxFloorArea} 平方米`);
      return false;
    }
    this._captureUndoSnapshot();
    floor.width = width;
    floor.depth = depth;
    // Rebuild grid
    const grid = [];
    for (let x = 0; x < width; x++) {
      grid[x] = [];
      for (let z = 0; z < depth; z++) {
        grid[x][z] = (floor.grid[x] && floor.grid[x][z]) || CellType.EMPTY;
      }
    }
    floor.grid = grid;
    // Remove booths that are out of bounds
    floor.booths = floor.booths.filter(b =>
      b.cells.every(c => c.x < width && c.z < depth)
    );
    this._rebuildBoothCellIndexForFloor(floor);
    this.sanitizeEscalatorLinks();
    this._setConstraintError('');
    bus.emit('floor-changed', floor);
    return true;
  }

  // --- Grid ---
  setCell(x, z, type) {
    const floor = this.activeFloor;
    if (!floor || x < 0 || z < 0 || x >= floor.width || z >= floor.depth) return;
    if (floor.grid[x][z] === CellType.BOOTH && type !== CellType.EMPTY) return;
    const oldType = floor.grid[x][z];
    if (oldType === type) return;
    const touchesEscalator = oldType === CellType.ESCALATOR || type === CellType.ESCALATOR;
    this._captureUndoPatch({
      op: 'setCell',
      floorId: floor.id,
      x,
      z,
      from: oldType,
      to: type,
      escalatorLinksBefore: touchesEscalator ? this._deepClone(this.escalatorLinks) : null
    });
    floor.grid[x][z] = type;
    bus.emit('grid-changed', { floor, x, z, type });
    // Auto-manage escalator links
    if (oldType === CellType.ESCALATOR && type !== CellType.ESCALATOR) {
      this.removeEscalatorLinksForCell(this.activeFloorIndex, x, z, false);
    }
    if (type === CellType.ESCALATOR) {
      this.autoDetectEscalatorLink(this.activeFloorIndex, x, z, false);
    }
  }

  setCells(cells, type) {
    const floor = this.activeFloor;
    if (!floor) return;
    const changes = [];
    cells.forEach(({ x, z }) => {
      if (x >= 0 && z >= 0 && x < floor.width && z < floor.depth) {
        if ((floor.grid[x][z] !== CellType.BOOTH || type === CellType.EMPTY) && floor.grid[x][z] !== type) {
          changes.push({ x, z, from: floor.grid[x][z], to: type });
          floor.grid[x][z] = type;
        }
      }
    });
    if (!changes.length) return;
    this._captureUndoPatch({
      op: 'setCells',
      floorId: floor.id,
      changes
    });
    bus.emit('grid-changed', { floor });
  }

  // --- Booths ---
  addBooth(cells) {
    const floor = this.activeFloor;
    if (!floor) return null;
    for (const c of cells) {
      if (c.x < 0 || c.z < 0 || c.x >= floor.width || c.z >= floor.depth) return null;
      if (floor.grid[c.x][c.z] !== CellType.EMPTY) return null;
    }
    if (!this._isContiguous(cells)) return null;
    this._captureUndoSnapshot();
    const id = generateBoothId(floor.label);
    const booth = createBooth({ id, floorId: floor.id, cells });
    floor.booths.push(booth);
    cells.forEach(c => { floor.grid[c.x][c.z] = CellType.BOOTH; });
    this._indexBoothCells(floor, booth);
    this._indexBoothById(floor, booth, floor.booths.length - 1);
    bus.emit('booth-added', booth);
    bus.emit('grid-changed', { floor });
    return booth;
  }

  removeBooth(boothId) {
    this.removeBoothOnFloor(this.activeFloorIndex, boothId);
  }

  removeBoothOnFloor(floorIndex, boothId) {
    const floor = this.floors[floorIndex];
    if (!floor) return;
    let idx = this._getBoothPositionOnFloor(floor, boothId);
    if (!Number.isInteger(idx) || idx < 0 || idx >= floor.booths.length) {
      idx = floor.booths.findIndex(b => b.id === boothId);
      if (idx >= 0) this._indexBoothById(floor, floor.booths[idx], idx);
    }
    if (idx === -1) return;
    this._captureUndoSnapshot();
    const booth = floor.booths[idx];
    this._unindexBoothCells(floor, booth);
    booth.cells.forEach(c => { floor.grid[c.x][c.z] = CellType.EMPTY; });
    floor.booths.splice(idx, 1);
    this._unindexBoothById(floor, booth.id);
    this._reindexBoothPositionsFrom(floor, idx);
    if (this.activeFloorIndex === floorIndex && this.selectedBoothId === boothId) this.selectedBoothId = null;
    bus.emit('booth-removed', booth);
    bus.emit('grid-changed', { floor });
  }

  updateBooth(boothId, props) {
    this.updateBoothOnFloor(this.activeFloorIndex, boothId, props);
  }

  updateBoothOnFloor(floorIndex, boothId, props) {
    const floor = this.floors[floorIndex];
    if (!floor) return;
    const booth = this._getBoothByIdOnFloor(floor, boothId) || floor.booths.find(b => b.id === boothId);
    if (booth && !this._getBoothByIdOnFloor(floor, boothId)) {
      const idx = floor.booths.indexOf(booth);
      this._indexBoothById(floor, booth, idx);
    }
    if (!booth) return;
    const before = {};
    if (props.pricePerUnit !== undefined) before.pricePerUnit = booth.pricePerUnit;
    if (props.orientation !== undefined) before.orientation = booth.orientation;
    if (props.power !== undefined) {
      before.power = {};
      Object.keys(props.power || {}).forEach(key => {
        before.power[key] = booth.power?.[key];
      });
    }
    if (props.status !== undefined) before.status = booth.status;
    if (props.brandName !== undefined) before.brandName = booth.brandName;
    if (props.contactName !== undefined) before.contactName = booth.contactName;
    if (props.companyName !== undefined) before.companyName = booth.companyName;
    if (props.website !== undefined) before.website = booth.website;
    if (props.contactEmail !== undefined) before.contactEmail = booth.contactEmail;
    if (props.boothRent !== undefined) before.boothRent = booth.boothRent;
    this._captureUndoPatch({
      op: 'updateBooth',
      floorId: floor.id,
      boothId: booth.id,
      before
    });
    if (props.pricePerUnit !== undefined) {
      booth.pricePerUnit = props.pricePerUnit;
      booth.totalPrice = booth.pricePerUnit * booth.area;
    }
    if (props.orientation !== undefined) booth.orientation = props.orientation;
    if (props.power) booth.power = { ...booth.power, ...props.power };
    if (props.status !== undefined) booth.status = props.status;
    if (props.brandName !== undefined) booth.brandName = String(props.brandName || '').trim();
    if (props.contactName !== undefined) booth.contactName = String(props.contactName || '').trim();
    if (props.companyName !== undefined) booth.companyName = String(props.companyName || '').trim();
    if (props.website !== undefined) booth.website = String(props.website || '').trim();
    if (props.contactEmail !== undefined) booth.contactEmail = String(props.contactEmail || '').trim();
    if (props.boothRent !== undefined) booth.boothRent = Number(props.boothRent) || 0;
    bus.emit('booth-updated', booth);
  }

  moveBooth(boothId, dx, dz) {
    const floor = this.activeFloor;
    if (!floor || !boothId) return false;
    const deltaX = Number(dx) || 0;
    const deltaZ = Number(dz) || 0;
    if (deltaX === 0 && deltaZ === 0) return false;
    const booth = this._getBoothByIdOnFloor(floor, boothId) || floor.booths.find(b => b.id === boothId);
    if (!booth) return false;
    const oldSet = new Set(booth.cells.map(c => this._boothCellKey(c.x, c.z)));
    const nextCells = booth.cells.map(c => ({ x: c.x + deltaX, z: c.z + deltaZ }));

    for (const c of nextCells) {
      if (c.x < 0 || c.z < 0 || c.x >= floor.width || c.z >= floor.depth) return false;
      const key = this._boothCellKey(c.x, c.z);
      const type = floor.grid[c.x]?.[c.z];
      if (type === CellType.EMPTY) continue;
      if (type === CellType.BOOTH && oldSet.has(key)) continue;
      return false;
    }

    this._captureUndoSnapshot();
    this._unindexBoothCells(floor, booth);
    booth.cells.forEach(c => {
      floor.grid[c.x][c.z] = CellType.EMPTY;
    });
    booth.cells = nextCells;
    booth.cells.forEach(c => {
      floor.grid[c.x][c.z] = CellType.BOOTH;
    });
    this._indexBoothCells(floor, booth);
    bus.emit('booth-updated', booth);
    bus.emit('grid-changed', { floor });
    return true;
  }

  selectBooth(boothId) {
    this.selectedBoothId = boothId;
    this.selectedCell = null;
    bus.emit('booth-selected', boothId);
    bus.emit('cell-selected', null);
  }

  selectCell(x, z, type) {
    const floor = this.activeFloor;
    const cells = floor ? this.getConnectedCells(floor, x, z, type) : [{ x, z }];
    this.selectedCell = { x, z, type, cells };
    this.selectedBoothId = null;
    bus.emit('cell-selected', this.selectedCell);
    bus.emit('booth-selected', null);
  }

  clearSelection() {
    this.selectedBoothId = null;
    this.selectedCell = null;
    bus.emit('booth-selected', null);
    bus.emit('cell-selected', null);
  }

  deleteSelectedCell() {
    if (!this.selectedCell || !this.activeFloor) return;
    const { type } = this.selectedCell;
    const cells = this.getSelectedCellGroupCells();
    if (!cells.length) return;
    this._captureUndoSnapshot();
    if (type === CellType.ESCALATOR) {
      cells.forEach(({ x, z }) => this.removeEscalatorLinksForCell(this.activeFloorIndex, x, z, false));
    }
    cells.forEach(({ x, z }) => {
      this.activeFloor.grid[x][z] = CellType.EMPTY;
    });
    this.selectedCell = null;
    bus.emit('grid-changed', { floor: this.activeFloor });
    bus.emit('cell-selected', null);
  }

  isMovableCellType(type) {
    return type === CellType.CORRIDOR ||
      type === CellType.RESTRICTED ||
      type === CellType.ENTRANCE ||
      type === CellType.LED_SCREEN ||
      type === CellType.ELEVATOR ||
      type === CellType.ESCALATOR;
  }

  getConnectedCells(floor, x, z, type) {
    if (!floor || !this.isMovableCellType(type)) return [];
    if (x < 0 || z < 0 || x >= floor.width || z >= floor.depth) return [];
    if (floor.grid[x]?.[z] !== type) return [];
    const visited = new Set();
    const queue = [{ x, z }];
    const out = [];
    const keyOf = (cx, cz) => `${cx},${cz}`;
    visited.add(keyOf(x, z));
    while (queue.length) {
      const cur = queue.shift();
      out.push(cur);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cur.x + dx;
        const nz = cur.z + dz;
        if (nx < 0 || nz < 0 || nx >= floor.width || nz >= floor.depth) continue;
        if (floor.grid[nx]?.[nz] !== type) continue;
        const key = keyOf(nx, nz);
        if (visited.has(key)) continue;
        visited.add(key);
        queue.push({ x: nx, z: nz });
      }
    }
    return out;
  }

  getSelectedCellGroupCells() {
    const floor = this.activeFloor;
    const selected = this.selectedCell;
    if (!floor || !selected || !this.isMovableCellType(selected.type)) return [];
    const cached = Array.isArray(selected.cells) ? selected.cells : null;
    if (cached?.length) {
      const valid = cached.every(c => floor.grid[c.x]?.[c.z] === selected.type);
      if (valid) return cached.map(c => ({ x: c.x, z: c.z }));
    }
    const cells = this.getConnectedCells(floor, selected.x, selected.z, selected.type);
    this.selectedCell = { ...selected, cells };
    return cells;
  }

  moveSelectedCellGroup(dx, dz) {
    const floor = this.activeFloor;
    const selected = this.selectedCell;
    if (!floor || !selected || !this.isMovableCellType(selected.type)) return false;
    const deltaX = Number(dx) || 0;
    const deltaZ = Number(dz) || 0;
    if (deltaX === 0 && deltaZ === 0) return false;
    const cells = this.getSelectedCellGroupCells();
    if (!cells.length) return false;
    const oldKeys = new Set(cells.map(c => `${c.x},${c.z}`));
    const nextCells = cells.map(c => ({ x: c.x + deltaX, z: c.z + deltaZ }));
    for (const c of nextCells) {
      if (c.x < 0 || c.z < 0 || c.x >= floor.width || c.z >= floor.depth) return false;
      const key = `${c.x},${c.z}`;
      const typeAt = floor.grid[c.x]?.[c.z];
      if (typeAt === CellType.EMPTY) continue;
      if (typeAt === selected.type && oldKeys.has(key)) continue;
      return false;
    }
    this._captureUndoSnapshot();
    const oldToNew = new Map();
    cells.forEach((c, idx) => {
      oldToNew.set(`${c.x},${c.z}`, nextCells[idx]);
    });
    cells.forEach(c => {
      floor.grid[c.x][c.z] = CellType.EMPTY;
    });
    nextCells.forEach(c => {
      floor.grid[c.x][c.z] = selected.type;
    });
    if (selected.type === CellType.ESCALATOR) {
      this.escalatorLinks.forEach(link => {
        if (link.floorA === this.activeFloorIndex) {
          const moved = oldToNew.get(`${link.xA},${link.zA}`);
          if (moved) {
            link.xA = moved.x;
            link.zA = moved.z;
          }
        }
        if (link.floorB === this.activeFloorIndex) {
          const moved = oldToNew.get(`${link.xB},${link.zB}`);
          if (moved) {
            link.xB = moved.x;
            link.zB = moved.z;
          }
        }
      });
      this.sanitizeEscalatorLinks();
      this._invalidateEscalatorLinkIndex();
      bus.emit('escalator-links-changed', this.escalatorLinks);
    }
    const movedAnchor = { x: selected.x + deltaX, z: selected.z + deltaZ };
    this.selectedCell = {
      ...selected,
      x: movedAnchor.x,
      z: movedAnchor.z,
      cells: nextCells
    };
    bus.emit('grid-changed', { floor });
    bus.emit('cell-selected', this.selectedCell);
    return true;
  }

  getSelectedBooth() {
    if (!this.selectedBoothId || !this.activeFloor) return null;
    return this._getBoothByIdOnFloor(this.activeFloor, this.selectedBoothId) ||
      this.activeFloor.booths.find(b => b.id === this.selectedBoothId) || null;
  }

  findBoothAt(x, z) {
    const floor = this.activeFloor;
    if (!floor) return null;
    const index = this._ensureBoothCellIndexForFloor(floor);
    return index.get(this._boothCellKey(x, z)) || null;
  }

  // --- Mode ---
  setEditMode(mode) {
    this.editMode = mode;
    bus.emit('edit-mode-changed', mode);
  }

  setViewFilter(filter) {
    this.viewFilter = filter || 'all';
    bus.emit('view-filter-changed', this.viewFilter);
  }

  setShowFloorAnnotations(show) {
    this.showFloorAnnotations = !!show;
    bus.emit('floor-annotations-changed', this.showFloorAnnotations);
  }

  setPreviewViewPresets(presets = [], activeId = null) {
    this.previewViewPresets = Array.isArray(presets) ? presets.slice(0, this.previewViewPresetLimit) : [];
    this.activePreviewViewPresetId = activeId || null;
    bus.emit('preview-views-changed', {
      presets: this.previewViewPresets,
      activeId: this.activePreviewViewPresetId
    });
  }

  savePreviewViewPreset(preset, targetId = null) {
    if (!preset) return null;
    const now = Date.now();
    if (targetId) {
      const idx = this.previewViewPresets.findIndex(p => p.id === targetId);
      if (idx >= 0) {
        this.previewViewPresets[idx] = {
          ...this.previewViewPresets[idx],
          ...preset,
          id: targetId,
          updatedAt: now
        };
        this.activePreviewViewPresetId = targetId;
        bus.emit('preview-views-changed', {
          presets: this.previewViewPresets,
          activeId: this.activePreviewViewPresetId
        });
        return targetId;
      }
    }
    const id = crypto.randomUUID();
    this.previewViewPresets.push({
      ...preset,
      id,
      createdAt: now,
      updatedAt: now
    });
    if (this.previewViewPresets.length > this.previewViewPresetLimit) {
      const removed = this.previewViewPresets.shift();
      if (removed?.id === this.activePreviewViewPresetId) {
        this.activePreviewViewPresetId = null;
      }
    }
    this.activePreviewViewPresetId = id;
    bus.emit('preview-views-changed', {
      presets: this.previewViewPresets,
      activeId: this.activePreviewViewPresetId
    });
    return id;
  }

  removePreviewViewPreset(id) {
    const idx = this.previewViewPresets.findIndex(p => p.id === id);
    if (idx < 0) return false;
    this.previewViewPresets.splice(idx, 1);
    if (this.activePreviewViewPresetId === id) {
      this.activePreviewViewPresetId = null;
    }
    bus.emit('preview-views-changed', {
      presets: this.previewViewPresets,
      activeId: this.activePreviewViewPresetId
    });
    return true;
  }

  setActivePreviewViewPreset(id) {
    this.activePreviewViewPresetId = id || null;
    bus.emit('preview-views-changed', {
      presets: this.previewViewPresets,
      activeId: this.activePreviewViewPresetId
    });
  }

  getDefaultSnapshotName() {
    return `expoGrid${String(this.snapshotNameSeq).padStart(3, '0')}`;
  }

  markSnapshotSaved() {
    this.snapshotNameSeq += 1;
    bus.emit('snapshot-seq-changed', this.snapshotNameSeq);
  }

  setEditTool(tool) {
    this.editTool = tool;
    this.drawingCells = [];
    bus.emit('tool-changed', tool);
  }

  setBoothTemplate(w, h) {
    this.boothTemplate = { w, h };
  }

  // --- Escalator Links ---
  get escalatorLinks() {
    return this.exhibition ? this.exhibition.escalatorLinks : [];
  }

  addEscalatorLink(floorA, xA, zA, floorB, xB, zB, captureUndo = true) {
    if (!this.exhibition) return null;
    if (Math.abs(floorA - floorB) !== 1) return null;
    if (captureUndo) this._captureUndoSnapshot();
    const link = {
      id: crypto.randomUUID(),
      floorA, xA, zA,
      floorB, xB, zB
    };
    this.exhibition.escalatorLinks.push(link);
    this._invalidateEscalatorLinkIndex();
    bus.emit('escalator-links-changed', this.escalatorLinks);
    return link;
  }

  removeEscalatorLink(linkId) {
    if (!this.exhibition) return;
    const idx = this.exhibition.escalatorLinks.findIndex(l => l.id === linkId);
    if (idx === -1) return;
    this._captureUndoSnapshot();
    this.exhibition.escalatorLinks.splice(idx, 1);
    this._invalidateEscalatorLinkIndex();
    bus.emit('escalator-links-changed', this.escalatorLinks);
  }

  moveEscalatorEndpoint(linkId, floorIndex, newX, newZ) {
    const link = this.escalatorLinks.find(l => l.id === linkId);
    if (!link) return;
    this._captureUndoSnapshot();
    if (link.floorA === floorIndex) {
      link.xA = newX;
      link.zA = newZ;
    } else if (link.floorB === floorIndex) {
      link.xB = newX;
      link.zB = newZ;
    }
    this._invalidateEscalatorLinkIndex();
    bus.emit('escalator-links-changed', this.escalatorLinks);
  }

  moveEscalatorCellGroup(floorIndex, fromX, fromZ, toX, toZ) {
    if (!this.exhibition) return false;
    const floor = this.floors[floorIndex];
    if (!floor) return false;
    if (toX < 0 || toZ < 0 || toX >= floor.width || toZ >= floor.depth) return false;
    if (floor.grid[fromX]?.[fromZ] !== CellType.ESCALATOR) return false;
    if (floor.grid[toX][toZ] !== CellType.EMPTY) return false;

    const linksAtCell = this.findEscalatorLinksAt(floorIndex, fromX, fromZ);
    if (!linksAtCell.length) return false;
    this._captureUndoSnapshot();

    linksAtCell.forEach(link => {
      if (link.floorA === floorIndex) {
        link.xA = toX;
        link.zA = toZ;
      } else if (link.floorB === floorIndex) {
        link.xB = toX;
        link.zB = toZ;
      }
    });
    this._invalidateEscalatorLinkIndex();

    floor.grid[fromX][fromZ] = CellType.EMPTY;
    floor.grid[toX][toZ] = CellType.ESCALATOR;

    const shouldUpdateSelection =
      this.activeFloorIndex === floorIndex &&
      this.selectedCell &&
      this.selectedCell.type === CellType.ESCALATOR &&
      this.selectedCell.x === fromX &&
      this.selectedCell.z === fromZ;

    if (shouldUpdateSelection) {
      this.selectedCell = { x: toX, z: toZ, type: CellType.ESCALATOR };
    }

    bus.emit('escalator-links-changed', this.escalatorLinks);
    bus.emit('grid-changed', { floor });
    if (shouldUpdateSelection) {
      bus.emit('cell-selected', this.selectedCell);
    }

    return true;
  }

  // Backward-compatible alias
  moveEscalatorCell(linkId, floorIndex, fromX, fromZ, toX, toZ) {
    return this.moveEscalatorCellGroup(floorIndex, fromX, fromZ, toX, toZ);
  }

  findEscalatorLinksAt(floorIndex, x, z) {
    const endpointKey = this._makeEscalatorEndpointKey(floorIndex, x, z);
    const index = this._ensureEscalatorLinkIndex();
    return index.byEndpoint.get(endpointKey)?.slice() || [];
  }

  autoDetectEscalatorLink(floorIndex, x, z, captureUndo = true) {
    const floors = this.floors;
    const index = this._ensureEscalatorLinkIndex();
    const candidates = [floorIndex - 1, floorIndex + 1];
    for (const fi of candidates) {
      if (fi < 0 || fi >= floors.length) continue;
      if (x < floors[fi].width && z < floors[fi].depth &&
          floors[fi].grid[x][z] === CellType.ESCALATOR) {
        const pairKey = this._makeEscalatorPairKey(floorIndex, x, z, fi, x, z);
        if (!index.pairSet.has(pairKey)) {
          const [lo, hi] = floorIndex < fi ? [floorIndex, fi] : [fi, floorIndex];
          this.addEscalatorLink(lo, x, z, hi, x, z, captureUndo);
          index.pairSet.add(pairKey);
        }
      }
    }
  }

  removeEscalatorLinksForCell(floorIndex, x, z, captureUndo = true) {
    if (!this.exhibition) return;
    const hasAny = this.exhibition.escalatorLinks.some(l =>
      (l.floorA === floorIndex && l.xA === x && l.zA === z) ||
      (l.floorB === floorIndex && l.xB === x && l.zB === z)
    );
    if (!hasAny) return;
    if (captureUndo) this._captureUndoSnapshot();
    this.exhibition.escalatorLinks = this.exhibition.escalatorLinks.filter(l =>
      !((l.floorA === floorIndex && l.xA === x && l.zA === z) ||
        (l.floorB === floorIndex && l.xB === x && l.zB === z))
    );
    this._invalidateEscalatorLinkIndex();
    bus.emit('escalator-links-changed', this.escalatorLinks);
  }

  sanitizeEscalatorLinks() {
    if (!this.exhibition) return 0;
    const before = this.exhibition.escalatorLinks.length;
    const normalized = [];
    this.exhibition.escalatorLinks.forEach(link => {
      if (typeof link.floorA !== 'number' || typeof link.floorB !== 'number') return;
      if (link.floorA <= link.floorB) {
        normalized.push(link);
      } else {
        normalized.push({
          ...link,
          floorA: link.floorB,
          xA: link.xB,
          zA: link.zB,
          floorB: link.floorA,
          xB: link.xA,
          zB: link.zA
        });
      }
    });

    const seen = new Set();
    this.exhibition.escalatorLinks = normalized.filter(link => {
      const floorA = this.floors[link.floorA];
      const floorB = this.floors[link.floorB];
      if (!floorA || !floorB) return false;
      if (Math.abs(link.floorA - link.floorB) !== 1) return false;
      const inA = link.xA >= 0 && link.zA >= 0 && link.xA < floorA.width && link.zA < floorA.depth;
      const inB = link.xB >= 0 && link.zB >= 0 && link.xB < floorB.width && link.zB < floorB.depth;
      if (!inA || !inB) return false;
      if (floorA.grid?.[link.xA]?.[link.zA] !== CellType.ESCALATOR) return false;
      if (floorB.grid?.[link.xB]?.[link.zB] !== CellType.ESCALATOR) return false;
      const key = `${link.floorA},${link.xA},${link.zA}|${link.floorB},${link.xB},${link.zB}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    this._invalidateEscalatorLinkIndex();
    const removed = before - this.exhibition.escalatorLinks.length;
    if (removed > 0 && !this._isApplyingUndo) {
      bus.emit('escalator-links-changed', this.escalatorLinks);
    }
    return removed;
  }

  // --- Helpers ---
  _isContiguous(cells) {
    if (cells.length <= 1) return true;
    const set = new Set(cells.map(c => `${c.x},${c.z}`));
    const visited = new Set();
    const queue = [cells[0]];
    visited.add(`${cells[0].x},${cells[0].z}`);
    while (queue.length) {
      const { x, z } = queue.shift();
      for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const key = `${x+dx},${z+dz}`;
        if (set.has(key) && !visited.has(key)) {
          visited.add(key);
          queue.push({ x: x+dx, z: z+dz });
        }
      }
    }
    return visited.size === cells.length;
  }

  _boothCellKey(x, z) {
    return `${x},${z}`;
  }

  _makeEscalatorEndpointKey(floor, x, z) {
    return `${floor},${x},${z}`;
  }

  _normalizeEscalatorEndpoints(floorA, xA, zA, floorB, xB, zB) {
    if (floorA <= floorB) return { floorA, xA, zA, floorB, xB, zB };
    return { floorA: floorB, xA: xB, zA: zB, floorB: floorA, xB: xA, zB: zA };
  }

  _makeEscalatorPairKey(floorA, xA, zA, floorB, xB, zB) {
    const n = this._normalizeEscalatorEndpoints(floorA, xA, zA, floorB, xB, zB);
    return `${n.floorA},${n.xA},${n.zA}|${n.floorB},${n.xB},${n.zB}`;
  }

  _invalidateEscalatorLinkIndex() {
    this._escalatorLinkIndex = null;
  }

  _ensureEscalatorLinkIndex() {
    if (this._escalatorLinkIndex) return this._escalatorLinkIndex;
    const byEndpoint = new Map();
    const pairSet = new Set();
    this.escalatorLinks.forEach(link => {
      const keyA = this._makeEscalatorEndpointKey(link.floorA, link.xA, link.zA);
      const keyB = this._makeEscalatorEndpointKey(link.floorB, link.xB, link.zB);
      if (!byEndpoint.has(keyA)) byEndpoint.set(keyA, []);
      if (!byEndpoint.has(keyB)) byEndpoint.set(keyB, []);
      byEndpoint.get(keyA).push(link);
      byEndpoint.get(keyB).push(link);
      pairSet.add(this._makeEscalatorPairKey(
        link.floorA, link.xA, link.zA,
        link.floorB, link.xB, link.zB
      ));
    });
    this._escalatorLinkIndex = { byEndpoint, pairSet };
    return this._escalatorLinkIndex;
  }

  _invalidateBoothIndices(floorId = null) {
    if (floorId == null) {
      this._boothCellIndexByFloorId.clear();
      this._boothByIdIndexByFloorId.clear();
      this._boothPosIndexByFloorId.clear();
      return;
    }
    this._boothCellIndexByFloorId.delete(floorId);
    this._boothByIdIndexByFloorId.delete(floorId);
    this._boothPosIndexByFloorId.delete(floorId);
  }

  _ensureBoothCellIndexForFloor(floor) {
    if (!floor) return new Map();
    let index = this._boothCellIndexByFloorId.get(floor.id);
    if (!index) {
      index = this._rebuildBoothCellIndexForFloor(floor);
    }
    return index;
  }

  _rebuildBoothCellIndexForFloor(floor) {
    const index = new Map();
    if (floor?.booths?.length) {
      floor.booths.forEach(booth => {
        booth.cells.forEach(c => {
          index.set(this._boothCellKey(c.x, c.z), booth);
        });
      });
    }
    if (floor?.id) this._boothCellIndexByFloorId.set(floor.id, index);
    this._rebuildBoothIdIndexForFloor(floor);
    return index;
  }

  _indexBoothCells(floor, booth) {
    if (!floor || !booth) return;
    const index = this._ensureBoothCellIndexForFloor(floor);
    booth.cells.forEach(c => {
      index.set(this._boothCellKey(c.x, c.z), booth);
    });
  }

  _unindexBoothCells(floor, booth) {
    if (!floor || !booth) return;
    const index = this._boothCellIndexByFloorId.get(floor.id);
    if (!index) return;
    booth.cells.forEach(c => {
      const key = this._boothCellKey(c.x, c.z);
      if (index.get(key) === booth) index.delete(key);
    });
  }

  _ensureBoothIdIndicesForFloor(floor) {
    if (!floor) return { byId: new Map(), posById: new Map() };
    let byId = this._boothByIdIndexByFloorId.get(floor.id);
    let posById = this._boothPosIndexByFloorId.get(floor.id);
    if (!byId || !posById) {
      const rebuilt = this._rebuildBoothIdIndexForFloor(floor);
      byId = rebuilt.byId;
      posById = rebuilt.posById;
    }
    return { byId, posById };
  }

  _rebuildBoothIdIndexForFloor(floor) {
    const byId = new Map();
    const posById = new Map();
    if (floor?.booths?.length) {
      floor.booths.forEach((booth, idx) => {
        byId.set(booth.id, booth);
        posById.set(booth.id, idx);
      });
    }
    if (floor?.id) {
      this._boothByIdIndexByFloorId.set(floor.id, byId);
      this._boothPosIndexByFloorId.set(floor.id, posById);
    }
    return { byId, posById };
  }

  _indexBoothById(floor, booth, idx = -1) {
    if (!floor || !booth) return;
    const { byId, posById } = this._ensureBoothIdIndicesForFloor(floor);
    byId.set(booth.id, booth);
    if (idx < 0) {
      idx = floor.booths.findIndex(b => b.id === booth.id);
    }
    if (idx >= 0) posById.set(booth.id, idx);
  }

  _unindexBoothById(floor, boothId) {
    if (!floor || !boothId) return;
    const byId = this._boothByIdIndexByFloorId.get(floor.id);
    const posById = this._boothPosIndexByFloorId.get(floor.id);
    byId?.delete(boothId);
    posById?.delete(boothId);
  }

  _reindexBoothPositionsFrom(floor, startIdx = 0) {
    if (!floor) return;
    const { posById } = this._ensureBoothIdIndicesForFloor(floor);
    for (let i = Math.max(0, startIdx); i < floor.booths.length; i++) {
      posById.set(floor.booths[i].id, i);
    }
  }

  _getBoothByIdOnFloor(floor, boothId) {
    if (!floor || !boothId) return null;
    const byId = this._boothByIdIndexByFloorId.get(floor.id);
    return byId?.get(boothId) || null;
  }

  _getBoothPositionOnFloor(floor, boothId) {
    if (!floor || !boothId) return -1;
    const posById = this._boothPosIndexByFloorId.get(floor.id);
    const idx = posById?.get(boothId);
    return Number.isInteger(idx) ? idx : -1;
  }

  // --- Undo ---
  _pushUndoEntry(entry) {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.undoLimit) {
      this.undoStack.splice(0, this.undoStack.length - this.undoLimit);
    }
  }

  _captureUndoSnapshot() {
    if (!this.exhibition || this._isApplyingUndo) return;
    const snapshot = this._createSnapshot();
    this._pushUndoEntry({ kind: 'snapshot', snapshot });
  }

  _captureUndoPatch(patch) {
    if (!this.exhibition || this._isApplyingUndo || !patch) return;
    this._pushUndoEntry({ kind: 'patch', patch });
  }

  _createSnapshot() {
    return {
      exhibition: this._deepClone(this.exhibition),
      activeFloorIndex: this.activeFloorIndex,
      selectedBoothId: this.selectedBoothId,
      selectedCell: this.selectedCell ? { ...this.selectedCell } : null,
      editMode: this.editMode,
      viewFilter: this.viewFilter,
      editTool: this.editTool
    };
  }

  _deepClone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  _syncIdCounters() {
    const maxByPrefix = {};
    this.floors.forEach(floor => {
      floor.booths.forEach(booth => {
        const m = String(booth.id || '').match(/^([A-Z])(\d+)$/);
        if (!m) return;
        const prefix = m[1];
        const num = Number(m[2]);
        if (!Number.isFinite(num)) return;
        if (!maxByPrefix[prefix] || num > maxByPrefix[prefix]) {
          maxByPrefix[prefix] = num;
        }
      });
    });
    Object.entries(maxByPrefix).forEach(([prefix, num]) => setCounter(prefix, num));
  }

  _findFloorById(floorId) {
    return this.floors.find(f => f.id === floorId) || null;
  }

  _applyUndoPatch(patch) {
    if (!patch || !this.exhibition) return { ok: false };
    if (patch.op === 'setCell') {
      const floor = this._findFloorById(patch.floorId);
      if (!floor) return { ok: false };
      if (patch.x < 0 || patch.z < 0 || patch.x >= floor.width || patch.z >= floor.depth) return { ok: false };
      floor.grid[patch.x][patch.z] = patch.from;
      if (patch.escalatorLinksBefore) {
        this.exhibition.escalatorLinks = this._deepClone(patch.escalatorLinksBefore);
        this._invalidateEscalatorLinkIndex();
      }
      if (
        this.activeFloor?.id === floor.id &&
        this.selectedCell &&
        this.selectedCell.x === patch.x &&
        this.selectedCell.z === patch.z
      ) {
        if (patch.from === CellType.ELEVATOR || patch.from === CellType.ESCALATOR || patch.from === CellType.LED_SCREEN) {
          this.selectedCell = { x: patch.x, z: patch.z, type: patch.from };
        } else {
          this.selectedCell = null;
        }
      }
      return { ok: true, kind: 'setCell', floor, x: patch.x, z: patch.z, type: patch.from, linksChanged: !!patch.escalatorLinksBefore };
    }

    if (patch.op === 'setCells') {
      const floor = this._findFloorById(patch.floorId);
      if (!floor) return { ok: false };
      patch.changes.forEach(({ x, z, from }) => {
        if (x >= 0 && z >= 0 && x < floor.width && z < floor.depth) {
          floor.grid[x][z] = from;
        }
      });
      return { ok: true, kind: 'setCells', floor };
    }

    if (patch.op === 'updateBooth') {
      const floor = this._findFloorById(patch.floorId);
      if (!floor) return { ok: false };
      const booth = floor.booths.find(b => b.id === patch.boothId);
      if (!booth) return { ok: false };
      const before = patch.before || {};
      if (before.pricePerUnit !== undefined) {
        booth.pricePerUnit = before.pricePerUnit;
        booth.totalPrice = booth.pricePerUnit * booth.area;
      }
      if (before.orientation !== undefined) booth.orientation = before.orientation;
      if (before.power !== undefined) booth.power = { ...booth.power, ...before.power };
      if (before.status !== undefined) booth.status = before.status;
      if (before.brandName !== undefined) booth.brandName = before.brandName;
      if (before.contactName !== undefined) booth.contactName = before.contactName;
      if (before.companyName !== undefined) booth.companyName = before.companyName;
      if (before.website !== undefined) booth.website = before.website;
      if (before.contactEmail !== undefined) booth.contactEmail = before.contactEmail;
      if (before.boothRent !== undefined) booth.boothRent = before.boothRent;
      return { ok: true, kind: 'updateBooth', booth };
    }

    return { ok: false };
  }

  undo() {
    if (!this.undoStack.length) return false;
    const entry = this.undoStack.pop();
    this._isApplyingUndo = true;
    const isPatch = entry?.kind === 'patch';
    const snapshot = entry?.kind === 'snapshot' ? entry.snapshot : entry;
    let patchResult = null;

    if (isPatch) {
      patchResult = this._applyUndoPatch(entry.patch);
      this._isApplyingUndo = false;
      if (!patchResult?.ok) return false;
      if (patchResult.kind === 'setCell') {
        bus.emit('grid-changed', { floor: patchResult.floor, x: patchResult.x, z: patchResult.z, type: patchResult.type });
        if (patchResult.linksChanged) bus.emit('escalator-links-changed', this.escalatorLinks);
      } else if (patchResult.kind === 'setCells') {
        bus.emit('grid-changed', { floor: patchResult.floor });
      } else if (patchResult.kind === 'updateBooth') {
        bus.emit('booth-updated', patchResult.booth);
      }
      bus.emit('booth-selected', this.selectedBoothId);
      bus.emit('cell-selected', this.selectedCell);
      return true;
    }

    this.exhibition = this._deepClone(snapshot.exhibition);
    this._invalidateBoothIndices();
    this._invalidateEscalatorLinkIndex();
    this.activeFloorIndex = Math.max(0, Math.min(snapshot.activeFloorIndex, this.floors.length - 1));
    this.selectedBoothId = snapshot.selectedBoothId || null;
    this.selectedCell = snapshot.selectedCell ? { ...snapshot.selectedCell } : null;
    this.editMode = snapshot.editMode || this.editMode;
    this.viewFilter = snapshot.viewFilter || 'all';
    this.editTool = snapshot.editTool || 'select';
    this.drawingCells = [];
    this.sanitizeEscalatorLinks();
    this._syncIdCounters();
    this._isApplyingUndo = false;
    bus.emit('exhibition-changed', this.exhibition);
    bus.emit('active-floor-changed', this.activeFloorIndex);
    bus.emit('floor-changed', this.activeFloor);
    bus.emit('grid-changed', { floor: this.activeFloor });
    bus.emit('escalator-links-changed', this.escalatorLinks);
    bus.emit('booth-selected', this.selectedBoothId);
    bus.emit('cell-selected', this.selectedCell);
    bus.emit('tool-changed', this.editTool);
    bus.emit('view-filter-changed', this.viewFilter);
    bus.emit('edit-mode-changed', this.editMode);
    return true;
  }
}

export const store = new Store();
