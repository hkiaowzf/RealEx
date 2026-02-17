const THREE = window.THREE;

const canvas = document.getElementById('scene');
const sizeLabel = document.getElementById('size-label');
const availableLabel = document.getElementById('available-label');
const reservedLabel = document.getElementById('reserved-label');
const selectedLabel = document.getElementById('selected-label');

const form = document.getElementById('zone-form');
const widthInput = document.getElementById('zone-width');
const depthInput = document.getElementById('zone-depth');

let scene;
let camera;
let renderer;
let controls;
let raycaster;
let pointer;
let boothGroup;
let boothData = [];

const BASE_COLOR = new THREE.Color('#f6b183');
const SELECTED_COLOR = new THREE.Color('#c65b2b');
const RESERVED_COLOR = new THREE.Color('#8e3b1b');

const initScene = () => {
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#fff6ea');

  const { width, height } = canvas.getBoundingClientRect();
  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 200);
  camera.position.set(12, 14, 14);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(width, height);

  controls = new THREE.OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 6;
  controls.maxDistance = 40;
  controls.target.set(0, 0, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.75);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
  dirLight.position.set(10, 20, 10);
  scene.add(ambient, dirLight);

  const floorGeo = new THREE.PlaneGeometry(200, 200);
  const floorMat = new THREE.MeshStandardMaterial({ color: '#efe3d6' });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  scene.add(floor);

  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();

  window.addEventListener('resize', handleResize);
  canvas.addEventListener('pointerdown', handlePick);

  animate();
};

const handleResize = () => {
  if (!renderer || !camera) return;
  const { width, height } = canvas.getBoundingClientRect();
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
};

const clearBooths = () => {
  if (!boothGroup) return;
  boothGroup.traverse((child) => {
    if (child.isMesh) {
      child.geometry.dispose();
      child.material.dispose();
    }
  });
  scene.remove(boothGroup);
  boothGroup = null;
  boothData = [];
};

const buildBooths = (width, depth) => {
  clearBooths();
  boothGroup = new THREE.Group();

  const gridGeo = new THREE.BoxGeometry(0.95, 0.6, 0.95);
  const baseMat = new THREE.MeshStandardMaterial({ color: BASE_COLOR });

  const offsetX = (width - 1) / 2;
  const offsetZ = (depth - 1) / 2;

  for (let x = 0; x < width; x += 1) {
    for (let z = 0; z < depth; z += 1) {
      const booth = new THREE.Mesh(gridGeo, baseMat.clone());
      booth.position.set(x - offsetX, 0.3, z - offsetZ);
      booth.userData = { selected: false, reserved: false };
      boothGroup.add(booth);
      boothData.push(booth);
    }
  }

  const outlineGeo = new THREE.BoxGeometry(width + 0.4, 0.1, depth + 0.4);
  const outlineMat = new THREE.MeshStandardMaterial({ color: '#f9d8b7' });
  const outline = new THREE.Mesh(outlineGeo, outlineMat);
  outline.position.set(0, 0.05, 0);
  boothGroup.add(outline);

  scene.add(boothGroup);

  sizeLabel.textContent = `${width}m × ${depth}m`;
  availableLabel.textContent = String(width * depth);
  reservedLabel.textContent = '0';
  selectedLabel.textContent = '0';
};

const updateStats = () => {
  const reserved = boothData.filter((booth) => booth.userData.reserved).length;
  const selected = boothData.filter((booth) => booth.userData.selected).length;
  reservedLabel.textContent = String(reserved);
  selectedLabel.textContent = String(selected);
};

const handlePick = (event) => {
  if (!raycaster) return;
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const intersects = raycaster.intersectObjects(boothData, false);
  if (!intersects.length) return;

  const booth = intersects[0].object;
  if (booth.userData.reserved) return;

  booth.userData.selected = !booth.userData.selected;
  booth.material.color.copy(booth.userData.selected ? SELECTED_COLOR : BASE_COLOR);
  updateStats();
};

const animate = () => {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
};

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const width = Math.max(1, Math.min(100, Number(widthInput.value) || 1));
  const depth = Math.max(1, Math.min(100, Number(depthInput.value) || 1));
  widthInput.value = String(width);
  depthInput.value = String(depth);
  buildBooths(width, depth);
});

initScene();
buildBooths(Number(widthInput.value), Number(depthInput.value));
