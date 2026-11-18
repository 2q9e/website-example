import { createBottleGeometry } from "./models/bottle-model.js?v=studio-01";

const sceneRoot = document.querySelector(".scroll-scene");
const canvas = document.querySelector("#product-canvas");
const sceneStatus = document.querySelector("#scene-status");
const sceneInstructions = document.querySelector("#scene-instructions");
const spinButton = document.querySelector("#spin-bottle");
const capSlider = document.querySelector("#cap-progress");
const chapters = Array.from(document.querySelectorAll(".chapter"));
const chapterCounter = document.querySelector(".scene-topline span:last-child");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const TAU = Math.PI * 2;

const palette = {
  tidepool: { name: "Abyss Jade", body: "#020805", cap: "#010303", trim: "#0a5e4c" },
  clementine: { name: "Solar Flare", body: "#ff7b61", cap: "#39243b", trim: "#ffd0a4" },
  lichen: { name: "Night Orchid", body: "#a18af6", cap: "#302343", trim: "#e0d5ff" }
};

const surfaces = {
  bottle: [0.1, 0.24, 0.75],
  trim: [0.16, 0.46, 0.5],
  cap: [0.16, 0.2, 0.35],
  badge: [0.32, 0.08, 0.55],
  halo: [0.46, 0.3, 0.2],
  droplet: [0.08, 0.16, 0.95]
};

