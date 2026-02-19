import { bus } from '../utils/EventBus.js';
import { store } from '../data/Store.js';
import { Persistence } from '../utils/Persistence.js';
import { Auth } from '../utils/Auth.js';

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

    // Main buttons container
    const btns = document.createElement('div');
    btns.className = 'canvas-action-buttons';
    btns.innerHTML = `
      <button class="btn-sm" data-action="save-version" title="保存当前版本">保存</button>
      <button class="btn-sm canvas-action-more-toggle" data-action="toggle-more" title="更多操作">\u22EF</button>
    `;
    el.appendChild(btns);

    // More menu (dropdown)
    const more = document.createElement('div');
    more.className = 'canvas-action-more hidden';
    more.innerHTML = `
      <button class="btn-sm" data-action="new-file" title="创建新的展览文件">新建文件</button>
      <button class="btn-sm" data-action="backup-export" title="导出本地备份">备份</button>
      <button class="btn-sm" data-action="backup-import" title="读取本地备份">恢复</button>
      <button class="btn-sm" data-action="open-history" title="查看版本历史">历史版本</button>
    `;
    el.appendChild(more);

    return el;
  }

  _toggleMore(barEl) {
    const more = barEl.querySelector('.canvas-action-more');
    if (!more) return;
    more.classList.toggle('hidden');
  }

  _closeAllMore() {
    [this.editorBar, this.viewportBar].forEach(bar => {
      bar?.querySelector('.canvas-action-more')?.classList.add('hidden');
    });
  }

  _bindOutsideClick() {
    document.addEventListener('pointerdown', e => {
      if (e.target.closest('.canvas-action-bar')) return;
      this._closeAllMore();
    }, { signal: this._eventController.signal });
  }

  _bindBar(barEl) {
    barEl.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'toggle-more') {
        this._toggleMore(barEl);
        return;
      }
      if (action === 'backup-export') {
        this._exportBackup();
        this._closeAllMore();
        return;
      }
      if (action === 'new-file') {
        this._createNewFile();
        this._closeAllMore();
        return;
      }
      if (action === 'backup-import') {
        this.fileInput.click();
        this._closeAllMore();
        return;
      }
      if (action === 'save-version') {
        bus.emit('save-version-requested');
        this._closeAllMore();
        return;
      }
      if (action === 'open-history') {
        bus.emit('history-requested');
        this._closeAllMore();
      }
    }, { signal: this._eventController.signal });
  }

  _nextExhibitionName(sequence) {
    const seq = Number(sequence) > 0 ? Number(sequence) : 1;
    return `我的展览 ${seq}`;
  }

  _createNewFile() {
    const metas = Persistence.listFiles();
    if (metas.length >= 1 && !Auth.getCurrentUser()) {
      bus.emit('auth-required', {
        reason: 'multi-file-create',
        message: '创建第2个及以上展览文件前，请先登录或注册'
      });
      return;
    }

    const name = this._nextExhibitionName(metas.length + 1);
    Persistence.save(store);
    Persistence.createFile(name);

    store.initExhibition({ name });
    const floor = store.addFloor({ width: 30, depth: 30, label: 'L1' });
    if (!floor && store.lastConstraintError) {
      bus.emit('toast', { message: store.lastConstraintError, duration: 1700 });
      return;
    }
    store.setActiveFloor(0);
    store.undoStack = [];
    Persistence.save(store);
    bus.emit('toast', { message: `已创建新展览文件：${name}`, duration: 1600 });
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
