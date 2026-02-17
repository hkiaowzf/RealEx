import { bus } from '../utils/EventBus.js';
import { store } from '../data/Store.js';

export class TopBar {
  constructor(container) {
    this.el = container;
    const params = new URLSearchParams(window.location.search);
    this.isTenantView = params.get('view') === 'tenant' || params.get('tenant') === '1';
    this.shareDefaults = this._loadShareDefaults();
    this._tenantShareLink = '';
    this._floorDeleteState = null;
    this._createFloorDeleteDialog();
    this._createTenantShareDialog();
    this._createInviteHistoryDialog();
    this._render();
    this._bind();
    bus.on('exhibition-changed', () => this._updateName());
    bus.on('floor-added', () => this._renderTabs());
    bus.on('floor-removed', () => this._renderTabs());
    bus.on('active-floor-changed', () => this._renderTabs());
    bus.on('edit-mode-changed', () => this._updateModeToggle());
    bus.on('booth-selected', () => this._refreshTenantShareState());
  }

  _render() {
    this.el.innerHTML = `
      <div class="topbar-left">
        <div class="brand">
          <div class="brand-title">RealExpo</div>
        </div>
        <input class="expo-name-input" id="expo-name" type="text"
               value="${store.exhibition?.name || ''}" placeholder="展览名称" />
      </div>
      <div class="topbar-center">
        <div class="floor-tabs" id="floor-tabs"></div>
        <button class="btn-icon" id="add-floor-btn" title="添加楼层">+</button>
      </div>
      <div class="topbar-right">
        ${this.isTenantView ? '' : '<button class="btn-sm" id="invite-history-btn" title="查看承租人反馈记录">邀约历史</button>'}
        ${this.isTenantView ? '' : '<button class="btn-accent" id="tenant-share-btn" title="复制展位邀约页面链接">展位邀约</button>'}
        <div class="mode-toggle" id="mode-toggle">
          <button class="mode-btn active" data-mode="edit">${this.isTenantView ? '平面' : '编辑'}</button>
          <button class="mode-btn" data-mode="preview">${this.isTenantView ? '3D' : '预览'}</button>
        </div>
      </div>
    `;
    this._renderTabs();
  }

  _renderTabs() {
    const tabsEl = this.el.querySelector('#floor-tabs');
    if (!tabsEl) return;
    tabsEl.innerHTML = store.floors.map((f, i) => `
      <button class="floor-tab ${i === store.activeFloorIndex ? 'active' : ''}"
              data-index="${i}">
        ${f.label}
        ${store.floors.length > 1 ? `<span class="tab-close" data-remove="${i}">&times;</span>` : ''}
      </button>
    `).join('');
  }

  _updateName() {
    const input = this.el.querySelector('#expo-name');
    if (input && document.activeElement !== input) {
      input.value = store.exhibition?.name || '';
    }
  }

