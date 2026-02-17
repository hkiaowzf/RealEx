import { bus } from '../utils/EventBus.js';
import { store } from '../data/Store.js';

export class ViewportControls {
  constructor(editorArea, viewportArea) {
    this.editorArea = editorArea;
    this.viewportArea = viewportArea;
    this.gridEditor = null;
    this.sceneManager = null;
    this._zoomTimer = null;
    this._pendingDeleteSlot = null;
    this._pendingDeleteTimer = null;
    this._pendingOverwriteSlot = null;
    this._pendingOverwriteTimer = null;
    this._snapshotDataUrl = '';
    this._autoUpdateTimer = null;
    this._eventController = new AbortController();
    this._unsubs = [];

    this._editorCtrl = this._createControls('editor');
    this._viewportCtrl = this._createControls('viewport');
    editorArea.appendChild(this._editorCtrl);
    viewportArea.appendChild(this._viewportCtrl);
    this._createSnapshotDialog();

    this._bind(this._editorCtrl, 'editor');
    this._bind(this._viewportCtrl, 'viewport');
    this._unsubs.push(bus.on('preview-views-changed', () => this._renderViewPresets()));
    window.addEventListener('keydown', e => this._onKeyDown(e), { signal: this._eventController.signal });
  }

  setGridEditor(ge) { this.gridEditor = ge; this._updateLabel('editor'); }
  setSceneManager(sm) {
    this.sceneManager = sm;
    this._updateLabel('viewport');
    this._renderViewPresets();
  }

  _createControls(mode) {
    const el = document.createElement('div');
    el.className = 'viewport-controls';
    const isViewport = mode === 'viewport';
    el.innerHTML = `
      <div class="vc-zoom-row">
        <button class="vc-btn" data-action="zoom-out" title="缩小">−</button>
        <span class="vc-zoom-label">100%</span>
        <button class="vc-btn" data-action="zoom-in" title="放大">+</button>
        <button class="vc-btn" data-action="fit" title="适配视图">⤢</button>
        ${isViewport ? '<button class="vc-btn" data-action="snapshot-view" title="快照视角">▣</button>' : ''}
      </div>
      ${isViewport ? '<div class="vc-view-presets"></div>' : ''}
      <div class="vc-pan-grid">
        <button class="vc-btn vc-pan-up" data-action="pan-up" title="上移">▲</button>
        <button class="vc-btn vc-pan-left" data-action="pan-left" title="左移">◀</button>
        <button class="vc-btn vc-pan-reset" data-action="reset" title="重置视图">⊙</button>
        <button class="vc-btn vc-pan-right" data-action="pan-right" title="右移">▶</button>
        <button class="vc-btn vc-pan-down" data-action="pan-down" title="下移">▼</button>
      </div>
    `;
    return el;
  }

  _bind(container, mode) {
    const signal = this._eventController.signal;
    container.addEventListener('click', e => {
      if (mode !== 'viewport') return;
      const saveBtn = e.target.closest('.vc-view-save');
      if (saveBtn) {
        const slot = Number(saveBtn.dataset.slot);
        this._clearPendingDelete();
        this._saveViewPreset(slot);
        return;
      }
      const loadBtn = e.target.closest('.vc-view-load');
      if (loadBtn) {
        const slot = Number(loadBtn.dataset.slot);
        this._clearPendingDelete();
        this._clearPendingOverwrite();
        this._loadViewPreset(slot);
        return;
      }
      const removeBtn = e.target.closest('.vc-view-remove');
      if (removeBtn) {
        const slot = Number(removeBtn.dataset.slot);
        this._clearPendingOverwrite();
        this._requestRemoveViewPreset(slot);
      }
    }, { signal });
    container.addEventListener('pointerdown', e => {
      const btn = e.target.closest('.vc-btn');
      if (!btn) return;
      e.stopPropagation();
      const action = btn.dataset.action;
      this._doAction(action, mode);
      const repeatable = ['zoom-in', 'zoom-out', 'pan-up', 'pan-down', 'pan-left', 'pan-right'].includes(action);
      if (repeatable) {
        this._zoomTimer = setInterval(() => this._doAction(action, mode), 180);
      }
    }, { signal });
    container.addEventListener('pointerup', () => this._stopRepeat(), { signal });
    container.addEventListener('pointerleave', () => this._stopRepeat(), { signal });
    container.addEventListener('pointercancel', () => this._stopRepeat(), { signal });
    container.addEventListener('lostpointercapture', () => this._stopRepeat(), { signal });
    window.addEventListener('pointerup', () => this._stopRepeat(), { signal });
    window.addEventListener('blur', () => this._stopRepeat(), { signal });
  }

