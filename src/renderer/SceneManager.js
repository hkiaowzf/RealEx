import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { bus } from '../utils/EventBus.js';
import { store } from '../data/Store.js';
import { CellType } from '../data/ExhibitionModel.js';
import { FloorRenderer } from './FloorRenderer.js';
import { VerticalLinkRenderer } from './VerticalLinkRenderer.js';
import { InteractionManager } from './InteractionManager.js';

export class SceneManager {
  constructor(canvas, options = {}) {
    this.lockZoom = !!options.lockZoom;
    this.tenantView = !!options.tenantView;
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#fff6ea');

    const rect = canvas.getBoundingClientRect();
    this.camera = new THREE.PerspectiveCamera(45, rect.width / rect.height, 0.1, 500);
    this.camera.position.set(15, 18, 15);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(rect.width, rect.height);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.zoomSpeed = 0.7;
    this.controls.enableZoom = !this.lockZoom;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 80;
    this.controls.screenSpacePanning = true;
    this._spacePressed = false;
    this._setMouseMode();
    this.controls.target.set(0, 0, 0);
    this._isInteracting = false;
    this._renderRaf = null;

    this._addLights();
    this.floorRenderers = [];
    this._rebuildRaf = null;
    this.verticalLinks = new VerticalLinkRenderer();
    this.interaction = new InteractionManager(this);
    this.floorSizeCache = new Map();
    this._unsubs = [];
    this._eventController = new AbortController();
    const signal = this._eventController.signal;

    this._subscribe();
    window.addEventListener('resize', () => this._onResize(), { signal });
    window.addEventListener('keydown', e => this._onKeyDown(e), { signal });
    window.addEventListener('keyup', e => this._onKeyUp(e), { signal });
    window.addEventListener('blur', () => this._resetKeyState(), { signal });
    this._onControlsStart = () => {
      this._isInteracting = true;
      this.requestRender();
    };
    this._onControlsEnd = () => {
      this._isInteracting = false;
      this.requestRender();
    };
    this._onControlsChange = () => this.requestRender();
    this.controls.addEventListener('start', this._onControlsStart);
    this.controls.addEventListener('end', this._onControlsEnd);
    this.controls.addEventListener('change', this._onControlsChange);
    this.requestRender();
  }

  _setMouseMode() {
    this.controls.mouseButtons = {
      LEFT: this._spacePressed ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN
    };
  }

  _onKeyDown(e) {
    if (store.editMode !== 'preview') return;
    const target = e.target;
    const tag = target?.tagName;
    const isEditableTarget =
      target?.isContentEditable ||
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT';
    if (isEditableTarget || e.isComposing || e.keyCode === 229) return;
    if (e.code !== 'Space') return;
    if (!this._spacePressed) {
      this._spacePressed = true;
      this._setMouseMode();
    }
    e.preventDefault();
  }

  _onKeyUp(e) {
    if (store.editMode !== 'preview') return;
    if (e.code !== 'Space') return;
    this._spacePressed = false;
    this._setMouseMode();
    e.preventDefault();
  }

  _resetKeyState() {
    this._spacePressed = false;
    this._setMouseMode();
  }

