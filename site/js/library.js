// Built-in parametric models, generated in the browser (no download needed).
import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

let fontPromise = null;
const loadFont = () => (fontPromise ||= new FontLoader().loadAsync('vendor/three/fonts/helvetiker_bold.typeface.json'));

const extrude = (shape, depth, curveSegments = 32) =>
  new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments });

function roundedRect(w, h, r, x = 0, y = 0) {
  const s = new THREE.Shape();
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function circlePath(cx, cy, r, ccw = true) {
  const p = new THREE.Path();
  p.absarc(cx, cy, r, 0, Math.PI * 2, !ccw);
  return p;
}

function polygonShape(points) {
  const s = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return s;
}

export const LIBRARY = [
  {
    id: 'keychain', emoji: '🔑', name: 'Sleutelhanger met naam',
    desc: 'Typ een naam en print je eigen sleutelhanger.',
    params: [
      { key: 'text', label: 'Tekst', type: 'text', default: 'Quinten', maxLength: 14 },
      { key: 'size', label: 'Letterhoogte (mm)', type: 'number', min: 6, max: 20, default: 10 },
    ],
    async build({ text, size }) {
      const font = await loadFont();
      const t = (String(text || 'PrintMakkelijk').trim() || 'Hoi').slice(0, 14);
      const tg = new TextGeometry(t, { font, size: +size, depth: 2, curveSegments: 8, bevelEnabled: false });
      tg.computeBoundingBox();
      const tb = tg.boundingBox;
      const tw = tb.max.x - tb.min.x, th = tb.max.y - tb.min.y;
      const pad = 4, hole = 7;
      const w = tw + pad * 2 + hole + 4, h = th + pad * 2;
      const plate = roundedRect(w, h, Math.min(5, h / 2));
      plate.holes.push(circlePath(pad + hole / 2 - 1, h / 2, hole / 2 - 0.5, false));
      const base = extrude(plate, 3);
      tg.translate(pad + hole + 3 - tb.min.x, pad - tb.min.y, 2.95);
      return [{ name: `Sleutelhanger ${t}`, geometries: [base, tg] }];
    },
  },
  {
    id: 'phone', emoji: '📱', name: 'Telefoonhouder',
    desc: 'Stevige standaard voor je telefoon of tablet. Print zonder support.',
    params: [{ key: 'width', label: 'Breedte (mm)', type: 'number', min: 40, max: 160, default: 70 }],
    build({ width }) {
      const shape = polygonShape([[0, 0], [85, 0], [85, 6], [50, 84], [43, 84], [15, 6], [7, 6], [7, 18], [0, 18]]);
      const g = extrude(shape, +width);
      g.rotateX(Math.PI / 2);
      return [{ name: 'Telefoonhouder', geometries: [g] }];
    },
  },
  {
    id: 'vase', emoji: '🏺', name: 'Golvende vaas',
    desc: 'Mooi in vaasmodus (één wand, supersnel). Zet “Vaasmodus” aan bij instellingen.',
    params: [
      { key: 'height', label: 'Hoogte (mm)', type: 'number', min: 30, max: 250, default: 120 },
      { key: 'radius', label: 'Straal (mm)', type: 'number', min: 15, max: 100, default: 35 },
      { key: 'waves', label: 'Golven', type: 'number', min: 0, max: 8, default: 3 },
    ],
    build({ height, radius, waves }) {
      const pts = [new THREE.Vector2(0, 0)];
      const steps = 60;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const wave = +waves ? 0.08 * Math.sin(t * Math.PI * 2 * +waves) : 0;
        const r = radius * (0.8 + 0.25 * Math.sin(t * Math.PI) + wave);
        pts.push(new THREE.Vector2(Math.max(5, r), t * height));
      }
      pts.push(new THREE.Vector2(0, +height));
      const g = new THREE.LatheGeometry(pts, 120);
      g.rotateX(Math.PI / 2);
      return [{ name: 'Vaas', geometries: [g] }];
    },
  },
  {
    id: 'box', emoji: '📦', name: 'Doosje met deksel',
    desc: 'Opbergdoosje met passend deksel (2 onderdelen).',
    params: [
      { key: 'w', label: 'Breedte (mm)', type: 'number', min: 20, max: 200, default: 60 },
      { key: 'd', label: 'Diepte (mm)', type: 'number', min: 20, max: 200, default: 40 },
      { key: 'h', label: 'Hoogte (mm)', type: 'number', min: 10, max: 150, default: 30 },
    ],
    build({ w, d, h }) {
      w = +w; d = +d; h = +h;
      const wall = 2, r = 4, tol = 0.3;
      const floor = extrude(roundedRect(w, d, r), wall);
      const ring = roundedRect(w, d, r);
      ring.holes.push(roundedRect(w - wall * 2, d - wall * 2, r - 1, wall, wall));
      const walls = extrude(ring, h - wall + 0.05);
      walls.translate(0, 0, wall - 0.05);
      const lidTop = extrude(roundedRect(w, d, r), wall);
      const lip = roundedRect(w - wall * 2 - tol * 2, d - wall * 2 - tol * 2, r - 1, wall + tol, wall + tol);
      lip.holes.push(roundedRect(w - wall * 4 - tol * 2, d - wall * 4 - tol * 2, r - 1.5, wall * 2 + tol, wall * 2 + tol));
      const lipG = extrude(lip, 4.05);
      lipG.translate(0, 0, wall - 0.05);
      return [
        { name: 'Doosje', geometries: [floor, walls] },
        { name: 'Deksel', geometries: [lidTop, lipG] },
      ];
    },
  },
  {
    id: 'hook', emoji: '🪝', name: 'Haakje',
    desc: 'Haakje voor jassen, tassen of sleutels (plakken met dubbelzijdig tape).',
    params: [{ key: 'width', label: 'Breedte (mm)', type: 'number', min: 8, max: 60, default: 20 }],
    build({ width }) {
      // J-profile lying flat: prints strong and without support.
      const s = new THREE.Shape();
      s.moveTo(0, 60);
      s.lineTo(0, 10);
      s.absarc(15, 10, 15, Math.PI, Math.PI * 2, false);
      s.lineTo(30, 25);
      s.lineTo(25, 25);
      s.lineTo(25, 10);
      s.absarc(15, 10, 10, 0, Math.PI, true);
      s.lineTo(5, 60);
      s.closePath();
      const g = extrude(s, +width);
      return [{ name: 'Haakje', geometries: [g] }];
    },
  },
  {
    id: 'clip', emoji: '🧷', name: 'Kabelclip',
    desc: 'Klik kabels netjes bij elkaar.',
    params: [{ key: 'd', label: 'Kabeldikte (mm)', type: 'number', min: 3, max: 25, default: 8 }],
    build({ d }) {
      const r = +d / 2 + 0.3, R = r + 2.2, gap = 0.55;
      const s = new THREE.Shape();
      s.absarc(0, 0, R, -Math.PI / 2 + gap, Math.PI * 1.5 - gap, false);
      s.absarc(0, 0, r, Math.PI * 1.5 - gap, -Math.PI / 2 + gap, true);
      s.closePath();
      const tab = roundedRect(R * 2, 8, 2, -R, -R - 6);
      tab.holes.push(circlePath(0, -R - 2, 1.8, false));
      return [{ name: 'Kabelclip', geometries: [extrude(s, 8, 48), extrude(tab, 2.5)] }];
    },
  },
  {
    id: 'cube', emoji: '🧊', name: 'Kalibratiekubus',
    desc: 'Testkubus om je printer te controleren (meet na met een schuifmaat).',
    params: [{ key: 'size', label: 'Grootte (mm)', type: 'number', min: 5, max: 100, default: 20 }],
    build({ size }) {
      const g = new THREE.BoxGeometry(+size, +size, +size);
      return [{ name: `Kubus ${size} mm`, geometries: [g] }];
    },
  },
];

/** Build a library model → [{name, geometry}] (parts of one object are merged). */
export async function buildLibraryModel(id, values) {
  const item = LIBRARY.find((m) => m.id === id);
  if (!item) throw new Error('Onbekend model');
  const params = Object.fromEntries(item.params.map((p) => [p.key, values && values[p.key] != null ? values[p.key] : p.default]));
  const objects = await item.build(params);
  const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
  return objects.map((o) => {
    const parts = o.geometries.map((g) => {
      const n = g.index ? g.toNonIndexed() : g;
      for (const k of Object.keys(n.attributes)) if (k !== 'position') n.deleteAttribute(k);
      return n;
    });
    return { name: o.name, geometry: parts.length > 1 ? mergeGeometries(parts, false) : parts[0] };
  });
}