  _updateModeToggle() {
    this.el.querySelectorAll('.mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === store.editMode);
    });
  }

  _createFloorDeleteDialog() {
    this.floorDeleteOverlay = document.createElement('div');
    this.floorDeleteOverlay.className = 'export-overlay hidden';
    this.floorDeleteOverlay.innerHTML = `
      <div class="export-modal floor-delete-modal">
        <div class="export-header">
          <span id="floor-delete-title">删除楼层</span>
          <button class="btn-icon export-close" data-action="close">&times;</button>
        </div>
        <div class="floor-delete-body">
          <p class="floor-delete-text" id="floor-delete-text"></p>
        </div>
        <div class="floor-delete-actions">
          <button class="btn-sm" data-action="cancel">取消</button>
          <button class="btn-sm" id="floor-delete-primary" data-action="next">继续</button>
        </div>
      </div>
    `;
    document.body.appendChild(this.floorDeleteOverlay);
    this.floorDeleteOverlay.addEventListener('click', e => {
      if (e.target.classList.contains('export-overlay')) {
        this._closeFloorDeleteDialog();
        return;
      }
      const actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;
      const action = actionEl.dataset.action;
      if (action === 'close' || action === 'cancel') {
        this._closeFloorDeleteDialog();
        return;
      }
      if (action === 'next') {
        this._advanceFloorDeleteDialog();
      }
    });
  }

  _openFloorDeleteDialog(index) {
    const floor = store.floors[index];
    if (!floor) return;
    this._floorDeleteState = {
      index,
      label: floor.label || `L${index + 1}`,
      step: 1
    };
    this._renderFloorDeleteDialog();
    this.floorDeleteOverlay.classList.remove('hidden');
  }

  _renderFloorDeleteDialog() {
    if (!this._floorDeleteState) return;
    const { label, step } = this._floorDeleteState;
    const titleEl = this.floorDeleteOverlay.querySelector('#floor-delete-title');
    const textEl = this.floorDeleteOverlay.querySelector('#floor-delete-text');
    const primaryBtn = this.floorDeleteOverlay.querySelector('#floor-delete-primary');
    if (!titleEl || !textEl || !primaryBtn) return;
    if (step === 1) {
      titleEl.textContent = `确认删除 ${label}`;
      textEl.textContent = `删除后将移除该楼层上的网格、展位以及扶梯连接关系。请确认是否继续。`;
      primaryBtn.textContent = '继续';
      primaryBtn.classList.remove('btn-danger');
    } else {
      titleEl.textContent = `最终确认删除 ${label}`;
      textEl.textContent = `这是不可恢复操作。删除后仅可通过撤销（Command/Ctrl + Z）尝试回退。确定永久删除吗？`;
      primaryBtn.textContent = '永久删除';
      primaryBtn.classList.add('btn-danger');
    }
  }

  _advanceFloorDeleteDialog() {
    if (!this._floorDeleteState) return;
    if (this._floorDeleteState.step === 1) {
      this._floorDeleteState.step = 2;
      this._renderFloorDeleteDialog();
      return;
    }
    const { index } = this._floorDeleteState;
    this._closeFloorDeleteDialog();
    if (Number.isInteger(index)) {
      store.removeFloor(index);
    }
  }

  _closeFloorDeleteDialog() {
    this._floorDeleteState = null;
    this.floorDeleteOverlay?.classList.add('hidden');
  }

  _bind() {
    this.el.addEventListener('click', e => {
      const tab = e.target.closest('.floor-tab');
      const remove = e.target.closest('.tab-close');
      if (remove) {
        e.stopPropagation();
        const floorIndex = Number(remove.dataset.remove);
        this._openFloorDeleteDialog(floorIndex);
        return;
      }
      if (tab) {
        store.setActiveFloor(Number(tab.dataset.index));
        return;
      }
      if (e.target.id === 'add-floor-btn') {
        const added = store.addFloor();
        if (!added && store.lastConstraintError) {
          bus.emit('toast', { message: store.lastConstraintError, duration: 1600 });
        }
        return;
      }
      const modeBtn = e.target.closest('.mode-btn');
      if (modeBtn) {
        store.setEditMode(modeBtn.dataset.mode);
        return;
      }
      if (e.target.id === 'tenant-share-btn') {
        this._openTenantShareDialog();
        return;
      }
      if (e.target.id === 'invite-history-btn') {
        this._openInviteHistoryDialog();
        return;
      }
    });

    const nameInput = this.el.querySelector('#expo-name');
    nameInput?.addEventListener('input', e => {
      store.updateExhibition({ name: e.target.value });
    });
  }

  _createTenantShareDialog() {
    this.tenantShareOverlay = document.createElement('div');
    this.tenantShareOverlay.className = 'export-overlay hidden';
    this.tenantShareOverlay.innerHTML = `
      <div class="export-modal tenant-share-modal">
        <div class="export-header">
          <span>展位邀约</span>
          <button class="btn-icon export-close" data-action="close">&times;</button>
        </div>
        <div class="booth-manager-group">
          <div class="booth-field">
            <span>销售姓名（必填）</span>
            <input class="booth-input booth-manager-input" id="tenant-share-sales-name" type="text" maxlength="80" placeholder="例如：张三" />
          </div>
          <div class="booth-field">
            <span>销售邮箱（必填）</span>
            <input class="booth-input booth-manager-input" id="tenant-share-sales-email" type="email" maxlength="120" placeholder="例如：sales@company.com" />
          </div>
          <div class="tenant-share-selected hidden" id="tenant-share-selected"></div>
        </div>
        <div class="floor-delete-actions">
          <button class="btn-sm" data-action="cancel">取消</button>
          <button class="btn-accent" data-action="copy">转发邀约</button>
        </div>
      </div>
    `;
    document.body.appendChild(this.tenantShareOverlay);
    this.tenantShareOverlay.addEventListener('input', e => {
      if (e.target.id === 'tenant-share-sales-name' || e.target.id === 'tenant-share-sales-email') {
        this._refreshTenantShareLink();
      }
    });
    this.tenantShareOverlay.addEventListener('click', e => {
      if (e.target.classList.contains('export-overlay')) {
        this._closeTenantShareDialog();
        return;
      }
      const actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;
      const action = actionEl.dataset.action;
      if (action === 'close' || action === 'cancel') {
        this._closeTenantShareDialog();
        return;
      }
      if (action === 'copy') {
        this._copyTenantShareLink();
      }
    });
  }

  _createInviteHistoryDialog() {
    this.inviteHistoryOverlay = document.createElement('div');
    this.inviteHistoryOverlay.className = 'export-overlay hidden';
    this.inviteHistoryOverlay.innerHTML = `
      <div class="export-modal invite-history-modal">
        <div class="export-header">
          <span>邀约历史</span>
          <button class="btn-icon export-close" data-action="close">&times;</button>
        </div>
        <div class="tenant-share-history-list" id="invite-history-list"></div>
        <div class="floor-delete-actions">
          <button class="btn-sm" data-action="open-view">查看邀约视图</button>
        </div>
      </div>
    `;
    document.body.appendChild(this.inviteHistoryOverlay);
    this.inviteHistoryOverlay.addEventListener('click', e => {
      if (e.target.classList.contains('export-overlay')) {
        this._closeInviteHistoryDialog();
        return;
      }
      const actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;
      const action = actionEl.dataset.action;
      if (action === 'close') {
        this._closeInviteHistoryDialog();
        return;
      }
      if (action === 'open-view') {
        this._openTenantShareView();
      }
    });
  }

  _openInviteHistoryDialog() {
    if (!this.inviteHistoryOverlay) return;
    this._renderInviteHistoryList();
    this.inviteHistoryOverlay.classList.remove('hidden');
  }

  _closeInviteHistoryDialog() {
    this.inviteHistoryOverlay?.classList.add('hidden');
  }

  _openTenantShareDialog() {
    if (!this.tenantShareOverlay) return;
    const nameInput = this.tenantShareOverlay.querySelector('#tenant-share-sales-name');
    const emailInput = this.tenantShareOverlay.querySelector('#tenant-share-sales-email');
    if (nameInput) nameInput.value = this.shareDefaults.salesName || '';
    if (emailInput) emailInput.value = this.shareDefaults.salesEmail || '';
    this._refreshTenantShareState();
    this.tenantShareOverlay.classList.remove('hidden');
    nameInput?.focus();
    nameInput?.select();
  }

  _closeTenantShareDialog() {
    this.tenantShareOverlay?.classList.add('hidden');
  }

  _buildTenantShareLink() {
    const mode = store.editMode === 'preview' ? 'preview' : 'edit';
    const booth = this._getSelectedBoothForShare();
    let floorIndex = Number(store.activeFloorIndex) || 0;
    if (booth?.floorId) {
      const boothFloorIndex = (store.floors || []).findIndex(f => f?.id === booth.floorId);
      if (boothFloorIndex >= 0) floorIndex = boothFloorIndex;
    }
    const floor = Math.max(1, floorIndex + 1);
    const name = this.tenantShareOverlay?.querySelector('#tenant-share-sales-name')?.value?.trim() || this.shareDefaults.salesName || '';
    const email = this.tenantShareOverlay?.querySelector('#tenant-share-sales-email')?.value?.trim() || this.shareDefaults.salesEmail || '';
    const params = new URLSearchParams({
      view: 'tenant',
      mode,
      floor: String(floor)
    });
    if (booth?.id) params.set('boothId', booth.id);
    if (name) params.set('salesName', name);
    if (email) params.set('salesEmail', email);
    const base = `${window.location.origin}${window.location.pathname}`;
    return `${base}?${params.toString()}`;
  }

  _refreshTenantShareState() {
    if (!this.tenantShareOverlay || this.tenantShareOverlay.classList.contains('hidden')) return;
    this._tenantShareLink = this._buildTenantShareLink();
    const selectedEl = this.tenantShareOverlay.querySelector('#tenant-share-selected');
    const booth = this._getSelectedBoothForShare();
    if (selectedEl) {
      if (!booth) {
        selectedEl.innerHTML = '';
        selectedEl.classList.add('hidden');
        selectedEl.classList.remove('has-content');
      } else {
        selectedEl.classList.remove('hidden');
        selectedEl.classList.add('has-content');
        selectedEl.innerHTML = `
          <div class="tenant-selected-card">
            <div class="tenant-selected-title">邀请展位</div>
            <div class="tenant-selected-body">
              <span><strong>${booth.id}</strong>（${store.activeFloor?.label || '当前楼层'}）</span>
              <span>面积：${booth.area || booth.cells?.length || 0} m²</span>
              <span>状态：${this._statusLabel(booth.status)}</span>
            </div>
          </div>
        `;
      }
    }
  }

  _renderInviteHistoryList() {
    const listEl = this.inviteHistoryOverlay?.querySelector('#invite-history-list');
    if (!listEl) return;
    const all = this._loadInviteHistory();
    const latestByUserAndBooth = new Map();
    all.filter(Boolean).forEach(item => {
      const emailKey = String(item.email || '').trim().toLowerCase();
      const nicknameKey = String(item.nickname || '').trim().toLowerCase();
      const userKey = emailKey || nicknameKey || `anon:${String(item.id || '')}`;
      const boothKey = String(item.boothId || '__general__');
      const key = `${userKey}::${boothKey}`;
      const prev = latestByUserAndBooth.get(key);
      const prevTs = Number(prev?.createdAt || 0);
      const currTs = Number(item.createdAt || 0);
      if (!prev || currTs >= prevTs) {
        latestByUserAndBooth.set(key, item);
      }
    });
    const entries = Array.from(latestByUserAndBooth.values())
      .sort((a, b) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0));
    if (!entries.length) {
      listEl.innerHTML = `<div class="muted">暂无邀约记录</div>`;
      return;
    }
    listEl.innerHTML = entries.slice(0, 200).map(item => {
      const nickname = this._escapeHtml(item.nickname || '未填写');
      const email = this._escapeHtml(item.email || '未填写');
      const intent = item.action === 'interested' ? '我感兴趣' : '待确认';
      const id = this._escapeHtml(item.id || '-');
      return `
        <div class="tenant-history-item">
          <span>ID：${id}</span>
          <span>昵称：${nickname}</span>
          <span>邮箱：${email}</span>
          <strong>意向：${intent}</strong>
        </div>
      `;
    }).join('');
  }

  async _copyTenantShareLink() {
    const salesName = this.tenantShareOverlay?.querySelector('#tenant-share-sales-name')?.value?.trim() || '';
    const salesEmail = this.tenantShareOverlay?.querySelector('#tenant-share-sales-email')?.value?.trim() || '';
    if (!salesName || !salesEmail) {
      bus.emit('toast', { message: '销售姓名和邮箱为必填项', duration: 1700 });
      return;
    }
    this._saveShareDefaults({ salesName, salesEmail });
    const link = this._tenantShareLink || this._buildTenantShareLink();

    let copied = false;
    try {
      await navigator.clipboard?.writeText(link);
      copied = true;
    } catch {}
    this._closeTenantShareDialog();
    bus.emit('toast', {
      message: copied ? '邀约页面已复制' : `请手动复制: ${link}`,
      duration: 1700
    });
  }

  _openTenantShareView() {
    const link = this._tenantShareLink || this._buildTenantShareLink();
    try {
      window.open(link, '_blank', 'noopener,noreferrer');
      bus.emit('toast', { message: '已打开邀请视图', duration: 1200 });
    } catch {
      bus.emit('toast', { message: `打开失败，请手动访问: ${link}`, duration: 1800 });
    }
  }

  _getSelectedBoothForShare() {
    const selectedId = store.selectedBoothId;
    if (selectedId) {
      for (const floor of store.floors || []) {
        const booth = floor?.booths?.find?.(b => b.id === selectedId);
        if (booth) return booth;
      }
    }
    const booth = store.getSelectedBooth?.();
    if (!booth) return null;
    return booth;
  }

  _loadInviteHistory() {
    try {
      const raw = localStorage.getItem('expogrid_tenant_invite_history');
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  _statusLabel(status) {
    if (status === 'sold') return '已售';
    if (status === 'reserved') return '预留';
    return '空闲';
  }

  _formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  _escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  _loadShareDefaults() {
    try {
      const raw = localStorage.getItem('expogrid_tenant_share_defaults');
      const parsed = raw ? JSON.parse(raw) : null;
      return {
        salesName: parsed?.salesName || '',
        salesEmail: parsed?.salesEmail || ''
      };
    } catch {
      return { salesName: '', salesEmail: '' };
    }
  }

  _saveShareDefaults(payload) {
    this.shareDefaults = {
      salesName: payload?.salesName || '',
      salesEmail: payload?.salesEmail || ''
    };
    try {
      localStorage.setItem('expogrid_tenant_share_defaults', JSON.stringify(this.shareDefaults));
    } catch {}
  }
}