  _addLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(15, 25, 15);
    this.scene.add(dir);
  }

  _subscribe() {
    this._unsubs.push(bus.on('floor-added', () => this._scheduleRebuild()));
    this._unsubs.push(bus.on('floor-removed', () => this._scheduleRebuild()));
    this._unsubs.push(bus.on('floor-changed', payload => this._onFloorChanged(payload)));
    this._unsubs.push(bus.on('grid-changed', payload => this._onGridChanged(payload)));
    this._unsubs.push(bus.on('booth-added', booth => this._onBoothAdded(booth)));
    this._unsubs.push(bus.on('booth-removed', booth => this._onBoothRemoved(booth)));
    this._unsubs.push(bus.on('booth-updated', booth => this._onBoothUpdated(booth)));
    this._unsubs.push(bus.on('escalator-links-changed', () => this._rebuildVerticalLinks()));
    this._unsubs.push(bus.on('view-filter-changed', () => this._onViewFilterChanged()));
    this._unsubs.push(bus.on('floor-annotations-changed', () => this._applyFloorAnnotationVisibility()));
    this._unsubs.push(bus.on('active-floor-changed', () => {
      this._updateVisibility();
      this._refreshBoothStyles();
    }));
    this._unsubs.push(bus.on('booth-selected', () => this._refreshBoothStyles()));
    this._unsubs.push(bus.on('cell-selected', () => this._refreshBoothStyles()));
    this._unsubs.push(bus.on('edit-mode-changed', mode => {
      if (mode !== 'preview') this._resetKeyState();
    }));
  }

  _onGridChanged(payload) {
    if (!payload || !Number.isInteger(payload.x) || !Number.isInteger(payload.z) || !payload.floor) {
      this._scheduleRebuild();
      return;
    }
    const floorIndex = store.floors.indexOf(payload.floor);
    if (floorIndex < 0) {
      this._scheduleRebuild();
      return;
    }
    const renderer = this.floorRenderers[floorIndex];
    if (!renderer) {
      this._scheduleRebuild();
      return;
    }
    const prevType = renderer.getRenderedCellType(payload.x, payload.z);
    const nextType = payload.floor.grid?.[payload.x]?.[payload.z] || null;
    renderer.updateCell(payload.x, payload.z);
    this.requestRender();
    if (this._isLinkCellType(prevType) || this._isLinkCellType(nextType)) {
      this._rebuildVerticalLinks();
    }
  }

  _onFloorChanged(payload) {
    const floor = payload?.floor || payload;
    if (!floor) {
      this._scheduleRebuild();
      return;
    }
    const floorIndex = this._findFloorIndexByFloorId(floor.id);
    const renderer = floorIndex >= 0 ? this.floorRenderers[floorIndex] : null;
    if (!renderer) {
      this._scheduleRebuild();
      return;
    }
    const prev = this.floorSizeCache.get(floor.id);
    const sameSize = !!prev && prev.width === floor.width && prev.depth === floor.depth;
    const sameRef = renderer.floor === floor;
    if (!sameSize || !sameRef) {
      this._scheduleRebuild();
      return;
    }
    // Lightweight path for floor-level changes when geometry dimensions are unchanged.
    renderer.applyViewFilter();
    renderer.updateBoothStyles();
    this._rebuildVerticalLinks();
    this.floorSizeCache.set(floor.id, { width: floor.width, depth: floor.depth });
  }

  _findFloorIndexByFloorId(floorId) {
    return store.floors.findIndex(f => f.id === floorId);
  }

  _onBoothAdded(booth) {
    const floorIndex = this._findFloorIndexByFloorId(booth?.floorId);
    if (floorIndex < 0) {
      this._scheduleRebuild();
      return;
    }
    const renderer = this.floorRenderers[floorIndex];
    if (!renderer) {
      this._scheduleRebuild();
      return;
    }
    renderer.upsertBooth(booth);
    this.requestRender();
  }

  _onBoothRemoved(booth) {
    const floorIndex = this._findFloorIndexByFloorId(booth?.floorId);
    if (floorIndex < 0) {
      this._scheduleRebuild();
      return;
    }
    const renderer = this.floorRenderers[floorIndex];
    if (!renderer) {
      this._scheduleRebuild();
      return;
    }
    renderer.removeBoothById(booth.id);
    this.requestRender();
  }

  _onBoothUpdated(booth) {
    const floorIndex = this._findFloorIndexByFloorId(booth?.floorId);
    if (floorIndex < 0) {
      this._scheduleRebuild();
      return;
    }
    const renderer = this.floorRenderers[floorIndex];
    if (!renderer) {
      this._scheduleRebuild();
      return;
    }
    renderer.upsertBooth(booth);
    this.requestRender();
  }

  _onViewFilterChanged() {
    if (!this.floorRenderers.length) {
      this._scheduleRebuild();
      return;
    }
    this.floorRenderers.forEach(fr => fr.applyViewFilter());
    this._rebuildVerticalLinks();
    this._refreshBoothStyles();
  }

  _isLinkCellType(type) {
    return type === CellType.ELEVATOR || type === CellType.ESCALATOR;
  }

  _scheduleRebuild() {
    if (this._rebuildRaf) return;
    this._rebuildRaf = requestAnimationFrame(() => {
      this._rebuildRaf = null;
      this.rebuildAll();
    });
  }

  rebuildAll() {
    store.sanitizeEscalatorLinks();
    this.floorRenderers.forEach(fr => {
      this.scene.remove(fr.group);
      fr.dispose();
    });
    this.floorRenderers = [];
    this.floorSizeCache.clear();
    store.floors.forEach((floor, i) => {
      const fr = new FloorRenderer(floor, i, store);
      this.scene.add(fr.group);
      this.floorRenderers.push(fr);
      this.floorSizeCache.set(floor.id, { width: floor.width, depth: floor.depth });
    });
    this._rebuildVerticalLinks();
    this._applyFloorAnnotationVisibility();
    this._updateVisibility();
    this._refreshBoothStyles();
    this.requestRender();
  }

  _rebuildVerticalLinks() {
    this.scene.remove(this.verticalLinks.group);
    this.verticalLinks.rebuild(store.floors);
    this.scene.add(this.verticalLinks.group);
    this.requestRender();
  }

  _updateVisibility() {
    this.floorRenderers.forEach((fr, i) => {
      const isActive = i === store.activeFloorIndex;
      fr.setOpacity(isActive ? 1.0 : 0.15);
    });
    // Move camera target to active floor
    const y = store.activeFloorIndex * 5;
    this.controls.target.set(0, y, 0);
    this.requestRender();
  }

  _refreshBoothStyles() {
    this.floorRenderers.forEach(fr => fr.updateBoothStyles());
    this.requestRender();
  }

  _applyFloorAnnotationVisibility() {
    this.floorRenderers.forEach(fr => {
      fr.setFloorAnnotationsVisible(store.showFloorAnnotations !== false);
    });
    this.requestRender();
  }

  _onResize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(rect.width, rect.height);
    this.requestRender();
  }

  requestRender() {
    if (this._renderRaf) return;
    this._renderRaf = requestAnimationFrame(() => this._renderFrame());
  }

  _renderFrame() {
    this._renderRaf = null;
    const changed = this.controls.update();
    this.renderer.render(this.scene, this.camera);
    if (this._isInteracting || changed) {
      this.requestRender();
    }
  }

  getBoothMeshes() {
    const meshes = [];
    this.floorRenderers.forEach(fr => {
      fr.boothMeshes.forEach(m => meshes.push(m));
    });
    return meshes;
  }

  getSelectableMeshes() {
    const meshes = [];
    this.floorRenderers.forEach(fr => {
      fr.boothMeshes.forEach(m => meshes.push(m));
      fr.selectableCellMeshes.forEach(m => meshes.push(m));
    });
    return meshes;
  }

  // --- Public zoom/pan API ---
  zoomIn() {
    if (this.lockZoom) return;
    const dir = new THREE.Vector3().subVectors(this.controls.target, this.camera.position).normalize();
    const dist = this.camera.position.distanceTo(this.controls.target);
    const step = Math.max(0.4, dist * 0.08);
    if (dist - step > this.controls.minDistance) {
      this.camera.position.addScaledVector(dir, step);
      this.requestRender();
    }
  }

  zoomOut() {
    if (this.lockZoom) return;
    const dir = new THREE.Vector3().subVectors(this.controls.target, this.camera.position).normalize();
    const dist = this.camera.position.distanceTo(this.controls.target);
    const step = Math.max(0.4, dist * 0.08);
    if (dist + step < this.controls.maxDistance) {
      this.camera.position.addScaledVector(dir, -step);
      this.requestRender();
    }
  }

  panBy(dx, dy) {
    // Pan in camera-local XY plane
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    this.camera.getWorldDirection(new THREE.Vector3());
    right.setFromMatrixColumn(this.camera.matrixWorld, 0);
    up.setFromMatrixColumn(this.camera.matrixWorld, 1);
    const dist = this.camera.position.distanceTo(this.controls.target);
    const scale = dist * 0.002;
    const offset = new THREE.Vector3()
      .addScaledVector(right, -dx * scale)
      .addScaledVector(up, dy * scale);
    this.camera.position.add(offset);
    this.controls.target.add(offset);
    this.requestRender();
  }

  resetView() {
    const y = store.activeFloorIndex * 5;
    this.camera.position.set(15, y + 18, 15);
    this.controls.target.set(0, y, 0);
    this.requestRender();
  }

  fitToView() {
    const floor = store.activeFloor;
    if (!floor) return;
    const target = new THREE.Vector3(0, store.activeFloorIndex * 5, 0);
    const halfWidth = floor.width / 2 + 0.8;
    const halfDepth = floor.depth / 2 + 0.8;
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const distByDepth = halfDepth / Math.tan(vFov / 2);
    const distByWidth = halfWidth / Math.tan(hFov / 2);
    const dist = Math.max(distByDepth, distByWidth) * 1.2;
    const dir = new THREE.Vector3(1, 1.2, 1).normalize();
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.controls.target.copy(target);
    this.requestRender();
  }

  fitToGoldenView() {
    const floor = store.activeFloor;
    if (!floor) return;
    const target = new THREE.Vector3(0, store.activeFloorIndex * 5, 0);
    const halfWidth = floor.width / 2 + 0.8;
    const halfDepth = floor.depth / 2 + 0.8;
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const distByDepth = halfDepth / Math.tan(vFov / 2);
    const distByWidth = halfWidth / Math.tan(hFov / 2);
    const GOLDEN = 1.618;
    const dist = Math.max(distByDepth, distByWidth) * 1.2 * GOLDEN;
    const dir = new THREE.Vector3(1, 1.2, 1).normalize();
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.controls.target.copy(target);
    this.requestRender();
  }

  snapshotView() {
    const floor = store.activeFloor;
    if (!floor) return;
    const target = new THREE.Vector3(0, store.activeFloorIndex * 5 + 0.6, 0);
    const halfWidth = floor.width / 2 + 0.8;
    const halfDepth = floor.depth / 2 + 0.8;
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const distByDepth = halfDepth / Math.tan(vFov / 2);
    const distByWidth = halfWidth / Math.tan(hFov / 2);
    const dist = Math.max(distByDepth, distByWidth) * 1.35;
    // Slightly elevated oblique angle, optimized for taking overview snapshots.
    const dir = new THREE.Vector3(1.45, 1.05, 1.25).normalize();
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.controls.target.copy(target);
    this.controls.update();
    this.requestRender();
  }

  captureSnapshotDataURL() {
    try {
      return this.renderer.domElement.toDataURL('image/png');
    } catch {
      return '';
    }
  }

  getZoomPercent() {
    const defaultDist = Math.sqrt(15*15 + 18*18 + 15*15); // ~27.9
    const dist = this.camera.position.distanceTo(this.controls.target);
    return Math.round((defaultDist / dist) * 100);
  }

  captureViewState() {
    return {
      floorIndex: store.activeFloorIndex,
      camera: {
        x: this.camera.position.x,
        y: this.camera.position.y,
        z: this.camera.position.z
      },
      target: {
        x: this.controls.target.x,
        y: this.controls.target.y,
        z: this.controls.target.z
      }
    };
  }

  applyViewState(state) {
    if (!state?.camera || !state?.target) return false;
    const floorIndex = Number.isInteger(state.floorIndex) ? state.floorIndex : store.activeFloorIndex;
    if (floorIndex >= 0 && floorIndex < store.floors.length) {
      store.setActiveFloor(floorIndex);
    }
    this.camera.position.set(state.camera.x, state.camera.y, state.camera.z);
    this.controls.target.set(state.target.x, state.target.y, state.target.z);
    this.controls.update();
    this.requestRender();
    return true;
  }

  destroy() {
    if (this._renderRaf) {
      cancelAnimationFrame(this._renderRaf);
      this._renderRaf = null;
    }
    if (this._rebuildRaf) {
      cancelAnimationFrame(this._rebuildRaf);
      this._rebuildRaf = null;
    }
    this._eventController.abort();
    this._unsubs.forEach(off => {
      try { off(); } catch {}
    });
    this._unsubs = [];
    this.controls.removeEventListener('start', this._onControlsStart);
    this.controls.removeEventListener('end', this._onControlsEnd);
    this.controls.removeEventListener('change', this._onControlsChange);
    this.interaction?.destroy?.();
    this.floorRenderers.forEach(fr => {
      this.scene.remove(fr.group);
      fr.dispose();
    });
    this.floorRenderers = [];
    this.scene.remove(this.verticalLinks.group);
    this.verticalLinks.dispose();
    this.controls?.dispose?.();
    this.renderer?.dispose?.();
  }
}
