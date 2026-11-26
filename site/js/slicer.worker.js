/* PrintMakkelijk slicer worker – runs CuraEngine (WebAssembly) off the main thread. */
/* global CuraEngine, PMProfile */
importScripts('../vendor/cura/CuraEngine.js', 'profile.js');

let definitions = null;

async function loadDefinitions() {
  if (definitions) return definitions;
  const [printer, extruder] = await Promise.all([
    fetch('../vendor/cura/fdmprinter.def.json').then((r) => r.text()),
    fetch('../vendor/cura/fdmextruder.def.json').then((r) => r.text()),
  ]);
  definitions = { printer, extruder };
  return definitions;
}

self.onmessage = async (event) => {
  const msg = event.data;
  if (msg.type === 'warm') {
    try {
      await loadDefinitions();
      self.postMessage({ type: 'ready' });
    } catch (e) {
      self.postMessage({ type: 'error', message: 'Slicer-bestanden konden niet laden: ' + e.message });
    }
    return;
  }
  if (msg.type !== 'slice') return;
  const log = [];
  try {
    const defs = await loadDefinitions();
    let lastProgress = -1;
    let meta = null;
    self['cura-wasm-progress-callback'] = (p) => {
      const pct = Math.round(p * 100);
      if (pct !== lastProgress) { lastProgress = pct; self.postMessage({ type: 'progress', progress: pct }); }
    };
    self['cura-wasm-metadata-callback'] = (flavor, printTime, m1, m2, nozzle, filament) => {
      meta = { flavor, printTime, filamentMm3: filament };
    };

    // A fresh engine per slice keeps CuraEngine's global state clean.
    const engine = await CuraEngine({
      noInitialRun: true,
      print: (s) => { log.push(s); },
      printErr: (s) => { log.push(s); },
    });
    engine.FS.mkdir('/defs');
    engine.FS.writeFile('/defs/fdmprinter.def.json', defs.printer);
    engine.FS.writeFile('/defs/fdmextruder.def.json', defs.extruder);
    engine.FS.writeFile('/model.stl', new Uint8Array(msg.stl));

    const { settings, summary } = PMProfile.buildSettings(msg.options);
    const args = PMProfile.toEngineArgs(settings, '/defs/fdmprinter.def.json', '/model.stl', '/out.gcode');
    const t0 = performance.now();
    try {
      engine.callMain(args);
    } catch (e) {
      // Emscripten throws ExitStatus on exit(); a real failure leaves no output file.
      log.push(String(e && e.message || e));
    }
    let raw;
    try { raw = engine.FS.readFile('/out.gcode', { encoding: 'utf8' }); } catch (e) { raw = ''; }
    if (!raw || raw.indexOf(';LAYER:0') < 0) {
      throw new Error('De slicer heeft geen printbare lagen gemaakt. Is het model groot genoeg en ligt het op het bed?');
    }
    const result = PMProfile.postProcess(raw, meta);
    const bytes = new TextEncoder().encode(result.gcode);
    self.postMessage({
      type: 'done',
      gcode: bytes.buffer,
      meta: { ...meta, meters: result.meters, bounds: result.bounds, sliceMs: Math.round(performance.now() - t0) },
      summary,
    }, [bytes.buffer]);
  } catch (e) {
    self.postMessage({ type: 'error', message: e.message || String(e), log: log.slice(-30) });
  }
};
