import { bus } from '../utils/EventBus.js';
import { store } from '../data/Store.js';
import { CellType } from '../data/ExhibitionModel.js';

const COLORS = {
  empty: '#faf6f0',
  corridor: '#b0bec5',
  restricted: '#78909c',
  entrance: '#26a69a',
  ledScreen: '#90a4ae',
  elevator: '#5c6bc0',
  escalator: '#7e57c2',
  booth: '#e0e0e0',
  boothIdle: '#4caf50',
  boothReserved: '#ff9800',
  boothSold: '#f44336',
  grid: '#d7cec4',
  ghost: 'rgba(76,175,80,0.35)',
  ghostInvalid: 'rgba(244,67,54,0.35)',
  drawing: 'rgba(33,150,243,0.4)',
  selected: '#2196f3'
};

const TENANT_COLORS = {
  background: '#f3ede5',
  available: '#4caf50',
  rented: '#f25f4c',
  recommended: '#ffffff'
};
const TENANT_RECOMMENDED_OUTLINE = '#d4af37';

const TOOL_CURSOR_SYMBOL = {
  select: '\u261E',
  corridor: '\u25AC',
  restricted: '\u25A6',
  entrance: '\u25B6',
  ledScreen: '\u25AD',
  elevator: '\u21D5',
  escalator: '\u2B0D',
  boothTemplate: '\u25A0',
  boothDraw: '\u270E'
};

export class GridEditor {
  constructor(container, options = {}) {
    this.container = container;
    this.readOnly = !!options.readOnly;
    this.tenantView = !!options.tenantView;
    this.lockZoom = !!options.lockZoom;
    this._mobileQuery = window.matchMedia('(max-width: 768px)');
    this.tenantHighlightBoothId = String(options.tenantHighlightBoothId || '');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'grid-canvas';
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.staticCanvas = document.createElement('canvas');
    this.staticCtx = this.staticCanvas.getContext('2d');
    this._staticDirty = true;
    this._staticDirtyRects = [];
    this._drawRaf = null;

    this.cellSize = 20;
    this.panX = 0;
    this.panY = 0;
    this.isPanning = false;
    this.lastMouse = null;
    this.ghostPos = null;
    this.isDrawing = false;
    this.draggingEscalator = null; // { floorIndex, origX, origZ, curX, curZ }
    this._pendingPan = null;
    this._pendingBoothMove = null;
    this._pendingCellMove = null;
    this._pendingDrag = null;
    this._pendingBoothRect = null;
    this.boothDrawRect = null; // { x1, z1, x2, z2, active }
    this._capturedPointerId = null;
    this._unsubs = [];
    this._eventController = new AbortController();

    this._bindEvents();
    this._subscribeStore();
    this._resize();
    this._applyToolCursor();
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize, { signal: this._eventController.signal });

