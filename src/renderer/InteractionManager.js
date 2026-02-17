import * as THREE from 'three';
import { store } from '../data/Store.js';

export class InteractionManager {
  constructor(sceneManager) {
    this.sm = sceneManager;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hoveredMesh = null;
    this.isPointerDown = false;
    this.dragMoved = false;
    this.downX = 0;
    this.downY = 0;
    this._hoverRaf = null;
    this._pendingHover = null;
    this._eventController = new AbortController();
    const signal = this._eventController.signal;

    this.sm.canvas.addEventListener('pointerdown', e => this._onPointerDown(e), { signal });
    this.sm.canvas.addEventListener('pointerup', e => this._onPointerUp(e), { signal });
    this.sm.canvas.addEventListener('pointercancel', () => this._resetPointerDown(), { signal });
    this.sm.canvas.addEventListener('pointerleave', () => this._resetPointerDown(), { signal });
    this.sm.canvas.addEventListener('pointermove', e => this._onHover(e), { signal });
    window.addEventListener('blur', () => this._resetPointerDown(), { signal });
  }

  _resetPointerDown() {
    this.isPointerDown = false;
    this.dragMoved = false;
  }

  _setPointer(clientX, clientY) {
    const rect = this.sm.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  }

  _intersect() {
    this.raycaster.setFromCamera(this.pointer, this.sm.camera);
    return this.raycaster.intersectObjects(this.sm.getSelectableMeshes(), false);
  }

  _onPointerDown(e) {
    if (e.button !== 0) return;
    this.isPointerDown = true;
    this.dragMoved = false;
    this.downX = e.clientX;
    this.downY = e.clientY;
  }

  _onPointerUp(e) {
    if (e.button !== 0 || !this.isPointerDown) return;
    this.isPointerDown = false;
    if (this.dragMoved) return;

    this._setPointer(e.clientX, e.clientY);
    const hits = this._intersect();
    if (hits.length) {
      const hitData = hits[0].object.userData || {};
      const boothId = hitData.boothId;
      if (boothId) {
        store.selectBooth(boothId);
        return;
      }
      if (hitData.cellType) {
        store.selectCell(hitData.x, hitData.z, hitData.cellType);
        return;
      }
    }
    store.clearSelection();
  }

  _clearHoverState() {
    let changed = false;
    if (this.hoveredMesh) {
      this.hoveredMesh.material.emissive?.setHex(0x000000);
      this.hoveredMesh = null;
      changed = true;
    }
    if (this.sm.canvas.style.cursor !== 'default') {
      this.sm.canvas.style.cursor = 'default';
      changed = true;
    }
    return changed;
  }

  _processHover() {
    if (!this._pendingHover) return;
    const hover = this._pendingHover;
    this._pendingHover = null;

    // Skip expensive raycasting while dragging.
    if (this.isPointerDown && this.dragMoved) {
      if (this._clearHoverState()) this.sm.requestRender();
      return;
    }

    let styleChanged = false;
    this._setPointer(hover.clientX, hover.clientY);
    const hits = this._intersect();
    // Reset previous hover
    if (this.hoveredMesh) {
      this.hoveredMesh.material.emissive?.setHex(0x000000);
      this.hoveredMesh = null;
      styleChanged = true;
    }
    if (hits.length && (hits[0].object.userData.boothId || hits[0].object.userData.cellType)) {
      this.hoveredMesh = hits[0].object;
      this.hoveredMesh.material.emissive?.setHex(0x333333);
      this.sm.canvas.style.cursor = 'pointer';
      styleChanged = true;
    } else {
      this.sm.canvas.style.cursor = 'default';
    }
    if (styleChanged) this.sm.requestRender();
  }

  _onHover(e) {
    if (this.isPointerDown && !this.dragMoved) {
      const moved = Math.abs(e.clientX - this.downX) + Math.abs(e.clientY - this.downY);
      if (moved > 5) this.dragMoved = true;
    }
    if (this.isPointerDown && this.dragMoved) {
      if (this._clearHoverState()) this.sm.requestRender();
      return;
    }
    this._pendingHover = { clientX: e.clientX, clientY: e.clientY };
    if (this._hoverRaf) return;
    this._hoverRaf = requestAnimationFrame(() => {
      this._hoverRaf = null;
      this._processHover();
    });
  }

  destroy() {
    this._eventController.abort();
    if (this._hoverRaf) {
      cancelAnimationFrame(this._hoverRaf);
      this._hoverRaf = null;
    }
    this._pendingHover = null;
    this._resetPointerDown();
    this._clearHoverState();
  }
}
