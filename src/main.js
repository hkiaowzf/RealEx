import { bus } from './utils/EventBus.js';
import { store } from './data/Store.js';
import { Persistence } from './utils/Persistence.js';
import { TopBar } from './ui/TopBar.js';
import { LeftPanel } from './ui/LeftPanel.js';
import { GridEditor } from './ui/GridEditor.js';
import { ExportPanel } from './ui/ExportPanel.js';
import { VersionPanel } from './ui/VersionPanel.js';
import { ViewportControls } from './ui/ViewportControls.js';
import { CanvasActionBar } from './ui/CanvasActionBar.js';
import { BoothManagerPanel } from './ui/BoothManagerPanel.js';
import { Toast } from './ui/Toast.js';
import { SceneManager } from './renderer/SceneManager.js';

const escapeHtml = value => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const params = new URLSearchParams(window.location.search);
const isTenantView = params.get('view') === 'tenant' || params.get('tenant') === '1';
const tenantMode = params.get('mode') === 'preview' ? 'preview' : 'edit';
const tenantFloor = Math.max(1, Number.parseInt(params.get('floor') || '1', 10) || 1);
const tenantSalesName = (params.get('salesName') || '').trim();
const tenantSalesEmail = (params.get('salesEmail') || '').trim();
const tenantBoothId = (params.get('boothId') || '').trim();
if (isTenantView) {
  document.body.classList.add('tenant-view');
  store.tenantViewEnabled = true;
  store.tenantHighlightedBoothId = tenantBoothId || null;
}

// --- Bootstrap: restore or create new ---
const saved = Persistence.load();
if (saved && saved.exhibition) {
  Persistence.restore(store, saved);
} else {
  store.initExhibition({ name: '我的展览' });
  store.addFloor({ width: 30, depth: 30, label: 'L1' });
}
store.sanitizeEscalatorLinks();

// Bootstrap a stable rollback baseline once.
const baselineLabel = 'v0.1';
const hasBaseline = Persistence.getVersions().some(v => v?.label === baselineLabel);
if (!hasBaseline) {
  Persistence.saveVersion(store, baselineLabel);
}
if (isTenantView) {
  let floorIdx = Math.min(store.floors.length - 1, Math.max(0, tenantFloor - 1));
  if (tenantBoothId) {
    for (let i = 0; i < store.floors.length; i++) {
      const floor = store.floors[i];
      if (floor?.booths?.some?.(b => b.id === tenantBoothId)) {
        floorIdx = i;
        break;
      }
    }
  }
  if (store.activeFloorIndex !== floorIdx) {
    store.setActiveFloor(floorIdx);
  }
  if (store.editMode !== tenantMode) {
    store.setEditMode(tenantMode);
  }
}

// Start auto-save
Persistence.startAutoSave(store);

