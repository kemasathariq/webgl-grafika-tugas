// Procedural WebGL reproduction of the reference illustration, with an
// animated day/night cycle. See README.md for the full write-up.

import {
  mat3Translation,
  mat3Rotation,
  mat3Scaling,
  mat3MultiplyMany,
  ortho2D,
  degToRad,
  clamp,
  lerp,
  smoothstep,
} from './math.js';
import { VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE } from './shaders.js';

// Tweakable parameters for live demo/debug.
const CONFIG = {
  worldWidth: 900,
  worldHeight: 580,

  cycleDuration: 26.0, // seconds per full day+night loop

  sunOrbitRadiusX: 300,
  sunOrbitRadiusY: 260,
  sunSize: 34,
  sunRayCount: 8,
  sunRaySpeed: 0.6,

  moonOrbitRadiusX: 300,
  moonOrbitRadiusY: 210,
  moonSize: 24,

  birdFlapAmplitude: 0.55,
  birdFlapSpeed: 6.0,
  birdDriftAmplitude: 10,
  birdDriftSpeed: 0.5,

  starCount: 14,
};

const GROUND_Y = 230;
const VALLEY_X = 460;
// Same as GROUND_Y so the mountain base sits flush on the field.
const VALLEY_Y = GROUND_Y;

// --- DOM / WebGL setup ------------------------------------------------------
const canvas = document.getElementById('glcanvas');
const statusEl = document.getElementById('status-text');
const timeReadout = document.getElementById('time-readout');
const lightReadout = document.getElementById('light-readout');
const pauseButton = document.getElementById('btn-pause');
const resetButton = document.getElementById('btn-reset');

const gl = canvas.getContext('webgl');
if (!gl) {
  throw new Error('WebGL is not supported in this browser.');
}
gl.enable(gl.BLEND);
gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

function compileShader(glCtx, type, source) {
  const shader = glCtx.createShader(type);
  glCtx.shaderSource(shader, source);
  glCtx.compileShader(shader);
  if (!glCtx.getShaderParameter(shader, glCtx.COMPILE_STATUS)) {
    const info = glCtx.getShaderInfoLog(shader);
    glCtx.deleteShader(shader);
    throw new Error(`Shader compile error: ${info}`);
  }
  return shader;
}

function linkProgram(glCtx, vertexShader, fragmentShader) {
  const program = glCtx.createProgram();
  glCtx.attachShader(program, vertexShader);
  glCtx.attachShader(program, fragmentShader);
  glCtx.linkProgram(program);
  if (!glCtx.getProgramParameter(program, glCtx.LINK_STATUS)) {
    const info = glCtx.getProgramInfoLog(program);
    glCtx.deleteProgram(program);
    throw new Error(`Program link error: ${info}`);
  }
  return program;
}

const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
const program = linkProgram(gl, vertexShader, fragmentShader);
gl.useProgram(program);

const locations = {
  position: gl.getAttribLocation(program, 'a_position'),
  model: gl.getUniformLocation(program, 'u_model'),
  projection: gl.getUniformLocation(program, 'u_projection'),
  color: gl.getUniformLocation(program, 'u_color'),
  lightIntensity: gl.getUniformLocation(program, 'u_lightIntensity'),
  nightTint: gl.getUniformLocation(program, 'u_nightTint'),
};

// --- Geometry creation -------------------------------------------------------
// Helpers return a flat Float32Array of (x, y) triangle vertices in local
// space. Buffers are built once; animation only changes model matrices.

function createTriangle(p0, p1, p2) {
  return new Float32Array([...p0, ...p1, ...p2]);
}

function createQuad(x, y, w, h) {
  return new Float32Array([
    x, y, x + w, y, x + w, y + h,
    x, y, x + w, y + h, x, y + h,
  ]);
}

function createLine(x1, y1, x2, y2, thickness) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1e-6;
  const nx = (-dy / len) * (thickness / 2);
  const ny = (dx / len) * (thickness / 2);
  const a = [x1 + nx, y1 + ny];
  const b = [x2 + nx, y2 + ny];
  const c = [x2 - nx, y2 - ny];
  const d = [x1 - nx, y1 - ny];
  return new Float32Array([...a, ...b, ...c, ...a, ...c, ...d]);
}

