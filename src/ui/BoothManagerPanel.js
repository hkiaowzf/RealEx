import { bus } from '../utils/EventBus.js';
import { store } from '../data/Store.js';
import { BoothStatus, CellType } from '../data/ExhibitionModel.js';

export class BoothManagerPanel {
  constructor() {
    this._filterFloor = 'all';
    this._query = '';
    this._activeCardId = '';
    this.overlay = document.createElement('div');
    this.overlay.className = 'drawer-shell hidden';
    this.overlay.innerHTML = `
      <div class="drawer-mask"></div>
      <aside class="booth-drawer">
        <div class="export-header">
          <span>展位管理（预留/已售）</span>
          <button class="btn-icon export-close">&times;</button>
        </div>
        <div class="booth-manager-filter-row">
          <label class="booth-filter-label" for="booth-floor-filter">楼层筛选</label>
          <select id="booth-floor-filter" class="booth-input booth-floor-filter"></select>
          <input id="booth-search-input" class="booth-input booth-search-input" placeholder="搜索展位号/品牌名" />
        </div>
        <div class="booth-manager-layout">
          <aside id="booth-nav-list" class="booth-nav-list"></aside>
          <div id="booth-manager-content" class="booth-manager-content"></div>
        </div>
      </aside>
    `;
    document.body.appendChild(this.overlay);
    this._bind();
    bus.on('booth-manager-requested', () => this.show());
    bus.on('booth-updated', () => this._renderContent());
    bus.on('booth-added', () => this._renderContent());
    bus.on('booth-removed', () => this._renderContent());
    bus.on('floor-changed', () => this._renderContent());
    bus.on('grid-changed', () => this._renderContent());
    bus.on('floor-added', () => this._renderContent());
    bus.on('floor-removed', () => this._renderContent());
  }

  show() {
    this._renderFloorFilter();
    this._renderContent();
    this.overlay.classList.remove('hidden');
  }

  hide() {
    this.overlay.classList.add('hidden');
  }

  _collect(status) {
    const rows = [];
    store.floors.forEach((floor, floorIndex) => {
      if (this._filterFloor !== 'all' && floorIndex !== Number(this._filterFloor)) return;
      floor.booths.forEach(booth => {
        if (booth.status !== status) return;
        const isValid = booth.cells.every(cell =>
          cell.x >= 0 &&
          cell.z >= 0 &&
          cell.x < floor.width &&
          cell.z < floor.depth &&
          floor.grid?.[cell.x]?.[cell.z] === CellType.BOOTH
        );
        if (!isValid) return;
        const q = this._query.trim().toLowerCase();
        if (q) {
          const idText = `${floor.label}-${booth.id}`.toLowerCase();
          const brandText = String(booth.brandName || '').toLowerCase();
          if (!idText.includes(q) && !brandText.includes(q)) return;
        }
        rows.push({ floor, floorIndex, booth });
      });
    });
    rows.sort((a, b) => {
      if (a.floorIndex !== b.floorIndex) return a.floorIndex - b.floorIndex;
      return a.booth.id.localeCompare(b.booth.id);
    });
    return rows;
  }

