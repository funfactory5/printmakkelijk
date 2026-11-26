// Tiny binary-STL generators used by the tests.
function boxTris(x0, y0, z0, x1, y1, z1) {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return f.map((t) => t.map((i) => v[i]));
}

function toSTL(tris) {
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => {
    const o = 84 + i * 50;
    t.forEach((p, j) => p.forEach((c, k) => buf.writeFloatLE(c, o + 12 + j * 12 + k * 4)));
  });
  return buf;
}

const makeCube = (s, cx, cy) => toSTL(boxTris(cx - s / 2, cy - s / 2, 0, cx + s / 2, cy + s / 2, s));

// A "T" shape: a pillar with a wide slab on top (needs support).
const makeOverhang = (cx, cy) => toSTL([
  ...boxTris(cx - 5, cy - 5, 0, cx + 5, cy + 5, 15),
  ...boxTris(cx - 20, cy - 10, 15, cx + 20, cy + 10, 20),
]);

module.exports = { makeCube, makeOverhang, toSTL, boxTris };