// Fan-triangulates a simple polygon that is star-shaped from points[0].
function createPolygon(points) {
  const verts = [];
  for (let i = 1; i < points.length - 1; i++) {
    verts.push(...points[0], ...points[i], ...points[i + 1]);
  }
  return new Float32Array(verts);
}

function createCircle(radius, segments) {
  const verts = [];
  const step = (Math.PI * 2) / segments;
  for (let i = 0; i < segments; i++) {
    const a0 = i * step;
    const a1 = (i + 1) * step;
    verts.push(
      0, 0,
      Math.cos(a0) * radius, Math.sin(a0) * radius,
      Math.cos(a1) * radius, Math.sin(a1) * radius,
    );
  }
  return new Float32Array(verts);
}

function createArc(radius, startAngle, endAngle, segments) {
  const verts = [];
  const step = (endAngle - startAngle) / segments;
  for (let i = 0; i < segments; i++) {
    const a0 = startAngle + i * step;
    const a1 = startAngle + (i + 1) * step;
    verts.push(
      0, 0,
      Math.cos(a0) * radius, Math.sin(a0) * radius,
      Math.cos(a1) * radius, Math.sin(a1) * radius,
    );
  }
  return new Float32Array(verts);
}

// Reusable unit primitives: placed anywhere via translate/rotate/scale.
const GEOM_UNIT_QUAD = createQuad(0, 0, 1, 1); // bottom-left anchored
const GEOM_UNIT_STROKE = createLine(0, 0, 1, 0, 1); // start point, length, thickness
const GEOM_UNIT_CIRCLE = createCircle(1, 40);
const GEOM_UNIT_GLOW = createArc(1, 0, Math.PI * 2, 40);

// One-off shapes, anchored at a sensible local origin and translated into place.
const GEOM_MOUNTAIN_LEFT = createTriangle([-260, 0], [-140, 190], [0, 0]);
const GEOM_MOUNTAIN_RIGHT = createTriangle([0, 0], [140, 190], [260, 0]);
const GEOM_ROAD = createPolygon([
  [-14, 0], [14, 0], [-100, -240], [-260, -240],
]);
const GEOM_ROOF = createTriangle([-78, 0], [0, 48], [78, 0]); // origin = eave line

// --- Buffers -----------------------------------------------------------------
function createGeometryBuffer(glCtx, positions) {
  const buffer = glCtx.createBuffer();
  glCtx.bindBuffer(glCtx.ARRAY_BUFFER, buffer);
  glCtx.bufferData(glCtx.ARRAY_BUFFER, positions, glCtx.STATIC_DRAW);
  return { buffer, count: positions.length / 2 };
}

const buffers = {
  unitQuad: createGeometryBuffer(gl, GEOM_UNIT_QUAD),
  unitStroke: createGeometryBuffer(gl, GEOM_UNIT_STROKE),
  unitCircle: createGeometryBuffer(gl, GEOM_UNIT_CIRCLE),
  unitGlow: createGeometryBuffer(gl, GEOM_UNIT_GLOW),
  mountainLeft: createGeometryBuffer(gl, GEOM_MOUNTAIN_LEFT),
  mountainRight: createGeometryBuffer(gl, GEOM_MOUNTAIN_RIGHT),
  road: createGeometryBuffer(gl, GEOM_ROAD),
  roof: createGeometryBuffer(gl, GEOM_ROOF),
};

// --- Scene object definitions -------------------------------------------------
const COLORS = {
  skyDay: [0.62, 0.86, 0.95],
  skyNight: [0.07, 0.10, 0.24],
  mountain: [0.55, 0.42, 0.32],
  mountainAccent: [0.97, 0.97, 0.94],
  sun: [1.0, 0.85, 0.15],
  sunGlow: [1.0, 0.78, 0.35],
  ground: [0.62, 0.80, 0.45],
  road: [0.80, 0.82, 0.74],
  houseWall: [0.98, 0.97, 0.92],
  roof: [0.80, 0.16, 0.12],
  trunk: [0.30, 0.35, 0.16],
  canopy: [0.28, 0.62, 0.24],
  windowDay: [0.75, 0.85, 0.88],
  windowNight: [1.0, 0.82, 0.40],
  door: [0.42, 0.27, 0.16],
  grass: [0.20, 0.42, 0.18],
  bird: [0.15, 0.15, 0.18],
  moon: [0.93, 0.93, 0.88],
  star: [1.0, 1.0, 0.95],
};

