import { bus } from '../utils/EventBus.js';
import { store } from '../data/Store.js';
import { CellType, BoothStatus, Orientation } from '../data/ExhibitionModel.js';

const TOOLS = [
  { id: 'select', label: '选择', icon: '&#9754;' },
  { id: 'corridor', label: '通道', icon: '&#9644;' },
  { id: 'restricted', label: '限制区', icon: '&#9638;' },
  { id: 'entrance', label: '入口', icon: '&#9654;' },
  { id: 'ledScreen', label: 'LED屏', icon: '&#9645;' },
  { id: 'elevator', label: '电梯', icon: '&#8661;' },
  { id: 'escalator', label: '扶梯', icon: '&#11021;' },
  { id: 'boothTemplate', label: '模板', icon: '&#9632;' },
  { id: 'boothDraw', label: '绘制展位', icon: '&#9998;' }
];

const VIEW_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'elevator', label: '电梯' },
  { value: 'escalator', label: '扶梯' },
  { value: 'booth', label: '展位' },
  { value: 'booth-reserved', label: '预留展位' },
  { value: 'booth-sold', label: '已售展位' },
  { value: 'corridor', label: '通道' },
  { value: 'restricted', label: '限制区' },
  { value: 'entrance', label: '入口' },
  { value: 'ledScreen', label: 'LED屏' }
];