    // Tips bar
    if (!this.readOnly && !this.tenantView) {
      this._tipsEl = document.createElement('div');
      this._tipsEl.className = 'grid-tips-bar';
      this.container.appendChild(this._tipsEl);
      this._updateTips();
    }
  }

  _subscribeStore() {
    this._unsubs.push(bus.on('active-floor-changed', () => this._centerGrid()));
    this._unsubs.push(bus.on('floor-changed', () => this._centerGrid()));
    this._unsubs.push(bus.on('grid-changed', payload => this._onGridChanged(payload)));
    this._unsubs.push(bus.on('booth-added', () => this.draw(true)));
    this._unsubs.push(bus.on('booth-removed', () => this.draw(true)));
    this._unsubs.push(bus.on('booth-updated', () => this.draw(true)));
    this._unsubs.push(bus.on('booth-selected', () => this.draw(true)));
    this._unsubs.push(bus.on('tool-changed', () => {
      store.drawingCells = [];
      this._pendingBoothRect = null;
      this.boothDrawRect = null;
      this._applyToolCursor();
      this._updateTips();
      this.draw(true);
    }));
    this._unsubs.push(bus.on('escalator-links-changed', () => this.draw(true)));
    this._unsubs.push(bus.on('cell-selected', () => this.draw(true)));
    this._unsubs.push(bus.on('view-filter-changed', () => this.draw(true)));
    this._unsubs.push(bus.on('file-switched', () => this._onFileSwitched()));
  }

  _onFileSwitched() {
    this._pendingPan = null;
    this._pendingBoothMove = null;
    this._pendingCellMove = null;
    this._pendingDrag = null;
    this._pendingBoothRect = null;
    this.boothDrawRect = null;
    this.ghostPos = null;
    this._staticDirty = true;
    this._staticDirtyRects = [];
    this._centerGrid();
  }

  _resize() {
    const rect = this.container.getBoundingClientRect();
    this.canvas.width = rect.width * devicePixelRatio;
    this.canvas.height = rect.height * devicePixelRatio;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    this.staticCanvas.width = rect.width * devicePixelRatio;
    this.staticCanvas.height = rect.height * devicePixelRatio;
    this.staticCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    this._staticDirty = true;
    this._staticDirtyRects = [];
    this._centerGrid();
  }

  _centerGrid() {
    if (this._mobileQuery.matches) {
      this.fitToView();
      return;
    }
    const floor = store.activeFloor;
    if (!floor) return;
    const rect = this.container.getBoundingClientRect();
    this.panX = (rect.width - floor.width * this.cellSize) / 2;
    this.panY = (rect.height - floor.depth * this.cellSize) / 2;
    this.draw(true);
  }

  _screenToGrid(sx, sy) {
    const x = Math.floor((sx - this.panX) / this.cellSize);
    const z = Math.floor((sy - this.panY) / this.cellSize);
    return { x, z };
  }

  _cellColor(floor, x, z) {
    const type = floor.grid[x][z];
    if (this.tenantView) {
      if (type !== CellType.BOOTH) return TENANT_COLORS.background;
      const booth = store.findBoothAt(x, z);
      if (booth && this.tenantHighlightBoothId && booth.id === this.tenantHighlightBoothId) {
        return TENANT_COLORS.recommended;
      }
      const rented = booth && (booth.status === 'reserved' || booth.status === 'sold');
      return rented ? TENANT_COLORS.rented : TENANT_COLORS.available;
    }
    if (!this._isCellVisible(type, x, z)) return COLORS.empty;
    if (this._isSelectedPublicCell(type, x, z)) {
      return COLORS.selected;
    }
    if (type === CellType.BOOTH) {
      const booth = store.findBoothAt(x, z);
      if (booth) {
        if (booth.id === store.selectedBoothId) return COLORS.selected;
        return COLORS['booth' + booth.status.charAt(0).toUpperCase() + booth.status.slice(1)];
      }
      return COLORS.booth;
    }
    return COLORS[type] || COLORS.empty;
  }

  _isSelectedPublicCell(type, x, z) {
    if (!store.selectedCell) return false;
    if (!store.isMovableCellType?.(type)) return false;
    if (store.selectedCell.type !== type) return false;
    const selectedCells = Array.isArray(store.selectedCell.cells) ? store.selectedCell.cells : [];
    if (selectedCells.length) {
      return selectedCells.some(c => c.x === x && c.z === z);
    }
    return store.selectedCell.x === x && store.selectedCell.z === z;
  }

  _isBoothStatusVisible(booth) {
    if (store.viewFilter === 'booth') return true;
    if (store.viewFilter === 'booth-reserved') return booth.status === 'reserved';
    if (store.viewFilter === 'booth-sold') return booth.status === 'sold';
    return false;
  }

  _isCellVisible(type, x, z) {
    const filter = store.viewFilter;
    if (filter === 'all') return true;
    if (type === CellType.BOOTH) {
      const booth = store.findBoothAt(x, z);
      if (!booth) return false;
      return this._isBoothStatusVisible(booth);
    }
    const map = {
      corridor: CellType.CORRIDOR,
      restricted: CellType.RESTRICTED,
      entrance: CellType.ENTRANCE,
      ledScreen: CellType.LED_SCREEN,
      elevator: CellType.ELEVATOR,
      escalator: CellType.ESCALATOR
    };
    return map[filter] === type;
  }

  _normalizeEscalatorDirection(direction) {
    if (direction === 'up' || direction === 'down' || direction === 'bidirectional') return direction;
    return 'bidirectional';
  }

  _getLocalEscalatorArrow(link, floorIdx) {
    const direction = this._normalizeEscalatorDirection(link.direction);
    if (direction === 'bidirectional') return '\u21D5';
    const atFloorA = floorIdx === link.floorA;
    const isUp = direction === 'up';
    if (atFloorA) return isUp ? '\u2191' : '\u2193';
    return isUp ? '\u2193' : '\u2191';
  }

  _onGridChanged(payload) {
    const floor = store.activeFloor;
    if (!floor) return;
    if (!payload || payload.floor !== floor || !Number.isInteger(payload.x) || !Number.isInteger(payload.z)) {
      this.draw(true);
      return;
    }
    this.draw(false, { xMin: payload.x, xMax: payload.x, zMin: payload.z, zMax: payload.z });
  }

  _queueDirtyRect(rect) {
    if (!rect) return;
    this._staticDirtyRects.push(rect);
  }

  _consumeDirtyRectUnion() {
    if (!this._staticDirtyRects.length) return null;
    let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
    this._staticDirtyRects.forEach(r => {
      if (!r) return;
      xMin = Math.min(xMin, r.xMin);
      xMax = Math.max(xMax, r.xMax);
      zMin = Math.min(zMin, r.zMin);
      zMax = Math.max(zMax, r.zMax);
    });
    this._staticDirtyRects = [];
    if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || !Number.isFinite(zMin) || !Number.isFinite(zMax)) return null;
    return { xMin, xMax, zMin, zMax };
  }

  draw(staticDirty = true, dirtyRect = null) {
    if (staticDirty) {
      this._staticDirty = true;
      this._staticDirtyRects = [];
    } else if (dirtyRect) {
      this._queueDirtyRect(dirtyRect);
    }
    if (this._drawRaf) return;
    this._drawRaf = requestAnimationFrame(() => {
      this._drawRaf = null;
      this._drawNow();
    });
  }

  _drawNow() {
    const floor = store.activeFloor;
    const rect = this.container.getBoundingClientRect();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (!floor) return;
    if (this._staticDirty) {
      this._renderStaticLayer(floor, rect);
      this._staticDirty = false;
      this._staticDirtyRects = [];
    } else {
      const dirtyUnion = this._consumeDirtyRectUnion();
      if (dirtyUnion) this._renderStaticLayer(floor, rect, dirtyUnion);
    }
    ctx.drawImage(this.staticCanvas, 0, 0, rect.width, rect.height);
    this._renderDynamicLayer(floor);
  }

  _renderStaticLayer(floor, rect, dirty = null) {
    const ctx = this.staticCtx;
    const cs = this.cellSize;
    const px = this.panX;
    const py = this.panY;
    const xStart = dirty ? Math.max(0, dirty.xMin) : 0;
    const zStart = dirty ? Math.max(0, dirty.zMin) : 0;
    const xEnd = dirty ? Math.min(floor.width - 1, dirty.xMax) : (floor.width - 1);
    const zEnd = dirty ? Math.min(floor.depth - 1, dirty.zMax) : (floor.depth - 1);

    if (xEnd < xStart || zEnd < zStart) return;

    if (!dirty) {
      ctx.clearRect(0, 0, rect.width, rect.height);
    } else {
      const clearX = px + xStart * cs - 2;
      const clearY = py + zStart * cs - 2;
      const clearW = (xEnd - xStart + 1) * cs + 4;
      const clearH = (zEnd - zStart + 1) * cs + 4;
      ctx.save();
      ctx.clearRect(clearX, clearY, clearW, clearH);
      ctx.beginPath();
      ctx.rect(clearX, clearY, clearW, clearH);
      ctx.clip();
    }

    // Draw cells
    for (let x = xStart; x <= xEnd; x++) {
      for (let z = zStart; z <= zEnd; z++) {
        ctx.fillStyle = this._cellColor(floor, x, z);
        ctx.fillRect(px + x * cs, py + z * cs, cs, cs);
        ctx.strokeStyle = COLORS.grid;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(px + x * cs, py + z * cs, cs, cs);
        if (this.tenantView && this.tenantHighlightBoothId && floor.grid[x][z] === CellType.BOOTH) {
          const booth = store.findBoothAt(x, z);
          if (booth && booth.id === this.tenantHighlightBoothId) {
            ctx.strokeStyle = TENANT_RECOMMENDED_OUTLINE;
            ctx.lineWidth = 1.6;
            ctx.strokeRect(px + x * cs + 1, py + z * cs + 1, cs - 2, cs - 2);
          }
        }
      }
    }

    // Draw booth labels
    ctx.font = `bold ${Math.max(10, cs * 0.28)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    floor.booths.forEach(booth => {
      if (!this.tenantView && store.viewFilter !== 'all' && !this._isBoothStatusVisible(booth)) return;
      if (!booth.cells.length) return;
      let cx = 0, cz = 0;
      booth.cells.forEach(c => { cx += c.x; cz += c.z; });
      cx = px + (cx / booth.cells.length + 0.5) * cs;
      cz = py + (cz / booth.cells.length + 0.5) * cs;
      if (this.tenantView && this.tenantHighlightBoothId && booth.id === this.tenantHighlightBoothId) {
        ctx.fillStyle = '#6a4b07';
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = Math.max(1, cs * 0.06);
        ctx.strokeText(booth.id, cx, cz);
      } else {
        ctx.fillStyle = '#fff';
      }
      ctx.fillText(booth.id, cx, cz);
    });

    // Draw elevator/escalator icons
    if (!this.tenantView) {
    ctx.font = `${Math.max(12, cs * 0.45)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let x = xStart; x <= xEnd; x++) {
      for (let z = zStart; z <= zEnd; z++) {
        const t = floor.grid[x][z];
        if (t === CellType.ELEVATOR) {
          if (!this._isCellVisible(t, x, z)) continue;
          ctx.fillStyle = '#fff';
          ctx.fillText('\u21D5', px + (x + 0.5) * cs, py + (z + 0.5) * cs);
        } else if (t === CellType.ESCALATOR) {
          if (!this._isCellVisible(t, x, z)) continue;
          ctx.fillStyle = '#fff';
          ctx.fillText('\u2B0D', px + (x + 0.5) * cs, py + (z + 0.5) * cs);
        } else if (t === CellType.LED_SCREEN) {
          if (!this._isCellVisible(t, x, z)) continue;
          ctx.fillStyle = '#1f2933';
          ctx.font = `bold ${Math.max(8, cs * 0.28)}px sans-serif`;
          ctx.fillText('LED', px + (x + 0.5) * cs, py + (z + 0.5) * cs);
          ctx.font = `${Math.max(12, cs * 0.45)}px sans-serif`;
        }
      }
    }
    }

    // Draw escalator link indicators (show linked floor info)
    if (!this.tenantView) {
      const floorIdx = store.activeFloorIndex;
      const links = store.escalatorLinks;
      ctx.font = `bold ${Math.max(8, cs * 0.22)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      links.forEach(link => {
        if (store.viewFilter !== 'all' && store.viewFilter !== 'escalator') return;
        let cellX, cellZ, otherFloor;
        if (link.floorA === floorIdx) {
          cellX = link.xA; cellZ = link.zA;
          otherFloor = link.floorB;
        } else if (link.floorB === floorIdx) {
          cellX = link.xB; cellZ = link.zB;
          otherFloor = link.floorA;
        } else return;
        if (cellX >= floor.width || cellZ >= floor.depth) return;
        const arrow = this._getLocalEscalatorArrow(link, floorIdx);
        const label = `${arrow} L${otherFloor + 1}`;
        ctx.fillStyle = '#ffeb3b';
        ctx.fillText(label, px + (cellX + 0.5) * cs, py + cellZ * cs + cs * 0.18);
        // Highlight linked escalator cells with a border
        ctx.strokeStyle = '#ffeb3b';
        ctx.lineWidth = 2;
        ctx.strokeRect(px + cellX * cs + 1, py + cellZ * cs + 1, cs - 2, cs - 2);
      });
    }
    if (dirty) ctx.restore();

    // Draw scale indicator (bottom-right of grid)
    if (!dirty) {
      this._renderScaleIndicator(ctx, floor, rect);
    }
  }

  _renderScaleIndicator(ctx, floor, rect) {
    const cs = this.cellSize;
    const px = this.panX;
    const py = this.panY;
    const gridRight = px + floor.width * cs;
    const gridBottom = py + floor.depth * cs;
    const margin = 8;
    const barLen = cs * 5;
    const barX = gridRight - barLen;
    const barY = gridBottom + margin + 4;

    // Scale bar line
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(barX, barY);
    ctx.lineTo(barX + barLen, barY);
    ctx.stroke();
    // End ticks
    ctx.beginPath();
    ctx.moveTo(barX, barY - 4);
    ctx.lineTo(barX, barY + 4);
    ctx.moveTo(barX + barLen, barY - 4);
    ctx.lineTo(barX + barLen, barY + 4);
    ctx.stroke();

    // Label: "5m"
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#666';
    ctx.fillText('5m', barX + barLen / 2, barY + 5);

    // Description text
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('1格 = 1m × 1m', gridRight, barY + 20);
  }

  _renderDynamicLayer(floor) {
    if (this.readOnly) return;
    const ctx = this.ctx;
    const cs = this.cellSize;
    const px = this.panX;
    const py = this.panY;

    this._renderBoothMovePreview(floor, ctx, { cs, px, py });
    this._renderCellMovePreview(floor, ctx, { cs, px, py });

    // Draw drag ghost for escalator
    if (this.draggingEscalator) {
      const d = this.draggingEscalator;
      ctx.fillStyle = 'rgba(126, 87, 194, 0.5)';
      ctx.fillRect(px + d.curX * cs, py + d.curZ * cs, cs, cs);
      ctx.strokeStyle = '#ffeb3b';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(px + d.curX * cs, py + d.curZ * cs, cs, cs);
      ctx.setLineDash([]);
      ctx.font = `${Math.max(12, cs * 0.45)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText('\u2B0D', px + (d.curX + 0.5) * cs, py + (d.curZ + 0.5) * cs);
    }

    // Draw ghost (template mode)
    if (store.editTool === 'boothTemplate' && this.ghostPos) {
      const { w, h } = store.boothTemplate;
      const gx = this.ghostPos.x;
      const gz = this.ghostPos.z;
      let valid = true;
      for (let dx = 0; dx < w; dx++) {
        for (let dz = 0; dz < h; dz++) {
          const cx = gx + dx, cz = gz + dz;
          if (cx >= floor.width || cz >= floor.depth ||
              floor.grid[cx]?.[cz] !== CellType.EMPTY) {
            valid = false;
          }
        }
      }
      ctx.fillStyle = valid ? COLORS.ghost : COLORS.ghostInvalid;
      ctx.fillRect(px + gx * cs, py + gz * cs, w * cs, h * cs);
    }

    // Draw drawing cells (manual draw mode)
    if (store.drawingCells.length) {
      ctx.fillStyle = COLORS.drawing;
      store.drawingCells.forEach(c => {
        ctx.fillRect(px + c.x * cs, py + c.z * cs, cs, cs);
      });
    }

    // Draw booth-draw drag rectangle preview
    if (this.boothDrawRect?.active) {
      const xMin = Math.min(this.boothDrawRect.x1, this.boothDrawRect.x2);
      const xMax = Math.max(this.boothDrawRect.x1, this.boothDrawRect.x2);
      const zMin = Math.min(this.boothDrawRect.z1, this.boothDrawRect.z2);
      const zMax = Math.max(this.boothDrawRect.z1, this.boothDrawRect.z2);
      const w = xMax - xMin + 1;
      const h = zMax - zMin + 1;
      ctx.fillStyle = 'rgba(33,150,243,0.2)';
      ctx.fillRect(px + xMin * cs, py + zMin * cs, w * cs, h * cs);
      ctx.strokeStyle = '#2196f3';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(px + xMin * cs, py + zMin * cs, w * cs, h * cs);
      ctx.setLineDash([]);
    }
  }

  _getBoothMovePreview(floor) {
    const pending = this._pendingBoothMove;
    if (!pending || !pending.active) return null;
    const booth = floor?.booths?.find?.(b => b.id === pending.boothId);
    if (!booth) return null;
    const dx = pending.curX - pending.startX;
    const dz = pending.curZ - pending.startZ;
    const oldKeys = new Set(booth.cells.map(c => `${c.x},${c.z}`));
    const nextCells = booth.cells.map(c => ({ x: c.x + dx, z: c.z + dz }));
    let valid = true;
    for (const c of nextCells) {
      if (c.x < 0 || c.z < 0 || c.x >= floor.width || c.z >= floor.depth) {
        valid = false;
        break;
      }
      const key = `${c.x},${c.z}`;
      if (oldKeys.has(key)) continue;
      const cellType = floor.grid[c.x]?.[c.z];
      if (cellType !== CellType.EMPTY) {
        valid = false;
        break;
      }
    }
    return { booth, nextCells, valid };
  }

  _renderBoothMovePreview(floor, ctx, { cs, px, py }) {
    const preview = this._getBoothMovePreview(floor);
    if (!preview) return;
    const { booth, nextCells, valid } = preview;

    // Fade out old booth cells, so the moving preview appears to "lift" from origin.
    ctx.fillStyle = COLORS.empty;
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 0.5;
    booth.cells.forEach(c => {
      ctx.fillRect(px + c.x * cs, py + c.z * cs, cs, cs);
      ctx.strokeRect(px + c.x * cs, py + c.z * cs, cs, cs);
    });

    const baseColor = valid ? 'rgba(33,150,243,0.36)' : 'rgba(244,67,54,0.36)';
    const borderColor = valid ? '#2196f3' : '#f44336';
    ctx.fillStyle = baseColor;
    nextCells.forEach(c => {
      ctx.fillRect(px + c.x * cs, py + c.z * cs, cs, cs);
    });
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    nextCells.forEach(c => {
      ctx.strokeRect(px + c.x * cs + 1, py + c.z * cs + 1, cs - 2, cs - 2);
    });
    ctx.setLineDash([]);

    if (nextCells.length) {
      let cx = 0;
      let cz = 0;
      nextCells.forEach(c => { cx += c.x; cz += c.z; });
      cx = px + (cx / nextCells.length + 0.5) * cs;
      cz = py + (cz / nextCells.length + 0.5) * cs;
      ctx.font = `bold ${Math.max(10, cs * 0.28)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(booth.id, cx, cz);
    }
  }

  _getCellMovePreview(floor) {
    const pending = this._pendingCellMove;
    const selected = store.selectedCell;
    if (!pending || !pending.active || !selected) return null;
    const type = selected.type;
    if (!store.isMovableCellType?.(type)) return null;
    const baseCells = store.getSelectedCellGroupCells?.() || [];
    if (!baseCells.length) return null;
    const dx = pending.curX - pending.startX;
    const dz = pending.curZ - pending.startZ;
    const oldKeys = new Set(baseCells.map(c => `${c.x},${c.z}`));
    const nextCells = baseCells.map(c => ({ x: c.x + dx, z: c.z + dz }));
    let valid = true;
    for (const c of nextCells) {
      if (c.x < 0 || c.z < 0 || c.x >= floor.width || c.z >= floor.depth) {
        valid = false;
        break;
      }
      const key = `${c.x},${c.z}`;
      const cellType = floor.grid[c.x]?.[c.z];
      if (cellType === CellType.EMPTY) continue;
      if (cellType === type && oldKeys.has(key)) continue;
      valid = false;
      break;
    }
    return { type, baseCells, nextCells, valid };
  }

  _renderCellMovePreview(floor, ctx, { cs, px, py }) {
    const preview = this._getCellMovePreview(floor);
    if (!preview) return;
    const { type, baseCells, nextCells, valid } = preview;
    ctx.fillStyle = COLORS.empty;
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 0.5;
    baseCells.forEach(c => {
      ctx.fillRect(px + c.x * cs, py + c.z * cs, cs, cs);
      ctx.strokeRect(px + c.x * cs, py + c.z * cs, cs, cs);
    });
    const baseColor = valid ? 'rgba(33,150,243,0.36)' : 'rgba(244,67,54,0.36)';
    const borderColor = valid ? '#2196f3' : '#f44336';
    ctx.fillStyle = baseColor;
    nextCells.forEach(c => {
      ctx.fillRect(px + c.x * cs, py + c.z * cs, cs, cs);
    });
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    nextCells.forEach(c => {
      ctx.strokeRect(px + c.x * cs + 1, py + c.z * cs + 1, cs - 2, cs - 2);
    });
    ctx.setLineDash([]);
    const iconMap = {
      [CellType.CORRIDOR]: '▬',
      [CellType.RESTRICTED]: '▦',
      [CellType.ENTRANCE]: '▶',
      [CellType.LED_SCREEN]: 'LED',
      [CellType.ELEVATOR]: '⇕',
      [CellType.ESCALATOR]: '⬍'
    };
    const icon = iconMap[type] || '';
    if (!icon) return;
    ctx.font = `bold ${Math.max(8, cs * 0.26)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    nextCells.forEach(c => {
      ctx.fillText(icon, px + (c.x + 0.5) * cs, py + (c.z + 0.5) * cs);
    });
  }

  _bindEvents() {
    const c = this.canvas;
    const signal = this._eventController.signal;
    const capturePointer = pointerId => {
      if (typeof c.setPointerCapture !== 'function') return;
      try {
        c.setPointerCapture(pointerId);
        this._capturedPointerId = pointerId;
      } catch {}
    };
    const releaseCapturedPointer = () => {
      if (this._capturedPointerId == null) return;
      if (typeof c.releasePointerCapture === 'function') {
        try { c.releasePointerCapture(this._capturedPointerId); } catch {}
      }
      this._capturedPointerId = null;
    };
    const resetPointerState = () => {
      releaseCapturedPointer();
      if (this._pendingBoothMove?.timer) {
        clearTimeout(this._pendingBoothMove.timer);
      }
      if (this._pendingCellMove?.timer) {
        clearTimeout(this._pendingCellMove.timer);
      }
      this.isPanning = false;
      this.lastMouse = null;
      this.isDrawing = false;
      this._pendingPan = null;
      this._pendingBoothMove = null;
      this._pendingCellMove = null;
      this._pendingDrag = null;
      this._pendingBoothRect = null;
      this.boothDrawRect = null;
      this._applyToolCursor();
    };

    c.addEventListener('wheel', e => {
      e.preventDefault();
      if (this.lockZoom) return;
      const delta = e.deltaY > 0 ? -2 : 2;
      const newSize = Math.max(12, Math.min(80, this.cellSize + delta));
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const ratio = newSize / this.cellSize;
      this.panX = mx - (mx - this.panX) * ratio;
      this.panY = my - (my - this.panY) * ratio;
      this.cellSize = newSize;
      this.draw(true);
    }, { passive: false, signal });

    c.addEventListener('pointerdown', e => {
      if (this.readOnly) {
        if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
        this.isPanning = true;
        this.lastMouse = { x: e.clientX, y: e.clientY };
        this.canvas.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }
      if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
        this.isPanning = true;
        this.lastMouse = { x: e.clientX, y: e.clientY };
        this.canvas.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;
      const rect = c.getBoundingClientRect();
      const { x, z } = this._screenToGrid(e.clientX - rect.left, e.clientY - rect.top);
      const floor = store.activeFloor;
      if (store.editTool === 'boothDraw') {
        this._pendingBoothRect = {
          startX: x,
          startZ: z,
          lastX: x,
          lastZ: z,
          startScreenX: e.clientX,
          startScreenY: e.clientY,
          pointerId: e.pointerId
        };
        this.boothDrawRect = { x1: x, z1: z, x2: x, z2: z, active: false };
        capturePointer(e.pointerId);
        return;
      }
      // Prepare potential escalator drag (only for escalator tool)
      if (store.editTool === 'escalator') {
        if (floor && x >= 0 && z >= 0 && x < floor.width && z < floor.depth &&
            floor.grid[x][z] === CellType.ESCALATOR) {
          // Avoid conflict with link-association workflow:
          // escalator move is explicit (Shift+drag), default click only selects.
          if (e.shiftKey) {
            const linksAtCell = store.findEscalatorLinksAt(store.activeFloorIndex, x, z);
            if (linksAtCell.length > 0) {
              this._pendingDrag = {
                floorIndex: store.activeFloorIndex,
                origX: x, origZ: z,
                startScreenX: e.clientX, startScreenY: e.clientY,
                pointerId: e.pointerId
              };
              // Don't start drag yet — wait for move
              // Still call handleClick for selection
              this._handleClick(x, z);
              return;
            }
          }
        }
      }
      if (store.editTool === 'select') {
        if (floor && x >= 0 && z >= 0 && x < floor.width && z < floor.depth) {
          const booth = floor.grid[x][z] === CellType.BOOTH ? store.findBoothAt(x, z) : null;
          if (booth) {
            if (store.selectedBoothId !== booth.id) {
              store.selectBooth(booth.id);
            }
            const pending = {
              boothId: booth.id,
              startX: x,
              startZ: z,
              curX: x,
              curZ: z,
              startScreenX: e.clientX,
              startScreenY: e.clientY,
              pointerId: e.pointerId,
              active: false,
              timer: null
            };
            this._pendingBoothMove = pending;
            return;
          }
          const cellType = floor.grid[x][z];
          if (store.isMovableCellType?.(cellType)) {
            if (cellType === CellType.ESCALATOR && !e.shiftKey) {
              // Escalator association is frequent; require Shift to drag-move.
              store.selectCell(x, z, cellType);
              this.draw(true);
              return;
            }
            // Always reselect to force selected-info panel refresh
            // (prevents stale UI when gesture state consumed previous updates).
            store.selectCell(x, z, cellType);
            const pending = {
              startX: x,
              startZ: z,
              curX: x,
              curZ: z,
              startScreenX: e.clientX,
              startScreenY: e.clientY,
              pointerId: e.pointerId,
              active: false,
              timer: null
            };
            this._pendingCellMove = pending;
            return;
          }
        }
        this._pendingPan = {
          startScreenX: e.clientX,
          startScreenY: e.clientY,
          pointerId: e.pointerId
        };
        return;
      }
      this._handleClick(x, z);
    }, { signal });

    c.addEventListener('pointermove', e => {
      if (this._pendingBoothMove) {
        const rect = c.getBoundingClientRect();
        const { x, z } = this._screenToGrid(e.clientX - rect.left, e.clientY - rect.top);
        if (!this._pendingBoothMove.active) {
          const dx = e.clientX - this._pendingBoothMove.startScreenX;
          const dy = e.clientY - this._pendingBoothMove.startScreenY;
          if (Math.abs(dx) + Math.abs(dy) > 3) {
            this._pendingBoothMove.active = true;
            capturePointer(this._pendingBoothMove.pointerId);
            this.canvas.style.cursor = 'grabbing';
          }
        }
        const moved = this._pendingBoothMove.curX !== x || this._pendingBoothMove.curZ !== z;
        this._pendingBoothMove.curX = x;
        this._pendingBoothMove.curZ = z;
        if (this._pendingBoothMove.active && moved) {
          this.draw(false);
        }
        return;
      }
      if (this._pendingCellMove) {
        const rect = c.getBoundingClientRect();
        const { x, z } = this._screenToGrid(e.clientX - rect.left, e.clientY - rect.top);
        if (!this._pendingCellMove.active) {
          const dx = e.clientX - this._pendingCellMove.startScreenX;
          const dy = e.clientY - this._pendingCellMove.startScreenY;
          if (Math.abs(dx) + Math.abs(dy) > 3) {
            this._pendingCellMove.active = true;
            capturePointer(this._pendingCellMove.pointerId);
            this.canvas.style.cursor = 'grabbing';
          }
        }
        const moved = this._pendingCellMove.curX !== x || this._pendingCellMove.curZ !== z;
        this._pendingCellMove.curX = x;
        this._pendingCellMove.curZ = z;
        if (this._pendingCellMove.active && moved) {
          this.draw(false);
        }
        return;
      }
      if (this._pendingBoothRect) {
        const rect = c.getBoundingClientRect();
        const { x, z } = this._screenToGrid(e.clientX - rect.left, e.clientY - rect.top);
        this._pendingBoothRect.lastX = x;
        this._pendingBoothRect.lastZ = z;
        const dx = e.clientX - this._pendingBoothRect.startScreenX;
        const dy = e.clientY - this._pendingBoothRect.startScreenY;
        if (!this.boothDrawRect?.active && Math.abs(dx) + Math.abs(dy) > 5) {
          this.boothDrawRect.active = true;
          capturePointer(this._pendingBoothRect.pointerId);
        }
        if (this.boothDrawRect) {
          this.boothDrawRect.x2 = x;
          this.boothDrawRect.z2 = z;
          this.draw(false);
        }
        return;
      }
      if (this.isPanning && this.lastMouse) {
        this.panX += e.clientX - this.lastMouse.x;
        this.panY += e.clientY - this.lastMouse.y;
        this.lastMouse = { x: e.clientX, y: e.clientY };
        this.draw(true);
        return;
      }
      if (this._pendingPan) {
        const dx = e.clientX - this._pendingPan.startScreenX;
        const dy = e.clientY - this._pendingPan.startScreenY;
        if (Math.abs(dx) + Math.abs(dy) > 5) {
          this.isPanning = true;
          this.lastMouse = { x: e.clientX, y: e.clientY };
          this.canvas.style.cursor = 'grabbing';
          capturePointer(this._pendingPan.pointerId);
          this._pendingPan = null;
        }
      }
      const rect = c.getBoundingClientRect();
      const { x, z } = this._screenToGrid(e.clientX - rect.left, e.clientY - rect.top);
      // Promote pending drag to actual drag after movement threshold
      if (this._pendingDrag && !this.draggingEscalator) {
        const dx = e.clientX - this._pendingDrag.startScreenX;
        const dy = e.clientY - this._pendingDrag.startScreenY;
        if (Math.abs(dx) + Math.abs(dy) > 5) {
          const pd = this._pendingDrag;
          this.draggingEscalator = {
            floorIndex: pd.floorIndex,
            origX: pd.origX, origZ: pd.origZ,
            curX: x, curZ: z
          };
          capturePointer(pd.pointerId);
          this._pendingDrag = null;
        }
      }
      // Escalator drag
      if (this.draggingEscalator) {
        const floor = store.activeFloor;
        if (floor && x >= 0 && z >= 0 && x < floor.width && z < floor.depth) {
          this.draggingEscalator.curX = x;
          this.draggingEscalator.curZ = z;
        }
        this.draw(false);
        return;
      }
      if (this._pendingCellMove) {
        const pending = this._pendingCellMove;
        if (pending.timer) clearTimeout(pending.timer);
        this._pendingCellMove = null;
        if (pending.active) {
          const dx = pending.curX - pending.startX;
          const dz = pending.curZ - pending.startZ;
          if (dx !== 0 || dz !== 0) {
            const moved = store.moveSelectedCellGroup(dx, dz);
            if (!moved) {
              bus.emit('toast', { message: '该方向无法移动选中区域', duration: 1200 });
            }
          }
          resetPointerState();
          this.draw(true);
          return;
        }
        const rect = c.getBoundingClientRect();
        const { x, z } = this._screenToGrid(e.clientX - rect.left, e.clientY - rect.top);
        this._handleClick(x, z);
        this.draw(false);
        return;
      }
      if (store.editTool === 'boothTemplate') {
        if (!this.ghostPos || this.ghostPos.x !== x || this.ghostPos.z !== z) {
          this.ghostPos = { x, z };
          this.draw(false);
        }
      }
      if (this.isDrawing && e.buttons === 1) {
        this._handlePaint(x, z);
      }
    }, { signal });

    c.addEventListener('pointerup', e => {
      if (this.readOnly) {
        this.isPanning = false;
        this.lastMouse = null;
        this._applyToolCursor();
        return;
      }
      if (this._pendingBoothMove) {
        const pending = this._pendingBoothMove;
        if (pending.timer) clearTimeout(pending.timer);
        this._pendingBoothMove = null;
        if (pending.active) {
          const dx = pending.curX - pending.startX;
          const dz = pending.curZ - pending.startZ;
          if (dx !== 0 || dz !== 0) {
            const moved = store.moveBooth(pending.boothId, dx, dz);
            if (!moved) {
              bus.emit('toast', { message: '该方向无法移动展位', duration: 1200 });
            }
          }
          resetPointerState();
          this.draw(true);
          return;
        }
        const rect = c.getBoundingClientRect();
        const { x, z } = this._screenToGrid(e.clientX - rect.left, e.clientY - rect.top);
        this._handleClick(x, z);
        this.draw(false);
        return;
      }
      if (this._pendingBoothRect) {
        const floor = store.activeFloor;
        const startX = this._pendingBoothRect.startX;
        const startZ = this._pendingBoothRect.startZ;
        const endX = this._pendingBoothRect.lastX;
        const endZ = this._pendingBoothRect.lastZ;
        const isDragSelect = !!this.boothDrawRect?.active;
        this._pendingBoothRect = null;
        this.boothDrawRect = null;
        if (floor) {
          if (isDragSelect) {
            this._addDrawingRect(startX, startZ, endX, endZ);
          } else {
            this._toggleDrawingCell(startX, startZ);
          }
        }
        resetPointerState();
        this.draw(false);
        return;
      }
      if (this._pendingPan && !this.draggingEscalator && !this.isPanning) {
        const rect = c.getBoundingClientRect();
        const { x, z } = this._screenToGrid(e.clientX - rect.left, e.clientY - rect.top);
        this._handleClick(x, z);
      }
      this.isPanning = false;
      this.lastMouse = null;
      this.isDrawing = false;
      this._pendingPan = null;
      this._pendingDrag = null;
      this._applyToolCursor();
      // Finalize escalator drag
      if (this.draggingEscalator) {
        const d = this.draggingEscalator;
        this.draggingEscalator = null;
        if (d.curX !== d.origX || d.curZ !== d.origZ) {
          store.moveEscalatorCellGroup(
            d.floorIndex,
            d.origX,
            d.origZ,
            d.curX,
            d.curZ
          );
        }
        this.draw(true);
      }
    }, { signal });
    c.addEventListener('pointercancel', () => {
      resetPointerState();
      this.draw(false);
    }, { signal });
    c.addEventListener('lostpointercapture', () => {
      this._capturedPointerId = null;
    }, { signal });
    window.addEventListener('blur', () => {
      resetPointerState();
      this.draw(false);
    }, { signal });

    c.addEventListener('contextmenu', e => e.preventDefault(), { signal });

    window.addEventListener('keydown', e => {
      const target = e.target;
      const tag = target?.tagName;
      const isEditableTarget =
        target?.isContentEditable ||
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT';
      // Ignore editor hotkeys while typing or during IME composition.
      if (isEditableTarget || e.isComposing || e.keyCode === 229) return;
      if (this.readOnly) return;
      const isUndo = (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z';
      if (isUndo) {
        e.preventDefault();
        store.undo();
        return;
      }
      if (store.editMode !== 'edit') return;
      if (e.key === 'Escape') {
        store.drawingCells = [];
        this._pendingBoothRect = null;
        this.boothDrawRect = null;
        store.clearSelection();
        this.draw(false);
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (store.selectedBoothId) {
          store.removeBooth(store.selectedBoothId);
        } else if (store.selectedCell) {
          store.deleteSelectedCell();
          this.draw(true);
        }
      }
      if (e.key === 'Enter' && store.editTool === 'boothDraw' && store.drawingCells.length) {
        store.addBooth([...store.drawingCells]);
        store.drawingCells = [];
        this.draw(true);
      }
    }, { signal });
  }

  _toolCursor(tool) {
    if (tool === 'select') {
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'>
        <defs>
          <linearGradient id='mouseArrowSilver' x1='0' y1='0' x2='1' y2='1'>
            <stop offset='0%' stop-color='#f8fbff' />
            <stop offset='45%' stop-color='#d6dce4' />
            <stop offset='100%' stop-color='#8f98a3' />
          </linearGradient>
        </defs>
        <path d='M3.2 2.2L3.8 13.4L7.2 10.6L9.5 17.2L12.1 16.2L9.8 9.6L14.2 9.9Z'
              fill='url(#mouseArrowSilver)' stroke='#5f6771' stroke-width='0.9' />
      </svg>`;
      return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") 3 2, auto`;
    }

    const pointerBase = `
      <path d='M26 26 L6 6 L8 18 L12 14 L17 26 L21 24 L16 12 L24 12 Z'
            fill='#11131f' stroke='white' stroke-width='1'/>
    `;

    if (tool === 'boothDraw') {
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>
        <path d='M24 26 L27 23 L12 8 L9 11 Z' fill='#11131f' stroke='white' stroke-width='1'/>
        <path d='M9 11 L7 7 L12 8 Z' fill='#f6d7b6' stroke='white' stroke-width='1'/>
        <path d='M7 7 L5.5 9 L8 8 Z' fill='#11131f'/>
      </svg>`;
      return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") 6 6, auto`;
    }

    const symbol = TOOL_CURSOR_SYMBOL[tool];
    if (!symbol) return 'crosshair';
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>
      ${pointerBase}
      <text x='23' y='27' text-anchor='middle' font-size='10' font-family='sans-serif' fill='#c65b2b'>${symbol}</text>
    </svg>`;
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") 4 4, auto`;
  }

  _applyToolCursor() {
    if (this.isPanning) {
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (this.readOnly) {
      this.canvas.style.cursor = 'grab';
      return;
    }
    this.canvas.style.cursor = this._toolCursor(store.editTool);
  }

  _updateTips() {
    if (!this._tipsEl) return;
    const tips = {
      select: ['点击选中展位或设施', 'Delete 删除选中项', '拖拽可移动展位', 'Alt+拖拽平移画布'],
      corridor: ['点击放置通道', '按住拖动连续绘制', '再次点击已有通道可取消'],
      restricted: ['点击放置限制区', '按住拖动连续绘制'],
      entrance: ['点击放置入口', '按住拖动连续绘制'],
      ledScreen: ['点击放置 LED 屏', '按住拖动连续绘制'],
      elevator: ['点击放置电梯'],
      escalator: ['点击选择扶梯用于关联', '按住 Shift + 拖拽可移动扶梯位置'],
      boothTemplate: ['点击空白区域放置展位模板'],
      boothDraw: ['点击或拖选空白格子选区', '按 Enter 确认创建展位', 'Esc 取消当前选区']
    };
    const list = tips[store.editTool];
    if (!list || !list.length) {
      this._tipsEl.textContent = '';
      return;
    }
    this._tipsEl.textContent = list[Math.floor(Math.random() * list.length)];
  }

  _handleClick(x, z) {
    if (this.readOnly) return;
    const floor = store.activeFloor;
    if (!floor || x < 0 || z < 0 || x >= floor.width || z >= floor.depth) return;
    const tool = store.editTool;

    if (tool === 'select') {
      const cellType = floor.grid[x][z];
      if (store.isMovableCellType?.(cellType)) {
        store.selectCell(x, z, cellType);
        this.draw(true);
        return;
      }
      const booth = store.findBoothAt(x, z);
      if (booth) {
        store.selectBooth(booth.id);
      } else {
        store.clearSelection();
      }
      this.draw(true);
      return;
    }

    if (tool === 'corridor' || tool === 'restricted' || tool === 'entrance' || tool === 'ledScreen' || tool === 'elevator' || tool === 'escalator') {
      const typeMap = { corridor: CellType.CORRIDOR, restricted: CellType.RESTRICTED, entrance: CellType.ENTRANCE, ledScreen: CellType.LED_SCREEN, elevator: CellType.ELEVATOR, escalator: CellType.ESCALATOR };
      const current = floor.grid[x][z];
      if (tool === 'escalator' && current === CellType.ESCALATOR) {
        store.selectCell(x, z, CellType.ESCALATOR);
        this.draw(true);
        return;
      }
      if (current === typeMap[tool]) {
        store.setCell(x, z, CellType.EMPTY);
      } else {
        store.setCell(x, z, typeMap[tool]);
      }
      this.isDrawing = true;
      return;
    }

    if (tool === 'boothTemplate') {
      const { w, h } = store.boothTemplate;
      const cells = [];
      for (let dx = 0; dx < w; dx++) {
        for (let dz = 0; dz < h; dz++) {
          cells.push({ x: x + dx, z: z + dz });
        }
      }
      store.addBooth(cells);
      this.draw(true);
      return;
    }

    if (tool === 'boothDraw') {
      this._toggleDrawingCell(x, z);
      this.draw(false);
    }
  }

  _toggleDrawingCell(x, z) {
    const floor = store.activeFloor;
    if (!floor || x < 0 || z < 0 || x >= floor.width || z >= floor.depth) return;
    if (floor.grid[x][z] !== CellType.EMPTY) return;
    const key = `${x},${z}`;
    const idx = store.drawingCells.findIndex(c => `${c.x},${c.z}` === key);
    if (idx >= 0) {
      store.drawingCells.splice(idx, 1);
    } else {
      store.drawingCells.push({ x, z });
    }
  }

  _addDrawingRect(x1, z1, x2, z2) {
    const floor = store.activeFloor;
    if (!floor) return;
    const minX = Math.max(0, Math.min(x1, x2));
    const maxX = Math.min(floor.width - 1, Math.max(x1, x2));
    const minZ = Math.max(0, Math.min(z1, z2));
    const maxZ = Math.min(floor.depth - 1, Math.max(z1, z2));
    const existing = new Set(store.drawingCells.map(c => `${c.x},${c.z}`));
    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        if (floor.grid[x][z] !== CellType.EMPTY) continue;
        const key = `${x},${z}`;
        if (existing.has(key)) continue;
        existing.add(key);
        store.drawingCells.push({ x, z });
      }
    }
  }

  _handlePaint(x, z) {
    if (this.readOnly) return;
    const floor = store.activeFloor;
    if (!floor || x < 0 || z < 0 || x >= floor.width || z >= floor.depth) return;
    const tool = store.editTool;
    if (tool === 'corridor' || tool === 'restricted' || tool === 'entrance' || tool === 'ledScreen' || tool === 'elevator' || tool === 'escalator') {
      const typeMap = { corridor: CellType.CORRIDOR, restricted: CellType.RESTRICTED, entrance: CellType.ENTRANCE, ledScreen: CellType.LED_SCREEN, elevator: CellType.ELEVATOR, escalator: CellType.ESCALATOR };
      if (floor.grid[x][z] === CellType.EMPTY) {
        store.setCell(x, z, typeMap[tool]);
      }
    }
  }

  // --- Public zoom/pan API ---
  zoomIn() {
    if (this.lockZoom) return;
    const rect = this.container.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    const newSize = Math.min(80, this.cellSize + 2);
    const ratio = newSize / this.cellSize;
    this.panX = cx - (cx - this.panX) * ratio;
    this.panY = cy - (cy - this.panY) * ratio;
    this.cellSize = newSize;
    this.draw(true);
  }

  zoomOut() {
    if (this.lockZoom) return;
    const rect = this.container.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    const newSize = Math.max(12, this.cellSize - 2);
    const ratio = newSize / this.cellSize;
    this.panX = cx - (cx - this.panX) * ratio;
    this.panY = cy - (cy - this.panY) * ratio;
    this.cellSize = newSize;
    this.draw(true);
  }

  panBy(dx, dy) {
    this.panX += dx;
    this.panY += dy;
    this.draw(true);
  }

  resetView() {
    this.cellSize = 20;
    this._centerGrid();
  }

  fitToView() {
    const floor = store.activeFloor;
    if (!floor) return;
    const rect = this.container.getBoundingClientRect();
    const padding = 24;
    const usableW = Math.max(1, rect.width - padding * 2);
    const usableH = Math.max(1, rect.height - padding * 2);
    const fitSize = Math.min(usableW / floor.width, usableH / floor.depth);
    this.cellSize = Math.max(12, Math.min(80, fitSize));
    this._centerGrid();
  }

  fitToGoldenView() {
    const floor = store.activeFloor;
    if (!floor) return;
    const rect = this.container.getBoundingClientRect();
    const padding = 24;
    const usableW = Math.max(1, rect.width - padding * 2);
    const usableH = Math.max(1, rect.height - padding * 2);
    const fitSize = Math.min(usableW / floor.width, usableH / floor.depth);
    // Golden-ratio occupancy for calmer default framing in tenant share view.
    const GOLDEN = 0.618;
    this.cellSize = Math.max(12, Math.min(80, fitSize * GOLDEN));
    this._centerGrid();
  }

  getZoomPercent() {
    return Math.round((this.cellSize / 20) * 100);
  }

  destroy() {
    if (this._drawRaf) {
      cancelAnimationFrame(this._drawRaf);
      this._drawRaf = null;
    }
    this._eventController.abort();
    this._unsubs.forEach(off => {
      try { off(); } catch {}
    });
    this._unsubs = [];
  }
}
