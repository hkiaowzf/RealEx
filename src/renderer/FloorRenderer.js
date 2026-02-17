import * as THREE from 'three';
import { CellType } from '../data/ExhibitionModel.js';
import { BoothMeshFactory } from './BoothMeshFactory.js';

const STATUS_COLORS = {
  idle: 0x4caf50,
  reserved: 0xff9800,
  sold: 0xf44336
};

const SELECTED_COLOR = 0x2196f3;
const LED_COLOR = 0x90a4ae;
const TENANT_RECOMMENDED_COLOR = 0xffffff;
const TENANT_RECOMMENDED_OUTLINE_COLOR = 0xd4af37;

export class FloorRenderer {
  constructor(floor, floorIndex, store) {
    this.floor = floor;
    this.floorIndex = floorIndex;
    this.store = store;
    this.group = new THREE.Group();
    this.group.position.y = floorIndex * 5;
    this.offsetX = 0;
    this.offsetZ = 0;
    this.boothMeshes = [];
    this.boothMeshMap = new Map();
    this.boothGroups = new Map();
    this.selectableCellMeshes = [];
    this.publicCellMeshes = new Map();
    this.floorLabelSprite = null;
    this.floorLabelConnector = null;
    this._build();
  }

  _build() {
    const { width, depth } = this.floor;
    const ox = (width - 1) / 2;
    const oz = (depth - 1) / 2;
    this.offsetX = ox;
    this.offsetZ = oz;

    // Ground plane
    const groundGeo = new THREE.PlaneGeometry(width + 0.5, depth + 0.5);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0xefe3d6 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0.5, -0.01, 0.5);
    this.group.add(ground);

    // Floor index label on the left edge in preview
    this._buildFloorTag(ox);

    // Grid lines
    const lineMat = new THREE.LineBasicMaterial({ color: 0xd7cec4 });
    const pts = [];
    for (let x = 0; x <= width; x++) {
      pts.push(new THREE.Vector3(x - ox, 0, -oz));
      pts.push(new THREE.Vector3(x - ox, 0, depth - oz));
    }
    for (let z = 0; z <= depth; z++) {
      pts.push(new THREE.Vector3(-ox, 0, z - oz));
      pts.push(new THREE.Vector3(width - ox, 0, z - oz));
    }
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
    this.group.add(new THREE.LineSegments(lineGeo, lineMat));

    // Public area cells
    for (let x = 0; x < width; x++) {
      for (let z = 0; z < depth; z++) {
        this._syncPublicCellMesh(x, z);
      }
    }

