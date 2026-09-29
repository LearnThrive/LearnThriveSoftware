/**
 * plan12.md task 4, step 2: a lightweight raw-WebGL interactive gradient for the hero — LearnThrive
 * navy/green/mint, not a generic purple AI gradient. Plain TypeScript, not a React component or
 * hook: React never touches the render loop (pointer state, GL resources and the frame itself all
 * live outside it), matching plan11's own "pointer state outside React" precedent
 * (PointerDepth.tsx's MotionValues, never useState) and this task's explicit rule.
 *
 * Demand rendering only, per the plan's own preference: there is no `requestAnimationFrame` loop
 * here at all. A frame is drawn once on creation and again only when `setPointer` or `resize` is
 * called — the shader's time uniform advances to "now" on each of those calls, so the gradient
 * still visibly drifts as the visitor moves the pointer, without a single continuous loop to
 * suspend offscreen or on a hidden tab (the caller still gates *attaching the pointermove
 * listener* on scene activity, so there is nothing running at all when the hero is off screen).
 *
 * One shader program, one buffer, one set of uniform locations — created once in
 * `createHeroGradient` and reused for the handle's lifetime; nothing is allocated per frame.
 */
export interface HeroGradientHandle {
  /** Normalized pointer position, 0..1 in each axis. Triggers one redraw. */
  setPointer(x: number, y: number): void;
  /** Call after a canvas resize. Triggers one redraw. */
  resize(widthPx: number, heightPx: number, dpr: number): void;
  /** Releases the GL context and its resources. Safe to call once; further calls no-op. */
  dispose(): void;
}

const VERTEX_SRC = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

// A soft, organic blend across the brand's three tones. `u_pointer` warps the blend toward the
// cursor; `u_time` (advanced only on a redraw, never per-frame) gives it a slow, non-repeating
// drift rather than a static look. No texture, no loop, no postprocessing — a handful of sines.
const FRAGMENT_SRC = `
precision mediump float;
uniform vec2 u_resolution;
uniform vec2 u_pointer;
uniform float u_time;

const vec3 NAVY = vec3(0.0549, 0.1647, 0.2784);
const vec3 GREEN = vec3(0.0275, 0.3725, 0.3882);
const vec3 MINT = vec3(0.8118, 0.9294, 0.8667);

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 aspectUv = vec2(uv.x, uv.y * (u_resolution.y / u_resolution.x));
  vec2 pointer = vec2(u_pointer.x, u_pointer.y * (u_resolution.y / u_resolution.x));

  float d = distance(aspectUv, pointer);
  float wave = sin(uv.x * 3.1 + u_time * 0.06) * 0.14 + sin(uv.y * 2.3 - u_time * 0.04) * 0.10;
  float t = clamp(uv.y + wave - d * 0.35, 0.0, 1.0);

  vec3 color = mix(NAVY, GREEN, t);
  color = mix(color, MINT, smoothstep(0.72, 1.0, t) * 0.22);

  gl_FragColor = vec4(color, 1.0);
}
`;

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function createHeroGradient(canvas: HTMLCanvasElement): HeroGradientHandle | null {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
  });
  if (!gl) return null;

  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
  if (!vertexShader || !fragmentShader) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    return null;
  }
  gl.useProgram(program);

  // One full-screen triangle (cheaper than two triangles for a full-viewport quad), one buffer,
  // never re-created.
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const positionLoc = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(positionLoc);
  gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

  const resolutionLoc = gl.getUniformLocation(program, "u_resolution");
  const pointerLoc = gl.getUniformLocation(program, "u_pointer");
  const timeLoc = gl.getUniformLocation(program, "u_time");

  const startedAt = performance.now();
  let pointerX = 0.5;
  let pointerY = 0.35;
  let disposed = false;

  function draw() {
    if (disposed) return;
    gl!.uniform1f(timeLoc, (performance.now() - startedAt) / 1000);
    gl!.uniform2f(pointerLoc, pointerX, pointerY);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
  }

  draw();

  return {
    setPointer(x, y) {
      if (disposed) return;
      pointerX = x;
      pointerY = y;
      draw();
    },
    resize(widthPx, heightPx, dpr) {
      if (disposed) return;
      const w = Math.round(widthPx * dpr);
      const h = Math.round(heightPx * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl!.viewport(0, 0, w, h);
      gl!.uniform2f(resolutionLoc, w, h);
      draw();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      gl!.deleteProgram(program);
      gl!.deleteShader(vertexShader);
      gl!.deleteShader(fragmentShader);
      gl!.deleteBuffer(positionBuffer);
      gl!.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