  _groupHtml(title, rows, statusClass, statusLabel) {
    if (!rows.length) return `<div class="muted">${title}：暂无</div>`;
    return `
      <div class="booth-manager-group">
        <div class="panel-title">${title}</div>
        <div class="booth-manager-list">
          ${rows.map(({ floor, floorIndex, booth }) => `
            <div class="booth-manager-card" id="${this._cardId(floorIndex, booth.id)}">
              <div class="booth-manager-head">
                <div class="booth-manager-meta">
                  <button class="booth-jump-btn" data-floor-index="${floorIndex}" data-booth-id="${booth.id}">
                    ${floor.label}-${booth.id}
                  </button>
                  <span class="booth-status-chip ${statusClass}">${statusLabel}</span>
                </div>
                <button class="btn-sm booth-delete-btn"
                        data-floor-index="${floorIndex}"
                        data-booth-id="${booth.id}">删除</button>
              </div>
              <div class="booth-manager-fields">
                <label class="booth-field">
                  <span>品牌名</span>
                  <input class="booth-manager-input booth-input"
                       data-floor-index="${floorIndex}"
                       data-booth-id="${booth.id}"
                       data-field="brandName"
                       value="${booth.brandName || ''}"
                       placeholder="输入品牌名" />
                </label>
                <label class="booth-field">
                  <span>联系人</span>
                  <input class="booth-manager-input booth-input"
                       data-floor-index="${floorIndex}"
                       data-booth-id="${booth.id}"
                       data-field="contactName"
                       value="${booth.contactName || ''}"
                       placeholder="输入联系人" />
                </label>
                <label class="booth-field">
                  <span>公司</span>
                  <input class="booth-manager-input booth-input"
                       data-floor-index="${floorIndex}"
                       data-booth-id="${booth.id}"
                       data-field="companyName"
                       value="${booth.companyName || ''}"
                       placeholder="输入公司名称" />
                </label>
                <label class="booth-field booth-field-wide">
                  <span>官网</span>
                  <input class="booth-manager-input booth-input"
                       data-floor-index="${floorIndex}"
                       data-booth-id="${booth.id}"
                       data-field="website"
                       type="url"
                       value="${booth.website || ''}"
                       placeholder="https://example.com" />
                </label>
                <label class="booth-field booth-field-wide">
                  <span>联系邮箱</span>
                  <input class="booth-manager-input booth-input"
                       type="email"
                       data-floor-index="${floorIndex}"
                       data-booth-id="${booth.id}"
                       data-field="contactEmail"
                       value="${booth.contactEmail || ''}"
                       placeholder="name@company.com" />
                </label>
                <label class="booth-field">
                  <span>展位租金</span>
                  <input class="booth-manager-input booth-input"
                       type="number"
                       min="0"
                       data-floor-index="${floorIndex}"
                       data-booth-id="${booth.id}"
                       data-field="boothRent"
                       value="${booth.boothRent ?? 0}"
                       placeholder="0" />
                </label>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  _renderContent() {
    const el = this.overlay.querySelector('#booth-manager-content');
    if (!el) return;
    const reservedRows = this._collect(BoothStatus.RESERVED);
    const soldRows = this._collect(BoothStatus.SOLD);
    if (!reservedRows.length && !soldRows.length) {
      el.innerHTML = '<div class="muted">暂无预留或已售展位</div>';
      this._renderNavList([]);
      return;
    }
    el.innerHTML = `
      ${this._groupHtml('预留展位', reservedRows, 'is-reserved', '预留')}
      ${this._groupHtml('已售展位', soldRows, 'is-sold', '已售')}
    `;
    this._renderNavList([...reservedRows, ...soldRows]);
  }

  _cardId(floorIndex, boothId) {
    return `booth-card-${floorIndex}-${String(boothId).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  }

  _renderNavList(rows) {
    const nav = this.overlay.querySelector('#booth-nav-list');
    if (!nav) return;
    if (!rows.length) {
      nav.innerHTML = '<div class="muted">无匹配展位</div>';
      this._activeCardId = '';
      return;
    }
    const validIds = rows.map(({ floorIndex, booth }) => this._cardId(floorIndex, booth.id));
    if (!validIds.includes(this._activeCardId)) {
      this._activeCardId = validIds[0];
    }
    nav.innerHTML = rows.map(({ floor, floorIndex, booth }) => `
      <button class="booth-nav-item ${this._activeCardId === this._cardId(floorIndex, booth.id) ? 'is-active' : ''}"
              data-target="${this._cardId(floorIndex, booth.id)}">
        ${floor.label}-${booth.id}
      </button>
    `).join('');
    this._applyActiveVisual();
  }

  _setActiveCard(cardId) {
    this._activeCardId = cardId || '';
    this._applyActiveVisual();
  }

  _applyActiveVisual() {
    const navItems = this.overlay.querySelectorAll('.booth-nav-item');
    navItems.forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.target === this._activeCardId);
    });
    const cards = this.overlay.querySelectorAll('.booth-manager-card');
    cards.forEach(card => {
      card.classList.toggle('is-active', card.id === this._activeCardId);
    });
  }

  _renderFloorFilter() {
    const select = this.overlay.querySelector('#booth-floor-filter');
    if (!select) return;
    const options = [
      `<option value="all">全部楼层</option>`,
      ...store.floors.map((floor, floorIndex) =>
        `<option value="${floorIndex}">${floor.label}</option>`)
    ];
    select.innerHTML = options.join('');
    select.value = this._filterFloor;
    if (select.value !== this._filterFloor) {
      this._filterFloor = 'all';
      select.value = 'all';
    }
    const searchInput = this.overlay.querySelector('#booth-search-input');
    if (searchInput) searchInput.value = this._query;
  }

  _bind() {
    this.overlay.addEventListener('click', e => {
      if (e.target.classList.contains('drawer-mask') ||
          e.target.classList.contains('export-close')) {
        this.hide();
        return;
      }
      const jumpBtn = e.target.closest('.booth-jump-btn');
      if (jumpBtn) {
        const floorIndex = Number(jumpBtn.dataset.floorIndex);
        const boothId = jumpBtn.dataset.boothId;
        this._setActiveCard(this._cardId(floorIndex, boothId));
        if (Number.isInteger(floorIndex)) store.setActiveFloor(floorIndex);
        if (boothId) store.selectBooth(boothId);
        return;
      }
      const navBtn = e.target.closest('.booth-nav-item');
      if (navBtn) {
        const targetId = navBtn.dataset.target;
        this._setActiveCard(targetId);
        const target = this.overlay.querySelector(`#${targetId}`);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const deleteBtn = e.target.closest('.booth-delete-btn');
      if (deleteBtn) {
        const floorIndex = Number(deleteBtn.dataset.floorIndex);
        const boothId = deleteBtn.dataset.boothId;
        if (Number.isInteger(floorIndex) && boothId) {
          store.removeBoothOnFloor(floorIndex, boothId);
        }
      }
    });

    this.overlay.addEventListener('change', e => {
      if (e.target.id === 'booth-floor-filter') {
        this._filterFloor = e.target.value;
        this._renderContent();
        return;
      }
      if (!e.target.classList.contains('booth-manager-input')) return;
      const floorIndex = Number(e.target.dataset.floorIndex);
      const boothId = e.target.dataset.boothId;
      const field = e.target.dataset.field;
      if (Number.isInteger(floorIndex) && boothId) {
        store.updateBoothOnFloor(floorIndex, boothId, { [field]: e.target.value });
      }
    });

    this.overlay.addEventListener('input', e => {
      if (e.target.id !== 'booth-search-input') return;
      this._query = e.target.value || '';
      this._renderContent();
    });
  }
}
