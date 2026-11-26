/*
 * PrintMakkelijk – Ender 3 S1 profile builder.
 *
 * CuraEngine's command line does NOT evaluate the Python formulas ("value")
 * from the Cura definition files: it only reads "default_value". The Cura
 * desktop app normally computes all derived settings before calling the
 * engine. This file does that job: it turns a handful of simple choices into
 * the complete list of settings the engine needs.
 *
 * Works as a classic script (worker importScripts / <script>) and in Node.
 */
(function (root) {
  'use strict';

  const PRINTER = {
    name: 'Creality Ender-3 S1',
    width: 220,
    depth: 220,
    height: 270,
    nozzle: 0.4,
    filament: 1.75,
  };

  const MATERIALS = {
    PLA:  { label: 'PLA',  nozzle: 205, bed: 60,  fan: 100, retract: 0.8, retractSpeed: 40, speedFactor: 1.0 },
    PETG: { label: 'PETG', nozzle: 235, bed: 80,  fan: 50,  retract: 1.0, retractSpeed: 35, speedFactor: 0.8 },
    ABS:  { label: 'ABS',  nozzle: 240, bed: 100, fan: 0,   retract: 0.8, retractSpeed: 40, speedFactor: 0.9 },
    TPU:  { label: 'TPU',  nozzle: 225, bed: 50,  fan: 100, retract: 0.4, retractSpeed: 20, speedFactor: 0.4 },
  };

  const QUALITIES = {
    fine:   { label: 'Fijn (0,12 mm)',   layer: 0.12, speed: 45 },
    normal: { label: 'Normaal (0,2 mm)', layer: 0.2,  speed: 50 },
    fast:   { label: 'Snel (0,28 mm)',   layer: 0.28, speed: 60 },
  };

  const DEFAULTS = {
    material: 'PLA',
    quality: 'normal',
    infill: 15,
    walls: 2,
    supports: 'none',      // none | buildplate | everywhere
    adhesion: 'skirt',     // skirt | brim | none
    nozzleTemp: null,      // null = material default
    bedTemp: null,
    fan: null,
    speed: null,           // mm/s, null = quality default
    ironing: false,
    vase: false,           // spiralize outer wall (vase mode)
  };

  // Start/end G-code based on the official Cura Ender-3 S1 profile.
  // Placeholders {name} are filled in by fillGcodeTemplate().
  const START_GCODE = [
    '; Ender 3 S1 Start G-code (PrintMakkelijk)',
    'M413 S0 ; Disable power loss recovery',
    'G92 E0 ; Reset Extruder',
    '; Prep surfaces before auto home for better accuracy',
    'M140 S{material_bed_temperature_layer_0}',
    'M104 S{material_print_temperature_layer_0}',
    'G28 ; Home all axes',
    'M420 S1 ; Use stored CR-Touch mesh (ignored when none is saved)',
    'G1 Z10.0 F3000 ; Move Z Axis up little to prevent scratching of Heat Bed',
    'G1 X0 Y0',
    'M190 S{material_bed_temperature_layer_0}',
    'M109 S{material_print_temperature_layer_0}',
    'G1 X0.1 Y20 Z0.3 F5000.0 ; Move to start position',
    'G1 X0.1 Y200.0 Z0.3 F1500.0 E15 ; Draw the first line',
    'G1 X0.4 Y200.0 Z0.3 F5000.0 ; Move to side a little',
    'G1 X0.4 Y20 Z0.3 F1500.0 E30 ; Draw the second line',
    'G92 E0 ; Reset Extruder',
    'G1 E-1.0000 F1800 ; Retract a bit',
    'G1 Z2.0 F3000 ; Move Z Axis up little to prevent scratching of Heat Bed',
    'G1 E0.0000 F1800',
  ].join('\n');

  const END_GCODE = [
    'G91 ; Relative positioning',
    'G1 E-2 F2700 ; Retract a bit',
    'G1 E-2 Z0.2 F2400 ; Retract and raise Z',
    'G1 X5 Y5 F3000 ; Wipe out',
    'G1 Z10 ; Raise Z more',
    'G90 ; Absolute positioning',
    'G1 X0 Y{machine_depth} ; Present print',
    'M106 S0 ; Turn-off fan',
    'M104 S0 ; Turn-off hotend',
    'M140 S0 ; Turn-off bed',
    'M84 X Y E ; Disable all steppers but Z',
  ].join('\n');

  // Line distance multiplier per infill pattern (fdmprinter.def.json formula).
  const PATTERN_MULTIPLIER = {
    grid: 2, triangles: 3, trihexagon: 3, cubic: 3, cubicsubdiv: 2,
    tetrahedral: 2, quarter_cubic: 2, cross: 1, cross_3d: 1,
    lines: 1, zigzag: 1, gyroid: 1, concentric: 1,
  };

  const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

  function fillGcodeTemplate(template, values) {
    return template.replace(/\{([a-z0-9_]+)\}/g, (m, key) =>
      Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : m);
  }

  /**
   * Build the full CuraEngine settings map.
   * @param {object} options see DEFAULTS
   * @returns {{settings: Object<string, string|number|boolean>, summary: object}}
   */
  function buildSettings(options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    const mat = MATERIALS[o.material] || MATERIALS.PLA;
    const q = QUALITIES[o.quality] || QUALITIES.normal;

    const lw = PRINTER.nozzle;              // line width
    const lh = q.layer;                     // layer height
    const lh0 = Math.max(0.2, lh);          // first layer height
    const nozzleTemp = o.nozzleTemp != null ? +o.nozzleTemp : mat.nozzle;
    const bedTemp = o.bedTemp != null ? +o.bedTemp : mat.bed;
    const fan = o.fan != null ? +o.fan : mat.fan;
    const speed = round((o.speed != null ? +o.speed : q.speed) * mat.speedFactor, 1);
    const wallSpeed = round(speed / 2, 1);
    const firstLayerSpeed = Math.min(20, speed);
    const walls = Math.max(1, Math.round(+o.walls));
    const infill = Math.max(0, Math.min(100, +o.infill));
    const infillPattern = infill > 50 ? 'lines' : 'cubic';
    const infillLineDistance = infill <= 0 ? 0
      : round((lw * 100 / infill) * PATTERN_MULTIPLIER[infillPattern]);
    const topThickness = 0.8;
    const bottomThickness = 0.6;
    const topLayers = Math.ceil(round(topThickness / lh, 3));
    const bottomLayers = Math.ceil(round(bottomThickness / lh, 3));

    const supportEnable = o.supports === 'buildplate' || o.supports === 'everywhere';
    const supportRate = 15;
    const supportLineDistance = round(lw * 100 / supportRate);
    const interfaceDensity = 33.333;
    const interfaceLineDistance = round(lw * 100 / interfaceDensity);
    const brimWidth = 8;

    const gcodeValues = {
      material_bed_temperature_layer_0: bedTemp,
      material_print_temperature_layer_0: nozzleTemp + 5,
      material_bed_temperature: bedTemp,
      material_print_temperature: nozzleTemp,
      machine_depth: PRINTER.depth,
      machine_width: PRINTER.width,
      machine_height: PRINTER.height,
    };

    const s = {
      // --- machine -------------------------------------------------------
      machine_name: PRINTER.name,
      machine_width: PRINTER.width,
      machine_depth: PRINTER.depth,
      machine_height: PRINTER.height,
      machine_center_is_zero: false,
      machine_heated_bed: true,
      machine_gcode_flavor: 'RepRap (Marlin/Sprinter)',
      machine_nozzle_size: PRINTER.nozzle,
      material_diameter: PRINTER.filament,
      machine_max_feedrate_x: 500,
      machine_max_feedrate_y: 500,
      machine_max_feedrate_z: 10,
      machine_max_feedrate_e: 50,
      machine_max_acceleration_x: 500,
      machine_max_acceleration_y: 500,
      machine_max_acceleration_z: 100,
      machine_max_acceleration_e: 5000,
      machine_acceleration: 500,
      machine_max_jerk_xy: 10,
      machine_max_jerk_z: 0.4,
      machine_max_jerk_e: 5,
      machine_start_gcode: fillGcodeTemplate(START_GCODE, gcodeValues),
      machine_end_gcode: fillGcodeTemplate(END_GCODE, gcodeValues),
      material_print_temp_prepend: false,
      material_bed_temp_prepend: false,
      center_object: false,
      mesh_position_x: 0,
      mesh_position_y: 0,
      mesh_position_z: 0,
      acceleration_enabled: false,
      jerk_enabled: false,
      relative_extrusion: false,

      // --- quality -------------------------------------------------------
      layer_height: lh,
      layer_height_0: lh0,
      line_width: lw,
      wall_line_width: lw,
      wall_line_width_0: lw,
      wall_line_width_x: lw,
      skin_line_width: lw,
      infill_line_width: lw,
      skirt_brim_line_width: lw,
      support_line_width: lw,
      support_interface_line_width: lw,
      support_roof_line_width: lw,
      support_bottom_line_width: lw,
      prime_tower_line_width: lw,
      initial_layer_line_width_factor: 100,

      // --- walls / top / bottom -----------------------------------------
      wall_thickness: round(walls * lw),
      wall_line_count: walls,
      wall_0_wipe_dist: 0.2,
      outer_inset_first: false,
      optimize_wall_printing_order: true,
      fill_perimeter_gaps: 'everywhere',
      fill_outline_gaps: true,
      filter_out_tiny_gaps: true,
      top_bottom_thickness: topThickness,
      top_thickness: topThickness,
      bottom_thickness: bottomThickness,
      top_layers: topLayers,
      bottom_layers: bottomLayers,
      initial_bottom_layers: bottomLayers,
      top_bottom_pattern: 'lines',
      top_bottom_pattern_0: 'lines',
      skin_overlap: 10,
      skin_overlap_mm: round(lw * 0.1),
      z_seam_type: 'sharpest_corner',
      z_seam_corner: 'z_seam_corner_weighted',
      xy_offset: 0,
      xy_offset_layer_0: 0,
      ironing_enabled: !!o.ironing,
      ironing_only_highest_layer: true,

      // --- infill --------------------------------------------------------
      infill_sparse_density: infill,
      infill_line_distance: infillLineDistance,
      infill_pattern: infillPattern,
      infill_sparse_thickness: lh,
      infill_overlap: 30,
      infill_overlap_mm: round(lw * 0.3),
      infill_wipe_dist: 0,
      infill_before_walls: false,
      gradual_infill_steps: 0,
      infill_wall_line_count: 0,

      // --- material ------------------------------------------------------
      material_print_temperature: nozzleTemp,
      material_print_temperature_layer_0: nozzleTemp + 5,
      material_initial_print_temperature: nozzleTemp,
      material_final_print_temperature: nozzleTemp,
      material_standby_temperature: Math.max(150, nozzleTemp - 50),
      material_bed_temperature: bedTemp,
      material_bed_temperature_layer_0: bedTemp,
      material_flow: 100,
      material_flow_layer_0: 100,

      // --- speed ---------------------------------------------------------
      speed_print: speed,
      speed_infill: speed,
      speed_wall: wallSpeed,
      speed_wall_0: wallSpeed,
      speed_wall_x: wallSpeed,
      speed_topbottom: wallSpeed,
      speed_roofing: wallSpeed,
      speed_ironing: round(wallSpeed * 0.66, 1),
      speed_support: speed,
      speed_support_infill: speed,
      speed_support_interface: wallSpeed,
      speed_support_roof: wallSpeed,
      speed_support_bottom: wallSpeed,
      speed_travel: speed < 60 ? 150 : 250,
      speed_layer_0: firstLayerSpeed,
      speed_print_layer_0: firstLayerSpeed,
      speed_travel_layer_0: 100,
      skirt_brim_speed: firstLayerSpeed,
      speed_z_hop: 5,
      speed_slowdown_layers: 2,

      // --- travel / retraction -------------------------------------------
      retraction_enable: true,
      retraction_amount: mat.retract,
      retraction_speed: mat.retractSpeed,
      retraction_retract_speed: mat.retractSpeed,
      retraction_prime_speed: mat.retractSpeed,
      retraction_extra_prime_amount: 0,
      retraction_min_travel: 1.5,
      retraction_count_max: 100,
      retraction_extrusion_window: 10,
      retraction_hop_enabled: false,
      retraction_hop: 0.2,
      retraction_combing: 'noskin',
      retraction_combing_max_distance: 30,
      travel_avoid_other_parts: true,
      travel_avoid_supports: true,
      travel_retract_before_outer_wall: true,

      // --- cooling -------------------------------------------------------
      cool_fan_enabled: fan > 0,
      cool_fan_speed: fan,
      cool_fan_speed_min: fan,
      cool_fan_speed_max: fan,
      cool_fan_speed_0: 0,
      cool_fan_full_at_height: round(lh0 + 2 * lh),
      cool_fan_full_layer: 3,
      cool_min_layer_time: 10,
      cool_min_layer_time_fan_speed_max: 10,
      cool_min_speed: 10,
      cool_lift_head: false,

      // --- support -------------------------------------------------------
      support_enable: supportEnable,
      support_type: o.supports === 'everywhere' ? 'everywhere' : 'buildplate',
      support_angle: 50,
      support_pattern: 'zigzag',
      support_infill_rate: supportRate,
      support_line_distance: supportLineDistance,
      support_initial_layer_line_distance: supportLineDistance,
      support_infill_sparse_thickness: lh,
      support_z_distance: lh,
      support_top_distance: lh,
      support_bottom_distance: lh,
      support_xy_distance: 0.8,
      support_xy_distance_overhang: lw,
      support_xy_overrides_z: 'z_overrides_xy',
      support_wall_count: 1,
      support_join_distance: 2,
      support_offset: 0.8,
      support_use_towers: true,
      support_brim_enable: true,
      support_brim_width: 4,
      support_brim_line_count: 10,
      support_interface_enable: supportEnable,
      support_roof_enable: supportEnable,
      support_bottom_enable: false,
      support_interface_height: round(lh * 4),
      support_roof_height: round(lh * 4),
      support_bottom_height: round(lh * 4),
      support_interface_density: interfaceDensity,
      support_roof_density: interfaceDensity,
      support_bottom_density: interfaceDensity,
      support_roof_line_distance: interfaceLineDistance,
      support_bottom_line_distance: interfaceLineDistance,
      support_interface_pattern: 'zigzag',
      support_roof_pattern: 'zigzag',
      support_bottom_pattern: 'zigzag',
      support_interface_skip_height: lh,
      support_bottom_stair_step_height: 0.3,
      minimum_support_area: 2,
      minimum_interface_area: 10,
      minimum_roof_area: 10,

      // --- adhesion ------------------------------------------------------
      adhesion_type: o.adhesion === 'brim' ? 'brim' : o.adhesion === 'none' ? 'none' : 'skirt',
      skirt_line_count: 3,
      skirt_gap: 10,
      skirt_brim_minimal_length: 250,
      brim_width: brimWidth,
      brim_line_count: Math.ceil(brimWidth / lw),
      brim_outside_only: true,
      brim_replaces_support: false,

      // --- mesh fixes ----------------------------------------------------
      meshfix_union_all: true,
      meshfix_union_all_remove_holes: false,
      meshfix_extensive_stitching: false,
      meshfix_keep_open_polygons: false,
      meshfix_maximum_resolution: 0.25,
      meshfix_maximum_travel_resolution: 0.5,
      meshfix_maximum_deviation: 0.025,
      multiple_mesh_overlap: 0.15,
      magic_spiralize: false,
    };

    if (o.vase) {
      Object.assign(s, {
        magic_spiralize: true,
        smooth_spiralized_contours: true,
        wall_line_count: 1,
        wall_thickness: lw,
        infill_sparse_density: 0,
        infill_line_distance: 0,
        top_layers: 0,
        top_thickness: 0,
        support_enable: false,
        support_interface_enable: false,
        support_roof_enable: false,
      });
    }

    return {
      settings: s,
      summary: {
        printer: PRINTER.name,
        material: mat.label,
        layerHeight: lh,
        nozzleTemp,
        bedTemp,
        infill,
        walls,
        supports: o.supports,
        adhesion: s.adhesion_type,
        speed,
        vase: !!o.vase,
      },
    };
  }

  /** Turn a settings map into CuraEngine CLI arguments. */
  function toEngineArgs(settings, definitionPath, modelPath, outputPath) {
    const args = ['slice', '-j', definitionPath];
    const pairs = Object.entries(settings).map(([k, v]) => `${k}=${typeof v === 'boolean' ? (v ? 'true' : 'false') : v}`);
    // Global settings …
    for (const p of pairs) args.push('-s', p);
    // … and the same values on extruder 0 (the engine looks there first for
    // per-extruder settings, which otherwise fall back to fdmextruder defaults)
    args.push('-e0');
    for (const p of pairs) args.push('-s', p);
    args.push('-l', modelPath, '-o', outputPath);
    return args;
  }

  /**
   * CuraEngine's CLI writes placeholder values in the header (;TIME:6666 …).
   * Replace them with the real numbers so the printer display is correct.
   * @param {string} gcode
   * @param {{printTime:number, filamentMm3:number}} meta
   */
  function postProcess(gcode, meta) {
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    const start = gcode.indexOf(';LAYER:0');
    const end = gcode.indexOf(';TIME_ELAPSED', start);
    if (start >= 0) {
      const body = gcode.slice(start, end > 0 ? gcode.lastIndexOf(';TIME_ELAPSED') : undefined);
      let z = 0;
      // Only extruding moves count towards the print bounds.
      for (const line of body.split('\n')) {
        if (line.charCodeAt(0) !== 71) continue; // 'G'
        const zm = /Z(-?[\d.]+)/.exec(line); if (zm) z = +zm[1];
        if (!line.startsWith('G1') || line.indexOf('E') < 0) continue;
        const xm = /X(-?[\d.]+)/.exec(line), ym = /Y(-?[\d.]+)/.exec(line);
        if (xm) { const x = +xm[1]; if (x < minX) minX = x; if (x > maxX) maxX = x; }
        if (ym) { const y = +ym[1]; if (y < minY) minY = y; if (y > maxY) maxY = y; }
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    }
    const area = Math.PI * (PRINTER.filament / 2) ** 2;
    const meters = meta && meta.filamentMm3 ? meta.filamentMm3 / area / 1000 : 0;
    const time = meta && meta.printTime ? Math.round(meta.printTime) : null;
    let out = gcode;
    if (time != null) out = out.replace(/^;TIME:6666$/m, `;TIME:${time}`);
    if (meters) out = out.replace(/^;Filament used: 0m$/m, `;Filament used: ${meters.toFixed(5)}m`);
    if (isFinite(minX)) {
      const f = (v) => +v.toFixed(3);
      out = out
        .replace(/^;MINX:.*$/m, `;MINX:${f(minX)}`).replace(/^;MINY:.*$/m, `;MINY:${f(minY)}`)
        .replace(/^;MINZ:.*$/m, `;MINZ:${f(minZ)}`).replace(/^;MAXX:.*$/m, `;MAXX:${f(maxX)}`)
        .replace(/^;MAXY:.*$/m, `;MAXY:${f(maxY)}`).replace(/^;MAXZ:.*$/m, `;MAXZ:${f(maxZ)}`);
    }
    out = out.replace(/^;Generated with Cura_SteamEngine master$/m,
      ';Generated with CuraEngine (WASM) via PrintMakkelijk for Ender-3 S1');
    return { gcode: out, bounds: { minX, minY, minZ, maxX, maxY, maxZ }, meters, time };
  }

  const api = { PRINTER, MATERIALS, QUALITIES, DEFAULTS, buildSettings, toEngineArgs, fillGcodeTemplate, postProcess };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PMProfile = api;
})(typeof self !== 'undefined' ? self : globalThis);
