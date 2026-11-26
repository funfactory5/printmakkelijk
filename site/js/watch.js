// Watch a local folder (e.g. Downloads) for new model files – File System Access API.
import { isModelName } from './loaders.js';

export const canWatch = () => typeof window.showDirectoryPicker === 'function';

const DB = 'printmakkelijk';
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    };
  });
}
const saveHandle = (h) => idb('readwrite', (s) => s.put(h, 'watchDir')).catch(() => {});
export const loadSavedHandle = () => idb('readonly', (s) => s.get('watchDir')).catch(() => null);

/**
 * Creates a folder watcher. Call start() from a click handler.
 * onFile(file: File) is called for every new, completely downloaded model file.
 */
export function createWatcher({ onFile, onState }) {
  let dir = null, timer = null, known = new Map(), pendingSizes = new Map(), startedAt = 0;

  async function scan(initial) {
    const seen = new Set();
    for await (const entry of dir.values()) {
      if (entry.kind !== 'file' || !isModelName(entry.name)) continue;
      seen.add(entry.name);
      let file;
      try { file = await entry.getFile(); } catch (e) { continue; }
      const sig = `${file.size}:${file.lastModified}`;
      if (initial) { known.set(entry.name, sig); continue; }
      if (known.get(entry.name) === sig) continue;
      // Wait until the size is stable for one extra tick (download finished).
      if (pendingSizes.get(entry.name) !== sig) { pendingSizes.set(entry.name, sig); continue; }
      pendingSizes.delete(entry.name);
      known.set(entry.name, sig);
      if (file.lastModified >= startedAt - 2000 && file.size > 0) onFile(file);
    }
    for (const k of [...known.keys()]) if (!seen.has(k)) known.delete(k);
  }

  async function begin(handle) {
    dir = handle;
    known = new Map(); pendingSizes = new Map();
    startedAt = Date.now();
    await scan(true);
    clearInterval(timer);
    timer = setInterval(() => scan(false).catch((e) => { console.warn(e); stop(); }), 1500);
    onState({ watching: true, name: dir.name });
  }

  async function start() {
    const handle = await window.showDirectoryPicker({ id: 'pm-downloads', mode: 'read', startIn: 'downloads' });
    await saveHandle(handle);
    await begin(handle);
  }

  async function resume(handle) {
    const perm = await handle.requestPermission({ mode: 'read' });
    if (perm !== 'granted') throw new Error('Geen toestemming voor de map.');
    await begin(handle);
  }

  function stop() {
    clearInterval(timer);
    timer = null;
    onState({ watching: false, name: dir && dir.name });
  }

  return { start, resume, stop, get watching() { return !!timer; } };
}