  _stopRepeat() {
    clearInterval(this._zoomTimer);
    this._zoomTimer = null;
  }

  _doAction(action, mode) {
    const target = mode === 'editor' ? this.gridEditor : this.sceneManager;
    if (!target) return;
    const PAN_STEP = mode === 'editor' ? 40 : 30;
    switch (action) {
      case 'zoom-in':  target.zoomIn(); break;
      case 'zoom-out': target.zoomOut(); break;
      case 'pan-up':   target.panBy(0, PAN_STEP); break;
      case 'pan-down':  target.panBy(0, -PAN_STEP); break;
      case 'pan-left':  target.panBy(PAN_STEP, 0); break;
      case 'pan-right': target.panBy(-PAN_STEP, 0); break;
      case 'reset':    target.resetView(); break;
      case 'fit':      target.fitToView?.(); break;
      case 'snapshot-view': this._captureSnapshotFlow(); break;
    }
    this._updateLabel(mode);
  }

  _createSnapshotDialog() {
    this.snapshotOverlay = document.createElement('div');
    this.snapshotOverlay.className = 'export-overlay hidden';
    this.snapshotOverlay.innerHTML = `
      <div class="export-modal snapshot-modal">
        <div class="export-header">
          <span>保存快照</span>
          <button class="btn-icon export-close" data-action="close">&times;</button>
        </div>
        <img class="snapshot-preview" id="snapshot-preview" alt="snapshot preview" />
        <div class="snapshot-row">
          <label class="snapshot-label" for="snapshot-name">图片名称</label>
          <input class="booth-input snapshot-input" id="snapshot-name" type="text" maxlength="80" />
        </div>
        <div class="floor-delete-actions">
          <button class="btn-sm" data-action="cancel">取消</button>
          <button class="btn-accent" data-action="save">保存</button>
        </div>
      </div>
    `;
    document.body.appendChild(this.snapshotOverlay);
    this.snapshotOverlay.addEventListener('click', e => {
      if (e.target.classList.contains('export-overlay')) {
        this._hideSnapshotDialog();
        return;
      }
      const actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;
      const action = actionEl.dataset.action;
      if (action === 'close' || action === 'cancel') {
        this._hideSnapshotDialog();
        return;
      }
      if (action === 'save') {
        this._saveSnapshotFile();
      }
    }, { signal: this._eventController.signal });
  }

  async _captureSnapshotFlow() {
    if (!this.sceneManager) return;
    this.sceneManager.snapshotView?.();
    this._updateLabel('viewport');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const dataUrl = this.sceneManager.captureSnapshotDataURL?.();
    if (!dataUrl) {
      bus.emit('toast', { message: '快照生成失败', duration: 1200 });
      return;
    }
    this._snapshotDataUrl = dataUrl;
    this._showSnapshotDialog();
  }

  _showSnapshotDialog() {
    const img = this.snapshotOverlay.querySelector('#snapshot-preview');
    const input = this.snapshotOverlay.querySelector('#snapshot-name');
    if (!img || !input) return;
    img.src = this._snapshotDataUrl;
    input.value = store.getDefaultSnapshotName();
    this.snapshotOverlay.classList.remove('hidden');
    input.focus();
    input.select();
  }

  _hideSnapshotDialog() {
    this.snapshotOverlay.classList.add('hidden');
  }

