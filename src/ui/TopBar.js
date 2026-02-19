import { bus } from '../utils/EventBus.js';
import { store } from '../data/Store.js';
import { Auth } from '../utils/Auth.js';
import { Persistence } from '../utils/Persistence.js';

const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const modKey = isMac ? 'Command' : 'Ctrl';

export class TopBar {
  constructor(container) {
    this.el = container;
    const params = new URLSearchParams(window.location.search);
    this.isTenantView = params.get('view') === 'tenant' || params.get('tenant') === '1';
    this.shareDefaults = this._loadShareDefaults();
    this.currentUser = Auth.getCurrentUser();
    this._tenantShareLink = '';
    this._floorDeleteState = null;
    this._fileDeleteTargetId = null;
    this._nameEditing = false;
    this._nameDraft = '';
    this._createFloorDeleteDialog();
    this._createFileListDialog();
    this._createTenantShareDialog();
    this._createInviteHistoryDialog();
    this._createAuthDialog();
    this._render();
    this._bind();
    bus.on('exhibition-changed', () => this._updateName());
    bus.on('floor-added', () => this._renderTabs());
    bus.on('floor-removed', () => this._renderTabs());
    bus.on('active-floor-changed', () => this._renderTabs());
    bus.on('edit-mode-changed', () => this._updateModeToggle());
    bus.on('booth-selected', () => this._refreshTenantShareState());
    bus.on('auth-required', payload => {
      if (this.isTenantView) return;
      this._openAuthDialog();
      const message = payload?.message || '请先登录或注册';
      bus.emit('toast', { message, duration: 1800 });
    });
  }

