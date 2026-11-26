// Runs the vendored CuraEngine (WASM) in Node with the PrintMakkelijk
// Ender 3 S1 profile and sanity-checks the produced G-code.
//   node tests/slice.test.cjs [model.stl] [--keep]
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SITE = path.join(__dirname, '..', 'site');
const profile = require(path.join(SITE, 'js', 'profile.js'));
const { makeCube, makeOverhang } = require('./meshes.cjs');

function loadEngineFactory() {
  const code = fs.readFileSync(path.join(SITE, 'vendor', 'cura', 'CuraEngine.js'), 'utf8');
  const sandbox = { self: {}, require, process, console, Buffer, URL, WebAssembly,
    setTimeout, clearTimeout, TextDecoder, TextEncoder, performance, __dirname: SITE };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return { factory: sandbox.self.CuraEngine, sandbox };
}

async function slice(stlBytes, options) {
  const { factory, sandbox } = loadEngineFactory();
  const log = [];
  let meta = null;
  sandbox['cura-wasm-progress-callback'] = () => {};
  sandbox['cura-wasm-metadata-callback'] = (...a) => { meta = a; };
  const engine = await factory({ noInitialRun: true, print: (s) => log.push(s), printErr: (s) => log.push(s) });
  engine.FS.mkdir('/defs');
  for (const f of ['fdmprinter', 'fdmextruder']) {
    engine.FS.writeFile(`/defs/${f}.def.json`, fs.readFileSync(path.join(SITE, 'vendor', 'cura', `${f}.def.json`)));
  }
  engine.FS.writeFile('/model.stl', stlBytes);
  const { settings, summary } = profile.buildSettings(options);
  const args = profile.toEngineArgs(settings, '/defs/fdmprinter.def.json', '/model.stl', '/out.gcode');
  const t = Date.now();
  try { engine.callMain(args); } catch (e) { log.push('THROW ' + e); }
  let gcode = '';
  try { gcode = engine.FS.readFile('/out.gcode', { encoding: 'utf8' }); } catch (e) { /* none */ }
  return { gcode, log, meta, ms: Date.now() - t, summary };
}

function analyse(gcode) {
  const layers = (gcode.match(/^;LAYER:\d+/gm) || []).length;
  let maxX = -Infinity, minX = Infinity, maxY = -Infinity, minY = Infinity, maxZ = 0, e = 0, maxE = 0;
  let inPrint = false;
  for (const line of gcode.split('\n')) {
    if (line.startsWith(';LAYER:0')) inPrint = true;
    if (line.startsWith('M140 S0')) inPrint = false;
    if (!/^G[01] /.test(line)) continue;
    const g = Object.fromEntries([...line.split(';')[0].matchAll(/([XYZE])(-?[\d.]+)/g)].map((m) => [m[1], +m[2]]));
    if (g.E !== undefined) { e = g.E; maxE = Math.max(maxE, e); }
    if (!inPrint) continue;
    if (g.X !== undefined) { minX = Math.min(minX, g.X); maxX = Math.max(maxX, g.X); }
    if (g.Y !== undefined) { minY = Math.min(minY, g.Y); maxY = Math.max(maxY, g.Y); }
    if (g.Z !== undefined) maxZ = Math.max(maxZ, g.Z);
  }
  return { layers, minX, maxX, minY, maxY, maxZ, maxE };
}

(async () => {
  const keep = process.argv.includes('--keep');
  const fileArg = process.argv.slice(2).find((a) => !a.startsWith('--'));

  // 1) 20 mm cube centred on the bed, PLA normal quality
  // Engine coordinates are centred on the bed (0,0 = bed centre).
  const cube = makeCube(20, 0, 0);
  const r1 = await slice(fileArg ? fs.readFileSync(fileArg) : cube, { material: 'PLA', quality: 'normal', infill: 20 });
  if (keep) fs.writeFileSync(path.join(__dirname, 'out-cube.gcode'), r1.gcode);
  if (!r1.gcode) { console.log(r1.log.slice(-40).join('\n')); }
  assert.ok(r1.gcode.length > 1000, 'engine produced G-code');
  const a1 = analyse(r1.gcode);
  console.log('cube:', r1.ms, 'ms', a1, 'meta', r1.meta);
  if (!fileArg) {
    assert.strictEqual(a1.layers, 100, '20 mm / 0.2 mm = 100 layers');
    assert.ok(Math.abs(a1.maxZ - 20) < 0.25, 'top layer near 20 mm');
    assert.ok(a1.minX > 85 && a1.maxX < 135, 'X stays around the bed centre (incl. skirt)');
  }
  assert.ok(/M190 S60/.test(r1.gcode), 'bed temperature 60');
  assert.ok(/M109 S210/.test(r1.gcode), 'first layer nozzle 210');
  assert.ok(!/\{material_/.test(r1.gcode), 'no unreplaced placeholders');
  assert.ok(/;TYPE:FILL/.test(r1.gcode), 'has infill');
  assert.ok(/;TYPE:SKIN/.test(r1.gcode), 'has top/bottom skin');
  assert.ok(/;TYPE:WALL-OUTER/.test(r1.gcode), 'has outer wall');
  assert.ok(/;TYPE:SKIRT/.test(r1.gcode), 'has skirt');
  assert.ok(/M106 S255/.test(r1.gcode), 'fan turns on for PLA');
  const pp = profile.postProcess(r1.gcode, { printTime: r1.meta[1], filamentMm3: r1.meta[5] });
  assert.ok(/^;TIME:\d+$/m.test(pp.gcode) && !/;TIME:6666/.test(pp.gcode), 'real print time in header');
  assert.ok(!/;Filament used: 0m/.test(pp.gcode), 'filament in header');
  assert.ok(Math.abs(pp.bounds.maxX - pp.bounds.minX - 20) < 1 || pp.bounds.maxX - pp.bounds.minX > 20, 'bounds computed');
  console.log('header:', pp.gcode.split('\n').slice(0, 11).join(' | '));

  // 2) Overhang with supports + brim, PETG fine
  const over = makeOverhang(0, 0);
  const r2 = await slice(over, { material: 'PETG', quality: 'fine', supports: 'everywhere', adhesion: 'brim', infill: 10 });
  if (keep) fs.writeFileSync(path.join(__dirname, 'out-overhang.gcode'), r2.gcode);
  const a2 = analyse(r2.gcode);
  console.log('overhang:', r2.ms, 'ms', a2);
  assert.ok(/;TYPE:SUPPORT/.test(r2.gcode), 'has support');
  assert.ok(/M190 S80/.test(r2.gcode), 'PETG bed 80');
  assert.ok(a2.layers > 100, 'fine layers');

  console.log('✅ all slicing tests passed');
})().catch((e) => { console.error('❌', e); process.exit(1); });
