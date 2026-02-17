import * as THREE from 'three';
import { CellType } from '../data/ExhibitionModel.js';
import { store } from '../data/Store.js';

const ELEVATOR_COLOR = 0x5c6bc0;
const ESCALATOR_COLOR = 0x7e57c2;
const ARROW_COLOR_ELEV = 0x9fa8da;
const ARROW_COLOR_ESC = 0xb39ddb;
const FLOOR_GAP = 5;

export class VerticalLinkRenderer {
  constructor() {
    this.group = new THREE.Group();
    this._meshes = [];
  }

  rebuild(floors) {
    this.dispose();
    this.group = new THREE.Group();
    this._meshes = [];

    if (floors.length < 2) return;

    const filter = store.viewFilter;
    const showElevator = filter === 'all' || filter === 'elevator';
    const showEscalator = filter === 'all' || filter === 'escalator';

    // Elevators: same-position matching (unchanged)
    if (showElevator) {
      const elevatorLinks = this._findElevatorLinks(floors);
      elevatorLinks.forEach(link => this._renderElevator(link, floors));
    }

    // Escalators: use explicit links from store
    if (showEscalator) {
      const escalatorLinks = store.escalatorLinks;
      escalatorLinks.forEach(link => this._renderEscalatorLink(link, floors));
    }
  }

  _findElevatorLinks(floors) {
    const map = {};
    floors.forEach((floor, fi) => {
      for (let x = 0; x < floor.width; x++) {
        for (let z = 0; z < floor.depth; z++) {
          if (floor.grid[x][z] === CellType.ELEVATOR) {
            const key = `${x},${z}`;
            if (!map[key]) map[key] = { x, z, floorIndices: [] };
            map[key].floorIndices.push(fi);
          }
        }
      }
    });
    return Object.values(map).filter(l => l.floorIndices.length >= 2);
  }

  _renderElevator(link, floors) {
    const sorted = [...link.floorIndices].sort((a, b) => a - b);
    const minF = sorted[0];
    const maxF = sorted[sorted.length - 1];
    const refFloor = floors[minF];
    const ox = (refFloor.width - 1) / 2;
    const oz = (refFloor.depth - 1) / 2;
    const wx = link.x - ox + 0.5;
    const wz = link.z - oz + 0.5;
    const yBottom = minF * FLOOR_GAP;
    const yTop = maxF * FLOOR_GAP + 0.6;
    const height = yTop - yBottom;

    // Elevator shaft — translucent box
    const shaftGeo = new THREE.BoxGeometry(0.7, height, 0.7);
    const shaftMat = new THREE.MeshStandardMaterial({
      color: ELEVATOR_COLOR, transparent: true, opacity: 0.35, depthWrite: false
    });
    const shaft = new THREE.Mesh(shaftGeo, shaftMat);
    shaft.position.set(wx, yBottom + height / 2, wz);
    this.group.add(shaft);
    this._meshes.push(shaft);

    // Shaft frame edges
    const edgeGeo = new THREE.EdgesGeometry(shaftGeo);
    const edgeMat = new THREE.LineBasicMaterial({ color: ELEVATOR_COLOR });
    const edges = new THREE.LineSegments(edgeGeo, edgeMat);
    edges.position.copy(shaft.position);
    this.group.add(edges);

    // Flow arrows
    this._addFlowArrows(wx, yBottom + 0.3, yTop - 0.1, wz, wx, wz, ARROW_COLOR_ELEV);
  }

  _renderEscalatorLink(link, floors) {
    if (Math.abs(link.floorA - link.floorB) !== 1) return;
    const floorA = floors[link.floorA];
    const floorB = floors[link.floorB];
    if (!floorA || !floorB) return;
    if (floorA.grid?.[link.xA]?.[link.zA] !== CellType.ESCALATOR) return;
    if (floorB.grid?.[link.xB]?.[link.zB] !== CellType.ESCALATOR) return;

    const oxA = (floorA.width - 1) / 2;
    const ozA = (floorA.depth - 1) / 2;
    const oxB = (floorB.width - 1) / 2;
    const ozB = (floorB.depth - 1) / 2;

    const wxA = link.xA - oxA + 0.5;
    const wzA = link.zA - ozA + 0.5;
    const wxB = link.xB - oxB + 0.5;
    const wzB = link.zB - ozB + 0.5;

    const yA = link.floorA * FLOOR_GAP + 0.1;
    const yB = link.floorB * FLOOR_GAP + 0.1;

    this._addEscalator(wxA, wzA, yA, wxB, wzB, yB);
  }

