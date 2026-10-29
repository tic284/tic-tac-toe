/* Bubble Pop — a bubble shooter */
(() => {
  'use strict';

  /* ---------- Board geometry ---------- */
  const W = 520;
  const H = 720;
  const COLS = 11;
  const R = 22;
  const ROW_H = Math.sqrt(3) * R;
  const LEFT = (W - COLS * 2 * R) / 2;
  const TOP = 10;
  const SHOOTER = { x: W / 2, y: H - 52 };
  const PLAY_BOTTOM = SHOOTER.y - 70;
  const MAX_ROWS = Math.floor((PLAY_BOTTOM - TOP - R) / ROW_H) + 1;
  const DANGER = TOP + R + (MAX_ROWS - 2) * ROW_H + R + 4;
  const RIGHT_C = LEFT + COLS * 2 * R - R;
  const SPEED = 1180;

  const COLORS = [
    { main: '#ff5c7a', light: '#ffc2cf', dark: '#a3103a' },
    { main: '#ffa64d', light: '#ffe0b8', dark: '#a8570a' },
    { main: '#ffd93d', light: '#fff3b0', dark: '#a87d00' },
    { main: '#3ddc84', light: '#c2ffd9', dark: '#0d7a40' },
    { main: '#4d9dff', light: '#c3dcff', dark: '#1146a8' },
    { main: '#b06cff', light: '#e2c9ff', dark: '#5b1fa8' }
  ];

  /* ---------- State ---------- */
  let grid = [];
  let status = 'idle';           // idle | ready | flying | paused | over | clear
  let pausedFrom = 'ready';
  let level = 1;
  let score = 0;
  let best = 0;
  let shots = 0;
  let palette = 4;
  let current = 0;
  let next = 0;
  let aimAngle = -Math.PI / 2;
  let projectile = null;
  let particles = [];
  let falling = [];
  let texts = [];
  let lastTime = 0;
  let soundOn = true;
  let audio = null;

  /* ---------- DOM ---------- */
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const levelEl = document.getElementById('level');
  const bestEl = document.getElementById('best');
  const muteBtn = document.getElementById('btn-mute');

  const overlays = {
    start: document.getElementById('overlay-start'),
    over: document.getElementById('overlay-over'),
    clear: document.getElementById('overlay-clear'),
    pause: document.getElementById('overlay-pause')
  };

  const colCount = (r) => (r % 2 === 0 ? COLS : COLS - 1);
  const cellX = (r, c) => LEFT + R + c * 2 * R + (r % 2 ? R : 0);
  const cellY = (r) => TOP + R + r * ROW_H;
  const clampAngle = (a) => Math.max(-Math.PI + 0.22, Math.min(-0.22, a));
  const key = (r, c) => r * 100 + c;

  /* ---------- Storage + sound ---------- */
  try {
    best = Number(localStorage.getItem('bubble-best')) || 0;
    soundOn = localStorage.getItem('bubble-sound') !== 'off';
  } catch (err) { /* storage blocked */ }

  function saveBest() {
    try { localStorage.setItem('bubble-best', String(best)); } catch (err) { /* ignore */ }
  }

  function audioCtx() {
    if (audio === false) return null;
    if (!audio) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { audio = false; return null; }
      try { audio = new AC(); } catch (err) { audio = false; return null; }
    }
    return audio;
  }

  function beep(freq, dur, type, vol, slide) {
    if (!soundOn) return;
    const ac = audioCtx();
    if (!ac) return;
    if (ac.state === 'suspended') ac.resume();
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(45, freq + slide), t + (dur || 0.08));
    gain.gain.setValueAtTime(vol || 0.04, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.08));
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t);
    osc.stop(t + (dur || 0.08) + 0.03);
  }

  /* ---------- Canvas ---------- */
  function fitCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
  }

  function pointerPos(ev) {
    const box = canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - box.left) * (W / box.width),
      y: (ev.clientY - box.top) * (H / box.height)
    };
  }

  /* ---------- Grid ---------- */
  function makeGrid() {
    grid = Array.from({ length: MAX_ROWS }, (_, r) => Array(colCount(r)).fill(null));
  }

  function initLevelGrid(lv) {
    makeGrid();
    const rows = Math.min(5 + (lv - 1), 9);
    palette = Math.min(4 + Math.floor((lv - 1) / 2), COLORS.length);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < colCount(r); c += 1) {
        if (Math.random() < 0.9) grid[r][c] = Math.floor(Math.random() * palette);
      }
    }
    // Guarantee at least one bubble in the top row.
    if (grid[0].every((v) => v === null)) grid[0][Math.floor(COLS / 2)] = Math.floor(Math.random() * palette);
  }

  function neighbors(r, c) {
    const odd = r % 2 === 1;
    const dirs = odd
      ? [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]]
      : [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]];
    const out = [];
    for (const [dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < MAX_ROWS && nc >= 0 && nc < colCount(nr)) out.push([nr, nc]);
    }
    return out;
  }

  function hasNeighborBubble(r, c) {
    return neighbors(r, c).some(([nr, nc]) => grid[nr][nc] !== null);
  }

  function findOpenCell(px, py) {
    let bestCell = null;
    let bestDist = Infinity;
    for (let r = 0; r < MAX_ROWS; r += 1) {
      for (let c = 0; c < colCount(r); c += 1) {
        if (grid[r][c] !== null) continue;
        if (r !== 0 && !hasNeighborBubble(r, c)) continue;
        const x = cellX(r, c);
        const y = cellY(r);
        const d = (x - px) * (x - px) + (y - py) * (y - py);
        if (d < bestDist) {
          bestDist = d;
          bestCell = { r, c };
        }
      }
    }
    return bestCell;
  }

  function countBubbles() {
    let n = 0;
    for (let r = 0; r < MAX_ROWS; r += 1) {
      for (let c = 0; c < colCount(r); c += 1) if (grid[r][c] !== null) n += 1;
    }
    return n;
  }

  function boardColors() {
    const set = new Set();
    for (let r = 0; r < MAX_ROWS; r += 1) {
      for (let c = 0; c < colCount(r); c += 1) if (grid[r][c] !== null) set.add(grid[r][c]);
    }
    return Array.from(set);
  }

  function pickBoardColor() {
    const opts = boardColors();
    if (!opts.length) return Math.floor(Math.random() * palette);
    return opts[Math.floor(Math.random() * opts.length)];
  }

  function findMatches(r, c) {
    const color = grid[r][c];
    if (color === null) return [];
    const seen = new Set([key(r, c)]);
    const out = [[r, c]];
    const stack = [[r, c]];
    while (stack.length) {
      const [cr, cc] = stack.pop();
      for (const [nr, nc] of neighbors(cr, cc)) {
        if (grid[nr][nc] !== color) continue;
        if (seen.has(key(nr, nc))) continue;
        seen.add(key(nr, nc));
        out.push([nr, nc]);
        stack.push([nr, nc]);
      }
    }
    return out;
  }

  function findFloating() {
    const seen = new Set();
    const stack = [];
    for (let c = 0; c < colCount(0); c += 1) {
      if (grid[0][c] !== null) {
        seen.add(key(0, c));
        stack.push([0, c]);
      }
    }
    while (stack.length) {
      const [r, c] = stack.pop();
      for (const [nr, nc] of neighbors(r, c)) {
        if (grid[nr][nc] === null || seen.has(key(nr, nc))) continue;
        seen.add(key(nr, nc));
        stack.push([nr, nc]);
      }
    }
    const out = [];
    for (let r = 0; r < MAX_ROWS; r += 1) {
      for (let c = 0; c < colCount(r); c += 1) {
        if (grid[r][c] !== null && !seen.has(key(r, c))) out.push([r, c]);
      }
    }
    return out;
  }

  function isDanger() {
    for (let r = 0; r < MAX_ROWS; r += 1) {
      if (cellY(r) + R <= DANGER) continue;
      for (let c = 0; c < colCount(r); c += 1) if (grid[r][c] !== null) return true;
    }
    return false;
  }

  /* ---------- Effects ---------- */

  function burst(x, y, colorIdx) {
    const c = COLORS[colorIdx] || COLORS[0];
    const n = 10 + Math.floor(Math.random() * 5);
    for (let i = 0; i < n; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const sp = 70 + Math.random() * 210;
      particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 40,
        life: 0.35 + Math.random() * 0.4,
        max: 0.75,
        size: 2 + Math.random() * 4,
        color: Math.random() < 0.3 ? c.light : c.main
      });
    }
  }

  function floatText(x, y, text, color) {
    texts.push({ x, y, text, color: color || '#ffffff', life: 1, max: 1 });
  }

  function addScore(n, x, y, label) {
    if (n <= 0) return;
    score += n;
    if (score > best) {
      best = score;
      saveBest();
    }
    bestEl.textContent = best;
    scoreEl.textContent = score;
    if (x != null) floatText(x, y, label || '+' + n, '#ffe38a');
  }

  /* ---------- Turn flow ---------- */

  function shoot() {
    if (status !== 'ready') return;
    const a = clampAngle(aimAngle);
    projectile = {
      x: SHOOTER.x,
      y: SHOOTER.y,
      vx: Math.cos(a) * SPEED,
      vy: Math.sin(a) * SPEED,
      color: current,
      trail: []
    };
    status = 'flying';
    shots += 1;
    beep(420, 0.09, 'triangle', 0.045, -160);
  }

  function nearestEmptyCell(px, py) {
    let bestCell = null;
    let bestDist = Infinity;
    for (let r = 0; r < MAX_ROWS; r += 1) {
      for (let c = 0; c < colCount(r); c += 1) {
        if (grid[r][c] !== null) continue;
        const dx = cellX(r, c) - px;
        const dy = cellY(r) - py;
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
          bestDist = d;
          bestCell = { r, c };
        }
      }
    }
    return bestCell;
  }

  function land(px, py, color) {
    let cell = findOpenCell(px, py);
    if (!cell) cell = nearestEmptyCell(px, py);
    if (!cell) {
      projectile = null;
      status = 'ready';
      return;
    }

    grid[cell.r][cell.c] = color;
    projectile = null;

    const match = findMatches(cell.r, cell.c);
    if (match.length >= 3) {
      let sx = 0;
      let sy = 0;
      match.forEach(([r, c]) => {
        sx += cellX(r, c);
        sy += cellY(r);
        burst(cellX(r, c), cellY(r), grid[r][c]);
        grid[r][c] = null;
      });
      const gain = match.length * 10 + Math.max(0, match.length - 3) * 15;
      addScore(gain, sx / match.length, sy / match.length);
      beep(520 + match.length * 40, 0.14, 'sine', 0.05, 260);

      const loose = findFloating();
      if (loose.length) {
        loose.forEach(([r, c]) => {
          const x = cellX(r, c);
          const y = cellY(r);
          falling.push({
            x, y,
            vx: (Math.random() - 0.5) * 90,
            vy: -60 - Math.random() * 90,
            rot: 0,
            spin: (Math.random() - 0.5) * 6,
            color: grid[r][c]
          });
          grid[r][c] = null;
        });
        const bonus = loose.length * 25;
        addScore(bonus, px, py - 10, '+' + bonus + ' drop');
        setTimeout(() => beep(300, 0.18, 'triangle', 0.05, 200), 90);
      }
    } else {
      beep(260, 0.07, 'square', 0.028, -40);
    }

    if (countBubbles() === 0) {
      levelClear();
    } else if (isDanger()) {
      gameOver();
    } else {
      current = next;
      next = pickBoardColor();
      status = 'ready';
    }
  }

  function stepProjectile(dt) {
    if (!projectile) return;
    const dist = Math.hypot(projectile.vx, projectile.vy) * dt;
    const steps = Math.max(1, Math.ceil(dist / (R * 0.6)));
    const stepDt = dt / steps;
    const minX = LEFT + R;
    const maxX = LEFT + COLS * 2 * R - R;

    for (let s = 0; s < steps; s += 1) {
      const p = projectile;
      p.x += p.vx * stepDt;
      p.y += p.vy * stepDt;
      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > 8) p.trail.shift();

      if (p.x < minX) {
        p.x = minX + (minX - p.x);
        p.vx = Math.abs(p.vx);
        beep(700, 0.05, 'square', 0.02, -80);
      } else if (p.x > maxX) {
        p.x = maxX - (p.x - maxX);
        p.vx = -Math.abs(p.vx);
        beep(700, 0.05, 'square', 0.02, -80);
      }

      if (p.y - R <= TOP) {
        land(p.x, TOP + R, p.color);
        return;
      }

      for (let r = 0; r < MAX_ROWS; r += 1) {
        for (let c = 0; c < colCount(r); c += 1) {
          if (grid[r][c] === null) continue;
          const dx = p.x - cellX(r, c);
          const dy = p.y - cellY(r);
          if (dx * dx + dy * dy < (R * 1.92) * (R * 1.92)) {
            land(p.x, p.y, p.color);
            return;
          }
        }
      }

      if (p.y > H + R) {
        projectile = null;
        status = 'ready';
        return;
      }
    }
  }

  function updateEffects(dt) {
    particles = particles.filter((p) => {
      p.life -= dt;
      if (p.life <= 0) return false;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 620 * dt;
      p.vx *= 0.99;
      return true;
    });

    falling = falling.filter((f) => {
      f.vy += 1400 * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.rot += f.spin * dt;
      if (f.x < LEFT + R || f.x > W - R) f.vx *= -0.6;
      return f.y < H + R * 2;
    });

    texts = texts.filter((t) => {
      t.life -= dt;
      t.y -= 34 * dt;
      return t.life > 0;
    });
  }
  /* ---------- Rendering ---------- */

  const sky = (() => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#111a3d');
    grad.addColorStop(0.55, '#0c1230');
    grad.addColorStop(1, '#080c22');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    for (let i = 0; i < 90; i += 1) {
      const x = Math.random() * W;
      const y = Math.random() * H * 0.9;
      const r = Math.random() * 1.5 + 0.3;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,255,255,' + (0.06 + Math.random() * 0.22).toFixed(2) + ')';
      g.fill();
    }

    const glow = g.createRadialGradient(W / 2, H + 60, 40, W / 2, H + 60, 340);
    glow.addColorStop(0, 'rgba(77,212,255,0.16)');
    glow.addColorStop(1, 'rgba(77,212,255,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);
    return c;
  })();

  function drawBubble(x, y, idx, scale, alpha) {
    const c = COLORS[idx];
    if (!c) return;
    const r = R * (scale == null ? 1 : scale);
    ctx.save();
    if (alpha != null) ctx.globalAlpha = alpha;

    const g = ctx.createRadialGradient(x - r * 0.34, y - r * 0.4, r * 0.12, x, y, r);
    g.addColorStop(0, c.light);
    g.addColorStop(0.52, c.main);
    g.addColorStop(1, c.dark);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.07);
    ctx.strokeStyle = 'rgba(0,0,0,.22)';
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(x - r * 0.3, y - r * 0.36, r * 0.24, r * 0.17, -0.7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,.72)';
    ctx.fill();

    ctx.restore();
  }

  function drawDanger() {
    let nearest = 0;
    for (let r = 0; r < MAX_ROWS; r += 1) {
      for (let c = 0; c < colCount(r); c += 1) {
        if (grid[r][c] !== null && cellY(r) + R > nearest) nearest = cellY(r) + R;
      }
    }
    const close = Math.max(0, Math.min(1, (nearest - (DANGER - 90)) / 90));
    const pulse = 0.28 + 0.3 * close + Math.sin(performance.now() / 320) * 0.08 * close;

    ctx.save();
    ctx.setLineDash([9, 9]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,92,122,' + Math.max(0.16, pulse).toFixed(3) + ')';
    ctx.beginPath();
    ctx.moveTo(LEFT, DANGER);
    ctx.lineTo(LEFT + COLS * 2 * R, DANGER);
    ctx.stroke();
    ctx.restore();
  }

  function hitsBubble(x, y) {
    for (let r = 0; r < MAX_ROWS; r += 1) {
      for (let c = 0; c < colCount(r); c += 1) {
        if (grid[r][c] === null) continue;
        const dx = x - cellX(r, c);
        const dy = y - cellY(r);
        if (dx * dx + dy * dy < (R * 1.9) * (R * 1.9)) return true;
      }
    }
    return false;
  }

  function drawGuide() {
    const minX = LEFT + R;
    const maxX = LEFT + COLS * 2 * R - R;
    let x = SHOOTER.x;
    let y = SHOOTER.y - R;
    const a = clampAngle(aimAngle);
    let dx = Math.cos(a);
    let dy = Math.sin(a);
    const STEP = 10;
    const pts = [];

    for (let i = 0; i < 120; i += 1) {
      x += dx * STEP;
      y += dy * STEP;
      if (x < minX) {
        x = minX + (minX - x);
        dx = -dx;
      } else if (x > maxX) {
        x = maxX - (x - maxX);
        dx = -dx;
      }
      pts.push({ x, y });
      if (y - R <= TOP || hitsBubble(x, y)) break;
    }

    const total = pts.length;
    for (let i = 0; i < total; i += 1) {
      if (i % 2 !== 0) continue;
      const t = i / Math.max(1, total);
      const rr = 2.6 - t * 1.4;
      ctx.beginPath();
      ctx.arc(pts[i].x, pts[i].y, Math.max(1, rr), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(200,232,255,' + (0.5 - t * 0.34).toFixed(3) + ')';
      ctx.fill();
    }

    if (total) {
      const end = pts[total - 1];
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(255,255,255,.5)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(end.x, end.y, R * 0.9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawShooter() {
    const a = clampAngle(aimAngle);
    const bob = Math.sin(performance.now() / 620) * 1.4;

    ctx.save();
    ctx.translate(SHOOTER.x, SHOOTER.y + bob);
    ctx.rotate(a + Math.PI / 2);

    ctx.beginPath();
    ctx.roundRect(-10, -54, 20, 64, 10);
    const barrel = ctx.createLinearGradient(-10, 0, 10, 0);
    barrel.addColorStop(0, '#2b3568');
    barrel.addColorStop(0.45, '#4c5da6');
    barrel.addColorStop(1, '#232a55');
    ctx.fillStyle = barrel;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(140,170,255,.35)';
    ctx.stroke();

    ctx.beginPath();
    ctx.roundRect(-13, -22, 26, 12, 6);
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(SHOOTER.x, SHOOTER.y + bob, 30, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(17,24,54,.92)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(120,150,235,.4)';
    ctx.stroke();

    drawBubble(SHOOTER.x, SHOOTER.y + bob, current, 1);

    const nx = W - 56;
    const ny = H - 44;
    ctx.save();
    ctx.beginPath();
    ctx.arc(nx, ny, 20, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,.05)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.14)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
    drawBubble(nx, ny, next, 0.62);
    ctx.fillStyle = 'rgba(152,162,201,.9)';
    ctx.font = '600 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('NEXT', nx, ny - 28);
    ctx.textAlign = 'left';
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(sky, 0, 0);

    drawDanger();

    for (let r = 0; r < MAX_ROWS; r += 1) {
      for (let c = 0; c < colCount(r); c += 1) {
        if (grid[r][c] !== null) drawBubble(cellX(r, c), cellY(r), grid[r][c], 1);
      }
    }

    falling.forEach((f) => {
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rot);
      drawBubble(0, 0, f.color, 1, 0.92);
      ctx.restore();
    });

    if (status === 'ready') drawGuide();

    if (projectile) {
      projectile.trail.forEach((t, i) => {
        ctx.beginPath();
        ctx.arc(t.x, t.y, R * (0.3 + (i / projectile.trail.length) * 0.55), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(180,215,255,' + (0.05 + (i / projectile.trail.length) * 0.2).toFixed(3) + ')';
        ctx.fill();
      });
      drawBubble(projectile.x, projectile.y, projectile.color, 1);
    }

    drawShooter();

    particles.forEach((p) => {
      const a = Math.max(0, p.life / p.max);
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.5 + a * 0.6), 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    texts.forEach((t) => {
      const a = Math.max(0, Math.min(1, t.life / t.max * 1.6));
      ctx.globalAlpha = a;
      ctx.font = '800 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(8,12,30,.85)';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    });
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }
  /* ---------- Overlays + flow ---------- */

  if (typeof CanvasRenderingContext2D !== 'undefined' &&
      typeof CanvasRenderingContext2D.prototype.roundRect !== 'function') {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      const rad = Math.min(typeof r === 'number' ? r : 0, Math.abs(w) / 2, Math.abs(h) / 2);
      this.moveTo(x + rad, y);
      this.arcTo(x + w, y, x + w, y + h, rad);
      this.arcTo(x + w, y + h, x, y + h, rad);
      this.arcTo(x, y + h, x, y, rad);
      this.arcTo(x, y, x + w, y, rad);
      this.closePath();
      return this;
    };
  }

  function hideOverlays() {
    Object.values(overlays).forEach((el) => { el.hidden = true; });
  }

  function showOverlay(name) {
    hideOverlays();
    if (overlays[name]) overlays[name].hidden = false;
  }

  function startLevel() {
    initLevelGrid(level);
    current = pickBoardColor();
    next = pickBoardColor();
    projectile = null;
    particles = [];
    falling = [];
    texts = [];
    shots = 0;
    status = 'ready';
    levelEl.textContent = level;
    scoreEl.textContent = score;
    bestEl.textContent = best;
    hideOverlays();
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    lastTime = 0;
  }

  function newGame() {
    score = 0;
    level = 1;
    startLevel();
  }

  function levelClear() {
    status = 'clear';
    scoreEl.textContent = score;
    bestEl.textContent = best;
    document.getElementById('clear-level').textContent = level;
    document.getElementById('clear-score').textContent = score;
    document.getElementById('clear-next').textContent = level + 1;
    showOverlay('clear');
    beep(660, 0.12, 'sine', 0.05, 120);
    setTimeout(() => beep(880, 0.14, 'sine', 0.05, 140), 130);
    setTimeout(() => beep(1180, 0.2, 'sine', 0.05, 80), 270);
  }

  function gameOver() {
    status = 'over';
    if (score > best) {
      best = score;
      saveBest();
    }
    scoreEl.textContent = score;
    bestEl.textContent = best;
    document.getElementById('over-score').textContent = score;
    document.getElementById('over-best').textContent = best;
    showOverlay('over');
    beep(220, 0.22, 'sawtooth', 0.045, -120);
    setTimeout(() => beep(150, 0.32, 'sine', 0.045, -60), 180);
  }

  function togglePause() {
    if (status === 'ready' || status === 'flying') {
      pausedFrom = status;
      status = 'paused';
      showOverlay('pause');
    } else if (status === 'paused') {
      status = pausedFrom;
      hideOverlays();
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
      lastTime = 0;
    }
  }

  function toggleMute() {
    soundOn = !soundOn;
    muteBtn.setAttribute('aria-pressed', String(!soundOn));
    muteBtn.textContent = soundOn ? '🔊' : '🔇';
    muteBtn.setAttribute('aria-label', soundOn ? 'Mute sound' : 'Unmute sound');
    try { localStorage.setItem('bubble-sound', soundOn ? 'on' : 'off'); } catch (err) { /* ignore */ }
    if (soundOn) beep(700, 0.08, 'sine', 0.04, 120);
  }

  function swapBubbles() {
    if (status !== 'ready') return;
    const t = current;
    current = next;
    next = t;
    beep(560, 0.07, 'sine', 0.035, 90);
  }

  /* ---------- Input ---------- */

  function aimAt(ev) {
    const p = pointerPos(ev);
    const dx = p.x - SHOOTER.x;
    let dy = p.y - SHOOTER.y;
    if (dy > -14) dy = -14;
    aimAngle = clampAngle(Math.atan2(dy, dx));
  }

  canvas.addEventListener('pointermove', (ev) => {
    if (ev.pointerType === 'touch') return;
    aimAt(ev);
  });

  canvas.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    if (status !== 'ready') return;
    aimAt(ev);
    shoot();
  });

  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

  document.getElementById('start-play').addEventListener('click', newGame);
  document.getElementById('again-play').addEventListener('click', newGame);
  document.getElementById('next-level').addEventListener('click', () => {
    level += 1;
    startLevel();
  });
  document.getElementById('resume-play').addEventListener('click', togglePause);
  document.getElementById('btn-pause').addEventListener('click', togglePause);
  document.getElementById('btn-restart').addEventListener('click', newGame);
  document.getElementById('btn-mute').addEventListener('click', toggleMute);
  document.getElementById('btn-swap').addEventListener('click', swapBubbles);

  document.addEventListener('keydown', (ev) => {
    const tag = document.activeElement ? document.activeElement.tagName : '';
    if (tag === 'BUTTON' && (ev.key === ' ' || ev.key === 'Enter')) return;
    const k = ev.key.toLowerCase();

    if (ev.key === ' ' || ev.key === 'Enter') {
      ev.preventDefault();
      shoot();
    } else if (k === 'p') {
      ev.preventDefault();
      togglePause();
    } else if (k === 's') {
      swapBubbles();
    } else if (k === 'm') {
      toggleMute();
    } else if (k === 'r') {
      newGame();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && (status === 'ready' || status === 'flying')) togglePause();
  });

  window.addEventListener('resize', fitCanvas);

  /* ---------- Loop ---------- */

  function loop(t) {
    const dt = lastTime ? Math.min((t - lastTime) / 1000, 0.034) : 0;
    lastTime = t;
    if (status === 'flying') stepProjectile(dt);
    if (status !== 'paused' && status !== 'idle') updateEffects(dt);
    draw();
    requestAnimationFrame(loop);
  }

  /* ---------- Boot ---------- */

  if (window.__BUBBLE_DEBUG__ || /[?&]debug=1/.test(location.search)) {
    window.__bubble = {
      get state() {
        return {
          status, score, level, best, shots,
          bubbles: countBubbles(),
          current, next, palette,
          aimAngle,
          flying: projectile !== null
        };
      },
      get grid() { return grid.map((row) => row.slice()); },
      get proj() {
        return projectile ? { x: projectile.x, y: projectile.y, vx: projectile.vx, vy: projectile.vy } : null;
      },
      cell: (r, c) => ({ x: cellX(r, c), y: cellY(r) }),
      cols: (r) => colCount(r),
      rows: MAX_ROWS,
      aim: (a) => { aimAngle = clampAngle(a); },
      shoot,
      step: (dt) => {
        if (status === 'flying') stepProjectile(dt);
        updateEffects(dt);
      },
      swap: swapBubbles,
      start: newGame,
      land: (x, y, c) => land(x, y, c),
      setBubble: (cur, nxt) => { current = cur; next = nxt; },
      setCell: (r, c, v) => { grid[r][c] = v; },
      clearBoard: () => {
        for (let r = 0; r < MAX_ROWS; r += 1) {
          for (let c = 0; c < colCount(r); c += 1) grid[r][c] = null;
        }
      },
      fillRow: (r, v) => {
        for (let c = 0; c < colCount(r); c += 1) grid[r][c] = v;
      }
    };
  }

  fitCanvas();
  bestEl.textContent = best;
  scoreEl.textContent = score;
  levelEl.textContent = level;
  muteBtn.textContent = soundOn ? '🔊' : '🔇';
  muteBtn.setAttribute('aria-pressed', String(!soundOn));
  initLevelGrid(level);
  current = pickBoardColor();
  next = pickBoardColor();
  requestAnimationFrame(loop);
})();
