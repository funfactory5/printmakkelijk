// Turn downloaded files (STL / OBJ / 3MF / ZIP) into three.js geometries.
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as fflate from 'three/addons/libs/fflate.module.js';

export const MODEL_EXTENSIONS = ['stl', 'obj', '3mf'];
export const ACCEPT = '.stl,.obj,.3mf,.zip';

export const extOf = (name) => (String(name).toLowerCase().match(/\.([a-z0-9]+)(?:$|\?)/) || [])[1] || '';
export const isModelName = (name) => MODEL_EXTENSIONS.includes(extOf(name)) || extOf(name) === 'zip';
const baseName = (name) => String(name).split(/[\\/]/).pop().replace(/\.[^.]+$/, '');

/** Merge all meshes of an object tree into one position-only geometry (world space). */
function groupToGeometry(root) {
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
    g.morphAttributes = {};
    g.applyMatrix4(o.matrixWorld);
    parts.push(g);
  });
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
}

/** STL detection is by content too: some sites serve STLs without extension. */
function looksLikeSTL(buf) {
  if (buf.byteLength < 84) return false;
  const n = new DataView(buf).getUint32(80, true);
  if (84 + n * 50 === buf.byteLength) return true;
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(256, buf.byteLength)));
  return /^\s*solid\b/.test(head) && /facet/.test(new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(4096, buf.byteLength))));
}

/**
 * @param {ArrayBuffer} buffer
 * @param {string} name file name (extension decides the parser)
 * @returns {Promise<Array<{name:string, geometry:THREE.BufferGeometry}>>}
 */
export async function parseModel(buffer, name) {
  let ext = extOf(name);
  const u8 = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
  const isZip = u8[0] === 0x50 && u8[1] === 0x4b;
  if (isZip && ext !== '3mf') ext = 'zip';
  if (!MODEL_EXTENSIONS.includes(ext) && ext !== 'zip' && looksLikeSTL(buffer)) ext = 'stl';

  if (ext === 'stl') {
    const geometry = new STLLoader().parse(buffer);
    return [{ name: baseName(name), geometry }];
  }
  if (ext === 'obj') {
    const group = new OBJLoader().parse(new TextDecoder().decode(buffer));
    const geometry = groupToGeometry(group);
    if (!geometry) throw new Error('Geen 3D-vormen gevonden in dit OBJ-bestand.');
    // OBJ files are usually Y-up; printers are Z-up.
    geometry.rotateX(Math.PI / 2);
    return [{ name: baseName(name), geometry }];
  }
  if (ext === '3mf') {
    const group = new ThreeMFLoader().parse(buffer);
    // 3MF is Z-up in millimetres, like the printer; build-item transforms are applied.
    const geometry = groupToGeometry(group);
    if (!geometry) throw new Error('Geen 3D-vormen gevonden in dit 3MF-bestand.');
    return [{ name: baseName(name), geometry }];
  }
  if (ext === 'zip') {
    const files = fflate.unzipSync(new Uint8Array(buffer), {
      filter: (f) => !/(^|\/)__MACOSX\//.test(f.name) && MODEL_EXTENSIONS.includes(extOf(f.name)),
    });
    const out = [];
    for (const [fname, data] of Object.entries(files)) {
      const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      try { out.push(...await parseModel(ab, fname)); } catch (e) { console.warn('skip', fname, e); }
    }
    if (!out.length) throw new Error('Dit ZIP-bestand bevat geen STL-, OBJ- of 3MF-bestanden.');
    return out;
  }
  throw new Error(`Bestandstype “.${ext || '?'}” wordt niet ondersteund. Gebruik STL, OBJ, 3MF of ZIP.`);
}

export function triangleCount(geometry) {
  return geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
}

export { THREE };
