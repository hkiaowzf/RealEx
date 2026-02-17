import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Persistence } from '../../src/utils/Persistence.js';
import { resetCounters, generateBoothId, setCounter } from '../../src/utils/IdGenerator.js';
import { bus } from '../../src/utils/EventBus.js';

function makeStore() {
  return {
    exhibition: {
      id: 'ex-1',
      name: 'Test',
      startTime: '',
      endTime: '',
      description: '',
      floors: [],
      escalatorLinks: []
    },
    activeFloorIndex: 0,
    showFloorAnnotations: true,
    previewViewPresets: [],
    activePreviewViewPresetId: null,
    snapshotNameSeq: 1,
    sanitizeEscalatorLinks: vi.fn()
  };
}

describe('Persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    resetCounters();
    bus._listeners = {};
  });

  describe('serialize', () => {
    it('captures all required fields', () => {
      const store = makeStore();
      const snapshot = Persistence.serialize(store);
      expect(snapshot.exhibition).toBe(store.exhibition);
      expect(snapshot.activeFloorIndex).toBe(0);
      expect(snapshot.showFloorAnnotations).toBe(true);
      expect(snapshot.previewViewPresets).toEqual([]);
      expect(snapshot.activePreviewViewPresetId).toBeNull();
      expect(snapshot.snapshotNameSeq).toBe(1);
      expect(snapshot.savedAt).toBeTypeOf('number');
    });
  });

  describe('save / load', () => {
    it('save writes to localStorage and load retrieves it', () => {
      const store = makeStore();
      Persistence.save(store);
      const loaded = Persistence.load();
      expect(loaded).not.toBeNull();
      expect(loaded.exhibition.id).toBe('ex-1');
      expect(loaded.activeFloorIndex).toBe(0);
    });

    it('load returns null when nothing saved', () => {
      expect(Persistence.load()).toBeNull();
    });

    it('save handles localStorage error gracefully', () => {
      const store = makeStore();
      const orig = localStorage.setItem;
      localStorage.setItem = () => { throw new Error('quota'); };
      expect(() => Persistence.save(store)).not.toThrow();
      localStorage.setItem = orig;
    });

    it('load handles corrupted data gracefully', () => {
      localStorage.setItem('expogrid_current', '{invalid json');
      expect(Persistence.load()).toBeNull();
    });
  });

  describe('restore', () => {
    it('restores state from snapshot', () => {
      const store = makeStore();
      const snapshot = {
        exhibition: {
          id: 'ex-2', name: 'Restored', startTime: '', endTime: '',
          description: '', floors: [], escalatorLinks: []
        },
        activeFloorIndex: 2,
        showFloorAnnotations: false,
        previewViewPresets: [{ id: 'p1' }],
        activePreviewViewPresetId: 'p1',
        snapshotNameSeq: 5
      };
      Persistence.restore(store, snapshot);
      expect(store.exhibition.id).toBe('ex-2');
      expect(store.activeFloorIndex).toBe(2);
      expect(store.showFloorAnnotations).toBe(false);
      expect(store.previewViewPresets).toEqual([{ id: 'p1' }]);
      expect(store.activePreviewViewPresetId).toBe('p1');
      expect(store.snapshotNameSeq).toBe(5);
    });

    it('adds escalatorLinks if missing (backward compat)', () => {
      const store = makeStore();
      const snapshot = {
        exhibition: { id: 'ex-3', name: 'Old', floors: [] },
        activeFloorIndex: 0
      };
      Persistence.restore(store, snapshot);
      expect(store.exhibition.escalatorLinks).toEqual([]);
    });

    it('limits previewViewPresets to 3', () => {
      const store = makeStore();
      const snapshot = {
        exhibition: { id: 'ex-4', floors: [], escalatorLinks: [] },
        previewViewPresets: [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }]
      };
      Persistence.restore(store, snapshot);
      expect(store.previewViewPresets).toHaveLength(3);
    });

    it('calls sanitizeEscalatorLinks', () => {
      const store = makeStore();
      const snapshot = {
        exhibition: { id: 'ex-5', floors: [], escalatorLinks: [] }
      };
      Persistence.restore(store, snapshot);
      expect(store.sanitizeEscalatorLinks).toHaveBeenCalled();
    });
  });

  describe('version management', () => {
    it('saveVersion and getVersions', () => {
      const store = makeStore();
      Persistence.saveVersion(store, 'v1');
      const versions = Persistence.getVersions();
      expect(versions).toHaveLength(1);
      expect(versions[0].label).toBe('v1');
    });

    it('versions are prepended (newest first)', () => {
      const store = makeStore();
      Persistence.saveVersion(store, 'first');
      // Change data to ensure diff detection
      store.exhibition.name = 'Changed';
      Persistence.saveVersion(store, 'second');
      const versions = Persistence.getVersions();
      expect(versions[0].label).toBe('second');
      expect(versions[1].label).toBe('first');
    });

    it('enforces MAX_VERSIONS = 20 limit', () => {
      const store = makeStore();
      for (let i = 0; i < 25; i++) {
        // Change data each time to ensure diff detection
        store.exhibition.name = `Expo ${i}`;
        Persistence.saveVersion(store, `v${i}`);
      }
      const versions = Persistence.getVersions();
      expect(versions).toHaveLength(20);
    });

    it('deleteVersion removes at index', () => {
      const store = makeStore();
      Persistence.saveVersion(store, 'a');
      // Change data to ensure diff detection
      store.exhibition.name = 'Changed';
      Persistence.saveVersion(store, 'b');
      Persistence.deleteVersion(0);
      const versions = Persistence.getVersions();
      expect(versions).toHaveLength(1);
      expect(versions[0].label).toBe('a');
    });

    it('deleteVersion with invalid index does nothing', () => {
      const store = makeStore();
      Persistence.saveVersion(store, 'a');
      Persistence.deleteVersion(-1);
      Persistence.deleteVersion(99);
      expect(Persistence.getVersions()).toHaveLength(1);
    });

    it('restoreVersion restores and saves', () => {
      const store = makeStore();
      store.exhibition.name = 'Original';
      Persistence.saveVersion(store, 'snap');
      store.exhibition.name = 'Changed';
      const result = Persistence.restoreVersion(store, 0);
      expect(result).toBe(true);
      expect(store.exhibition.name).toBe('Original');
    });

    it('restoreVersion returns false for invalid index', () => {
      const store = makeStore();
      expect(Persistence.restoreVersion(store, 0)).toBe(false);
      expect(Persistence.restoreVersion(store, -1)).toBe(false);
    });

    it('getVersions returns empty array on corrupted data', () => {
      localStorage.setItem('expogrid_versions', 'not json');
      expect(Persistence.getVersions()).toEqual([]);
    });
  });

  describe('_restoreIdCounters', () => {
    it('restores counters from booth IDs', () => {
      const store = makeStore();
      store.exhibition.floors = [{
        booths: [
          { id: 'A003' },
          { id: 'A001' },
          { id: 'B005' }
        ]
      }];
      Persistence._restoreIdCounters(store);
      // After restore, next A should be A004, next B should be B006
      expect(generateBoothId('A1')).toBe('A004');
      expect(generateBoothId('B1')).toBe('B006');
    });

    it('handles store with no exhibition', () => {
      const store = { exhibition: null };
      expect(() => Persistence._restoreIdCounters(store)).not.toThrow();
    });
  });

  describe('clearAll', () => {
    it('removes both storage keys', () => {
      const store = makeStore();
      Persistence.save(store);
      Persistence.saveVersion(store, 'v1');
      Persistence.clearAll();
      expect(Persistence.load()).toBeNull();
      expect(Persistence.getVersions()).toEqual([]);
    });
  });

  describe('backup and import', () => {
    it('createBackup creates valid backup structure', () => {
      const store = makeStore();
      store.exhibition.name = 'Test Expo';
      Persistence.saveVersion(store, 'v1');
      const backup = Persistence.createBackup(store);
      expect(backup.type).toBe('expogrid-backup');
      expect(backup.version).toBe(1);
      expect(backup.createdAt).toBeTypeOf('number');
      expect(backup.current).toBeDefined();
      expect(backup.current.exhibition.name).toBe('Test Expo');
      expect(backup.versions).toHaveLength(1);
    });

    it('importBackup restores current state and versions', () => {
      const store1 = makeStore();
      store1.exhibition.name = 'Original';
      Persistence.saveVersion(store1, 'v1');
      const backup = Persistence.createBackup(store1);

      const store2 = makeStore();
      store2.exhibition.name = 'Different';
      const result = Persistence.importBackup(store2, backup);
      expect(result.ok).toBe(true);
      expect(store2.exhibition.name).toBe('Original');
      expect(Persistence.getVersions()).toHaveLength(1);
    });

    it('importBackup rejects invalid backup (no type)', () => {
      const store = makeStore();
      const result = Persistence.importBackup(store, { version: 1 });
      expect(result.ok).toBe(false);
      expect(result.message).toContain('格式无效');
    });

    it('importBackup rejects invalid backup (wrong type)', () => {
      const store = makeStore();
      const result = Persistence.importBackup(store, { type: 'wrong', version: 1 });
      expect(result.ok).toBe(false);
      expect(result.message).toContain('格式无效');
    });

    it('importBackup rejects backup without current data', () => {
      const store = makeStore();
      const result = Persistence.importBackup(store, {
        type: 'expogrid-backup',
        version: 1,
        current: null
      });
      expect(result.ok).toBe(false);
      expect(result.message).toContain('缺少当前展览数据');
    });

    it('importBackup handles backup without versions array', () => {
      const store = makeStore();
      const backup = {
        type: 'expogrid-backup',
        version: 1,
        current: Persistence.serialize(store)
      };
      const result = Persistence.importBackup(store, backup);
      expect(result.ok).toBe(true);
      expect(Persistence.getVersions()).toEqual([]);
    });

    it('importBackup handles null/undefined backup', () => {
      const store = makeStore();
      expect(Persistence.importBackup(store, null).ok).toBe(false);
      expect(Persistence.importBackup(store, undefined).ok).toBe(false);
    });
  });

  describe('version diff detection', () => {
    it('saveVersion skips when no changes detected', () => {
      const store = makeStore();
      const result1 = Persistence.saveVersion(store, 'v1');
      expect(result1.saved).toBe(true);
      const result2 = Persistence.saveVersion(store, 'v2');
      expect(result2.saved).toBe(false);
      expect(result2.reason).toBe('no-change');
      expect(Persistence.getVersions()).toHaveLength(1);
    });

    it('saveVersion saves when changes detected', () => {
      const store = makeStore();
      Persistence.saveVersion(store, 'v1');
      store.exhibition.name = 'Changed';
      const result = Persistence.saveVersion(store, 'v2');
      expect(result.saved).toBe(true);
      expect(Persistence.getVersions()).toHaveLength(2);
    });
  });
});