// Right mountain's footprint ends at VALLEY_X + 260 = 720, so the house
// starts past it to avoid overlapping the slope.
const HOUSE = { x: 730, y: GROUND_Y, w: 100, h: 78 };
const TREE = { x: HOUSE.x + HOUSE.w + 35, groundY: GROUND_Y };

function buildGrassMarks() {
  const marks = [];
  const rows = 5;
  const cols = 4;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const baseX = 32 + c * 40 + (r % 2) * 18;
      const baseY = 26 + r * 32;
      marks.push({ x: baseX, y: baseY, scale: 0.85 + ((r + c) % 3) * 0.12 });
    }
  }
  return marks;
}
const GRASS_MARKS = buildGrassMarks();

const BIRDS = [
  { x: 140, y: 470, size: 14, phase: 0.0, driftPhase: 0.4 },
  { x: 205, y: 500, size: 12, phase: 1.1, driftPhase: 1.8 },
  { x: 165, y: 435, size: 11, phase: 2.3, driftPhase: 3.1 },
];

function buildStars() {
  const stars = [];
  for (let i = 0; i < CONFIG.starCount; i++) {
    const x = 40 + ((i * 61) % (CONFIG.worldWidth - 80));
    const y = 340 + ((i * 97) % (CONFIG.worldHeight - 380));
    const r = 1.4 + (i % 3) * 0.5;
    stars.push({ x, y, r });
  }
  return stars;
}
const STARS = buildStars();

const projectionMatrix = ortho2D(0, CONFIG.worldWidth, 0, CONFIG.worldHeight);

