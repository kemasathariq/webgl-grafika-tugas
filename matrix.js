// =====================================================================
//  matrix.js
//  Library kecil untuk matriks 3x3 (transformasi 2D).
//  Matriks disimpan column-major (format yang dipakai WebGL):
//
//      | m0 m3 m6 |
//      | m1 m4 m7 |
//      | m2 m5 m8 |
//
//  multiply(a, b) = a · b  -> saat dikalikan ke titik, b dijalankan dulu.
// =====================================================================

const m3 = {
  identity() {
    return [
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ];
  },

  // Mengubah koordinat piksel (0..width, 0..height, y ke bawah)
  // menjadi clip space (-1..1, y ke atas)
  projection(width, height) {
    return [
      2 / width, 0, 0,
      0, -2 / height, 0,
      -1, 1, 1,
    ];
  },

  translation(tx, ty) {
    return [
      1, 0, 0,
      0, 1, 0,
      tx, ty, 1,
    ];
  },

  // sudut dalam radian
  rotation(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [
      c, s, 0,
      -s, c, 0,
      0, 0, 1,
    ];
  },

  scaling(sx, sy) {
    return [
      sx, 0, 0,
      0, sy, 0,
      0, 0, 1,
    ];
  },

  multiply(a, b) {
    const out = new Array(9);
    for (let col = 0; col < 3; col++) {
      for (let row = 0; row < 3; row++) {
        out[col * 3 + row] =
          a[0 * 3 + row] * b[col * 3 + 0] +
          a[1 * 3 + row] * b[col * 3 + 1] +
          a[2 * 3 + row] * b[col * 3 + 2];
      }
    }
    return out;
  },

  // Helper berantai: m3.translate(m, ...) = m · translation(...)
  translate(m, tx, ty) {
    return m3.multiply(m, m3.translation(tx, ty));
  },

  rotate(m, angle) {
    return m3.multiply(m, m3.rotation(angle));
  },

  scale(m, sx, sy) {
    return m3.multiply(m, m3.scaling(sx, sy));
  },

  // Menerapkan matriks ke satu titik (x, y, 1) -> (x', y')
  transformPoint(m, x, y) {
    return [
      m[0] * x + m[3] * y + m[6],
      m[1] * x + m[4] * y + m[7],
    ];
  },
};

function degToRad(deg) {
  return (deg * Math.PI) / 180;
}