/* =============================================================
   StormMC — Storm3D
   A fully procedural Three.js voxel world:
     - floating Minecraft-style islands, tower, trees, beacon
     - animated shader ocean, voxel clouds, rain, embers
     - forking lightning with bloom + camera shake
     - scroll-driven cinematic camera on a damped spline
     - drag to look, click blocks to mine, click sky to strike
   Built as a classic script (works from file://), no build step.
   ============================================================= */
(function () {
  'use strict';

  var canvas = document.getElementById('storm-canvas');
  var loader = document.getElementById('loader');
  var loaderFill = document.getElementById('loader-fill');
  var loaderNote = document.getElementById('loader-note');
  var T = window.THREE;

  var reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  var isMobile = window.matchMedia('(max-width: 720px)').matches || /Mobi|Android/i.test(navigator.userAgent);

  function setLoader(p, note) {
    if (loaderFill) loaderFill.style.width = Math.round(p * 100) + '%';
    if (note && loaderNote) loaderNote.textContent = note;
  }
  function finishLoader() {
    if (!loader) return;
    setLoader(1, 'Welcome to the storm.');
    setTimeout(function () { loader.classList.add('is-done'); }, 420);
    setTimeout(function () { if (loader && loader.parentNode) loader.parentNode.removeChild(loader); }, 1500);
  }

  /* -------------------- availability guard -------------------- */
  function webglOk() {
    try {
      var c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e) { return false; }
  }

  if (!canvas || !T || !webglOk()) {
    document.body.classList.add('no-webgl', 'is-lowfx');
    if (canvas) canvas.style.display = 'none';
    finishLoader();
    return;
  }

  var POST = T.POST;
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var smooth = function (t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  var rand = function (a, b) { return a + Math.random() * (b - a); };
  var TAU = Math.PI * 2;

  /* ============================================================
     1. Renderer / scene / camera / post
     ============================================================ */
  var renderer, scene, camera, composer, bloomPass, outputPass, renderPass;
  var W = window.innerWidth, H = window.innerHeight;
  var quality = isMobile ? 1 : 3;           // 0 low, 1 med, 2 high, 3 ultra-ish
  var maxDpr = isMobile ? 1.25 : 1.75;
  var dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  var skyMat, oceanMat, starsMat, starField, ocean;
  var sunLight, hemiLight, ambientLight, moonMesh, torchLights = [];

  try {
    renderer = new T.WebGLRenderer({
      canvas: canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false
    });
  } catch (e) {
    document.body.classList.add('no-webgl');
    if (canvas) canvas.style.display = 'none';
    finishLoader();
    return;
  }

  renderer.setPixelRatio(dpr);
  renderer.setSize(W, H, false);
  renderer.shadowMap.enabled = !isMobile;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;

  scene = new T.Scene();
  scene.fog = new T.FogExp2(0x0a1622, 0.0092);

  camera = new T.PerspectiveCamera(56, W / H, 0.1, 1600);
  camera.position.set(16, 9, 30);

  /* post-processing */
  renderPass = new POST.RenderPass(scene, camera);
  var rt = new T.WebGLRenderTarget(W * dpr, H * dpr, {
    type: T.HalfFloatType,
    samples: isMobile ? 0 : 4
  });
  composer = new POST.EffectComposer(renderer, rt);
  composer.setPixelRatio(dpr);
  composer.setSize(W, H);
  composer.addPass(renderPass);

  bloomPass = new POST.UnrealBloomPass(new T.Vector2(W, H), 0.55, 0.6, 1.0);
  composer.addPass(bloomPass);

  outputPass = new POST.OutputPass();
  composer.addPass(outputPass);

  /* ============================================================
     2. Procedural textures
     ============================================================ */
  function hexRgb(hex) {
    return { r: (hex >> 16) & 255, g: (hex >> 8) & 255, b: hex & 255 };
  }
  function blockTexture(hex, variance, opts) {
    opts = opts || {};
    var s = 16;
    var c = document.createElement('canvas');
    c.width = c.height = s;
    var ctx = c.getContext('2d');
    var base = hexRgb(hex);
    for (var y = 0; y < s; y++) {
      for (var x = 0; x < s; x++) {
        var n = (Math.random() - 0.5) * variance * 2;
        var r = clamp(base.r * (1 + n), 0, 255);
        var g = clamp(base.g * (1 + n), 0, 255);
        var b = clamp(base.b * (1 + n), 0, 255);
        ctx.fillStyle = 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
        ctx.fillRect(x, y, 1, 1);
      }
    }
    // subtle bevel: darker bottom-right, lighter top-left
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(0, s - 2, s, 2); ctx.fillRect(s - 2, 0, 2, s);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(0, 0, s, 1); ctx.fillRect(0, 0, 1, s);
    if (opts.glint) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(0, 0, s, 1);
    }
    var tex = new T.CanvasTexture(c);
    tex.magFilter = T.NearestFilter;
    tex.minFilter = T.NearestFilter;
    tex.colorSpace = T.SRGBColorSpace;
    tex.anisotropy = 1;
    return tex;
  }

  var PAL = {
    grass:  { c: 0x5cbb6a, v: 0.20 },
    dirt:   { c: 0x6f4c2f, v: 0.24 },
    stone:  { c: 0x6d7681, v: 0.16 },
    cobble: { c: 0x565d68, v: 0.22 },
    log:    { c: 0x5a4228, v: 0.18 },
    leaves: { c: 0x2f7d43, v: 0.28 },
    planks: { c: 0x8a6a3c, v: 0.13 },
    brick:  { c: 0x7d4a3a, v: 0.16 },
    obsidian:{ c: 0x241b33, v: 0.26 },
    sand:   { c: 0xc8b483, v: 0.12 },
    gold:   { c: 0xd8a93a, v: 0.10 }
  };
  var blockGeo = new T.BoxGeometry(1, 1, 1);
  var mats = {};
  Object.keys(PAL).forEach(function (k) {
    mats[k] = new T.MeshStandardMaterial({
      map: blockTexture(PAL[k].c, PAL[k].v),
      roughness: 0.96,
      metalness: 0.0
    });
  });
  // glowstone: emissive
  mats.glow = new T.MeshStandardMaterial({
    map: blockTexture(0xffd98a, 0.10, { glint: true }),
    color: 0xffffff,
    emissive: 0xffc247,
    emissiveIntensity: 1.05,
    roughness: 0.55,
    metalness: 0
  });

  /* ============================================================
     3. Sky, stars, lights
     ============================================================ */
  var NIGHT = {
    top: new T.Color('#050b16'),
    mid: new T.Color('#0d2033'),
    bot: new T.Color('#152a3d'),
    fog: new T.Color('#0a1622'),
    sun: new T.Color('#a8d0ff'),
    sunI: 1.75,
    hemiSky: new T.Color('#20465f'),
    hemiGround: new T.Color('#10201a'),
    hemiI: 0.95,
    amb: 0.34,
    star: 1.0,
    exposure: 1.14
  };
  var DAY = {
    top: new T.Color('#2f79b8'),
    mid: new T.Color('#8fc4e8'),
    bot: new T.Color('#d8ecf6'),
    fog: new T.Color('#9fc4da'),
    sun: new T.Color('#fff4d6'),
    sunI: 2.0,
    hemiSky: new T.Color('#bfe0f5'),
    hemiGround: new T.Color('#3a4a30'),
    hemiI: 1.15,
    amb: 0.42,
    star: 0.0,
    exposure: 1.14
  };

  skyMat = new T.ShaderMaterial({
    side: T.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: NIGHT.top.clone() },
      uMid: { value: NIGHT.mid.clone() },
      uBot: { value: NIGHT.bot.clone() },
      uTime: { value: 0 }
    },
    vertexShader: [
      'varying vec3 vWorld;',
      'void main(){',
      '  vec4 wp = modelMatrix * vec4(position,1.0);',
      '  vWorld = wp.xyz;',
      '  gl_Position = projectionMatrix * viewMatrix * wp;',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBot; uniform float uTime;',
      'varying vec3 vWorld;',
      'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }',
      'void main(){',
      '  float h = normalize(vWorld).y;',
      '  vec3 col = mix(uBot, uMid, smoothstep(-0.15, 0.30, h));',
      '  col = mix(col, uTop, smoothstep(0.25, 0.95, h));',
      '  gl_FragColor = vec4(col, 1.0);',
      '}'
    ].join('\n')
  });
  var skyDome = new T.Mesh(new T.SphereGeometry(900, 32, 20), skyMat);
  scene.add(skyDome);

  // stars
  (function () {
    var N = 1400, pos = new Float32Array(N * 3), sz = new Float32Array(N);
    for (var i = 0; i < N; i++) {
      var u = Math.random(), v = Math.random();
      var th = u * TAU, ph = Math.acos(2 * v - 1);
      var r = 780;
      var y = Math.abs(r * Math.cos(ph)) * 0.9 + 40;
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
      sz[i] = rand(0.6, 1.9);
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('aSize', new T.BufferAttribute(sz, 1));
    starsMat = new T.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uOpacity: { value: 1 }, uTime: { value: 0 } },
      vertexShader: [
        'attribute float aSize; varying float vS;',
        'void main(){ vS = aSize; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * 2.0; gl_Position = projectionMatrix * mv; }'
      ].join('\n'),
      fragmentShader: [
        'uniform float uOpacity; uniform float uTime; varying float vS;',
        'void main(){',
        '  vec2 d = gl_PointCoord - 0.5;',
        '  float a = smoothstep(0.5, 0.0, length(d));',
        '  float tw = 0.6 + 0.4*sin(uTime*2.0 + vS*40.0);',
        '  gl_FragColor = vec4(vec3(1.0,0.98,0.92), a * uOpacity * tw);',
        '}'
      ].join('\n')
    });
    starField = new T.Points(g, starsMat);
    scene.add(starField);
  })();

  hemiLight = new T.HemisphereLight(NIGHT.hemiSky, NIGHT.hemiGround, NIGHT.hemiI);
  scene.add(hemiLight);
  ambientLight = new T.AmbientLight(0x223344, NIGHT.amb);
  scene.add(ambientLight);

  sunLight = new T.DirectionalLight(NIGHT.sun, NIGHT.sunI);
  sunLight.position.set(-60, 70, 40);
  sunLight.castShadow = !isMobile;
  if (sunLight.castShadow) {
    sunLight.shadow.mapSize.set(1024, 1024);
    var sc = sunLight.shadow.camera;
    sc.left = -46; sc.right = 46; sc.top = 46; sc.bottom = -46; sc.near = 1; sc.far = 260;
    sunLight.shadow.bias = -0.0007;
    sunLight.shadow.normalBias = 0.04;
  }
  scene.add(sunLight);
  scene.add(sunLight.target);

  // moon billboard
  moonMesh = new T.Mesh(
    new T.SphereGeometry(7, 20, 20),
    new T.MeshBasicMaterial({ color: 0xdfe9ff, fog: false })
  );
  moonMesh.position.set(-150, 170, 90);
  scene.add(moonMesh);
  var moonGlow = new T.Sprite(new T.SpriteMaterial({
    map: radialTexture('rgba(190,215,255,0.9)'), color: 0xbcd2ff,
    transparent: true, blending: T.AdditiveBlending, depthWrite: false, fog: false
  }));
  moonGlow.scale.set(70, 70, 1);
  moonGlow.position.copy(moonMesh.position);
  scene.add(moonGlow);

  function radialTexture(rgba) {
    var s = 64, c = document.createElement('canvas');
    c.width = c.height = s;
    var ctx = c.getContext('2d');
    var g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, rgba);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    var t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
  }

  /* ============================================================
     4. Ocean (shader displacement)
     ============================================================ */
  (function () {
    var geo = new T.PlaneGeometry(900, 900, 150, 150);
    oceanMat = new T.MeshStandardMaterial({
      color: 0x0d3247,
      roughness: 0.32,
      metalness: 0.35,
      emissive: 0x061724,
      emissiveIntensity: 1
    });
    oceanMat.onBeforeCompile = function (shader) {
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uWave = { value: 0.6 };
      shader.vertexShader = 'uniform float uTime; uniform float uWave;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        [
          'vec3 transformed = vec3(position);',
          'float w1 = sin(position.x*0.045 + uTime*0.85) * cos(position.y*0.038 - uTime*0.6);',
          'float w2 = sin((position.x+position.y)*0.028 - uTime*1.25);',
          'float w3 = sin(position.y*0.09 + uTime*1.7)*0.25;',
          'transformed.z += (w1*0.55 + w2*0.35 + w3) * uWave;'
        ].join('\n')
      );
      oceanMat.userData.shader = shader;
    };
    ocean = new T.Mesh(geo, oceanMat);
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.y = -30;
    scene.add(ocean);
  })();

  /* ============================================================
     5. Voxel world
     ============================================================ */
  var world = new T.Group();
  scene.add(world);

  // collect blocks per type
  var buckets = {};
  function addBlock(x, y, z, type) {
    (buckets[type] || (buckets[type] = [])).push([x, y, z]);
  }
  function hash2(x, z) {
    var s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
    return s - Math.floor(s);
  }

  function island(cx, cy, cz, radius, seed) {
    for (var x = -radius; x <= radius; x++) {
      for (var z = -radius; z <= radius; z++) {
        var d = Math.sqrt(x * x + z * z);
        var wob = (hash2(x + seed, z - seed) - 0.5) * 1.8;
        if (d > radius + wob) continue;
        // top grass
        addBlock(cx + x, cy, cz + z, 'grass');
        var depth = Math.floor((radius - d) * 0.85) + 2;
        for (var k = 1; k <= depth; k++) {
          var t = (k < depth * 0.45) ? 'dirt' : 'stone';
          if (k > depth - 2) t = 'stone';
          addBlock(cx + x, cy - k, cz + z, t);
        }
      }
    }
  }
  function tower(cx, cy, cz) {
    var i, j;
    for (j = 1; j <= 6; j++) {
      for (i = 0; i <= 4; i++) {
        var dx = i, dz = 0;
        addBlock(cx + dx, cy + j, cz + dz, j > 3 ? 'cobble' : 'stone');
      }
    }
    // hollow-ish room + light
    for (i = 1; i <= 3; i++) addBlock(cx + i, cy + 5, cz + 2, 'planks');
    for (i = 1; i <= 3; i++) addBlock(cx + i, cy + 5, cz - 2, 'planks');
    for (i = -2; i <= 2; i++) addBlock(cx + 2, cy + 5, cz + i, 'planks');
    // roof ring
    for (i = -3; i <= 6; i++) {
      addBlock(cx + i, cy + 7, cz - 3, 'brick');
      addBlock(cx + i, cy + 7, cz + 3, 'brick');
    }
    for (j = -3; j <= 3; j++) {
      addBlock(cx - 3, cy + 7, cz + j, 'brick');
      addBlock(cx + 6, cy + 7, cz + j, 'brick');
    }
    // beacon + glow cap
    addBlock(cx + 3, cy + 8, cz, 'glow');
    addBlock(cx + 3, cy + 9, cz, 'glow');
  }
  function tree(cx, cy, cz, h) {
    var i, j;
    for (i = 0; i < h; i++) addBlock(cx, cy + i, cz, 'log');
    var top = cy + h;
    for (i = -2; i <= 2; i++) {
      for (j = -2; j <= 2; j++) {
        if (Math.abs(i) === 2 && Math.abs(j) === 2) continue;
        addBlock(cx + i, top - 1, cz + j, 'leaves');
      }
    }
    for (i = -1; i <= 1; i++) {
      for (j = -1; j <= 1; j++) addBlock(cx + i, top, cz + j, 'leaves');
    }
    addBlock(cx, top + 1, cz, 'leaves');
  }

  // main island
  island(0, 0, 0, 11, 3);
  tower(-3, 0, 0);
  tree(6, 1, -5, 4);
  tree(-7, 1, 7, 5);
  tree(4, 1, 8, 3);
  // torches / glow accents around the rim
  var torchSpots = [[-9, 1, -2], [9, 1, 3], [-4, 1, 9], [2, 1, -9], [10, 1, -6]];
  torchSpots.forEach(function (p) {
    addBlock(p[0], p[1], p[2], 'cobble');
    addBlock(p[0], p[1] + 1, p[2], 'glow');
  });

  // satellite floating islands
  island(-26, 9, -18, 4.5, 11);
  island(27, 7, -23, 5.5, 23);
  island(30, 11, 15, 3.8, 31);
  island(-23, 13, 21, 4.2, 43);
  tree(27, 8, -23, 3);
  tree(-23, 14, 21, 4);
  addBlock(30, 12, 15, 'glow');
  addBlock(-26, 10, -18, 'gold');
  island(3, 20, -34, 3.2, 55); // high outpost
  addBlock(3, 21, -34, 'glow');

  // build instanced meshes
  var breakables = [];
  var breakMeta = [];
  Object.keys(buckets).forEach(function (type) {
    var arr = buckets[type];
    var mat = mats[type] || mats.stone;
    var mesh = new T.InstancedMesh(blockGeo, mat, arr.length);
    mesh.castShadow = !isMobile;
    mesh.receiveShadow = !isMobile;
    var base = new Float32Array(arr.length * 16);
    var m = new T.Matrix4();
    for (var i = 0; i < arr.length; i++) {
      m.makeTranslation(arr[i][0], arr[i][1], arr[i][2]);
      m.toArray(base, i * 16);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.userData.base = base;
    mesh.userData.broken = {};
    mesh.userData.type = type;
    world.add(mesh);
    if (type !== 'obsidian') breakables.push(mesh);
  });

  // beacon light beam
  var beam = new T.Mesh(
    new T.CylinderGeometry(0.55, 0.55, 90, 10, 1, true),
    new T.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.10, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, fog: false })
  );
  beam.position.set(-3 + 3, 9 + 45, 0);
  scene.add(beam);

  // warm torches (limited point lights)
  if (!isMobile) {
    [[9, 2, 3], [-9, 2, -2], [2, 2, -9]].forEach(function (p) {
      var pl = new T.PointLight(0xffc27a, 2.6, 22, 2);
      pl.position.set(p[0], p[1], p[2]);
      scene.add(pl);
      torchLights.push(pl);
    });
  }

  /* ============================================================
     6. Voxel clouds
     ============================================================ */
  var clouds = [];
  (function () {
    var cloudMat = new T.MeshStandardMaterial({
      color: 0xdfe9f5, roughness: 1, metalness: 0, transparent: true, opacity: 0.0, flatShading: true
    });
    var darkMat = new T.MeshStandardMaterial({
      color: 0x33445c, roughness: 1, metalness: 0, transparent: true, opacity: 0.0, flatShading: true
    });
    var cg = new T.BoxGeometry(1, 1, 1);
    var COUNT = isMobile ? 9 : 16;
    for (var i = 0; i < COUNT; i++) {
      var g = new T.Group();
      var dark = Math.random() < 0.45;
      var mat = dark ? darkMat : cloudMat;
      var parts = 4 + (Math.random() * 5 | 0);
      for (var p = 0; p < parts; p++) {
        var bx = rand(-7, 7), by = rand(-1.2, 1.2), bz = rand(-5, 5);
        var sx = rand(3, 9), sy = rand(1.6, 3.4), sz = rand(3, 9);
        var m = new T.Mesh(cg, mat);
        m.position.set(bx, by, bz);
        m.scale.set(sx, sy, sz);
        g.add(m);
      }
      g.position.set(rand(-150, 150), rand(26, 52), rand(-150, 150));
      g.userData.speed = rand(1.2, 3.0) * (dark ? 1.4 : 1);
      g.userData.dark = dark;
      scene.add(g);
      clouds.push(g);
    }
  })();

  /* ============================================================
     7. Rain + embers
     ============================================================ */
  var rain, rainPos, rainVel, RAIN_MAX = isMobile ? 1600 : 4800, rainCount = RAIN_MAX;
  (function () {
    rainPos = new Float32Array(RAIN_MAX * 3);
    rainVel = new Float32Array(RAIN_MAX);
    var half = 90, top = 70, bottom = -34;
    for (var i = 0; i < RAIN_MAX; i++) {
      rainPos[i * 3] = rand(-half, half);
      rainPos[i * 3 + 1] = rand(bottom, top);
      rainPos[i * 3 + 2] = rand(-half, half);
      rainVel[i] = rand(34, 58);
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(rainPos, 3));
    rain = new T.Points(g, new T.PointsMaterial({
      map: streakTexture(),
      color: 0xa9d8ff,
      size: 1.5,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: T.AdditiveBlending,
      fog: false
    }));
    rain.frustumCulled = false;
    scene.add(rain);
  })();

  function streakTexture() {
    var w = 8, h = 64, c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.95)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(w / 2 - 1, 0, 2, h);
    var t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    return t;
  }

  var embers, emberPos, emberPhase;
  (function () {
    var N = isMobile ? 120 : 260;
    emberPos = new Float32Array(N * 3);
    emberPhase = new Float32Array(N);
    var pts = [[0, 3, 0, 16], [-26, 11, -18, 7], [27, 9, -23, 8], [30, 13, 15, 6], [-23, 15, 21, 6]];
    for (var i = 0; i < N; i++) {
      var s = pts[i % pts.length];
      var a = Math.random() * TAU, r = Math.random() * s[3];
      emberPos[i * 3] = s[0] + Math.cos(a) * r;
      emberPos[i * 3 + 1] = s[1] + rand(-1, 5);
      emberPos[i * 3 + 2] = s[2] + Math.sin(a) * r;
      emberPhase[i] = Math.random() * TAU;
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(emberPos, 3));
    embers = new T.Points(g, new T.PointsMaterial({
      map: radialTexture('rgba(255,214,120,0.95)'),
      color: 0xffd27a,
      size: 0.55,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: T.AdditiveBlending,
      fog: false
    }));
    embers.frustumCulled = false;
    scene.add(embers);
  })();

  /* ============================================================
     8. Particle bursts (block break)
     ============================================================ */
  var P_MAX = isMobile ? 160 : 360;
  var pGeo, pPoints, pPos, pCol, pVel, pLife, pActive = 0;
  (function () {
    pPos = new Float32Array(P_MAX * 3);
    pCol = new Float32Array(P_MAX * 3);
    pVel = new Float32Array(P_MAX * 3);
    pLife = new Float32Array(P_MAX);
    for (var i = 0; i < P_MAX; i++) pPos[i * 3 + 1] = -9999;
    pGeo = new T.BufferGeometry();
    pGeo.setAttribute('position', new T.BufferAttribute(pPos, 3));
    pGeo.setAttribute('color', new T.BufferAttribute(pCol, 3));
    pPoints = new T.Points(pGeo, new T.PointsMaterial({
      size: 0.30, sizeAttenuation: true, vertexColors: true,
      transparent: true, opacity: 1, depthWrite: false
    }));
    pPoints.frustumCulled = false;
    scene.add(pPoints);
  })();
  function burst(x, y, z, colHex, n) {
    var c = new T.Color(colHex);
    for (var i = 0; i < n && pActive < P_MAX; i++) {
      var k = pActive++;
      pPos[k * 3] = x + rand(-0.5, 0.5);
      pPos[k * 3 + 1] = y + rand(-0.5, 0.5);
      pPos[k * 3 + 2] = z + rand(-0.5, 0.5);
      pVel[k * 3] = rand(-3.5, 3.5);
      pVel[k * 3 + 1] = rand(2, 6.5);
      pVel[k * 3 + 2] = rand(-3.5, 3.5);
      var tint = 0.75 + Math.random() * 0.5;
      pCol[k * 3] = clamp(c.r * tint, 0, 1);
      pCol[k * 3 + 1] = clamp(c.g * tint, 0, 1);
      pCol[k * 3 + 2] = clamp(c.b * tint, 0, 1);
      pLife[k] = rand(0.7, 1.3);
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
  }
  function updateParticles(dt) {
    if (!pActive) return;
    for (var i = 0; i < pActive; i++) {
      pLife[i] -= dt;
      if (pLife[i] <= 0) {
        // swap with last active
        var last = --pActive;
        pPos[i * 3] = pPos[last * 3];
        pPos[i * 3 + 1] = pPos[last * 3 + 1];
        pPos[i * 3 + 2] = pPos[last * 3 + 2];
        pVel[i * 3] = pVel[last * 3];
        pVel[i * 3 + 1] = pVel[last * 3 + 1];
        pVel[i * 3 + 2] = pVel[last * 3 + 2];
        pCol[i * 3] = pCol[last * 3];
        pCol[i * 3 + 1] = pCol[last * 3 + 1];
        pCol[i * 3 + 2] = pCol[last * 3 + 2];
        pLife[i] = pLife[last];
        i--;
        continue;
      }
      pVel[i * 3 + 1] -= 14 * dt;
      pPos[i * 3] += pVel[i * 3] * dt;
      pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
      pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
    }
    // park unused
    for (var j = pActive; j < P_MAX; j++) pPos[j * 3 + 1] = -9999;
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
  }

  /* ============================================================
     9. Lightning
     ============================================================ */
  var bolts = [];
  var boltMat = new T.LineBasicMaterial({ color: 0xdff0ff, transparent: true, opacity: 1, blending: T.AdditiveBlending, depthWrite: false, fog: false });
  var boltGlowMat = new T.LineBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.5, blending: T.AdditiveBlending, depthWrite: false, fog: false });

  function makeBoltPath(from, to, jitter) {
    var pts = [];
    var steps = 16;
    var prev = from.clone();
    pts.push(prev.clone());
    for (var i = 1; i <= steps; i++) {
      var t = i / steps;
      var p = from.clone().lerp(to, t);
      var spread = (1 - t) * jitter + 0.4;
      p.x += rand(-spread, spread);
      p.z += rand(-spread, spread);
      pts.push(p);
    }
    return pts;
  }

  var flashEl = document.createElement('div');
  flashEl.style.cssText = 'position:fixed;inset:0;background:#dff0ff;opacity:0;pointer-events:none;z-index:38;mix-blend-mode:screen;transition:opacity .28s ease-out;';
  document.body.appendChild(flashEl);

  var flashVal = 0, flashTarget = 0;
  var shake = 0;

  function strike(target, opts) {
    opts = opts || {};
    var origin = new T.Vector3(target.x + rand(-4, 4), 74, target.z + rand(-4, 4));
    var main = makeBoltPath(origin, target, 5.5);
    var g = new T.BufferGeometry().setFromPoints(main);
    var l = new T.Line(g, boltMat.clone());
    scene.add(l);
    // a couple of branches
    var branches = [];
    for (var b = 0; b < 3; b++) {
      var idx = 4 + (Math.random() * 8 | 0);
      var bp = main[idx].clone();
      var end = bp.clone().add(new T.Vector3(rand(-9, 9), rand(-10, -3), rand(-9, 9)));
      var bg = new T.BufferGeometry().setFromPoints(makeBoltPath(bp, end, 2.5));
      var bl = new T.Line(bg, boltGlowMat.clone());
      scene.add(bl);
      branches.push({ line: bl, geo: bg });
    }
    var light = new T.PointLight(0xcfe6ff, 0, 90, 2);
    light.position.copy(target).add(new T.Vector3(0, 6, 0));
    scene.add(light);

    var bolt = { line: l, geo: g, branches: branches, light: light, life: 0.45, max: 0.45, flick: 0 };
    bolts.push(bolt);

    flashTarget = opts.big ? 0.42 : 0.30;
    shake = Math.max(shake, opts.big ? 0.9 : 0.55);
    boltCount++;
    if (hudLightning) hudLightning.textContent = String(boltCount);
    audioThunder(opts.big ? 0.9 : 0.55, target);
    dirty = true;
  }

  function updateBolts(dt) {
    for (var i = bolts.length - 1; i >= 0; i--) {
      var b = bolts[i];
      b.life -= dt;
      if (b.life <= 0) {
        scene.remove(b.line); b.geo.dispose();
        b.branches.forEach(function (br) { scene.remove(br.line); br.geo.dispose(); });
        scene.remove(b.light);
        bolts.splice(i, 1);
        continue;
      }
      var k = b.life / b.max;
      var flick = (Math.random() < 0.35 ? 0.25 : 1) * k;
      b.line.material.opacity = flick;
      b.branches.forEach(function (br) { br.line.material.opacity = flick * 0.5; });
      b.light.intensity = flick * 900;
    }
  }

  var autoStrikeTimer = 3;
  function autoStrike() {
    // random point over the visible island cluster
    var a = Math.random() * TAU, r = rand(4, 34);
    var target = new T.Vector3(Math.cos(a) * r, rand(-2, 3), Math.sin(a) * r);
    strike(target, { big: Math.random() < 0.4 });
  }

  /* ============================================================
     10. Audio (optional, off by default)
     ============================================================ */
  var audioCtx = null, rainGain = null, soundOn = false, masterGain = null;
  function initAudio() {
    if (audioCtx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.0;
    masterGain.connect(audioCtx.destination);

    // rain: looping filtered noise
    var len = audioCtx.sampleRate * 2;
    var buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
    var src = audioCtx.createBufferSource();
    src.buffer = buf; src.loop = true;
    var lp = audioCtx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1400;
    rainGain = audioCtx.createGain(); rainGain.gain.value = 0.0;
    src.connect(lp); lp.connect(rainGain); rainGain.connect(masterGain);
    src.start();

    // ambience: low pad
    var osc = audioCtx.createOscillator();
    var og = audioCtx.createGain();
    osc.type = 'sine'; osc.frequency.value = 52;
    og.gain.value = 0.05;
    osc.connect(og); og.connect(masterGain); osc.start();
  }
  function audioThunder(amount, target) {
    if (!soundOn || !audioCtx) return;
    var now = audioCtx.currentTime;
    var len = Math.floor(audioCtx.sampleRate * 1.6);
    var buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) {
      var e = Math.pow(1 - i / len, 2.2);
      d[i] = (Math.random() * 2 - 1) * e;
    }
    var src = audioCtx.createBufferSource(); src.buffer = buf;
    var lp = audioCtx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    var g = audioCtx.createGain(); g.gain.value = 0.9 * amount;
    src.connect(lp); lp.connect(g); g.connect(masterGain);
    var delay = Math.min(0.6, target.distanceTo(camera.position) * 0.01);
    src.start(now + delay);
  }
  function setSound(on) {
    soundOn = on;
    if (on) initAudio();
    if (audioCtx) {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      masterGain.gain.setTargetAtTime(on ? 0.5 : 0.0, audioCtx.currentTime, 0.4);
    }
  }

  /* ============================================================
     11. Camera rig (scroll path + drag + parallax + shake)
     ============================================================ */
  var KEYS = [
    { p: [22, 20, 30],   t: [-4, 1, 0] },    // hero — high 3/4 on the grassy top
    { p: [-16, 15, 27],  t: [-1, 2, 0] },    // modes — orbit to the other side
    { p: [25, 6, 17],    t: [1, 2, 0] },     // vote — low, close, dramatic
    { p: [-29, 26, -18], t: [0, 2, 0] },     // rules — high wide from behind
    { p: [38, 13, -11],  t: [27, 8, -23] },  // gallery — satellite B
    { p: [-34, 21, 12],  t: [-23, 13, 21] }, // community — satellite D
    { p: [0, 12, 40],    t: [0, 0, 0] }      // footer — wide front
  ];
  var pathPos = new T.Vector3(), pathTgt = new T.Vector3();
  var smoothPos = new T.Vector3(17, 10, 31), smoothTgt = new T.Vector3(0, 1, 0);
  var progress = 0, targetProgress = 0;
  var dragYaw = 0, dragPitch = 0, tgtYaw = 0, tgtPitch = 0;
  var parallaxX = 0, parallaxY = 0, tgtParX = 0, tgtParY = 0;
  var pointerNX = 0, pointerNY = 0;
  var autoT = 0;

  function samplePath(p) {
    var n = KEYS.length;
    var x = clamp(p, 0, 1) * (n - 1);
    var i = Math.min(Math.floor(x), n - 2);
    var t = smooth(x - i);
    var a = KEYS[i], b = KEYS[i + 1];
    pathPos.set(
      lerp(a.p[0], b.p[0], t),
      lerp(a.p[1], b.p[1], t),
      lerp(a.p[2], b.p[2], t)
    );
    pathTgt.set(
      lerp(a.t[0], b.t[0], t),
      lerp(a.t[1], b.t[1], t),
      lerp(a.t[2], b.t[2], t)
    );
  }

  var camVec = new T.Vector3();
  function updateCamera(dt) {
    // damped progress
    progress += (targetProgress - progress) * (1 - Math.exp(-6 * dt));
    samplePath(progress);

    // damped position/target
    var k = 1 - Math.exp(-3.2 * dt);
    smoothPos.lerp(pathPos, k);
    smoothTgt.lerp(pathTgt, k);

    // idle drift
    autoT += dt;
    var idleYaw = Math.sin(autoT * 0.09) * 0.10 * (motionOff ? 0 : 1);
    var idlePitch = Math.cos(autoT * 0.07) * 0.03 * (motionOff ? 0 : 1);

    // drag damping
    dragYaw += (tgtYaw - dragYaw) * (1 - Math.exp(-4 * dt));
    dragPitch += (tgtPitch - dragPitch) * (1 - Math.exp(-4 * dt));

    // parallax damping
    parallaxX += (tgtParX - parallaxX) * (1 - Math.exp(-4 * dt));
    parallaxY += (tgtParY - parallaxY) * (1 - Math.exp(-4 * dt));

    var yaw = idleYaw + dragYaw;
    var pitch = idlePitch + dragPitch;

    camVec.copy(smoothPos).sub(smoothTgt);
    var sph = new T.Spherical().setFromVector3(camVec);
    sph.theta += yaw;
    sph.phi = clamp(sph.phi + pitch, 0.22, Math.PI - 0.22);
    camVec.setFromSpherical(sph);
    camera.position.copy(smoothTgt).add(camVec);

    // parallax (screen-space offsets)
    var right = new T.Vector3().setFromMatrixColumn(camera.matrix, 0);
    var up = new T.Vector3().setFromMatrixColumn(camera.matrix, 1);
    camera.position.addScaledVector(right, parallaxX * 2.2);
    camera.position.addScaledVector(up, parallaxY * 1.5);

    // shake
    if (shake > 0.001) {
      camera.position.x += rand(-1, 1) * shake * 0.6;
      camera.position.y += rand(-1, 1) * shake * 0.6;
      camera.position.z += rand(-1, 1) * shake * 0.6;
      shake *= Math.exp(-6 * dt);
    }

    camera.lookAt(smoothTgt);
    // keep the sky centred
    skyDome.position.copy(camera.position);
    moonMesh.position.set(camera.position.x - 150, 170, camera.position.z + 90);
    starField.position.set(camera.position.x, 0, camera.position.z);
  }

  /* ============================================================
     12. Interaction
     ============================================================ */
  var raycaster = new T.Raycaster();
  var ndc = new T.Vector2();
  var pointerDown = false, dragging = false, downX = 0, downY = 0, downT = 0, lastX = 0, lastY = 0;
  var hoverCheckAt = 0;
  var blockCount = 0, boltCount = 0;
  var hudBlocks = document.getElementById('hud-blocks');
  var hudPlayers = document.getElementById('hud-players');
  var hudLightning = document.getElementById('hud-lightning');

  function isOverUI(e) {
    var el = document.elementFromPoint(e.clientX, e.clientY);
    return !!(el && el.closest && el.closest('.topbar, .deck, .hud, .drawer, .scrim, .lightbox'));
  }

  function rayFromEvent(e) {
    var r = canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
  }

  function hitBreakable() {
    var hits = raycaster.intersectObjects(breakables, false);
    return hits.length ? hits[0] : null;
  }

  function mineAt(hit) {
    var mesh = hit.object;
    var id = hit.instanceId;
    if (id == null) return false;
    if (mesh.userData.broken[id]) return false;
    var base = mesh.userData.base;
    var m = new T.Matrix4().fromArray(base, id * 16);
    var pos = new T.Vector3().setFromMatrixPosition(m);
    // hide
    var zero = new T.Matrix4().makeScale(0.0001, 0.0001, 0.0001);
    zero.setPosition(pos);
    mesh.setMatrixAt(id, zero);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.broken[id] = { at: performance.now() };
    // particles, tinted by type
    var col = PAL[mesh.userData.type] ? PAL[mesh.userData.type].c : 0x8a5a34;
    burst(pos.x, pos.y + 0.5, pos.z, col, 16);
    blockCount++;
    if (hudBlocks) hudBlocks.textContent = String(blockCount);
    shake = Math.max(shake, 0.16);
    dirty = true;
    return true;
  }

  // respawn mined blocks after a while
  function respawnBlocks() {
    var now = performance.now();
    for (var bi = 0; bi < breakables.length; bi++) {
      var mesh = breakables[bi];
      var broken = mesh.userData.broken;
      var ids = Object.keys(broken);
      if (!ids.length) continue;
      var changed = false;
      for (var k = 0; k < ids.length; k++) {
        var id = ids[k];
        if (now - broken[id].at > 9000) {
          var m = new T.Matrix4().fromArray(mesh.userData.base, id * 16);
          mesh.setMatrixAt(id, m);
          delete broken[id];
          changed = true;
        }
      }
      if (changed) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  canvas.addEventListener('pointerdown', function (e) {
    if (isOverUI(e)) return;
    pointerDown = true; dragging = false;
    downX = lastX = e.clientX; downY = lastY = e.clientY; downT = performance.now();
    canvas.classList.add('is-grabbing');
  });

  window.addEventListener('pointermove', function (e) {
    pointerNX = (e.clientX / window.innerWidth) * 2 - 1;
    pointerNY = -((e.clientY / window.innerHeight) * 2 - 1);
    tgtParX = pointerNX * 0.5;
    tgtParY = pointerNY * 0.35;

    if (!pointerDown) {
      var now = performance.now();
      if (now - hoverCheckAt > 90 && !isOverUI(e)) {
        hoverCheckAt = now;
        rayFromEvent(e);
        var hit = hitBreakable();
        canvas.classList.toggle('is-grab', !!hit);
      }
      return;
    }
    var dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 6) dragging = true;
    if (dragging) {
      tgtYaw += dx * 0.0042;
      tgtPitch += dy * 0.0032;
      tgtYaw = clamp(tgtYaw, -0.9, 0.9);
      tgtPitch = clamp(tgtPitch, -0.55, 0.55);
      dirty = true;
    }
  });

  window.addEventListener('pointerup', function (e) {
    if (!pointerDown) return;
    pointerDown = false;
    canvas.classList.remove('is-grabbing');
    var moved = Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY);
    var quick = performance.now() - downT < 500;
    if (!dragging && moved < 6 && quick) {
      // click
      if (isOverUI(e)) return;
      rayFromEvent(e);
      var hit = hitBreakable();
      if (hit && mineAt(hit)) {
        showTip('Block mined');
      } else {
        // strike the pointed spot (or straight ahead)
        var target;
        if (hit) target = hit.point.clone();
        else {
          var fwd = new T.Vector3(); camera.getWorldDirection(fwd);
          target = camera.position.clone().addScaledVector(fwd, 28);
          target.y = Math.max(-2, target.y);
        }
        strike(target, { big: true });
      }
    }
    // recenter drag after release
    if (dragging) { tgtYaw = 0; tgtPitch = 0; }
  });

  canvas.addEventListener('pointerleave', function () { canvas.classList.remove('is-grab'); });
  // prevent text selection while dragging
  canvas.addEventListener('dragstart', function (e) { e.preventDefault(); });

  var tipEl = document.getElementById('toast');
  var tipTimer = null;
  function showTip(msg) {
    if (!tipEl) return;
    tipEl.textContent = msg;
    tipEl.classList.add('is-open');
    clearTimeout(tipTimer);
    tipTimer = setTimeout(function () { tipEl.classList.remove('is-open'); }, 1400);
  }

  /* ============================================================
     13. Scroll progress
     ============================================================ */
  var progressBar = document.getElementById('scroll-progress');
  function readScroll() {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    targetProgress = max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;
    if (progressBar) progressBar.style.width = (targetProgress * 100).toFixed(2) + '%';
    dirty = true;
  }
  window.addEventListener('scroll', readScroll, { passive: true });

  /* ============================================================
     14. Controls
     ============================================================ */
  var motionOff = reducedQuery.matches;
  var storm = 0.58, dayNight = 0; // 0 night -> 1 day
  var stormRange = document.getElementById('storm-range');
  var stormOut = document.getElementById('storm-out');
  var btnWeather = document.getElementById('btn-weather');
  var weatherIcon = document.getElementById('weather-icon');
  var weatherLabel = document.getElementById('weather-label');
  var btnStrike = document.getElementById('btn-strike');
  var btnView = document.getElementById('btn-view');
  var btnSound = document.getElementById('btn-sound');
  var soundIcon = document.getElementById('sound-icon');
  var soundLabel = document.getElementById('sound-label');
  var motionToggle = document.getElementById('motion-toggle');
  var deck = document.getElementById('deck');
  var deckToggle = document.getElementById('deck-toggle');

  function applyStorm(v) {
    storm = v;
    if (stormOut) stormOut.textContent = Math.round(v * 100) + '%';
    if (stormRange) stormRange.style.setProperty('--fill', (v * 100) + '%');
    var visible = Math.round(RAIN_MAX * (0.12 + 0.88 * v));
    if (rain) {
      rainCount = visible;
      rain.geometry.setDrawRange(0, visible);
      rain.material.opacity = 0.16 + 0.55 * v;
    }
    if (bloomPass) bloomPass.strength = 0.55 + 0.5 * v;
    scene.fog.density = 0.0055 + 0.007 * v;
    clouds.forEach(function (c) { c.userData.speed = c.userData.baseSpeed * (0.5 + v); });
    weatherNote();
    dirty = true;
  }
  clouds.forEach(function (c) { c.userData.baseSpeed = c.userData.speed; });

  function applyDayNight(v) {
    dayNight = clamp(v, 0, 1);
    var e = smooth(dayNight);
    function mixc(a, b) { return a.clone().lerp(b, e); }
    if (skyMat) {
      skyMat.uniforms.uTop.value.copy(mixc(NIGHT.top, DAY.top));
      skyMat.uniforms.uMid.value.copy(mixc(NIGHT.mid, DAY.mid));
      skyMat.uniforms.uBot.value.copy(mixc(NIGHT.bot, DAY.bot));
    }
    if (scene.fog) scene.fog.color.copy(mixc(NIGHT.fog, DAY.fog));
    if (sunLight) {
      sunLight.color.copy(mixc(NIGHT.sun, DAY.sun));
      sunLight.intensity = lerp(NIGHT.sunI, DAY.sunI, e);
    }
    if (hemiLight) {
      hemiLight.color.copy(mixc(NIGHT.hemiSky, DAY.hemiSky));
      hemiLight.groundColor.copy(mixc(NIGHT.hemiGround, DAY.hemiGround));
      hemiLight.intensity = lerp(NIGHT.hemiI, DAY.hemiI, e);
    }
    if (ambientLight) ambientLight.intensity = lerp(NIGHT.amb, DAY.amb, e);
    if (starsMat) starsMat.uniforms.uOpacity.value = lerp(NIGHT.star, DAY.star, e);
    if (renderer) renderer.toneMappingExposure = lerp(NIGHT.exposure, DAY.exposure, e);
    if (moonMesh) moonMesh.visible = dayNight < 0.5;
    dirty = true;
  }

  function weatherNote() {
    if (!weatherLabel) return;
    if (dayNight > 0.5) weatherLabel.textContent = 'Day';
    else weatherLabel.textContent = 'Night';
  }

  if (stormRange) {
    applyStorm(parseInt(stormRange.value, 10) / 100);
    stormRange.addEventListener('input', function () {
      applyStorm(parseInt(stormRange.value, 10) / 100);
    });
  } else {
    applyStorm(storm);
  }

  if (btnWeather) {
    btnWeather.addEventListener('click', function () {
      var toDay = dayNight < 0.5;
      applyDayNight(toDay ? 1 : 0);
      btnWeather.setAttribute('aria-pressed', String(toDay));
      if (weatherIcon) weatherIcon.textContent = toDay ? 'light_mode' : 'dark_mode';
      weatherNote();
    });
  }
  if (btnStrike) {
    btnStrike.addEventListener('click', function () {
      var a = Math.random() * TAU, r = rand(3, 22);
      strike(new T.Vector3(Math.cos(a) * r, rand(-1, 3), Math.sin(a) * r), { big: true });
    });
  }
  if (btnView) {
    btnView.addEventListener('click', function () {
      tgtYaw = 0; tgtPitch = 0;
      progress = 0; targetProgress = 0;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      showTip('View recentred');
    });
  }
  if (btnSound) {
    btnSound.addEventListener('click', function () {
      var on = btnSound.getAttribute('aria-pressed') !== 'true';
      btnSound.setAttribute('aria-pressed', String(on));
      setSound(on);
      if (soundIcon) soundIcon.textContent = on ? 'volume_up' : 'volume_off';
      if (soundLabel) soundLabel.textContent = on ? 'Sound on' : 'Sound';
    });
  }
  if (deckToggle && deck) {
    // start collapsed on phones so the panel never covers content
    if (isMobile) {
      deck.classList.add('is-collapsed');
      deckToggle.setAttribute('aria-expanded', 'false');
    }
    deckToggle.addEventListener('click', function () {
      var collapsed = deck.classList.toggle('is-collapsed');
      deckToggle.setAttribute('aria-expanded', String(!collapsed));
    });
  }
  function setMotion(off) {
    motionOff = off;
    document.body.classList.toggle('is-lowfx', off);
    if (motionToggle) motionToggle.checked = off;
    if (off) {
      if (pPoints) pPoints.visible = true;
      dirty = true;
    }
  }
  if (motionToggle) {
    motionToggle.checked = motionOff;
    motionToggle.addEventListener('change', function () { setMotion(motionToggle.checked); });
  }
  if (reducedQuery.addEventListener) reducedQuery.addEventListener('change', function (e) { setMotion(e.matches); });

  /* ============================================================
     15. Adaptive quality + resize
     ============================================================ */
  function setQuality(q) {
    quality = q;
    if (q <= 0) {
      renderer.shadowMap.enabled = false;
      if (sunLight) sunLight.castShadow = false;
      dpr = Math.min(dpr, 1);
    } else if (q === 1) {
      renderer.shadowMap.enabled = false;
      if (sunLight) sunLight.castShadow = false;
    }
    renderer.setPixelRatio(dpr);
    composer.setPixelRatio(dpr);
    composer.setSize(W, H);
    bloomPass.setSize(W, H);
  }

  function onResize() {
    W = window.innerWidth; H = window.innerHeight;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    composer.setPixelRatio(dpr);
    composer.setSize(W, H);
    bloomPass.setSize(W, H);
    readScroll();
    dirty = true;
  }
  window.addEventListener('resize', onResize);

  /* ============================================================
     16. Status event from app.js
     ============================================================ */
  window.addEventListener('storm:status', function (e) {
    if (!hudPlayers || !e.detail) return;
    var d = e.detail;
    hudPlayers.textContent = d.online == null ? '—' : (d.online + '/' + (d.max == null ? '?' : d.max));
  });

  /* ============================================================
     17. Main loop
     ============================================================ */
  var dirty = true;
  var last = performance.now();
  var fpsAccum = 0, fpsFrames = 0, fpsChecked = 0;
  var clockT = 0;
  var lowStreak = 0;

  function update(dt) {
    clockT += dt;

    // sky / stars
    if (skyMat) skyMat.uniforms.uTime.value = clockT;
    if (starsMat) starsMat.uniforms.uTime.value = motionOff ? 0 : clockT;
    if (oceanMat && oceanMat.userData.shader) {
      oceanMat.userData.shader.uniforms.uTime.value = motionOff ? 0 : clockT;
      oceanMat.userData.shader.uniforms.uWave.value = 0.45 + storm * 0.9;
    }

    // clouds
    if (!motionOff) {
      for (var i = 0; i < clouds.length; i++) {
        var c = clouds[i];
        c.position.x += c.userData.speed * dt;
        if (c.position.x > 170) c.position.x = -170;
        var targetOpacity = (c.userData.dark ? 0.5 : 0.42) * (0.5 + storm * 0.6);
        c.children.forEach(function (m) {
          m.material.transparent = true;
        });
        // fade cluster opacity
        c.children.forEach(function (m) { m.material.opacity += ((c.userData.dark ? 0.55 : 0.45) * (0.4 + storm * 0.7) - m.material.opacity) * 0.05; });
      }
    }

    // rain
    if (rain && !motionOff) {
      var half = 90;
      var wind = (0.5 + storm * 1.4) * 10;
      var arr = rainPos;
      for (var r = 0; r < rainCount; r++) {
        arr[r * 3 + 1] -= rainVel[r] * dt * (0.7 + storm * 0.6);
        arr[r * 3] += wind * dt;
        if (arr[r * 3 + 1] < -34) {
          arr[r * 3 + 1] = 70;
          arr[r * 3] = rand(-half, half);
          arr[r * 3 + 2] = rand(-half, half);
        }
        if (arr[r * 3] > half) arr[r * 3] -= half * 2;
      }
      rain.geometry.attributes.position.needsUpdate = true;
      rain.position.x = camera.position.x;
      rain.position.z = camera.position.z;
    }
    if (rain) rain.visible = !motionOff && storm > 0.02;

    // embers / beacon pulse
    if (embers && !motionOff) {
      embers.material.opacity = 0.55 + 0.35 * Math.sin(clockT * 2.2);
      var ep = emberPos;
      for (var e2 = 0; e2 < ep.length / 3; e2++) {
        ep[e2 * 3 + 1] += Math.sin(clockT * 1.5 + emberPhase[e2]) * dt * 0.35;
      }
      embers.geometry.attributes.position.needsUpdate = true;
    }
    if (beam) beam.material.opacity = 0.03 + 0.03 * Math.sin(clockT * 1.6);

    // lightning
    if (!motionOff) {
      autoStrikeTimer -= dt;
      if (autoStrikeTimer <= 0) {
        autoStrikeTimer = rand(1.2, 6.5) / (0.35 + storm * 1.6);
        autoStrike();
      }
    }
    updateBolts(dt);
    updateParticles(dt);

    // flash overlay
    flashVal += (flashTarget - flashVal) * (1 - Math.exp(-14 * dt));
    flashTarget *= Math.exp(-3.4 * dt);
    flashEl.style.opacity = flashVal.toFixed(3);

    // moon + sun direction
    var rot = clockT * 0.01;
    sunLight.position.set(camera.position.x - 60 + Math.sin(rot) * 10, 70, camera.position.z + 40);
    sunLight.target.position.set(0, 0, 0);
    sunLight.target.updateMatrixWorld();

    respawnBlocks();
    updateCamera(dt);
  }

  function loop(t) {
    requestAnimationFrame(loop);
    var dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    if (document.hidden) return;

    // adaptive quality sampling
    if (fpsFrames > 0) {
      fpsAccum += dt; fpsFrames--;
      if (fpsFrames === 0) {
        var avg = fpsAccum / 90;
        if (avg > 0.028) lowStreak++; else lowStreak = 0;
        if (lowStreak >= 2 && quality > 0) { setQuality(quality - 1); lowStreak = 0; }
      }
    } else if (quality > 0) {
      if (fpsChecked++ > 2) { fpsAccum = 0; fpsFrames = 90; }
    }

    if (motionOff && !dirty && bolts.length === 0 && pActive === 0) {
      // still keep camera settling for a moment after scroll
    }
    update(dt);
    composer.render();
    dirty = false;
  }

  /* ============================================================
     18. Boot
     ============================================================ */
  setLoader(0.15, 'Carving the islands…');
  readScroll();
  applyDayNight(0);
  setMotion(motionOff);
  onResize();

  // warm up: compile + first frame
  requestAnimationFrame(function () {
    setLoader(0.55, 'Summoning the storm…');
    requestAnimationFrame(function () {
      setLoader(0.85, 'Charging lightning…');
      // force shader compile before revealing
      try { composer.render(); } catch (e) {}
      setLoader(1, 'Welcome to the storm.');
      setTimeout(finishLoader, 260);
      requestAnimationFrame(loop);
    });
  });

  // expose a tiny debug/test surface
  var readyFlag = false;
  setTimeout(function () { readyFlag = true; }, 1200);
  window.__storm = {
    get ready() { return readyFlag; },
    get blocks() { return blockCount; },
    get bolts() { return boltCount; },
    get progress() { return progress; },
    get targetProgress() { return targetProgress; },
    get scrollY() { return window.scrollY; },
    get quality() { return quality; },
    get rainCount() { return rainCount; },
    get drawCalls() { return renderer.info.render.calls; },
    get triangles() { return renderer.info.render.triangles; },
    get camera() { return [camera.position.x, camera.position.y, camera.position.z]; },
    strike: strike,
    mine: function () { return blockCount; },
    _dbg: function () {
      return { THREE: T, renderer: renderer, scene: scene, camera: camera, composer: composer, breakables: breakables, mats: mats, clouds: clouds, rain: rain, bolts: bolts };
    }
  };
})();