  async _saveSnapshotFile() {
    const input = this.snapshotOverlay.querySelector('#snapshot-name');
    const rawName = String(input?.value || '').trim();
    const fileName = (rawName || store.getDefaultSnapshotName()).replace(/[\\/:*?"<>|]+/g, '_');
    if (!this._snapshotDataUrl) return;
    const dataUrl = await this._withWatermark(this._snapshotDataUrl);
    const a = document.createElement('a');
    a.href = dataUrl || this._snapshotDataUrl;
    a.download = `${fileName}.png`;
    a.click();
    store.markSnapshotSaved();
    bus.emit('toast', { message: `已保存快照 ${fileName}.png`, duration: 1200 });
    this._hideSnapshotDialog();
  }

  async _withWatermark(dataUrl) {
    try {
      const img = await this._loadImage(dataUrl);
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return dataUrl;
      ctx.drawImage(img, 0, 0);

      const mark = 'expoGrid 3D';
      const fontSize = Math.max(14, Math.round(canvas.width * 0.022));
      const padding = Math.max(12, Math.round(canvas.width * 0.018));
      ctx.font = `700 ${fontSize}px "PP Neue Montreal","Manrope","Segoe UI",sans-serif`;
      const textWidth = ctx.measureText(mark).width;
      const boxW = textWidth + padding * 1.4;
      const boxH = fontSize + padding * 0.9;
      const x = canvas.width - boxW - padding;
      const y = canvas.height - boxH - padding;
      const radius = Math.max(8, Math.round(fontSize * 0.45));

      ctx.fillStyle = 'rgba(17,19,31,0.45)';
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(x, y, boxW, boxH, radius);
        ctx.fill();
      } else {
        ctx.fillRect(x, y, boxW, boxH);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.textBaseline = 'middle';
      ctx.fillText(mark, x + padding * 0.7, y + boxH / 2 + 0.5);

      return canvas.toDataURL('image/png');
    } catch {
      return dataUrl;
    }
  }

  _loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  _renderViewPresets() {
    const el = this._viewportCtrl?.querySelector('.vc-view-presets');
    if (!el) return;
    const presets = store.previewViewPresets || [];
    const activeId = store.activePreviewViewPresetId;
    const slots = [0, 1, 2];
    el.innerHTML = `
      <div class="vc-view-title">视角</div>
      ${slots.map(slot => {
        const preset = presets[slot];
        const name = `V${slot + 1}`;
        const active = preset && preset.id === activeId;
        const pendingDelete = this._pendingDeleteSlot === slot;
        return `
          <div class="vc-view-row">
            <button class="vc-view-load ${active ? 'is-active' : ''}" data-slot="${slot}" ${preset ? '' : 'disabled'}>
              ${name}
            </button>
            <button class="vc-view-save vc-view-action" data-slot="${slot}" title="保存当前视角到 ${name}">存</button>
            <button class="vc-view-remove vc-view-action ${pendingDelete ? 'is-pending' : ''}" data-slot="${slot}" title="删除 ${name}" ${preset ? '' : 'disabled'}>${pendingDelete ? '确认' : '删'}</button>
          </div>
        `;
      }).join('')}
    `;
  }

  _saveViewPreset(slot) {
    if (!this.sceneManager) return;
    const presets = store.previewViewPresets || [];
    const current = this.sceneManager.captureViewState?.();
    if (!current) return;
    const name = `V${slot + 1}`;
    const existing = presets[slot];
    if (existing) {
      if (this._isSameViewState(existing, current)) {
        this._clearPendingOverwrite();
        bus.emit('toast', { message: `${name} 视角未变化`, duration: 1000 });
        return;
      }
      if (this._pendingOverwriteSlot !== slot) {
        this._pendingOverwriteSlot = slot;
        clearTimeout(this._pendingOverwriteTimer);
        this._pendingOverwriteTimer = setTimeout(() => this._clearPendingOverwrite(), 1800);
        bus.emit('toast', { message: `再次点击“存”以覆盖 ${name}`, duration: 1100 });
        return;
      }
      this._clearPendingOverwrite();
    }
    const id = store.savePreviewViewPreset({
      ...current,
      name
    }, existing?.id || null);
    if (id) {
      store.setActivePreviewViewPreset(id);
      bus.emit('toast', { message: `已保存视角 ${name}`, duration: 1100 });
    }
  }

  _loadViewPreset(slot) {
    const preset = (store.previewViewPresets || [])[slot];
    if (!preset || !this.sceneManager) return;
    if (this.sceneManager.applyViewState?.(preset)) {
      store.setActivePreviewViewPreset(preset.id);
      this._updateLabel('viewport');
    }
  }

  _removeViewPreset(slot) {
    const preset = (store.previewViewPresets || [])[slot];
    if (!preset) return;
    store.removePreviewViewPreset(preset.id);
  }

  _requestRemoveViewPreset(slot) {
    const preset = (store.previewViewPresets || [])[slot];
    if (!preset) return;
    if (this._pendingDeleteSlot === slot) {
      this._clearPendingDelete();
      this._removeViewPreset(slot);
      return;
    }
    this._pendingDeleteSlot = slot;
    this._renderViewPresets();
    clearTimeout(this._pendingDeleteTimer);
    this._pendingDeleteTimer = setTimeout(() => this._clearPendingDelete(), 1800);
  }

  _clearPendingDelete() {
    if (this._pendingDeleteSlot === null) return;
    this._pendingDeleteSlot = null;
    clearTimeout(this._pendingDeleteTimer);
    this._pendingDeleteTimer = null;
    this._renderViewPresets();
  }

  _clearPendingOverwrite() {
    this._pendingOverwriteSlot = null;
    clearTimeout(this._pendingOverwriteTimer);
    this._pendingOverwriteTimer = null;
  }

  _isSameViewState(a, b) {
    const EPS = 1e-4;
    const sameNum = (x, y) => Math.abs((x || 0) - (y || 0)) < EPS;
    const sameFloor = (a.floorIndex ?? null) === (b.floorIndex ?? null);
    return sameFloor &&
      sameNum(a.camera?.x, b.camera?.x) &&
      sameNum(a.camera?.y, b.camera?.y) &&
      sameNum(a.camera?.z, b.camera?.z) &&
      sameNum(a.target?.x, b.target?.x) &&
      sameNum(a.target?.y, b.target?.y) &&
      sameNum(a.target?.z, b.target?.z);
  }

  _onKeyDown(e) {
    const key = String(e.key || '').toLowerCase();
    if (key !== 'f') return;
    if (!e.shiftKey) return;
    if (!(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    const mode = store.editMode === 'edit' ? 'editor' : 'viewport';
    this._doAction('fit', mode);
  }

  _updateLabel(mode) {
    const target = mode === 'editor' ? this.gridEditor : this.sceneManager;
    const container = mode === 'editor' ? this._editorCtrl : this._viewportCtrl;
    const label = container.querySelector('.vc-zoom-label');
    if (target && label) {
      label.textContent = target.getZoomPercent() + '%';
    }
  }

  startAutoUpdate() {
    // Update labels periodically (for scroll-wheel zoom, orbit changes, etc.)
    if (this._autoUpdateTimer) return;
    this._autoUpdateTimer = setInterval(() => {
      if (store.editMode === 'edit') {
        this._updateLabel('editor');
      } else {
        this._updateLabel('viewport');
      }
    }, 300);
    this._renderViewPresets();
  }

  destroy() {
    this._stopRepeat();
    clearInterval(this._autoUpdateTimer);
    this._autoUpdateTimer = null;
    clearTimeout(this._pendingDeleteTimer);
    this._pendingDeleteTimer = null;
    clearTimeout(this._pendingOverwriteTimer);
    this._pendingOverwriteTimer = null;
    this._eventController.abort();
    this._unsubs.forEach(off => {
      try { off(); } catch {}
    });
    this._unsubs = [];
    this.snapshotOverlay?.remove?.();
  }
}