    // Booths
    const isActiveFloor = this.floorIndex === this.store.activeFloorIndex;
    this.floor.booths.forEach(booth => {
      const isSelected = isActiveFloor && booth.id === this.store.selectedBoothId;
      const boothGroup = BoothMeshFactory.createBoothMesh(booth, ox, oz, isSelected);
      boothGroup.userData = { boothId: booth.id, floorIndex: this.floorIndex };
      boothGroup.visible = this._isBoothVisible(booth);
      this.group.add(boothGroup);
      this.boothGroups.set(booth.id, boothGroup);
      // Collect individual meshes for raycasting
      const boothMeshes = [];
      boothGroup.children.forEach(child => {
        if (child.isMesh && child.userData.boothId) {
          this.boothMeshes.push(child);
          boothMeshes.push(child);
        }
      });
      this.boothMeshMap.set(booth.id, boothMeshes);
    });
    this._updateFloorTagStyle();
  }

  _isPublicCellVisible(type) {
    const filter = this.store.viewFilter;
    if (filter === 'all') {
      return type === CellType.CORRIDOR ||
        type === CellType.RESTRICTED ||
        type === CellType.ENTRANCE ||
        type === CellType.ELEVATOR ||
        type === CellType.ESCALATOR ||
        type === CellType.LED_SCREEN;
    }
    const filterMap = {
      corridor: CellType.CORRIDOR,
      restricted: CellType.RESTRICTED,
      entrance: CellType.ENTRANCE,
      elevator: CellType.ELEVATOR,
      escalator: CellType.ESCALATOR,
      ledScreen: CellType.LED_SCREEN
    };
    return filterMap[filter] === type;
  }

  _isBoothVisible(booth) {
    const filter = this.store.viewFilter;
    if (filter === 'all' || filter === 'booth') return true;
    if (filter === 'booth-reserved') return booth.status === 'reserved';
    if (filter === 'booth-sold') return booth.status === 'sold';
    return false;
  }

  setOpacity(opacity) {
    this.group.traverse(child => {
      if (child.isMesh || child.isLine) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach(material => {
          if (!material) return;
          material.transparent = opacity < 1;
          material.opacity = opacity;
          material.needsUpdate = true;
        });
      }
      if (child.isSprite) {
        child.material.opacity = opacity;
      }
    });
  }

  updateBoothStyles() {
    const isActiveFloor = this.floorIndex === this.store.activeFloorIndex;
    const boothById = new Map(this.floor.booths.map(booth => [booth.id, booth]));

    this.boothMeshes.forEach(mesh => {
      const boothId = mesh.userData.boothId;
      const booth = boothById.get(boothId);
      if (!booth) return;
      const isTenantRecommended = !!this.store.tenantViewEnabled && !!this.store.tenantHighlightedBoothId && boothId === this.store.tenantHighlightedBoothId;
      const color = isTenantRecommended
        ? TENANT_RECOMMENDED_COLOR
        : ((isActiveFloor && boothId === this.store.selectedBoothId)
          ? SELECTED_COLOR
          : (STATUS_COLORS[booth.status] || STATUS_COLORS.idle));
      mesh.material.color.setHex(color);
      this._setRecommendedOutline(mesh, isTenantRecommended);
    });
    this.selectableCellMeshes.forEach(mesh => {
      const isSelectedLed = isActiveFloor &&
        this.store.selectedCell &&
        this.store.selectedCell.type === CellType.LED_SCREEN &&
        this.store.selectedCell.x === mesh.userData.x &&
        this.store.selectedCell.z === mesh.userData.z;
      mesh.material.color.setHex(isSelectedLed ? SELECTED_COLOR : LED_COLOR);
    });
    this._updateFloorTagStyle();
  }

  updateCell(x, z) {
    if (x < 0 || z < 0 || x >= this.floor.width || z >= this.floor.depth) return;
    this._syncPublicCellMesh(x, z);
    this.updateBoothStyles();
  }

  getRenderedCellType(x, z) {
    const key = this._cellKey(x, z);
    return this.publicCellMeshes.get(key)?.userData?.cellType || null;
  }

  applyViewFilter() {
    for (let x = 0; x < this.floor.width; x++) {
      for (let z = 0; z < this.floor.depth; z++) {
        if (this._isPublicCellType(this.floor.grid[x][z])) {
          this._syncPublicCellMesh(x, z);
        }
      }
    }
    this.floor.booths.forEach(booth => {
      const boothGroup = this.boothGroups.get(booth.id);
      if (boothGroup) boothGroup.visible = this._isBoothVisible(booth);
    });
  }

  upsertBooth(booth) {
    if (!booth) return;
    this._removeBoothGroup(booth.id);

    const isActiveFloor = this.floorIndex === this.store.activeFloorIndex;
    const isSelected = isActiveFloor && booth.id === this.store.selectedBoothId;
    const boothGroup = BoothMeshFactory.createBoothMesh(booth, this.offsetX, this.offsetZ, isSelected);
    boothGroup.userData = { boothId: booth.id, floorIndex: this.floorIndex };
    boothGroup.visible = this._isBoothVisible(booth);
    this.group.add(boothGroup);
    this.boothGroups.set(booth.id, boothGroup);

    const boothMeshes = [];
    boothGroup.children.forEach(child => {
      if (child.isMesh && child.userData.boothId) {
        boothMeshes.push(child);
        this.boothMeshes.push(child);
      }
    });
    this.boothMeshMap.set(booth.id, boothMeshes);
    this.updateBoothStyles();
  }

  removeBoothById(boothId) {
    this._removeBoothGroup(boothId);
    this.updateBoothStyles();
  }

  _buildFloorTag(ox) {
    const floorLabel = this._createFloorLabel();
    if (!floorLabel) return;
    floorLabel.position.set(-ox - 2.05, 1.02, 0.5);
    this.group.add(floorLabel);
    this.floorLabelSprite = floorLabel;

    const points = [
      new THREE.Vector3(-ox - 0.36, 0.08, 0.5),
      new THREE.Vector3(-ox - 1.58, 0.78, 0.5)
    ];
    const connectorGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const connector = new THREE.Line(
      connectorGeometry,
      new THREE.LineBasicMaterial({ color: 0x1f2536 })
    );
    this.group.add(connector);
    this.floorLabelConnector = connector;
  }

  _setRecommendedOutline(mesh, visible) {
    if (!mesh || !mesh.isMesh) return;
    let outline = mesh.userData?.recommendedOutline || null;
    if (!outline && visible) {
      const edgesGeo = new THREE.EdgesGeometry(mesh.geometry);
      const edgesMat = new THREE.LineBasicMaterial({
        color: TENANT_RECOMMENDED_OUTLINE_COLOR,
        transparent: true,
        opacity: 0.95
      });
      outline = new THREE.LineSegments(edgesGeo, edgesMat);
      outline.renderOrder = 2;
      outline.scale.set(1.01, 1.01, 1.01);
      mesh.add(outline);
      mesh.userData.recommendedOutline = outline;
    }
    if (outline) {
      outline.visible = !!visible;
    }
  }

  setFloorAnnotationsVisible(visible) {
    const show = !!visible;
    if (this.floorLabelSprite) this.floorLabelSprite.visible = show;
    if (this.floorLabelConnector) this.floorLabelConnector.visible = show;
  }

  _updateFloorTagStyle() {
    if (!this.floorLabelConnector) return;
    const isActiveFloor = this.floorIndex === this.store.activeFloorIndex;
    const oldMaterial = this.floorLabelConnector.material;
    const points = this.floorLabelConnector.geometry.attributes.position;
    const activeColor = 0x1f2536;
    const inactiveColor = 0x8a8f9a;
    let nextMaterial;
    if (isActiveFloor) {
      nextMaterial = new THREE.LineBasicMaterial({ color: activeColor });
    } else {
      nextMaterial = new THREE.LineDashedMaterial({
        color: inactiveColor,
        dashSize: 0.18,
        gapSize: 0.12
      });
    }
    this.floorLabelConnector.material = nextMaterial;
    if (typeof this.floorLabelConnector.computeLineDistances === 'function') {
      this.floorLabelConnector.computeLineDistances();
    }
    oldMaterial?.dispose();
    if (points) points.needsUpdate = true;
  }

  _createFloorLabel() {
    const canvas = document.createElement('canvas');
    canvas.width = 192;
    canvas.height = 72;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const text = this.floor.label || `L${this.floorIndex + 1}`;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(17,19,31,0.85)';
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2;
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(3, 3, canvas.width - 6, canvas.height - 6, 14);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(3, 3, canvas.width - 6, canvas.height - 6);
      ctx.strokeRect(3, 3, canvas.width - 6, canvas.height - 6);
    }

    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 1);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(2.3, 0.86, 1);
    return sprite;
  }

  _cellKey(x, z) {
    return `${x},${z}`;
  }

  _isPublicCellType(type) {
    return type === CellType.CORRIDOR ||
      type === CellType.RESTRICTED ||
      type === CellType.ENTRANCE ||
      type === CellType.ELEVATOR ||
      type === CellType.ESCALATOR ||
      type === CellType.LED_SCREEN;
  }

  _removePublicCellMesh(key) {
    const oldMesh = this.publicCellMeshes.get(key);
    if (!oldMesh) return;
    this.group.remove(oldMesh);
    const selectableIdx = this.selectableCellMeshes.indexOf(oldMesh);
    if (selectableIdx >= 0) this.selectableCellMeshes.splice(selectableIdx, 1);
    this._disposeMeshResources(oldMesh, new Set(), new Set());
    this.publicCellMeshes.delete(key);
  }

  _removeBoothGroup(boothId) {
    const group = this.boothGroups.get(boothId);
    if (group) {
      const disposedGeometries = new Set();
      const disposedMaterials = new Set();
      const disposedTextures = new Set();
      this.group.remove(group);
      group.traverse(child => {
        if (child.isMesh || child.isLine) {
          this._disposeMeshResources(child, disposedGeometries, disposedMaterials);
        }
        if (child.isSprite) {
          const spriteMat = child.material;
          const tex = spriteMat?.map;
          if (tex && !disposedTextures.has(tex)) {
            tex.dispose?.();
            disposedTextures.add(tex);
          }
          if (spriteMat && !disposedMaterials.has(spriteMat)) {
            spriteMat.dispose?.();
            disposedMaterials.add(spriteMat);
          }
        }
      });
      this.boothGroups.delete(boothId);
    }
    const removedMeshes = this.boothMeshMap.get(boothId) || [];
    if (removedMeshes.length) {
      const removedSet = new Set(removedMeshes);
      this.boothMeshes = this.boothMeshes.filter(mesh => !removedSet.has(mesh));
    }
    this.boothMeshMap.delete(boothId);
  }

  _syncPublicCellMesh(x, z) {
    const key = this._cellKey(x, z);
    const type = this.floor.grid[x][z];
    const isPublicType = this._isPublicCellType(type);
    const visible = this._isPublicCellVisible(type);
    const existing = this.publicCellMeshes.get(key);

    if (!isPublicType) {
      this._removePublicCellMesh(key);
      return;
    }

    if (existing && existing.userData?.cellType === type) {
      existing.visible = visible;
      if (type === CellType.LED_SCREEN) {
        const isSelectedLed =
          this.floorIndex === this.store.activeFloorIndex &&
          this.store.selectedCell &&
          this.store.selectedCell.type === CellType.LED_SCREEN &&
          this.store.selectedCell.x === x &&
          this.store.selectedCell.z === z;
        existing.material.color.setHex(isSelectedLed ? SELECTED_COLOR : LED_COLOR);
      }
      return;
    }

    this._removePublicCellMesh(key);
    const mesh = BoothMeshFactory.createCellMesh(type, x, z, this.offsetX, this.offsetZ);
    if (!mesh) return;
    mesh.userData = { cellType: type, x, z, floorIndex: this.floorIndex };
    mesh.visible = visible;
    if (type === CellType.LED_SCREEN) {
      this.selectableCellMeshes.push(mesh);
      const isSelectedLed =
        this.floorIndex === this.store.activeFloorIndex &&
        this.store.selectedCell &&
        this.store.selectedCell.type === CellType.LED_SCREEN &&
        this.store.selectedCell.x === x &&
        this.store.selectedCell.z === z;
      mesh.material.color.setHex(isSelectedLed ? SELECTED_COLOR : LED_COLOR);
    }
    this.group.add(mesh);
    this.publicCellMeshes.set(key, mesh);
  }

  _disposeMeshResources(mesh, disposedGeometries, disposedMaterials) {
    const sharedGeometry = !!mesh?.userData?.sharedGeometry;
    const sharedMaterial = !!mesh?.userData?.sharedMaterial;
    const geometry = mesh?.geometry;
    if (geometry && !sharedGeometry && !disposedGeometries.has(geometry)) {
      geometry.dispose?.();
      disposedGeometries.add(geometry);
    }
    const materials = Array.isArray(mesh?.material) ? mesh.material : [mesh?.material];
    materials.forEach(material => {
      if (!material || sharedMaterial || disposedMaterials.has(material)) return;
      material.dispose?.();
      disposedMaterials.add(material);
    });
  }

  dispose() {
    const disposedGeometries = new Set();
    const disposedMaterials = new Set();
    const disposedTextures = new Set();
    this.group.traverse(child => {
      if (child.isMesh) {
        this._disposeMeshResources(child, disposedGeometries, disposedMaterials);
      }
      if (child.isLine) {
        this._disposeMeshResources(child, disposedGeometries, disposedMaterials);
      }
      if (child.isSprite) {
        const spriteMat = child.material;
        const tex = spriteMat?.map;
        if (tex && !disposedTextures.has(tex)) {
          tex.dispose?.();
          disposedTextures.add(tex);
        }
        if (spriteMat && !disposedMaterials.has(spriteMat)) {
          spriteMat.dispose?.();
          disposedMaterials.add(spriteMat);
        }
      }
    });
    this.boothMeshes = [];
    this.boothMeshMap.clear();
    this.boothGroups.clear();
    this.selectableCellMeshes = [];
    this.publicCellMeshes.clear();
  }
}
