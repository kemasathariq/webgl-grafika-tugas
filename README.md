# Tugas 1 Grafika Komputer — Duplikasi Gambar Ilustrasi Anak-anak dengan Animasi

A pure WebGL (no libraries) reproduction of the supplied children's-illustration
reference: a valley sunrise between two mountains, a road, fields, a house with
a tree, and three birds — rendered entirely from procedural triangles, with a
looping day/night animation cycle.

## Project overview

Every visible shape (sky, mountains, sun, road, fields, house, tree, birds,
grass marks, moon, stars) is built from raw WebGL primitives (`gl.TRIANGLES`)
using hand-written 2D matrix math — no Canvas 2D, no SVG, no graphics
libraries. The reference photo is shown only as a side-by-side `<img>` for
comparison; it is never drawn into the canvas.

> **Reference image note:** `assets/reference.png` has already been extracted
> from the supplied assignment document (`Tugas_Grafika_Komputer_Duplikasi_Gambar_Animasi.docx`)
> and placed in this project. If you ever need to replace it, just overwrite
> `assets/reference.png` with the original illustration.

## How to run

No build step is required. From this folder, start any static file server, e.g.:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/index.html` in a browser that supports WebGL.

## Project structure

```text
webgl-grafika-tugas/
├── index.html        # page shell, canvas, reference panel, controls
├── README.md
├── assets/
│   └── reference.png  # comparison image only, never rendered into the scene
├── css/
│   └── style.css      # layout/theming, no canvas 2D or SVG
└── src/
    ├── main.js         # scene, animation, lighting, render loop, UI
    ├── math.js          # 3x3 matrix + scalar utilities
    └── shaders.js       # vertex/fragment GLSL source strings
