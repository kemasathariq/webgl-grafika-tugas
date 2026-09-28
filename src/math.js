// 2D homogeneous matrix utilities. Matrices are flat 9-element row-major
// arrays: [a,b,c, d,e,f, g,h,i]. Column-vector convention throughout:
//   clipPosition = projectionMatrix * modelMatrix * vec3(localPosition, 1.0)
// so modelMatrix = T * R * S applies scale first, then rotation, then
// translation to local geometry.

export function mat3Identity() {
  return [
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
  ];
}

export function mat3Translation(tx, ty) {
  return [
    1, 0, tx,
    0, 1, ty,
    0, 0, 1,
  ];
}

export function mat3Rotation(theta) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [
    c, -s, 0,
    s, c, 0,
    0, 0, 1,
  ];
}

export function mat3Scaling(sx, sy) {
  return [
    sx, 0, 0,
    0, sy, 0,
    0, 0, 1,
  ];
}

// result = a * b (a applied after b, as in (a*b)*p = a*(b*p))
export function mat3Multiply(a, b) {
  const out = new Array(9);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) {
        sum += a[row * 3 + k] * b[k * 3 + col];
      }
      out[row * 3 + col] = sum;
    }
  }
  return out;
}

// mat3MultiplyMany(A, B, C) === A * (B * C)
export function mat3MultiplyMany(...matrices) {
  if (matrices.length === 0) return mat3Identity();
  return matrices.reduce((acc, m) => mat3Multiply(acc, m));
}

export function mat3TransformPoint(matrix, point) {
  const [x, y] = point;
  const w = 1;
  return [
    matrix[0] * x + matrix[1] * y + matrix[2] * w,
    matrix[3] * x + matrix[4] * y + matrix[5] * w,
  ];
}

// Maps world box [left,right] x [bottom,top] to clip space [-1,1]^2.
export function ortho2D(left, right, bottom, top) {
  const sx = 2 / (right - left);
  const sy = 2 / (top - bottom);
  const tx = -(right + left) / (right - left);
  const ty = -(top + bottom) / (top - bottom);
  return [
    sx, 0, tx,
    0, sy, ty,
    0, 0, 1,
  ];
}

export function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
