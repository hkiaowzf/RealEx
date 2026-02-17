import { bus } from '../utils/EventBus.js';
import { store } from '../data/Store.js';
import { Persistence } from '../utils/Persistence.js';

export class CanvasActionBar {
  constructor(editorArea, viewportArea) {
    this.editorArea = editorArea;
    this.viewportArea = viewportArea;
    this._mobileQuery = window.matchMedia('(max-width: 768px)');
    this.fileInput = document.createElement('input');
    this._eventController = new AbortController();
    this.fileInput.className = 'hidden';
    this.fileInput.type = 'file';
    this.fileInput.accept = '.json,application/json';
    document.body.appendChild(this.fileInput);

    this.editorBar = this._createBar('editor');
    this.viewportBar = this._createBar('viewport');
    this.editorArea.appendChild(this.editorBar);
    this.viewportArea.appendChild(this.viewportBar);

    this._bindBar(this.editorBar);
    this._bindBar(this.viewportBar);
    this._bindFileInput();
    this._bindOutsideClick();
  }

  _createBar(mode) {
    const el = document.createElement('div');
    el.className = 'canvas-action-bar';
    el.dataset.mode = mode;

    // Toggle button (mobile-only)
    const toggle = document.createElement('button');
    toggle.className = 'canvas-action-toggle mobile-only';
    toggle.textContent = '\u22EF';
    toggle.title = '操作';
    toggle.addEventListener('click', () => this._toggleCollapse(el), { signal: this._eventController.signal });
    el.appendChild(toggle);

    // Buttons container
    const btns = document.createElement('div');
    btns.className = 'canvas-action-buttons';
    btns.innerHTML = `
      <button class="btn-sm" data-action="backup-export" title="导出本地备份">备份</button>
      <button class="btn-sm" data-action="backup-import" title="读取本地备份">恢复</button>
      <button class="btn-sm" data-action="save-version" title="保存当前版本">保存</button>
      <button class="btn-sm" data-action="open-history" title="查看版本历史">历史版本</button>
    `;
    el.appendChild(btns);

    // Start collapsed on mobile
    if (this._mobileQuery.matches) {
      btns.classList.add('collapsed');
    }
    return el;
  }

  _toggleCollapse(barEl) {
    const btns = barEl.querySelector('.canvas-action-buttons');
    if (!btns) return;
    btns.classList.toggle('collapsed');
  }

  _collapseAll() {
    [this.editorBar, this.viewportBar].forEach(bar => {
      bar?.querySelector('.canvas-action-buttons')?.classList.add('collapsed');
    });
  }

  _bindOutsideClick() {
    document.addEventListener('pointerdown', e => {
      if (!this._mobileQuery.matches) return;
      if (e.target.closest('.canvas-action-bar')) return;
      this._collapseAll();
    }, { signal: this._eventController.signal });
  }

  _bindBar(barEl) {
    barEl.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'backup-export') {
        this._exportBackup();
        if (this._mobileQuery.matches) this._collapseAll();
        return;
      }
      if (action === 'backup-import') {
        this.fileInput.click();
        if (this._mobileQuery.matches) this._collapseAll();
        return;
      }
      if (action === 'save-version') {
        bus.emit('save-version-requested');
        if (this._mobileQuery.matches) this._collapseAll();
        return;
      }
      if (action === 'open-history') {
        bus.emit('history-requested');
        if (this._mobileQuery.matches) this._collapseAll();
      }
    }, { signal: this._eventController.signal });
  }

  _bindFileInput() {
    this.fileInput.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      await this._importBackup(file);
    }, { signal: this._eventController.signal });
  }

  _exportBackup() {
    try {
      const backup = Persistence.createBackup(store);
      const json = JSON.stringify(backup, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const expoName = (store.exhibition?.name || 'expogrid').trim().replace(/[^\w\u4e00-\u9fa5-]+/g, '_');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      a.href = url;
      a.download = `${expoName || 'expogrid'}_backup_${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      bus.emit('toast', { message: '本地备份已导出', duration: 1500 });
    } catch (err) {
      console.warn('Backup export failed:', err);
      bus.emit('toast', { message: '备份导出失败', duration: 1800 });
    }
  }

  async _importBackup(file) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = Persistence.importBackup(store, parsed);
      if (res?.ok) {
        bus.emit('toast', { message: '本地备份已恢复', duration: 1600 });
      } else {
        bus.emit('toast', { message: res?.message || '备份恢复失败', duration: 2200 });
      }
    } catch (err) {
      console.warn('Backup import failed:', err);
      bus.emit('toast', { message: '备份文件读取失败', duration: 2200 });
    }
  }

  destroy() {
    try { this._eventController.abort(); } catch {}
    try { this.editorBar?.remove(); } catch {}
    try { this.viewportBar?.remove(); } catch {}
    try { this.fileInput?.remove(); } catch {}
  }
}
