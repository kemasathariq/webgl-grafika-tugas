// =====================================================================
//  script.js
//  Menggambar pemandangan dengan bentuk primitif WebGL:
//  kotak, segitiga, lingkaran, setengah lingkaran, dan garis.
//  Animasi: burung mengepakkan sayap, rumput melambai, sinar matahari
//  berputar.
//  Kontrol: panah kiri/kanan = gerakkan burung, panah atas/bawah =
//  perbesar/perkecil matahari (bulan), W = ganti siang/malam.
//  Butuh: shader.js (shader + program) dan matrix.js (matriks 3x3).
// =====================================================================

const WIDTH = 800;
const HEIGHT = 527;
const SCALE = 0.75; 

 
//  Setup canvas & WebGL
const canvas = document.getElementById("glCanvas");
const dpr = window.devicePixelRatio || 1;
canvas.width = Math.round(WIDTH * SCALE * dpr);   // resolusi asli (tajam di layar HiDPI)
canvas.height = Math.round(HEIGHT * SCALE * dpr);
canvas.style.width = WIDTH * SCALE + "px";
canvas.style.height = HEIGHT * SCALE + "px";

const gl = canvas.getContext("webgl2", { antialias: true });
if (!gl) {
  alert("WebGL2 tidak tersedia pada browser/perangkat ini.");
  throw new Error("WebGL2 tidak tersedia.");
}

const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
const program = createProgram(gl, vertexShader, fragmentShader);

const aPosition = gl.getAttribLocation(program, "a_position");
const uMatrix = gl.getUniformLocation(program, "u_matrix");
const uColor = gl.getUniformLocation(program, "u_color");

// Matriks proyeksi: koordinat piksel 800 x 527 -> clip space
const projection = m3.projection(WIDTH, HEIGHT);

 
//  Geometri primitif (dibuat sekali dalam ukuran "unit")
 
function createShape(vertices, mode) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  return { buffer, mode, count: vertices.length / 2 };
}

function circleVertices(segments, startAngle, endAngle) {
  const v = [0, 0]; // titik pusat (untuk TRIANGLE_FAN)
  for (let i = 0; i <= segments; i++) {
    const a = startAngle + (endAngle - startAngle) * (i / segments);
    v.push(Math.cos(a), Math.sin(a));
  }
  return v;
}

const shapes = {
  // Kotak 1x1, pojok kiri atas di (0,0)
  square: createShape([
    0, 0, 1, 0, 0, 1,
    0, 1, 1, 0, 1, 1,
  ], gl.TRIANGLES),

  // Segitiga sama kaki 1x1, puncak di tengah atas
  triangle: createShape([
    0.5, 0,
    0, 1,
    1, 1,
  ], gl.TRIANGLES),

  // Lingkaran radius 1, pusat di (0,0)
  circle: createShape(circleVertices(48, 0, Math.PI * 2), gl.TRIANGLE_FAN),

  // Setengah lingkaran bagian atas
  halfCircle: createShape(circleVertices(32, Math.PI, Math.PI * 2), gl.TRIANGLE_FAN),

  // Garis: kotak panjang 1, tebal 1, sumbunya di y = 0
  line: createShape([
    0, -0.5, 1, -0.5, 0, 0.5,
    0, 0.5, 1, -0.5, 1, 0.5,
  ], gl.TRIANGLES),
};

// Buffer khusus untuk segitiga dengan 3 titik bebas
const freeTriangleBuffer = gl.createBuffer();

//  Fungsi gambar
function hexToRgba(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, 1];
}

// Campuran dua warna hex: t = 0 -> hexA, t = 1 -> hexB
function mixColor(hexA, hexB, t) {
  const a = parseInt(hexA.slice(1), 16);
  const b = parseInt(hexB.slice(1), 16);
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const ca = (a >> shift) & 255;
    const cb = (b >> shift) & 255;
    out |= Math.round(ca + (cb - ca) * t) << shift;
  }
  return "#" + out.toString(16).padStart(6, "0");
}

function drawShape(shape, matrix, color) {
  gl.bindBuffer(gl.ARRAY_BUFFER, shape.buffer);
  gl.enableVertexAttribArray(aPosition);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

  gl.uniformMatrix3fv(uMatrix, false, m3.multiply(projection, matrix));
  gl.uniform4fv(uColor, hexToRgba(color));

  gl.drawArrays(shape.mode, 0, shape.count);
}