  _render() {
    this.el.innerHTML = `
      <div class="topbar-left">
        <button class="hamburger-btn mobile-only" id="hamburger-btn" title="菜单">&#9776;</button>
        <div class="brand">
          <div class="brand-title">RealExpo</div>
        </div>
        <div class="expo-name-switch">
          <input class="expo-name-input" id="expo-name" type="text"
                 value="${store.exhibition?.name || ''}" placeholder="展览名称"
                 ${this.isTenantView ? '' : 'readonly'}
                 title="${this.isTenantView ? '展览名称' : '双击编辑名称'}" />
          ${this.isTenantView ? '' : `
            <button class="btn-sm file-switch-btn" id="file-list-btn" title="切换画布" aria-label="切换画布">
              <span class="file-switch-icon" aria-hidden="true">
                <i></i><i></i>
              </span>
            </button>
          `}
        </div>
      </div>
      <div class="topbar-center">
        <div class="floor-tabs" id="floor-tabs"></div>
        <button class="btn-icon" id="add-floor-btn" title="添加楼层">+</button>
      </div>
      <div class="topbar-right">
        ${this.isTenantView ? '' : `<button class="btn-sm" id="auth-btn" title="邮箱验证码登录/注册">${this.currentUser ? `账号 ${this.currentUser.id}` : '登录 / 注册'}</button>`}
        ${this.isTenantView ? '' : '<button class="btn-sm" id="invite-btn" title="邀约管理">邀约</button>'}
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

  _applyNameInputState() {
    const input = this.el.querySelector('#expo-name');
    if (!input || this.isTenantView) return;
    input.classList.toggle('is-name-editing', !!this._nameEditing);
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
      textEl.textContent = `这是不可恢复操作。删除后仅可通过撤销（${modKey} + Z）尝试回退。确定永久删除吗？`;
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
      if (e.target.closest('#hamburger-btn')) {
        bus.emit('toggle-left-drawer');
        return;
      }
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
      if (e.target.id === 'invite-btn') {
        this._openInviteHistoryDialog();
        return;
      }
      if (e.target.id === 'auth-btn') {
        this._openAuthDialog();
        return;
      }
      if (e.target.id === 'file-list-btn') {
        this._openFileListDialog();
        return;
      }
    });

    const nameInput = this.el.querySelector('#expo-name');
    if (!nameInput || this.isTenantView) return;
    this._applyNameInputState();
    nameInput.addEventListener('dblclick', e => {
      e.preventDefault();
      this._beginNameEdit();
    });
    nameInput.addEventListener('keydown', e => {
      if (!this._nameEditing) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        this._commitNameEdit();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        this._cancelNameEdit();
      }
    });
    nameInput.addEventListener('blur', () => {
      if (!this._nameEditing) return;
      this._commitNameEdit();
    });
  }

  _beginNameEdit() {
    const input = this.el.querySelector('#expo-name');
    if (!input || this.isTenantView) return;
    this._nameEditing = true;
    this._nameDraft = String(store.exhibition?.name || '');
    input.readOnly = false;
    this._applyNameInputState();
    input.focus();
    input.select();
  }

  _commitNameEdit() {
    const input = this.el.querySelector('#expo-name');
    if (!input) return;
    const nextName = String(input.value || '').trim() || '未命名展览';
    store.updateExhibition({ name: nextName });
    Persistence.renameCurrentFile(nextName);
    input.value = nextName;
    input.readOnly = !this.isTenantView;
    this._nameEditing = false;
    this._nameDraft = '';
    this._applyNameInputState();
  }

  _cancelNameEdit() {
    const input = this.el.querySelector('#expo-name');
    if (!input) return;
    const fallback = String(this._nameDraft || store.exhibition?.name || '');
    input.value = fallback;
    input.readOnly = !this.isTenantView;
    this._nameEditing = false;
    this._nameDraft = '';
    this._applyNameInputState();
  }

  _createFileListDialog() {
    this.fileListOverlay = document.createElement('div');
    this.fileListOverlay.className = 'export-overlay hidden';
    this.fileListOverlay.innerHTML = `
      <div class="export-modal file-list-modal">
        <div class="export-header">
          <span>展览文件</span>
          <button class="btn-icon export-close" data-action="close">&times;</button>
        </div>
        <div class="file-list-toolbar">
          <button class="btn-accent" data-action="new-file">新建文件</button>
        </div>
        <div class="file-list-body" id="file-list-body"></div>
      </div>
    `;
    document.body.appendChild(this.fileListOverlay);
    this.fileListOverlay.addEventListener('click', e => {
      if (e.target.classList.contains('export-overlay')) {
        this._closeFileListDialog();
        return;
      }
      const actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;
      const action = actionEl.dataset.action;
      if (action === 'close' || action === 'cancel') {
        this._fileDeleteTargetId = null;
        this._closeFileListDialog();
        return;
      }
      if (action === 'switch-file') {
        this._switchFile(actionEl.dataset.id);
        return;
      }
      if (action === 'new-file') {
        this._createNewFileFromDialog();
        return;
      }
      if (action === 'confirm-delete-file') {
        this._fileDeleteTargetId = actionEl.dataset.id || null;
        this._renderFileListBody();
        return;
      }
      if (action === 'delete-file') {
        this._deleteFile(actionEl.dataset.id);
        return;
      }
      if (action === 'cancel-delete-file') {
        this._fileDeleteTargetId = null;
        this._renderFileListBody();
      }
    });
  }

  _openFileListDialog() {
    if (!this.fileListOverlay) return;
    this._fileDeleteTargetId = null;
    this._renderFileListBody();
    this.fileListOverlay.classList.remove('hidden');
  }

  _closeFileListDialog() {
    this.fileListOverlay?.classList.add('hidden');
  }

  _renderFileListBody() {
    const body = this.fileListOverlay?.querySelector('#file-list-body');
    if (!body) return;
    const files = Persistence.listFiles();
    const currentId = Persistence.getCurrentFileId();
    if (!files.length) {
      body.innerHTML = '<div class="muted">暂无文件</div>';
      return;
    }
    body.innerHTML = files.map(file => {
      const isCurrent = file.id === currentId;
      const pendingDelete = this._fileDeleteTargetId === file.id;
      return `
        <div class="file-list-item ${isCurrent ? 'is-current' : ''}">
          <button class="file-list-main ${isCurrent ? 'is-current' : ''}" ${isCurrent ? 'disabled' : `data-action="switch-file" data-id="${this._escapeHtml(file.id)}"`}>
            <strong>${this._escapeHtml(file.name || '未命名展览')}</strong>
            <small>${isCurrent ? '当前文件' : '点击可切换'}</small>
          </button>
          <div class="file-list-actions">
            ${pendingDelete
              ? `<button class="btn-danger btn-sm" data-action="delete-file" data-id="${this._escapeHtml(file.id)}">确认删除</button>
                 <button class="btn-sm" data-action="cancel-delete-file">取消</button>`
              : `<button class="btn-sm booth-delete-btn" data-action="confirm-delete-file" data-id="${this._escapeHtml(file.id)}">删除</button>`}
          </div>
        </div>
      `;
    }).join('');
  }

  _switchFile(fileId) {
    if (!fileId) return;
    Persistence.save(store);
    const res = Persistence.switchFile(store, fileId);
    if (!res?.ok) {
      bus.emit('toast', { message: res?.message || '切换失败', duration: 1700 });
      return;
    }
    this._updateName();
    this._renderTabs();
    this._closeFileListDialog();
    bus.emit('versions-changed');
    bus.emit('toast', { message: '已切换文件', duration: 1300 });
  }

  _deleteFile(fileId) {
    if (!fileId) return;
    const res = Persistence.deleteFile(store, fileId);
    if (!res?.ok) {
      bus.emit('toast', { message: res?.message || '删除失败', duration: 1700 });
      return;
    }
    this._fileDeleteTargetId = null;
    this._updateName();
    this._renderTabs();
    this._renderFileListBody();
    bus.emit('versions-changed');
    bus.emit('toast', { message: '文件已删除', duration: 1300 });
  }

  _createNewFileFromDialog() {
    const files = Persistence.listFiles();
    if (files.length >= 1 && !Auth.getCurrentUser()) {
      bus.emit('auth-required', {
        reason: 'multi-file-create',
        message: '创建第2个及以上展览文件前，请先登录或注册'
      });
      return;
    }

    Persistence.save(store);
    const name = `我的展览 ${files.length + 1}`;
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
    this._updateName();
    this._renderTabs();
    this._renderFileListBody();
    bus.emit('versions-changed');
    bus.emit('toast', { message: `已创建新展览文件：${name}`, duration: 1600 });
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
          <button class="btn-accent" data-action="open-tenant-share">展位邀约</button>
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
      if (action === 'open-tenant-share') {
        this._closeInviteHistoryDialog();
        this._openTenantShareDialog();
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

  _createAuthDialog() {
    this.authOverlay = document.createElement('div');
    this.authOverlay.className = 'export-overlay hidden';
    this.authOverlay.innerHTML = `
      <div class="export-modal auth-modal">
        <div class="export-header">
          <span>登录 / 注册</span>
          <button class="btn-icon export-close" data-action="close">&times;</button>
        </div>
        <div class="auth-body" id="auth-body"></div>
      </div>
    `;
    document.body.appendChild(this.authOverlay);
    this.authOverlay.addEventListener('click', e => {
      if (e.target.classList.contains('export-overlay')) {
        this._closeAuthDialog();
        return;
      }
      const actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;
      const action = actionEl.dataset.action;
      if (action === 'close' || action === 'cancel') {
        this._closeAuthDialog();
        return;
      }
      if (action === 'send-register-code') return this._sendAuthCode('register');
      if (action === 'send-login-code') return this._sendAuthCode('login');
      if (action === 'do-register') return this._doRegister();
      if (action === 'do-login') return this._doLogin();
      if (action === 'send-rebind-code') return this._sendRebindCode();
      if (action === 'do-rebind') return this._doRebind();
      if (action === 'logout') return this._doLogout();
    });
  }

  _openAuthDialog() {
    if (!this.authOverlay) return;
    this.currentUser = Auth.getCurrentUser();
    this._renderAuthBody();
    this.authOverlay.classList.remove('hidden');
  }

  _closeAuthDialog() {
    this.authOverlay?.classList.add('hidden');
  }

  _refreshAuthButton() {
    const btn = this.el.querySelector('#auth-btn');
    if (!btn) return;
    this.currentUser = Auth.getCurrentUser();
    btn.textContent = this.currentUser ? `账号 ${this.currentUser.id}` : '登录 / 注册';
  }

  _renderAuthBody() {
    const body = this.authOverlay?.querySelector('#auth-body');
    if (!body) return;
    const user = this.currentUser || Auth.getCurrentUser();
    if (!user) {
      body.innerHTML = `
        <div class="auth-section">
          <div class="auth-title">邮箱注册</div>
          <input class="booth-input booth-manager-input" id="auth-email-register" type="email" maxlength="120" placeholder="输入邮箱" />
          <div class="auth-inline">
            <input class="booth-input booth-manager-input" id="auth-code-register" type="text" maxlength="6" placeholder="6位验证码" />
            <button class="btn-sm" data-action="send-register-code">发送验证码</button>
          </div>
          <button class="btn-accent" data-action="do-register">注册并登录</button>
        </div>
        <div class="auth-divider"></div>
        <div class="auth-section">
          <div class="auth-title">邮箱登录</div>
          <input class="booth-input booth-manager-input" id="auth-email-login" type="email" maxlength="120" placeholder="输入邮箱" />
          <div class="auth-inline">
            <input class="booth-input booth-manager-input" id="auth-code-login" type="text" maxlength="6" placeholder="6位验证码" />
            <button class="btn-sm" data-action="send-login-code">发送验证码</button>
          </div>
          <button class="btn-sm" data-action="do-login">验证码登录</button>
        </div>
        <div class="muted">当前为本地开发版验证码，发送后会在页面提示验证码。</div>
      `;
      return;
    }
    body.innerHTML = `
      <div class="auth-section">
        <div class="auth-title">账号信息</div>
        <div class="auth-kv"><span>用户ID</span><strong>${this._escapeHtml(user.id)}</strong></div>
        <div class="auth-kv"><span>邮箱</span><strong>${this._escapeHtml(user.email)}</strong></div>
      </div>
      <div class="auth-section">
        <div class="auth-title">换绑邮箱（基于用户ID）</div>
        <input class="booth-input booth-manager-input" id="auth-email-rebind" type="email" maxlength="120" placeholder="输入新邮箱" />
        <div class="auth-inline">
          <input class="booth-input booth-manager-input" id="auth-code-rebind" type="text" maxlength="6" placeholder="6位验证码" />
          <button class="btn-sm" data-action="send-rebind-code">发送验证码</button>
        </div>
        <button class="btn-sm" data-action="do-rebind">确认换绑</button>
      </div>
      <div class="auth-section">
        <button class="btn-danger btn-sm" data-action="logout">退出登录</button>
      </div>
    `;
  }

  _sendAuthCode(purpose) {
    const inputSelector = purpose === 'register' ? '#auth-email-register' : '#auth-email-login';
    const email = String(this.authOverlay?.querySelector(inputSelector)?.value || '').trim();
    const result = Auth.requestCode(email, purpose);
    if (!result.ok) {
      bus.emit('toast', { message: result.message || '发送失败', duration: 1700 });
      return;
    }
    bus.emit('toast', { message: `验证码：${result.code}（5分钟有效）`, duration: 2500 });
  }

  _doRegister() {
    const email = String(this.authOverlay?.querySelector('#auth-email-register')?.value || '').trim();
    const code = String(this.authOverlay?.querySelector('#auth-code-register')?.value || '').trim();
    const result = Auth.register(email, code);
    if (!result.ok) {
      bus.emit('toast', { message: result.message || '注册失败', duration: 1700 });
      return;
    }
    this.currentUser = result.user;
    this._refreshAuthButton();
    this._renderAuthBody();
    bus.emit('toast', { message: `注册成功，ID：${result.user.id}`, duration: 1800 });
  }

  _doLogin() {
    const email = String(this.authOverlay?.querySelector('#auth-email-login')?.value || '').trim();
    const code = String(this.authOverlay?.querySelector('#auth-code-login')?.value || '').trim();
    const result = Auth.login(email, code);
    if (!result.ok) {
      bus.emit('toast', { message: result.message || '登录失败', duration: 1700 });
      return;
    }
    this.currentUser = result.user;
    this._refreshAuthButton();
    this._renderAuthBody();
    bus.emit('toast', { message: `登录成功，ID：${result.user.id}`, duration: 1700 });
  }

  _sendRebindCode() {
    const user = this.currentUser || Auth.getCurrentUser();
    if (!user) {
      bus.emit('toast', { message: '请先登录', duration: 1500 });
      return;
    }
    const email = String(this.authOverlay?.querySelector('#auth-email-rebind')?.value || '').trim();
    const result = Auth.requestCode(email, 'rebind', user.id);
    if (!result.ok) {
      bus.emit('toast', { message: result.message || '发送失败', duration: 1700 });
      return;
    }
    bus.emit('toast', { message: `换绑验证码：${result.code}（5分钟有效）`, duration: 2500 });
  }

  _doRebind() {
    const user = this.currentUser || Auth.getCurrentUser();
    if (!user) {
      bus.emit('toast', { message: '请先登录', duration: 1500 });
      return;
    }
    const email = String(this.authOverlay?.querySelector('#auth-email-rebind')?.value || '').trim();
    const code = String(this.authOverlay?.querySelector('#auth-code-rebind')?.value || '').trim();
    const result = Auth.rebindEmail(user.id, email, code);
    if (!result.ok) {
      bus.emit('toast', { message: result.message || '换绑失败', duration: 1700 });
      return;
    }
    this.currentUser = result.user;
    this._refreshAuthButton();
    this._renderAuthBody();
    bus.emit('toast', { message: '邮箱换绑成功', duration: 1500 });
  }

  _doLogout() {
    Auth.logout();
    this.currentUser = null;
    this._refreshAuthButton();
    this._renderAuthBody();
    bus.emit('toast', { message: '已退出登录', duration: 1200 });
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
    const boothFloor = booth?.floorId
      ? (store.floors || []).find(f => f?.id === booth.floorId)
      : null;
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
              <span><strong>${booth.id}</strong>（${boothFloor?.label || '当前楼层'}）</span>
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
    const latestByIdentity = new Map();
    all.filter(Boolean).forEach(item => {
      const emailKey = String(item.email || '').trim().toLowerCase();
      const nicknameKey = String(item.nickname || '').trim().toLowerCase();
      const boothKey = String(item.boothId || '__general__');
      const key = item.id
        ? `id:${String(item.id)}`
        : `legacy:${emailKey}::${nicknameKey}::${boothKey}`;
      const prev = latestByIdentity.get(key);
      const prevTs = Number(prev?.createdAt || 0);
      const currTs = Number(item.createdAt || 0);
      if (!prev || currTs >= prevTs) {
        latestByIdentity.set(key, item);
      }
    });
    const entries = Array.from(latestByIdentity.values())
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
