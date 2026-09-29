// =====================================================================
//  shader.js
//  Berisi source vertex shader & fragment shader, serta fungsi
//  untuk meng-compile dan me-link program WebGL.
// =====================================================================

// Vertex shader: setiap titik (local coordinate) diubah ke homogeneous
// coordinate (x, y, 1) lalu dikalikan matriks 3x3
// (projection * translation * rotation * scale)
const vertexShaderSource = `#version 300 es

in vec2 a_position;
uniform mat3 u_matrix;

void main() {
  vec3 position = u_matrix * vec3(a_position, 1.0);
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Fragment shader: warna dikirim sebagai uniform
// (satu objek = satu warna untuk satu draw call)
const fragmentShaderSource = `#version 300 es

precision highp float;

uniform vec4 u_color;
out vec4 outColor;

void main() {
  outColor = u_color;
}
`;

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error("Shader gagal dikompilasi:\n" + info);
  }
  return shader;
}

function createProgram(gl, vertexShader, fragmentShader) {
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error("Program gagal di-link:\n" + info);
  }
  return program;
}