// Kotak: posisi (x, y) = pojok kiri atas
function drawRect(x, y, w, h, color, angle = 0) {
  let m = m3.translation(x, y);
  m = m3.rotate(m, angle);
  m = m3.scale(m, w, h);
  drawShape(shapes.square, m, color);
}

// Segitiga sama kaki: (x, y) = pojok kiri atas kotak pembungkusnya
function drawTriangle(x, y, w, h, color) {
  let m = m3.translation(x, y);
  m = m3.scale(m, w, h);
  drawShape(shapes.triangle, m, color);
}

// Segitiga dengan 3 titik bebas (untuk gunung, jalan, sisi atap)
function drawTrianglePoints(p1, p2, p3, color) {
  const shape = { buffer: freeTriangleBuffer, mode: gl.TRIANGLES, count: 3 };
  gl.bindBuffer(gl.ARRAY_BUFFER, freeTriangleBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([...p1, ...p2, ...p3]), gl.DYNAMIC_DRAW);
  drawShape(shape, m3.identity(), color);
}

function drawCircle(cx, cy, r, color) {
  let m = m3.translation(cx, cy);
  m = m3.scale(m, r, r);
  drawShape(shapes.circle, m, color);
}

function drawHalfCircle(cx, cy, r, color) {
  let m = m3.translation(cx, cy);
  m = m3.scale(m, r, r);
  drawShape(shapes.halfCircle, m, color);
}

// Garis tebal = kotak yang diputar sesuai arah garis
// (dipakai untuk objek berbentuk garis: sinar matahari, burung, rumput, marka jalan)
function drawLine(x1, y1, x2, y2, thickness = 4, color = COLOR.ink) {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const angle = Math.atan2(y2 - y1, x2 - x1);

  let m = m3.translation(x1, y1);
  m = m3.rotate(m, angle);
  m = m3.scale(m, length, thickness);
  drawShape(shapes.line, m, color);

  // ujung garis dibulatkan dengan lingkaran kecil
  drawCircle(x1, y1, thickness / 2, color);
  drawCircle(x2, y2, thickness / 2, color);
}

 
//  Warna
 
const COLOR = {
  paper:     "#f7f6f3",
  sky:       "#b0e6fa",
  skyNight:  "#3a4d7a",
  sun:       "#ffd60a",
  moon:      "#f4f1c9",
  star:      "#fffbe6",
  mountain:  "#7c685e",
  grass:     "#cfeaac",
  road:      "#bfd3c9",
  roofFront: "#e93a3e",
  roofSide:  "#c92f33",
  wallFront: "#ffffff",
  wallSide:  "#ececec",
  window:    "#ffe58f",
  leaf:      "#32c832",
  trunk:     "#16582a",
  ink:       "#1a1a1a",
};

 
//  Objek-objek pemandangan
 
function drawSky() {
  drawRect(10, 8, 780, 212, isNight ? COLOR.skyNight : COLOR.sky);
}

// Sawah langsung menempel di kaki gunung (y = 220), tanpa jarak
function drawGround() {
  drawRect(10, 220, 780, 297, COLOR.grass);
}

// Sinar matahari: 16 sinar mengelilingi pusat matahari dan diputar
// sebesar sunAngle. Sinar yang mengarah ke bawah tertutup tanah & gunung
// (digambar setelahnya), jadi yang terlihat hanya sinar di bagian atas.
// Ukuran matahari & sinar = uniform scaling (sunScale) dengan pivot di pusat.
function drawSun() {
  const cx = 358, cy = 220, r = 68;
  drawHalfCircle(cx, cy, r * sunScale, COLOR.sun);

  const r1 = r + 22, r2 = r + 52;
  for (let deg = 0; deg < 360; deg += 22.5) {
    // pivot = pusat matahari: T(pusat) x S(skala) x R(sudut)
    let m = m3.translation(cx, cy);
    m = m3.scale(m, sunScale, sunScale);
    m = m3.rotate(m, degToRad(deg) + sunAngle);

    const [x1, y1] = m3.transformPoint(m, r1, 0);
    const [x2, y2] = m3.transformPoint(m, r2, 0);
    drawLine(x1, y1, x2, y2, 4, COLOR.sun);
  }
}

