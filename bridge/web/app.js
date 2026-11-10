/* ==========================================================================
   DSH Office TV — 电视网页主程序
   1920x1080 设计稿 + CSS 等比缩放；canvas 程序化像素办公室 + DOM 文字气泡；
   鲸鱼娘逐帧动画（/api/pet + /pet/*）；遥控桥 window.DshTv.onKey 严格按契约。
   兼容目标：Chrome 74+（不用 ?. ?? 顶层 await、不引外部资源、无构建步骤）。
   ========================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- 基础工具 */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtDur(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    if (sec < 60) return sec + ' 秒';
    var m = Math.floor(sec / 60), s = sec % 60;
    if (m < 60) return m + ' 分' + (s ? ' ' + s + ' 秒' : '');
    return Math.floor(m / 60) + ' 时' + (m % 60) + ' 分';
  }
  function nowMs() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }
  // 确定性伪随机（给屏幕内容、星星用）
  function hash(n) {
    var x = Math.sin(n * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }
  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
  function fillRR(ctx, x, y, w, h, r, color) {
    ctx.fillStyle = color;
    rrect(ctx, x, y, w, h, r);
    ctx.fill();
  }
  // 缓存发光精灵（避免每帧 shadowBlur / createRadialGradient）
  var glowCache = {};
  function glowSprite(rgb) {
    if (glowCache[rgb]) return glowCache[rgb];
    var S = 128, c = document.createElement('canvas');
    c.width = S; c.height = S;
    var g = c.getContext('2d');
    var grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, 'rgba(' + rgb + ',0.95)');
    grad.addColorStop(0.35, 'rgba(' + rgb + ',0.42)');
    grad.addColorStop(0.7, 'rgba(' + rgb + ',0.11)');
    grad.addColorStop(1, 'rgba(' + rgb + ',0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    glowCache[rgb] = c;
    return c;
  }
  function drawGlow(ctx, x, y, rx, ry, rgb, alpha) {
    var s = glowSprite(rgb);
    ctx.globalAlpha = alpha;
    ctx.drawImage(s, x - rx, y - ry, rx * 2, ry * 2);
    ctx.globalAlpha = 1;
  }

  /* ---------------------------------------------------------------- 常量 / 布局 */
  var W = 1920, H = 1080;

  var L = {
    wallBottom: 420,
    baseboard: 411,
    cols: [260, 680, 1100],
    rows: [
      {
        cardY: 88, cardW: 366, cardH: 76,
        monY: 176, monW: 132, monH: 84,
        deskFar: 288, deskNear: 328, deskCF: 150, deskCN: 172,
        headY: 296, headW: 60, headH: 58,
        bodyY: 348, bodyW: 76, bodyH: 68,
        chairY: 404, chairW: 150, chairH: 48,
        bottom: 456
      },
      {
        cardY: 552, cardW: 404, cardH: 84,
        monY: 644, monW: 160, monH: 102,
        deskFar: 764, deskNear: 812, deskCF: 178, deskCN: 204,
        headY: 790, headW: 72, headH: 68,
        bodyY: 848, bodyW: 90, bodyH: 88,
        chairY: 920, chairW: 182, chairH: 58,
        bottom: 984
      }
    ],
    win: { x: 1352, y: 96, w: 538, h: 312 },
    petBox: { x: 1362, y: 567, w: 540, h: 451 }
  };

  var STATUS = {
    working: { name: '在忙', color: '#62d98a', glow: '98,217,138' },
    waiting: { name: '等人', color: '#f2c94c', glow: '242,201,76' },
    success: { name: '收工', color: '#6aa8ff', glow: '106,168,255' },
    idle: { name: '发呆', color: '#8b93a8', glow: '139,147,168' },
    error: { name: '卡住', color: '#ff6b6b', glow: '255,107,107' }
  };
  function statusColor(s) { return (STATUS[s] || STATUS.idle).color; }
  function statusGlowRGB(s) { return (STATUS[s] || STATUS.idle).glow; }

  // 每个工位的小人配色（和鲸鱼娘同族：navy / teal / gold / cream）
  var PAL = [
    { hair: '#26346a', hairHi: '#4661b0', hairShade: '#1b2450', skin: '#f6d9b8', shirt: '#2f8f88', shirtHi: '#45b3a9', shirtShade: '#226a64' },
    { hair: '#4a2f52', hairHi: '#7a5589', hairShade: '#33203a', skin: '#f7dcbd', shirt: '#d09a44', shirtHi: '#e8b866', shirtShade: '#a3742f' },
    { hair: '#274a3c', hairHi: '#468a72', hairShade: '#1a3428', skin: '#f2cfa8', shirt: '#46589c', shirtHi: '#6376bb', shirtShade: '#334377' },
    { hair: '#5b3423', hairHi: '#8f6042', hairShade: '#3d2316', skin: '#f8dfc4', shirt: '#b7c6de', shirtHi: '#d2dcee', shirtShade: '#8d9dbb' },
    { hair: '#2a3a6e', hairHi: '#4f66ad', hairShade: '#1c274c', skin: '#f5d2ae', shirt: '#c0607a', shirtHi: '#d9809a', shirtShade: '#97465d' },
    { hair: '#463b28', hairHi: '#7a6a4b', hairShade: '#2e2617', skin: '#f3d3b0', shirt: '#4f739a', shirtHi: '#6b92bd', shirtShade: '#3b5878' }
  ];

  /* ---------------------------------------------------------------- 运行状态 */
  var ST = {
    connected: false,
    everConnected: false,
    data: null,
    stations: [null, null, null, null, null, null], // 归一化后的 6 个工位（null=空）
    slotIds: [null, null, null, null, null, null],
    hiddenCount: 0,
    cursor: -1,
    cursorAt: 0,
    panelOpen: false,
    panelFocus: 0,
    typing: false,
    lastReply: null,
    lastQuestion: null,
    busyChat: false,
    mock: false,
    petMoodFromState: 'idle',
    bubbleUntil: 0,
    toastUntil: 0,
    lastPollAt: 0,
    lastMoodLineAt: 0
  };

  /* ---------------------------------------------------------------- 画布 / 缩放 */
  var stage = $('#stage');
  var scene = $('#scene');
  var sctx = scene.getContext('2d');
  var bgCanvas = document.createElement('canvas');
  var bgctx = bgCanvas.getContext('2d');
  var renderK = 1;
  var vignetteGrad = null;
  var vignetteTimer = 0;

  function stageScale() {
    var vw = window.innerWidth || W, vh = window.innerHeight || H;
    return Math.min(vw / W, vh / H);
  }

  function layout() {
    var s = stageScale();
    stage.style.transform = 'translate(-50%,-50%) scale(' + s + ')';
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var degFactor = [1, 0.84, 0.72, 0.62][degradeLevel || 0] || 1;
    renderK = Math.max(0.4, Math.min(2, s * dpr * degFactor));
    scene.width = Math.round(W * renderK);
    scene.height = Math.round(H * renderK);
    bgCanvas.width = scene.width;
    bgCanvas.height = scene.height;
    sctx.imageSmoothingEnabled = true;
    bgctx.imageSmoothingEnabled = true;
    vignetteGrad = null;
    rebuildBg();
    layoutPetCanvases();
    if (PET.cur) petDrawFrame(true);
  }

  /* ---------------------------------------------------------------- 静态场景 */
  // 背景一次性预渲染：墙、窗、地板、工位家具、右侧家具。逐帧只画动态部分。
  function rebuildBg() {
    if (!bgctx) return;
    bgctx.setTransform(renderK, 0, 0, renderK, 0, 0);
    bgctx.clearRect(0, 0, W, H);
    drawWall(bgctx);
    drawWindow(bgctx);
    drawWallArt(bgctx);
    drawFloor(bgctx);
    drawCorridorProps(bgctx);
    for (var i = 0; i < 6; i++) drawStationStatic(bgctx, i);
    drawPetSpotlight(bgctx);
    drawRightZone(bgctx);
  }

  function drawWall(ctx) {
    // 墙面：深海军蓝 + 暖光晕
    var g = ctx.createLinearGradient(0, 0, 0, L.wallBottom);
    g.addColorStop(0, '#101a38');
    g.addColorStop(0.45, '#16244a');
    g.addColorStop(1, '#1b2a52');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, L.wallBottom);

    // 顶部更暗（天花板方向）
    var gt = ctx.createLinearGradient(0, 0, 0, 120);
    gt.addColorStop(0, 'rgba(4,7,16,0.75)');
    gt.addColorStop(1, 'rgba(4,7,16,0)');
    ctx.fillStyle = gt;
    ctx.fillRect(0, 0, W, 120);

    // 墙板竖缝
    ctx.fillStyle = 'rgba(10,18,38,0.55)';
    for (var x = 120; x < W; x += 240) ctx.fillRect(x, 0, 2, L.wallBottom);

    // 暖色台灯光池（预渲染）
    var pools = [
      [260, 330, 250, 150, 'rgba(255,186,110,0.13)'],
      [680, 330, 250, 150, 'rgba(255,186,110,0.11)'],
      [1100, 330, 250, 150, 'rgba(255,186,110,0.13)'],
      [260, 900, 320, 170, 'rgba(255,186,110,0.09)'],
      [680, 900, 320, 170, 'rgba(255,186,110,0.09)'],
      [1100, 900, 320, 170, 'rgba(255,186,110,0.09)']
    ];
    for (var p = 0; p < pools.length; p++) {
      var q = pools[p];
      drawGlow(ctx, q[0], q[1], q[2], q[3], '255,186,110', 0.5);
    }

    // 踢脚线
    ctx.fillStyle = '#0d172e';
    ctx.fillRect(0, L.baseboard, W, L.wallBottom - L.baseboard);
    ctx.fillStyle = 'rgba(242,185,75,0.20)';
    ctx.fillRect(0, L.baseboard, W, 3);
    ctx.fillStyle = 'rgba(8,14,30,0.8)';
    ctx.fillRect(0, L.wallBottom - 6, W, 6);
  }

  function drawWindow(ctx) {
    var w = L.win;
    // 窗洞内的夜空
    var g = ctx.createLinearGradient(0, w.y, 0, w.y + w.h);
    g.addColorStop(0, '#061226');
    g.addColorStop(0.45, '#0a2450');
    g.addColorStop(0.8, '#103a63');
    g.addColorStop(1, '#15507a');
    ctx.fillStyle = g;
    ctx.fillRect(w.x, w.y, w.w, w.h);

    // 窗外月光
    drawGlow(ctx, w.x + w.w * 0.72, w.y + 86, 150, 150, '160,205,255', 0.5);
    ctx.fillStyle = '#e9f2ff';
    ctx.beginPath();
    ctx.arc(w.x + w.w * 0.72, w.y + 86, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(10,34,68,0.55)';
    ctx.beginPath();
    ctx.arc(w.x + w.w * 0.72 + 12, w.y + 78, 25, 0, Math.PI * 2);
    ctx.fill();

    // 远景海底城市剪影（简单的方块楼群）
    ctx.fillStyle = 'rgba(4,12,28,0.72)';
    var baseY = w.y + w.h - 34;
    var bx = w.x + 6;
    var seed = 1;
    while (bx < w.x + w.w - 8) {
      var hh = 18 + Math.floor(hash(seed++) * 62);
      var bw = 14 + Math.floor(hash(seed++) * 26);
      ctx.fillRect(bx, baseY - hh, bw, hh);
      // 窗灯
      for (var k = 0; k < 3; k++) {
        if (hash(seed + k) > 0.5) {
          ctx.fillStyle = 'rgba(255,214,140,' + (0.15 + hash(seed + k) * 0.4) + ')';
          ctx.fillRect(bx + 4 + (k % 2) * 8, baseY - hh + 6 + k * 9, 3, 3);
          ctx.fillStyle = 'rgba(4,12,28,0.72)';
        }
      }
      bx += bw + 5;
    }

    // 窗框
    ctx.strokeStyle = '#2b1d12';
    ctx.lineWidth = 18;
    ctx.strokeRect(w.x - 9, w.y - 9, w.w + 18, w.h + 18);
    ctx.strokeStyle = '#4a3423';
    ctx.lineWidth = 10;
    ctx.strokeRect(w.x, w.y, w.w, w.h);
    ctx.strokeStyle = 'rgba(255,214,140,0.16)';
    ctx.lineWidth = 2;
    ctx.strokeRect(w.x + 5, w.y + 5, w.w - 10, w.h - 10);

    // 窗棂
    ctx.fillStyle = '#3a281a';
    ctx.fillRect(w.x + w.w / 3 - 4, w.y, 8, w.h);
    ctx.fillRect(w.x + (w.w * 2) / 3 - 4, w.y, 8, w.h);
    ctx.fillRect(w.x, w.y + w.h / 2 - 4, w.w, 8);
    ctx.fillStyle = 'rgba(255,214,140,0.10)';
    ctx.fillRect(w.x + w.w / 3 + 4, w.y, 2, w.h);
    ctx.fillRect(w.x + (w.w * 2) / 3 + 4, w.y, 2, w.h);

    // 玻璃反光
    ctx.save();
    ctx.beginPath();
    ctx.rect(w.x, w.y, w.w, w.h);
    ctx.clip();
    ctx.fillStyle = 'rgba(190,225,255,0.055)';
    ctx.beginPath();
    ctx.moveTo(w.x + 40, w.y + w.h);
    ctx.lineTo(w.x + 190, w.y);
    ctx.lineTo(w.x + 270, w.y);
    ctx.lineTo(w.x + 120, w.y + w.h);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(w.x + 250, w.y + w.h);
    ctx.lineTo(w.x + 400, w.y);
    ctx.lineTo(w.x + 440, w.y);
    ctx.lineTo(w.x + 290, w.y + w.h);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 窗台
    ctx.fillStyle = '#3d2a1b';
    ctx.fillRect(w.x - 26, w.y + w.h + 6, w.w + 52, 20);
    ctx.fillStyle = '#5b3f27';
    ctx.fillRect(w.x - 26, w.y + w.h + 6, w.w + 52, 6);
    // 窗台上的小盆栽
    var sx = w.x + 86;
    fillRR(ctx, sx, w.y + w.h - 34, 44, 42, 6, '#b65c45');
    ctx.fillStyle = '#3e8a68';
    for (var l = 0; l < 5; l++) {
      var lx = sx - 6 + l * 12;
      ctx.fillRect(lx, w.y + w.h - 56 - (l % 3) * 6, 6, 26 + (l % 3) * 6);
    }
    // 窗台上的蜡烛
    var cx2 = w.x + w.w - 96;
    fillRR(ctx, cx2, w.y + w.h - 30, 26, 34, 4, '#f0dcae');
    drawGlow(ctx, cx2 + 13, w.y + w.h - 44, 40, 34, '255,200,120', 0.55);
    ctx.fillStyle = '#ffd479';
    ctx.beginPath();
    ctx.ellipse(cx2 + 13, w.y + w.h - 36, 4, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawWallArt(ctx) {
    // 顶部装饰带（0~88）：小相框 + 挂钟，统一尺寸，避免被卡片切一半
    function frame(x, y, w, h, artFn) {
      ctx.fillStyle = 'rgba(6,12,24,0.35)';
      ctx.fillRect(x + 4, y + 5, w, h);
      ctx.fillStyle = '#e6cf9c';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#122546';
      ctx.fillRect(x + 5, y + 5, w - 10, h - 10);
      artFn(x + 5, y + 5, w - 10, h - 10);
    }
    // ① 鲸鱼小画
    frame(452, 12, 68, 68, function (ax, ay, aw, ah) {
      ctx.fillStyle = '#3fd0c9';
      ctx.beginPath();
      ctx.ellipse(ax + aw * 0.46, ay + ah * 0.44, aw * 0.28, ah * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(ax + aw * 0.72, ay + ah * 0.42);
      ctx.lineTo(ax + aw * 0.9, ay + ah * 0.3);
      ctx.lineTo(ax + aw * 0.88, ay + ah * 0.56);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#0b1730';
      ctx.beginPath();
      ctx.arc(ax + aw * 0.32, ay + ah * 0.42, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(247,236,210,0.75)';
      for (var i = 0; i < 4; i++) ctx.fillRect(ax + 8 + i * 12, ay + ah * 0.74, 2.5, 2.5);
      ctx.fillStyle = 'rgba(242,185,75,0.8)';
      ctx.fillRect(ax + 6, ay + ah - 8, aw - 24, 3);
    });
    // ② 挂钟
    var cx = 894, cy = 46, r = 32;
    ctx.fillStyle = 'rgba(6,12,24,0.35)';
    ctx.beginPath(); ctx.arc(cx + 3, cy + 4, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e6cf9c';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#16244a';
    ctx.beginPath(); ctx.arc(cx, cy, r - 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(247,236,210,0.7)';
    ctx.lineWidth = 2;
    for (var i2 = 0; i2 < 12; i2++) {
      var a = (i2 / 12) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r - 11), cy + Math.sin(a) * (r - 11));
      ctx.lineTo(cx + Math.cos(a) * (r - 6), cy + Math.sin(a) * (r - 6));
      ctx.stroke();
    }
    ctx.strokeStyle = '#f2b94b';
    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + 1, cy - 14); ctx.stroke();
    ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx - 13, cy - 5); ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = '#f2b94b';
    ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
    // ③ 月亮小画
    frame(1276, 14, 64, 64, function (ax, ay, aw, ah) {
      ctx.fillStyle = 'rgba(180,215,255,0.85)';
      ctx.beginPath();
      ctx.arc(ax + aw * 0.52, ay + ah * 0.42, aw * 0.24, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#122546';
      ctx.beginPath();
      ctx.arc(ax + aw * 0.62, ay + ah * 0.36, aw * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(247,236,210,0.6)';
      for (var i3 = 0; i3 < 3; i3++) ctx.fillRect(ax + 7 + i3 * 12, ay + ah * 0.72, 2.4, 2.4);
      ctx.fillStyle = 'rgba(63,208,201,0.45)';
      ctx.fillRect(ax + 5, ay + ah - 10, aw - 10, 2.5);
    });
  }

  function drawFloor(ctx) {
    // 木地板：越靠下板越宽（模拟俯视角）
    var ys = [420, 430, 442, 456, 472, 490, 510, 532, 556, 582, 610, 640, 672, 706, 742, 780, 820, 862,
      906, 952, 1000, 1050, 1080];
    var tones = ['#3b2b1d', '#3c2c1e', '#3d2d1f', '#3e2e20', '#3f2f21', '#402f21', '#413022', '#423123',
      '#433224', '#443325', '#453426', '#463527', '#473628', '#483729', '#49382a', '#4a392b', '#4b3a2c',
      '#4c3b2d', '#4d3c2e', '#4e3d2f', '#4f3e30', '#503f31', '#514032'];
    for (var i = 0; i < ys.length - 1; i++) {
      var y0 = ys[i], y1 = ys[i + 1];
      ctx.fillStyle = tones[i % tones.length];
      ctx.fillRect(0, y0, W, y1 - y0);
      ctx.fillStyle = 'rgba(255,214,140,0.045)';
      ctx.fillRect(0, y0, W, 2);
      ctx.fillStyle = 'rgba(8,14,30,0.22)';
      ctx.fillRect(0, y1 - 2, W, 2);
      // 竖向板缝（错缝）
      var step = 150 + i * 26;
      var off = (i * 83) % step;
      for (var x = off; x < W; x += step) {
        ctx.fillStyle = 'rgba(10,16,32,0.28)';
        ctx.fillRect(x, y0, 2, y1 - y0);
      }
    }
    // 右侧月光洒在地上
    var g = ctx.createLinearGradient(L.win.x, L.wallBottom, L.win.x + 520, 940);
    g.addColorStop(0, 'rgba(140,190,255,0.14)');
    g.addColorStop(1, 'rgba(140,190,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(L.win.x + 10, L.wallBottom);
    ctx.lineTo(L.win.x + L.win.w - 10, L.wallBottom);
    ctx.lineTo(1930, 1010);
    ctx.lineTo(1400, 1010);
    ctx.closePath();
    ctx.fill();

    // 前排工位地毯
    fillRR(ctx, 26, 872, 1300, 152, 26, '#123c3f');
    fillRR(ctx, 40, 884, 1272, 128, 20, '#164a4a');
    ctx.strokeStyle = 'rgba(63,208,201,0.28)';
    ctx.lineWidth = 3;
    ctx.strokeRect(56, 898, 1240, 100);
    // 地毯花纹
    ctx.fillStyle = 'rgba(63,208,201,0.13)';
    for (var d = 0; d < 14; d++) {
      var dx = 84 + d * 86;
      ctx.beginPath();
      ctx.moveTo(dx, 924);
      ctx.lineTo(dx + 22, 948);
      ctx.lineTo(dx, 972);
      ctx.lineTo(dx - 22, 948);
      ctx.closePath();
      ctx.fill();
    }

    // 右侧圆地毯
    ctx.fillStyle = '#10383c';
    ctx.beginPath();
    ctx.ellipse(1655, 986, 256, 60, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#15504f';
    ctx.beginPath();
    ctx.ellipse(1655, 982, 232, 50, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(63,208,201,0.35)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(1655, 982, 200, 40, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(242,185,75,0.18)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(1655, 982, 120, 24, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 两排工位之间的走廊道具（水位机 / 高绿植 / 文件柜 / 左侧书架）
  function drawCorridorProps(ctx) {
    // 左侧书架
    var bx = 0, by = 300, bw = 88, bh = 262;
    fillRR(ctx, bx - 6, by, bw, bh, 6, '#33241a');
    ctx.fillStyle = '#4a3423';
    ctx.fillRect(bx + 4, by + 6, bw - 20, bh - 12);
    ctx.fillStyle = '#2a1c12';
    for (var s = 0; s < 3; s++) {
      var sy = by + 24 + s * 76;
      ctx.fillRect(bx + 8, sy, bw - 28, 8);
      // 书脊
      for (var b = 0; b < 5; b++) {
        var col = ['#b65c45', '#2f7f7a', '#c9903f', '#3b4a7a', '#5a3a63'][(b + s) % 5];
        ctx.fillStyle = col;
        ctx.fillRect(bx + 12 + b * 12, sy - 34 + (b % 2) * 3, 9, 34 - (b % 2) * 3);
      }
      ctx.fillStyle = '#2a1c12';
    }
    // 书架顶上垂下来的绿萝
    for (var v = 0; v < 7; v++) {
      var vx = bx + 18 + v * 8;
      var vh = 26 + Math.floor(hash(v + 3) * 40);
      ctx.fillStyle = v % 2 ? '#357a58' : '#2c6b4d';
      ctx.fillRect(vx, by - 6, 5, vh);
      ctx.beginPath();
      ctx.ellipse(vx - 4, by - 4 + vh, 7, 4.5, -0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    fillRR(ctx, bx + 14, by - 10, 58, 22, 5, '#2f6b4c');

    // 饮水机（rowA 1/2 号之间）
    var wx = 434, wBase = 548, wTop = 306;
    fillRR(ctx, wx, wTop + 60, 72, wBase - wTop - 60, 8, '#c9d4e6');
    ctx.fillStyle = '#aab7cd';
    ctx.fillRect(wx + 6, wTop + 70, 60, 4);
    // 水桶
    fillRR(ctx, wx + 10, wTop, 52, 66, 20, '#7fc7e8');
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(wx + 16, wTop + 12, 10, 40);
    ctx.fillStyle = '#274059';
    ctx.fillRect(wx + 12, wTop + 66, 48, 8);
    // 出水口
    ctx.fillStyle = '#3a4c66';
    ctx.fillRect(wx + 26, wTop + 104, 20, 12);
    ctx.fillStyle = '#6aa8ff';
    ctx.fillRect(wx + 30, wTop + 90, 12, 6);
    // 底座阴影
    ctx.fillStyle = 'rgba(6,10,22,0.32)';
    ctx.beginPath();
    ctx.ellipse(wx + 36, wBase, 44, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    // 高绿植（rowA 2/3 号之间）
    var px = 890, pBase = 548;
    fillRR(ctx, px - 30, pBase - 62, 60, 62, 8, '#a9553f');
    ctx.fillStyle = '#c46a4f';
    ctx.fillRect(px - 30, pBase - 62, 60, 8);
    ctx.fillStyle = '#2a1c12';
    ctx.fillRect(px - 26, pBase - 62, 52, 5);
    var leaves = [[-34, -120, 20], [-8, -150, 24], [18, -128, 22], [-20, -96, 18], [30, -104, 16], [4, -178, 16]];
    for (var li = 0; li < leaves.length; li++) {
      var lf = leaves[li];
      ctx.fillStyle = li % 2 ? '#2f6b4c' : '#3d8a63';
      ctx.beginPath();
      ctx.ellipse(px + lf[0], pBase - 62 + lf[1], lf[2], 11, li % 2 ? 0.6 : -0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#357a58';
    ctx.fillRect(px - 3, pBase - 190, 6, 132);
    ctx.fillStyle = 'rgba(6,10,22,0.3)';
    ctx.beginPath(); ctx.ellipse(px, pBase, 38, 8, 0, 0, Math.PI * 2); ctx.fill();

    // 文件柜（最右）
    var fx = 1274, fBase = 552, fTop = 336;
    fillRR(ctx, fx, fTop, 74, fBase - fTop, 5, '#3a4a66');
    ctx.fillStyle = '#2b3852';
    for (var dr = 0; dr < 3; dr++) {
      var dy = fTop + 12 + dr * 66;
      ctx.fillRect(fx + 8, dy, 58, 56);
      ctx.fillStyle = '#4a5c7c';
      ctx.fillRect(fx + 8, dy, 58, 4);
      ctx.fillStyle = '#8b93a8';
      ctx.fillRect(fx + 30, dy + 26, 14, 4);
      ctx.fillStyle = '#2b3852';
    }
    ctx.fillStyle = 'rgba(6,10,22,0.3)';
    ctx.beginPath(); ctx.ellipse(fx + 37, fBase, 42, 8, 0, 0, Math.PI * 2); ctx.fill();
  }

  // 单个工位的静态部分：显示器、桌子、桌面道具
  function drawStationStatic(ctx, i) {
    var rowIdx = i < 3 ? 0 : 1;
    var R = L.rows[rowIdx];
    var cx = L.cols[i % 3];
    var st = ST.stations[i];
    var status = st ? st.status : 'idle';

    // 工位地面阴影
    ctx.fillStyle = 'rgba(6,10,22,0.34)';
    ctx.beginPath();
    ctx.ellipse(cx, R.bottom + 6, R.chairW * 1.16, rowIdx ? 17 : 13, 0, 0, Math.PI * 2);
    ctx.fill();

    // 显示器背后的光（状态色）
    drawGlow(ctx, cx, R.monY + R.monH * 0.55, R.monW * 1.55, R.monW * 1.2, statusGlowRGB(status), 0.34);

    // 显示器支架
    ctx.fillStyle = '#20304c';
    ctx.fillRect(cx - 9, R.monY + R.monH + 6, 18, R.deskFar - (R.monY + R.monH) - 10);
    ctx.fillStyle = '#2c3f60';
    ctx.fillRect(cx - 30, R.deskFar - 6, 60, 7);

    // 显示器外框
    fillRR(ctx, cx - R.monW / 2 - 7, R.monY - 7, R.monW + 14, R.monH + 14, 8, '#1a263c');
    // 屏幕底
    ctx.fillStyle = '#060d1e';
    ctx.fillRect(cx - R.monW / 2, R.monY, R.monW, R.monH);
    // 摄像头小点
    ctx.fillStyle = '#3a4a66';
    ctx.fillRect(cx - 3, R.monY - 4, 6, 3);
    // 贴纸
    ctx.fillStyle = 'rgba(242,185,75,0.5)';
    ctx.fillRect(cx - R.monW / 2 - 7, R.monY + R.monH + 4, 9, 9);

    // 桌面（梯形）
    var far = R.deskFar, near = R.deskNear, cf = R.deskCF, cn = R.deskCN;
    var g = ctx.createLinearGradient(0, far, 0, near);
    g.addColorStop(0, '#6d4a2d');
    g.addColorStop(0.45, '#7d5735');
    g.addColorStop(1, '#5a3d24');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx - cf, far);
    ctx.lineTo(cx + cf, far);
    ctx.lineTo(cx + cn, near);
    ctx.lineTo(cx - cn, near);
    ctx.closePath();
    ctx.fill();
    // 近边高光 + 桌沿
    ctx.fillStyle = 'rgba(255,214,150,0.18)';
    ctx.fillRect(cx - cn + 4, near - 5, cn * 2 - 8, 3);
    ctx.fillStyle = '#432c19';
    ctx.fillRect(cx - cn, near, cn * 2, 8);
    // 桌面木纹
    ctx.fillStyle = 'rgba(42,26,14,0.22)';
    ctx.fillRect(cx - cf + 20, far + 14, cf * 2 - 40, 2);
    ctx.fillRect(cx - cf + 8, far + 32, cf * 2 - 16, 2);
    // 桌下前板（只在中缝里露出来）
    ctx.fillStyle = '#3a2616';
    ctx.fillRect(cx - cn + 12, near + 8, cn * 2 - 24, rowIdx ? 44 : 34);
    ctx.fillStyle = 'rgba(255,214,150,0.08)';
    ctx.fillRect(cx - cn + 12, near + 8, cn * 2 - 24, 3);

    // 键盘（半隐藏在桌沿，人挡住中间）
    ctx.fillStyle = '#20293c';
    ctx.fillRect(cx - 92, near - 26, 184, 22);
    ctx.fillStyle = '#2c3a52';
    for (var ky = 0; ky < 3; ky++) {
      for (var kx = 0; kx < 14; kx++) ctx.fillRect(cx - 86 + kx * 12, near - 22 + ky * 7, 8, 4);
    }
    // 桌面道具：左侧马克杯 + 右侧小物
    var mugX = cx - cn + 34, mugY = far + 20;
    ctx.fillStyle = '#e6cf9c';
    ctx.fillRect(mugX, mugY, 22, 24);
    ctx.fillStyle = '#b65c45';
    ctx.fillRect(mugX, mugY + 8, 22, 5);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(mugX + 3, mugY + 3, 3, 14);
    ctx.strokeStyle = '#e6cf9c';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(mugX + 25, mugY + 12, 6, -1.2, 1.2);
    ctx.stroke();

    // 右侧小盆栽 / 台灯 / 书 按工位轮换
    var pxr = cx + cn - 46, pyr = far + 8;
    if (i % 3 === 0) {
      // 台灯
      ctx.fillStyle = '#26344c';
      ctx.fillRect(pxr + 14, pyr + 12, 6, 26);
      ctx.beginPath();
      ctx.moveTo(pxr - 2, pyr + 14);
      ctx.lineTo(pxr + 38, pyr + 14);
      ctx.lineTo(pxr + 30, pyr - 4);
      ctx.lineTo(pxr + 6, pyr - 4);
      ctx.closePath();
      ctx.fillStyle = '#2f4055';
      ctx.fill();
      ctx.fillStyle = '#f2b94b';
      ctx.fillRect(pxr + 6, pyr + 12, 26, 3);
    } else if (i % 3 === 1) {
      // 小绿植
      fillRR(ctx, pxr, pyr + 16, 34, 24, 4, '#b65c45');
      ctx.fillStyle = '#3e8a68';
      ctx.fillRect(pxr + 12, pyr - 6, 5, 24);
      ctx.fillRect(pxr + 4, pyr + 2, 5, 18);
      ctx.fillRect(pxr + 22, pyr + 1, 5, 19);
    } else {
      // 一摞书 + 便签
      ctx.fillStyle = '#2f7f7a'; ctx.fillRect(pxr - 2, pyr + 18, 40, 7);
      ctx.fillStyle = '#c9903f'; ctx.fillRect(pxr + 1, pyr + 11, 36, 7);
      ctx.fillStyle = '#b65c45'; ctx.fillRect(pxr + 4, pyr + 4, 32, 7);
      ctx.fillStyle = '#ffe9a8'; ctx.fillRect(pxr - 16, pyr + 30, 22, 14);
      ctx.fillStyle = '#c9a94a'; ctx.fillRect(pxr - 12, pyr + 34, 14, 2);
    }

    // 桌子右下角：椅子/桌腿阴影
    ctx.fillStyle = 'rgba(6,10,22,0.22)';
    ctx.fillRect(cx - cn + 6, near + 10, 8, rowIdx ? 50 : 40);
    ctx.fillRect(cx + cn - 14, near + 10, 8, rowIdx ? 50 : 40);
  }

  // 鲸鱼娘的"焦点光"：她必须一眼就看到（背景层的暖光，静态）
  function drawPetSpotlight(ctx) {
    var b = L.petBox;
    var px = b.x + b.w * 0.533;   // 她身体中心
    // ① 墙面暖光（她背后）
    drawGlow(ctx, px - 40, 760, 420, 360, '255,200,130', 0.30);
    // ② 45° 打下来的光束
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var g = ctx.createLinearGradient(px - 260, 520, px + 40, 1010);
    g.addColorStop(0, 'rgba(255,214,150,0.16)');
    g.addColorStop(0.55, 'rgba(255,200,130,0.07)');
    g.addColorStop(1, 'rgba(255,190,110,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(px - 300, 430);
    ctx.lineTo(px + 60, 430);
    ctx.lineTo(px + 240, 1020);
    ctx.lineTo(px - 200, 1020);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // ③ 地面亮池（站在光里）
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var rg = ctx.createRadialGradient(px, 990, 10, px, 990, 300);
    rg.addColorStop(0, 'rgba(255,224,170,0.24)');
    rg.addColorStop(0.5, 'rgba(255,200,130,0.10)');
    rg.addColorStop(1, 'rgba(255,190,110,0)');
    ctx.fillStyle = rg;
    ctx.save();
    ctx.translate(px, 990);
    ctx.scale(1, 0.34);
    ctx.beginPath();
    ctx.arc(0, 0, 300, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.restore();
    // ④ 她脚下的一圈金色地灯
    ctx.strokeStyle = 'rgba(255,214,150,0.34)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(px, 998, 214, 46, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,214,150,0.16)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(px, 998, 250, 55, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 右侧：灯、绿植、猫、懒人垫
  function drawRightZone(ctx) {
    // 落地灯（远处）
    ctx.fillStyle = '#2a1c12';
    ctx.fillRect(1852, 700, 6, 310);
    ctx.fillStyle = '#243044';
    ctx.beginPath();
    ctx.ellipse(1855, 1012, 34, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    // 灯罩
    ctx.beginPath();
    ctx.moveTo(1816, 660);
    ctx.lineTo(1896, 660);
    ctx.lineTo(1882, 706);
    ctx.lineTo(1830, 706);
    ctx.closePath();
    ctx.fillStyle = '#e6cf9c';
    ctx.fill();
    ctx.fillStyle = 'rgba(242,185,75,0.8)';
    ctx.fillRect(1822, 700, 68, 5);
    drawGlow(ctx, 1856, 696, 190, 150, '255,200,120', 0.42);

    // 大绿植（右区左侧）
    var px = 1336, pBase = 1012;
    fillRR(ctx, px - 34, pBase - 66, 68, 66, 8, '#a9553f');
    ctx.fillStyle = '#c46a4f';
    ctx.fillRect(px - 34, pBase - 66, 68, 9);
    var leaves = [[-40, -140, 24], [-6, -178, 28], [26, -150, 24], [-24, -112, 20], [36, -118, 18], [8, -206, 18], [-52, -96, 16]];
    for (var li = 0; li < leaves.length; li++) {
      var lf = leaves[li];
      ctx.fillStyle = li % 2 ? '#2f6b4c' : '#3d8a63';
      ctx.beginPath();
      ctx.ellipse(px + lf[0], pBase - 66 + lf[1], lf[2], 12, li % 2 ? 0.55 : -0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#357a58';
    ctx.fillRect(px - 3, pBase - 220, 6, 156);
    ctx.fillStyle = 'rgba(6,10,22,0.3)';
    ctx.beginPath(); ctx.ellipse(px, pBase, 42, 9, 0, 0, Math.PI * 2); ctx.fill();

    // 懒人垫 + 抱枕（她脚边）
    ctx.fillStyle = '#1b3f52';
    ctx.beginPath();
    ctx.ellipse(1770, 1032, 96, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#24596e';
    ctx.beginPath();
    ctx.ellipse(1770, 1027, 80, 20, 0, 0, Math.PI * 2);
    ctx.fill();

    // 鲸鱼娘脚下阴影（她本身在独立 canvas 上）
    ctx.fillStyle = 'rgba(4,8,18,0.42)';
    ctx.beginPath();
    ctx.ellipse(1655, 1004, 138, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(4,8,18,0.2)';
    ctx.beginPath();
    ctx.ellipse(1655, 1004, 178, 30, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  /* ---------------------------------------------------------------- 动态场景 */
  var dust = [];
  for (var di = 0; di < 22; di++) {
    dust.push({
      x: 80 + hash(di * 3.1) * 1760,
      y: 200 + hash(di * 7.7) * 760,
      r: 1.1 + hash(di * 2.3) * 1.8,
      vy: -0.10 - hash(di * 5.3) * 0.22,
      vx: (hash(di * 9.1) - 0.5) * 0.18,
      ph: hash(di * 11.3) * 6.28,
      warm: hash(di * 4.4) > 0.35
    });
  }
  var stars = [];
  for (var si = 0; si < 26; si++) {
    stars.push({
      x: hash(si * 2.7) * L.win.w,
      y: hash(si * 5.9) * L.win.h * 0.72,
      r: 0.9 + hash(si * 1.3) * 1.4,
      ph: hash(si * 8.1) * 6.28
    });
  }

  var lastFrameAt = 0;
  var frameCount = 0;

  function drawScene(t) {
    if (!sctx) return;
    sctx.setTransform(renderK, 0, 0, renderK, 0, 0);
    // 静态背景（1 次大 blit）
    sctx.drawImage(bgCanvas, 0, 0, W, H);

    drawWindowDynamic(sctx, t);
    drawDust(sctx, t);

    for (var i = 0; i < 6; i++) {
      drawStationDynamic(sctx, i, t);
    }
    drawCat(sctx, t);
    drawPetShadowGlow(sctx, t);
    drawVignette(sctx);
  }

  function drawWindowDynamic(ctx, t) {
    var w = L.win;
    ctx.save();
    ctx.beginPath();
    ctx.rect(w.x, w.y, w.w, w.h);
    ctx.clip();
    // 星星闪烁
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var a = 0.35 + Math.sin(t * 0.0016 + s.ph) * 0.3;
      ctx.fillStyle = 'rgba(226,240,255,' + a.toFixed(3) + ')';
      ctx.fillRect(w.x + s.x, w.y + s.y, s.r * 2, s.r * 2);
    }
    // 小鲸鱼（剪影）游过
    var span = w.w + 420;
    var wx = w.x + w.w + 150 - ((t * 0.021) % span);
    var wy = w.y + w.h * 0.62 + Math.sin(t * 0.00045) * 12;
    drawWhaleShape(ctx, wx, wy, 0.62, 'rgba(6,16,36,0.82)');
    var wx2 = w.x - 120 + ((t * 0.009 + 900) % span);
    var wy2 = w.y + w.h * 0.36 + Math.sin(t * 0.0006 + 2) * 8;
    drawWhaleShape(ctx, wx2, wy2, 0.32, 'rgba(10,26,52,0.6)');
    // 水母灯（小小的上浮光点）
    for (var j = 0; j < 4; j++) {
      var jx = w.x + 60 + j * 118 + Math.sin(t * 0.0006 + j) * 18;
      var jy = w.y + w.h - 40 - ((t * 0.012 + j * 70) % 200);
      drawGlow(ctx, jx, jy, 20, 20, '120,220,230', 0.30);
      ctx.fillStyle = 'rgba(150,235,240,0.55)';
      ctx.fillRect(jx - 2, jy - 2, 4, 4);
    }
    // 玻璃上的暖色反光（台灯倒影）
    ctx.fillStyle = 'rgba(255,190,110,0.045)';
    ctx.beginPath();
    ctx.ellipse(w.x + w.w * 0.2, w.y + w.h * 0.4, 120, 90, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawWhaleShape(ctx, x, y, s, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, 54, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    // 尾巴
    ctx.beginPath();
    ctx.moveTo(-48, 0);
    ctx.lineTo(-84, -20);
    ctx.lineTo(-70, 0);
    ctx.lineTo(-84, 20);
    ctx.closePath();
    ctx.fill();
    // 胸鳍
    ctx.beginPath();
    ctx.moveTo(-4, 16);
    ctx.ellipse(-8, 24, 16, 8, -0.4, 0, Math.PI * 2);
    ctx.fill();
    // 眼睛
    ctx.fillStyle = 'rgba(226,240,255,0.5)';
    ctx.beginPath();
    ctx.arc(36, -4, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawDust(ctx, t) {
    for (var i = 0; i < dust.length; i++) {
      var d = dust[i];
      var x = d.x + Math.sin(t * 0.0004 + d.ph) * 14 + d.vx * t * 0.05;
      var y = d.y + (d.vy * t * 0.05 + Math.sin(t * 0.0007 + d.ph) * 10) % 40;
      var a = 0.16 + 0.16 * Math.sin(t * 0.0012 + d.ph);
      ctx.fillStyle = d.warm ? 'rgba(255,214,150,' + a.toFixed(3) + ')' : 'rgba(170,205,255,' + (a * 0.8).toFixed(3) + ')';
      ctx.fillRect(x, y, d.r * 2, d.r * 2);
    }
  }

  function drawStationDynamic(ctx, i, t) {
    var rowIdx = i < 3 ? 0 : 1;
    var R = L.rows[rowIdx];
    var cx = L.cols[i % 3];
    var st = ST.stations[i];
    var status = st ? st.status : 'idle';

    drawScreen(ctx, i, R, cx, status, t);

    if (ST.cursor === i) {
      // 观察者光标：金色光环 + 地面光圈
      drawGlow(ctx, cx, R.bottom + 2, R.chairW * 1.5, 60, '255,212,121', 0.20);
      ctx.strokeStyle = 'rgba(255,212,121,0.85)';
      ctx.lineWidth = 4;
      ctx.setLineDash([14, 10]);
      ctx.lineDashOffset = -t * 0.03;
      ctx.beginPath();
      ctx.ellipse(cx, R.bottom + 4, R.chairW * 1.28, R.chairW * 0.20, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    drawPerson(ctx, i, R, cx, st, t);
    drawFloaters(ctx, i, R, cx, status, t);

    // 桌面热气（马克杯）
    var mugX = cx - R.deskCN + 34, mugY = R.deskFar + 20;
    for (var s = 0; s < 3; s++) {
      var ph = t * 0.0011 + s * 1.3 + i;
      var sy = mugY - 6 - ((t * 0.02 + s * 14) % 42);
      var a = 0.24 * (1 - ((t * 0.02 + s * 14) % 42) / 42);
      ctx.fillStyle = 'rgba(226,240,255,' + a.toFixed(3) + ')';
      var sx = mugX + 11 + Math.sin(ph) * 5;
      ctx.fillRect(sx, sy, 3.2, 3.2);
    }
  }

  // 屏幕内容
  function drawScreen(ctx, i, R, cx, status, t) {
    var x0 = cx - R.monW / 2, y0 = R.monY, w = R.monW, h = R.monH;
    var flick = 0.9 + Math.sin(t * 0.004 + i * 2) * 0.06;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, w, h);
    ctx.clip();
    var g = ctx.createLinearGradient(x0, y0, x0, y0 + h);
    if (status === 'error') {
      g.addColorStop(0, 'rgba(46,10,16,0.95)');
      g.addColorStop(1, 'rgba(26,6,10,0.95)');
    } else if (status === 'idle') {
      g.addColorStop(0, 'rgba(8,14,30,0.95)');
      g.addColorStop(1, 'rgba(6,10,22,0.95)');
    } else {
      g.addColorStop(0, 'rgba(7,20,38,0.95)');
      g.addColorStop(1, 'rgba(5,14,28,0.95)');
    }
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0, w, h);

    // 标题栏
    ctx.fillStyle = 'rgba(140,190,255,0.10)';
    ctx.fillRect(x0, y0, w, 12);
    var dotColors = ['#ff6b6b', '#f2c94c', '#62d98a'];
    for (var d = 0; d < 3; d++) {
      ctx.fillStyle = dotColors[d];
      ctx.fillRect(x0 + 6 + d * 9, y0 + 4, 4, 4);
    }

    if (status === 'idle') {
      // 屏保：一只小鲸鱼 + zz
      ctx.globalAlpha = 0.55;
      drawWhaleShape(ctx, x0 + w * 0.5, y0 + h * 0.52, 0.35, 'rgba(80,160,200,0.85)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(150,190,230,0.5)';
      ctx.font = 'bold 13px "Courier New", monospace';
      ctx.fillText('z z', x0 + w * 0.62, y0 + h * 0.32 + Math.sin(t * 0.002) * 3);
    } else if (status === 'error') {
      ctx.fillStyle = 'rgba(255,107,107,0.9)';
      for (var e = 0; e < 4; e++) {
        ctx.fillRect(x0 + 10, y0 + 24 + e * 13, 20 + hash(i * 7 + e) * (w - 50), 4);
      }
      ctx.fillStyle = '#ff9b9b';
      ctx.font = 'bold ' + Math.round(h * 0.42) + 'px "Courier New", monospace';
      ctx.fillText('!', x0 + w * 0.62, y0 + h * 0.78);
    } else if (status === 'waiting') {
      ctx.fillStyle = 'rgba(242,201,76,0.85)';
      for (var q = 0; q < 3; q++) {
        ctx.fillRect(x0 + 10, y0 + 26 + q * 14, 16 + hash(i + q) * (w - 60), 4);
      }
      ctx.fillStyle = '#f2c94c';
      ctx.font = 'bold ' + Math.round(h * 0.46) + 'px "Courier New", monospace';
      ctx.globalAlpha = 0.55 + Math.sin(t * 0.004) * 0.4;
      ctx.fillText('?', x0 + w * 0.66, y0 + h * 0.8);
      ctx.globalAlpha = 1;
    } else {
      // 代码行
      ctx.globalAlpha = flick;
      var lines = 6;
      for (var ln = 0; ln < lines; ln++) {
        var indent = (hash(i * 13 + ln) > 0.7) ? 16 : 8;
        var lw = 22 + hash(i * 3 + ln * 7) * (w - indent - 30);
        var col;
        if (status === 'success') col = ln % 3 === 0 ? 'rgba(98,217,138,0.85)' : 'rgba(140,220,190,0.5)';
        else if (status === 'waiting') col = 'rgba(242,201,76,0.6)';
        else col = ln % 4 === 0 ? 'rgba(106,168,255,0.9)' : ln % 3 === 0 ? 'rgba(63,208,201,0.8)' : 'rgba(200,220,250,0.42)';
        ctx.fillStyle = col;
        ctx.fillRect(x0 + indent, y0 + 22 + ln * 11, lw, 4);
      }
      // 光标
      if (Math.sin(t * 0.006 + i) > 0) {
        ctx.fillStyle = 'rgba(247,236,210,0.9)';
        ctx.fillRect(x0 + 8, y0 + 22 + lines * 11, 7, 6);
      }
      if (status === 'success') {
        ctx.fillStyle = 'rgba(98,217,138,0.9)';
        ctx.fillRect(x0 + 8, y0 + h - 16, w - 16, 4);
        ctx.fillStyle = 'rgba(98,217,138,0.35)';
        ctx.fillRect(x0 + 8, y0 + h - 16, (w - 16) * 0.999, 4);
      }
      ctx.globalAlpha = 1;
    }

    // 扫描线
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    for (var sy = y0; sy < y0 + h; sy += 4) ctx.fillRect(x0, sy, w, 1);
    // 屏幕反光
    ctx.fillStyle = 'rgba(190,225,255,0.05)';
    ctx.beginPath();
    ctx.moveTo(x0 + w * 0.1, y0 + h);
    ctx.lineTo(x0 + w * 0.42, y0);
    ctx.lineTo(x0 + w * 0.6, y0);
    ctx.lineTo(x0 + w * 0.28, y0 + h);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 屏幕外的光晕
    drawGlow(ctx, cx, R.monY + R.monH * 0.5, R.monW * 1.1, R.monH * 0.92, statusGlowRGB(status), 0.16 * flick);
  }

  // 小人：背面 3/4（后脑勺 + 左侧脸 + 后背），椅背从前面压住下半身
  function drawPerson(ctx, i, R, cx, st, t) {
    var pal = PAL[i % PAL.length];
    var status = st ? st.status : 'idle';
    var ph = t * 0.001;
    var bob = 0, sway = 0, slump = 0;
    if (status === 'working') {
      bob = Math.sin(ph * 6.4 + i * 1.3) * 1.8;
      sway = Math.sin(ph * 2.1 + i) * 0.9;
    } else if (status === 'waiting') {
      bob = Math.sin(ph * 1.3 + i) * 1.2;
      sway = Math.sin(ph * 0.75 + i * 2) * 3.4;
    } else if (status === 'success') {
      bob = Math.sin(ph * 2.8 + i) * 1.6 - 2.4;
    } else if (status === 'error') {
      bob = 4 + Math.sin(ph * 5.5 + i) * 0.7;
      slump = 3;
    } else {
      bob = 4.5 + Math.sin(ph * 1.1 + i) * 1.0;
      slump = 5;
    }

    var hw = R.headW, hh = R.headH;
    var hx = cx - 2 + sway * 0.3;
    var hy = R.headY + bob + slump * 0.5;
    var bw = R.bodyW, bh = R.bodyH;
    var bx = cx - bw / 2;
    var by = R.bodyY + slump + bob * 0.4;

    /* ---- 身体（后背）：上宽下窄的小梯形 + 明暗 ---- */
    var bodyGrad = ctx.createLinearGradient(0, by, 0, by + bh);
    bodyGrad.addColorStop(0, pal.shirtHi);
    bodyGrad.addColorStop(0.45, pal.shirt);
    bodyGrad.addColorStop(1, pal.shirtShade || pal.shirt);
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.moveTo(bx + bw * 0.30, by);
    ctx.lineTo(bx + bw * 0.70, by);
    ctx.quadraticCurveTo(bx + bw, by - 2, bx + bw, by + bh * 0.30);
    ctx.quadraticCurveTo(bx + bw, by + bh * 0.62, bx + bw - 5, by + bh * 0.86);
    ctx.quadraticCurveTo(bx + bw - 8, by + bh, bx + bw * 0.66, by + bh);
    ctx.lineTo(bx + bw * 0.34, by + bh);
    ctx.quadraticCurveTo(bx + 8, by + bh, bx + 5, by + bh * 0.86);
    ctx.quadraticCurveTo(bx, by + bh * 0.62, bx, by + bh * 0.30);
    ctx.quadraticCurveTo(bx, by - 2, bx + bw * 0.30, by);
    ctx.closePath();
    ctx.fill();
    // 肩线 + 后背中缝
    ctx.fillStyle = 'rgba(8,14,28,0.20)';
    ctx.fillRect(bx + 12, by + bh * 0.44, bw - 24, 2);
    ctx.fillStyle = 'rgba(8,14,28,0.12)';
    ctx.fillRect(cx - 1, by + bh * 0.30, 2, bh * 0.5);
    // 帽兜（连帽衫）+ 抽绳
    ctx.fillStyle = 'rgba(8,14,28,0.26)';
    ctx.beginPath();
    ctx.ellipse(cx, by + 4, bw * 0.30, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(cx - bw * 0.20, by + 8, 2, 12);
    ctx.fillRect(cx + bw * 0.16, by + 8, 2, 12);

    /* ---- 头（后脑勺 + 左侧脸，用圆形裁剪保证轮廓干净） ---- */
    // 脖子
    ctx.fillStyle = pal.skin;
    ctx.fillRect(cx - 7, by - 6, 14, 12);
    ctx.fillStyle = 'rgba(8,14,28,0.28)';
    ctx.fillRect(cx - 7, by - 2, 14, 5);

    var headCX = hx, headCY = hy + hh * 0.5, headR = hw * 0.5;
    // 马尾（先画，在头后面右侧）
    ctx.fillStyle = pal.hairShade;
    ctx.beginPath();
    ctx.ellipse(headCX + headR * 0.9, headCY + headR * 0.55, headR * 0.34, headR * 0.5, 0.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(headCX, headCY, headR, 0, Math.PI * 2);
    ctx.clip();
    // 脸
    ctx.fillStyle = pal.skin;
    ctx.fillRect(headCX - headR, headCY - headR, headR * 2, headR * 2);
    // 头发：顶部一顶 + 右侧一大片 + 左侧一缕（露出左下的脸颊）
    ctx.fillStyle = pal.hair;
    ctx.beginPath();
    ctx.ellipse(headCX + headR * 0.10, headCY - headR * 0.34, headR * 1.02, headR * 0.78, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(headCX + headR * 0.46, headCY + headR * 0.12, headR * 0.62, headR * 0.92, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(headCX - headR * 0.76, headCY + headR * 0.04, headR * 0.30, headR * 0.86, 0, 0, Math.PI * 2);
    ctx.fill();
    // 头顶呆毛
    ctx.beginPath();
    ctx.ellipse(headCX + headR * 0.18, headCY - headR * 1.02, headR * 0.13, headR * 0.24, 0.5, 0, Math.PI * 2);
    ctx.fill();
    // 头发高光
    ctx.fillStyle = pal.hairHi;
    ctx.beginPath();
    ctx.ellipse(headCX + headR * 0.02, headCY - headR * 0.55, headR * 0.56, headR * 0.16, 0.06, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(headCX - headR * 0.1, headCY - headR * 0.44, headR * 0.5, 2);
    // 腮红
    ctx.fillStyle = 'rgba(240,150,150,0.42)';
    ctx.beginPath();
    ctx.ellipse(headCX - headR * 0.46, headCY + headR * 0.40, headR * 0.16, headR * 0.10, 0, 0, Math.PI * 2);
    ctx.fill();
    // 小嘴
    ctx.fillStyle = 'rgba(90,40,50,0.55)';
    ctx.fillRect(headCX - headR * 0.56, headCY + headR * 0.52, headR * 0.16, 2);
    ctx.restore();
    // 耳机（部分工位，压在头两侧）
    if (i % 3 === 0) {
      ctx.fillStyle = '#1b2740';
      ctx.beginPath();
      ctx.ellipse(headCX + headR * 0.92, headCY + headR * 0.12, headR * 0.22, headR * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3a4a66';
      ctx.beginPath();
      ctx.ellipse(headCX + headR * 0.92, headCY + headR * 0.12, headR * 0.12, headR * 0.20, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // 眼睛（左下的脸颊上）
    var ex = headCX - headR * 0.52, ey = headCY + headR * 0.02;
    var eyeW = Math.max(4, Math.round(headR * 0.20));
    var eyeH = Math.max(5, Math.round(headR * 0.22));
    ctx.fillStyle = '#1b2340';
    if (status === 'idle') {
      ctx.fillRect(ex, ey + 2, eyeW + 2, 2);
    } else if (status === 'error') {
      ctx.fillRect(ex, ey, eyeW, eyeH - 1);
      ctx.fillRect(ex + 1, ey - 3, eyeW - 1, 2);
    } else if (status === 'success') {
      ctx.fillRect(ex - 1, ey + 1, eyeW + 3, 2);
      ctx.fillRect(ex - 1, ey - 1, 2, 2);
      ctx.fillRect(ex + eyeW, ey - 1, 2, 2);
    } else if (status === 'waiting') {
      ctx.fillRect(ex, ey - 2, eyeW, eyeH);
    } else {
      ctx.fillRect(ex, ey, eyeW, eyeH);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(ex + 1, ey + 1, 2, 2);
    }
    // 耳机（部分工位）
    if (i % 3 === 0) {
      ctx.fillStyle = '#1b2740';
      ctx.beginPath();
      ctx.ellipse(hx + hw * 0.52, hy + hh * 0.52, 8, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3a4a66';
      ctx.fillRect(hx + hw * 0.46, hy + hh * 0.42, 5, 11);
      ctx.fillStyle = '#1b2740';
      ctx.fillRect(hx + hw * 0.44, hy + hh * 0.04, 7, 14);
    }
    // 头顶小光点（AI 标记）
    var orbA = status === 'working' ? 0.95 : 0.45;
    var orbX = headCX + headR * 0.95, orbY = headCY - headR * 0.85;
    drawGlow(ctx, orbX, orbY, 17, 17, '120,230,220', 0.42 * orbA);
    ctx.fillStyle = status === 'working' ? '#9ff7ec' : '#6fd0c8';
    ctx.fillRect(orbX - 2.5, orbY - 2.5, 5, 5);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(orbX - 1.5, orbY - 1.5, 2, 2);

    /* ---- 椅背（最靠前，压住身体下半截） ---- */
    var chW = R.chairW, chH = R.chairH, chY = R.chairY;
    var chX = cx - chW / 2;
    ctx.fillStyle = '#132435';
    ctx.fillRect(cx - 7, chY + chH - 4, 14, 12);
    ctx.beginPath();
    ctx.ellipse(cx, chY + chH + 9, 36, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    fillRR(ctx, chX, chY, chW, chH, 20, '#1c3245');
    ctx.fillStyle = '#2b4d66';
    ctx.fillRect(chX + 10, chY + 3, chW - 20, 5);
    ctx.fillStyle = 'rgba(63,208,201,0.10)';
    ctx.fillRect(chX + 12, chY + 12, chW - 24, chH - 22);
    ctx.fillStyle = 'rgba(8,16,28,0.34)';
    ctx.fillRect(cx - 1.5, chY + 10, 3, chH - 16);
    ctx.fillStyle = '#22394d';
    ctx.fillRect(chX - 8, chY + 8, 10, chH - 12);
    ctx.fillRect(chX + chW - 2, chY + 8, 10, chH - 12);
    ctx.fillStyle = 'rgba(160,220,255,0.10)';
    ctx.fillRect(chX + 14, chY + chH - 8, chW - 28, 3);
  }

  // 头顶浮动情绪（zzz / ? / ! / ✨）
  function drawFloaters(ctx, i, R, cx, status, t) {
    if (!R) return;
    var baseX = cx + R.headW / 2 + 8;
    var baseY = R.headY - 18;
    ctx.save();
    ctx.font = 'bold ' + (i < 3 ? 18 : 21) + 'px "Courier New", monospace';
    ctx.textAlign = 'center';
    if (status === 'idle') {
      for (var z = 0; z < 3; z++) {
        var p = ((t * 0.0012 + z * 0.33 + i * 0.11) % 1);
        var a = (1 - p) * 0.8;
        ctx.fillStyle = 'rgba(180,200,235,' + a.toFixed(3) + ')';
        ctx.fillText('z', baseX - p * 26, baseY - p * 30);
      }
    } else if (status === 'waiting') {
      var a2 = 0.55 + Math.sin(t * 0.005 + i) * 0.35;
      ctx.fillStyle = 'rgba(242,201,76,' + a2.toFixed(3) + ')';
      ctx.fillText('?', baseX + 6, baseY - 12);
    } else if (status === 'error') {
      var a3 = 0.6 + Math.sin(t * 0.008 + i) * 0.35;
      ctx.fillStyle = 'rgba(255,107,107,' + a3.toFixed(3) + ')';
      ctx.fillText('!', baseX + 6, baseY - 14);
      // 汗滴
      ctx.fillStyle = 'rgba(120,190,255,0.8)';
      ctx.beginPath();
      ctx.ellipse(cx + R.headW / 2 + 12, R.headY + 14, 3, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (status === 'success') {
      for (var s = 0; s < 3; s++) {
        var ang = t * 0.002 + s * 2.1 + i;
        var rr2 = 22;
        var a4 = 0.5 + Math.sin(t * 0.005 + s) * 0.4;
        ctx.fillStyle = 'rgba(255,214,120,' + a4.toFixed(3) + ')';
        ctx.fillRect(baseX + Math.cos(ang) * rr2, baseY - 10 + Math.sin(ang) * rr2 * 0.6, 4, 4);
      }
    }
    ctx.restore();
  }

  // 睡着的猫（右侧地毯上）
  function drawCat(ctx, t) {
    var breathe = Math.sin(t * 0.0016) * 1.6;
    var cx = 1452, cy = 986;
    ctx.fillStyle = 'rgba(4,8,18,0.28)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 20, 62, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    // 身体
    fillRR(ctx, cx - 52, cy - 14 + breathe * 0.3, 104, 36, 18, '#3a4a66');
    ctx.fillStyle = '#4a5c7c';
    ctx.beginPath();
    ctx.ellipse(cx - 18, cy - 8 + breathe * 0.3, 30, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    // 头
    ctx.fillStyle = '#3a4a66';
    ctx.beginPath();
    ctx.arc(cx + 40, cy + 2 + breathe * 0.3, 19, 0, Math.PI * 2);
    ctx.fill();
    // 耳朵
    ctx.beginPath();
    ctx.moveTo(cx + 28, cy - 12 + breathe * 0.3);
    ctx.lineTo(cx + 34, cy - 26 + breathe * 0.3);
    ctx.lineTo(cx + 42, cy - 12 + breathe * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 46, cy - 14 + breathe * 0.3);
    ctx.lineTo(cx + 52, cy - 27 + breathe * 0.3);
    ctx.lineTo(cx + 58, cy - 13 + breathe * 0.3);
    ctx.closePath();
    ctx.fill();
    // 闭眼
    ctx.fillStyle = 'rgba(10,18,34,0.85)';
    ctx.fillRect(cx + 44, cy - 2 + breathe * 0.3, 9, 2);
    // 尾巴
    ctx.strokeStyle = '#3a4a66';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 50, cy + 10);
    ctx.quadraticCurveTo(cx - 76, cy + 14, cx - 66, cy + 30 - breathe * 0.6);
    ctx.stroke();
    ctx.lineCap = 'butt';
    // 呼吸光
    drawGlow(ctx, cx + 6, cy + 4, 70, 40, '120,180,255', 0.08);
  }

  function drawPetShadowGlow(ctx, t) {
    var b = L.petBox;
    var x = b.x + b.w * 0.533;
    // 她身上的暖色轮廓光（跟随呼吸）
    var a = 0.10 + Math.sin(t * 0.0015) * 0.03;
    drawGlow(ctx, x, b.y + b.h * 0.62, b.w * 0.5, b.h * 0.5, '255,200,140', a);
  }

  function drawVignette(ctx) {
    if (!vignetteGrad) {
      var g = ctx.createRadialGradient(W / 2, H * 0.48, H * 0.3, W / 2, H * 0.5, H * 0.96);
      g.addColorStop(0, 'rgba(4,7,16,0)');
      g.addColorStop(0.66, 'rgba(4,7,16,0.10)');
      g.addColorStop(1, 'rgba(4,7,16,0.50)');
      vignetteGrad = g;
    }
    ctx.fillStyle = vignetteGrad;
    ctx.fillRect(0, 0, W, H);
    // 主角豁免：把右侧压暗的地方再提亮回来（她不能被埋进阴影里）
    var b = L.petBox;
    var px = b.x + b.w * 0.533;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var rg = ctx.createRadialGradient(px, 860, 40, px, 880, 470);
    rg.addColorStop(0, 'rgba(255,206,140,0.13)');
    rg.addColorStop(0.55, 'rgba(255,196,128,0.05)');
    rg.addColorStop(1, 'rgba(255,190,110,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(px - 480, 380, 960, 660);
    ctx.restore();
    // 暖色调 + 月光冷调
    ctx.fillStyle = 'rgba(255,180,90,0.035)';
    ctx.fillRect(0, 0, W * 0.72, H);
    ctx.fillStyle = 'rgba(80,140,220,0.03)';
    ctx.fillRect(W * 0.68, 0, W * 0.32, H);
  }

  /* ---------------------------------------------------------------- 鲸鱼娘 */
  var PET = {
    index: null,
    fps: 24,
    cache: {},        // clip -> {urls, imgs, state, loading, loaded, lastUse}
    order: [],        // LRU：只保留 2 个 clip
    canvas: null,
    ctx: null,
    cur: null,        // {name, cache, start, live, oneShotEnd}
    lastImg: null,
    lastIdx: -1,
    fade: null,       // {img, start, dur} —— 画布内淡入淡出（不依赖 CSS opacity）
    moodBase: 'idle',
    placeholderAt: 0
  };
  var PET_BOX = L.petBox;

  function layoutPetCanvases() {
    var layer = $('#pet-layer');
    layer.style.left = PET_BOX.x + 'px';
    layer.style.top = PET_BOX.y + 'px';
    layer.style.width = PET_BOX.w + 'px';
    layer.style.height = PET_BOX.h + 'px';
    var cnv = $('#pet');
    if (!cnv) return;
    PET.canvas = cnv;
    cnv.width = Math.round(PET_BOX.w * renderK);
    cnv.height = Math.round(PET_BOX.h * renderK);
    PET.ctx = cnv.getContext('2d');
    PET.ctx.imageSmoothingEnabled = true;
    PET.ctx.imageSmoothingQuality = 'high';
    PET.lastIdx = -1;
  }

  function petHasClip(name) {
    return !!(PET.index && PET.index.clips && PET.index.clips[name] && PET.index.clips[name].length);
  }

  function clipForMood(mood) {
    var map = {
      idle: 'idle', idle_yawn: 'idle_yawn', idle_stretch: 'idle_stretch', thinking: 'thinking',
      working: 'working', working_command: 'working_command', working_search: 'working_search',
      waiting: 'waiting', success: 'success', error: 'error', poke: 'poke', head_pat: 'head_pat',
      tail: 'tail', eat_token: 'idle', dragging: 'idle', dragging_release: 'idle'
    };
    var want = map[mood] || 'idle';
    if (petHasClip(want)) return want;
    var fallbacks = ['idle', 'working', 'thinking', 'waiting', 'success', 'error'];
    for (var i = 0; i < fallbacks.length; i++) if (petHasClip(fallbacks[i])) return fallbacks[i];
    return null;
  }

  function petCacheGet(name) {
    var c = PET.cache[name];
    if (!c) {
      var urls = (PET.index && PET.index.clips && PET.index.clips[name]) || [];
      c = {
        name: name, urls: urls, imgs: new Array(urls.length), state: new Array(urls.length),
        loading: 0, loaded: 0, lastUse: nowMs()
      };
      for (var i = 0; i < urls.length; i++) { c.imgs[i] = null; c.state[i] = 0; }
      PET.cache[name] = c;
    }
    c.lastUse = nowMs();
    if (PET.order.indexOf(name) < 0) PET.order.push(name);
    while (PET.order.length > 2) {
      var oldName = PET.order.shift();
      if (oldName === name) continue;
      evictClip(oldName);
    }
    return c;
  }
  function evictClip(name) {
    var c = PET.cache[name];
    if (!c) return;
    for (var i = 0; i < c.imgs.length; i++) { c.imgs[i] = null; c.state[i] = 0; }
    c.loading = 0; c.loaded = 0;
    delete PET.cache[name];
  }

  function clipLoad(c, i) {
    if (c.state[i] !== 0) return;
    c.state[i] = 1;
    c.loading++;
    var img = new Image();
    img.onload = function () { c.state[i] = 2; c.loading--; c.loaded++; };
    img.onerror = function () { c.state[i] = 3; c.loading--; };
    img.src = c.urls[i];
    c.imgs[i] = img;
  }

  // 环形预取：只解码当前帧前后十几帧（0.57MB/帧 → 上限 24 帧 ≈ 14MB）
  var PET_AHEAD = 10, PET_CONC = 4, PET_KEEP_BEHIND = 14, PET_MAX_FRAMES = 24;
  function clipPump(c, playhead) {
    var n = c.urls.length;
    if (!n) return;
    for (var d = 0; d < PET_AHEAD; d++) {
      if (c.loading >= PET_CONC) break;
      var i = (playhead + d) % n;
      if (c.state[i] === 0) clipLoad(c, i);
    }
    if (c.loaded > PET_MAX_FRAMES) {
      for (var b = PET_KEEP_BEHIND; b < n && c.loaded > PET_MAX_FRAMES; b++) {
        var j = ((playhead - b) % n + n) % n;
        if (c.state[j] === 2) { c.imgs[j] = null; c.state[j] = 0; c.loaded--; }
      }
    }
  }

  function petSetClip(name, opts) {
    if (!name) return;
    if (PET.cur && PET.cur.name === name && !(opts && opts.restart)) {
      if (opts && opts.oneShotMs) PET.cur.oneShotEnd = nowMs() + opts.oneShotMs;
      return;
    }
    var c = petCacheGet(name);
    if (!c.urls.length) return;
    // 旧画面留着做淡出，新画面第一帧到了再淡入
    if (PET.lastImg) PET.fade = { img: PET.lastImg, start: nowMs(), dur: 200 };
    PET.cur = {
      name: name, cache: c, start: 0, live: false,
      oneShotEnd: (opts && opts.oneShotMs) ? nowMs() + opts.oneShotMs : 0
    };
    clipLoad(c, 0);
  }

  function drawPetImage(img, now) {
    var g = PET.ctx, cnv = PET.canvas;
    if (!g || !cnv) return;
    var w = cnv.width, h = cnv.height;
    g.clearRect(0, 0, w, h);
    var f = PET.fade;
    if (f && now - f.start < f.dur) {
      var k = (now - f.start) / f.dur;
      if (k < 0) k = 0;
      g.globalAlpha = 1 - k;
      try { g.drawImage(f.img, 0, 0, w, h); } catch (e) {}
      g.globalAlpha = k;
      try { g.drawImage(img, 0, 0, w, h); } catch (e) {}
      g.globalAlpha = 1;
    } else {
      PET.fade = null;
      g.globalAlpha = 1;
      try { g.drawImage(img, 0, 0, w, h); } catch (e) {}
    }
    PET.lastImg = img;
  }

  function petDrawFrame(force) {
    var t = nowMs();
    // 一次性动作播完回到基础情绪
    if (PET.cur && PET.cur.oneShotEnd && t > PET.cur.oneShotEnd) {
      var back = clipForMood(PET.moodBase);
      if (back && back !== PET.cur.name) petSetClip(back, null);
      else PET.cur.oneShotEnd = 0;
    }
    if (!PET.cur) { petPlaceholder(t); return; }
    var c = PET.cur.cache;
    var n = c.urls.length;
    if (!n) return;
    var idx;
    if (!PET.cur.live) {
      // 等第一帧：没到之前保留上一帧画面（不闪、不白）
      var f = -1;
      for (var i = 0; i < Math.min(n, 12); i++) {
        if (c.state[i] === 2) { f = i; break; }
      }
      if (f < 0) { clipPump(c, 0); return; }
      PET.cur.live = true;
      PET.cur.start = t - (f * 1000) / PET.fps;
      idx = f;
    } else {
      idx = Math.floor(((t - PET.cur.start) * PET.fps) / 1000) % n;
      if (idx < 0) idx = 0;
    }
    clipPump(c, idx);
    var img = (c.state[idx] === 2) ? c.imgs[idx] : null;
    if (!img) img = PET.lastImg;   // 帧没到就画上一帧
    if (!img) return;
    if (!force && idx === PET.lastIdx) return;
    drawPetImage(img, t);
    PET.lastIdx = idx;
  }

  // 没有帧时的占位（纯 canvas，绝不外链）
  function petPlaceholder(t) {
    var g = PET.ctx, cnv = PET.canvas;
    if (!g || !cnv) return;
    if (PET.lastImg) return;
    var w = cnv.width, h = cnv.height;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(44,58,110,0.85)';
    g.beginPath();
    g.ellipse(w * 0.5, h * 0.74, w * 0.15, h * 0.22, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(w * 0.5, h * 0.36, w * 0.10, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(63,208,201,0.8)';
    g.fillRect(w * 0.47, h * 0.33, w * 0.025, h * 0.018);
    g.fillRect(w * 0.52, h * 0.33, w * 0.025, h * 0.018);
  }

  /* ---------------------------------------------------------------- 本地台词库 */
  var LINES = {
    poke: [
      '呀！你戳到我啦～',
      '咯咯，好痒呀！',
      '再戳我就游走咯～',
      '嘿嘿，被你发现我在偷看代码了。'
    ],
    head_pat: [
      '呼噜呼噜…好舒服。',
      '再摸一下下就够啦。',
      '你的手好暖和呀。'
    ],
    tail: [
      '哎呀，尾巴！尾巴会打结的！',
      '尾巴是我的小方向盘～'
    ],
    hello: [
      '晚上好呀，办公室还亮着灯呢。',
      '我在这儿看着大家上班，一点都不困～',
      '要不要我讲讲他们在干嘛？'
    ],
    busy: [
      '有人开工啦！我听见键盘在唱歌。',
      '嗯…有个小朋友遇到难题了，我去给他打气。',
      '又有人在写代码啦，屏幕亮亮的。'
    ],
    panelOpen: ['想聊点什么呀？', '我在这儿呢，你按吧～'],
    thinking: ['……', '…'],
    chatDone: ['嗯，就是这样啦。', '我说完啦，你听懂了吗？', '还想听的话再按我一次。']
  };
  function pickLine(arr, noRepeat) {
    var l = arr[(Math.random() * arr.length) | 0];
    if (noRepeat && arr.length > 1 && l === noRepeat) return pickLine(arr, noRepeat);
    return l;
  }

  var STATUS_PHRASE = {
    working: ['正在认真干活', '对着屏幕敲个不停', '一步一步往前走'],
    waiting: ['在等一个决定', '在门口探头探脑地等', '卡在一个小问题上等人回话'],
    success: ['刚刚收工', '把事情做完啦', '正在伸懒腰'],
    idle: ['在发呆', '可能在想午饭', '安安静静地坐着'],
    error: ['卡住了', '遇到一点小麻烦', '眉头皱成一团']
  };

  function stationNarration(i) {
    var st = ST.stations[i];
    if (!st) {
      return '这个工位还空着呢。等有新朋友来上班，就会坐下来敲键盘啦。';
    }
    var phrase = pickLine(STATUS_PHRASE[st.status] || STATUS_PHRASE.idle);
    var s = '这个工位是「' + st.title + '」。' + phrase;
    if (st.step > 0) s += '，已经走到第 ' + st.step + ' 步了';
    s += '。';
    if (st.todos && st.todos.total > 0) {
      s += '小任务做了 ' + st.todos.done + ' / ' + st.todos.total + ' 个';
      s += st.todos.done >= st.todos.total ? '，全做完啦，厉害吧！' : '。';
    } else {
      s += ' 他还没列计划，估计正在想。';
    }
    if (st.elapsedSec > 60 && st.status === 'working') s += ' 他今天已经忙了 ' + fmtDur(st.elapsedSec) + '。';
    return s;
  }

  // 本地解说（聊天的兜底 / mock）
  function localAnswer(question) {
    var sts = ST.stations.filter(function (s) { return !!s; });
    var running = sts.filter(function (s) { return s.status === 'working'; });
    var waiting = sts.filter(function (s) { return s.status === 'waiting'; });
    var idle = sts.filter(function (s) { return s.status === 'idle'; });
    var err = sts.filter(function (s) { return s.status === 'error'; });
    var done = sts.filter(function (s) { return s.status === 'success'; });
    if (question.indexOf('忙什么') >= 0 || question.indexOf('在忙') >= 0) {
      var s1 = '现在办公室里有 ' + sts.length + ' 个小朋友。';
      if (running.length) {
        var r0 = running[0];
        s1 += '最热闹的是「' + r0.title + '」，' + pickLine(STATUS_PHRASE.working) + '，在第 ' + (r0.step || 1) + ' 步。';
      }
      if (waiting.length) s1 += '还有一个在等人回话，可怜巴巴的。';
      if (idle.length) s1 += '也有人正在发呆，可能在偷偷想晚饭。';
      if (!running.length && !waiting.length) s1 += '大家好像都在休息，办公室安安静静的。';
      return s1;
    }
    if (question.indexOf('最努力') >= 0 || question.indexOf('谁最') >= 0) {
      var best = null, bestScore = -1;
      for (var i = 0; i < sts.length; i++) {
        var s = sts[i];
        var score = (s.todos ? s.todos.done * 3 : 0) + (s.step || 0) + (s.elapsedSec || 0) / 120;
        if (s.status === 'working') score += 30;
        if (score > bestScore) { bestScore = score; best = s; }
      }
      if (!best) return '大家都还没开始干活呢，我最努力！我一直在看着办公室。';
      return '我觉得是「' + best.title + '」。他做了 ' + (best.todos ? best.todos.done : 0) + ' 个小任务，走了 ' + (best.step || 0) + ' 步，' +
        (best.status === 'working' ? '现在还在敲键盘呢。' : '虽然现在在休息，但今天很努力。') + ' 不过说实话，我也很努力，我一直在游泳。';
    }
    // 讲个故事
    var stories = [
      '有天晚上，办公室的台灯忘了关。一条小鲸鱼从窗户外面游进来，看见屏幕上还亮着代码，就趴在窗台上看了一整夜。第二天早上，代码自己跑通了，大家都不知道是谁帮忙的。',
      '前几天，有人写代码写得太认真，把咖啡杯当成了鼠标垫。后来他发现的时候，杯子已经印在桌子上了，圆圆的，像个小月亮。',
      '有只小猫每天晚上都来办公室睡觉，它最喜欢趴在饮水机旁边，因为那里最暖和。它还会偷偷看屏幕，据说能看懂一半的代码。',
      '有一次，办公室的灯突然闪了一下，大家以为跳闸了。结果是一条鲸鱼从窗外游过，尾巴扫到了月亮。灯又亮了，代码也跑通了，很神奇吧。'
    ];
    var idx = Math.floor((Date.now() / 60000) % stories.length);
    return stories[idx];
  }

  /* ---------------------------------------------------------------- DOM 卡片 */
  var cards = [];
  function buildCards() {
    var wrap = $('#cards');
    wrap.innerHTML = '';
    cards = [];
    for (var i = 0; i < 6; i++) {
      var row = i < 3 ? 0 : 1;
      var R = L.rows[row];
      var c = el('div', 'card');
      c.style.width = R.cardW + 'px';
      c.style.left = (L.cols[i % 3] - R.cardW / 2) + 'px';
      c.style.top = R.cardY + 'px';
      var r1 = el('div', 'row1');
      var dot = el('i', 'dot idle');
      var title = el('span', 'title', '');
      var badge = el('span', 'badge', '观察中');
      r1.appendChild(dot); r1.appendChild(title); r1.appendChild(badge);
      var r2 = el('div', 'row2');
      var act = el('span', 'act', '');
      var todos = el('span', 'todos', '');
      r2.appendChild(act); r2.appendChild(todos);
      var bar = el('div', 'bar');
      var fill = el('i', '');
      bar.appendChild(fill);
      var tail = el('i', 'tail');
      c.appendChild(r1); c.appendChild(r2); c.appendChild(bar); c.appendChild(tail);
      wrap.appendChild(c);
      cards.push({ root: c, dot: dot, title: title, act: act, todos: todos, fill: fill });
    }
  }

  function renderCards() {
    for (var i = 0; i < 6; i++) {
      var st = ST.stations[i];
      var c = cards[i];
      if (!c) continue;
      if (!st) {
        c.root.className = 'card empty' + (ST.cursor === i ? ' sel' : '');
        c.dot.className = 'dot idle';
        c.title.textContent = '空工位 · 等一个会话';
        c.act.textContent = '还没有人坐在这里';
        c.todos.textContent = '';
        c.fill.style.width = '0%';
        c.fill.style.background = '#8b93a8';
        continue;
      }
      c.root.className = 'card' + (ST.cursor === i ? ' sel' : '');
      c.dot.className = 'dot ' + st.status;
      c.title.textContent = st.title;
      c.title.title = st.title;
      var act = st.activity || (st.running ? '正在运行' : '安静地待机');
      if (ST.cursor === i) {
        act = act + ' · 已跑 ' + fmtDur(st.elapsedSec);
        if (st.team && st.team.length) act += ' · ' + st.team.length + ' 位同事在旁';
      }
      c.act.textContent = act;
      if (st.todos && st.todos.total > 0) {
        c.todos.textContent = st.todos.done + '/' + st.todos.total;
      } else {
        c.todos.textContent = st.step ? '第 ' + st.step + ' 步' : '';
      }
      var pct = st.todos && st.todos.total ? Math.round((st.todos.done / st.todos.total) * 100) : 0;
      c.fill.style.width = pct + '%';
      c.fill.style.background = statusColor(st.status);
    }
  }

  /* ---------------------------------------------------------------- 数据层 */
  function normSession(s) {
    var status = s.status;
    if (['working', 'waiting', 'success', 'idle', 'error'].indexOf(status) < 0) {
      status = s.running ? 'working' : 'idle';
    }
    var lat = s.lastActivityAt || 0;
    if (lat > 0 && lat < 1e12) lat = lat * 1000;
    return {
      id: s.id || ('s' + Math.random()),
      title: (s.title || '未命名会话').replace(/\s+/g, ' ').trim(),
      running: !!s.running,
      status: status,
      elapsedSec: s.elapsedSec || 0,
      step: s.step || 0,
      turns: s.turns || 0,
      activity: s.activity || '',
      todos: s.todos || { done: 0, total: 0 },
      team: s.team || [],
      lastActivityAt: lat
    };
  }

  function priority(s) {
    var p = 0;
    if (s.running) p += 100;
    if (s.status === 'working') p += 60;
    if (s.status === 'waiting') p += 40;
    if (s.status === 'error') p += 30;
    if (s.status === 'success') p += 20;
    return p;
  }

  function applyState(data) {
    ST.data = data;
    var sessions = [];
    var ws = data.workspaces || [];
    for (var i = 0; i < ws.length; i++) {
      var arr = ws[i].sessions || [];
      for (var j = 0; j < arr.length; j++) sessions.push(normSession(arr[j]));
    }
    var byId = {};
    for (var k = 0; k < sessions.length; k++) byId[sessions[k].id] = sessions[k];

    var used = {};
    var slots = ST.slotIds;
    for (var a = 0; a < 6; a++) {
      if (slots[a] && byId[slots[a]]) used[slots[a]] = true;
      else slots[a] = null;
    }
    var pending = sessions.filter(function (s) { return !used[s.id]; });
    pending.sort(function (x, y) {
      var d = priority(y) - priority(x);
      if (d !== 0) return d;
      return (y.lastActivityAt || 0) - (x.lastActivityAt || 0);
    });
    for (var b = 0; b < 6; b++) {
      if (!slots[b] && pending.length) {
        var pick = pending.shift();
        slots[b] = pick.id;
      }
    }
    var alive = 0;
    for (var c = 0; c < 6; c++) {
      ST.stations[c] = slots[c] && byId[slots[c]] ? byId[slots[c]] : null;
      if (ST.stations[c]) alive++;
    }
    ST.hiddenCount = Math.max(0, sessions.length - alive);

    // 鲸鱼娘情绪：优先契约里的 pet.mood，其次按工位推导
    var mood = (data.pet && data.pet.mood) || deriveMood();
    ST.petMoodFromState = mood;
    PET.moodBase = clipForMood(mood) || 'idle';
    if (!PET.cur || (!PET.cur.oneShotEnd || nowMs() > PET.cur.oneShotEnd)) {
      if (PET.cur && PET.cur.name !== PET.moodBase) petSetClip(PET.moodBase, null);
      else if (!PET.cur) petSetClip(PET.moodBase, null);
    }

    updateHud(data);
    renderCards();
    maybeMoodLine(mood);
    maybeGreet();
  }

  function deriveMood() {
    var sts = ST.stations;
    var any = false, working = false, waiting = false, error = false, success = false;
    for (var i = 0; i < 6; i++) {
      var s = sts[i];
      if (!s) continue;
      any = true;
      if (s.status === 'working') working = true;
      if (s.status === 'waiting') waiting = true;
      if (s.status === 'error') error = true;
      if (s.status === 'success') success = true;
    }
    if (!any) return 'idle';
    if (error) return 'error';
    if (working) return 'working';
    if (waiting) return 'waiting';
    if (success) return 'success';
    return 'idle_yawn';
  }

  var greeted = false;
  function maybeGreet() {
    if (greeted || !ST.connected) return;
    if (ST.panelOpen || ST.cursor >= 0) return;
    greeted = true;
    setTimeout(function () {
      if (ST.panelOpen) return;
      sayBubble(pickLine(LINES.hello), 6000);
    }, 900);
  }

  var lastMoodForLine = '';
  function maybeMoodLine(mood) {
    var t = nowMs();
    if (mood === lastMoodForLine) return;
    lastMoodForLine = mood;
    if (t - ST.lastMoodLineAt < 14000) return;
    if (ST.panelOpen || ST.cursor >= 0) return;
    var line = null;
    if (mood === 'working') line = pickLine(LINES.busy);
    else if (mood === 'error') line = '哎呀，有人遇到麻烦了，我去看看～';
    else if (mood === 'success') line = '有人做完啦，叮！收工！';
    else if (mood === 'waiting') line = '有人在等人回话，我先陪他坐着。';
    if (!line) return;
    ST.lastMoodLineAt = t;
    sayBubble(line, 5200);
  }

  function updateHud(data) {
    var stats = (data && data.stats) || {};
    var sub = $('#plaque-sub');
    var n = 0;
    for (var i = 0; i < 6; i++) if (ST.stations[i]) n++;
    var running = 0;
    for (var j = 0; j < 6; j++) if (ST.stations[j] && ST.stations[j].status === 'working') running++;
    var parts = [];
    parts.push((stats.sessions || n) + ' 个会话');
    parts.push(running + ' 个在忙');
    if (stats.teammates) parts.push(stats.teammates + ' 位同事');
    if (ST.hiddenCount > 0) parts.push('还有 ' + ST.hiddenCount + ' 个在别的房间');
    sub.textContent = parts.join(' · ');
    $('#live-text').textContent = ST.connected ? '直播中' : '重连中';
    var ld = $('#live-dot');
    ld.className = 'live-dot' + (ST.connected ? '' : ' off');
    updateClock();
  }

  function updateClock() {
    var d = new Date();
    var txt = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    var c = $('#clock');
    if (c && c.textContent !== txt) c.textContent = txt;
  }

  /* ---------------------------------------------------------------- 气泡 / toast */
  var bubbleTimer = 0;
  function sayBubble(text, ms) {
    var b = $('#pet-bubble');
    var tx = $('#pet-bubble-text');
    if (!text) { hideBubble(); return; }
    tx.textContent = text;
    b.classList.remove('is-hidden');
    b.classList.remove('dots');
    ST.bubbleUntil = nowMs() + (ms || 5000);
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(function () {
      if (nowMs() >= ST.bubbleUntil) hideBubble();
    }, (ms || 5000) + 60);
  }
  function sayDots() {
    var b = $('#pet-bubble');
    var tx = $('#pet-bubble-text');
    b.classList.remove('is-hidden');
    b.classList.add('dots');
    tx.textContent = '…';
    ST.bubbleUntil = nowMs() + 20000;
  }
  function hideBubble() {
    $('#pet-bubble').classList.add('is-hidden');
    ST.bubbleUntil = 0;
  }
  var toastTimer = 0;
  function toast(html, ms) {
    var t = $('#toast');
    t.innerHTML = html;
    t.classList.remove('is-hidden');
    ST.toastUntil = nowMs() + (ms || 3200);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('is-hidden'); }, ms || 3200);
  }

  /* ---------------------------------------------------------------- 原生桥 */
  function native(fn, arg) {
    try {
      var n = window.DshTvNative;
      if (n && typeof n[fn] === 'function') n[fn](arg);
    } catch (e) { /* no-op：浏览器调试时忽略 */ }
  }
  /** 同时打到 logcat（DshTv: ...）和浏览器 console：验收时能一眼看出走了哪条音频路径。 */
  function tvLog(msg) {
    try { console.log('[DshTv] ' + msg); } catch (e) { /* ignore */ }
    native('log', String(msg));
  }

  /* ---------------------------------------------------------------- TTS
   * 优先播 bridge 的 /api/tts（edge-tts 中文 mp3），失败/503/慢/播放被拒时
   * 回退 DshTvNative.speak(text)（Android 系统 TTS）。字幕/打字机不依赖这里。
   */
  var audioUnlocked = false;   // 首次用户按键后才启用音频（WebView 自动播放策略）
  var ttsAudio = null;
  var ttsSeq = 0;
  var ttsLastText = '';
  var ttsLastAt = 0;

  function markAudioUnlocked() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    tvLog('tts: audio unlocked by first user key');
  }
  function stopRemoteAudio() {
    if (!ttsAudio) return;
    var a = ttsAudio;
    ttsAudio = null;
    try { a.pause(); } catch (e) { /* ignore */ }
    try { a.removeAttribute('src'); a.load(); } catch (e) { /* ignore */ }
  }
  function nativeSpeak(text) {
    try {
      var n = window.DshTvNative;
      if (n && typeof n.speak === 'function') {
        n.speak(String(text));
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function speak(text) {
    if (!text) return;
    text = String(text);
    var t = nowMs();
    // 200 ms 去抖：同一句不重复播（typeReply / 聊天 finish 可能连发两次）
    if (text === ttsLastText && t - ttsLastAt < 200) return;
    ttsLastText = text;
    ttsLastAt = t;
    stopRemoteAudio();
    if (!audioUnlocked || typeof window.Audio !== 'function') {
      tvLog('tts: audio not enabled yet -> native (' + text.slice(0, 20) + ')');
      nativeSpeak(text);
      return;
    }
    playRemoteTts(text);
  }

  function playRemoteTts(text) {
    var seq = ++ttsSeq;
    var started = false;
    var fellBack = false;
    var url = '/api/tts?text=' + encodeURIComponent(text);
    var audio;
    function fallback(reason) {
      if (fellBack) return;
      fellBack = true;
      if (ttsAudio === audio) ttsAudio = null;
      try { audio.pause(); } catch (e) { /* ignore */ }
      tvLog('tts: /api/tts failed (' + reason + ') -> native speak');
      nativeSpeak(text);
    }
    try {
      audio = new Audio(url);
    } catch (e) {
      tvLog('tts: new Audio threw (' + e + ') -> native speak');
      nativeSpeak(text);
      return;
    }
    audio.preload = 'auto';
    ttsAudio = audio;
    audio.addEventListener('playing', function () {
      if (seq !== ttsSeq) return;
      started = true;
      tvLog('tts: playing /api/tts audio (' + text.length + ' chars)');
    });
    audio.addEventListener('ended', function () {
      if (ttsAudio === audio) ttsAudio = null;
    });
    audio.addEventListener('error', function () {
      fallback('media error');
    });
    var p;
    try {
      p = audio.play();
    } catch (e) {
      fallback('play threw');
      return;
    }
    if (p && typeof p.then === 'function') {
      p.then(null, function () { fallback('play rejected'); });
    }
    // 看门狗：接口挂住/空音频/迟迟不播（edge-tts 慢或 503）时回退系统 TTS
    setTimeout(function () {
      if (seq !== ttsSeq || fellBack) return;
      if (started) return;
      if (ttsAudio === audio) ttsAudio = null;
      fellBack = true;
      try { audio.pause(); } catch (e2) { /* ignore */ }
      tvLog('tts: /api/tts did not start in 3500 ms -> native speak');
      nativeSpeak(text);
    }, 3500);
  }

  function stopSpeak() {
    ttsSeq++;
    stopRemoteAudio();
    native('stopSpeak');
  }

  /* ---------------------------------------------------------------- 交互动作 */
  var lastPokeClip = '';
  function doPoke() {
    var opts = ['poke', 'head_pat', 'tail'];
    var name = opts[(Math.random() * opts.length) | 0];
    if (name === lastPokeClip) name = opts[(opts.indexOf(name) + 1) % opts.length];
    lastPokeClip = name;
    if (petHasClip(name)) petSetClip(name, { oneShotMs: 1700, restart: true });
    else if (petHasClip('poke')) petSetClip('poke', { oneShotMs: 1700, restart: true });
    var line = pickLine(LINES[name] || LINES.poke);
    sayBubble(line, 3600);
    speak(line);
    // 面板关着的时候按 ok 也把观察者光标收起来
    if (ST.cursor >= 0) { ST.cursor = -1; renderCards(); }
    ST.lastMoodLineAt = nowMs();
  }

  function moveCursor(dir) {
    var next = ST.cursor;
    if (next < 0) {
      next = 0;
    } else {
      var row = next < 3 ? 0 : 1;
      var col = next % 3;
      if (dir === 'left') col = (col + 2) % 3;
      else if (dir === 'right') col = (col + 1) % 3;
      else if (dir === 'up') row = row === 1 ? 0 : 1;
      else if (dir === 'down') row = row === 0 ? 1 : 0;
      next = row * 3 + col;
    }
    ST.cursor = next;
    ST.cursorAt = nowMs();
    renderCards();
    var st = ST.stations[next];
    if (st) {
      sayBubble('「' + truncate(st.title, 16) + '」' + (STATUS[st.status] || STATUS.idle).name + '中…按 Ok 我给你讲讲。', 4200);
    } else {
      sayBubble('这个工位还空着，按 Ok 我也可以讲讲。', 3600);
    }
  }
  function truncate(s, n) {
    s = s || '';
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  function narrateStation(i) {
    var text = stationNarration(i);
    sayBubble(text, Math.max(6000, Math.min(14000, text.length * 220)));
    speak(text);
    if (petHasClip('thinking')) petSetClip('thinking', { oneShotMs: 2600, restart: true });
    ST.cursorAt = nowMs();
    ST.lastMoodLineAt = nowMs();
  }

  /* -------- 面板 -------- */
  var QUESTIONS = ['他们在忙什么？', '谁最努力？', '给我讲个办公室小故事', '再听一遍'];
  var VOICE_REASONS = {
    no_service: '这台电视没有系统语音识别，遥控器麦克风被小爱占用了，改用手机/USB 麦吧',
    cancelled: '好啦，不测了',
    timeout: '等太久啦',
    error: '语音识别出错了，再试一次？'
  };
  var voiceTestPending = false;

  function buildPanel() {
    var list = $('#qlist');
    list.innerHTML = '';
    list.className = 'qlist has-voice';
    var icos = ['忙', '谁', '故', '听'];
    for (var i = 0; i < QUESTIONS.length; i++) {
      var b = el('button', 'q');
      b.setAttribute('data-i', i);
      var ic = el('span', 'qico', icos[i]);
      b.appendChild(ic);
      b.appendChild(document.createTextNode(QUESTIONS[i]));
      list.appendChild(b);
    }
    // 第 5 项：真盒子上的遥控器麦克风测试（RecognizerIntent 借壳）
    var vb = el('button', 'q q-voice');
    vb.setAttribute('data-test', 'voice');
    vb.setAttribute('data-i', 'voice');
    vb.appendChild(el('span', 'qico', '🎤'));
    vb.appendChild(document.createTextNode('试一下语音（遥控器麦克风）'));
    list.appendChild(vb);
  }

  function setVoiceBusy(busy) {
    var b = $('#qlist') && $('#qlist').querySelector('.q-voice');
    if (b) {
      if (busy) b.classList.add('busy');
      else b.classList.remove('busy');
    }
  }

  /** 语音测试结果：气泡 + 面板回复区同时显示（面板关着时至少气泡能看到）。 */
  function voiceShow(title, body, bubbleText, bubbleMs) {
    sayBubble(bubbleText || body, bubbleMs || 12000);
    if (!ST.panelOpen) return;
    $('#reply-q').textContent = title;
    var rt = $('#reply-text');
    rt.innerHTML = '';
    rt.appendChild(document.createTextNode(body));
    $('#panel .panel-foot').textContent = '语音测试结果也会显示在鲸鱼娘气泡里，按 Back 回办公室。';
  }

  function nativeVoiceAvailable() {
    var n = window.DshTvNative;
    return !!(n && typeof n.startVoiceTest === 'function');
  }

  function startVoiceTest() {
    if (voiceTestPending) {
      toast('上一次语音测试还没结束…');
      return;
    }
    if (ST.busyChat || ST.typing) {
      toast('等我说完这句再测语音吧～');
      return;
    }
    if (!nativeVoiceAvailable()) {
      // 浏览器调试：没有原生桥，明确告诉用户装到盒子上试
      var msg = '浏览器里测不了，装到盒子上试';
      voiceShow('🎤 语音测试', msg);
      toast(msg, 4200);
      tvLog('voice: startVoiceTest ignored (no native bridge in browser)');
      return;
    }
    voiceTestPending = true;
    setVoiceBusy(true);
    // 触发时鲸鱼娘切 thinking，气泡「我在听…」
    if (petHasClip('thinking')) petSetClip('thinking', null);
    sayBubble('我在听…', 22000);
    if (ST.panelOpen) {
      $('#reply-q').textContent = '🎤 语音测试 · 正在打开系统语音识别…';
      $('#reply-text').innerHTML = '';
      $('#reply-text').appendChild(document.createTextNode('请对着遥控器说话，系统的识别结果会返回给我。'));
      $('#panel .panel-foot').textContent = '20 秒内没反应会自动按“超时”处理。';
    }
    tvLog('voice: calling DshTvNative.startVoiceTest()');
    native('startVoiceTest');
  }

  /** DshTvNative → 网页：{ok:true,text} 或 {ok:false,reason:no_service|cancelled|timeout|error} */
  function onVoiceResult(payload) {
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch (e) { payload = null; }
    }
    voiceTestPending = false;
    setVoiceBusy(false);
    // 从“听”恢复成平常表情
    if (petHasClip(PET.moodBase)) petSetClip(PET.moodBase, null);
    if (payload && payload.ok && payload.text != null && String(payload.text).trim()) {
      var heard = String(payload.text).trim();
      tvLog('voice: page got ok text=' + heard);
      var line = '我听到你说：「' + heard + '」';
      voiceShow('🎤 我听到你说：', heard, line, 16000);
      speak(line);
      return;
    }
    var reason = (payload && payload.reason) ? String(payload.reason) : 'error';
    if (!VOICE_REASONS.hasOwnProperty(reason)) reason = 'error';
    tvLog('voice: page got fail reason=' + reason);
    var label = reason === 'no_service' ? '不可用'
      : reason === 'cancelled' ? '已取消'
      : reason === 'timeout' ? '超时' : '出错';
    voiceShow('🎤 语音测试：' + label, VOICE_REASONS[reason],
      VOICE_REASONS[reason], reason === 'no_service' ? 20000 : 12000);
  }

  function openPanel() {
    if (ST.panelOpen) return;
    ST.panelOpen = true;
    ST.panelFocus = 0;
    ST.cursor = -1;
    renderCards();
    $('#panel').classList.remove('is-hidden');
    $('#hint').classList.add('is-hidden');
    document.body.className = (document.body.className + ' panel-open').trim();
    $('#reply-q').textContent = '她正歪着头看你，等按钮亮起来…';
    $('#reply-text').textContent = '';
    updateFocus();
    sayBubble(pickLine(LINES.panelOpen), 4200);
    if (petHasClip('idle')) petSetClip('idle', null);
    ST.lastMoodLineAt = nowMs();
  }
  function closePanel() {
    if (!ST.panelOpen) return;
    ST.panelOpen = false;
    $('#panel').classList.add('is-hidden');
    $('#hint').classList.remove('is-hidden');
    document.body.className = document.body.className.replace(/\bpanel-open\b/g, '').replace(/\s+/g, ' ').trim();
    clearTimeout(typeTimer);
    ST.typing = false;
    stopSpeak();
    hideBubble();
    if (petHasClip(PET.moodBase)) petSetClip(PET.moodBase, null);
  }
  function updateFocus() {
    var list = $('#qlist');
    var kids = list.children;
    for (var i = 0; i < kids.length; i++) {
      if (i === ST.panelFocus) kids[i].classList.add('focus');
      else kids[i].classList.remove('focus');
    }
  }

  var typeTimer = 0;
  function typeReply(text, speakIt) {
    clearTimeout(typeTimer);
    ST.typing = true;
    $('#reply-text').innerHTML = '';
    var tn = document.createTextNode('');
    var caret = el('span', 'caret');
    $('#reply-text').appendChild(tn);
    $('#reply-text').appendChild(caret);
    if (speakIt) speak(text);
    var i = 0;
    $('#panel .panel-foot').textContent = '她正在一个字一个字地写给你看…';
    function step() {
      if (i >= text.length) {
        ST.typing = false;
        if (caret.parentNode) caret.parentNode.removeChild(caret);
        $('#panel .panel-foot').textContent = '按“再听一遍”可以再听一次。';
        return;
      }
      i++;
      tn.nodeValue = text.slice(0, i);
      typeTimer = setTimeout(step, 34);
    }
    step();
  }

  function askQuestion(q) {
    if (ST.busyChat || ST.typing) return;
    if (q === '再听一遍') {
      if (!ST.lastReply) {
        typeReply('我还什么都没说呢，你先选一个问题吧～', true);
        return;
      }
      typeReply(ST.lastReply, true);
      return;
    }
    ST.busyChat = true;
    ST.lastQuestion = q;
    $('#reply-q').textContent = '你：' + q;
    $('#reply-text').innerHTML = '';
    sayDots();
    if (petHasClip('thinking')) petSetClip('thinking', null);
    var done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      ST.busyChat = false;
      var local = localAnswer(q);
      ST.lastReply = local;
      hideBubble();
      if (petHasClip(PET.moodBase)) petSetClip(PET.moodBase, null);
      typeReply(local, true);
    }, 9000);

    function finish(reply, speakText) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ST.busyChat = false;
      var clean = String(reply || '').replace(/\s+/g, ' ').trim();
      if (!clean) {
        clean = localAnswer(q);
        speakText = clean;
      }
      ST.lastReply = clean;
      hideBubble();
      if (petHasClip(PET.moodBase)) petSetClip(PET.moodBase, null);
      // 说完先显示一句小反应
      sayBubble(pickLine(LINES.chatDone), 2600);
      typeReply(clean, true);
      if (speakText && speakText !== clean) speak(speakText);
    }

    if (ST.mock) {
      setTimeout(function () { finish(localAnswer(q), null); }, 780);
      return;
    }
    xhrJSON('POST', '/api/chat', { question: q }, function (err, data) {
      if (err || !data || !data.reply) {
        finish(localAnswer(q), null);
      } else {
        finish(data.reply, data.speak);
      }
    });
  }

  function panelKey(action) {
    if (action === 'up' || action === 'down') {
      var list = $('#qlist');
      var n = list ? list.children.length : 0;
      if (!n) return;
      ST.panelFocus = (ST.panelFocus + (action === 'down' ? 1 : n - 1)) % n;
      updateFocus();
      return;
    }
    if (action === 'ok') {
      var kids = $('#qlist').children;
      var btn = kids[ST.panelFocus];
      if (btn && btn.getAttribute('data-test') === 'voice') {
        startVoiceTest();
        return;
      }
      var q = (btn && btn.getAttribute('data-i') != null && btn.getAttribute('data-i') !== 'voice')
        ? QUESTIONS[parseInt(btn.getAttribute('data-i'), 10)] : null;
      if (q) askQuestion(q);
      return;
    }
    if (action === 'back') { closePanel(); return; }
    if (action === 'long_ok') { return; }
    if (action === 'menu') { toast('面板里用 ↑↓ 选问题，Ok 确定，第 5 项是语音测试，Back 回办公室。'); return; }
    if (action === 'left' || action === 'right') { return; }
  }

  /* -------- 退出提示（绝不自己退 App） -------- */
  var backAt = 0;
  function tryExit() {
    var t = nowMs();
    if (t - backAt < 2600) {
      toast('想退出的话，用电视遥控的电源键，或者让大人来关。<span class="warn">我先陪你继续看办公室。</span>', 3600);
      backAt = 0;
      return;
    }
    backAt = t;
    toast('想退出吗？<span class="warn">再按一次 Back</span> 试试；按 Ok 就继续看大家上班。', 3000);
  }

  function showHelp() {
    toast('Ok 戳戳她 · 长按 Ok 聊聊天 · 方向键 看工位 · Back 返回/退出', 3400);
  }

  /* ---------------------------------------------------------------- 按键（原生桥 + 浏览器调试） */
  function handleAction(action) {
    if (!action) return;
    // 任何用户按键都算一次手势：这之后才允许播 /api/tts 音频
    markAudioUnlocked();
    // 面板打开时优先给面板
    if (ST.panelOpen) { panelKey(action); return; }
    if (action === 'ok') {
      if (ST.cursor >= 0) narrateStation(ST.cursor);
      else doPoke();
      return;
    }
    if (action === 'long_ok') { openPanel(); return; }
    if (action === 'back') { tryExit(); return; }
    if (action === 'up' || action === 'down' || action === 'left' || action === 'right') {
      moveCursor(action);
      return;
    }
    if (action === 'menu') { showHelp(); return; }
  }

  window.DshTv = {
    onKey: function (action) { handleAction(action); },
    onResume: function () { lastRafAt = 0; ST.lastPollAt = 0; },
    onPause: function () { stopSpeak(); },
    // 原生语音测试结果：{ok:true,text} / {ok:false,reason}
    onVoiceResult: function (payload) { onVoiceResult(payload); }
  };

  var keyDown = false, longFired = false, keyTimer = 0;
  // 同时兼容 e.key 与老 WebView 的 keyCode（Chrome 58 盒子）
  function keyAction(e) {
    var k = e.key, c = e.keyCode;
    if (k === 'Enter' || c === 13) return 'ok';
    if (k === 'Escape' || k === 'Backspace' || k === 'Esc' || c === 27 || c === 8) return 'back';
    if (k === 'ArrowUp' || k === 'Up' || c === 38) return 'up';
    if (k === 'ArrowDown' || k === 'Down' || c === 40) return 'down';
    if (k === 'ArrowLeft' || k === 'Left' || c === 37) return 'left';
    if (k === 'ArrowRight' || k === 'Right' || c === 39) return 'right';
    if (k === 'm' || k === 'M' || c === 77) return 'menu';
    return null;
  }
  document.addEventListener('keydown', function (e) {
    markAudioUnlocked();
    var a = keyAction(e);
    if (!a) return;
    e.preventDefault();
    if (a === 'ok') {
      if (e.repeat || keyDown) return;
      keyDown = true;
      longFired = false;
      keyTimer = setTimeout(function () {
        longFired = true;
        handleAction('long_ok');
      }, 600);
      return;
    }
    if (e.repeat) return;
    handleAction(a);
  }, true);
  document.addEventListener('keyup', function (e) {
    var a = keyAction(e);
    if (!a) return;
    e.preventDefault();
    if (a === 'ok') {
      clearTimeout(keyTimer);
      keyDown = false;
      if (!longFired) handleAction('ok');
      longFired = false;
    }
  }, true);

  // 鼠标调试（电视上没有，不耽误）
  $('#pet-layer').addEventListener('click', function () { handleAction('ok'); });
  // 浏览器调试：任意指针/触摸按下都算用户手势（解锁 /api/tts 音频）
  document.addEventListener('pointerdown', function () { markAudioUnlocked(); }, true);
  document.addEventListener('touchstart', function () { markAudioUnlocked(); }, true);
  $('#cards').addEventListener('click', function (e) {
    var n = e.target;
    while (n && n !== document.body && !n.className.match(/card/)) n = n.parentNode;
    if (n && n.className && n.className.match(/card/)) {
      var idx = Array.prototype.indexOf.call($('#cards').children, n);
      if (idx >= 0) { ST.cursor = idx; ST.cursorAt = nowMs(); renderCards(); }
    }
  });
  document.addEventListener('click', function (e) {
    if (e.target && e.target.className && String(e.target.className).indexOf('q') === 0) {
      var i = parseInt(e.target.getAttribute('data-i'), 10);
      if (e.target.getAttribute('data-test') === 'voice' || e.target.getAttribute('data-i') === 'voice') {
        startVoiceTest();
        return;
      }
      if (!isNaN(i)) { ST.panelFocus = i; updateFocus(); askQuestion(QUESTIONS[i]); }
      return;
    }
    // 鼠标调试也算用户手势（浏览器里解锁音频）
    markAudioUnlocked();
  });

  /* ---------------------------------------------------------------- 网络 */
  function xhrJSON(method, url, body, cb) {
    var xhr = new XMLHttpRequest();
    var finished = false;
    function done(err, data) {
      if (finished) return;
      finished = true;
      cb(err, data);
    }
    try {
      xhr.open(method, url, true);
      xhr.timeout = 5000;
      xhr.setRequestHeader('Accept', 'application/json');
      if (body) xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        if (xhr.status >= 200 && xhr.status < 300) {
          var data = null;
          try { data = JSON.parse(xhr.responseText); } catch (e) { return done(e, null); }
          done(null, data);
        } else {
          done(new Error('HTTP ' + xhr.status), null);
        }
      };
      xhr.ontimeout = function () { done(new Error('timeout'), null); };
      xhr.onerror = function () { done(new Error('network'), null); };
      xhr.send(body ? JSON.stringify(body) : null);
    } catch (e) {
      done(e, null);
    }
  }

  function setConnected(ok) {
    if (ok === ST.connected) {
      if (ok) ST.everConnected = true;
      return;
    }
    ST.connected = ok;
    if (ok) ST.everConnected = true;
    $('#waiting').classList.toggle('is-hidden', ok);
    updateHud(ST.data || {});
    if (ok) {
      native('log', 'state 连接成功');
    }
  }

  function pollState() {
    ST.lastPollAt = nowMs();
    if (ST.mock) {
      setConnected(true);
      applyState(makeMockState());
      return;
    }
    xhrJSON('GET', '/api/state', null, function (err, data) {
      if (err || !data) {
        setConnected(false);
        return;
      }
      setConnected(true);
      applyState(data);
    });
  }

  function loadPetIndex(tries) {
    if (PET.index) return;
    if (ST.mock && !ST.everConnected) {
      // mock 模式也先问一次真 bridge；拿不到就用内置清单（帧会 404，但有占位兜底）
    }
    xhrJSON('GET', '/api/pet', null, function (err, data) {
      if (err || !data || !data.clips) {
        if ((tries || 0) < 6) {
          setTimeout(function () { loadPetIndex((tries || 0) + 1); }, 1500);
          return;
        }
        PET.index = mockPetIndex();
      } else {
        PET.index = data;
      }
      if (data && data.fps) PET.fps = data.fps;
      PET.moodBase = clipForMood(ST.petMoodFromState) || 'idle';
      petSetClip(PET.moodBase, null);
      layoutPetCanvases();
      petDrawFrame(true);
    });
  }

  /* ---------------------------------------------------------------- mock 模式 */
  function mockPetIndex() {
    var counts = {
      idle: 241, idle_yawn: 241, idle_stretch: 241, thinking: 241, working: 241,
      working_command: 241, working_search: 241, waiting: 241, success: 241,
      error: 118, poke: 241, head_pat: 241, tail: 241
    };
    var clips = {};
    for (var k in counts) {
      if (!counts.hasOwnProperty(k)) continue;
      clips[k] = [];
      for (var i = 1; i <= counts[k]; i++) {
        var p = i < 10 ? '00' + i : (i < 100 ? '0' + i : '' + i);
        clips[k].push('/pet/' + k + '/' + k + '_' + p + '.webp');
      }
    }
    return { baseSize: 412, maxFrameWidth: 412, maxFrameHeight: 344, fps: 24, clips: clips };
  }

  function makeMockState() {
    var t = Math.floor(nowMs() / 1000);
    var step = function (base) { return base + Math.floor(t / 8); };
    var sessions = [
      {
        id: 'mock-1', title: '参考 agent-office 做 DeepSeek Office TV',
        running: true, status: 'working', elapsedSec: 312 + t, step: step(17), turns: 2,
        activity: '正在调用工具 · 第 ' + step(17) + ' 步', todos: { done: 4, total: 7 },
        team: [{ name: 'ecosystem-scout', role: 'teammate', state: 'running' }, { name: 'bridge-builder', role: 'teammate', state: 'running' }]
      },
      {
        id: 'mock-2', title: '像素办公室美术风格调研',
        running: true, status: 'working', elapsedSec: 184 + t, step: step(5), turns: 1,
        activity: '正在阅读素材 · 第 ' + step(5) + ' 步', todos: { done: 2, total: 4 }, team: []
      },
      {
        id: 'mock-3', title: 'Android TV 遥控长按与 TTS 接入',
        running: false, status: 'waiting', elapsedSec: 96, step: 4, turns: 3,
        activity: '在等一个决定 · 已经问了 2 分钟', todos: { done: 4, total: 9 },
        team: [{ name: 'tv-app-builder', role: 'teammate', state: 'waiting' }]
      },
      {
        id: 'mock-4', title: 'bridge 状态接口联调（已收工）',
        running: false, status: 'success', elapsedSec: 0, step: 9, turns: 1,
        activity: '刚刚收工 · 一共用了 8 分钟', todos: { done: 6, total: 6 }, team: []
      },
      {
        id: 'mock-5', title: '给小朋友写一句晚安台词',
        running: false, status: 'idle', elapsedSec: 0, step: 0, turns: 1,
        activity: '在发呆 · 顺手喝口水', todos: { done: 0, total: 3 }, team: []
      },
      {
        id: 'mock-6', title: '深海鲸鱼娘动画素材整理',
        running: false, status: 'error', elapsedSec: 0, step: 2, turns: 1,
        activity: '卡住了 · 找不到 frame_999', todos: { done: 1, total: 5 }, team: []
      }
    ];
    var moods = ['working', 'working_command', 'thinking', 'idle_yawn', 'waiting', 'idle'];
    var mood = moods[Math.floor(t / 12) % moods.length];
    return {
      ts: Date.now(),
      pet: { mood: mood, since: Date.now() - 3000 },
      stats: { sessions: 6, running: 2, teammates: 4 },
      workspaces: [{ id: 'default-workspace', name: 'default-workspace', sessions: sessions }]
    };
  }

  /* ---------------------------------------------------------------- 主循环 */
  var lastRafAt = 0;
  var degradeLevel = 0;
  var costSamples = [], lastClockPaint = 0;
  function loop(ts) {
    requestAnimationFrame(loop);
    // 30fps 上限
    if (ts - lastRafAt < 32) return;
    lastRafAt = ts;
    var t = nowMs();
    var t0 = t;
    drawScene(t);
    petDrawFrame(false);
    // 帧耗时自适应降分辨率（低端盒子保 30fps）
    costSamples.push(nowMs() - t0);
    if (costSamples.length >= 90) {
      var sum = 0;
      for (var ci = 0; ci < costSamples.length; ci++) sum += costSamples[ci];
      var avg = sum / costSamples.length;
      costSamples.length = 0;
      if (avg > 24 && degradeLevel < 3) {
        degradeLevel++;
        layout();
      }
    }
    // 观察者光标空闲 18 秒后自动收起
    if (ST.cursor >= 0 && !ST.panelOpen && t - ST.cursorAt > 18000) {
      ST.cursor = -1;
      renderCards();
    }
    if (t - lastClockPaint > 20000) { lastClockPaint = t; updateClock(); }
    // 等待画面省略号
    if (!ST.connected) {
      var d = Math.floor(t / 500) % 4;
      var wd = $('#wait-dots');
      if (wd) wd.textContent = d >= 3 ? '···' : (d === 2 ? '··' : (d === 1 ? '·' : ''));
    }
  }

  /* ---------------------------------------------------------------- 启动 */
  var params = (function () {
    var out = {};
    var q = (window.location.search || '').replace(/^\?/, '');
    if (!q) return out;
    var parts = q.split('&');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split('=');
      out[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    }
    return out;
  })();

  function boot() {
    ST.mock = params.mock === '1' || params.mock === 'true';
    buildCards();
    buildPanel();
    layout();
    // 先点亮办公室（mock 数据先把人和家具画出来，避免白屏）
    if (ST.mock) {
      setConnected(true);
      applyState(makeMockState());
    }
    loadPetIndex(0);
    if (!ST.mock) pollState();
    setInterval(function () {
      if (ST.mock) { setConnected(true); applyState(makeMockState()); return; }
      pollState();
    }, 2000);
    // 时钟
    updateClock();

    requestAnimationFrame(loop);
    setTimeout(function () {
      var b = $('#boot');
      b.classList.add('is-hidden');
      native('ready');
      // 兜底：老 WebView 过渡动画不生效时也别挡着画面
      setTimeout(function () { b.style.display = 'none'; }, 420);
    }, 60);
    window.addEventListener('resize', function () {
      clearTimeout(window.__resizeT);
      window.__resizeT = setTimeout(layout, 150);
    });
    window.addEventListener('orientationchange', function () {
      setTimeout(layout, 200);
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stopSpeak();
      else lastRafAt = 0;
    });
    // 长跑：静默刷新防 WebView 内存泄漏（聊天/面板中顺延 5 分钟）
    var RELOAD_MS = 40 * 60 * 1000;
    (function scheduleReload() {
      setTimeout(function () {
        if (ST.panelOpen || ST.typing || ST.busyChat) { scheduleReload(); return; }
        try { location.reload(); } catch (e) { /* ignore */ }
      }, RELOAD_MS);
    })();
    // 调试参数（给 Lead 截图/验收用）：?panel=1 直接开面板，?cursor=N 选中工位
    if (params.panel === '1') {
      setTimeout(function () { openPanel(); }, 400);
    }
    if (params.cursor != null && params.cursor !== '') {
      var ci2 = parseInt(params.cursor, 10);
      if (!isNaN(ci2) && ci2 >= 0 && ci2 < 6) {
        ST.cursor = ci2;
        ST.cursorAt = nowMs() + 600000; // 截图时别自动收起
        renderCards();
      }
    }
    if (params.q && ST.panelOpen) {
      setTimeout(function () { askQuestion(decodeURIComponent(params.q)); }, 900);
    }
    // 调试出口
    window.__dshTv = {
      state: ST, pet: PET, lines: LINES,
      action: handleAction, say: sayBubble, toast: toast, answer: localAnswer,
      voiceTest: startVoiceTest, voiceResult: onVoiceResult
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
