// GLSL ES 1.00 shader sources, shared by every object; appearance is
// controlled entirely through uniforms (u_model, u_color, u_lightIntensity).

export const VERTEX_SHADER_SOURCE = `
  attribute vec2 a_position;
  uniform mat3 u_model;
  uniform mat3 u_projection;

  void main() {
    vec3 world = u_model * vec3(a_position, 1.0);
    vec3 clip = u_projection * world;
    gl_Position = vec4(clip.xy, 0.0, 1.0);
  }
`;

export const FRAGMENT_SHADER_SOURCE = `
  precision mediump float;

  uniform vec4 u_color;
  uniform float u_lightIntensity;
  uniform vec3 u_nightTint;

  void main() {
    vec3 lit = u_color.rgb * u_lightIntensity;
    // Blend in a cool tint as intensity drops, so shadows read as
    // "night blue" instead of just dim.
    float nightAmount = 1.0 - clamp(u_lightIntensity, 0.0, 1.0);
    vec3 finalColor = mix(lit, u_nightTint, nightAmount * 0.28);
    gl_FragColor = vec4(finalColor, u_color.a);
  }
`;