// Bintang = tanda "+" kecil dengan titik di tengah.
// Kelap-kelip: ukuran (uniform scaling) dan kecerahan warna naik-turun
// mengikuti sin(waktu); fase tiap bintang berbeda agar tidak serempak.
function drawStars(seconds) {
  const stars = [
    [60, 40, 5], [120, 90, 4], [170, 30, 6], [230, 20, 4], [260, 55, 4],
    [300, 20, 5], [400, 70, 4], [420, 40, 4], [470, 75, 6], [520, 55, 4],
    [560, 30, 4], [610, 110, 5], [650, 20, 4], [700, 35, 5], [760, 80, 4],
    [770, 170, 5], [40, 150, 4],
  ];
  stars.forEach(([x, y, size], i) => {
    const twinkle = 0.5 + 0.5 * Math.sin(seconds * 3 + i * 1.7);
    const s = size * (0.4 + 0.6 * twinkle);
    const color = mixColor(COLOR.skyNight, COLOR.star, 0.3 + 0.7 * twinkle);

    drawLine(x - s, y, x + s, y, 1.5, color);
    drawLine(x, y - s, x, y + s, 1.5, color);
    drawCircle(x, y, s * 0.35, color);
  });
}

// Bulan sabit = lingkaran bulan yang sebagian ditutup lingkaran warna langit
function drawMoon() {
  const cx = 358, cy = 150, r = 40 * sunScale;
  drawCircle(cx, cy, r, COLOR.moon);
  drawCircle(cx + r * 0.4, cy - r * 0.25, r * 0.85, COLOR.skyNight);
}

// Burung = huruf "V" yang ujung bawahnya menempel di garis "_"
// (x, y) = ujung bawah "V", wing = panjang tiap sisi "V"
// flap = 0..1 (1 = sayap terangkat membentuk "V", 0 = sayap datar "_")
function drawBird(x, y, wing, flap) {
  const maxAngle = degToRad(60);
  const a = maxAngle * flap;

  // sayap berputar terhadap pivot di ujung bawah "V"
  const left = m3.rotate(m3.translation(x, y), a);
  const right = m3.rotate(m3.translation(x, y), -a);
  const [lx, ly] = m3.transformPoint(left, -wing, 0);
  const [rx, ry] = m3.transformPoint(right, wing, 0);

  drawLine(lx, ly, x, y, 3.5);  // sayap kiri
  drawLine(x, y, rx, ry, 3.5);  // sayap kanan

  // garis "_" lebih pendek dari sisi "V"
  const body = wing * 0.35;
  drawLine(x - body, y, x + body, y, 3.5);
}

function drawBirds(seconds) {
  const birds = [
    [645, 68, 0.0],
    [718, 126, 1.3],  // fase berbeda agar kepakannya tidak serempak
  ];
  for (const [x, y, phase] of birds) {
    const flap = 0.5 + 0.5 * Math.sin(seconds * 6 + phase);
    drawBird(x + birdOffsetX, y, 30, flap);
  }
}

function drawMountains() {
  const left = { base1: [25, 220], peak: [208, 95], base2: [358, 220] };
  const right = { base1: [358, 220], peak: [530, 90], base2: [745, 220] };

  for (const m of [left, right]) {
    drawTrianglePoints(m.base1, m.peak, m.base2, COLOR.mountain);
  }
}

function drawRoad() {
  const top = [357, 220];
  const bottomLeft = [495, 517];
  const bottomRight = [615, 517];

  drawTrianglePoints(top, bottomLeft, bottomRight, COLOR.road);

  // marka jalan putus-putus di tengah
  const bottomMid = [555, 517];
  for (let t = 0.1; t < 0.95; t += 0.14) {
    const t2 = t + 0.06;
    drawLine(
      top[0] + (bottomMid[0] - top[0]) * t, top[1] + (bottomMid[1] - top[1]) * t,
      top[0] + (bottomMid[0] - top[0]) * t2, top[1] + (bottomMid[1] - top[1]) * t2,
      3
    );
  }
}

function drawGrass(seconds) {
  const spots = [
    [630, 265], [686, 290], [739, 305], [626, 318], [573, 306], [489, 283],
    [709, 344], [648, 367], [542, 344], [717, 409], [664, 412], [588, 394],
    [618, 447], [679, 473],
  ];
  // rumput = dua garis kecil membentuk "v", melambai kiri-kanan
  // dengan pivot di pangkalnya (x, y)
  for (const [x, y] of spots) {
    const sway = degToRad(12) * Math.sin(seconds * 2.5 + x * 0.03);
    const m = m3.rotate(m3.translation(x, y), sway);

    const [ax, ay] = m3.transformPoint(m, 5, -9);
    const [bx, by] = m3.transformPoint(m, -13, -12);
    drawLine(ax, ay, x, y, 3);
    drawLine(x, y, bx, by, 3);
  }
}

