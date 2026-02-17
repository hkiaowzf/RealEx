import { bus } from './EventBus.js';
import { setCounter } from './IdGenerator.js';

const STORAGE_KEY = 'expogrid_current';
const VERSIONS_KEY = 'expogrid_versions';
const MAX_VERSIONS = 20;
const AUTO_SAVE_DELAY = 800;

let _saveTimer = null;

export class Persistence {
  static save(store) {
    try {
      const snapshot = Persistence.serialize(store);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch (e) {
      console.warn('Auto-save failed:', e);
    }
  }

  static load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('Load failed:', e);
      return null;
    }
  }

  static serialize(store) {
    return {
      exhibition: store.exhibition,
      activeFloorIndex: store.activeFloorIndex,
      showFloorAnnotations: store.showFloorAnnotations,
      previewViewPresets: store.previewViewPresets || [],
      activePreviewViewPresetId: store.activePreviewViewPresetId || null,
      snapshotNameSeq: store.snapshotNameSeq || 1,
      savedAt: Date.now()
    };
  }

  static restore(store, snapshot) {
    store.exhibition = snapshot.exhibition;
    if (typeof store._invalidateBoothIndices === 'function') {
      store._invalidateBoothIndices();
    }
    // Backward compatibility: ensure escalatorLinks exists
    if (!store.exhibition.escalatorLinks) {
      store.exhibition.escalatorLinks = [];
    }
    store.activeFloorIndex = snapshot.activeFloorIndex || 0;
    store.showFloorAnnotations = snapshot.showFloorAnnotations !== false;
    store.previewViewPresets = Array.isArray(snapshot.previewViewPresets) ? snapshot.previewViewPresets.slice(0, 3) : [];
    store.activePreviewViewPresetId = snapshot.activePreviewViewPresetId || null;
    store.snapshotNameSeq = Number(snapshot.snapshotNameSeq) > 0 ? Number(snapshot.snapshotNameSeq) : 1;
    // Normalize legacy/invalid escalator links (e.g. non-adjacent floor links)
    store.sanitizeEscalatorLinks();
    // Restore ID counters from existing booths
    Persistence._restoreIdCounters(store);
    bus.emit('exhibition-changed', store.exhibition);
    bus.emit('active-floor-changed', store.activeFloorIndex);
    bus.emit('floor-annotations-changed', store.showFloorAnnotations);
    bus.emit('preview-views-changed', {
      presets: store.previewViewPresets,
      activeId: store.activePreviewViewPresetId
    });
    bus.emit('snapshot-seq-changed', store.snapshotNameSeq);
  }

  // --- Version history ---
  static saveVersion(store, label) {
    try {
      const versions = Persistence.getVersions();
      const snapshot = Persistence.serialize(store);
      if (versions.length > 0 && !Persistence._hasVersionDiff(snapshot, versions[0])) {
        return { saved: false, reason: 'no-change' };
      }
      snapshot.label = label || Persistence._autoLabel();
      versions.unshift(snapshot);
      if (versions.length > MAX_VERSIONS) versions.length = MAX_VERSIONS;
      localStorage.setItem(VERSIONS_KEY, JSON.stringify(versions));
      return { saved: true };
    } catch (e) {
      console.warn('Save version failed:', e);
      return { saved: false, reason: 'error' };
    }
  }

  static getVersions() {
    try {
      const raw = localStorage.getItem(VERSIONS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  static restoreVersion(store, index) {
    const versions = Persistence.getVersions();
    if (index < 0 || index >= versions.length) return false;
    Persistence.restore(store, versions[index]);
    Persistence.save(store);
    return true;
  }

  static deleteVersion(index) {
    const versions = Persistence.getVersions();
    if (index < 0 || index >= versions.length) return;
    versions.splice(index, 1);
    localStorage.setItem(VERSIONS_KEY, JSON.stringify(versions));
  }

  // --- Auto-save (debounced) ---
  static startAutoSave(store) {
    const events = [
      'exhibition-changed', 'floor-changed', 'floor-added', 'floor-removed',
      'grid-changed', 'booth-added', 'booth-removed', 'booth-updated',
      'escalator-links-changed', 'preview-views-changed', 'floor-annotations-changed', 'snapshot-seq-changed'
    ];
    events.forEach(evt => {
      bus.on(evt, () => {
        clearTimeout(_saveTimer);
        _saveTimer = setTimeout(() => Persistence.save(store), AUTO_SAVE_DELAY);
      });
    });
  }

  // --- Helpers ---
  static _restoreIdCounters(store) {
    if (!store.exhibition) return;
    const maxByPrefix = {};
    store.exhibition.floors.forEach(floor => {
      floor.booths.forEach(booth => {
        const match = booth.id.match(/^([A-Z])(\d+)$/);
        if (match) {
          const prefix = match[1];
          const num = parseInt(match[2], 10);
          if (!maxByPrefix[prefix] || num > maxByPrefix[prefix]) {
            maxByPrefix[prefix] = num;
          }
        }
      });
    });
    Object.entries(maxByPrefix).forEach(([prefix, val]) => setCounter(prefix, val));
  }

  static _autoLabel() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  static clearAll() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(VERSIONS_KEY);
  }

  static _hasVersionDiff(a, b) {
    const left = Persistence._normalizeVersionSnapshot(a);
    const right = Persistence._normalizeVersionSnapshot(b);
    return Persistence._stableStringify(left) !== Persistence._stableStringify(right);
  }

  static _normalizeVersionSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    return {
      exhibition: snapshot.exhibition ?? null,
      activeFloorIndex: snapshot.activeFloorIndex ?? 0,
      showFloorAnnotations: snapshot.showFloorAnnotations !== false,
      previewViewPresets: Array.isArray(snapshot.previewViewPresets) ? snapshot.previewViewPresets : [],
      activePreviewViewPresetId: snapshot.activePreviewViewPresetId ?? null,
      snapshotNameSeq: Number(snapshot.snapshotNameSeq) > 0 ? Number(snapshot.snapshotNameSeq) : 1
    };
  }

  static _stableStringify(value) {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map(v => Persistence._stableStringify(v)).join(',')}]`;
    }
    const keys = Object.keys(value).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${Persistence._stableStringify(value[k])}`).join(',')}}`;
  }

  // --- Local backup ---
  static createBackup(store) {
    return {
      type: 'expogrid-backup',
      version: 1,
      createdAt: Date.now(),
      current: Persistence.serialize(store),
      versions: Persistence.getVersions()
    };
  }

  static importBackup(store, backup) {
    const payload = backup && typeof backup === 'object' ? backup : null;
    if (!payload || payload.type !== 'expogrid-backup' || !Number.isInteger(payload.version)) {
      return { ok: false, message: '备份文件格式无效' };
    }
    const current = payload.current;
    if (!current || typeof current !== 'object' || !current.exhibition) {
      return { ok: false, message: '备份文件缺少当前展览数据' };
    }

    Persistence.restore(store, current);
    Persistence.save(store);

    const versions = Array.isArray(payload.versions) ? payload.versions : [];
    localStorage.setItem(VERSIONS_KEY, JSON.stringify(versions));
    bus.emit('versions-changed');
    return { ok: true };
  }
}