const editorArea = document.getElementById('editor-area');
const viewportArea = document.getElementById('viewport-area');
const topBar = new TopBar(document.getElementById('topbar'));
const leftPanel = new LeftPanel(document.getElementById('left-panel'));
const gridEditor = new GridEditor(editorArea, {
  readOnly: isTenantView,
  tenantView: isTenantView,
  lockZoom: isTenantView,
  tenantHighlightBoothId: tenantBoothId
});
const exportPanel = new ExportPanel();
const versionPanel = new VersionPanel();
const boothManagerPanel = new BoothManagerPanel();
const toast = new Toast();
const vpControls = new ViewportControls(editorArea, viewportArea);
const canvasActionBar = new CanvasActionBar(editorArea, viewportArea);
vpControls.setGridEditor(gridEditor);
if (isTenantView) {
  const nameInput = document.getElementById('expo-name');
  if (nameInput) nameInput.readOnly = true;
  const legend = document.createElement('div');
  legend.className = 'tenant-legend';
  legend.innerHTML = `
    <span class="tenant-legend-item"><i class="tenant-chip tenant-chip-rented"></i>已租</span>
    <span class="tenant-legend-item"><i class="tenant-chip tenant-chip-available"></i>可租</span>
  `;
  editorArea.appendChild(legend);
  const invitedBooth = (() => {
    if (!tenantBoothId) return null;
    for (const floor of store.floors) {
      const booth = floor.booths.find(b => b.id === tenantBoothId);
      if (booth) {
        return { floor, booth };
      }
    }
    return null;
  })();
  if (invitedBooth) {
    const boothCardHtml = `
      <div class="tenant-booth-card">
        <div class="tenant-booth-title">编号 ${escapeHtml(invitedBooth.booth.id)} + 推荐展位</div>
        <div class="tenant-booth-body">
          <span>${escapeHtml(invitedBooth.floor.label || '')}</span>
          <span>面积：${Number(invitedBooth.booth.area || invitedBooth.booth.cells?.length || 0)} m²</span>
          <span>状态：${invitedBooth.booth.status === 'sold' ? '已售' : invitedBooth.booth.status === 'reserved' ? '预留' : '空闲'}</span>
        </div>
      </div>
    `;
    const boothEditor = document.createElement('div');
    boothEditor.className = 'tenant-booth-wrap';
    boothEditor.innerHTML = boothCardHtml;
    editorArea.appendChild(boothEditor);
    const boothViewport = document.createElement('div');
    boothViewport.className = 'tenant-booth-wrap';
    boothViewport.innerHTML = boothCardHtml;
    viewportArea.appendChild(boothViewport);
  }
  const safeName = escapeHtml(tenantSalesName);
  const safeEmail = escapeHtml(tenantSalesEmail);
  const emailHref = encodeURIComponent(tenantSalesEmail);
  const contactHtml = `
      <div class="tenant-sales-card">
        <div class="tenant-sales-title">${tenantSalesName || tenantSalesEmail ? '欢迎咨询展位采购' : '欢迎留言咨询展位'}</div>
        ${(tenantSalesName || tenantSalesEmail) ? `
          <div class="tenant-sales-body">
            ${(tenantBoothId && !invitedBooth) ? `<span>展位：${escapeHtml(tenantBoothId)}</span>` : ''}
            ${tenantSalesName ? `<span>销售：${safeName}</span>` : ''}
            ${tenantSalesEmail ? `<span>邮箱：<a href="mailto:${emailHref}">${safeEmail}</a></span>` : ''}
          </div>
        ` : ''}
        <div class="tenant-interest-form">
          <div class="tenant-interest-title">${tenantBoothId ? '我对这个展位感兴趣' : '我对展位感兴趣'}</div>
          <div data-role="tenant-interest-host"></div>
        </div>
      </div>
  `;
  const contactEditor = document.createElement('div');
  contactEditor.className = 'tenant-sales-wrap';
  contactEditor.innerHTML = contactHtml;
  editorArea.appendChild(contactEditor);
  const contactViewport = document.createElement('div');
  contactViewport.className = 'tenant-sales-wrap';
  contactViewport.innerHTML = contactHtml;
  viewportArea.appendChild(contactViewport);

  const interestStateStorageKey = 'expogrid_tenant_interest_state';
  const exhibitionKey = String(store.exhibition?.id || store.exhibition?.name || 'default');
  const interestKey = tenantBoothId
    ? `${tenantBoothId}::${invitedBooth?.booth?.floorId || ''}`
    : `__general__::${exhibitionKey}`;
  const loadInterestStateMap = () => {
      try {
        const raw = localStorage.getItem(interestStateStorageKey);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch {
        return {};
      }
    };
  const saveInterestStateMap = map => {
      try {
        localStorage.setItem(interestStateStorageKey, JSON.stringify(map || {}));
      } catch {}
    };
  const getInterestState = () => {
      if (!interestKey) return null;
      const map = loadInterestStateMap();
      return map[interestKey] || null;
    };
  const setInterestState = value => {
      if (!interestKey) return;
      const map = loadInterestStateMap();
      if (!value) {
        delete map[interestKey];
      } else {
        map[interestKey] = value;
      }
      saveInterestStateMap(map);
    };
  const upsertInviteHistory = entry => {
    try {
      const raw = localStorage.getItem('expogrid_tenant_invite_history');
      const history = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(history) ? history : [];
      const idx = list.findIndex(item => item && item.id === entry.id);
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...entry };
      } else {
        list.unshift(entry);
      }
      localStorage.setItem('expogrid_tenant_invite_history', JSON.stringify(list.slice(0, 500)));
    } catch {}
  };
  const formatTs = ts => {
      const d = new Date(ts || Date.now());
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

  const renderInterestHost = container => {
      const host = container.querySelector('[data-role="tenant-interest-host"]');
      if (!host) return;
      const state = getInterestState();
      if (state) {
        host.innerHTML = `
          <div class="tenant-interest-state">
            <span>昵称：${escapeHtml(state.nickname || '未填写')}</span>
            <span>邮箱：${escapeHtml(state.email || '未填写')}</span>
            <small>提交时间：${formatTs(state.createdAt)}</small>
            <button class="btn-sm tenant-interest-btn" data-role="tenant-interest-cancel">取消感兴趣</button>
          </div>
        `;
        return;
      }
      host.innerHTML = `
        <input class="booth-input tenant-interest-input" type="text" data-role="tenant-interest-nickname" maxlength="60" placeholder="昵称（可选）" />
        <input class="booth-input tenant-interest-input" type="email" data-role="tenant-interest-email" maxlength="120" placeholder="邮箱（可选）" />
        <button class="btn-sm tenant-interest-btn" data-role="tenant-interest-submit">请与我联系</button>
      `;
    };

  const rerenderInterestHosts = () => {
      renderInterestHost(contactEditor);
      renderInterestHost(contactViewport);
    };
  rerenderInterestHosts();

  const bindInterestEvents = container => {
      container.addEventListener('click', e => {
        const submitBtn = e.target.closest('[data-role="tenant-interest-submit"]');
        if (submitBtn) {
          const nicknameInput = container.querySelector('[data-role="tenant-interest-nickname"]');
          const emailInput = container.querySelector('[data-role="tenant-interest-email"]');
          const nickname = String(nicknameInput?.value || '').trim();
          const email = String(emailInput?.value || '').trim();
          if (!nickname && !email) {
            bus.emit('toast', { message: '请至少填写昵称或邮箱', duration: 1700 });
            return;
          }
          const prev = getInterestState();
          const messageId = prev?.id || `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
          const state = {
            id: messageId,
            nickname,
            email,
            createdAt: Date.now()
          };
          setInterestState(state);
          upsertInviteHistory({
            id: messageId,
            createdAt: state.createdAt,
            boothId: tenantBoothId || null,
            boothFloorId: invitedBooth?.booth?.floorId || null,
            nickname,
            email,
            salesName: tenantSalesName || '',
            salesEmail: tenantSalesEmail || '',
            exhibitionName: store.exhibition?.name || '',
            action: 'interested'
          });
          rerenderInterestHosts();
          bus.emit('toast', { message: '已提交兴趣信息，销售会尽快联系你', duration: 1800 });
          return;
        }

        const cancelBtn = e.target.closest('[data-role="tenant-interest-cancel"]');
        if (!cancelBtn) return;
        const prev = getInterestState();
        const messageId = prev?.id || `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
        setInterestState(null);
        upsertInviteHistory({
          id: messageId,
          createdAt: Date.now(),
          boothId: tenantBoothId || null,
          boothFloorId: invitedBooth?.booth?.floorId || null,
          nickname: prev?.nickname || '',
          email: prev?.email || '',
          salesName: tenantSalesName || '',
          salesEmail: tenantSalesEmail || '',
          exhibitionName: store.exhibition?.name || '',
          action: 'pending'
        });
        rerenderInterestHosts();
        bus.emit('toast', { message: '已取消感兴趣', duration: 1400 });
      });
  };
  bindInterestEvents(contactEditor);
  bindInterestEvents(contactViewport);
}

let sceneManager = null;
const canvas3d = document.getElementById('scene3d');

// --- Mode switching ---
function updateMode() {
  if (store.editMode === 'edit') {
    editorArea.classList.remove('hidden');
    viewportArea.classList.add('hidden');
    if (isTenantView) {
      gridEditor.fitToGoldenView();
    } else {
      gridEditor._resize();
      gridEditor.draw();
    }
  } else {
    editorArea.classList.add('hidden');
    viewportArea.classList.remove('hidden');
    if (!sceneManager) {
      sceneManager = new SceneManager(canvas3d, { lockZoom: isTenantView, tenantView: isTenantView });
      vpControls.setSceneManager(sceneManager);
    }
    sceneManager.rebuildAll();
    if (isTenantView) {
      sceneManager.fitToGoldenView();
    } else {
      sceneManager._onResize();
    }
  }
}

const offEditModeChanged = bus.on('edit-mode-changed', updateMode);

// Initial mode
updateMode();
vpControls.startAutoUpdate();

// --- Mobile detection & auto-fit ---
const mobileQuery = window.matchMedia('(max-width: 768px)');
function onMobileChange() {
  document.body.classList.toggle('is-mobile', mobileQuery.matches);
  if (mobileQuery.matches && store.editMode === 'edit') {
    gridEditor.fitToView();
  }
}
mobileQuery.addEventListener('change', onMobileChange);
onMobileChange();

// Re-fit on orientation change (mobile)
window.addEventListener('orientationchange', () => {
  if (!mobileQuery.matches) return;
  setTimeout(() => {
    if (store.editMode === 'edit') {
      gridEditor.fitToView();
    } else {
      sceneManager?.fitToView?.();
    }
  }, 200);
});

// Mode switch auto-fit on mobile
bus.on('edit-mode-changed', () => {
  if (!mobileQuery.matches) return;
  requestAnimationFrame(() => {
    if (store.editMode === 'edit') {
      gridEditor.fitToView();
    } else {
      sceneManager?.fitToView?.();
    }
  });
});

// Global shortcuts:
// - Command/Ctrl + Shift + P => switch to preview mode
// - Command/Ctrl + E (or Command/Ctrl + Shift + E) => switch to edit mode
// - Command/Ctrl + Shift + S => save version
// - Command/Ctrl + Shift + F => fit view
window.addEventListener('keydown', e => {
  if (isTenantView) return;
  const isMeta = e.metaKey || e.ctrlKey;
  const key = String(e.key).toLowerCase();
  const code = String(e.code || '');
  const keyCode = Number(e.keyCode || 0);
  const isPreviewShortcut = isMeta && e.shiftKey && !e.altKey && (key === 'p' || code === 'KeyP' || keyCode === 80);
  const isEditShortcut =
    isMeta &&
    !e.altKey &&
    (key === 'e' || code === 'KeyE' || keyCode === 69);
  const isSaveShortcut = isMeta && e.shiftKey && !e.altKey && (key === 's' || code === 'KeyS' || keyCode === 83);
  const isFitShortcut = isMeta && e.shiftKey && !e.altKey && (key === 'f' || code === 'KeyF' || keyCode === 70);
  if (!isPreviewShortcut && !isEditShortcut && !isSaveShortcut && !isFitShortcut) return;
  const target = e.target;
  const tag = target?.tagName;
  const isEditableTarget =
    target?.isContentEditable ||
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT';
  // Keep global meta shortcuts available even when IME is active.
  if ((e.isComposing || e.keyCode === 229) && !isMeta) return;
  // For non-shortcut typing inside inputs, do nothing.
  if (isEditableTarget && !isMeta) return;
  e.preventDefault();
  if (isPreviewShortcut) {
    store.setEditMode('preview');
  }
  if (isEditShortcut) {
    store.setEditMode('edit');
  }
  if (isSaveShortcut) {
    bus.emit('save-version-requested');
  }
  if (isFitShortcut) {
    if (store.editMode === 'edit') {
      gridEditor.fitToView();
    } else {
      sceneManager?.fitToView?.();
    }
  }
}, { capture: true });

window.addEventListener('beforeunload', () => {
  try { offEditModeChanged?.(); } catch {}
  try { vpControls?.destroy?.(); } catch {}
  try { canvasActionBar?.destroy?.(); } catch {}
  try { leftPanel?.destroy?.(); } catch {}
  try { gridEditor?.destroy?.(); } catch {}
  try { sceneManager?.destroy?.(); } catch {}
});
