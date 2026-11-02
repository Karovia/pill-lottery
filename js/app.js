/* ===== 吃药大转盘 · 极简版主逻辑 =====
   恐龙站在转盘正中央。点击恐龙/按空格 → 恐龙跳过滑过的仙人掌 → 转盘开转
   → 停在某个星期 → 按当前昼夜主题给出上午/下午的药 → 播放"喊你吃药"结算视频
   14 副药抽完后长按红色 RESET 按钮（工作人员补货用）。 */
(function () {
  'use strict';

  // 页面错误自捕获（内部调试：控制台看 __errs）
  window.__errs = [];
  window.addEventListener('error', function (e) {
    window.__errs.push((e.message || String(e.error)) + ' @' + (e.lineno || '?'));
  });

  // ---------- 常量 ----------
  var DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  var DAY_NAMES = { mon: '周一', tue: '周二', wed: '周三', thu: '周四', fri: '周五', sat: '周六', sun: '周日' };
  var AMPM_NAMES = { am: '上午', pm: '下午' };
  var ALL_SLOTS = [];
  DAYS.forEach(function (d) { ALL_SLOTS.push(d + '_am', d + '_pm'); });

  var SPRITES = ['dino_run1', 'dino_run2', 'dino_run3', 'dino_stand', 'dino_crash', 'cactus_small', 'cactus_large'];

  // 舞台几何（逻辑 560x560）
  var S = 560, CX = 280, CY = 280;
  var R_OUT = 245;          // 转盘外半径
  var R_HUB = 96;           // 中央舞台半径
  var GROUND_HALF = 80;     // 中央地面线半宽
  var JUMP_V = -470, GRAVITY = 2300;
  var CACTUS_SPEED = 489;   // 仙人掌滑过速度 px/s
  var SPIN_MS = 4200;
  var HOLD_MS = 2000;       // RESET 长按

  // 昼夜配色（夜晚 = 黑白反转）；切换时画布与页面同步 0.5s 线性渐变
  var PAL_DAY = { bg: '#f7f7f7', ink: '#2b2b2b', soft: '#8a8a8a', seg: '#ffffff', seg2: '#f1f1f1', taken: '#dcdcdc', half: '#cfcfcf' };
  var PAL_NIGHT = { bg: '#0a0a0a', ink: '#f2f2f2', soft: '#777777', seg: '#161616', seg2: '#1e1e1e', taken: '#2c2c2c', half: '#3a3a3a' };
  var themeMix = 0;   // 0 = 白天, 1 = 夜晚
  function hexLerp(a, b, t) {
    var r1 = parseInt(a.slice(1, 3), 16), g1 = parseInt(a.slice(3, 5), 16), b1 = parseInt(a.slice(5, 7), 16);
    var r2 = parseInt(b.slice(1, 3), 16), g2 = parseInt(b.slice(3, 5), 16), b2 = parseInt(b.slice(5, 7), 16);
    return 'rgb(' + Math.round(r1 + (r2 - r1) * t) + ',' + Math.round(g1 + (g2 - g1) * t) + ',' + Math.round(b1 + (b2 - b1) * t) + ')';
  }
  function pal() {
    var out = {};
    for (var k in PAL_DAY) out[k] = hexLerp(PAL_DAY[k], PAL_NIGHT[k], themeMix);
    return out;
  }

  // ---------- 状态 ----------
  var state = {
    mode: 'idle',            // idle | jump | spin | clip | banner-wait | locked
    theme: 'day',
    drawn: {},
    muted: false,
  };
  var cfg = window.CLIP_CONFIG || {};

  function saveState() {
    try {
      localStorage.setItem('pillLottery.v1', JSON.stringify({ drawn: state.drawn, muted: state.muted }));
    } catch (e) {}
  }
  function loadState() {
    try {
      var raw = localStorage.getItem('pillLottery.v1');
      if (!raw) return;
      var d = JSON.parse(raw);
      if (d && d.drawn) { state.drawn = d.drawn; state.muted = !!d.muted; }
    } catch (e) {}
  }
  function remainingCount() {
    var n = 0;
    ALL_SLOTS.forEach(function (s) { if (state.drawn[s]) n++; });
    return 14 - n;
  }
  function isAllDone() { return remainingCount() === 0; }
  function dayEligible(day) { return !state.drawn[day + '_am'] || !state.drawn[day + '_pm']; }

  // ---------- DOM ----------
  var $ = function (id) { return document.getElementById(id); };
  var cv = $('stage'), ctx = cv.getContext('2d');
  var statusEl = $('status'), remainEl = $('remain');
  var resetBtn = $('resetBtn'), muteBtn = $('muteBtn');

  // RESET 按钮外围的像素方块环形进度（14 格）
  var RING_N = 14, ringSq = [];
  (function buildRing() {
    var ring = $('resetRing'), R = 42, C = 48;
    for (var k = 0; k < RING_N; k++) {
      var ang = -Math.PI / 2 + k * Math.PI * 2 / RING_N;
      var sq = document.createElement('span');
      sq.style.left = (C + Math.cos(ang) * R - 3.5) + 'px';
      sq.style.top = (C + Math.sin(ang) * R - 3.5) + 'px';
      ring.appendChild(sq);
      ringSq.push(sq);
    }
  })();
  function setRing(n) {
    for (var k = 0; k < RING_N; k++) ringSq[k].classList.toggle('lit', k < n);
  }

  // ---------- 音效 ----------
  var audioCtx = null;
  function ac() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  function tone(f1, f2, dur, vol, type, delay) {
    if (state.muted) return;
    var c = ac(); if (!c) return;
    var t = c.currentTime + (delay || 0);
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || 'square';
    if (f2) { o.frequency.setValueAtTime(f1, t); o.frequency.linearRampToValueAtTime(f2, t + dur); }
    else o.frequency.setValueAtTime(f1, t);
    g.gain.setValueAtTime(vol || 0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  var sfx = {
    jump: function () { tone(260, 620, 0.16, 0.07); },
    land: function () { tone(140, null, 0.08, 0.05); },
    tick: function () { tone(950, null, 0.03, 0.045); },
    theme: function () { tone(660, 330, 0.18, 0.05); },
    coin: function () { tone(988, null, 0.08, 0.06); tone(1319, null, 0.2, 0.06, 'square', 0.08); },
    thud: function () { tone(95, null, 0.14, 0.1, 'square'); tone(55, null, 0.2, 0.09, 'square', 0.05); },
    win: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, null, 0.12, 0.07, 'square', i * 0.09); }); },
    // 周日下午特别奖励："噔噔噔噔~"
    fanfare: function () {
      [523, 659, 784].forEach(function (f, i) { tone(f, null, 0.13, 0.09, 'square', i * 0.14); });
      tone(1047, null, 0.6, 0.09, 'square', 0.42);
      tone(2093, null, 0.6, 0.03, 'square', 0.42);
    },
    sad: function () { [392, 330, 262, 196].forEach(function (f, i) { tone(f, null, 0.22, 0.05, 'sawtooth', i * 0.22); }); },
  };

  // ---------- 素材 ----------
  var IMG = {};
  SPRITES.forEach(function (n) {
    var im = new Image();
    im.src = 'assets/sprites/' + n + '.png';
    IMG[n] = im;
  });

  // ---------- 世界 ----------
  var rot = -Math.PI / 2;            // 转盘当前角度
  var dino = { y: 0, vy: 0, frameT: 0 };
  var cactus = null;                 // { x }（相对中心的横坐标）
  var pointerKick = 0;
  var fillAnim = null;               // { i, from, to, t0 } 抽中扇形填充动画
  var resetSeq = null;               // RESET 演出：{ t0, hit, done }
  var nextThemeAt = performance.now() + 15000 + Math.random() * 10000;
  // 传送带地面 + 扬尘（恐龙一直在跑的视觉）
  var TREAD_SPEED = 170;
  var groundDashes = [], dust = [], dashT = 0, dustT = 0;
  var stars = [];
  (function () {
    var sx = 13;
    for (var i = 0; i < 7; i++) { sx = (sx * 73 + 41) % 997; stars.push({ x: CX - 70 + (sx % 140), y: CY - 78 + ((sx * 3) % 44), s: (sx % 3) === 0 ? 2 : 1 }); }
  })();

  // ---------- 状态文字 ----------
  function setStatus(html) { statusEl.innerHTML = html; }
  function idleStatus() {
    var t = state.theme === 'day' ? '白天 · 抽「上午」的药' : '夜晚 · 抽「下午」的药';
    setStatus('<span class="soft">' + t + '</span> —— <span class="blink">点击恐龙或按空格</span>');
  }
  function refreshRemain() { remainEl.textContent = '剩余 ' + remainingCount() + '/14'; }

  // ---------- 主题 ----------
  function applyThemeUI() {
    document.body.classList.toggle('night', state.theme === 'night');
    $('ampmBadge').textContent = state.theme === 'day' ? '白天 · 抽「上午」的药' : '夜晚 · 抽「下午」的药';
    if (state.mode === 'idle') idleStatus();
  }
  function toggleTheme() {
    state.theme = state.theme === 'day' ? 'night' : 'day';
    applyThemeUI();
    sfx.theme();
    nextThemeAt = performance.now() + 15000 + Math.random() * 10000;
  }

  // ---------- 绘制 ----------
  // 某天已抽比例 0 / 0.5 / 1（含抽中瞬间的填充动画；动画结束后保持 to 值，等记账后由 finishClip 清除）
  function dayFrac(i) {
    var day = DAYS[i];
    var f = ((state.drawn[day + '_am'] ? 1 : 0) + (state.drawn[day + '_pm'] ? 1 : 0)) / 2;
    if (fillAnim && fillAnim.i === i) {
      var t = (performance.now() - fillAnim.t0) / 700;
      if (t >= 1) return fillAnim.to;
      var e = 1 - Math.pow(1 - Math.min(1, t), 2);
      return fillAnim.from + (fillAnim.to - fillAnim.from) * e;
    }
    return f;
  }

  function draw() {
    var P = pal();
    ctx.clearRect(0, 0, S, S);
    ctx.imageSmoothingEnabled = false;

    // 背景
    ctx.fillStyle = P.bg;
    ctx.fillRect(0, 0, S, S);

    // ---- 转盘环 ----
    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate(rot);
    var SEG = Math.PI * 2 / 7;
    for (var i = 0; i < 7; i++) {
      var day = DAYS[i];
      var a0 = i * SEG - Math.PI / 2 - SEG / 2;
      var frac = dayFrac(i);
      var full = frac >= 0.999;
      // 底色扇形
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R_OUT, a0, a0 + SEG);
      ctx.closePath();
      ctx.fillStyle = full ? P.ink : (i % 2 === 0 ? P.seg : P.seg2);
      ctx.fill();
      // 已抽部分：半抽填浅色，抽满第二格填 ink
      if (frac > 0.001 && !full) {
        if (frac <= 0.5) {
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, R_OUT, a0, a0 + SEG * frac);
          ctx.closePath();
          ctx.fillStyle = P.half;
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, R_OUT, a0, a0 + SEG * 0.5);
          ctx.closePath();
          ctx.fillStyle = P.half;
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, R_OUT, a0 + SEG * 0.5, a0 + SEG * frac);
          ctx.closePath();
          ctx.fillStyle = P.ink;
          ctx.fill();
        }
      }
      // 标签（抽满反色；描边用底色，避免白字白边糊成一团）
      ctx.save();
      ctx.rotate(a0 + SEG / 2);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = '22px FusionPixel, monospace';
      ctx.lineWidth = 5;
      ctx.strokeStyle = full ? P.ink : P.bg;
      ctx.strokeText(DAY_NAMES[day], R_OUT - 46, 0);
      ctx.fillStyle = full ? P.bg : P.ink;
      ctx.fillText(DAY_NAMES[day], R_OUT - 46, 0);
      ctx.restore();
    }
    // 扇形分隔线（只画在环带内，不伸进内圈）
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 3;
    for (var s = 0; s < 7; s++) {
      var sa = s * SEG - Math.PI / 2 - SEG / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(sa) * (R_HUB + 6), Math.sin(sa) * (R_HUB + 6));
      ctx.lineTo(Math.cos(sa) * (R_OUT - 2), Math.sin(sa) * (R_OUT - 2));
      ctx.stroke();
    }
    // 外圈描边
    ctx.beginPath();
    ctx.arc(0, 0, R_OUT - 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    // ---- 中央舞台 ----
    // 舞台底盘（盖住扇形向内伸出的边缘），再压一圈描边盖住接缝
    ctx.beginPath();
    ctx.arc(CX, CY, R_HUB + 1, 0, Math.PI * 2);
    ctx.fillStyle = P.bg;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(CX, CY, R_HUB + 3, 0, Math.PI * 2);
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 4;
    ctx.stroke();

    // 夜晚星星（随渐变淡入）
    if (themeMix > 0.05) {
      var tk = Math.floor(performance.now() / 450);
      ctx.globalAlpha = themeMix;
      ctx.fillStyle = P.ink;
      stars.forEach(function (s, i) { if ((tk + i) % 8 !== 0) ctx.fillRect(Math.floor(s.x), Math.floor(s.y), s.s, s.s); });
      ctx.globalAlpha = 1;
    }

    // 中央地面
    ctx.fillStyle = P.ink;
    ctx.fillRect(CX - GROUND_HALF, CY, GROUND_HALF * 2, 2);
    // 传送带碎屑 + 脚下扬尘（裁剪在小舞台内）
    ctx.save();
    ctx.beginPath();
    ctx.rect(CX - GROUND_HALF, CY - 24, GROUND_HALF * 2, 28);
    ctx.clip();
    ctx.fillStyle = P.soft;
    groundDashes.forEach(function (d) { ctx.fillRect(Math.floor(CX + d.x), Math.floor(d.y), Math.floor(d.len), 1); });
    dust.forEach(function (p) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
      ctx.fillRect(Math.floor(p.x), Math.floor(p.y), 2, 2);
    });
    ctx.globalAlpha = 1;
    ctx.restore();

    // 仙人掌
    if (cactus) {
      var im = IMG.cactus_small;
      if (im.complete) ctx.drawImage(im, Math.floor(CX + cactus.x - im.width / 2), CY + 1 - im.height);
    }

    // 恐龙（四帧跑步循环：左脚前 → 收拢 → 右脚前 → 收拢；RESET 演出中撞死后用 crash 帧）
    var dim;
    if (state.mode === 'locked' || (state.mode === 'reset' && resetSeq && resetSeq.hit)) dim = IMG.dino_crash;
    else if (state.mode === 'jump') dim = IMG.dino_stand;
    else dim = [IMG.dino_run1, IMG.dino_run3, IMG.dino_run2, IMG.dino_run3][Math.floor(dino.frameT / 0.09) % 4];
    if (dim && dim.complete) {
      ctx.drawImage(dim, CX - Math.floor(dim.width / 2), Math.floor(CY + 1 - dim.height + dino.y));
    }

    // ---- 指针 ----
    ctx.save();
    ctx.translate(CX, CY - R_OUT - 8);
    ctx.rotate(pointerKick);
    ctx.beginPath();
    ctx.moveTo(-13, -12); ctx.lineTo(13, -12); ctx.lineTo(0, 12);
    ctx.closePath();
    ctx.fillStyle = P.ink; ctx.fill();
    ctx.strokeStyle = P.bg; ctx.lineWidth = 3; ctx.stroke();
    ctx.restore();

    // ---- 中奖扇区闪烁（已改为填充动画，见 dayFrac） ----

    // ---- RESET 演出：GAME OVER ----
    if (state.mode === 'reset' && resetSeq && resetSeq.hit) {
      ctx.font = '26px FusionPixel, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = (Math.floor(performance.now() / 350) % 2 === 0) ? 1 : 0.5;
      ctx.lineWidth = 6;
      ctx.strokeStyle = P.bg;
      ctx.strokeText('GAME OVER', CX, CY - 64);
      ctx.fillStyle = P.ink;
      ctx.fillText('GAME OVER', CX, CY - 64);
      ctx.globalAlpha = 1;
    }
  }

  // ---------- 更新 ----------
  function update(dt, now) {
    dino.frameT += dt;
    if (pointerKick !== 0) pointerKick *= 0.8;
    if (pointerKick < 0.003) pointerKick = 0;

    // 昼夜渐变：调色板同时驱动画布与页面 CSS 变量，天然同步
    var target = state.theme === 'night' ? 1 : 0;
    if (themeMix !== target) {
      themeMix += (target > themeMix ? 1 : -1) * dt / 0.5;
      if (themeMix < 0) themeMix = 0;
      if (themeMix > 1) themeMix = 1;
      var P0 = pal();
      var st = document.documentElement.style;
      st.setProperty('--bg', P0.bg);
      st.setProperty('--ink', P0.ink);
      st.setProperty('--soft', P0.soft);
    }

    // 传送带地面：碎屑不断向左滚（抽完锁定时世界静止）
    if (state.mode !== 'locked') {
      dashT -= dt;
      if (dashT <= 0) {
        dashT = 0.18 + Math.random() * 0.38;
        groundDashes.push({ x: GROUND_HALF + 8, len: 4 + Math.random() * 10, y: CY + 5 + Math.random() * 9 });
      }
      groundDashes.forEach(function (d) { d.x -= TREAD_SPEED * dt; });
      groundDashes = groundDashes.filter(function (d) { return d.x > -GROUND_HALF - 18; });
      // 脚步扬尘：每 0.2s 一步（跳跃时脚离地不起尘）
      dustT -= dt;
      if (dustT <= 0 && state.mode !== 'jump') {
        dustT = 0.2;
        dust.push({ x: CX - 18 - Math.random() * 4, y: CY - 3, vx: -55 - Math.random() * 35, vy: -14 - Math.random() * 20, life: 0.55 });
      }
    }
    dust.forEach(function (p) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 40 * dt; p.life -= dt; });
    dust = dust.filter(function (p) { return p.life > 0; });

    if (state.mode === 'idle') rot += dt * 0.1;           // 待机慢转
    if (state.mode === 'spin') { /* 由 startSpin 驱动 */ }

    if (state.mode === 'jump') {
      dino.vy += GRAVITY * dt;
      dino.y += dino.vy * dt;
      if (cactus) cactus.x -= CACTUS_SPEED * dt;
      if (dino.y >= 0) {
        dino.y = 0; dino.vy = 0;
        state.mode = 'spin';
        for (var di = 0; di < 6; di++) {   // 落地扬尘
          dust.push({ x: CX - 16 + Math.random() * 8, y: CY - 3, vx: -90 + Math.random() * 60, vy: -30 - Math.random() * 30, life: 0.5 + Math.random() * 0.3 });
        }
        sfx.land();
        startSpin();
      }
    } else if (cactus && state.mode !== 'reset') {
      cactus.x -= CACTUS_SPEED * dt;
      if (cactus.x < -160) cactus = null;
    }

    // RESET 演出：仙人掌滑入 → 撞上恐龙 → GAME OVER → 重新开始
    if (state.mode === 'reset' && resetSeq) {
      if (!resetSeq.hit) {
        cactus.x -= CACTUS_SPEED * dt;
        if (cactus.x <= 14) {
          cactus.x = 14;
          resetSeq.hit = true;
          dino.landShake = 0.25;
          sfx.thud();
          setStatus('GAME OVER —— 药品补货确认，重新开始…');
        }
      }
      if (resetSeq.hit && !resetSeq.done && now - resetSeq.t0 > 2200) {
        resetSeq.done = true;
        actualReset();
      }
    }

    if (state.mode === 'idle' && now > nextThemeAt) toggleTheme();
  }

  // ---------- 触发抽奖 ----------
  function triggerDraw() {
    if (state.mode !== 'idle') return;
    if (isAllDone()) return;
    ac();
    state.mode = 'jump';
    dino.vy = JUMP_V;
    cactus = { x: 100 };
    sfx.jump();
    setStatus('跳！');
  }

  // ---------- 转盘 ----------
  var spinning = false, tickIdx = -1;
  function segIndexAtPointer() {
    // 指针在正上方（屏幕角 -π/2）；扇区 i 的局部中心角 = i*SEG - π/2
    var SEG = Math.PI * 2 / 7;
    var local = ((-Math.PI / 2 - rot) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    var shifted = (local + Math.PI / 2 + SEG / 2) % (Math.PI * 2);
    return Math.floor(shifted / SEG) % 7;
  }
  function startSpin() {
    // 严格按当前主题抽：白天只抽还有「上午」余位的星期，绝不跨抽
    var want = state.theme === 'day' ? 'am' : 'pm';
    var note = '';
    var eligible = [];
    DAYS.forEach(function (d) { if (!state.drawn[d + '_' + want]) eligible.push(d); });
    if (!eligible.length) {
      // 该主题的药已发完 → 自动翻转到另一侧
      var ranOut = want === 'am' ? '上午' : '下午';
      toggleTheme();
      want = state.theme === 'day' ? 'am' : 'pm';
      DAYS.forEach(function (d) { if (!state.drawn[d + '_' + want]) eligible.push(d); });
      note = '「' + ranOut + '」的药已抽完，本轮切到「' + (want === 'am' ? '上午' : '下午') + '」';
    }
    setStatus('转盘旋转中…' + (note ? ' ' + note : ''));
    var targetDay = eligible[Math.floor(Math.random() * eligible.length)];
    var i = DAYS.indexOf(targetDay);
    var SEG = Math.PI * 2 / 7;
    var jitter = (Math.random() - 0.5) * SEG * 0.5;
    // 让扇区 i 的中心停在指针（正上方）下：rot ≡ -i*SEG
    var finalRot = -i * SEG + jitter;
    var turns = 6 + Math.random() * 2;
    var startRot = rot;
    var delta = finalRot - startRot;
    while (delta < Math.PI * 2 * turns) delta += Math.PI * 2;
    var t0 = performance.now();
    spinning = true;
    tickIdx = -1;

    function step(now) {
      if (!spinning) return;
      var t = Math.min(1, (now - t0) / SPIN_MS);
      var e = 1 - Math.pow(1 - t, 3);
      rot = startRot + delta * e;
      var idx = segIndexAtPointer();
      if (idx !== tickIdx) { tickIdx = idx; pointerKick = -0.1; sfx.tick(); }
      if (t < 1) { requestAnimationFrame(step); }
      else {
        spinning = false;
        sfx.coin();
        var slot = targetDay + '_' + want;
        // 扇形填充动画：从已抽比例推进一格
        var c = (state.drawn[targetDay + '_am'] ? 1 : 0) + (state.drawn[targetDay + '_pm'] ? 1 : 0);
        fillAnim = { i: i, from: c / 2, to: (c + 1) / 2, t0: performance.now() };
        var sp = slot.split('_');
        setStatus('『' + DAY_NAMES[sp[0]] + ' · ' + AMPM_NAMES[sp[1]] + '』' + note);
        setTimeout(function () { playClip(slot); }, 700);
      }
    }
    requestAnimationFrame(step);
  }

  // ---------- 结算视频 ----------
  var clipOverlay = $('clipOverlay'), clipVideo = $('clipVideo');
  var clipFallback = $('clipFallback'), fallbackQuote = $('fallbackQuote'), fallbackSource = $('fallbackSource');
  var currentSlot = null, typeTimer = null;

  function playClip(slot) {
    state.mode = 'clip';
    currentSlot = slot;
    var meta = cfg[slot] || {};
    var p = slot.split('_');
    $('clipTitle').textContent = DAY_NAMES[p[0]] + ' · ' + AMPM_NAMES[p[1]] + (meta.source ? ' ｜ ' + meta.source : '');
    clipFallback.classList.add('hidden');
    clipVideo.classList.remove('hidden');
    clipOverlay.classList.remove('hidden');

    if (meta.file) {
      clipVideo.dataset.retried = '';
      clipVideo.src = meta.file + '?v=6';          // 带版本号，避开旧缓存
      clipVideo.onerror = function () {
        // 第一次失败自动换时间戳重试一次（应对缓存/瞬态错误）
        if (clipVideo.dataset.retried !== '1') {
          clipVideo.dataset.retried = '1';
          clipVideo.src = meta.file + '?r=' + Date.now();
          var pr = clipVideo.play();
          if (pr && pr.catch) pr.catch(function () { showFallback(meta); });
          return;
        }
        showFallback(meta);
      };
      clipVideo.onended = finishClip;
      var p = clipVideo.play();
      if (p && p.catch) p.catch(function () { showFallback(meta); });
    } else {
      showFallback(meta);
    }
  }
  function showFallback(meta) {
    clipVideo.onerror = null; clipVideo.onended = null;
    clipVideo.pause(); clipVideo.removeAttribute('src');
    clipVideo.classList.add('hidden');
    clipFallback.classList.remove('hidden');
    fallbackQuote.textContent = '';
    fallbackSource.textContent = meta.source ? '—— ' + meta.source : '';
    var q = meta.quote || '按时吃药，身体棒棒！';
    var i = 0;
    clearInterval(typeTimer);
    typeTimer = setInterval(function () {
      i++;
      fallbackQuote.textContent = q.slice(0, i);
      if (i >= q.length) clearInterval(typeTimer);
    }, 110);
  }
  function finishClip() {
    clipVideo.onended = null; clipVideo.onerror = null;
    clearInterval(typeTimer);
    clipVideo.pause();
    clipOverlay.classList.add('hidden');

    state.drawn[currentSlot] = Date.now();
    saveState();
    refreshRemain();
    fillAnim = null;   // 记账完成，扇形填充交给真实状态

    var p = currentSlot.split('_');
    var special = currentSlot === 'sun_pm';   // 周日·下午 = 展示场特别奖励
    setStatus('抽中 ' + DAY_NAMES[p[0]] + '·' + AMPM_NAMES[p[1]] + ' 的药！' + (special ? ' 额外小礼品一份！' : ''));

    if (special) {
      sfx.fanfare();
      confettiBurst();
      showGiftReward();
      return;
    }
    sfx.win();
    if (isAllDone()) {
      setTimeout(enterLocked, 1200);
    } else {
      state.mode = 'idle';
      nextThemeAt = performance.now() + 8000;
    }
  }
  $('skipBtn').addEventListener('click', finishClip);

  // ---------- 像素彩带 ----------
  var fxCv = document.createElement('canvas');
  fxCv.style.cssText = 'position:fixed;inset:0;z-index:200;pointer-events:none;';
  document.body.appendChild(fxCv);
  var fx = fxCv.getContext('2d');
  var fxClean = true;
  function fitFx() { fxCv.width = innerWidth; fxCv.height = innerHeight; }
  addEventListener('resize', fitFx); fitFx();
  var confetti = [];
  function confettiBurst() {
    var colors = ['#ff6b6b', '#ffd43b', '#4dabf7', '#69db7c', '#ffffff'];
    for (var i = 0; i < 140; i++) {
      confetti.push({
        x: Math.random() * innerWidth,
        y: -20 - Math.random() * innerHeight * 0.6,
        vy: 130 + Math.random() * 170,
        ph: Math.random() * Math.PI * 2,
        sw: 26 + Math.random() * 54,
        s: 5 + Math.random() * 5,
        c: colors[Math.floor(Math.random() * colors.length)],
        life: 4.5 + Math.random() * 2.5,
      });
    }
  }
  function updateFx(dt) {
    if (!confetti.length) {
      if (!fxClean) { fx.clearRect(0, 0, fxCv.width, fxCv.height); fxClean = true; }
      return;
    }
    fxClean = false;
    fx.clearRect(0, 0, fxCv.width, fxCv.height);
    confetti = confetti.filter(function (p) {
      p.life -= dt;
      if (p.life <= 0 || p.y > innerHeight + 30) return false;
      p.y += p.vy * dt;
      p.ph += dt * 3;
      p.x += Math.sin(p.ph) * p.sw * dt;
      fx.fillStyle = p.c;
      fx.globalAlpha = Math.max(0, Math.min(1, p.life));
      fx.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s);
      return true;
    });
    fx.globalAlpha = 1;
  }

  // ---------- 周日下午特别奖励 ----------
  function drawGiftURL() {
    var c = document.createElement('canvas'); c.width = 22; c.height = 22;
    var x = c.getContext('2d');
    var BOX = '#e5595e', RIB = '#ffd43b', DK = '#2b2b2b';
    x.fillStyle = RIB; x.fillRect(5, 2, 5, 3); x.fillRect(12, 2, 5, 3);   // 蝴蝶结
    x.fillStyle = DK;  x.fillRect(10, 1, 2, 5);                            // 结
    x.fillStyle = BOX; x.fillRect(2, 7, 18, 4);                            // 盒盖
    x.fillStyle = RIB; x.fillRect(10, 7, 2, 13);                           // 竖丝带
    x.fillStyle = BOX; x.fillRect(3, 11, 16, 9);                           // 盒身
    x.fillStyle = DK;
    x.fillRect(2, 6, 18, 1); x.fillRect(2, 10, 18, 1); x.fillRect(3, 20, 16, 1);
    x.fillRect(2, 7, 1, 3); x.fillRect(19, 7, 1, 3);
    x.fillRect(3, 11, 1, 9); x.fillRect(18, 11, 1, 9);
    return c.toDataURL();
  }
  function showGiftReward() {
    $('giftImg').src = drawGiftURL();
    $('giftOverlay').classList.remove('hidden');
    state.mode = 'banner';
    setTimeout(function () {
      $('giftOverlay').classList.add('hidden');
      if (isAllDone()) enterLocked();
      else { state.mode = 'idle'; nextThemeAt = performance.now() + 8000; }
    }, 3600);
  }

  // ---------- 锁定 / RESET（长按） ----------
  function enterLocked() {
    state.mode = 'locked';
    setStatus('14 副药已全部抽完，等待工作人员补货 —— <span class="blink">长按红色 RESET 按钮</span>');
    resetBtn.classList.add('locked');
    sfx.sad();
  }
  var holding = false, holdStart = 0, holdRaf = null, holdTickQ = 0;
  function holdStep() {
    if (!holding) return;
    var p = Math.min(1, (performance.now() - holdStart) / HOLD_MS);
    setRing(Math.round(p * RING_N));
    var q = Math.floor(p * 4);
    if (q !== holdTickQ) { holdTickQ = q; sfx.tick(); }
    if (p >= 1) { startResetSequence(); return; }
    holdRaf = requestAnimationFrame(holdStep);
  }
  function holdStartFn(e) {
    e.preventDefault();
    if (holding) return;
    if (state.mode !== 'idle' && state.mode !== 'locked') return;
    ac();
    holding = true;
    holdTickQ = 0;
    setRing(0);
    resetBtn.classList.add('holding');
    setStatus('<span class="blink">RESET 中… 松手取消</span>');
    holdStart = performance.now();
    holdRaf = requestAnimationFrame(holdStep);
  }
  function holdEndFn() {
    if (!holding) return;
    holding = false;
    resetBtn.classList.remove('holding');
    setRing(0);
    if (holdRaf) cancelAnimationFrame(holdRaf);
    if (state.mode === 'idle' || state.mode === 'locked') {
      if (state.mode === 'idle') idleStatus();
      else setStatus('14 副药已全部抽完，等待工作人员补货 —— <span class="blink">长按红色 RESET 按钮</span>');
    }
  }
  resetBtn.addEventListener('pointerdown', holdStartFn);
  resetBtn.addEventListener('pointerup', holdEndFn);
  resetBtn.addEventListener('pointerleave', holdEndFn);
  resetBtn.addEventListener('pointercancel', holdEndFn);

  // 长按完成 → RESET 演出：仙人掌滑入撞死恐龙 → GAME OVER → 自动重新开始
  function startResetSequence() {
    holding = false;
    resetBtn.classList.remove('holding', 'locked');
    setRing(0);
    if (holdRaf) cancelAnimationFrame(holdRaf);
    state.mode = 'reset';
    resetSeq = { t0: performance.now(), hit: false, done: false };
    cactus = { x: GROUND_HALF + 8 };
    setStatus('RESET…');
  }

  // 演出结束时的真正重置
  function actualReset() {
    resetSeq = null;
    cactus = null;
    fillAnim = null;
    state.drawn = {};
    saveState();
    refreshRemain();
    state.mode = 'idle';
    sfx.coin();
    idleStatus();
    nextThemeAt = performance.now() + 8000;
  }

  // ---------- 静音 ----------
  function applyMute() { muteBtn.textContent = state.muted ? '声音 关' : '声音 开'; }
  muteBtn.addEventListener('click', function () { state.muted = !state.muted; saveState(); applyMute(); });

  // ---------- 输入 ----------
  cv.addEventListener('click', function (e) {
    var r = cv.getBoundingClientRect();
    var x = (e.clientX - r.left) / r.width * S;
    var y = (e.clientY - r.top) / r.height * S;
    var dx = x - CX, dy = y - (CY - 24);
    if (dx * dx + dy * dy < 130 * 130) triggerDraw();
  });
  document.addEventListener('keydown', function (e) {
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) triggerDraw();
    }
  });

  // ---------- 主循环 ----------
  var lastT = performance.now();
  function loop(now) {
    var dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    try {
      update(dt, now);
      draw();
      updateFx(dt);
    } catch (err) {
      if (window.__errs.length < 20) window.__errs.push('loop: ' + (err && err.message));
    }
    requestAnimationFrame(loop);
  }

  // ---------- 启动 ----------
  loadState();
  applyThemeUI();
  applyMute();
  refreshRemain();
  if (isAllDone()) enterLocked(); else idleStatus();
  if (document.fonts && document.fonts.load) document.fonts.load('22px FusionPixel');
  requestAnimationFrame(loop);

  // 调试钩子（内部用；testSpecial 用于彩排周日下午特别奖励，reset 跳过演出直接清空）
  window.__pill = { state: state, toggleTheme: toggleTheme, trigger: triggerDraw, reset: actualReset, testSpecial: function () { playClip('sun_pm'); } };
})();