// --- Draw helpers --------------------------------------------------------------
// WebGL1 forbids transpose = true in uniformMatrix3fv; math.js is row-major,
// so transpose to column-major here instead.
function toColumnMajor(m) {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

function drawGeometry(geom, modelMatrix, color, alpha = 1) {
  gl.bindBuffer(gl.ARRAY_BUFFER, geom.buffer);
  gl.enableVertexAttribArray(locations.position);
  gl.vertexAttribPointer(locations.position, 2, gl.FLOAT, false, 0, 0);

  gl.uniformMatrix3fv(locations.model, false, toColumnMajor(modelMatrix));
  gl.uniform4f(locations.color, color[0], color[1], color[2], alpha);

  gl.drawArrays(gl.TRIANGLES, 0, geom.count);
}

// modelMatrix = T * R * S
function buildModel(tx, ty, rot, sx, sy) {
  return mat3MultiplyMany(
    mat3Translation(tx, ty),
    mat3Rotation(rot),
    mat3Scaling(sx, sy),
  );
}

function drawRect(x, y, w, h, color, alpha = 1, rot = 0) {
  const model = rot === 0
    ? mat3MultiplyMany(mat3Translation(x, y), mat3Scaling(w, h))
    : buildModel(x, y, rot, w, h);
  drawGeometry(buffers.unitQuad, model, color, alpha);
}

function drawStroke(x, y, angleRad, length, thickness, color, alpha = 1) {
  const model = buildModel(x, y, angleRad, length, thickness);
  drawGeometry(buffers.unitStroke, model, color, alpha);
}

function drawCircle(x, y, radius, color, alpha = 1) {
  const model = mat3MultiplyMany(mat3Translation(x, y), mat3Scaling(radius, radius));
  drawGeometry(buffers.unitCircle, model, color, alpha);
}

function drawGlow(x, y, radius, color, alpha) {
  const model = mat3MultiplyMany(mat3Translation(x, y), mat3Scaling(radius, radius));
  drawGeometry(buffers.unitGlow, model, color, alpha);
}

// --- Animation + lighting state -------------------------------------------------
const state = {
  elapsed: 0,
  paused: false,
  sun: { x: VALLEY_X, y: VALLEY_Y, elevation: 0 },
  moon: { x: VALLEY_X, y: VALLEY_Y, elevation: 0 },
  lightIntensity: 1.0,
  skyColor: COLORS.skyDay.slice(),
  nightAmount: 0,
  timeLabel: 'DAY',
};

function updateAnimation(elapsed) {
  // One phase drives both bodies (half cycle offset) so day/night loops
  // with no jump: the moon arrives back at the valley exactly as day restarts.
  const thetaFull = (elapsed / CONFIG.cycleDuration) * Math.PI * 2;

  const sunTheta = thetaFull;
  state.sun.x = VALLEY_X + CONFIG.sunOrbitRadiusX * (1 - Math.cos(sunTheta));
  state.sun.y = VALLEY_Y + CONFIG.sunOrbitRadiusY * Math.sin(sunTheta);
  state.sun.elevation = clamp(Math.sin(sunTheta), 0, 1);

  const moonTheta = thetaFull - Math.PI;
  const rightHorizonX = VALLEY_X + 2 * CONFIG.sunOrbitRadiusX;
  state.moon.x = rightHorizonX - CONFIG.moonOrbitRadiusX * (1 - Math.cos(moonTheta));
  state.moon.y = VALLEY_Y + CONFIG.moonOrbitRadiusY * Math.sin(moonTheta);
  state.moon.elevation = clamp(Math.sin(moonTheta), 0, 1);

  for (const bird of BIRDS) {
    bird.flapAngle = Math.sin(elapsed * CONFIG.birdFlapSpeed + bird.phase) * CONFIG.birdFlapAmplitude;
    bird.driftX = Math.sin(elapsed * CONFIG.birdDriftSpeed + bird.driftPhase) * CONFIG.birdDriftAmplitude;
  }

  state.rayAngle = elapsed * CONFIG.sunRaySpeed;

  if (state.sun.elevation > 0.12) {
    state.timeLabel = 'DAY';
  } else if (state.moon.elevation > 0.12) {
    state.timeLabel = 'NIGHT';
  } else {
    state.timeLabel = 'SUNSET';
  }
}

function updateLighting() {
  const dayFactor = smoothstep(0, 0.4, state.sun.elevation);
  const nightFactor = smoothstep(0, 0.3, state.moon.elevation);

  let intensity = lerp(0.24, 1.0, dayFactor);
  intensity += nightFactor * 0.08;
  state.lightIntensity = clamp(intensity, 0.2, 1.0);

  state.nightAmount = clamp(1 - dayFactor, 0, 1);

  for (let i = 0; i < 3; i++) {
    state.skyColor[i] = lerp(COLORS.skyNight[i], COLORS.skyDay[i], dayFactor);
  }
}

function lerpColor(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

// Draw order follows the required back-to-front layering (see README).
function drawScene() {
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(state.skyColor[0], state.skyColor[1], state.skyColor[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.uniformMatrix3fv(locations.projection, false, toColumnMajor(projectionMatrix));
  gl.uniform1f(locations.lightIntensity, state.lightIntensity);
  gl.uniform3f(locations.nightTint, 0.06, 0.10, 0.30);

  drawRect(0, 0, CONFIG.worldWidth, CONFIG.worldHeight, state.skyColor, 1);

  for (const s of STARS) {
    drawCircle(s.x, s.y, s.r, COLORS.star, state.nightAmount * 0.85);
  }

  // Sun/moon drawn before mountains so the valley slopes occlude them naturally.
  drawGlow(state.sun.x, state.sun.y, CONFIG.sunSize * 2.4, COLORS.sunGlow, 0.22 * state.sun.elevation);
  for (let i = 0; i < CONFIG.sunRayCount; i++) {
    const a = state.rayAngle + (i / CONFIG.sunRayCount) * Math.PI * 2;
    drawStroke(
      state.sun.x, state.sun.y, a,
      CONFIG.sunSize * 1.7, 3,
      COLORS.sun, 0.85 * state.sun.elevation,
    );
  }
  drawCircle(state.sun.x, state.sun.y, CONFIG.sunSize, COLORS.sun, Math.max(0.05, state.sun.elevation));
  drawCircle(state.moon.x, state.moon.y, CONFIG.moonSize, COLORS.moon, state.moon.elevation);

  // White accent silhouette (scaled up) behind the brown mountain fill.
  drawGeometry(buffers.mountainLeft, buildModel(VALLEY_X, VALLEY_Y, 0, 1.05, 1.05), COLORS.mountainAccent, 1);
  drawGeometry(buffers.mountainRight, buildModel(VALLEY_X, VALLEY_Y, 0, 1.05, 1.05), COLORS.mountainAccent, 1);
  drawGeometry(buffers.mountainLeft, mat3Translation(VALLEY_X, VALLEY_Y), COLORS.mountain, 1);
  drawGeometry(buffers.mountainRight, mat3Translation(VALLEY_X, VALLEY_Y), COLORS.mountain, 1);

  drawRect(0, 0, VALLEY_X, GROUND_Y, COLORS.ground, 1);
  drawRect(VALLEY_X, 0, CONFIG.worldWidth - VALLEY_X, GROUND_Y, COLORS.ground, 1);

  drawGeometry(buffers.road, mat3Translation(VALLEY_X, VALLEY_Y), COLORS.road, 1);

  drawRect(TREE.x - 5, TREE.groundY, 10, 46, COLORS.trunk);
  drawCircle(TREE.x, TREE.groundY + 62, 25, COLORS.canopy);
  drawCircle(TREE.x - 16, TREE.groundY + 50, 16, COLORS.canopy);
  drawCircle(TREE.x + 16, TREE.groundY + 50, 16, COLORS.canopy);

  drawRect(HOUSE.x, HOUSE.y, HOUSE.w, HOUSE.h, COLORS.houseWall);
  drawGeometry(buffers.roof, mat3Translation(HOUSE.x + HOUSE.w / 2, HOUSE.y + HOUSE.h), COLORS.roof);

  const windowColor = lerpColor(COLORS.windowDay, COLORS.windowNight, state.nightAmount);
  const winW = 14, winH = 16;
  const winY = HOUSE.y + HOUSE.h * 0.55;
  const doorW = 22, doorH = 30;
  drawRect(HOUSE.x + 14, winY, winW, winH, windowColor);
  drawRect(HOUSE.x + HOUSE.w / 2 - winW / 2, winY, winW, winH, windowColor);
  drawRect(HOUSE.x + HOUSE.w - 14 - winW, winY, winW, winH, windowColor);
  drawRect(HOUSE.x + HOUSE.w / 2 - doorW / 2, HOUSE.y, doorW, doorH, COLORS.door);

  for (const g of GRASS_MARKS) {
    drawStroke(g.x, g.y, degToRad(55), 16 * g.scale, 3, COLORS.grass);
    drawStroke(g.x, g.y, degToRad(125), 16 * g.scale, 3, COLORS.grass);
  }

  for (const b of BIRDS) {
    const bx = b.x + b.driftX;
    const by = b.y;
    drawStroke(bx - b.size * 0.5, by, 0, b.size, 2, COLORS.bird);
    drawStroke(bx, by, Math.PI - (0.5 + b.flapAngle), b.size * 0.8, 2, COLORS.bird);
    drawStroke(bx, by, 0.5 + b.flapAngle, b.size * 0.8, 2, COLORS.bird);
  }

  drawRect(0, 0, CONFIG.worldWidth, CONFIG.worldHeight, [0.02, 0.03, 0.10], state.nightAmount * 0.12);
}

// --- Render loop ---------------------------------------------------------------
let lastTimestamp = null;

function render(nowMs) {
  const nowSeconds = nowMs * 0.001;
  if (lastTimestamp === null) lastTimestamp = nowSeconds;
  const dt = nowSeconds - lastTimestamp;
  lastTimestamp = nowSeconds;

  if (!state.paused) {
    state.elapsed += dt;
  }

  updateAnimation(state.elapsed);
  updateLighting();
  drawScene();

  statusEl.textContent = state.timeLabel;
  timeReadout.textContent = `t = ${state.elapsed.toFixed(1)}s`;
  lightReadout.textContent = `light = ${state.lightIntensity.toFixed(2)}`;

  requestAnimationFrame(render);
}

// --- UI controls -----------------------------------------------------------------
function togglePause() {
  state.paused = !state.paused;
  pauseButton.textContent = state.paused ? 'Resume' : 'Pause';
}

function resetScene() {
  state.elapsed = 0;
  lastTimestamp = null;
  state.paused = false;
  pauseButton.textContent = 'Pause';
}

pauseButton.addEventListener('click', togglePause);
resetButton.addEventListener('click', resetScene);

window.addEventListener('keydown', (event) => {
  if (event.code === 'Space') {
    event.preventDefault();
    togglePause();
  } else if (event.code === 'KeyR') {
    resetScene();
  }
});

// --- Init ---------------------------------------------------------------------
function resizeCanvasToDisplaySize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}
window.addEventListener('resize', resizeCanvasToDisplaySize);
resizeCanvasToDisplaySize();

requestAnimationFrame(render);