export class LeftPanel {
  constructor(container) {
    this.el = container;
    this._unsubs = [];
    this._bindOnce();
    this._render();
    this._unsubs.push(bus.on('active-floor-changed', () => this._update()));
    this._unsubs.push(bus.on('floor-changed', () => this._update()));
    this._unsubs.push(bus.on('grid-changed', () => this._updateStats()));
    this._unsubs.push(bus.on('booth-added', () => this._updateStats()));
    this._unsubs.push(bus.on('booth-removed', () => this._updateStats()));
    this._unsubs.push(bus.on('booth-updated', () => this._updateBoothCard()));
    this._unsubs.push(bus.on('booth-selected', () => this._updateBoothCard()));
    this._unsubs.push(bus.on('cell-selected', () => this._updateBoothCard()));
    this._unsubs.push(bus.on('tool-changed', () => {
      this._updateToolbar();
      this._updateTemplateOptions();
    }));
    this._unsubs.push(bus.on('edit-mode-changed', () => this._render()));
    this._unsubs.push(bus.on('escalator-links-changed', () => {
      this._updateStats();
      this._updateBoothCard();
    }));
    this._unsubs.push(bus.on('view-filter-changed', () => this._updateViewControls()));
    this._unsubs.push(bus.on('floor-annotations-changed', () => this._updateViewControls()));
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

  _formatInviteTime(ts) {
    const d = new Date(ts || Date.now());
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

  _currentInviteState(booth) {
    if (!booth) return null;
    const items = this._loadInviteHistory()
      .filter(item => item && item.boothId === booth.id && item.boothFloorId === booth.floorId)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (!items.length) return null;
    const latest = items[0];
    const action = latest.action || 'interested';
    return {
      action,
      nickname: latest.nickname || '',
      email: latest.email || '',
      createdAt: latest.createdAt || null
    };
  }

  _floorSettingsHtml() {
    const floor = store.activeFloor;
    const isEdit = store.editMode === 'edit';
    return `
      <div class="panel-section">
        <div class="panel-title">楼层设置</div>
        <div class="floor-size-row">
          <label>宽 <input type="number" id="floor-w" min="4" max="1000"
            value="${floor?.width || 12}" ${!isEdit ? 'disabled' : ''} /></label>
          <span>&times;</span>
          <label>深 <input type="number" id="floor-d" min="4" max="1000"
            value="${floor?.depth || 8}" ${!isEdit ? 'disabled' : ''} /></label>
          ${isEdit ? '<button id="apply-size" class="btn-sm">应用</button>' : ''}
        </div>
      </div>
    `;
  }

  _render() {
    const isEdit = store.editMode === 'edit';
    this.el.innerHTML = `
      <div id="floor-settings-area">${this._floorSettingsHtml()}</div>
      <div id="toolbar-area">${isEdit ? this._renderToolbar() : ''}</div>
      <div id="template-area">${isEdit ? this._renderTemplateOptions() : ''}</div>
      <div class="panel-section">
        <div class="panel-title">视图筛选</div>
        <select id="view-filter" class="booth-input filter-select">
          ${VIEW_FILTERS.map(item =>
            `<option value="${item.value}" ${store.viewFilter === item.value ? 'selected' : ''}>${item.label}</option>`
          ).join('')}
        </select>
        <label class="check-row">
          <input type="checkbox" id="toggle-floor-annotations" ${store.showFloorAnnotations ? 'checked' : ''} />
          <span>显示楼层编号与连接线</span>
        </label>
      </div>
      <div class="panel-section">
        <div class="panel-title">快捷键</div>
        <div class="shortcut-list">
          <div class="shortcut-row"><span>切换编辑</span><code>Cmd/Ctrl + E</code></div>
          <div class="shortcut-row"><span>切换预览</span><code>Cmd/Ctrl + Shift + P</code></div>
          <div class="shortcut-row"><span>保存版本</span><code>Cmd/Ctrl + Shift + S</code></div>
          <div class="shortcut-row"><span>适配视图</span><code>Cmd/Ctrl + Shift + F</code></div>
          <div class="shortcut-row"><span>撤销</span><code>Cmd/Ctrl + Z</code></div>
        </div>
      </div>
      <div class="panel-section">
        <div class="panel-title">统计</div>
        <div id="stats-area">${this._statsHtml()}</div>
      </div>
      <div class="panel-section">
        <div class="panel-title">展位管理</div>
        <button id="open-booth-manager" class="btn-sm">预留/已售品牌管理</button>
      </div>
      <div class="panel-section">
        <div class="panel-title">选中信息</div>
        <div id="booth-card">${this._boothCardHtml()}</div>
      </div>
    `;
    this._updateViewControls();
  }

  _renderToolbar() {
    return `<div class="panel-section">
      <div class="panel-title">工具</div>
      <div class="toolbar" id="toolbar">
        ${TOOLS.map(t => `
          <button class="tool-btn ${store.editTool === t.id ? 'active' : ''}"
                  data-tool="${t.id}" title="${t.label}">
            ${this._toolIconHtml(t)}
            <small>${t.label}</small>
          </button>
        `).join('')}
      </div>
    </div>`;
  }

  _toolIconHtml(tool) {
    if (tool.id !== 'select') {
      return `<span class="tool-icon">${tool.icon}</span>`;
    }
    return `
      <span class="tool-icon tool-icon-mouse" aria-hidden="true">
        <svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="mouseArrowSilver" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#f8fbff" />
              <stop offset="45%" stop-color="#d6dce4" />
              <stop offset="100%" stop-color="#8f98a3" />
            </linearGradient>
          </defs>
          <path d="M3.2 2.2L3.8 13.4L7.2 10.6L9.5 17.2L12.1 16.2L9.8 9.6L14.2 9.9Z"
                fill="url(#mouseArrowSilver)" stroke="#5f6771" stroke-width="0.9" />
        </svg>
      </span>
    `;
  }

  _statsHtml() {
    const floor = store.activeFloor;
    if (!floor) return '<div class="muted">暂无楼层</div>';
    const total = floor.width * floor.depth;
    const counts = { empty: 0, corridor: 0, restricted: 0, entrance: 0, booth: 0, ledScreen: 0, elevator: 0, escalator: 0 };
    for (let x = 0; x < floor.width; x++)
      for (let z = 0; z < floor.depth; z++)
        counts[floor.grid[x][z]]++;
    const byStatus = { idle: 0, reserved: 0, sold: 0 };
    floor.booths.forEach(b => byStatus[b.status]++);
    return `
      <div class="panel-row"><span>尺寸</span><strong>${floor.width}m &times; ${floor.depth}m</strong></div>
      <div class="panel-row"><span>总格数</span><strong>${total}</strong></div>
      <div class="panel-row"><span>空闲</span><strong>${counts.empty}</strong></div>
      <div class="panel-row"><span>通道</span><strong>${counts.corridor}</strong></div>
      <div class="panel-row"><span>限制区</span><strong>${counts.restricted}</strong></div>
      <div class="panel-row"><span>入口</span><strong>${counts.entrance}</strong></div>
      <div class="panel-row"><span class="status-led-screen">LED屏</span><strong>${counts.ledScreen}</strong></div>
      <div class="panel-row"><span class="status-elevator">电梯</span><strong>${counts.elevator}</strong></div>
      <div class="panel-row"><span class="status-escalator">扶梯</span><strong>${counts.escalator}</strong></div>
      <div class="panel-row"><span class="status-escalator">扶梯连接</span><strong>${store.escalatorLinks.length}</strong></div>
      <div class="panel-row"><span>展位格数</span><strong>${counts.booth}</strong></div>
      <div class="panel-row"><span>展位总数</span><strong>${floor.booths.length}</strong></div>
      <div class="panel-row"><span class="status-idle">空闲</span><strong>${byStatus.idle}</strong></div>
      <div class="panel-row"><span class="status-reserved">预留</span><strong>${byStatus.reserved}</strong></div>
      <div class="panel-row"><span class="status-sold">已售</span><strong>${byStatus.sold}</strong></div>
    `;
  }

  _boothCardHtml() {
    // Check for selected elevator/escalator cell
    const cell = store.selectedCell;
    if (cell) return this._cellCardHtml(cell);

    const booth = store.getSelectedBooth();
    if (!booth) return '<div class="muted">未选择展位</div>';
    const isEdit = store.editMode === 'edit';
    const orientLabels = { 'standard': '标准', 'entrance-facing': '面向入口', 'main-corridor': '面向主通道', 'corner': '转角' };
    const statusLabels = { 'idle': '空闲', 'reserved': '预留', 'sold': '已售' };
    const invite = this._currentInviteState(booth);
    let inviteHtml = '<div class="panel-row"><span>承租人意向</span><strong class="muted">暂无</strong></div>';
    if (invite) {
      const label = invite.action === 'interested' ? '我感兴趣' : '待确认';
      const who = this._escapeHtml(invite.nickname || '未留昵称');
      const email = this._escapeHtml(invite.email || '未留邮箱');
      inviteHtml = `
        <div class="booth-intent-box ${invite.action === 'interested' ? 'is-active' : 'is-cancelled'}">
          <div class="panel-row"><span>承租人意向</span><strong>${label}</strong></div>
          <div class="panel-row"><span>昵称</span><strong>${who}</strong></div>
          <div class="panel-row"><span>邮箱</span><strong>${email}</strong></div>
          <div class="panel-row"><span>时间</span><strong>${this._formatInviteTime(invite.createdAt)}</strong></div>
        </div>
      `;
    }
    return `
      <div class="booth-card">
        <div class="panel-row"><span>编号</span><strong class="selected-booth-id">${booth.id}</strong></div>
        <div class="panel-row"><span>面积</span><strong>${booth.area} m&sup2;</strong></div>
        <div class="panel-row">
          <span>单价</span>
          ${isEdit
            ? `<input type="number" class="booth-input" id="booth-price" value="${booth.pricePerUnit}" min="0" />`
            : `<strong>${booth.pricePerUnit}</strong>`}
        </div>
        <div class="panel-row"><span>总价</span><strong>${booth.totalPrice}</strong></div>
        <div class="panel-row">
          <span>朝向</span>
          ${isEdit
            ? `<select id="booth-orient" class="booth-input">
                ${Object.values(Orientation).map(o =>
                  `<option value="${o}" ${booth.orientation===o?'selected':''}>${orientLabels[o] || o}</option>`
                ).join('')}
              </select>`
            : `<strong>${orientLabels[booth.orientation] || booth.orientation}</strong>`}
        </div>
        <div class="panel-row">
          <span>电压</span>
          ${isEdit
            ? `<select id="booth-voltage" class="booth-input">
                <option value="220" ${booth.power.voltage===220?'selected':''}>220V</option>
                <option value="380" ${booth.power.voltage===380?'selected':''}>380V</option>
              </select>`
            : `<strong>${booth.power.voltage}V</strong>`}
        </div>
        <div class="panel-row">
          <span>功率</span>
          ${isEdit
            ? `<input type="number" class="booth-input" id="booth-wattage" value="${booth.power.wattage}" min="0" />`
            : `<strong>${booth.power.wattage}W</strong>`}
        </div>
        <div class="panel-row">
          <span>状态</span>
          ${isEdit
            ? `<select id="booth-status" class="booth-input">
                ${Object.values(BoothStatus).map(s =>
                  `<option value="${s}" ${booth.status===s?'selected':''}>${statusLabels[s] || s}</option>`
                ).join('')}
              </select>`
            : `<strong class="status-${booth.status}">${statusLabels[booth.status] || booth.status}</strong>`}
        </div>
        ${inviteHtml}
        ${isEdit ? '<button id="delete-booth" class="btn-danger btn-sm">删除展位</button>' : ''}
      </div>
    `;
  }

  _cellCardHtml(cell) {
    const typeLabels = { elevator: '电梯', escalator: '扶梯', ledScreen: 'LED屏' };
    const typeLabel = typeLabels[cell.type] || cell.type;
    const isEdit = store.editMode === 'edit';
    const links = store.findEscalatorLinksAt(store.activeFloorIndex, cell.x, cell.z);
    let linksHtml = '';
    if (cell.type === CellType.ESCALATOR && links.length > 0) {
      linksHtml = links.map(l => {
        const otherFloor = l.floorA === store.activeFloorIndex ? l.floorB : l.floorA;
        const otherX = l.floorA === store.activeFloorIndex ? l.xB : l.xA;
        const otherZ = l.floorA === store.activeFloorIndex ? l.zB : l.zA;
        return `
          <div class="panel-row">
            <span>连接楼层</span>
            <strong>L${otherFloor + 1} (${otherX}, ${otherZ})</strong>
          </div>
          ${isEdit ? `<button class="btn-sm" data-link-remove-id="${l.id}">移除关联</button>` : ''}
        `;
      }).join('');
    }
    let escalatorLinkEditor = '';
    if (cell.type === CellType.ESCALATOR) {
      const options = this._buildEscalatorLinkOptions(cell, links);
      escalatorLinkEditor = `
        <div class="panel-row"><span>上下关联</span><strong>${options.length ? '可选' : '无可关联扶梯'}</strong></div>
        <select id="escalator-link-target" class="booth-input" ${isEdit ? '' : 'disabled'}>
          <option value="">选择其他楼层扶梯</option>
          ${options.map(item => `
            <option value="${item.floorIndex},${item.x},${item.z}">
              L${item.floorIndex + 1} (${item.x}, ${item.z})
            </option>
          `).join('')}
        </select>
        <button id="add-escalator-link" class="btn-sm" ${(isEdit && options.length) ? '' : 'disabled'}>添加关联</button>
        ${isEdit ? '' : '<div class="muted">切换到编辑模式后可配置扶梯上下关联</div>'}
      `;
    }
    return `
      <div class="booth-card">
        <div class="panel-row"><span>类型</span><strong class="status-${cell.type}">${typeLabel}</strong></div>
        <div class="panel-row"><span>位置</span><strong>(${cell.x}, ${cell.z})</strong></div>
        ${linksHtml}
        ${escalatorLinkEditor}
        ${isEdit ? '<button id="delete-cell" class="btn-danger btn-sm">删除</button>' : ''}
      </div>
    `;
  }

  _buildEscalatorLinkOptions(cell, linksAtCell) {
    const floor = store.activeFloor;
    if (!floor || cell.type !== CellType.ESCALATOR) return [];
    const linkedSet = new Set(
      linksAtCell.map(link => {
        if (link.floorA === store.activeFloorIndex) return `${link.floorB},${link.xB},${link.zB}`;
        return `${link.floorA},${link.xA},${link.zA}`;
      })
    );
    const options = [];
    const candidateFloorIndices = [store.activeFloorIndex - 1, store.activeFloorIndex + 1]
      .filter(idx => idx >= 0 && idx < store.floors.length);
    candidateFloorIndices.forEach(fi => {
      const f = store.floors[fi];
      for (let x = 0; x < f.width; x++) {
        for (let z = 0; z < f.depth; z++) {
          if (f.grid[x][z] !== CellType.ESCALATOR) continue;
          const key = `${fi},${x},${z}`;
          if (linkedSet.has(key)) continue;
          options.push({ floorIndex: fi, x, z });
        }
      }
    });
    return options;
  }

  _update() {
    this._updateFloorSettings();
    this._updateToolbar();
    this._updateTemplateOptions();
    this._updateViewControls();
    this._updateStats();
    this._updateBoothCard();
  }
  _updateFloorSettings() {
    const el = this.el.querySelector('#floor-settings-area');
    if (el) el.innerHTML = this._floorSettingsHtml();
  }
  _updateViewControls() {
    const filterEl = this.el.querySelector('#view-filter');
    if (filterEl && filterEl.value !== store.viewFilter) filterEl.value = store.viewFilter;
    const toggleEl = this.el.querySelector('#toggle-floor-annotations');
    if (toggleEl) toggleEl.checked = !!store.showFloorAnnotations;
  }
  _updateStats() {
    const el = this.el.querySelector('#stats-area');
    if (el) el.innerHTML = this._statsHtml();
  }
  _updateBoothCard() {
    const el = this.el.querySelector('#booth-card');
    if (el) el.innerHTML = this._boothCardHtml();
  }
  _updateToolbar() {
    const area = this.el.querySelector('#toolbar-area');
    if (!area) return;
    if (store.editMode !== 'edit') {
      area.innerHTML = '';
      return;
    }
    if (!area.querySelector('#toolbar')) {
      area.innerHTML = this._renderToolbar();
      return;
    }
    area.querySelectorAll('.tool-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === store.editTool);
    });
  }
  _updateTemplateOptions() {
    const area = this.el.querySelector('#template-area');
    if (!area) return;
    if (store.editMode !== 'edit') {
      area.innerHTML = '';
      return;
    }
    area.innerHTML = this._renderTemplateOptions();
  }

  _bindOnce() {
    this._onClick = e => {
      const toolBtn = e.target.closest('.tool-btn');
      if (toolBtn) { store.setEditTool(toolBtn.dataset.tool); return; }
      const tplBtn = e.target.closest('.tpl-btn');
      if (tplBtn) {
        store.setBoothTemplate(Number(tplBtn.dataset.tw), Number(tplBtn.dataset.th));
        this._updateTemplateOptions();
        return;
      }
      if (e.target.id === 'apply-size') {
        const w = Number(this.el.querySelector('#floor-w').value) || 12;
        const d = Number(this.el.querySelector('#floor-d').value) || 8;
        const ok = store.updateFloorSize(Math.max(4, Math.min(1000, w)), Math.max(4, Math.min(1000, d)));
        if (!ok && store.lastConstraintError) {
          bus.emit('toast', { message: store.lastConstraintError, duration: 1600 });
        }
        return;
      }
      if (e.target.id === 'delete-booth') {
        if (store.selectedBoothId) store.removeBooth(store.selectedBoothId);
      }
      if (e.target.id === 'delete-cell') {
        store.deleteSelectedCell();
        return;
      }
      if (e.target.id === 'add-escalator-link') {
        const selected = store.selectedCell;
        if (!selected || selected.type !== CellType.ESCALATOR) return;
        const selectEl = this.el.querySelector('#escalator-link-target');
        const raw = String(selectEl?.value || '');
        if (!raw) {
          bus.emit('toast', { message: '请先选择要关联的扶梯', duration: 1200 });
          return;
        }
        const [floorStr, xStr, zStr] = raw.split(',');
        const otherFloor = Number(floorStr);
        const otherX = Number(xStr);
        const otherZ = Number(zStr);
        if (!Number.isInteger(otherFloor) || !Number.isInteger(otherX) || !Number.isInteger(otherZ)) return;
        const duplicate = store.escalatorLinks.some(link =>
          (link.floorA === store.activeFloorIndex && link.xA === selected.x && link.zA === selected.z &&
            link.floorB === otherFloor && link.xB === otherX && link.zB === otherZ) ||
          (link.floorB === store.activeFloorIndex && link.xB === selected.x && link.zB === selected.z &&
            link.floorA === otherFloor && link.xA === otherX && link.zA === otherZ)
        );
        if (duplicate) {
          bus.emit('toast', { message: '该扶梯已关联', duration: 1200 });
          return;
        }
        const [floorA, xA, zA, floorB, xB, zB] = store.activeFloorIndex < otherFloor
          ? [store.activeFloorIndex, selected.x, selected.z, otherFloor, otherX, otherZ]
          : [otherFloor, otherX, otherZ, store.activeFloorIndex, selected.x, selected.z];
        const created = store.addEscalatorLink(floorA, xA, zA, floorB, xB, zB);
        if (created) {
          bus.emit('toast', { message: '扶梯关联已生效', duration: 1200 });
        } else {
          bus.emit('toast', { message: '关联失败，仅支持上下楼层关联', duration: 1400 });
        }
        return;
      }
      const removeBtn = e.target.closest('[data-link-remove-id]');
      if (removeBtn) {
        const linkId = removeBtn.getAttribute('data-link-remove-id');
        if (linkId) {
          store.removeEscalatorLink(linkId);
          bus.emit('toast', { message: '已移除扶梯关联', duration: 1200 });
        }
        return;
      }
      if (e.target.id === 'open-booth-manager') {
        bus.emit('booth-manager-requested');
      }
    };
    this.el.addEventListener('click', this._onClick);

    this._onChange = e => {
      if (e.target.id === 'view-filter') {
        store.setViewFilter(e.target.value);
        return;
      }
      if (e.target.id === 'toggle-floor-annotations') {
        store.setShowFloorAnnotations(e.target.checked);
        return;
      }
      if (!store.selectedBoothId) return;
      if (e.target.id === 'booth-price') {
        store.updateBooth(store.selectedBoothId, { pricePerUnit: Number(e.target.value) });
      } else if (e.target.id === 'booth-orient') {
        store.updateBooth(store.selectedBoothId, { orientation: e.target.value });
      } else if (e.target.id === 'booth-voltage') {
        store.updateBooth(store.selectedBoothId, { power: { voltage: Number(e.target.value) } });
      } else if (e.target.id === 'booth-wattage') {
        store.updateBooth(store.selectedBoothId, { power: { wattage: Number(e.target.value) } });
      } else if (e.target.id === 'booth-status') {
        store.updateBooth(store.selectedBoothId, { status: e.target.value });
      }
    };
    this.el.addEventListener('change', this._onChange);

    this._onStorage = e => {
      if (e.key === 'expogrid_tenant_invite_history' || e.key === 'expogrid_tenant_interest_state') {
        this._updateBoothCard();
      }
    };
    window.addEventListener('storage', this._onStorage);
  }
  _renderTemplateOptions() {
    if (store.editTool !== 'boothTemplate') return '';
    const templates = [[3,3],[3,2],[6,3],[2,2],[4,3]];
    return `<div class="panel-section">
      <div class="panel-title">展位模板</div>
      <div class="template-options">
        ${templates.map(([w,h]) => `
          <button class="tpl-btn ${store.boothTemplate.w===w && store.boothTemplate.h===h ? 'active' : ''}"
                  data-tw="${w}" data-th="${h}">${w}&times;${h}</button>
        `).join('')}
      </div>
    </div>`;
  }

  destroy() {
    if (this._onClick) this.el.removeEventListener('click', this._onClick);
    if (this._onChange) this.el.removeEventListener('change', this._onChange);
    if (this._onStorage) window.removeEventListener('storage', this._onStorage);
    this._onClick = null;
    this._onChange = null;
    this._onStorage = null;
    this._unsubs.forEach(off => {
      try { off(); } catch {}
    });
    this._unsubs = [];
  }
}
