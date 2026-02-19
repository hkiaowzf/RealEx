import { bus } from './EventBus.js';
import { setCounter } from './IdGenerator.js';

const STORAGE_KEY = 'expogrid_current';
const VERSIONS_KEY = 'expogrid_versions';
const FILES_META_KEY = 'expogrid_exhibition_files_meta_v1';
const CURRENT_FILE_KEY = 'expogrid_current_file_id_v1';
const FILE_SNAPSHOT_PREFIX = 'expogrid_file_snapshot_';
const MAX_VERSIONS = 20;
const AUTO_SAVE_DELAY = 800;

let _saveTimer = null;
let _autoSaveStop = null;

export class Persistence {
  static _makeFileId() {
    return `file_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  static _fileSnapshotKey(fileId) {
    return `${FILE_SNAPSHOT_PREFIX}${fileId}`;
  }

  static _versionsKey(fileId) {
    return `${VERSIONS_KEY}_${fileId}`;
  }

  static _readFileMetas() {
    try {
      const raw = localStorage.getItem(FILES_META_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  static _writeFileMetas(metas) {
    try {
      localStorage.setItem(FILES_META_KEY, JSON.stringify(Array.isArray(metas) ? metas : []));
    } catch {}
  }

  static _getCurrentFileIdRaw() {
    return String(localStorage.getItem(CURRENT_FILE_KEY) || '').trim();
  }

  static _setCurrentFileId(fileId) {
    localStorage.setItem(CURRENT_FILE_KEY, String(fileId || '').trim());
  }

  static _ensureFileMetaFromLegacy() {
    let metas = Persistence._readFileMetas();
    const legacySnapshot = Persistence._loadLegacySnapshot();
    if (!metas.length) {
      const fileId = Persistence._makeFileId();
      const name = String(legacySnapshot?.exhibition?.name || '我的展览').trim() || '我的展览';
      const now = Date.now();
      metas = [{ id: fileId, name, createdAt: now, updatedAt: now }];
      Persistence._writeFileMetas(metas);
      Persistence._setCurrentFileId(fileId);
      if (legacySnapshot?.exhibition) {
        localStorage.setItem(Persistence._fileSnapshotKey(fileId), JSON.stringify(legacySnapshot));
      }
      const legacyVersions = Persistence._getLegacyVersions();
      if (Array.isArray(legacyVersions) && legacyVersions.length) {
        localStorage.setItem(Persistence._versionsKey(fileId), JSON.stringify(legacyVersions));
      }
      return metas;
    }
    const currentFileId = Persistence._getCurrentFileIdRaw();
    const hasCurrent = currentFileId && metas.some(m => m?.id === currentFileId);
    if (!hasCurrent && metas[0]?.id) {
      Persistence._setCurrentFileId(metas[0].id);
    }
    return metas;
  }

  static _loadLegacySnapshot() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  static _getLegacyVersions() {
    try {
      const raw = localStorage.getItem(VERSIONS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  static listFiles() {
    const metas = Persistence._ensureFileMetaFromLegacy();
    return metas.slice().sort((a, b) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0));
  }

  static getCurrentFileId() {
    Persistence._ensureFileMetaFromLegacy();
    return Persistence._getCurrentFileIdRaw();
  }

  static getCurrentFileMeta() {
    const currentId = Persistence.getCurrentFileId();
    const metas = Persistence.listFiles();
    return metas.find(m => m.id === currentId) || metas[0] || null;
  }

  static createFile(name = '我的展览') {
    const metas = Persistence._ensureFileMetaFromLegacy();
    const now = Date.now();
    const file = {
      id: Persistence._makeFileId(),
      name: String(name || '').trim() || '我的展览',
      createdAt: now,
      updatedAt: now
    };
    metas.unshift(file);
    Persistence._writeFileMetas(metas.slice(0, 300));
    Persistence._setCurrentFileId(file.id);
    return file;
  }

  static renameCurrentFile(name) {
    const currentId = Persistence.getCurrentFileId();
    if (!currentId) return;
    const metas = Persistence._readFileMetas();
    const idx = metas.findIndex(m => m?.id === currentId);
    if (idx < 0) return;
    metas[idx] = {
      ...metas[idx],
      name: String(name || '').trim() || '未命名展览',
      updatedAt: Date.now()
    };
    Persistence._writeFileMetas(metas);
  }

  static switchFile(store, fileId) {
    const id = String(fileId || '').trim();
    if (!id) return { ok: false, message: '文件不存在' };
    const metas = Persistence._ensureFileMetaFromLegacy();
    const exists = metas.some(m => m?.id === id);
    if (!exists) return { ok: false, message: '文件不存在' };
    let snapshot = null;
    try {
      const raw = localStorage.getItem(Persistence._fileSnapshotKey(id));
      snapshot = raw ? JSON.parse(raw) : null;
    } catch {
      snapshot = null;
    }
    if (!snapshot || !snapshot.exhibition) {
      return { ok: false, message: '该文件暂无数据' };
    }
    Persistence._setCurrentFileId(id);
    Persistence.restore(store, snapshot);
    bus.emit('file-switched', { fileId: id });
    return { ok: true };
  }

  static deleteFile(store, fileId) {
    const id = String(fileId || '').trim();
    const metas = Persistence._ensureFileMetaFromLegacy();
    const idx = metas.findIndex(m => m?.id === id);
    if (idx < 0) return { ok: false, message: '文件不存在' };
    if (metas.length <= 1) return { ok: false, message: '至少保留一个文件' };
    const currentId = Persistence.getCurrentFileId();
    const nextMetas = metas.filter(m => m?.id !== id);
    Persistence._writeFileMetas(nextMetas);
    localStorage.removeItem(Persistence._fileSnapshotKey(id));
    localStorage.removeItem(Persistence._versionsKey(id));
    if (id !== currentId) return { ok: true };
    const fallbackId = nextMetas[0]?.id;
    if (!fallbackId) return { ok: false, message: '没有可切换的文件' };
    return Persistence.switchFile(store, fallbackId);
  }

  static save(store) {
    try {
      const snapshot = Persistence.serialize(store);
      const metas = Persistence._ensureFileMetaFromLegacy();
      let currentId = Persistence.getCurrentFileId();
      if (!currentId || !metas.some(m => m?.id === currentId)) {
        const created = Persistence.createFile(snapshot?.exhibition?.name || '我的展览');
        currentId = created.id;
      }
      localStorage.setItem(Persistence._fileSnapshotKey(currentId), JSON.stringify(snapshot));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      const currentName = String(snapshot?.exhibition?.name || '').trim();
      const nextMetas = Persistence._readFileMetas().map(meta => (
        meta.id === currentId
          ? {
              ...meta,
              name: currentName || meta.name || '未命名展览',
              updatedAt: Date.now()
            }
          : meta
      ));
      Persistence._writeFileMetas(nextMetas);
    } catch (e) {
      console.warn('Auto-save failed:', e);
    }
  }

  static load() {
    try {
      Persistence._ensureFileMetaFromLegacy();
      const currentId = Persistence.getCurrentFileId();
      if (currentId) {
        const raw = localStorage.getItem(Persistence._fileSnapshotKey(currentId));
        if (raw) return JSON.parse(raw);
      }
      const legacyRaw = localStorage.getItem(STORAGE_KEY);
      if (!legacyRaw) return null;
      return JSON.parse(legacyRaw);
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
    // Reset transient selection/drawing state when switching snapshot/file.
    store.selectedBoothId = null;
    store.selectedCell = null;
    store.drawingCells = [];
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
  static saveVersion(store, label, preview) {
    try {
      const fileId = Persistence.getCurrentFileId();
      if (!fileId) return { saved: false, reason: 'error' };
      const versions = Persistence.getVersions();
      const snapshot = Persistence.serialize(store);
      if (versions.length > 0 && !Persistence._hasVersionDiff(snapshot, versions[0])) {
        return { saved: false, reason: 'no-change' };
      }
      snapshot.label = label || Persistence._autoLabel();
      if (preview) snapshot.preview = preview;
      versions.unshift(snapshot);
      if (versions.length > MAX_VERSIONS) versions.length = MAX_VERSIONS;
      localStorage.setItem(Persistence._versionsKey(fileId), JSON.stringify(versions));
      return { saved: true };
    } catch (e) {
      console.warn('Save version failed:', e);
      return { saved: false, reason: 'error' };
    }
  }

  static getVersions() {
    try {
      const fileId = Persistence.getCurrentFileId();
      if (!fileId) return [];
      const raw = localStorage.getItem(Persistence._versionsKey(fileId));
      if (!raw) {
        const legacy = localStorage.getItem(VERSIONS_KEY);
        return legacy ? JSON.parse(legacy) : [];
      }
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
    const fileId = Persistence.getCurrentFileId();
    if (!fileId) return;
    const versions = Persistence.getVersions();
    if (index < 0 || index >= versions.length) return;
    versions.splice(index, 1);
    localStorage.setItem(Persistence._versionsKey(fileId), JSON.stringify(versions));
  }

  // --- Auto-save (debounced) ---
  static startAutoSave(store) {
    if (_autoSaveStop) return _autoSaveStop;
    const events = [
      'exhibition-changed', 'floor-changed', 'floor-added', 'floor-removed',
      'grid-changed', 'booth-added', 'booth-removed', 'booth-updated',
      'escalator-links-changed', 'preview-views-changed', 'floor-annotations-changed', 'snapshot-seq-changed'
    ];
    const offs = events.map(evt => bus.on(evt, () => {
        clearTimeout(_saveTimer);
        _saveTimer = setTimeout(() => Persistence.save(store), AUTO_SAVE_DELAY);
      }));
    _autoSaveStop = () => {
      offs.forEach(off => {
        try { off?.(); } catch {}
      });
      offs.length = 0;
      clearTimeout(_saveTimer);
      _saveTimer = null;
      _autoSaveStop = null;
    };
    return _autoSaveStop;
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
    const metas = Persistence._readFileMetas();
    metas.forEach(meta => {
      if (!meta?.id) return;
      localStorage.removeItem(Persistence._fileSnapshotKey(meta.id));
      localStorage.removeItem(Persistence._versionsKey(meta.id));
    });
    localStorage.removeItem(FILES_META_KEY);
    localStorage.removeItem(CURRENT_FILE_KEY);
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
    const fileId = Persistence.getCurrentFileId();
    if (fileId) {
      localStorage.setItem(Persistence._versionsKey(fileId), JSON.stringify(versions));
    }
    bus.emit('versions-changed');
    return { ok: true };
  }
}