if (sceneRoot && canvas) {
  let gl = null;
  let program = null;
  let locations = null;
  let environmentTexture = null;
  let bottleMeshes = null;
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
  let capProgress = 0;
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

  function studioEnvironmentPixels() {
    const width = 512;
    const height = 256;
    const pixels = new Uint8Array(width * height * 4);
    const lights = [
      { azimuth: -0.45, width: 0.17, bottom: -0.1, top: 0.74, color: [0.12, 1, 0.78], strength: 0.72 },
      { azimuth: 1.3, width: 0.11, bottom: -0.05, top: 0.62, color: [1, 0.38, 0.22], strength: 0.62 },
      { azimuth: 2.55, width: 0.19, bottom: -0.18, top: 0.72, color: [0.77, 1, 0.36], strength: 0.48 }
    ];
    const smoothRange = function (low, high, value) {
      const amount = clamp((value - low) / (high - low), 0, 1);
      return amount * amount * (3 - 2 * amount);
    };

    for (let y = 0; y < height; y += 1) {
      const elevation = (y / (height - 1) - 0.5) * Math.PI;
      const sky = smoothRange(-0.2, 0.42, elevation);
      const horizonGlow = Math.exp(-Math.pow((elevation - 0.015) / 0.29, 2));

      for (let x = 0; x < width; x += 1) {
        const azimuth = (x / width - 0.5) * Math.PI * 2;
        const color = [
          0.018 + sky * 0.035 + horizonGlow * 0.025,
          0.027 + sky * 0.07 + horizonGlow * 0.12,
          0.038 + sky * 0.11 + horizonGlow * 0.14
        ];

        lights.forEach(function (light) {
          const angle = Math.atan2(Math.sin(azimuth - light.azimuth), Math.cos(azimuth - light.azimuth));
          const horizontal = 1 - smoothRange(light.width * 0.58, light.width, Math.abs(angle));
          const vertical = smoothRange(light.bottom - 0.06, light.bottom + 0.04, elevation) *
            (1 - smoothRange(light.top - 0.04, light.top + 0.08, elevation));
          const intensity = horizontal * vertical * light.strength;
          for (let channel = 0; channel < 3; channel += 1) color[channel] += light.color[channel] * intensity;
        });

        const index = (y * width + x) * 4;
        pixels[index] = Math.round(Math.min(1, color[0]) * 255);
        pixels[index + 1] = Math.round(Math.min(1, color[1]) * 255);
        pixels[index + 2] = Math.round(Math.min(1, color[2]) * 255);
        pixels[index + 3] = 255;
      }
    }

    return { width, height, pixels };
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

  function bottleScale4(value) {
    const matrix = new Float32Array(16);
    matrix[0] = value * 0.64;
    matrix[5] = value * 1.45;
    matrix[10] = value * 0.64;
    matrix[15] = 1;
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
    return multiply4(matrix, bottleScale4(scale));
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
      "#ifdef GL_FRAGMENT_PRECISION_HIGH",
      "precision highp float;",
      "#else",
      "precision mediump float;",
      "#endif",
      "uniform vec3 uColor;", "uniform vec3 uLight;", "uniform vec3 uCamera;",
      "uniform vec3 uMaterial;", "uniform sampler2D uEnvironment;",
      "varying vec3 vPosition;", "varying vec3 vNormal;",
      "const float PI = 3.14159265359;",
      "vec3 environmentSample(vec3 direction, float roughness) {",
      "  vec3 ray = normalize(direction);",
      "  vec2 uv = vec2(atan(ray.z, ray.x) / (2.0 * PI) + 0.5, asin(clamp(ray.y, -1.0, 1.0)) / PI + 0.5);",
      "  float blur = roughness * 0.012;",
      "  vec3 sharp = texture2D(uEnvironment, uv).rgb;",
      "  vec3 wide = (texture2D(uEnvironment, uv + vec2(blur, 0.0)).rgb + texture2D(uEnvironment, uv - vec2(blur, 0.0)).rgb) * 0.5;",
      "  return mix(sharp, wide, roughness * 0.55);",
      "}",
      "float distributionGGX(float nDotH, float roughness) {",
      "  float alpha = roughness * roughness;",
      "  float alphaSquared = alpha * alpha;",
      "  float denominator = nDotH * nDotH * (alphaSquared - 1.0) + 1.0;",
      "  return alphaSquared / max(PI * denominator * denominator, 0.001);",
      "}",
      "float geometrySchlick(float nDotV, float roughness) {",
      "  float k = (roughness + 1.0);",
      "  k = k * k * 0.125;",
      "  return nDotV / max(nDotV * (1.0 - k) + k, 0.001);",
      "}",
      "vec3 fresnelSchlick(float cosine, vec3 f0) {",
      "  return f0 + (1.0 - f0) * pow(1.0 - cosine, 5.0);",
      "}",
      "void main(void) {",
      "  vec3 normal = normalize(vNormal);",
      "  vec3 viewDirection = normalize(uCamera - vPosition);",
      "  vec3 lightDirection = normalize(uLight - vPosition);",
      "  vec3 halfDirection = normalize(lightDirection + viewDirection);",
      "  float roughness = clamp(uMaterial.x, 0.07, 0.92);",
      "  float metallic = clamp(uMaterial.y, 0.0, 1.0);",
      "  float coat = clamp(uMaterial.z, 0.0, 1.0);",
      "  float nDotL = max(dot(normal, lightDirection), 0.0);",
      "  float nDotV = max(dot(normal, viewDirection), 0.001);",
      "  float nDotH = max(dot(normal, halfDirection), 0.0);",
      "  float vDotH = max(dot(viewDirection, halfDirection), 0.0);",
      "  vec3 baseColor = pow(max(uColor, vec3(0.0)), vec3(2.2));",
      "  vec3 f0 = mix(vec3(0.04), baseColor, metallic);",
      "  vec3 fresnel = fresnelSchlick(vDotH, f0);",
      "  float distribution = distributionGGX(nDotH, roughness);",
      "  float geometryTerm = geometrySchlick(nDotV, roughness) * geometrySchlick(nDotL, roughness);",
      "  vec3 specular = distribution * geometryTerm * fresnel / max(4.0 * nDotV * max(nDotL, 0.001), 0.001);",
      "  vec3 directLight = (baseColor * (1.0 - metallic) * 0.78 + specular) * nDotL * vec3(1.1, 1.22, 1.16);",
      "  vec3 diffuseEnvironment = pow(environmentSample(normal, 0.88), vec3(2.2));",
      "  vec3 reflectedRay = reflect(-viewDirection, normal);",
      "  vec3 reflectedEnvironment = pow(environmentSample(reflectedRay, roughness), vec3(2.2));",
      "  vec3 ambient = diffuseEnvironment * baseColor * (1.0 - metallic) * 0.82;",
      "  vec3 reflection = reflectedEnvironment * fresnel * (0.34 + coat * 0.72);",
      "  float coatFresnel = 0.04 + 0.96 * pow(1.0 - vDotH, 5.0);",
      "  float rim = pow(1.0 - nDotV, 3.2);",
      "  vec3 color = directLight + ambient + reflection + vec3(0.0, 0.14, 0.12) * rim;",
      "  color += vec3(0.8, 0.95, 0.88) * coatFresnel * coat * specular * 0.26;",
      "  gl_FragColor = vec4(pow(max(color, 0.0), vec3(1.0 / 2.2)), 1.0);",
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

  function createEnvironmentTexture() {
    const environment = studioEnvironmentPixels();
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, environment.width, environment.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, environment.pixels);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  function bindAttribute(buffer, location) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
  }

  function drawMesh(mesh, modelMatrix, color, material) {
    bindAttribute(mesh.position, locations.position);
    bindAttribute(mesh.normal, locations.normal);
    gl.uniformMatrix4fv(locations.model, false, modelMatrix);
    gl.uniform3fv(locations.color, color);
    gl.uniform3fv(locations.material, material || surfaces.bottle);
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
    const sourcePixels = bounds.width * bounds.height;
    const maxRenderWidth = 3840;
    const maxRenderHeight = 2160;
    const resolutionCeiling = maxRenderWidth * maxRenderHeight;
    const deviceRatio = window.devicePixelRatio || 1;
    const preferredRatio = Math.max(deviceRatio, 2);
    const pixelBudgetRatio = Math.sqrt(resolutionCeiling / Math.max(1, sourcePixels));
    const dimensionRatio = Math.min(maxRenderWidth / bounds.width, maxRenderHeight / bounds.height);
    const ratio = Math.min(preferredRatio, mobile ? 1.5 : 2, pixelBudgetRatio, dimensionRatio);
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
    drawMesh(geometry.body, model, hexColor(colors.body), surfaces.bottle);
    drawMesh(geometry.lowerTrim, model, hexColor(colors.trim), surfaces.trim);
    drawMesh(geometry.neckTrim, model, hexColor(colors.trim), surfaces.trim);
    const easedCapProgress = capProgress * capProgress * (3 - 2 * capProgress);
    const capOffset = multiply4(
      translation4(easedCapProgress * 0.94, easedCapProgress * 0.24, 0),
      translation4(0, 2.255, 0)
    );
    drawMesh(geometry.cap, multiply4(model, capOffset), hexColor(colors.cap), surfaces.cap);
    geometry.badgeLines.forEach(function (line) {
      drawMesh(line, model, [0.82, 1, 0.91], surfaces.badge);
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
    const mainX = 0;
    const mainY = mobile ? -1.67 : -1.85 + Math.sin(progress * TAU * 2) * 0.035;
    const mainScale = mobile ? 0.9 : 1;

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);

    const aspect = canvas.width / Math.max(1, canvas.height);
    const projection = perspective4(mobile ? 0.67 : 0.62, aspect, 0.1, 80);
    const view = translation4(0, 0, mobile ? -7.35 : -7.0);
    gl.uniformMatrix4fv(locations.projection, false, projection);
    gl.uniformMatrix4fv(locations.view, false, view);
    gl.uniform3fv(locations.camera, [0, 0, mobile ? 7.35 : 7.0]);
    gl.uniform3fv(locations.light, [2.8, 4.6, 5.8]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, environmentTexture);

    const selected = palette[selectedColor] || palette.tidepool;
    drawBottle(bottleMeshes, mainX, mainY, 0, mainScale, bodyPitch, mainYaw, selected);

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
    canvas.setAttribute("aria-label", "Interactive three-dimensional view of the Rill bottle in " + palette[color].name + ". Use the cap slider to lift the cap, drag to turn the bottle, or use the arrow keys.");
    scheduleRender();
  }

  function onCapProgress(event) {
    const value = Number(event.detail && event.detail.progress);
    capProgress = clamp(Number.isFinite(value) ? value : 0, 0, 1);
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
      sceneInstructions.textContent = "Use the cap slider and colour options below. Bottle rotation is unavailable in this browser.";
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
      sceneInstructions.textContent = "The live 3D preview stopped. The cap slider and colour options still work with the bottle illustration.";
    }
    if (spinButton) spinButton.addEventListener("click", rotateFallback);
    announce("The live 3D preview stopped. The static bottle illustration is still available.");
  }

  try {
    gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
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
      light: gl.getUniformLocation(program, "uLight"),
      camera: gl.getUniformLocation(program, "uCamera"),
      material: gl.getUniformLocation(program, "uMaterial"),
      environment: gl.getUniformLocation(program, "uEnvironment")
    };

    environmentTexture = createEnvironmentTexture();
    gl.uniform1i(locations.environment, 0);

    const sourceBottle = createBottleGeometry();
    bottleMeshes = {
      body: uploadMesh(sourceBottle.body),
      cap: uploadMesh(sourceBottle.cap),
      lowerTrim: uploadMesh(sourceBottle.lowerTrim),
      neckTrim: uploadMesh(sourceBottle.neckTrim),
      badgeLines: sourceBottle.badgeLines.map(uploadMesh)
    };
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);

    contextAvailable = true;
    capProgress = capSlider ? clamp(Number(capSlider.value) / 100, 0, 1) : 0;
    sceneRoot.classList.add("scene-enhanced");
    sceneRoot.dataset.scene = "ready";
    canvas.removeAttribute("aria-hidden");
    canvas.setAttribute("tabindex", "0");
    announce("Interactive 3D preview ready. Lift the cap or turn the bottle.");

    listen(document, "rill:colorchange", onColorChange);
    listen(document, "rill:capprogress", onCapProgress);
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
      if (gl && environmentTexture) gl.deleteTexture(environmentTexture);
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


