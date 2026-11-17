const TAU = Math.PI * 2;

function normalize3(x, y, z) {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function lathe(profile, radialSegments = 56) {
  const positions = [];
  const normals = [];
  const indices = [];

  for (let row = 0; row < profile.length; row += 1) {
    const previous = profile[Math.max(0, row - 1)];
    const next = profile[Math.min(profile.length - 1, row + 1)];
    const dy = next[1] - previous[1];
    const slope = dy === 0 ? 0 : (next[0] - previous[0]) / dy;

    for (let segment = 0; segment <= radialSegments; segment += 1) {
      const angle = (segment / radialSegments) * TAU;
      const radius = profile[row][0];
      const x = Math.cos(angle);
      const z = Math.sin(angle);
      positions.push(radius * x, profile[row][1], radius * z);

      let normal;
      if (row === 0 && radius === 0) normal = [0, -1, 0];
      else if (row === profile.length - 1 && radius === 0) normal = [0, 1, 0];
      else normal = normalize3(x, -slope, z);
      normals.push(normal[0], normal[1], normal[2]);
    }
  }

  for (let row = 0; row < profile.length - 1; row += 1) {
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const current = row * (radialSegments + 1) + segment;
      const next = current + radialSegments + 1;
      indices.push(current, current + 1, next, current + 1, next + 1, next);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices)
  };
}

function torus(majorRadius, tubeRadius, centerY = 0, radialSegments = 56, tubeSegments = 8) {
  const positions = [];
  const normals = [];
  const indices = [];

  for (let i = 0; i <= radialSegments; i += 1) {
    const u = (i / radialSegments) * TAU;
    const cu = Math.cos(u);
    const su = Math.sin(u);

    for (let j = 0; j <= tubeSegments; j += 1) {
      const v = (j / tubeSegments) * TAU;
      const cv = Math.cos(v);
      const sv = Math.sin(v);
      const radius = majorRadius + tubeRadius * cv;
      positions.push(radius * cu, centerY + tubeRadius * sv, radius * su);
      normals.push(cv * cu, sv, cv * su);
    }
  }

  for (let i = 0; i < radialSegments; i += 1) {
    for (let j = 0; j < tubeSegments; j += 1) {
      const a = i * (tubeSegments + 1) + j;
      const b = a + tubeSegments + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices)
  };
}

function sphereProfile(rows = 14) {
  const profile = [];
  for (let i = 0; i <= rows; i += 1) {
    const angle = -Math.PI / 2 + (i / rows) * Math.PI;
    profile.push([Math.cos(angle), Math.sin(angle)]);
  }
  return profile;
}

function createBadgeLines() {
  const lines = [];
  const radius = 0.716;
  const waveRows = [1.13, 1.22];

  for (let row = 0; row < waveRows.length; row += 1) {
    const positions = [];
    const normals = [];
    const count = 34;

    for (let i = 0; i <= count; i += 1) {
      const x = -0.235 + (i / count) * 0.47;
      const y = waveRows[row] + Math.sin((i / count) * TAU * 1.35 + row * 0.8) * 0.035;
      const z = Math.sqrt(Math.max(0, radius * radius - x * x)) + 0.009;
      positions.push(x, y, z);
      normals.push(0, 0, 1);
    }

    lines.push({
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      mode: "line-strip",
      count: count + 1
    });
  }

  return lines;
}

// Procedural, y-up model source. One unit is roughly the height of the body.
export function createBottleGeometry() {
  const body = lathe([
    [0, 0],
    [0.52, 0],
    [0.64, 0.04],
    [0.705, 0.13],
    [0.72, 0.24],
    [0.72, 1.59],
    [0.69, 1.77],
    [0.58, 1.94],
    [0.42, 2.05],
    [0.345, 2.13],
    [0.345, 2.26],
    [0, 2.26]
  ]);

  const cap = lathe([
    [0, 0],
    [0.29, 0],
    [0.327, 0.025],
    [0.327, 0.065],
    [0.305, 0.09],
    [0.327, 0.115],
    [0.305, 0.14],
    [0.327, 0.165],
    [0.305, 0.19],
    [0.327, 0.215],
    [0.31, 0.25],
    [0.285, 0.295],
    [0, 0.295]
  ], 48);

  return {
    body,
    cap,
    lowerTrim: torus(0.707, 0.018, 0.165),
    neckTrim: torus(0.346, 0.018, 2.145, 48, 7),
    badgeLines: createBadgeLines()
  };
}

export function createSceneGeometry() {
  return {
    halo: torus(1.48, 0.012, 0, 72, 6),
    droplets: lathe(sphereProfile(), 24)
  };
}

