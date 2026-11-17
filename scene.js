import { createBottleGeometry, createSceneGeometry } from "./models/bottle-model.js";

const sceneRoot = document.querySelector(".scroll-scene");
const canvas = document.querySelector("#product-canvas");
const sceneStatus = document.querySelector("#scene-status");
const sceneInstructions = document.querySelector("#scene-instructions");
const spinButton = document.querySelector("#spin-bottle");
const chapters = Array.from(document.querySelectorAll(".chapter"));
const chapterCounter = document.querySelector(".scene-topline span:last-child");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const TAU = Math.PI * 2;

const palette = {
  tidepool: { name: "Tidepool", body: "#62b6a8", cap: "#1d5045", trim: "#dce9dc" },
  clementine: { name: "Clementine", body: "#f18a64", cap: "#713b35", trim: "#f5c29e" },
  lichen: { name: "Lichen", body: "#a0ad70", cap: "#354a3a", trim: "#e2dcb0" }
};

if (sceneRoot && canvas) {
  let gl = null;
  let program = null;
  let locations = null;
  let bottleMeshes = null;
  let sceneMeshes = null;
  let buffers = [];
  let rafId = 0;
  let visible = true;
  let destroyed = false;
  let contextAvailable = false;
  let manualYaw = 0;
  let dragYaw = 0;
  let dragPitch = -0.035;
  let spinTween = null;
  let selectedColor = "tidepool";
  let dragging = false;
  let lastPoint = null;
  let lastStep = -1;
  let resizeObserver = null;
  let intersectionObserver = null;
  const cleanup = [];

  function listen(target, type, callback, options) {
    target.addEventListener(type, callback, options);
    cleanup.push(function () {
      target.removeEventListener(type, callback, options);
    });
  }

  function announce(message) {
    if (sceneStatus) sceneStatus.textContent = message;
  }

  function hexColor(hex) {
    const value = parseInt(hex.slice(1), 16);
    return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function translation4(x, y, z) {
    const matrix = new Float32Array(16);
    matrix[0] = 1; matrix[5] = 1; matrix[10] = 1; matrix[15] = 1;
    matrix[12] = x; matrix[13] = y; matrix[14] = z;
    return matrix;
  }

  function rotationX4(angle) {
    const c = Math.cos(angle); const s = Math.sin(angle);
    return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
  }

  function rotationY4(angle) {
    const c = Math.cos(angle); const s = Math.sin(angle);
    return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
  }

  function scale4(value) {
    const matrix = new Float32Array(16);
    matrix[0] = value; matrix[5] = value; matrix[10] = value; matrix[15] = 1;
    return matrix;
  }

  function multiply4(a, b) {
    const result = new Float32Array(16);
    for (let column = 0; column < 4; column += 1) {
      for (let row = 0; row < 4; row += 1) {
        result[column * 4 + row] =
          a[row] * b[column * 4] +
          a[4 + row] * b[column * 4 + 1] +
          a[8 + row] * b[column * 4 + 2] +
          a[12 + row] * b[column * 4 + 3];
      }
    }
    return result;
  }

  function compose(x, y, z, pitch, yaw, scale) {
    let matrix = translation4(x, y, z);
    matrix = multiply4(matrix, rotationY4(yaw));
    matrix = multiply4(matrix, rotationX4(pitch));
    return multiply4(matrix, scale4(scale));
  }

  function perspective4(fieldOfView, aspect, near, far) {
    const f = 1 / Math.tan(fieldOfView / 2);
    const range = 1 / (near - far);
    const matrix = new Float32Array(16);
    matrix[0] = f / aspect;
    matrix[5] = f;
    matrix[10] = (far + near) * range;
    matrix[11] = -1;
    matrix[14] = 2 * far * near * range;
    return matrix;
  }

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      throw new Error("shader");
    }
    return shader;
  }

  function createProgram() {
    const vertexSource = [
      "attribute vec3 aPosition;", "attribute vec3 aNormal;",
      "uniform mat4 uProjection;", "uniform mat4 uView;", "uniform mat4 uModel;",
      "varying vec3 vPosition;", "varying vec3 vNormal;",
      "void main(void) {",
      "  vec4 world = uModel * vec4(aPosition, 1.0);",
      "  vPosition = world.xyz;",
      "  vNormal = normalize(mat3(uModel) * aNormal);",
      "  gl_Position = uProjection * uView * world;",
      "}"
    ].join("\n");

    const fragmentSource = [
      "precision mediump float;", "uniform vec3 uColor;", "uniform vec3 uLight;",
      "varying vec3 vPosition;", "varying vec3 vNormal;",
      "void main(void) {",
      "  vec3 normal = normalize(vNormal);",
      "  vec3 lightDirection = normalize(uLight - vPosition);",
      "  vec3 viewDirection = normalize(vec3(0.0, 0.0, 7.0) - vPosition);",
      "  vec3 halfDirection = normalize(lightDirection + viewDirection);",
      "  float diffuse = max(dot(normal, lightDirection), 0.0);",
      "  float specular = pow(max(dot(normal, halfDirection), 0.0), 28.0) * 0.3;",
      "  float rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 2.0) * 0.16;",
      "  vec3 color = uColor * (0.38 + diffuse * 0.68) + vec3(specular + rim);",
      "  gl_FragColor = vec4(pow(max(color, 0.0), vec3(0.92)), 1.0);",
      "}"
    ].join("\n");

    const vertex = compileShader(gl.VERTEX_SHADER, vertexSource);
    const fragment = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    const linked = gl.createProgram();
    gl.attachShader(linked, vertex); gl.attachShader(linked, fragment);
    gl.linkProgram(linked);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(linked, gl.LINK_STATUS)) {
      gl.deleteProgram(linked);
      throw new Error("program");
    }
    return linked;
  }

  function uploadMesh(mesh) {
    const position = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, position);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
    buffers.push(position);

    const normal = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normal);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
    buffers.push(normal);

    let index = null;
    if (mesh.indices) {
      index = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
      buffers.push(index);
    }

    return {
      position: position,
      normal: normal,
      index: index,
      count: mesh.indices ? mesh.indices.length : mesh.count || mesh.positions.length / 3,
      mode: mesh.mode === "line-strip" ? gl.LINE_STRIP : gl.TRIANGLES
    };
  }

  function bindAttribute(buffer, location) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
  }

  function drawMesh(mesh, modelMatrix, color) {
    bindAttribute(mesh.position, locations.position);
    bindAttribute(mesh.normal, locations.normal);
    gl.uniformMatrix4fv(locations.model, false, modelMatrix);
    gl.uniform3fv(locations.color, color);
    if (mesh.index) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.index);
      gl.drawElements(mesh.mode, mesh.count, gl.UNSIGNED_SHORT, 0);
    } else {
      gl.drawArrays(mesh.mode, 0, mesh.count);
    }
  }

  function resizeCanvas() {
    if (!gl || !contextAvailable) return;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width < 1 || bounds.height < 1) return;
    const mobile = window.matchMedia("(max-width: 720px)").matches;
    const ratio = Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.5);
    const width = Math.max(1, Math.round(bounds.width * ratio));
    const height = Math.max(1, Math.round(bounds.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width; canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
  }

  function scrollState() {
    const bounds = sceneRoot.getBoundingClientRect();
    const viewport = Math.max(1, window.innerHeight);
    const maxScroll = Math.max(1, sceneRoot.offsetHeight - viewport);
    sceneRoot.classList.toggle("is-stuck", bounds.top <= 0 && bounds.bottom > window.innerHeight);
    const moved = clamp(-bounds.top, 0, maxScroll);
    const step = clamp(Math.floor(moved / viewport), 0, 2);
    const local = clamp((moved - step * viewport) / viewport, 0, 1);
    return { progress: moved / maxScroll, step: step, local: local };
  }

  function updateChapter(state) {
    if (state.step === lastStep) return;
    lastStep = state.step;
    chapters.forEach(function (chapter, index) {
      chapter.classList.toggle("is-current", index === state.step);
    });
    if (chapterCounter) chapterCounter.textContent = "0" + (state.step + 1) + " — 03";
  }

  function smooth(value) {
    return value * value * (3 - 2 * value);
  }

  function currentYaw(now) {
    if (!spinTween) return manualYaw;
    const progress = clamp((now - spinTween.start) / spinTween.duration, 0, 1);
    const value = spinTween.from + (spinTween.to - spinTween.from) * smooth(progress);
    if (progress >= 1) {
      manualYaw = spinTween.to;
      spinTween = null;
      return manualYaw;
    }
    return value;
  }

  function drawBottle(geometry, x, y, z, scale, pitch, yaw, colors) {
    const model = compose(x, y, z, pitch, yaw, scale);
    drawMesh(geometry.body, model, hexColor(colors.body));
    drawMesh(geometry.lowerTrim, model, hexColor(colors.trim));
    drawMesh(geometry.neckTrim, model, hexColor(colors.trim));
    drawMesh(geometry.cap, multiply4(model, translation4(0, 2.255, 0)), hexColor(colors.cap));
    geometry.badgeLines.forEach(function (line) {
      drawMesh(line, model, [0.95, 0.96, 0.87]);
    });
  }

  function render(now) {
    rafId = 0;
    if (destroyed || !contextAvailable || !visible || document.visibilityState !== "visible") return;

    resizeCanvas();
    const state = scrollState();
    updateChapter(state);
    const progress = reducedMotion.matches ? 0 : state.progress;
    const mobile = window.matchMedia("(max-width: 720px)").matches;
    const scrollYaw = progress * TAU * 1.14;
    const mainYaw = scrollYaw + currentYaw(now) + dragYaw;
    const bodyPitch = reducedMotion.matches ? dragPitch * 0.25 : dragPitch + Math.sin(progress * TAU) * 0.035;
    const mainX = mobile ? 0 : 0.72 + Math.sin(progress * TAU) * 0.16;
    const mainY = mobile ? -1.78 : -1.255 + Math.sin(progress * TAU * 2) * 0.035;
    const mainScale = mobile ? 0.91 : 1;

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);

    const aspect = canvas.width / Math.max(1, canvas.height);
    const projection = perspective4(mobile ? 0.67 : 0.62, aspect, 0.1, 80);
    const view = translation4(0, 0, mobile ? -7.35 : -7.0);
    gl.uniformMatrix4fv(locations.projection, false, projection);
    gl.uniformMatrix4fv(locations.view, false, view);
    gl.uniform3fv(locations.light, [2.8, 4.6, 5.8]);

    const selected = palette[selectedColor] || palette.tidepool;
    const names = Object.keys(palette);
    const selectedIndex = names.indexOf(selectedColor);
    const leftColor = palette[names[(selectedIndex + 1) % names.length]];
    const rightColor = palette[names[(selectedIndex + 2) % names.length]];

    const halo = compose(mobile ? 0 : 0.6, mobile ? -0.35 : -0.25, -1.55, 1.04, progress * TAU * 0.38, -0.16, mobile ? 0.84 : 1.08);
    drawMesh(sceneMeshes.halo, halo, [0.91, 0.75, 0.36]);

    if (mobile) {
      drawBottle(bottleMeshes, -0.84, -1.32, -1.35, 0.39, -0.04, -mainYaw * 0.54, leftColor);
      drawBottle(bottleMeshes, 0.84, -1.35, -1.55, 0.38, 0.04, mainYaw * 0.68, rightColor);
    } else {
      drawBottle(bottleMeshes, -1.42, -1.23, -1.12, 0.58, -0.025, -mainYaw * 0.48, leftColor);
      drawBottle(bottleMeshes, 2.05, -1.24, -1.5, 0.57, 0.035, mainYaw * 0.62, rightColor);
    }
    drawBottle(bottleMeshes, mainX, mainY, 0, mainScale, bodyPitch, mainYaw, selected);

    const droplets = [
      [-1.65, 1.15, -0.2, 0.075],
      [2.05, 1.22, -0.15, 0.09],
      [1.68, -1.08, 0.8, 0.065],
      [-1.92, -0.72, 0.35, 0.052]
    ];
    droplets.forEach(function (drop, index) {
      const bob = reducedMotion.matches ? 0 : Math.sin(progress * TAU + index) * 0.11;
      const model = compose(drop[0], drop[1] + bob, drop[2], progress * 0.35, progress * 0.4, drop[3]);
      drawMesh(sceneMeshes.droplets, model, index % 2 === 0 ? [0.92, 0.79, 0.47] : [0.71, 0.84, 0.75]);
    });

    if (spinTween) scheduleRender();
  }

  function scheduleRender() {
    if (rafId || destroyed || !contextAvailable || !visible || document.visibilityState !== "visible") return;
    rafId = window.requestAnimationFrame(render);
  }

  function turnBy(amount) {
    if (!contextAvailable) return;
    const now = performance.now();
    const from = currentYaw(now);
    manualYaw = from;
    if (reducedMotion.matches) {
      manualYaw += amount;
      spinTween = null;
      scheduleRender();
      return;
    }
    spinTween = { from: from, to: from + amount, start: now, duration: 720 };
    scheduleRender();
  }

  function setSelectedColor(color) {
    if (!palette[color]) return;
    selectedColor = color;
    canvas.setAttribute("aria-label", "Interactive three-dimensional view of the Rill bottle in " + palette[color].name + ". Scroll to explore, drag to rotate, or use the arrow keys.");
    scheduleRender();
  }

  function onColorChange(event) {
    setSelectedColor(event.detail && event.detail.color);
  }

  function onScroll() {
    const state = scrollState();
    updateChapter(state);
    scheduleRender();
  }

  function onPointerDown(event) {
    if (reducedMotion.matches || event.button !== 0) return;
    dragging = true;
    lastPoint = { x: event.clientX, y: event.clientY };
    if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!dragging || !lastPoint) return;
    const deltaX = event.clientX - lastPoint.x;
    const deltaY = event.clientY - lastPoint.y;
    lastPoint = { x: event.clientX, y: event.clientY };
    dragYaw += deltaX * 0.012;
    dragPitch = clamp(dragPitch + deltaY * 0.003, -0.28, 0.2);
    scheduleRender();
  }

  function stopDrag() {
    dragging = false;
    lastPoint = null;
  }

  function onKeyDown(event) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "ArrowLeft") turnBy(-Math.PI / 6);
    if (event.key === "ArrowRight") turnBy(Math.PI / 6);
    if (event.key === "ArrowUp") dragPitch = clamp(dragPitch - 0.08, -0.28, 0.2);
    if (event.key === "ArrowDown") dragPitch = clamp(dragPitch + 0.08, -0.28, 0.2);
    scheduleRender();
  }

  function onVisibilityChange() {
    if (document.visibilityState === "visible") scheduleRender();
  }

  function rotateFallback() {
    sceneRoot.classList.toggle("fallback-rotated");
  }

  function startFallback() {
    sceneRoot.dataset.scene = "static";
    listen(window, "scroll", onScroll, { passive: true });
    canvas.setAttribute("aria-hidden", "true");
    canvas.setAttribute("tabindex", "-1");
    if (sceneInstructions) {
      sceneInstructions.textContent = "Choose a colour below. The live 3D preview is unavailable in this browser.";
    }
    if (spinButton) spinButton.addEventListener("click", rotateFallback);
    announce("Interactive 3D is unavailable here. The product story and colour choices remain available.");
  }

  function onContextLost(event) {
    event.preventDefault();
    contextAvailable = false;
    destroyed = true;
    sceneRoot.classList.remove("scene-enhanced");
    sceneRoot.dataset.scene = "static";
    canvas.setAttribute("aria-hidden", "true");
    canvas.setAttribute("tabindex", "-1");
    if (sceneInstructions) {
      sceneInstructions.textContent = "The live 3D preview stopped. Choose a colour to see the bottle illustration.";
    }
    if (spinButton) spinButton.addEventListener("click", rotateFallback);
    announce("The live 3D preview stopped. The static bottle illustration is still available.");
  }

  try {
    gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
      preserveDrawingBuffer: false
    });
    if (!gl) throw new Error("webgl");

    program = createProgram();
    gl.useProgram(program);
    locations = {
      position: gl.getAttribLocation(program, "aPosition"),
      normal: gl.getAttribLocation(program, "aNormal"),
      projection: gl.getUniformLocation(program, "uProjection"),
      view: gl.getUniformLocation(program, "uView"),
      model: gl.getUniformLocation(program, "uModel"),
      color: gl.getUniformLocation(program, "uColor"),
      light: gl.getUniformLocation(program, "uLight")
    };

    const sourceBottle = createBottleGeometry();
    const sourceScene = createSceneGeometry();
    bottleMeshes = {
      body: uploadMesh(sourceBottle.body),
      cap: uploadMesh(sourceBottle.cap),
      lowerTrim: uploadMesh(sourceBottle.lowerTrim),
      neckTrim: uploadMesh(sourceBottle.neckTrim),
      badgeLines: sourceBottle.badgeLines.map(uploadMesh)
    };
    sceneMeshes = {
      halo: uploadMesh(sourceScene.halo),
      droplets: uploadMesh(sourceScene.droplets)
    };

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);

    contextAvailable = true;
    sceneRoot.classList.add("scene-enhanced");
    sceneRoot.dataset.scene = "ready";
    canvas.removeAttribute("aria-hidden");
    canvas.setAttribute("tabindex", "0");
    announce("Interactive 3D preview ready. Scroll to explore the bottle story.");

    listen(document, "rill:colorchange", onColorChange);
    listen(window, "scroll", onScroll, { passive: true });
    listen(window, "resize", scheduleRender, { passive: true });
    listen(document, "visibilitychange", onVisibilityChange);
    listen(canvas, "pointerdown", onPointerDown);
    listen(canvas, "pointermove", onPointerMove);
    listen(canvas, "pointerup", stopDrag);
    listen(canvas, "pointercancel", stopDrag);
    listen(canvas, "keydown", onKeyDown);
    listen(canvas, "webglcontextlost", onContextLost);
    if (spinButton) listen(spinButton, "click", function () { turnBy(reducedMotion.matches ? Math.PI : TAU); });

    if ("ResizeObserver" in window) {
      resizeObserver = new ResizeObserver(scheduleRender);
      resizeObserver.observe(canvas);
    }
    if ("IntersectionObserver" in window) {
      intersectionObserver = new IntersectionObserver(function (entries) {
        visible = entries.some(function (entry) { return entry.isIntersecting; });
        if (visible) scheduleRender();
      }, { threshold: 0.01 });
      intersectionObserver.observe(sceneRoot);
    }

    const motionChange = function () { scheduleRender(); };
    if (reducedMotion.addEventListener) {
      reducedMotion.addEventListener("change", motionChange);
      cleanup.push(function () { reducedMotion.removeEventListener("change", motionChange); });
    }
    cleanup.push(function () {
      destroyed = true;
      if (rafId) window.cancelAnimationFrame(rafId);
      if (resizeObserver) resizeObserver.disconnect();
      if (intersectionObserver) intersectionObserver.disconnect();
      if (gl) buffers.forEach(function (buffer) { gl.deleteBuffer(buffer); });
      if (gl && program) gl.deleteProgram(program);
    });

    const initialChoice = document.querySelector(".color-option[aria-pressed='true']");
    if (initialChoice) setSelectedColor(initialChoice.dataset.color);
    resizeCanvas();
    scheduleRender();
  } catch (error) {
    startFallback();
  }

  window.addEventListener("pagehide", function () {
    cleanup.forEach(function (dispose) { dispose(); });
  }, { once: true });
}