  _addEscalator(wxA, wzA, yA, wxB, wzB, yB) {
    const height = yB - yA;
    const dx = wxB - wxA;
    const dz = wzB - wzA;
    const horizDist = Math.sqrt(dx * dx + dz * dz);
    const totalLen = Math.sqrt(height * height + horizDist * horizDist);

    const midX = (wxA + wxB) / 2;
    const midY = (yA + yB) / 2;
    const midZ = (wzA + wzB) / 2;

    // Ramp
    const rampGeo = new THREE.BoxGeometry(0.5, 0.06, totalLen);
    const rampMat = new THREE.MeshStandardMaterial({
      color: ESCALATOR_COLOR, transparent: true, opacity: 0.6
    });
    const ramp = new THREE.Mesh(rampGeo, rampMat);
    ramp.position.set(midX, midY, midZ);

    // Rotate ramp to align with the direction from A to B
    const dir = new THREE.Vector3(dx, height, dz).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion();
    // Build rotation: ramp's local Z axis should align with direction
    const rampDir = new THREE.Vector3(0, 0, 1);
    quat.setFromUnitVectors(rampDir, dir);
    ramp.quaternion.copy(quat);

    this.group.add(ramp);
    this._meshes.push(ramp);

    // Side rails
    for (const side of [-0.28, 0.28]) {
      // Perpendicular direction in XZ plane
      let perpX, perpZ;
      if (horizDist > 0.001) {
        perpX = -dz / horizDist * side;
        perpZ = dx / horizDist * side;
      } else {
        perpX = side;
        perpZ = 0;
      }
      const pts = [
        new THREE.Vector3(wxA + perpX, yA, wzA + perpZ),
        new THREE.Vector3(wxB + perpX, yB, wzB + perpZ)
      ];
      const railGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const rail = new THREE.Line(railGeo, new THREE.LineBasicMaterial({
        color: ESCALATOR_COLOR, linewidth: 2
      }));
      this.group.add(rail);
    }

    // Flow arrows along the escalator
    this._addFlowArrows(wxA, yA + 0.2, yB - 0.1, wzA, wxB, wzB, ARROW_COLOR_ESC);
  }

  _addFlowArrows(wxStart, yBottom, yTop, wzStart, wxEnd, wzEnd, color) {
    // Line from start to end with interpolation
    const pts = [];
    const segments = 12;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const px = wxStart + (wxEnd - wxStart) * t;
      const py = yBottom + (yTop - yBottom) * t;
      const pz = wzStart + (wzEnd - wzStart) * t;
      pts.push(new THREE.Vector3(px, py, pz));
    }
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const lineMat = new THREE.LineDashedMaterial({ color, dashSize: 0.3, gapSize: 0.15 });
    const line = new THREE.Line(lineGeo, lineMat);
    line.computeLineDistances();
    this.group.add(line);

    // Arrow cones
    const coneGeo = new THREE.ConeGeometry(0.12, 0.3, 6);
    // Up arrow at top end
    const upMat = new THREE.MeshStandardMaterial({ color });
    const upCone = new THREE.Mesh(coneGeo, upMat);
    upCone.position.set(wxEnd, yTop, wzEnd);
    this.group.add(upCone);
    this._meshes.push(upCone);

    // Down arrow at bottom end
    const downCone = new THREE.Mesh(coneGeo, upMat.clone());
    downCone.position.set(wxStart, yBottom, wzStart);
    downCone.rotation.z = Math.PI;
    this.group.add(downCone);
    this._meshes.push(downCone);
  }

  dispose() {
    this.group.traverse(child => {
      if (child.isMesh || child.isLine) {
        child.geometry?.dispose();
        child.material?.dispose();
      }
    });
    this._meshes = [];
  }
}
