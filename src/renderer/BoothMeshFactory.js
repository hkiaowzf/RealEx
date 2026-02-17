import * as THREE from 'three';

const STATUS_COLORS = {
  idle: 0x4caf50,
  reserved: 0xff9800,
  sold: 0xf44336
};

const CELL_COLORS = {
  corridor: 0xb0bec5,
  restricted: 0x78909c,
  entrance: 0x26a69a,
  elevator: 0x5c6bc0,
  escalator: 0x7e57c2,
  ledScreen: 0x90a4ae
};

const SHARED_GEOMETRIES = new Map();
let SHARED_LED_MARKER_GEOMETRY = null;
let SHARED_LED_MARKER_MATERIAL = null;

export class BoothMeshFactory {
  static _getSharedGeometry(key, create) {
    if (!SHARED_GEOMETRIES.has(key)) SHARED_GEOMETRIES.set(key, create());
    return SHARED_GEOMETRIES.get(key);
  }

  static createBoothMesh(booth, offsetX, offsetZ, isSelected) {
    const group = new THREE.Group();
    const color = isSelected ? 0x2196f3 : (STATUS_COLORS[booth.status] || 0x4caf50);
    const boothCellGeo = BoothMeshFactory._getSharedGeometry('boothCell', () => new THREE.BoxGeometry(0.92, 0.6, 0.92));
    const boothMat = new THREE.MeshStandardMaterial({ color });

    booth.cells.forEach(c => {
      const mesh = new THREE.Mesh(boothCellGeo, boothMat);
      mesh.position.set(c.x - offsetX + 0.5, 0.3, c.z - offsetZ + 0.5);
      mesh.userData = { boothId: booth.id, sharedGeometry: true };
      group.add(mesh);
    });

    // Label sprite
    const label = BoothMeshFactory._createLabel(booth);
    if (label) {
      let cx = 0, cz = 0;
      booth.cells.forEach(c => { cx += c.x; cz += c.z; });
      cx = cx / booth.cells.length - offsetX + 0.5;
      cz = cz / booth.cells.length - offsetZ + 0.5;
      label.position.set(cx, 0.9, cz);
      group.add(label);
    }

    // Power icon
    if (booth.power.wattage > 0) {
      const icon = BoothMeshFactory._createPowerIcon(booth.power.voltage);
      let cx = booth.cells[0].x - offsetX + 0.5;
      let cz = booth.cells[0].z - offsetZ + 0.5;
      icon.position.set(cx + 0.3, 1.2, cz);
      group.add(icon);
    }

    return group;
  }

  static createCellMesh(type, x, z, offsetX, offsetZ) {
    const color = CELL_COLORS[type];
    if (!color) return null;
    let geo;
    let mat;
    let y = 0.04;
    if (type === 'ledScreen') {
      // LED screen panel: tall and slim (3m height, ~0.25m thickness).
      geo = BoothMeshFactory._getSharedGeometry('ledScreenCell', () => new THREE.BoxGeometry(0.92, 3.0, 0.25));
      mat = new THREE.MeshStandardMaterial({ color });
      y = 1.5;
      const screenMesh = new THREE.Mesh(geo, mat);
      screenMesh.position.set(x - offsetX + 0.5, y, z - offsetZ + 0.5);
      screenMesh.userData = { sharedGeometry: true };
      const marker = BoothMeshFactory._createLedFrontMarker();
      // Keep the marker slightly in front of the screen face to avoid z-fighting flicker.
      marker.position.set(0, 0, 0.135);
      screenMesh.add(marker);
      return screenMesh;
    } else {
      geo = BoothMeshFactory._getSharedGeometry('flatCell', () => new THREE.BoxGeometry(0.96, 0.08, 0.96));
      mat = new THREE.MeshStandardMaterial({ color });
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x - offsetX + 0.5, y, z - offsetZ + 0.5);
    mesh.userData = { sharedGeometry: true };
    return mesh;
  }

  static _createLedFrontMarker() {
    if (!SHARED_LED_MARKER_GEOMETRY) {
      SHARED_LED_MARKER_GEOMETRY = new THREE.PlaneGeometry(0.62, 0.34);
    }
    if (!SHARED_LED_MARKER_MATERIAL) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(12, 18, 232, 92, 16);
      ctx.fill();
    } else {
      ctx.fillRect(12, 18, 232, 92);
    }

    ctx.fillStyle = '#1f2933';
    // Pure icon marker: outlined circle + play triangle.
    ctx.beginPath();
    ctx.arc(128, 64, 30, 0, Math.PI * 2);
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#1f2933';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(118, 48);
    ctx.lineTo(118, 80);
    ctx.lineTo(143, 64);
    ctx.closePath();
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
      SHARED_LED_MARKER_MATERIAL = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.FrontSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
    }
    const plane = new THREE.Mesh(SHARED_LED_MARKER_GEOMETRY, SHARED_LED_MARKER_MATERIAL);
    plane.userData = { sharedGeometry: true, sharedMaterial: true };
    return plane;
  }

  static _createLabel(booth) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    const label = booth.brandName ? `${booth.id} ${booth.brandName}` : booth.id;
    ctx.fillText(label, canvas.width / 2, canvas.height / 2);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(2.4, 0.9, 1);
    return sprite;
  }

  static _createPowerIcon(voltage) {
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = voltage >= 380 ? '#ff9800' : '#fdd835';
    ctx.beginPath();
    ctx.arc(24, 24, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';
    ctx.fillText('⚡', 24, 24);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.4, 0.4, 1);
    return sprite;
  }
}
