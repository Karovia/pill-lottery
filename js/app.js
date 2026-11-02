/* ===== 通用像素抽奖模板 · 主逻辑 =====
   转盘有 N 个可配置选项（默认"周一~周日"），每个选项下挂 M 个奖品位（默认上午/下午）。
   点击恐龙/按空格 → 跳过仙人掌 → 转盘抽出某个选项 → 按抽奖方式给出其中一个奖品位
   → 播放对应结算素材（缺失时降级为像素卡片）→ 扇形填充标记。
   全部奖品抽完后长按 RESET → 仙人掌撞倒恐龙 GAME OVER → 清空重开。
   选项/奖品/名称/昼夜模式都在控制面板（右上角"设置"）里调。 */
(function () {
  'use strict';

  // 页面错误自捕获（控制台看 __errs）
  window.__errs = [];
  window.addEventListener('error', function (e) {
    window.__errs.push((e.message || String(e.error)) + ' @' + (e.lineno || '?'));
  });

  // ---------- 常量 ----------
  var SPRITES = ['dino_run1', 'dino_run2', 'dino_run3', 'dino_stand', 'dino_crash', 'cactus_small', 'cactus_large'];

  // 舞台几何（逻辑 560x560）
  var S = 560, CX = 280, CY = 280;
  var R_OUT = 245, R_HUB = 96, GROUND_HALF = 80;
  var JUMP_V = -470, GRAVITY = 2300;
  var CACTUS_SPEED = 489;
  var SPIN_MS = 4200;
  var HOLD_MS = 2000;

  var MAX_OPTIONS = 12, MAX_PRIZES = 6;

  // 昼夜配色（夜晚 = 黑白反转）；切换时画布与页面同步 0.5s 线性渐变
  var PAL_DAY = { bg: '#f7f7f7', ink: '#2b2b2b', soft: '#8a8a8a', seg: '#ffffff', seg2: '#f1f1f1', taken: '#dcdcdc', half: '#cfcfcf' };
  var PAL_NIGHT = { bg: '#0a0a0a', ink: '#f2f2f2', soft: '#777777', seg: '#161616', seg2: '#1e1e1e', taken: '#2c2c2c', half: '#3a3a3a' };
  var themeMix = 0;
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

  // ---------- 配置 ----------
  function defaultConfig() {
    return {
      v: 2,
      autoTheme: true,          // 昼夜自动循环
      slotMode: 'theme',        // theme = 昼抽第1格/夜抽最后1格；random = 剩余随机
      prizeNames: ['上午', '下午'],
      eggEnabled: true,         // 隐藏大奖：最后一个选项的最后一个奖品
      options: [
        { label: '周一', prizes: 2 },
        { label: '周二', prizes: 2 },
        { label: '周三', prizes: 2 },
        { label: '周四', prizes: 2 },
        { label: '周五', prizes: 2 },
        { label: '周六', prizes: 2 },
        { label: '周日', prizes: 2 },
      ],
    };
  }

  // ---------- 状态 ----------
  var state = {
    mode: 'idle',            // idle | jump | spin | clip | banner | reset | locked
    theme: 'day',
    muted: false,
    config: defaultConfig(),
    drawn: {},               // "选项下标:奖品下标" -> 时间戳
  };
  var clipCfg = window.CLIP_CONFIG || {};

  function saveState() {
    try {
      localStorage.setItem('pillLottery.v2', JSON.stringify({
        v: 2, config: state.config, drawn: state.drawn, muted: state.muted,
      }));
    } catch (e) {}
  }
  function loadState() {
    try {
      var raw = localStorage.getItem('pillLottery.v2');
      if (raw) {
        var d = JSON.parse(raw);
        if (d && d.config && d.config.options && d.config.options.length) {
          state.config = d.config;
          state.drawn = d.drawn || {};
          state.muted = !!d.muted;
          return;
        }
      }
      // v1（吃药周历版）迁移：mon_am -> "0:0"
      var old = localStorage.getItem('pillLottery.v1');
      if (old) {
        var d1 = JSON.parse(old);
        var map = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
        var nd = {};
        if (d1 && d1.drawn) Object.keys(d1.drawn).forEach(function (k) {
          var p = k.split('_');
          if (map[p[0]] !== undefined) nd[map[p[0]] + ':' + (p[1] === 'pm' ? 1 : 0)] = d1.drawn[k];
        });
        state.drawn = nd;
        state.muted = !!d1.muted;
        saveState();
        localStorage.removeItem('pillLottery.v1');
      }
    } catch (e) {}
  }

  function totalPrizes() {
    var n = 0;
    state.config.options.forEach(function (o) { n += o.prizes; });
    return n;
  }
  function drawnCount() { return Object.keys(state.drawn).length; }
  function optionDrawn(i) {
    var n = 0;
    for (var k in state.drawn) if (k.split(':')[0] === String(i)) n++;
    return n;
  }
  function isAllDone() { return drawnCount() >= totalPrizes(); }
  function slotName(oi, pj) {
    var names = state.config.prizeNames || [];
    return names[pj] || '奖品' + (pj + 1);
  }
  function slotKey(oi, pj) { return oi + ':' + pj; }
  function clipMeta(key) {
    var m = clipCfg[key];
    return m || { file: 'assets/clips/' + key.replace(':', '_') + '.mp4' };
  }

  // ---------- DOM ----------
  var $ = function (id) { return document.getElementById(id); };
  var cv = $('stage'), ctx = cv.getContext('2d');
  var statusEl = $('status'), remainEl = $('remain');
  var resetBtn = $('resetBtn'), muteBtn = $('muteBtn'), badgeBtn = $('ampmBadge');

  // RESET 按钮外围的像素方块环形进度
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
  var rot = -Math.PI / 2;
  var dino = { y: 0, vy: 0, frameT: 0 };
  var cactus = null;
  var pointerKick = 0;
  var fillAnim = null;
  var resetSeq = null;
  var nextThemeAt = performance.now() + 15000 + Math.random() * 10000;
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
    var P = state.config;
    var head = state.theme === 'day' ? '白天' : '夜晚';
    if (P.slotMode === 'theme') {
      var first = slotName(0, 0), last = slotName(0, Math.max(0, P.options[0].prizes - 1));
      head += state.theme === 'day' ? ' · 抽「' + first + '」' : ' · 抽「' + last + '」';
    }
    setStatus('<span class="soft">' + head + '</span> —— <span class="blink">点击恐龙或按空格</span>');
  }
  function refreshRemain() { remainEl.textContent = '剩余 ' + (totalPrizes() - drawnCount()) + '/' + totalPrizes(); }

  // ---------- 主题 ----------
  function applyThemeUI() {
    document.body.classList.toggle('night', state.theme === 'night');
    var cfg = state.config;
    var t;
    if (cfg.slotMode === 'theme') {
      var M0 = Math.max(1, cfg.options[0].prizes);
      t = state.theme === 'day'
        ? '白天 · 抽「' + slotName(0, 0) + '」'
        : '夜晚 · 抽「' + slotName(0, M0 - 1) + '」';
    } else {
      t = state.theme === 'day' ? '白天' : '夜晚';
    }
    badgeBtn.textContent = t;
    if (state.mode === 'idle') idleStatus();
  }
  function toggleTheme() {
    state.theme = state.theme === 'day' ? 'night' : 'day';
    applyThemeUI();
    sfx.theme();
    nextThemeAt = performance.now() + 15000 + Math.random() * 10000;
  }

  // ---------- 绘制辅助：扇形填充比例 ----------
  function optionFrac(i) {
    var M = state.config.options[i].prizes;
    var f = optionDrawn(i) / M;
    if (fillAnim && fillAnim.i === i) {
      var t = (performance.now() - fillAnim.t0) / 700;
      if (t >= 1) return fillAnim.to;
      var e = 1 - Math.pow(1 - Math.min(1, t), 2);
      return fillAnim.from + (fillAnim.to - fillAnim.from) * e;
    }
    return f;
  }

  // ---------- 绘制 ----------
  function draw() {
    var P = pal();
    var cfg = state.config;
    ctx.clearRect(0, 0, S, S);
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = P.bg;
    ctx.fillRect(0, 0, S, S);

    // ---- 转盘环（N 个扇形） ----
    var N = cfg.options.length;
    var SEG = Math.PI * 2 / N;
    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate(rot);
    for (var i = 0; i < N; i++) {
      var a0 = i * SEG - Math.PI / 2 - SEG / 2;
      var frac = optionFrac(i);
      var full = frac >= 0.999;
      var k = Math.min(cfg.options[i].prizes, Math.floor(frac * cfg.options[i].prizes + 1e-9));
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R_OUT, a0, a0 + SEG);
      ctx.closePath();
      ctx.fillStyle = full ? P.ink : (i % 2 === 0 ? P.seg : P.seg2);
      ctx.fill();
      // 已抽格填充
      if (!full && frac > 0.001) {
        for (var j = 0; j < k; j++) {
          ctx.beginPath(); ctx.moveTo(0, 0);
          ctx.arc(0, 0, R_OUT, a0 + SEG * j / cfg.options[i].prizes, a0 + SEG * (j + 1) / cfg.options[i].prizes);
          ctx.closePath(); ctx.fillStyle = P.half; ctx.fill();
        }
        if (k < cfg.options[i].prizes && frac > k / cfg.options[i].prizes) {
          var lastSlice = !!(fillAnim && fillAnim.i === i && fillAnim.to === 1 && k === cfg.options[i].prizes - 1);
          ctx.beginPath(); ctx.moveTo(0, 0);
          ctx.arc(0, 0, R_OUT, a0 + SEG * k / cfg.options[i].prizes, a0 + SEG * frac);
          ctx.closePath();
          ctx.fillStyle = lastSlice ? P.ink : P.half;
          ctx.fill();
        }
      }
      // 标签（抽满反色）
      ctx.save();
      ctx.rotate(a0 + SEG / 2);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = '22px FusionPixel, monospace';
      ctx.lineWidth = 5;
      ctx.strokeStyle = full ? P.ink : P.bg;
      ctx.strokeText(cfg.options[i].label, R_OUT - 46, 0);
      ctx.fillStyle = full ? P.bg : P.ink;
      ctx.fillText(cfg.options[i].label, R_OUT - 46, 0);
      ctx.restore();
    }
    // 分隔线（只画在环带内）
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 3;
    for (var s2 = 0; s2 < N; s2++) {
      var sa = s2 * SEG - Math.PI / 2 - SEG / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(sa) * (R_HUB + 6), Math.sin(sa) * (R_HUB + 6));
      ctx.lineTo(Math.cos(sa) * (R_OUT - 2), Math.sin(sa) * (R_OUT - 2));
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, R_OUT - 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    // ---- 中央舞台 ----
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
      stars.forEach(function (s, i2) { if ((tk + i2) % 8 !== 0) ctx.fillRect(Math.floor(s.x), Math.floor(s.y), s.s, s.s); });
      ctx.globalAlpha = 1;
    }

    // 中央地面
    ctx.fillStyle = P.ink;
    ctx.fillRect(CX - GROUND_HALF, CY, GROUND_HALF * 2, 2);
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
      var im2 = IMG.cactus_small;
      if (im2.complete) ctx.drawImage(im2, Math.floor(CX + cactus.x - im2.width / 2), CY + 1 - im2.height);
    }

    // 恐龙（四帧跑步循环）
    var dim;
    if (state.mode === 'locked' || (state.mode === 'reset' && resetSeq && resetSeq.hit)) dim = IMG.dino_crash;
    else if (state.mode === 'jump') dim = IMG.dino_stand;
    else dim = [IMG.dino_run1, IMG.dino_run3, IMG.dino_run2, IMG.dino_run3][Math.floor(dino.frameT / 0.09) % 4];
    if (dim && dim.complete) {
      ctx.drawImage(dim, CX - Math.floor(dim.width / 2), Math.floor(CY + 1 - dim.height + dino.y));
    }

    // 指针
    ctx.save();
    ctx.translate(CX, CY - R_OUT - 8);
    ctx.rotate(pointerKick);
    ctx.beginPath();
    ctx.moveTo(-13, -12); ctx.lineTo(13, -12); ctx.lineTo(0, 12);
    ctx.closePath();
    ctx.fillStyle = P.ink; ctx.fill();
    ctx.strokeStyle = P.bg; ctx.lineWidth = 3; ctx.stroke();
    ctx.restore();

    // RESET 演出：GAME OVER
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

    // 昼夜渐变：调色板同时驱动画布与页面 CSS 变量
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

    // 传送带地面 + 扬尘
    if (state.mode !== 'locked' && state.mode !== 'reset') {
      dashT -= dt;
      if (dashT <= 0) {
        dashT = 0.18 + Math.random() * 0.38;
        groundDashes.push({ x: GROUND_HALF + 8, len: 4 + Math.random() * 10, y: CY + 5 + Math.random() * 9 });
      }
      groundDashes.forEach(function (d) { d.x -= TREAD_SPEED * dt; });
      groundDashes = groundDashes.filter(function (d) { return d.x > -GROUND_HALF - 18; });
      dustT -= dt;
      if (dustT <= 0 && state.mode !== 'jump') {
        dustT = 0.2;
        dust.push({ x: CX - 18 - Math.random() * 4, y: CY - 3, vx: -55 - Math.random() * 35, vy: -14 - Math.random() * 20, life: 0.55 });
      }
    }
    dust.forEach(function (p) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 40 * dt; p.life -= dt; });
    dust = dust.filter(function (p) { return p.life > 0; });

    if (state.mode === 'idle') rot += dt * 0.1;

    if (state.mode === 'jump') {
      dino.vy += GRAVITY * dt;
      dino.y += dino.vy * dt;
      if (cactus) cactus.x -= CACTUS_SPEED * dt;
      if (dino.y >= 0) {
        dino.y = 0; dino.vy = 0;
        state.mode = 'spin';
        for (var di = 0; di < 6; di++) {
          dust.push({ x: CX - 16 + Math.random() * 8, y: CY - 3, vx: -90 + Math.random() * 60, vy: -30 - Math.random() * 30, life: 0.5 + Math.random() * 0.3 });
        }
        sfx.land();
        startSpin();
      }
    } else if (cactus && state.mode !== 'reset') {
      cactus.x -= CACTUS_SPEED * dt;
      if (cactus.x < -160) cactus = null;
    }

    // RESET 演出
    if (state.mode === 'reset' && resetSeq) {
      if (!resetSeq.hit) {
        cactus.x -= CACTUS_SPEED * dt;
        if (cactus.x <= 14) {
          cactus.x = 14;
          resetSeq.hit = true;
          dino.landShake = 0.25;
          sfx.thud();
          setStatus('GAME OVER —— 已清空全部进度，重新开始…');
        }
      }
      if (resetSeq.hit && !resetSeq.done && now - resetSeq.t0 > 2200) {
        resetSeq.done = true;
        actualReset();
      }
    }

    // 昼夜自动循环（仅待机）
    if (state.config.autoTheme && state.mode === 'idle' && now > nextThemeAt) toggleTheme();
    if ((state.mode === 'locked' || state.mode === 'reset') && now > nextThemeAt) nextThemeAt = now + 5000;
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
    var N = state.config.options.length;
    var SEG = Math.PI * 2 / N;
    var local = ((-Math.PI / 2 - rot) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    var shifted = (local + Math.PI / 2 + SEG / 2) % (Math.PI * 2);
    return Math.floor(shifted / SEG) % N;
  }

  // 候选选项：严格按当前抽奖方式
  function computeEligible() {
    var opts = state.config.options;
    var list = [];
    if (state.config.slotMode === 'theme') {
      for (var i = 0; i < opts.length; i++) {
        var w = state.theme === 'day' ? 0 : opts[i].prizes - 1;
        if (!state.drawn[slotKey(i, w)]) list.push({ i: i, want: w });
      }
      return { list: list, themeMode: true };
    }
    for (var j = 0; j < opts.length; j++) {
      if (optionDrawn(j) < opts[j].prizes) list.push({ i: j, want: -1 });
    }
    return { list: list, themeMode: false };
  }

  function startSpin() {
    var cfg = state.config;
    var note = '';
    var el = computeEligible();
    if (!el.list.length && cfg.slotMode === 'theme') {
      var ranOut = state.theme === 'day' ? slotName(0, 0) : slotName(0, Math.max(0, cfg.options[0].prizes - 1));
      toggleTheme();
      el = computeEligible();
      note = '「' + ranOut + '」的奖品已抽完，本轮切到「' + (state.theme === 'day' ? slotName(0, 0) : slotName(0, Math.max(0, cfg.options[0].prizes - 1))) + '」';
    }
    setStatus('转盘旋转中…' + (note ? ' ' + note : ''));

    var pick = el.list[Math.floor(Math.random() * el.list.length)];
    var targetIdx = pick.i;
    var i = targetIdx;
    var N = cfg.options.length;
    var SEG = Math.PI * 2 / N;
    var jitter = (Math.random() - 0.5) * SEG * 0.5;
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
        var M = cfg.options[targetIdx].prizes;
        var pj;
        if (el.themeMode) {
          pj = pick.want;
        } else {
          var remaining = [];
          for (var j = 0; j < M; j++) if (!state.drawn[slotKey(targetIdx, j)]) remaining.push(j);
          pj = remaining[Math.floor(Math.random() * remaining.length)];
        }
        var c = optionDrawn(targetIdx);
        fillAnim = { i: targetIdx, from: c / M, to: (c + 1) / M, t0: performance.now() };
        pendingSlot = slotKey(targetIdx, pj);
        setStatus('『' + cfg.options[targetIdx].label + ' · ' + slotName(targetIdx, pj) + '』' + note);
        setTimeout(function () { playClip(pendingSlot); }, 700);
      }
    }
    requestAnimationFrame(step);
  }

  var pendingSlot = null;

  // ---------- 结算视频 ----------
  var clipOverlay = $('clipOverlay'), clipVideo = $('clipVideo');
  var clipFallback = $('clipFallback'), fallbackQuote = $('fallbackQuote'), fallbackSource = $('fallbackSource');
  var currentSlot = null, typeTimer = null;

  function playClip(key) {
    state.mode = 'clip';
    currentSlot = key;
    var p = key.split(':');
    var meta = clipMeta(key);
    $('clipTitle').textContent = state.config.options[+p[0]].label + ' · ' + slotName(+p[0], +p[1]) +
      (meta.source ? ' ｜ ' + meta.source : '');
    clipFallback.classList.add('hidden');
    clipVideo.classList.remove('hidden');
    clipOverlay.classList.remove('hidden');

    if (meta.file) {
      clipVideo.dataset.retried = '';
      clipVideo.src = meta.file + '?v=6';
      clipVideo.onerror = function () {
        if (clipVideo.dataset.retried !== '1') {
          clipVideo.dataset.retried = '1';
          clipVideo.src = meta.file + '?r=' + Date.now();
          var pr = clipVideo.play();
          if (pr && pr.catch) pr.catch(function () { showFallback(meta, key); });
          return;
        }
        showFallback(meta, key);
      };
      clipVideo.onended = finishClip;
      var pr = clipVideo.play();
      if (pr && pr.catch) pr.catch(function () { showFallback(meta, key); });
    } else {
      showFallback(meta, key);
    }
  }
  function showFallback(meta, key) {
    clipVideo.onerror = null; clipVideo.onended = null;
    clipVideo.pause(); clipVideo.removeAttribute('src');
    clipVideo.classList.add('hidden');
    clipFallback.classList.remove('hidden');
    fallbackQuote.textContent = '';
    var p = key.split(':');
    fallbackSource.textContent = meta.source || state.config.options[+p[0]].label + ' · ' + slotName(+p[0], +p[1]);
    var q = meta.quote || slotName(+p[0], +p[1]) + '！恭喜！';
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
    fillAnim = null;

    var p = currentSlot.split(':');
    var oi = +p[0], pj = +p[1];
    var opts = state.config.options;
    var special = state.config.eggEnabled && oi === opts.length - 1 && pj === opts[oi].prizes - 1;
    setStatus('抽中 ' + opts[oi].label + '·' + slotName(oi, pj) + '！' + (special ? ' 额外小礼品一份！' : ''));

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

  // ---------- 特别奖励 ----------
  function drawGiftURL() {
    var c = document.createElement('canvas'); c.width = 22; c.height = 22;
    var x = c.getContext('2d');
    var BOX = '#e5595e', RIB = '#ffd43b', DK = '#2b2b2b';
    x.fillStyle = RIB; x.fillRect(5, 2, 5, 3); x.fillRect(12, 2, 5, 3);
    x.fillStyle = DK;  x.fillRect(10, 1, 2, 5);
    x.fillStyle = BOX; x.fillRect(2, 7, 18, 4);
    x.fillStyle = RIB; x.fillRect(10, 7, 2, 13);
    x.fillStyle = BOX; x.fillRect(3, 11, 16, 9);
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
    setStatus('全部奖品已抽完，等待工作人员补货 —— <span class="blink">长按红色 RESET 按钮</span>');
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
    if (state.mode === 'idle') idleStatus();
    else if (state.mode === 'locked') enterLocked();
  }
  resetBtn.addEventListener('pointerdown', holdStartFn);
  resetBtn.addEventListener('pointerup', holdEndFn);
  resetBtn.addEventListener('pointerleave', holdEndFn);
  resetBtn.addEventListener('pointercancel', holdEndFn);

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

  // ---------- 控制面板 ----------
  var panelOverlay = $('panelOverlay');
  var editing = null;   // 面板编辑中的配置副本

  function openPanel() {
    editing = JSON.parse(JSON.stringify(state.config));
    fillPanel();
    panelOverlay.classList.remove('hidden');
  }
  function closePanel() { panelOverlay.classList.add('hidden'); }

  function fillPanel() {
    $('cfgAutoTheme').checked = !!editing.autoTheme;
    $('cfgSlotMode').value = editing.slotMode;
    $('cfgPrizeNames').value = (editing.prizeNames || []).join('，');
    $('cfgEgg').checked = !!editing.eggEnabled;
    renderOptionRows();
  }
  function renderOptionRows() {
    var box = $('optionRows');
    box.innerHTML = '';
    editing.options.forEach(function (o, i) {
      var row = document.createElement('div');
      row.className = 'opt-row';
      var idx = document.createElement('span');
      idx.className = 'opt-idx'; idx.textContent = (i + 1) + '.';
      var label = document.createElement('input');
      label.type = 'text'; label.value = o.label; label.maxLength = 8;
      label.className = 'opt-label'; label.placeholder = '名称';
      var prizes = document.createElement('input');
      prizes.type = 'number'; prizes.min = 1; prizes.max = MAX_PRIZES;
      prizes.value = o.prizes; prizes.className = 'opt-prizes'; prizes.title = '奖品数量';
      var del = document.createElement('button');
      del.className = 'text-btn opt-del'; del.textContent = '删除';
      del.disabled = editing.options.length <= 2;
      del.addEventListener('click', function () {
        editing.options.splice(i, 1);
        renderOptionRows();
      });
      label.addEventListener('input', function () { o.label = label.value; });
      prizes.addEventListener('input', function () {
        var v = Math.max(1, Math.min(MAX_PRIZES, parseInt(prizes.value, 10) || 1));
        o.prizes = v;
      });
      row.appendChild(idx); row.appendChild(label); row.appendChild(prizes); row.appendChild(del);
      box.appendChild(row);
    });
    $('optCount').textContent = editing.options.length;
    $('addOption').disabled = editing.options.length >= MAX_OPTIONS;
  }
  $('addOption').addEventListener('click', function () {
    if (editing.options.length >= MAX_OPTIONS) return;
    editing.options.push({ label: '选项' + (editing.options.length + 1), prizes: 1 });
    renderOptionRows();
  });

  function collectPanel() {
    editing.autoTheme = $('cfgAutoTheme').checked;
    editing.slotMode = $('cfgSlotMode').value;
    var names = $('cfgPrizeNames').value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
    editing.prizeNames = names.length ? names : [];
    editing.eggEnabled = $('cfgEgg').checked;
  }

  $('settingsBtn').addEventListener('click', openPanel);
  $('cfgClose').addEventListener('click', closePanel);
  panelOverlay.addEventListener('click', function (e) { if (e.target === panelOverlay) closePanel(); });
  $('cfgDefaults').addEventListener('click', function () {
    editing = defaultConfig();
    fillPanel();
  });
  $('cfgClear').addEventListener('click', function () {
    state.drawn = {};
    saveState();
    refreshRemain();
    fillAnim = null;
    if (state.mode === 'locked') {
      state.mode = 'idle';
      resetBtn.classList.remove('locked');
      idleStatus();
    }
    sfx.coin();
  });
  $('cfgSave').addEventListener('click', function () {
    collectPanel();
    // 校验与清理
    editing.options = editing.options.slice(0, MAX_OPTIONS);
    editing.options.forEach(function (o, i) {
      o.label = (o.label || '').trim() || '选项' + (i + 1);
      o.prizes = Math.max(1, Math.min(MAX_PRIZES, o.prizes | 0));
    });
    if (editing.options.length < 2) editing.options = defaultConfig().options.slice(0, 2);
    // 丢弃越界进度
    var nd = {};
    Object.keys(state.drawn).forEach(function (k) {
      var p = k.split(':');
      var oi = +p[0], pj = +p[1];
      if (oi < editing.options.length && pj < editing.options[oi].prizes) nd[k] = state.drawn[k];
    });
    state.drawn = nd;
    state.config = editing;
    saveState();
    refreshRemain();
    applyThemeUI();
    closePanel();
    setStatus('设置已应用：' + editing.options.length + ' 个选项，共 ' + totalPrizes() + ' 个奖品');
    if (isAllDone() && state.mode !== 'locked') enterLocked();
  });

  // ---------- 静音 / 徽章 ----------
  function applyMute() { muteBtn.textContent = state.muted ? '声音 关' : '声音 开'; }
  muteBtn.addEventListener('click', function () { state.muted = !state.muted; saveState(); applyMute(); });
  badgeBtn.addEventListener('click', function () {
    if (state.mode !== 'idle') return;   // 抽奖进行中主题锁定
    toggleTheme();
  });

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

  // 调试钩子（内部用；testSpecial 触发隐藏大奖结算）
  window.__pill = {
    state: state, toggleTheme: toggleTheme, trigger: triggerDraw, reset: actualReset,
    testSpecial: function () { var o = state.config.options.length - 1; playClip(slotKey(o, state.config.options[o].prizes - 1)); },
  };
})();