function drawHouse() {
  // dinding samping (kiri) & depan (kanan)
  drawRect(172, 380, 106, 66, COLOR.wallSide);
  drawRect(278, 380, 90, 66, COLOR.wallFront);

  // atap samping (jajargenjang = 2 segitiga) & atap depan (segitiga)
  drawTrianglePoints([323, 300], [210, 300], [266, 380], COLOR.roofSide);
  drawTrianglePoints([210, 300], [160, 380], [266, 380], COLOR.roofSide);
  drawTriangle(266, 300, 114, 80, COLOR.roofFront);

  // jendela samping, jendela depan & pintu (kotak)
  const windows = [
    [181, 394, 17, 26],
    [211, 394, 17, 26],
    [241, 394, 17, 26],
    [302, 398, 16, 24],
    [331, 398, 20, 44], // pintu
  ];
  for (const [x, y, w, h] of windows) {
    drawRect(x, y, w, h, COLOR.window);
  }
}

function drawTree() {
  // daun = beberapa lingkaran yang ditumpuk
  const leaves = [
    [110, 312, 40],
    [142, 320, 26],
    [78, 320, 26],
    [110, 278, 28],
    [132, 290, 22],
    [88, 290, 22],
  ];
  for (const [x, y, r] of leaves) drawCircle(x, y, r, COLOR.leaf);

  // batang = kotak
  drawRect(100, 325, 18, 115, COLOR.trunk);
}

 
//  State animasi & kontrol
 
let sunAngle = 0;                        // radian
const sunRotationSpeed = degToRad(20);   // 20 derajat per detik

let birdOffsetX = 0;       // pergeseran burung (piksel)
const birdSpeed = 150;     // piksel per detik

let sunScale = 1;          // skala matahari / bulan
const sunScaleSpeed = 0.8; // per detik

let isNight = false;

 
//  Input keyboard
//  State-based : panah (aksi kontinu selama tombol ditekan)
//  Event-based : W (aksi sekali tekan / toggle)
 
const keys = {};

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  keys[key] = true;

  if (key.startsWith("arrow")) {
    event.preventDefault(); // agar halaman tidak ikut scroll
  }

  if (key === "w" && !event.repeat) {
    isNight = !isNight;
  }
});

window.addEventListener("keyup", (event) => {
  keys[event.key.toLowerCase()] = false;
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function handleInput(dt) {
  if (keys["arrowleft"])  birdOffsetX -= birdSpeed * dt;
  if (keys["arrowright"]) birdOffsetX += birdSpeed * dt;
  if (keys["arrowup"])    sunScale += sunScaleSpeed * dt;
  if (keys["arrowdown"])  sunScale -= sunScaleSpeed * dt;

  // burung tetap di dalam area langit, ukuran matahari dibatasi
  birdOffsetX = clamp(birdOffsetX, -600, 37);
  sunScale = clamp(sunScale, 0.5, 1.5);
}

function update(dt) {
  handleInput(dt);
  sunAngle += sunRotationSpeed * dt;
}

 
//  Draw (urutan = lapisan, yang digambar belakangan ada di depan)
 
function drawScene(seconds) {
  gl.viewport(0, 0, canvas.width, canvas.height);

  const bg = hexToRgba(COLOR.paper);
  gl.clearColor(bg[0], bg[1], bg[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(program);

  drawSky();
  if (isNight) {
    drawStars(seconds);
    drawMoon();
  } else {
    drawSun();
  }
  drawGround();
  drawMountains();
  drawBirds(seconds);  // di depan gunung agar tetap terlihat saat digeser
  drawRoad();
  drawGrass(seconds);
  drawHouse();
  drawTree();
}

 
//  Rendering loop
 
let lastTime = 0;

function render(time) {
  const seconds = time * 0.001;
  const dt = Math.min((time - lastTime) * 0.001, 0.05);
  lastTime = time;

  update(dt);
  drawScene(seconds);

  requestAnimationFrame(render);
}

requestAnimationFrame(render);