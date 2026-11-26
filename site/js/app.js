// PrintMakkelijk – main app: find models → place on the bed → slice in the browser → G-code.
/* global PMProfile */
import { createViewer, TYPE_COLORS, TYPE_LABELS } from './viewer.js';
import { parseModel, triangleCount } from './loaders.js';
import { siteLinks, searchThingiverse, thingiverseFiles, fetchBinary, resolveLink } from './search.js';
import { LIBRARY, buildLibraryModel } from './library.js';
import { canWatch, createWatcher, loadSavedHandle } from './watch.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(kid));
  return n;
};

// ------------------------------------------------------------ storage
const store = {
  get(key, fallback) { try { const v = localStorage.getItem('pm.' + key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
  set(key, value) { try { localStorage.setItem('pm.' + key, JSON.stringify(value)); } catch (e) { /* private mode */ } },
  del(key) { try { localStorage.removeItem('pm.' + key); } catch (e) { /* ignore */ } },
};

// ------------------------------------------------------------ toasts
function toast(text, kind = '', ms = 4500) {
  const t = el('div', { class: `toast ${kind}` }, text);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), ms);
}

// ------------------------------------------------------------ viewer
const viewer = createViewer($('#viewport'));
window.pm = { viewer }; // handy for debugging in the console

// ------------------------------------------------------------ settings UI
const DENSITY = { PLA: 1.24, PETG: 1.27, ABS: 1.04, TPU: 1.21 };
const settings = Object.assign({}, PMProfile.DEFAULTS, { autoSlice: true }, store.get('settings', {}));

function buildSeg(container, entries, key) {
  container.innerHTML = '';
  for (const [value, label] of entries) {
    const b = el('button', { type: 'button', 'data-value': value, class: settings[key] === value ? 'active' : '' }, label);
    b.addEventListener('click', () => {
      settings[key] = value;
      for (const c of container.children) c.classList.toggle('active', c === b);
      settingsChanged();
    });
    container.append(b);
  }
}
buildSeg($('#materialSeg'), Object.entries(PMProfile.MATERIALS).map(([k, m]) => [k, m.label]), 'material');
buildSeg($('#qualitySeg'), Object.entries(PMProfile.QUALITIES).map(([k, q]) => [k, q.label.replace(/ \(.*/, '')]), 'quality');
$('#qualitySeg').querySelectorAll('button').forEach((b) => { b.title = PMProfile.QUALITIES[b.dataset.value].label; });

const inputs = {
  infill: $('#infill'), walls: $('#walls'), adhesion: $('#adhesion'), supports: $('#supports'),
  nozzleTemp: $('#nozzleTemp'), bedTemp: $('#bedTemp'), speed: $('#speed'), fan: $('#fan'),
  vase: $('#vase'), ironing: $('#ironing'), autoSlice: $('#autoSlice'),
};
for (const [key, input] of Object.entries(inputs)) {
  if (input.type === 'checkbox') input.checked = !!settings[key];
  else input.value = settings[key] == null ? '' : settings[key];
  input.addEventListener(input.type === 'range' ? 'input' : 'change', () => {
    if (input.type === 'checkbox') settings[key] = input.checked;
    else if (input.type === 'number') settings[key] = input.value === '' ? null : +input.value;
    else if (key === 'infill' || key === 'walls') settings[key] = +input.value;
    else settings[key] = input.value;
    if (key === 'infill') $('#infillVal').textContent = `${settings.infill}%`;
    if (key !== 'autoSlice') settingsChanged(input.type === 'range');
    else store.set('settings', settings);
  });
}
$('#infillVal').textContent = `${settings.infill}%`;

const proxyInput = $('#proxyInput');
proxyInput.value = store.get('proxy', '');
proxyInput.addEventListener('change', () => store.set('proxy', proxyInput.value.trim()));
const proxy = () => proxyInput.value.trim() || null;

function settingsChanged(fromSlider = false) {
  store.set('settings', settings);
  markStale(fromSlider ? 900 : 400);
}

// ------------------------------------------------------------ slicing
let worker = null, workerReady = false, slicing = false, queued = false, stale = true;
let lastGcode = null, lastName = 'model', autoTimer = null;

function startWorker() {
  worker = new Worker('js/slicer.worker.js');
  workerReady = false;
  setEngine('⚙️ Slicer laden…', '');
  worker.onmessage = onWorkerMessage;
  worker.onerror = (e) => {
    setEngine('❌ Slicer-fout', 'err');
    finishSlice();
    showSliceMsg('De slicer kon niet starten: ' + (e.message || 'onbekende fout'), true);
  };
  worker.postMessage({ type: 'warm' });
}

function setEngine(text, kind) {
  const c = $('#engineStatus');
  c.textContent = text;
  c.className = `chip ${kind}`;
}

function showSliceMsg(text, isErr = false) {
  const m = $('#sliceMsg');
  m.textContent = text;
  m.classList.toggle('err', isErr);
}

function updateSliceButton() {
  const b = $('#sliceBtn');
  const outside = viewer.info().some((i) => i.outside);
  b.disabled = !slicing && (!viewer.count || outside);
  b.textContent = slicing ? '⏹ Stop' : '✨ Slice!';
  b.classList.toggle('stale', !slicing && stale && viewer.count > 0 && !!lastGcode);
}

function markStale(delay = 400) {
  stale = true;
  if (lastGcode) showSliceMsg('Er is iets veranderd – slice opnieuw voor een nieuwe G-code.');
  updateSliceButton();
  clearTimeout(autoTimer);
  if (settings.autoSlice && viewer.count && !viewer.info().some((i) => i.outside)) {
    autoTimer = setTimeout(() => slice(), delay);
  }
}

function slice() {
  clearTimeout(autoTimer);
  if (!viewer.count) return;
  if (viewer.info().some((i) => i.outside)) { showSliceMsg('Een model past niet op het bed (rood).', true); return; }
  if (slicing) { queued = true; return; }
  slicing = true;
  queued = false;
  stale = false;
  updateSliceButton();
  $('#progress').hidden = false;
  $('#progressBar').style.width = '2%';
  showSliceMsg('Bezig met slicen… 🧠');
  const stl = viewer.exportSTL();
  const options = { ...settings };
  lastName = (viewer.info()[0] || {}).name || 'model';
  worker.postMessage({ type: 'slice', stl, options }, [stl]);
}

function finishSlice() {
  slicing = false;
  $('#progress').hidden = true;
  updateSliceButton();
  if (queued) { queued = false; slice(); }
}

function cancelSlice() {
  worker.terminate();
  queued = false;
  finishSlice();
  stale = true;
  showSliceMsg('Slicen gestopt.');
  startWorker();
}

const fmtTime = (s) => {
  if (!s) return '–';
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h} u ${m} m` : `${m} min`;
};

function onWorkerMessage(e) {
  const msg = e.data;
  if (msg.type === 'ready') {
    workerReady = true;
    setEngine('✅ Slicer klaar', 'ok');
    return;
  }
  if (msg.type === 'progress') {
    $('#progressBar').style.width = `${Math.max(2, msg.progress)}%`;
    return;
  }
  if (msg.type === 'error') {
    if (msg.log) console.warn('CuraEngine log:\n' + msg.log.join('\n'));
    showSliceMsg('❌ ' + msg.message, true);
    stale = true;
    finishSlice();
    return;
  }
  if (msg.type === 'done') {
    const text = new TextDecoder().decode(msg.gcode);
    lastGcode = new Blob([text], { type: 'text/x-gcode' });
    const preview = viewer.showGcode(text);
    const meta = msg.meta || {};
    const grams = meta.filamentMm3 ? (meta.filamentMm3 / 1000) * (DENSITY[msg.summary.material] || 1.24) : 0;
    $('#rTime').textContent = fmtTime(meta.printTime);
    $('#rFil').textContent = meta.meters ? `${meta.meters.toFixed(1)} m · ${Math.round(grams)} g` : '–';
    $('#rLayers').textContent = preview.layers;
    const safe = lastName.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'model';
    const q = PMProfile.QUALITIES[settings.quality] || PMProfile.QUALITIES.normal;
    $('#fileName').value = `${safe}_${msg.summary.material}_${String(q.layer).replace('.', '')}mm.gcode`;
    $('#result').hidden = false;
    setupLayerBar(preview);
    showSliceMsg(`Klaar in ${(meta.sliceMs / 1000).toFixed(1)} s ✅  ${msg.summary.material} · ${msg.summary.nozzleTemp}°C / bed ${msg.summary.bedTemp}°C`);
    updateViewButtons();
    finishSlice();
  }
}

$('#sliceBtn').addEventListener('click', () => (slicing ? cancelSlice() : slice()));
$('#downloadBtn').addEventListener('click', () => {
  if (!lastGcode) return;
  let name = $('#fileName').value.trim() || 'model.gcode';
  if (!/\.gcode$/i.test(name)) name += '.gcode';
  const a = el('a', { href: URL.createObjectURL(lastGcode), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  toast('⬇️ G-code gedownload. Zet hem op de SD-kaart!', 'ok');
});

// ------------------------------------------------------------ layer preview
function setupLayerBar(preview) {
  const s = $('#layerSlider');
  s.max = Math.max(0, preview.layers - 1);
  s.value = s.max;
  const label = () => {
    const z = preview.layerZ[+s.value];
    $('#layerLabel').textContent = `${+s.value + 1} / ${preview.layers}${z != null ? ` · ${z.toFixed(2)} mm` : ''}`;
  };
  s.oninput = () => { viewer.setLayer(+s.value, $('#onlyLayer').checked); label(); };
  $('#onlyLayer').onchange = s.oninput;
  label();
  const legend = $('#legend');
  legend.innerHTML = '';
  for (const [type, name] of Object.entries(TYPE_LABELS)) {
    if (!preview.counts[type]) continue;
    const [r, g, b] = TYPE_COLORS[type];
    legend.append(el('span', {}, el('i', { style: `background: rgb(${r},${g},${b})` }), name));
  }
}

function updateViewButtons() {
  $('#viewGcode').disabled = !viewer.hasGcode;
  $('#viewModel').classList.toggle('active', viewer.mode === 'model');
  $('#viewGcode').classList.toggle('active', viewer.mode === 'gcode');
  $('#layerBar').hidden = viewer.mode !== 'gcode';
  updateObjectBar();
}
$('#viewModel').addEventListener('click', () => viewer.setMode('model'));
$('#viewGcode').addEventListener('click', () => viewer.setMode('gcode'));
$('#resetViewBtn').addEventListener('click', () => viewer.resetView());
$('#clearBtn').addEventListener('click', () => { if (confirm('Alle modellen van het bed halen?')) viewer.clearAll(); });

// ------------------------------------------------------------ object toolbar
function updateObjectBar() {
  const list = viewer.info();
  $('#emptyHint').hidden = list.length > 0;
  $('#clearBtn').hidden = list.length === 0;
  const sel = list.find((i) => i.selected);
  const bar = $('#objectBar');
  bar.hidden = !sel || viewer.mode !== 'model';
  $('#outsideWarn').hidden = !list.some((i) => i.outside);
  if (sel) {
    $('#objName').textContent = sel.name;
    $('#objSize').textContent = `${sel.size.x.toFixed(1)} × ${sel.size.y.toFixed(1)} × ${sel.size.z.toFixed(1)} mm`;
    if (document.activeElement !== $('#scaleInput')) $('#scaleInput').value = Math.round(sel.scale * 100);
  }
  if (!list.length) bar.hidden = true;
  updateSliceButton();
}

let lastCount = 0;
viewer.on((what) => {
  if (what === 'models') {
    // On phones the 3D view is below the search panel: bring it into view.
    if (viewer.count > lastCount && window.innerWidth <= 760) $('.stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
    lastCount = viewer.count;
    if (!viewer.count) { lastGcode = null; $('#result').hidden = true; showSliceMsg(''); }
    else markStale();
  }
  if (what === 'mode') updateViewButtons();
  updateObjectBar();
});

$('#objectBar').addEventListener('click', (e) => {
  const act = e.target.closest('button')?.dataset.act;
  if (!act) return;
  ({
    rx: () => viewer.rotateSelected('x', 90),
    ry: () => viewer.rotateSelected('y', 90),
    rz: () => viewer.rotateSelected('z', 45),
    flat: () => viewer.layFlatSelected(),
    dup: () => viewer.duplicateSelected(),
    arrange: () => viewer.arrange(),
    del: () => viewer.deleteSelected(),
  })[act]();
});
$('#scaleInput').addEventListener('change', (e) => {
  const v = Math.max(1, Math.min(2000, +e.target.value || 100));
  viewer.scaleSelected(v / 100);
});
window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea')) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && viewer.selected) { e.preventDefault(); viewer.deleteSelected(); }
});

// ------------------------------------------------------------ loading models
async function loadBuffer(buffer, name, { source } = {}) {
  let parts;
  try {
    parts = await parseModel(buffer, name);
  } catch (e) {
    toast('❌ ' + e.message, 'err', 7000);
    return false;
  }
  let tris = 0;
  for (const p of parts) {
    tris += triangleCount(p.geometry);
    const { note } = viewer.addModel(p.geometry, p.name);
    if (note) toast('📏 ' + note, '', 7000);
  }
  if (tris > 1.5e6) toast('🐢 Dit model is heel gedetailleerd. Slicen kan even duren.', '', 7000);
  toast(`✅ ${parts.length > 1 ? parts.length + ' modellen' : '“' + parts[0].name + '”'} geladen${source ? ' van ' + source : ''}`, 'ok');
  return true;
}

async function loadFiles(fileList) {
  for (const f of fileList) await loadBuffer(await f.arrayBuffer(), f.name);
}

$('#fileInput').addEventListener('change', (e) => { loadFiles([...e.target.files]); e.target.value = ''; });

// drag & drop everywhere
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
  dragDepth++; $('#dropOverlay').hidden = false; $('#dropzone').classList.add('over');
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) { $('#dropOverlay').hidden = true; $('#dropzone').classList.remove('over'); }
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0; $('#dropOverlay').hidden = true; $('#dropzone').classList.remove('over');
  if (e.dataTransfer?.files?.length) loadFiles([...e.dataTransfer.files]);
});

// ------------------------------------------------------------ tabs
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((t) => { t.classList.toggle('active', t === tab); t.setAttribute('aria-selected', t === tab); });
  document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('active', p.id === `tab-${tab.dataset.tab}`));
  store.set('tab', tab.dataset.tab);
}));
const savedTab = store.get('tab', 'search');
document.querySelector(`.tab[data-tab="${savedTab}"]`)?.click();

// ------------------------------------------------------------ search
let tvToken = store.get('tvToken', '');
let lastQuery = '', page = 1;

function renderSiteLinks(q) {
  const box = $('#siteLinks');
  box.innerHTML = '';
  for (const s of siteLinks(q || '')) {
    box.append(el('a', { href: s.href, target: '_blank', rel: 'noopener' },
      `${s.icon} ${s.name}`, el('small', {}, '↗')));
  }
}
renderSiteLinks('');

function showTokenSetup(show) { $('#tvSetup').hidden = !show; }

$('#tokenForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#tokenInput').value.trim();
  if (!v) return;
  tvToken = v;
  store.set('tvToken', v);
  $('#tokenInput').value = '';
  showTokenSetup(false);
  toast('🔑 Token opgeslagen', 'ok');
  if (lastQuery) runSearch(lastQuery, 1);
});
$('#forgetToken').addEventListener('click', () => { tvToken = ''; store.del('tvToken'); toast('Token gewist'); });

$('#searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#searchInput').value.trim();
  if (q) runSearch(q, 1);
});
$('#moreBtn').addEventListener('click', () => runSearch(lastQuery, page + 1));

async function runSearch(q, p) {
  lastQuery = q; page = p;
  renderSiteLinks(q);
  if (p === 1) $('#results').innerHTML = '';
  $('#moreBtn').hidden = true;
  if (!tvToken) {
    showTokenSetup(true);
    $('#searchStatus').textContent = 'Klik op een site hieronder, of stel Thingiverse in om direct hier te zoeken.';
    return;
  }
  $('#searchStatus').textContent = 'Zoeken op Thingiverse… 🔎';
  try {
    const { items, total } = await searchThingiverse(q, tvToken, p);
    $('#searchStatus').textContent = total ? `${total.toLocaleString('nl-NL')} modellen op Thingiverse voor “${q}”` : `Niets gevonden voor “${q}”. Probeer Engelse woorden (bijv. “dragon”).`;
    for (const item of items) $('#results').append(resultCard(item));
    $('#moreBtn').hidden = items.length < 24;
  } catch (err) {
    $('#searchStatus').textContent = '❌ ' + err.message;
    if (/token/i.test(err.message)) showTokenSetup(true);
  }
}

function resultCard(item) {
  const card = el('article', { class: 'thing' },
    item.thumb
      ? el('img', { src: item.thumb, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => e.target.replaceWith(el('div', { class: 'thumb-ph' }, '🧩')) })
      : el('div', { class: 'thumb-ph' }, '🧩'),
    el('div', { class: 'meta' },
      el('div', { class: 'name', title: item.name }, item.name),
      el('div', { class: 'by' }, item.creator ? `door ${item.creator}` : '', item.likes ? ` · ❤️ ${item.likes}` : ''),
      el('div', { class: 'actions' },
        el('button', { class: 'primary', type: 'button', onclick: () => openThing(item, card) }, '✨ Slice'),
        el('a', { href: item.url, target: '_blank', rel: 'noopener' }, 'Bekijk ↗'))));
  return card;
}

async function openThing(item, card) {
  const old = document.querySelector('.files');
  if (old) old.remove();
  const box = el('div', { class: 'files' }, el('div', { class: 'small muted' }, 'Bestanden laden…'));
  card.after(box);
  try {
    const files = await thingiverseFiles(item.id, tvToken);
    box.innerHTML = '';
    if (!files.length) { box.append(el('div', { class: 'small' }, 'Geen STL/3MF/OBJ-bestanden gevonden bij dit model.')); return; }
    box.append(el('strong', { class: 'small' }, `📁 ${item.name}`));
    for (const f of files) {
      const btn = el('button', { class: 'primary', type: 'button' }, 'Laden');
      btn.addEventListener('click', () => downloadAndLoad(f.urls, f.name, btn, item.url, 'Thingiverse'));
      box.append(el('div', { class: 'file' }, el('span', { title: f.name }, `🧩 ${f.name}`), el('small', { class: 'muted' }, f.sizeText), btn));
    }
    if (files.length > 1) {
      const all = el('button', { class: 'ghost wide', type: 'button' }, `Alles laden (${files.length})`);
      all.addEventListener('click', async () => { for (const f of files) await downloadAndLoad(f.urls, f.name, all, item.url, 'Thingiverse'); });
      box.append(all);
    } else {
      downloadAndLoad(files[0].urls, files[0].name, box.querySelector('button'), item.url, 'Thingiverse');
    }
  } catch (err) {
    box.innerHTML = '';
    box.append(el('div', { class: 'small' }, '❌ ' + err.message));
  }
}

async function downloadAndLoad(urls, name, button, pageUrl, source) {
  const label = button ? button.textContent : '';
  if (button) { button.disabled = true; button.textContent = '⬇️ 0%'; }
  try {
    const { buffer } = await fetchBinary(urls, {
      proxy: proxy(),
      onProgress: (got, total) => { if (button) button.textContent = total ? `⬇️ ${Math.round((got / total) * 100)}%` : `⬇️ ${(got / 1e6).toFixed(1)} MB`; },
    });
    await loadBuffer(buffer, name, { source });
    if (button) button.textContent = '✅';
  } catch (err) {
    if (button) { button.textContent = label; button.disabled = false; }
    if (err.cors && pageUrl) {
      toast('🚧 Deze site laat de pagina niet direct downloaden. Ik open de modelpagina: download het bestand daar – met “Downloads-map volgen” laadt het automatisch.', 'err', 10000);
      window.open(pageUrl, '_blank', 'noopener');
    } else {
      toast('❌ ' + err.message, 'err', 8000);
    }
  }
}

// ------------------------------------------------------------ links
$('#urlForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = $('#urlInput').value.trim();
  if (!v) return;
  let info;
  try { info = resolveLink(v); } catch (err) { toast('❌ ' + err.message, 'err'); return; }
  const btn = e.submitter || $('#urlForm button');
  if (info.kind === 'thingiverse') {
    if (!tvToken) { document.querySelector('.tab[data-tab="search"]').click(); showTokenSetup(true); toast('🔑 Stel eerst je Thingiverse-token in.'); return; }
    try {
      const files = await thingiverseFiles(info.id, tvToken);
      if (!files.length) { toast('Geen modelbestanden gevonden bij die link.', 'err'); return; }
      for (const f of files) await downloadAndLoad(f.urls, f.name, btn, info.url, 'Thingiverse');
    } catch (err) { toast('❌ ' + err.message, 'err'); }
  } else if (info.kind === 'file') {
    await downloadAndLoad(info.urls, info.name, btn, v, new URL(info.urls[0]).hostname);
  } else {
    toast(`🌐 Dit is een webpagina van ${info.site}. Download daar het STL-bestand – met “Downloads-map volgen” verschijnt het hier automatisch.`, '', 9000);
    window.open(info.url, '_blank', 'noopener');
  }
});

// ------------------------------------------------------------ downloads watcher
const watcher = createWatcher({
  onFile: async (file) => {
    toast(`📥 Nieuw bestand: ${file.name}`, 'ok');
    await loadBuffer(await file.arrayBuffer(), file.name, { source: 'je Downloads' });
  },
  onState: ({ watching, name }) => {
    const s = $('#watchStatus');
    s.textContent = watching ? `🟢 Ik volg “${name}”. Download maar een model!` : name ? `⏸️ Gestopt met volgen van “${name}”.` : '';
    s.classList.toggle('on', watching);
    $('#watchBtn').textContent = watching ? '⏹ Stop met volgen' : '📂 Kies Downloads-map';
    $('#resumeWatchBtn').hidden = true;
  },
});
if (!canWatch()) {
  $('#watchBtn').disabled = true;
  $('#watchUnsupported').hidden = false;
} else {
  loadSavedHandle().then((h) => {
    if (!h) return;
    const b = $('#resumeWatchBtn');
    b.hidden = false;
    b.textContent = `↻ Volg “${h.name}” weer`;
    b.onclick = () => watcher.resume(h).catch((e) => toast('❌ ' + e.message, 'err'));
  });
}
$('#watchBtn').addEventListener('click', async () => {
  if (watcher.watching) { watcher.stop(); return; }
  try { await watcher.start(); } catch (e) { if (e.name !== 'AbortError') toast('❌ ' + e.message, 'err'); }
});

// ------------------------------------------------------------ library
function renderLibrary() {
  const box = $('#library');
  for (const item of LIBRARY) {
    const values = {};
    const params = el('div', { class: 'libparams' });
    for (const p of item.params) {
      values[p.key] = p.default;
      const input = el('input', {
        type: p.type, value: p.default, min: p.min, max: p.max, maxlength: p.maxLength,
        oninput: (e) => { values[p.key] = p.type === 'number' ? +e.target.value : e.target.value; },
      });
      params.append(el('label', {}, p.label, input));
    }
    const add = el('button', { class: 'primary', type: 'button' }, '➕ Op het bed');
    add.addEventListener('click', async () => {
      add.disabled = true;
      try {
        for (const part of await buildLibraryModel(item.id, values)) viewer.addModel(part.geometry, part.name);
        if (item.id === 'vase' && !settings.vase) toast('🏺 Tip: zet “Vaasmodus” aan onder Geavanceerd voor een supersnelle vaas.', '', 7000);
      } catch (e) { toast('❌ ' + e.message, 'err'); }
      add.disabled = false;
    });
    box.append(el('div', { class: 'libitem' },
      el('header', {}, el('span', { class: 'emoji' }, item.emoji), el('div', {}, el('strong', {}, item.name), el('p', {}, item.desc))),
      params, add));
  }
}
renderLibrary();

// ------------------------------------------------------------ help
$('#helpBtn').addEventListener('click', () => $('#helpDialog').showModal());
if (!store.get('seenHelp', false)) {
  store.set('seenHelp', true);
  setTimeout(() => $('#helpDialog').showModal(), 400);
}

// ------------------------------------------------------------ start
startWorker();
updateObjectBar();
updateViewButtons();