```

## How the scene was decomposed into primitives

`src/main.js` §4 defines generic procedural helpers — `createTriangle`,
`createQuad`, `createLine`, `createPolygon` (fan-triangulated), `createCircle`
(triangle fan), and `createArc` (pie-wedge fan) — and uses them to build a
small set of **reusable unit geometries** uploaded once to GPU buffers:

- `unitQuad` — bottom-left-anchored 1×1 quad, reused for the sky, fields,
  house body, windows, door, and tree trunk.
- `unitStroke` — a left-anchored, vertically-centered 1×1 quad, reused for
  sun rays, the roof ridge line, grass V-marks, and bird body/wings.
- `unitCircle` — radius-1 triangle fan, reused for the sun, moon, tree
  canopy lobes, and stars.
- `unitGlow` — a full-circle wedge fan, used for the soft sun halo.

Each instance is placed by its own **model matrix** (translation × rotation ×
scale), so one buffer can represent many on-screen objects (three birds, ~20
grass marks, three tree-canopy lobes, sun and moon both from `unitCircle`,
etc.) — geometry stays static; only matrices change per draw call.

One-off silhouettes are built once in local coordinates anchored at a
meaningful pivot and placed with a single translation: the left/right
mountains and the house roof use `createTriangle` (flat, plain 2D gable —
no ridge line or outline), both mountains anchored at the shared valley
notch which sits exactly on the ground line so the base stays flush with
the field (no floating gap), and the road trapezoid uses `createPolygon`
(4 points, fan-triangulated). `createLine` builds the reusable unit stroke
geometry itself (see below).

## Where translation, rotation, and scaling are used

All object placement goes through `buildModel(tx, ty, rot, sx, sy)` in
`src/main.js` §8, which composes `modelMatrix = T * R * S` via
`mat3MultiplyMany` from `src/math.js`.

- **Translation:** sun position, moon position, bird drift, mountain/road/roof
  placement relative to the valley notch, house/tree placement.
- **Rotation:** the 8 sun rays rotate slowly as a group (`state.rayAngle`,
  §9–10); each bird's two wings rotate oppositely around the bird center to
  flap (`bird.flapAngle`); grass V-marks are two rotated strokes per tuft.
- **Scaling:** every quad/circle/stroke uses scale for its width/height,
  radius, or stroke length/thickness; the white mountain "accent" silhouette
  is the same mountain geometry drawn at 1.05× scale, offset outward from the
  brown fill to read as a soft edge highlight.

## Coordinate system, homogeneous coordinates, and the projection matrix

The world uses a fixed logical resolution of 900×580 world units (`CONFIG.worldWidth/worldHeight`).
Every vertex is a 2D point `(x, y)` implicitly treated as homogeneous
`(x, y, 1)`. `src/math.js` implements 3×3 matrices in row-major arrays and
documents the column-vector convention explicitly:

```text
clipPosition = projectionMatrix * modelMatrix * vec3(localPosition, 1.0)
```

`ortho2D(0, 900, 0, 580)` builds the shared `u_projection` matrix, mapping the
900×580 world box to clip space `[-1, 1]²`. Because WebGL1's
`uniformMatrix3fv` forbids `transpose = true`, matrices are transposed to
column-major (`toColumnMajor`) right before upload, keeping the row-major
convention in `math.js` intact for readability.

## Sun and moon animation

Both bodies travel along a smooth arc anchored at the valley notch
(`VALLEY_X, VALLEY_Y`), driven by one continuous phase `thetaFull` that sweeps
`0 → 2π` once per `CONFIG.cycleDuration` seconds (default 26s):

```js
sunX = VALLEY_X + sunOrbitRadiusX * (1 - cos(thetaFull))
sunY = VALLEY_Y + sunOrbitRadiusY * sin(thetaFull)
sunElevation = clamp(sin(thetaFull), 0, 1)      // > 0 during the day half
```

The moon reuses the same shape with a half-cycle phase offset
(`moonTheta = thetaFull - π`), traveling from where the sun set back to the
valley, so the day → night → day loop has no visual jump. At `thetaFull = 0`
(the reset state) the sun sits exactly at the valley notch, mostly hidden
behind the mountains — matching the reference's sunrise pose before any
animation has played.

## How lighting responds to sun/moon elevation

`updateLighting()` (§11) derives a single `u_lightIntensity` uniform:

```js
dayFactor   = smoothstep(0, 0.4, sunElevation)
nightFactor = smoothstep(0, 0.3, moonElevation)
intensity   = lerp(0.24, 1.0, dayFactor) + nightFactor * 0.08
```

This gives ≈1.0 at full day, ≈0.45–0.6 during sunrise/sunset (mid-range
elevation), and ≈0.22–0.32 at night with a small moonlit boost. The fragment
shader (`src/shaders.js`) multiplies every object's base color by this
intensity and blends in a cool `u_nightTint` proportional to darkness. The
sky color itself is separately interpolated (day cyan ↔ night navy) in JS
using the same `dayFactor`, and house windows lerp from a neutral day tint to
a warm glow at night.

## Bird wing animation

Each bird (`BIRDS` array) has its own flap phase and drift phase. Every frame,
`updateAnimation()` computes:

```js
flapAngle = sin(elapsed * birdFlapSpeed + bird.phase) * birdFlapAmplitude
driftX    = sin(elapsed * birdDriftSpeed + bird.driftPhase) * birdDriftAmplitude
```

Two `unitStroke` instances (the wings) are drawn from the bird's center,
rotated by `±(0.5 rad + flapAngle)`, so they open and close like a shallow
"V" as `flapAngle` oscillates. `driftX` is added to the bird's translation
only, giving a very small horizontal sway. Different phases per bird keep the
three birds out of sync, as required.

## Where to change animation speed and object sizes

All of the above is exposed in the `CONFIG` object at the top of
`src/main.js`:

```js
const CONFIG = {
  cycleDuration, sunOrbitRadiusX/Y, sunSize, sunRayCount, sunRaySpeed,
  moonOrbitRadiusX/Y, moonSize,
  birdFlapAmplitude, birdFlapSpeed, birdDriftAmplitude, birdDriftSpeed,
  starCount,
};
```

## Demo challenges

1. **Change the sun's speed:** edit `CONFIG.cycleDuration` (smaller = faster
   day/night cycle) and reload — the whole lighting/sky transition follows
   automatically since it's all derived from the same phase.
2. **Change bird flap amplitude:** edit `CONFIG.birdFlapAmplitude` (radians)
   or `CONFIG.birdDriftAmplitude` (world units) to make the wing flap or the
   horizontal sway larger/smaller.

## WebGL pipeline summary

1. One vertex shader + one fragment shader (`src/shaders.js`) are compiled
   and linked into a single `program`, used for every draw call.
2. A handful of static geometry buffers are created once (`src/main.js` §5).
3. Each frame: `requestAnimationFrame` calls `render(now)`, which advances
   `state.elapsed` by real delta time, recomputes sun/moon/bird state
   (`updateAnimation`), derives lighting (`updateLighting`), then issues all
   draw calls in a fixed back-to-front layering order (`drawScene`) — binding
   the relevant buffer, setting `u_model`/`u_color` uniforms, and calling
   `gl.drawArrays(gl.TRIANGLES, ...)` for each instance.
4. Controls: on-screen `Pause/Resume` and `Reset` buttons, plus `Space` and
   `R` keyboard shortcuts, toggle `state.paused` / reset `state.elapsed`.

## Verification performed

- All three JS modules pass `node --check` (syntax validation).
- The project was served with `python3 -m http.server` and every referenced
  file (`index.html`, `src/main.js`, `css/style.css`, `assets/reference.png`)
  was confirmed reachable over HTTP (200 responses).
- The matrix pipeline, layering order, and animation formulas were manually
  traced through by hand (including the WebGL1 `uniformMatrix3fv`
  transpose restriction, which required converting the row-major matrices to
  column-major before upload).

**Not verified:** actual pixel-level rendering in a real browser — no
headless/graphical browser was available in this environment to capture a
screenshot or run the WebGL context live. Please do a quick visual check
(`python3 -m http.server` + open in a browser) before the demo.
