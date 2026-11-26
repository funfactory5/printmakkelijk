# Third-party software

PrintMakkelijk bundles the following open-source software in `site/vendor/`.

| Component | Files | License | Source |
|---|---|---|---|
| CuraEngine (compiled to WebAssembly) | `vendor/cura/CuraEngine.js` | AGPL-3.0-or-later | <https://github.com/Ultimaker/CuraEngine> |
| cura-wasm 1.5.2 (Emscripten build & glue by Cloud CNC) | `vendor/cura/CuraEngine.js` | MIT / AGPL-3.0 (engine) | <https://github.com/Cloud-CNC/cura-wasm> |
| Cura machine definitions (`fdmprinter`, `fdmextruder`) | `vendor/cura/*.def.json` | LGPL-3.0-or-later | <https://github.com/Ultimaker/Cura> |
| three.js r170 (+ addons: OrbitControls, STL/OBJ/3MF/Font loaders, TextGeometry, BufferGeometryUtils) | `vendor/three/` | MIT | <https://github.com/mrdoob/three.js> |
| fflate (bundled with three.js addons) | `vendor/three/jsm/libs/fflate.module.js` | MIT | <https://github.com/101arrowz/fflate> |
| Helvetiker Bold typeface | `vendor/three/fonts/helvetiker_bold.typeface.json` | see `vendor/three/fonts/LICENSE.txt` | three.js examples |

The full license texts are in `site/vendor/cura/LICENSE-cura-wasm.txt`, `site/vendor/three/LICENSE.txt` and `site/vendor/three/fonts/LICENSE.txt`.

`CuraEngine.js` was taken unmodified from the `cura-wasm` npm package (`src/CuraEngine.js`), except that the final `export default CuraEngine;` line was replaced by `self.CuraEngine = CuraEngine;` so it can be loaded in a classic web worker. The complete corresponding source code of CuraEngine and of the WebAssembly build is available at the links above.
