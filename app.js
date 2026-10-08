(() => {
  "use strict";

  // ---------- Configuración ----------
  const PHOTO_COUNT = 17;
  const PHOTOS = Array.from({ length: PHOTO_COUNT }, (_, i) => `fotos/${i + 1}.jpeg`);
  const PHRASES = [
    "Señorita hermosa", "Magnifica", "la mas bella", "Demasiada espectacular", "Es única",
    "Le aprecio", "Me encanta", "DIVINA",
    "Mas hermosa que usted dificil", "Maravillosa", "Preciosa", "✨", "💖", "🌟", "🫶"
  ];

  const isMobile = matchMedia("(pointer: coarse)").matches || innerWidth < 700;
  const GALAXY_COUNT = isMobile ? 22000 : 38000;
  const HEART_COUNT = isMobile ? 3500 : 5500;
  const BEAM_COUNT = isMobile ? 900 : 1400;
  const FAR_STARS = isMobile ? 600 : 1000;
  const GALAXY_RADIUS = 300;
  // Brazos espirales que bajan hacia el núcleo. Subirlo los multiplica y los
  // adelgaza en proporción (ver `spread` más abajo), para que sigan leyéndose
  // como hilos separados en vez de fundirse en un disco.
  const ARMS = 6;
  // Parte de las partículas que forma los brazos. Con más brazos hay que repartir
  // entre más, así que esta fracción sube para que cada uno conserve densidad.
  const ARM_SHARE = 0.74;
  const HEART_Y = 175;
  const HEART_SCALE = 5;

  // Línea de tiempo de la intro (segundos)
  const WARP_END = 3.2;      // fin del túnel de estrellas
  const HOLD_END = 6.8;      // la galaxia sola, vista de lado
  const REVEAL_TIME = 4.5;   // aparecen corazón, fotos y frases

  // ---------- Canvas ----------
  const canvas = document.getElementById("scene");
  const ctx = canvas.getContext("2d");
  const bg = document.createElement("canvas");
  const bgCtx = bg.getContext("2d");

  // Buffer de partículas: se acumula luz por píxel y luego se pinta de una vez
  const pc = document.createElement("canvas");
  const pctx = pc.getContext("2d");
  const bloom1 = document.createElement("canvas");
  const bloom2 = document.createElement("canvas");
  const b1ctx = bloom1.getContext("2d");
  const b2ctx = bloom2.getContext("2d");
  let acc, imgData, pix32, BW = 0, BH = 0, RS = 1;

  let W = 0, H = 0, DPR = 1, F = 600;

  function resize() {
    DPR = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth;
    H = innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    bg.width = canvas.width;
    bg.height = canvas.height;
    F = Math.max(W, H) * 0.7;
    if (!introDone) cam.targetDist = W < H ? 720 : 640;

    // Resolución del buffer limitada para que vaya fluido en pantallas grandes
    RS = clamp(Math.sqrt(2.2e6 / (W * H)), 0.7, Math.min(DPR, 1.5));
    BW = Math.ceil(W * RS);
    BH = Math.ceil(H * RS);
    pc.width = BW;
    pc.height = BH;
    acc = new Float32Array(BW * BH * 3);
    imgData = pctx.createImageData(BW, BH);
    pix32 = new Uint32Array(imgData.data.buffer);
    bloom1.width = Math.ceil(BW / 4);
    bloom1.height = Math.ceil(BH / 4);
    bloom2.width = Math.ceil(BW / 10);
    bloom2.height = Math.ceil(BH / 10);

    paintBackground();
  }

  // Nebulosas y estrellas estáticas del fondo
  function paintBackground() {
    const c = bgCtx;
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    c.fillStyle = "#04010a";
    c.fillRect(0, 0, W, H);
    const blobs = [
      [0.18, 0.2, 0.45, "rgba(150, 60, 220, 0.20)"],
      [0.82, 0.15, 0.4, "rgba(230, 70, 160, 0.13)"],
      [0.12, 0.85, 0.5, "rgba(50, 170, 190, 0.12)"],
      [0.88, 0.85, 0.45, "rgba(200, 60, 200, 0.16)"],
      [0.5, 0.55, 0.6, "rgba(80, 40, 150, 0.12)"]
    ];
    const m = Math.max(W, H);
    for (const [x, y, r, col] of blobs) {
      const g = c.createRadialGradient(x * W, y * H, 0, x * W, y * H, r * m);
      g.addColorStop(0, col);
      g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
    }
    for (let i = 0; i < (W * H) / 2200; i++) {
      c.fillStyle = `rgba(255,255,255,${Math.random() * 0.5 + 0.1})`;
      const s = Math.random() < 0.96 ? 0.8 : 1.5;
      c.fillRect(Math.random() * W, Math.random() * H, s, s);
    }
  }

  // ---------- Utilidades ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const randn = () => {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  // Suma luz a un píxel del buffer, repartida entre 4 vecinos (movimiento suave)
  function splat(x, y, r, g, b) {
    const px = x * RS - 0.5, py = y * RS - 0.5;
    const ix = px | 0, iy = py | 0;
    if (px < 0 || py < 0 || ix >= BW - 1 || iy >= BH - 1) return;
    const fx = px - ix, fy = py - iy;
    const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
    let o = (iy * BW + ix) * 3;
    acc[o] += r * w00; acc[o + 1] += g * w00; acc[o + 2] += b * w00;
    acc[o + 3] += r * w10; acc[o + 4] += g * w10; acc[o + 5] += b * w10;
    o += BW * 3;
    acc[o] += r * w01; acc[o + 1] += g * w01; acc[o + 2] += b * w01;
    acc[o + 3] += r * w11; acc[o + 4] += g * w11; acc[o + 5] += b * w11;
  }

  // Pasa el buffer a la pantalla con un resplandor (bloom) barato
  function flushParticles() {
    const n = BW * BH;
    for (let i = 0, o = 0; i < n; i++, o += 3) {
      let r = acc[o], g = acc[o + 1], b = acc[o + 2];
      r = r > 255 ? 255 : r | 0;
      g = g > 255 ? 255 : g | 0;
      b = b > 255 ? 255 : b | 0;
      pix32[i] = 0xff000000 | (b << 16) | (g << 8) | r;
    }
    acc.fill(0);
    pctx.putImageData(imgData, 0, 0);

    b1ctx.clearRect(0, 0, bloom1.width, bloom1.height);
    b1ctx.drawImage(pc, 0, 0, bloom1.width, bloom1.height);
    b2ctx.clearRect(0, 0, bloom2.width, bloom2.height);
    b2ctx.drawImage(bloom1, 0, 0, bloom2.width, bloom2.height);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(pc, 0, 0, W, H);
    ctx.globalAlpha = 0.55;
    ctx.drawImage(bloom1, 0, 0, W, H);
    ctx.globalAlpha = 0.35;
    ctx.drawImage(bloom2, 0, 0, W, H);
    ctx.restore();
  }

  // ---------- Cámara ----------
  const cam = {
    yaw: 0.6, pitch: 0.1, dist: 2400,
    targetPitch: 0.55, targetDist: 640,
    ty: 60, cy: 1, sy: 0, cp: 1, sp: 0
  };
  const P = { x: 0, y: 0, z: 0, s: 0 };

  function updateCam() {
    cam.cy = Math.cos(cam.yaw);
    cam.sy = Math.sin(cam.yaw);
    cam.cp = Math.cos(cam.pitch);
    cam.sp = Math.sin(cam.pitch);
  }

  // Proyecta un punto 3D en pantalla. Devuelve false si queda detrás de la cámara.
  function project(x, y, z) {
    y -= cam.ty;
    const x1 = x * cam.cy - z * cam.sy;
    const z1 = x * cam.sy + z * cam.cy;
    const y2 = y * cam.cp + z1 * cam.sp;
    const z2 = -y * cam.sp + z1 * cam.cp + cam.dist;
    if (z2 < 20) return false;
    const s = F / z2;
    P.x = W / 2 + x1 * s;
    P.y = H / 2 - y2 * s;
    P.z = z2;
    P.s = s;
    return true;
  }

  // ---------- Galaxia ----------
  const gal = {
    r: new Float32Array(GALAXY_COUNT),
    a: new Float32Array(GALAXY_COUNT),
    y: new Float32Array(GALAXY_COUNT),
    w: new Float32Array(GALAXY_COUNT),
    cr: new Float32Array(GALAXY_COUNT),
    cg: new Float32Array(GALAXY_COUNT),
    cb: new Float32Array(GALAXY_COUNT)
  };
  const OUTER_COLORS = [
    [150, 235, 225], // turquesa
    [150, 235, 225],
    [170, 240, 230],
    [190, 165, 255], // lavanda
    [255, 150, 215], // rosa
    [235, 235, 255]  // blanco azulado
  ];
  for (let i = 0; i < GALAXY_COUNT; i++) {
    const kind = Math.random();
    let r, a, y, col;
    if (kind < 0.08) {
      // Bulbo central
      r = Math.abs(randn()) * 22;
      a = Math.random() * Math.PI * 2;
      y = randn() * 9;
      col = [255, 245, 250];
    } else if (kind < ARM_SHARE) {
      // Brazos espirales bien definidos, repartidos por igual alrededor del eje
      r = Math.pow(Math.random(), 1.4) * GALAXY_RADIUS + 6;
      const arm = i % ARMS;
      // El grosor se escala con el número de brazos. Con 2 el hueco entre ellos
      // era de 180°; con 6 es de 60°, así que mantener la dispersión original
      // los solaparía. Dividir entre ARMS/2 conserva la misma proporción de
      // grosor a hueco que tenían los dos primeros.
      const spread = (0.07 + 0.3 * (r / GALAXY_RADIUS)) * (2 / ARMS);
      a = arm * ((Math.PI * 2) / ARMS) + Math.log(r / 8) * 1.55 + randn() * spread;
      y = randn() * (2 + 10 * Math.exp(-r / 40));
      col = r < 110 ? [235, 220, 245] : OUTER_COLORS[(Math.random() * OUTER_COLORS.length) | 0];
    } else {
      // Polvo del disco
      r = Math.pow(Math.random(), 0.8) * GALAXY_RADIUS * 1.1;
      a = Math.random() * Math.PI * 2;
      y = randn() * (3 + 8 * Math.exp(-r / 60));
      col = OUTER_COLORS[(Math.random() * OUTER_COLORS.length) | 0];
    }
    // Mismo umbral que la rama de arriba: si los dos se separan, las partículas
    // de brazo salen con el brillo tenue del polvo y los brazos desaparecen.
    const k = (kind < ARM_SHARE ? (r < 110 ? 0.55 : 0.7) : 0.26) * rand(0.6, 1.2);
    gal.r[i] = r;
    gal.a[i] = a;
    gal.y[i] = y;
    gal.w[i] = 0.3 / (1 + r / 80);
    gal.cr[i] = col[0] * k;
    gal.cg[i] = col[1] * k;
    gal.cb[i] = col[2] * k;
  }

  // Estrellas lejanas en una esfera (dan profundidad al girar)
  const farStars = [];
  for (let i = 0; i < FAR_STARS; i++) {
    const u = Math.random() * 2 - 1;
    const t = Math.random() * Math.PI * 2;
    const R = rand(1500, 2300);
    const k = Math.sqrt(1 - u * u);
    farStars.push({ x: R * k * Math.cos(t), y: R * u, z: R * k * Math.sin(t), ph: Math.random() * 6.28, s: rand(0.7, 1.6) });
  }

  // ---------- Corazón de polvo ----------
  const heart = [];
  function heartXY(t) {
    return [
      16 * Math.pow(Math.sin(t), 3),
      13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
    ];
  }
  for (let i = 0; i < HEART_COUNT; i++) {
    const t = Math.random() * Math.PI * 2;
    const [hx, hy] = heartXY(t);
    const edge = Math.random() < 0.88;
    const jitter = edge ? 2.6 + Math.abs(randn()) * 2 : 3;
    const f = edge ? 1 : 0.4 + Math.random() * 0.55;
    const pink = Math.random() < 0.25;
    const k = rand(0.9, 1.5);
    heart.push({
      x: hx * HEART_SCALE * f + randn() * jitter,
      y: hy * HEART_SCALE * f + randn() * jitter,
      // Punto de partida: el núcleo de la galaxia
      sx: randn() * 12,
      sy: -HEART_Y + randn() * 6,
      delay: rand(0, 1.6),
      ph: Math.random() * 6.28,
      r: (pink ? 255 : 255) * k,
      g: (pink ? 160 : 235) * k,
      b: (pink ? 220 : 248) * k
    });
  }
  const HEART_TIP = -17 * HEART_SCALE; // punta del corazón en coordenadas locales

  // Haz de polvo que une el núcleo con la punta del corazón
  const beam = [];
  for (let i = 0; i < BEAM_COUNT; i++) {
    beam.push({ p: Math.random(), sp: rand(0.08, 0.2), a: Math.random() * 6.28, r: Math.abs(randn()) * 4 });
  }

  // ---------- Fotos y frases flotantes ----------
  const items = [];
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  let loadedCount = 0;

  PHOTOS.forEach((src, i) => {
    const img = new Image();
    const item = {
      type: "photo", idx: i, img: null, aspect: 1,
      angle: i * GOLDEN * 2.3 + rand(-0.2, 0.2),
      radius: 160 + (i % 4) * 60 + rand(-15, 15),
      y: rand(-30, 200),
      bob: Math.random() * 6.28,
      size: rand(36, 46)
    };
    const done = () => { loadedCount++; };
    img.onload = () => {
      // Miniatura recortada en cuadrado para dibujar rápido
      const side = Math.min(img.width, img.height);
      const c = document.createElement("canvas");
      c.width = c.height = 220;
      c.getContext("2d").drawImage(
        img, (img.width - side) / 2, (img.height - side) / 2.6, side, side, 0, 0, 220, 220
      );
      item.img = c;
      done();
    };
    img.onerror = done;
    img.src = src;
    items.push(item);
  });

  PHRASES.forEach((text, i) => {
    items.push({
      type: "text", text,
      angle: i * GOLDEN * 1.7 + 1.1,
      radius: rand(120, 400),
      y: rand(-40, 210),
      bob: Math.random() * 6.28,
      size: text.length <= 2 ? rand(12, 16) : rand(8, 11)
    });
  });
  // Orden de aparición escalonado
  items.forEach((it) => { it.delay = rand(0.8, 2.8); });

  // ---------- Intro: estrellas hacia la pantalla ----------
  const warp = [];
  for (let i = 0; i < (isMobile ? 500 : 900); i++) {
    warp.push({ x: rand(-1, 1), y: rand(-1, 1), z: rand(0.05, 1), c: Math.random() < 0.25 ? "#ffb3dd" : "#ffffff" });
  }

  function drawWarp(t, dt, alpha) {
    const speed = 0.15 + 2.6 * easeInOut(clamp(t / 2.4, 0, 1));
    const cx = W / 2, cy = H / 2, fw = Math.max(W, H) * 0.15;
    ctx.globalAlpha = alpha;
    ctx.lineCap = "round";
    for (const s of warp) {
      const pz = s.z;
      s.z -= speed * dt;
      if (s.z <= 0.01) {
        s.x = rand(-1, 1);
        s.y = rand(-1, 1);
        s.z = 1;
        continue;
      }
      ctx.strokeStyle = s.c;
      ctx.lineWidth = clamp((1 - s.z) * 3, 0.4, 3);
      ctx.beginPath();
      ctx.moveTo(cx + (s.x / pz) * fw, cy + (s.y / pz) * fw);
      ctx.lineTo(cx + (s.x / s.z) * fw, cy + (s.y / s.z) * fw);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- Dibujo de la escena ----------
  const hitBoxes = [];

  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // alpha: opacidad general de la escena. reveal: segundos desde que empezó a aparecer el contenido
  function drawScene(time, alpha, reveal) {
    updateCam();

    // Estrellas lejanas
    ctx.fillStyle = "#ffffff";
    for (const s of farStars) {
      if (!project(s.x, s.y, s.z)) continue;
      if (P.x < 0 || P.x > W || P.y < 0 || P.y > H) continue;
      ctx.globalAlpha = alpha * (0.4 + 0.4 * Math.sin(time * 2 + s.ph));
      ctx.fillRect(P.x, P.y, s.s, s.s);
    }

    // Resplandor del núcleo
    if (project(0, 0, 0)) {
      const flat = Math.max(0.2, Math.abs(cam.sp));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(P.x, P.y);
      ctx.scale(1, flat);
      const r1 = GALAXY_RADIUS * 1.3 * P.s;
      let g = ctx.createRadialGradient(0, 0, 0, 0, 0, r1);
      g.addColorStop(0, "rgba(190,130,255,0.30)");
      g.addColorStop(0.45, "rgba(120,70,200,0.10)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ---- Partículas al buffer ----
    // Galaxia
    for (let i = 0; i < GALAXY_COUNT; i++) {
      const a = gal.a[i] + time * gal.w[i];
      const r = gal.r[i];
      if (!project(Math.cos(a) * r, gal.y[i], Math.sin(a) * r)) continue;
      const k = alpha * clamp(P.s * 1.1, 0.5, 1.8);
      splat(P.x, P.y, gal.cr[i] * k, gal.cg[i] * k, gal.cb[i] * k);
    }

    const heartK = clamp(reveal / 1.2, 0, 1);

    // Haz del núcleo a la punta del corazón
    if (heartK > 0) {
      const top = HEART_Y + HEART_TIP;
      for (const p of beam) {
        const prog = (p.p + time * p.sp) % 1;
        const rr = p.r * (1 - prog * 0.5);
        if (!project(Math.cos(p.a + time) * rr, prog * top, Math.sin(p.a + time) * rr)) continue;
        const k = alpha * heartK * (0.4 + 0.6 * Math.sin(prog * Math.PI)) * 0.7;
        splat(P.x, P.y, 255 * k, 230 * k, 250 * k);
      }
    }

    // Corazón (siempre de frente a la cámara); el polvo sube desde el núcleo
    let heartScreen = null;
    if (heartK > 0 && project(0, HEART_Y, 0)) {
      const hx = P.x, hy = P.y, hs = P.s;
      heartScreen = { x: hx, y: hy, s: hs };
      const beat = 1 + 0.04 * Math.pow(Math.abs(Math.sin(time * 2.2)), 6);
      for (const p of heart) {
        const t = easeInOut(clamp((reveal - p.delay) / 1.6, 0, 1));
        if (t <= 0) continue;
        const lx = lerp(p.sx, p.x * beat, t);
        const ly = lerp(p.sy, p.y * beat, t);
        const tw = alpha * (0.6 + 0.4 * Math.sin(time * 3 + p.ph)) * Math.min(1, t * 3);
        splat(hx + lx * hs, hy - ly * hs, p.r * tw, p.g * tw, p.b * tw);
      }
    }

    flushParticles();

    // Halo blanco del bulbo, sobre las partículas
    if (project(0, 4, 0)) {
      const flat = Math.max(0.2, Math.abs(cam.sp));
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = alpha;
      ctx.translate(P.x, P.y);
      ctx.scale(1, Math.min(0.85, flat * 1.9));
      const r2 = 105 * P.s;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r2);
      g.addColorStop(0, "rgba(255,255,255,0.55)");
      g.addColorStop(0.3, "rgba(235,220,255,0.22)");
      g.addColorStop(1, "rgba(180,160,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ---- Fotos y frases, ordenadas por profundidad ----
    const drawList = [];
    for (const it of items) {
      const k = easeOutCubic(clamp((reveal - it.delay) / 1.5, 0, 1));
      if (k <= 0) continue;
      const a = it.angle + time * (0.08 * 160 / it.radius);
      const rad = it.radius * (0.15 + 0.85 * k);
      const y = it.y * k + Math.sin(time * 0.9 + it.bob) * 6;
      if (!project(Math.cos(a) * rad, y, Math.sin(a) * rad)) continue;
      drawList.push({ it, k, x: P.x, y: P.y, z: P.z, s: P.s });
    }
    drawList.sort((p, q) => q.z - p.z);

    hitBoxes.length = 0;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const d of drawList) {
      const it = d.it;
      const fog = clamp(1.3 - (d.z - cam.dist) / 550, 0.3, 1) * d.k * alpha;
      if (it.type === "photo") {
        if (!it.img) continue;
        const w = it.size * d.s * (0.4 + 0.6 * d.k);
        const x = d.x - w / 2, y = d.y - w / 2;
        const rr = w * 0.18;
        ctx.globalAlpha = fog;
        // Marco fino con brillo rosa
        ctx.shadowColor = "rgba(255,140,210,0.9)";
        ctx.shadowBlur = 12;
        ctx.fillStyle = "rgba(255,240,250,0.9)";
        roundRectPath(x - 1.5, y - 1.5, w + 3, w + 3, rr + 1.5);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.save();
        roundRectPath(x, y, w, w, rr);
        ctx.clip();
        ctx.drawImage(it.img, x, y, w, w);
        ctx.restore();
        hitBoxes.push({ idx: it.idx, x: x - 4, y: y - 4, w: w + 8, h: w + 8 });
      } else {
        const fs = it.size * d.s;
        if (fs < 4) continue;
        ctx.globalAlpha = fog * 0.9;
        ctx.font = `500 ${fs}px "Segoe UI", system-ui, sans-serif`;
        ctx.shadowColor = "#ff6fb5";
        ctx.shadowBlur = 8;
        ctx.fillStyle = "#ffeaf6";
        ctx.fillText(it.text, d.x, d.y);
        ctx.shadowBlur = 0;
      }
    }

    // Texto central, encima de todo
    const titleK = clamp((reveal - 1.8) / 1.2, 0, 1);
    if (heartScreen && titleK > 0) {
      const { x, y, s } = heartScreen;
      ctx.globalAlpha = alpha * titleK;
      const fs = Math.max(15, 21 * s);
      ctx.font = `italic bold ${fs}px Georgia, "Times New Roman", serif`;
      ctx.shadowColor = "#ff5fb0";
      ctx.shadowBlur = 16;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(TITLE, x, y + 6 * s);
      ctx.fillText(TITLE, x, y + 6 * s);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }

  // ---------- Interacción ----------
  const pointers = new Map();
  let dragMoved = 0, lastInteract = -10, pinchDist = 0;
  let introDone = false;

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragMoved = 0;
    if (pointers.size === 2) pinchDist = pinchLength();
    canvas.classList.add("dragging");
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) {
      if (introDone) canvas.classList.toggle("over-photo", hitTest(e.clientX, e.clientY) >= 0);
      return;
    }
    const prev = pointers.get(e.pointerId);
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragMoved += Math.abs(dx) + Math.abs(dy);
    if (!introDone) return;
    lastInteract = clock;
    if (pointers.size === 1) {
      cam.yaw -= dx * 0.005;
      cam.targetPitch = clamp(cam.targetPitch + dy * 0.004, 0.02, 1.25);
    } else if (pointers.size === 2) {
      const d = pinchLength();
      if (pinchDist) cam.targetDist = clamp(cam.targetDist * (pinchDist / d), 300, 1500);
      pinchDist = d;
    }
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (pointers.size === 0) canvas.classList.remove("dragging");
    if (e.type === "pointerup" && dragMoved < 8 && revealStart !== null) {
      const idx = hitTest(e.clientX, e.clientY);
      if (idx >= 0) openLightbox(idx);
    }
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (!introDone) return;
    cam.targetDist = clamp(cam.targetDist * (1 + e.deltaY * 0.001), 300, 1500);
    lastInteract = clock;
  }, { passive: false });

  function pinchLength() {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  }

  // La foto más cercana a la cámara se dibuja al final, por eso se busca de atrás hacia adelante
  function hitTest(x, y) {
    for (let i = hitBoxes.length - 1; i >= 0; i--) {
      const b = hitBoxes[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.idx;
    }
    return -1;
  }

  // ---------- Visor ----------
  const lb = document.getElementById("lightbox");
  const lbImg = document.getElementById("lb-img");
  const lbCount = document.getElementById("lb-count");
  let lbIndex = 0;

  function openLightbox(i) {
    lbIndex = (i + PHOTO_COUNT) % PHOTO_COUNT;
    lbImg.src = PHOTOS[lbIndex];
    lbCount.textContent = `${lbIndex + 1} / ${PHOTO_COUNT}`;
    lb.classList.add("open");
    lb.setAttribute("aria-hidden", "false");
  }
  function closeLightbox() {
    lb.classList.remove("open");
    lb.setAttribute("aria-hidden", "true");
  }
  const isOpen = () => lb.classList.contains("open");

  lb.querySelector(".lb-close").addEventListener("click", closeLightbox);
  lb.querySelector(".lb-prev").addEventListener("click", (e) => { e.stopPropagation(); openLightbox(lbIndex - 1); });
  lb.querySelector(".lb-next").addEventListener("click", (e) => { e.stopPropagation(); openLightbox(lbIndex + 1); });
  lb.addEventListener("click", (e) => { if (e.target === lb) closeLightbox(); });

  addEventListener("keydown", (e) => {
    if (!isOpen()) return;
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowLeft") openLightbox(lbIndex - 1);
    else if (e.key === "ArrowRight") openLightbox(lbIndex + 1);
  });

  // Deslizar en el visor para cambiar de foto
  let swipeX = null;
  lb.addEventListener("touchstart", (e) => { swipeX = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener("touchend", (e) => {
    if (swipeX === null) return;
    const dx = e.changedTouches[0].clientX - swipeX;
    if (Math.abs(dx) > 50) openLightbox(lbIndex + (dx < 0 ? 1 : -1));
    swipeX = null;
  });

  // ---------- Bucle principal ----------
  const hint = document.getElementById("hint");
  let clock = 0, last = performance.now();
  let revealStart = null;
  let revealFrom = null;

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    clock += dt;

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    if (clock < WARP_END) {
      // 1. Túnel de estrellas; al final aparece la galaxia a lo lejos
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, W, H);
      const sceneAlpha = clamp((clock - 2.4) / 0.8, 0, 1);
      if (sceneAlpha > 0) {
        ctx.globalAlpha = sceneAlpha;
        ctx.drawImage(bg, 0, 0, W, H);
        ctx.globalAlpha = 1;
        cam.yaw += dt * 0.1;
        drawScene(clock, sceneAlpha, 0);
      }
      drawWarp(clock, dt, 1 - sceneAlpha);
      requestAnimationFrame(frame);
      return;
    }

    ctx.drawImage(bg, 0, 0, W, H);

    // 2. Galaxia sola, vista casi de lado, acercándose despacio
    if (revealStart === null) {
      const k = easeOutCubic(clamp((clock - WARP_END) / (HOLD_END - WARP_END), 0, 1));
      cam.dist = lerp(2400, 1050, k);
      cam.pitch = lerp(0.1, 0.2, k);
      cam.yaw += dt * 0.1;
      // Espera a que las fotos estén cargadas (máximo 6 s extra)
      if (clock >= HOLD_END && (loadedCount >= PHOTO_COUNT || clock > HOLD_END + 6)) {
        revealStart = clock;
        revealFrom = { dist: cam.dist, pitch: cam.pitch };
      }
    }

    // 3. Sube la cámara y aparecen corazón, fotos y frases
    const reveal = revealStart === null ? 0 : clock - revealStart;
    if (revealStart !== null && !introDone) {
      const k = easeInOut(clamp(reveal / REVEAL_TIME, 0, 1));
      cam.dist = lerp(revealFrom.dist, cam.targetDist, k);
      cam.pitch = lerp(revealFrom.pitch, cam.targetPitch, k);
      cam.yaw += dt * 0.1;
      if (reveal >= REVEAL_TIME) {
        introDone = true;
        hint.classList.add("show");
        setTimeout(() => hint.classList.remove("show"), 6000);
      }
    } else if (introDone) {
      cam.dist += (cam.targetDist - cam.dist) * Math.min(1, dt * 5);
      cam.pitch += (cam.targetPitch - cam.pitch) * Math.min(1, dt * 5);
      // Giro automático cuando no se está tocando
      if (pointers.size === 0 && !isOpen() && clock - lastInteract > 2.5) cam.yaw += dt * 0.1;
    }

    drawScene(clock, 1, reveal);
    requestAnimationFrame(frame);
  }

  addEventListener("resize", resize);
  resize();
  requestAnimationFrame((t) => { last = t; frame(t); });
})();
