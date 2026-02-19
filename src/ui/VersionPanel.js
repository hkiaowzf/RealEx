import { bus } from '../utils/EventBus.js';
import { store } from '../data/Store.js';
import { Persistence } from '../utils/Persistence.js';

export class VersionPanel {
  constructor() {
    this._pendingRestoreIdx = null;
    this._pendingRestoreTimer = null;
    this.overlay = document.createElement('div');
    this.overlay.className = 'export-overlay hidden';
    this.overlay.innerHTML = `
      <div class="export-modal">
        <div class="export-header">
          <span>版本历史</span>
          <button class="btn-icon export-close">&times;</button>
        </div>
        <div class="version-list" id="version-list"></div>
      </div>
    `;
    document.body.appendChild(this.overlay);
    this._bind();
    bus.on('history-requested', () => this.show());
    bus.on('save-version-requested', () => this._saveVersion());
  }

  show() {
    this._renderList();
    this.overlay.classList.remove('hidden');
  }

  hide() { this.overlay.classList.add('hidden'); }

  _boothCount(v) {
    let n = 0;
    (v.exhibition?.floors || []).forEach(f => { n += f.booths.length; });
    return n;
  }

  _renderList() {
    const versions = Persistence.getVersions();
    const el = this.overlay.querySelector('#version-list');
    if (!versions.length) {
      el.innerHTML = '<div class="muted" style="padding:16px">暂无保存的版本</div>';
      return;
    }
    el.innerHTML = versions.map((v, i) => {
      const pendingRestore = this._pendingRestoreIdx === i;
      const floors = v.exhibition?.floors?.length || 0;
      const booths = this._boothCount(v);
      const previewImg = v.preview
        ? `<img class="version-preview" src="${v.preview}" alt="预览" />`
        : '<div class="version-preview version-preview-empty">无预览</div>';
      return `<div class="version-item">
        ${previewImg}
        <div class="version-info">
          <strong>${v.label || '未命名'}</strong>
          <small>${v.exhibition?.name || ''} — ${floors} 层, ${booths} 展位</small>
        </div>
        <div class="version-actions">
          <button class="btn-sm version-restore ${pendingRestore ? 'btn-danger' : ''}" data-idx="${i}">
            ${pendingRestore ? '再次点击确认' : '恢复'}
          </button>
          <button class="btn-sm version-delete" data-idx="${i}">&times;</button>
        </div>
      </div>`;
    }).join('');
  }

  _clearPendingRestore() {
    this._pendingRestoreIdx = null;
    clearTimeout(this._pendingRestoreTimer);
    this._pendingRestoreTimer = null;
  }

  _saveVersion() {
    const preview = this._capturePreview();
    const result = Persistence.saveVersion(store, undefined, preview);
    if (result?.saved) {
      bus.emit('version-saved');
      bus.emit('toast', { message: '已手动保存', duration: 1400 });
      return;
    }
    if (result?.reason === 'no-change') {
      bus.emit('toast', { message: '当前与上一版本一致，无需保存', duration: 1700 });
      return;
    }
    bus.emit('toast', { message: '保存失败，请重试', duration: 1700 });
  }

  _capturePreview() {
    try {
      const src = document.querySelector('.grid-canvas');
      if (!src) return '';
      const maxW = 160;
      const maxH = 100;
      const scale = Math.min(maxW / src.width, maxH / src.height, 1);
      const w = Math.round(src.width * scale);
      const h = Math.round(src.height * scale);
      const tmp = document.createElement('canvas');
      tmp.width = w;
      tmp.height = h;
      const ctx = tmp.getContext('2d');
      ctx.drawImage(src, 0, 0, w, h);
      return tmp.toDataURL('image/jpeg', 0.6);
    } catch {
      return '';
    }
  }

  _bind() {
    this.overlay.addEventListener('click', e => {
      if (e.target.classList.contains('export-overlay') ||
          e.target.classList.contains('export-close')) {
        this._clearPendingRestore();
        this.hide();
        return;
      }
      const restoreBtn = e.target.closest('.version-restore');
      if (restoreBtn) {
        const idx = Number(restoreBtn.dataset.idx);
        if (this._pendingRestoreIdx === idx) {
          this._clearPendingRestore();
          Persistence.restoreVersion(store, idx);
          this.hide();
          return;
        }
        this._pendingRestoreIdx = idx;
        clearTimeout(this._pendingRestoreTimer);
        this._pendingRestoreTimer = setTimeout(() => {
          this._clearPendingRestore();
          this._renderList();
        }, 1800);
        this._renderList();
        return;
      }
      const deleteBtn = e.target.closest('.version-delete');
      if (deleteBtn) {
        this._clearPendingRestore();
        Persistence.deleteVersion(Number(deleteBtn.dataset.idx));
        this._renderList();
      }
    });
  }
}
