// PrintMakkelijk 3D viewer: build plate, models and G-code preview (Z is up).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const BED = { w: 220, d: 220, h: 270 };
const COLORS = {
  model: 0x3b82f6, selected: 0xf59e0b, outside: 0xef4444,
};
// Feature colours for the G-code preview (r, g, b 0–255).
export const TYPE_COLORS = {
  'WALL-OUTER': [239, 68, 68],
  'WALL-INNER': [34, 197, 94],
  SKIN: [250, 204, 21],
  FILL: [249, 115, 22],
  SUPPORT: [56, 189, 248],
  'SUPPORT-INTERFACE': [14, 165, 233],
  SKIRT: [167, 139, 250],
  'PRIME-TOWER': [148, 163, 184],
  OTHER: [203, 213, 225],
};
export const TYPE_LABELS = {
  'WALL-OUTER': 'Buitenwand', 'WALL-INNER': 'Binnenwand', SKIN: 'Boven/onder', FILL: 'Vulling',
  SUPPORT: 'Support', 'SUPPORT-INTERFACE': 'Support-dak', SKIRT: 'Skirt/brim',
};

export function createViewer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f172a);
  const camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
  camera.up.set(0, 0, 1);
  camera.position.set(BED.w / 2, -235, 290);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(BED.w / 2, BED.d / 2, 20);
  controls.update();

  scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(150, -100, 300);
  scene.add(sun);

  // ---- bed -------------------------------------------------------------
  const bed = new THREE.Group();
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(BED.w, BED.d),
    new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9 }),
  );
  plate.position.set(BED.w / 2, BED.d / 2, -0.05);
  bed.add(plate);
  const gridPts = [];
  for (let i = 0; i <= BED.w; i += 10) gridPts.push(i, 0, 0, i, BED.d, 0);
  for (let j = 0; j <= BED.d; j += 10) gridPts.push(0, j, 0, BED.w, j, 0);
  const grid = new THREE.BufferGeometry();
  grid.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
  bed.add(new THREE.LineSegments(grid, new THREE.LineBasicMaterial({ color: 0x334155 })));
  const box = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(BED.w, BED.d, BED.h)),
    new THREE.LineBasicMaterial({ color: 0x475569, transparent: true, opacity: 0.45 }),
  );
  box.position.set(BED.w / 2, BED.d / 2, BED.h / 2);
  bed.add(box);
  bed.add(makeLabel('Ender-3 S1 · 220 × 220', BED.w / 2, 8));
  // origin marker (front-left = 0,0)
  const axes = new THREE.AxesHelper(18);
  axes.position.set(0, 0, 0.1);
  bed.add(axes);
  scene.add(bed);

  function makeLabel(text, x, y) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(148,163,184,0.85)';
    g.font = 'bold 34px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 32);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(110, 13.75),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    m.position.set(x, y, 0.05);
    return m;
  }

  // ---- models ----------------------------------------------------------
  const models = new THREE.Group();
  scene.add(models);
  let selected = null;
  let mode = 'model';
  const listeners = new Set();
  const emit = (what) => listeners.forEach((fn) => fn(what));

  function makeMaterial() {
    return new THREE.MeshStandardMaterial({ color: COLORS.model, roughness: 0.55, metalness: 0.05, flatShading: false });
  }

  /** Add a geometry (any units, any position). It is centred and dropped on the bed. */
  function addModel(geometry, name) {
    const geo = geometry.index ? geometry.toNonIndexed() : geometry;
    for (const key of Object.keys(geo.attributes)) if (key !== 'position') geo.deleteAttribute(key);
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const c = new THREE.Vector3();
    bb.getCenter(c);
    geo.translate(-c.x, -c.y, -bb.min.z);
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, makeMaterial());
    mesh.userData = { name: name || 'model', scale: 1 };
    const size = new THREE.Vector3();
    geo.boundingBox.getSize(size);
    let note = null;
    const fit = Math.min((BED.w - 10) / size.x, (BED.d - 10) / size.y, (BED.h - 5) / size.z);
    if (fit < 1) {
      mesh.scale.setScalar(fit);
      mesh.userData.scale = fit;
      note = `“${mesh.userData.name}” was te groot en is verkleind naar ${Math.floor(fit * 100)}%.`;
    } else if (Math.max(size.x, size.y, size.z) < 3) {
      note = `“${mesh.userData.name}” is heel klein (${size.x.toFixed(2)} mm). Misschien is het in inch of meter gemaakt – gebruik de schaal-knop.`;
    }
    models.add(mesh);
    placeFree(mesh);
    select(mesh);
    setMode('model');
    emit('models');
    return { mesh, note };
  }

  function worldBox(obj) {
    obj.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(obj, true);
  }

  function dropToBed(mesh) {
    const b = worldBox(mesh);
    mesh.position.z -= b.min.z;
  }

  function placeFree(mesh) {
    dropToBed(mesh);
    const b = worldBox(mesh);
    const size = new THREE.Vector3(); b.getSize(size);
    const others = models.children.filter((m) => m !== mesh).map(worldBox);
    const step = 5;
    const cands = [];
    for (let y = size.y / 2 + 2; y <= BED.d - size.y / 2 - 2; y += step)
      for (let x = size.x / 2 + 2; x <= BED.w - size.x / 2 - 2; x += step) cands.push([x, y]);
    cands.sort((p, q) => Math.hypot(p[0] - 110, p[1] - 110) - Math.hypot(q[0] - 110, q[1] - 110));
    for (const [x, y] of cands) {
      const nb = new THREE.Box3(
        new THREE.Vector3(x - size.x / 2 - 3, y - size.y / 2 - 3, -1),
        new THREE.Vector3(x + size.x / 2 + 3, y + size.y / 2 + 3, 999));
      if (!others.some((o) => o.intersectsBox(nb))) { moveCenterTo(mesh, x, y); return; }
    }
    moveCenterTo(mesh, BED.w / 2, BED.d / 2);
  }

  function moveCenterTo(mesh, x, y) {
    const b = worldBox(mesh);
    const c = new THREE.Vector3(); b.getCenter(c);
    mesh.position.x += x - c.x;
    mesh.position.y += y - c.y;
    refreshColors();
  }

  function isOutside(mesh) {
    const b = worldBox(mesh);
    const e = 0.01;
    return b.min.x < -e || b.min.y < -e || b.max.x > BED.w + e || b.max.y > BED.d + e || b.max.z > BED.h + e;
  }

  function refreshColors() {
    for (const m of models.children) {
      m.material.color.setHex(isOutside(m) ? COLORS.outside : m === selected ? COLORS.selected : COLORS.model);
    }
    requestRender();
  }

  function select(mesh) {
    selected = mesh || null;
    refreshColors();
    emit('selection');
  }

  // ---- transforms on the selection --------------------------------------
  function rotateSelected(axis, degrees) {
    if (!selected) return;
    const q = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0), THREE.MathUtils.degToRad(degrees));
    const b = worldBox(selected); const c = new THREE.Vector3(); b.getCenter(c);
    selected.quaternion.premultiply(q);
    dropToBed(selected);
    moveCenterTo(selected, c.x, c.y);
    changed();
  }

  function scaleSelected(factor) {
    if (!selected) return;
    const b = worldBox(selected); const c = new THREE.Vector3(); b.getCenter(c);
    selected.userData.scale = factor;
    selected.scale.setScalar(factor);
    dropToBed(selected);
    moveCenterTo(selected, c.x, c.y);
    changed();
  }

  /** Rotate so the biggest flat area faces the bed. */
  function layFlatSelected() {
    if (!selected) return;
    selected.updateMatrixWorld(true);
    const pos = selected.geometry.attributes.position;
    const nm = new THREE.Matrix3().getNormalMatrix(selected.matrixWorld);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const n = new THREE.Vector3();
    const buckets = new Map();
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
      n.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b));
      const area = n.length() / 2;
      if (area < 1e-9) continue;
      n.normalize().applyMatrix3(nm).normalize();
      const key = `${Math.round(n.x * 50)},${Math.round(n.y * 50)},${Math.round(n.z * 50)}`;
      const e = buckets.get(key) || { area: 0, n: new THREE.Vector3() };
      e.area += area; e.n.addScaledVector(n, area);
      buckets.set(key, e);
    }
    let best = null;
    for (const e of buckets.values()) if (!best || e.area > best.area) best = e;
    if (!best) return;
    const down = new THREE.Vector3(0, 0, -1);
    const q = new THREE.Quaternion().setFromUnitVectors(best.n.normalize(), down);
    const bb = worldBox(selected); const ctr = new THREE.Vector3(); bb.getCenter(ctr);
    selected.quaternion.premultiply(q);
    dropToBed(selected);
    moveCenterTo(selected, ctr.x, ctr.y);
    changed();
  }

  function duplicateSelected() {
    if (!selected) return;
    const m = new THREE.Mesh(selected.geometry, makeMaterial());
    m.quaternion.copy(selected.quaternion);
    m.scale.copy(selected.scale);
    m.userData = { ...selected.userData };
    models.add(m);
    placeFree(m);
    select(m);
    changed();
  }

  function deleteSelected() {
    if (!selected) return;
    models.remove(selected);
    selected.material.dispose();
    if (!models.children.some((m) => m.geometry === selected.geometry)) selected.geometry.dispose();
    selected = null;
    select(models.children[models.children.length - 1]);
    changed();
  }

  function clearAll() {
    for (const m of [...models.children]) { models.remove(m); m.geometry.dispose(); m.material.dispose(); }
    selected = null;
    clearGcode();
    changed();
  }

  function arrange() {
    const list = [...models.children];
    list.forEach((m) => m.position.set(9999, 9999, m.position.z));
    for (const m of list) placeFree(m);
    changed();
  }

  function changed() { refreshColors(); emit('models'); }

  // ---- picking & dragging ---------------------------------------------
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  let drag = null;

  function pick(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
  }

  renderer.domElement.addEventListener('pointerdown', (ev) => {
    if (mode !== 'model' || ev.button !== 0) return;
    pick(ev);
    const hit = ray.intersectObjects(models.children, false)[0];
    if (hit) {
      select(hit.object);
      const p = new THREE.Vector3();
      ray.ray.intersectPlane(dragPlane, p);
      drag = { mesh: hit.object, last: p, moved: false };
      controls.enabled = false;
      renderer.domElement.setPointerCapture(ev.pointerId);
    } else {
      drag = { mesh: null, x: ev.clientX, y: ev.clientY };
    }
  });
  renderer.domElement.addEventListener('pointermove', (ev) => {
    if (!drag || !drag.mesh) return;
    pick(ev);
    const p = new THREE.Vector3();
    if (!ray.ray.intersectPlane(dragPlane, p)) return;
    drag.mesh.position.x += p.x - drag.last.x;
    drag.mesh.position.y += p.y - drag.last.y;
    drag.last = p;
    drag.moved = true;
    refreshColors();
  });
  renderer.domElement.addEventListener('pointerup', (ev) => {
    if (drag && drag.mesh) {
      controls.enabled = true;
      if (drag.moved) emit('models');
    } else if (drag && Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < 4) {
      select(null); // clicked empty space
    }
    drag = null;
  });

  // ---- export ---------------------------------------------------------
  /** Binary STL of the whole plate in CuraEngine coordinates (0,0 = bed centre). */
  function exportSTL() {
    let tris = 0;
    for (const m of models.children) tris += m.geometry.attributes.position.count / 3;
    const buf = new ArrayBuffer(84 + tris * 50);
    const dv = new DataView(buf);
    dv.setUint32(80, tris, true);
    let o = 84;
    const v = new THREE.Vector3();
    for (const m of models.children) {
      m.updateMatrixWorld(true);
      const pos = m.geometry.attributes.position;
      // Mirrored scaling would flip triangle winding; keep normals outward.
      const flip = m.matrixWorld.determinant() < 0;
      for (let i = 0; i < pos.count; i += 3) {
        o += 12; // normal (0,0,0): the engine recomputes it
        for (let k = 0; k < 3; k++) {
          const idx = flip ? i + (2 - k) : i + k;
          v.fromBufferAttribute(pos, idx).applyMatrix4(m.matrixWorld);
          dv.setFloat32(o, v.x - BED.w / 2, true);
          dv.setFloat32(o + 4, v.y - BED.d / 2, true);
          dv.setFloat32(o + 8, v.z, true);
          o += 12;
        }
        o += 2;
      }
    }
    return buf;
  }

  function info() {
    return models.children.map((m) => {
      const b = worldBox(m); const s = new THREE.Vector3(); b.getSize(s);
      return { name: m.userData.name, size: s, outside: isOutside(m), selected: m === selected, scale: m.userData.scale };
    });
  }

  // ---- G-code preview -------------------------------------------------
  let gcodeObj = null;
  let layerIndex = [];
  let showOnlyLayer = false;

  /** Parse G-code into coloured line segments, ordered by layer. */
  function parseGcode(text) {
    let x = 0, y = 0, z = 0, e = 0, type = 'OTHER', layer = -1, relE = false;
    let pos = new Float32Array(1 << 20), col = new Uint8Array(1 << 20), n = 0;
    const starts = [], zs = [];
    const counts = {};
    const grow = () => {
      const p2 = new Float32Array(pos.length * 2); p2.set(pos); pos = p2;
      const c2 = new Uint8Array(col.length * 2); c2.set(col); col = c2;
    };
    let i = 0;
    const len = text.length;
    while (i < len) {
      let j = text.indexOf('\n', i);
      if (j < 0) j = len;
      const c0 = text.charCodeAt(i);
      if (c0 === 59) { // ';'
        if (text.startsWith(';LAYER:', i)) { layer = +text.slice(i + 7, j); starts.push(n / 6); zs.push(null); }
        else if (text.startsWith(';TYPE:', i)) type = text.slice(i + 6, j).trim();
      } else if (c0 === 71 && (text.charCodeAt(i + 1) === 48 || text.charCodeAt(i + 1) === 49) && text.charCodeAt(i + 2) === 32) {
        let nx = x, ny = y, nz = z, ne = e, hasE = false;
        const semi = text.indexOf(';', i);
        const end = semi >= 0 && semi < j ? semi : j;
        let k = i + 3;
        while (k < end) {
          const ch = text.charCodeAt(k);
          if (ch === 88 || ch === 89 || ch === 90 || ch === 69) {
            let m = k + 1;
            while (m < end && text.charCodeAt(m) !== 32) m++;
            const val = +text.slice(k + 1, m);
            if (ch === 88) nx = val; else if (ch === 89) ny = val; else if (ch === 90) nz = val;
            else { ne = relE ? e + val : val; hasE = true; }
            k = m;
          } else k++;
        }
        if (layer >= 0 && hasE && ne > e + 1e-5 && (nx !== x || ny !== y)) {
          if (n + 6 > pos.length) grow();
          pos[n] = x; pos[n + 1] = y; pos[n + 2] = z; pos[n + 3] = nx; pos[n + 4] = ny; pos[n + 5] = nz;
          const cc = TYPE_COLORS[type] || TYPE_COLORS.OTHER;
          col[n] = cc[0]; col[n + 1] = cc[1]; col[n + 2] = cc[2]; col[n + 3] = cc[0]; col[n + 4] = cc[1]; col[n + 5] = cc[2];
          counts[type] = (counts[type] || 0) + 1;
          if (zs[zs.length - 1] === null) zs[zs.length - 1] = nz;
          n += 6;
        }
        x = nx; y = ny; z = nz; if (hasE) e = ne;
      } else if (text.startsWith('G92', i)) {
        const m = /E(-?[\d.]+)/.exec(text.slice(i, j)); if (m) e = +m[1];
      } else if (text.startsWith('M83', i)) relE = true;
      else if (text.startsWith('M82', i)) relE = false;
      i = j + 1;
    }
    starts.push(n / 6);
    return { positions: pos.subarray(0, n), colors: col.subarray(0, n), layerStarts: starts, layerZ: zs, counts };
  }

  function showGcode(text) {
    clearGcode();
    const p = parseGcode(text);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(p.colors, 3, true));
    gcodeObj = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true }));
    gcodeObj.frustumCulled = false;
    scene.add(gcodeObj);
    layerIndex = p.layerStarts;
    setMode('gcode');
    setLayer(layerIndex.length - 2);
    return { layers: layerIndex.length - 1, layerZ: p.layerZ, counts: p.counts };
  }

  function setLayer(n, only = showOnlyLayer) {
    if (!gcodeObj) return;
    showOnlyLayer = only;
    const last = Math.max(0, Math.min(n, layerIndex.length - 2));
    const start = only ? layerIndex[last] : 0;
    const end = layerIndex[last + 1];
    gcodeObj.geometry.setDrawRange(start * 2, (end - start) * 2);
    requestRender();
  }

  function clearGcode() {
    if (gcodeObj) { scene.remove(gcodeObj); gcodeObj.geometry.dispose(); gcodeObj.material.dispose(); gcodeObj = null; }
    layerIndex = [];
    if (mode === 'gcode') setMode('model');
  }

  function setMode(m) {
    mode = m === 'gcode' && gcodeObj ? 'gcode' : 'model';
    models.visible = mode === 'model';
    if (gcodeObj) gcodeObj.visible = mode === 'gcode';
    requestRender();
    emit('mode');
  }

  // ---- render loop (on demand) ----------------------------------------
  let pending = false;
  function requestRender() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; renderer.render(scene, camera); });
  }
  controls.addEventListener('change', requestRender);
  const resize = () => {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    requestRender();
  };
  new ResizeObserver(resize).observe(container);
  resize();

  function resetView() {
    camera.position.set(BED.w / 2, -235, 290);
    controls.target.set(BED.w / 2, BED.d / 2, 20);
    controls.update();
    requestRender();
  }

  function snapshot() {
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  }

  return {
    BED,
    addModel, select, rotateSelected, scaleSelected, layFlatSelected, duplicateSelected, deleteSelected,
    clearAll, arrange, exportSTL, info, showGcode, setLayer, clearGcode, setMode, resetView, snapshot,
    get mode() { return mode; },
    get selected() { return selected; },
    get count() { return models.children.length; },
    get hasGcode() { return !!gcodeObj; },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
