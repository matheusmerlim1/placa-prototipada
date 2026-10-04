/*
 * Arquivos de fabricação: Gerber RS-274X (X2) + furação Excellon, num .zip.
 *
 * Formato aceito por qualquer fabricante de placas (JLCPCB, PCBWay, nacionais).
 * Coordenadas em mm, formato 4.6, origem no canto inferior esquerdo da placa
 * (o editor usa y para baixo; aqui y é invertido: Y = altura − y).
 *
 * model = {
 *   w, h, layers (1|2),
 *   pads:   [{x, y, w, h, shape: circle|rect|oval, drill}]
 *   traces: [{l: 0 (superior) | 1 (inferior), w, pts: [[x, y], ...]}]
 *   vias:   [{x, y}], via: {d, drill}
 *   silk:   {lines: [[[x, y], ...]], width}     (polilinhas já em coordenadas da placa)
 *   mask:   expansão da máscara em volta do pad (mm)
 *   info:   texto do LEIA-ME
 * }
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------ fonte de traço
  // Glifos numa grade 4 × 6 (y para cima, linha de base = 0). Gerber não tem
  // fontes: a legenda vira traços com a largura da serigrafia.
  const O = [[1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]];
  const P = [[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]];
  const FONT = {
    A: [[[0, 0], [0, 4], [2, 6], [4, 4], [4, 0]], [[0, 3], [4, 3]]],
    B: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]], [[3, 3], [4, 2], [4, 1], [3, 0], [0, 0]]],
    C: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1]]],
    D: [[[0, 0], [0, 6], [2, 6], [4, 4], [4, 2], [2, 0], [0, 0]]],
    E: [[[4, 6], [0, 6], [0, 0], [4, 0]], [[0, 3], [3, 3]]],
    F: [[[4, 6], [0, 6], [0, 0]], [[0, 3], [3, 3]]],
    G: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 3], [2, 3]]],
    H: [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]],
    I: [[[1, 6], [3, 6]], [[2, 6], [2, 0]], [[1, 0], [3, 0]]],
    J: [[[4, 6], [4, 1], [3, 0], [1, 0], [0, 1]]],
    K: [[[0, 0], [0, 6]], [[4, 6], [0, 2]], [[1, 3], [4, 0]]],
    L: [[[0, 6], [0, 0], [4, 0]]],
    M: [[[0, 0], [0, 6], [2, 3], [4, 6], [4, 0]]],
    N: [[[0, 0], [0, 6], [4, 0], [4, 6]]],
    O: [O],
    P: [P],
    Q: [O, [[2, 2], [4, 0]]],
    R: [P, [[2, 3], [4, 0]]],
    S: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 4], [1, 3], [3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]],
    T: [[[0, 6], [4, 6]], [[2, 6], [2, 0]]],
    U: [[[0, 6], [0, 1], [1, 0], [3, 0], [4, 1], [4, 6]]],
    V: [[[0, 6], [2, 0], [4, 6]]],
    W: [[[0, 6], [1, 0], [2, 3], [3, 0], [4, 6]]],
    X: [[[0, 0], [4, 6]], [[0, 6], [4, 0]]],
    Y: [[[0, 6], [2, 3], [4, 6]], [[2, 3], [2, 0]]],
    Z: [[[0, 6], [4, 6], [0, 0], [4, 0]]],
    0: [O, [[0, 1], [4, 5]]],
    1: [[[1, 5], [2, 6], [2, 0]], [[1, 0], [3, 0]]],
    2: [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [0, 0], [4, 0]]],
    3: [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]], [[1, 3], [3, 3]]],
    4: [[[3, 0], [3, 6], [0, 2], [4, 2]]],
    5: [[[4, 6], [0, 6], [0, 3], [3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]],
    6: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3], [0, 3]]],
    7: [[[0, 6], [4, 6], [1, 0]]],
    8: [[[1, 3], [0, 4], [0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [1, 3], [0, 2], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3]]],
    9: [[[0, 1], [1, 0], [3, 0], [4, 1], [4, 5], [3, 6], [1, 6], [0, 5], [0, 4], [1, 3], [4, 3]]],
    '+': [[[0, 3], [4, 3]], [[2, 1], [2, 5]]],
    '-': [[[0.5, 3], [3.5, 3]]],
    '.': [[[1.6, 0], [2.4, 0], [2.4, 0.8], [1.6, 0.8], [1.6, 0]]],
    ',': [[[2, 0.8], [2, 0], [1.4, -1]]],
    '/': [[[0, 0], [4, 6]]],
    '(': [[[3, 6], [1.5, 4], [1.5, 2], [3, 0]]],
    ')': [[[1, 6], [2.5, 4], [2.5, 2], [1, 0]]],
    '_': [[[0, -1], [4, -1]]],
    ':': [[[2, 1], [2, 1.6]], [[2, 4], [2, 4.6]]],
    '=': [[[0, 2], [4, 2]], [[0, 4], [4, 4]]],
    'µ': [[[0, -1.5], [0, 4]], [[0, 1], [1, 0], [3, 0], [4, 1]], [[4, 4], [4, 0]]],
    'Ω': [[[0, 0], [1.2, 0], [0, 2], [0, 4], [1, 6], [3, 6], [4, 4], [4, 2], [2.8, 0], [4, 0]]],
  };
  const ADV = 5.5; // avanço por caractere (glifo de 4 + espaço de 1,5)
  const glyphKey = ch => {
    if (ch === '−') return '-';
    if (FONT[ch]) return ch;
    const up = ch.toUpperCase();
    if (FONT[up]) return up;
    const plain = up.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return FONT[plain] ? plain : null;
  };
  const textUnits = str => Math.max(0, [...str].length * ADV - (ADV - 4));
  /** Texto → polilinhas em coordenadas da placa (y para baixo). */
  // vertical: girado 90°, lendo de baixo para cima
  function textLines(str, x, y, size, { anchor = 'start', base = 'alphabetic', vertical = false } = {}) {
    const u = size / 6;
    const wTot = textUnits(str) * u;
    let lx = anchor === 'middle' ? -wTot / 2 : anchor === 'end' ? -wTot : 0; // ao longo do texto
    const ly = base === 'hanging' ? size : base === 'central' ? size / 2 : 0;  // "para baixo"
    const [ux, uy, vx, vy] = vertical ? [0, -1, 1, 0] : [1, 0, 0, 1];
    const at = (a, b) => [x + a * ux + b * vx, y + a * uy + b * vy];
    const out = [];
    for (const ch of str) {
      const k = glyphKey(ch);
      if (k) for (const stroke of FONT[k]) out.push(stroke.map(([gx, gy]) => at(lx + gx * u, ly - gy * u)));
      lx += ADV * u;
    }
    return out;
  }

  // ---------------------------------------------------- formas → polilinhas
  function sampleBezier(p0, b, out, n = 8) {
    const [x1, y1, x2, y2, x3, y3] = b;
    for (let i = 1; i <= n; i++) {
      const t = i / n, s = 1 - t;
      out.push([s * s * s * p0[0] + 3 * s * s * t * x1 + 3 * s * t * t * x2 + t * t * t * x3,
        s * s * s * p0[1] + 3 * s * s * t * y1 + 3 * s * t * t * y2 + t * t * t * y3]);
    }
  }
  /** Forma da serigrafia (rect/circle/line/path, coordenadas locais) → polilinhas. */
  function shapeLines(sh) {
    if (sh.t === 'line') return [[[sh.x1, sh.y1], [sh.x2, sh.y2]]];
    if (sh.t === 'circle') {
      const pts = [];
      for (let i = 0; i <= 64; i++) { const a = i / 64 * 2 * Math.PI; pts.push([sh.cx + sh.r * Math.cos(a), sh.cy + sh.r * Math.sin(a)]); }
      return [pts];
    }
    if (sh.t === 'rect') {
      const r = Math.max(0, Math.min(sh.r || 0, sh.w / 2, sh.h / 2));
      const { x, y, w, h } = sh;
      if (r < 1e-6) return [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]];
      const pts = [];
      const arc = (cx, cy, a0) => { for (let i = 0; i <= 8; i++) { const a = a0 + i / 8 * Math.PI / 2; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } };
      arc(x + w - r, y + r, -Math.PI / 2); arc(x + w - r, y + h - r, 0); arc(x + r, y + h - r, Math.PI / 2); arc(x + r, y + r, Math.PI);
      pts.push(pts[0]);
      return [pts];
    }
    // caminho SVG com comandos absolutos M L H V A Z
    const tok = sh.d.match(/[MLHVAZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
    const lines = [];
    let cur = null, i = 0, cmd = '', cx = 0, cy = 0, sx = 0, sy = 0;
    const n = () => parseFloat(tok[i++]);
    const arcToBeziers = root.PCBPdf.arcToBeziers;
    while (i < tok.length) {
      if (/[A-Z]/i.test(tok[i])) cmd = tok[i++].toUpperCase();
      if (cmd === 'M') { cx = n(); cy = n(); sx = cx; sy = cy; cur = [[cx, cy]]; lines.push(cur); cmd = 'L'; }
      else if (cmd === 'L') { cx = n(); cy = n(); cur.push([cx, cy]); }
      else if (cmd === 'H') { cx = n(); cur.push([cx, cy]); }
      else if (cmd === 'V') { cy = n(); cur.push([cx, cy]); }
      else if (cmd === 'A') {
        const rx = n(), ry = n(), rotA = n() * Math.PI / 180, fa = n(), fs = n(), x = n(), y = n();
        for (const b of arcToBeziers(cx, cy, rx, ry, rotA, fa, fs, x, y)) sampleBezier(cur[cur.length - 1], b, cur);
        cx = x; cy = y;
      } else if (cmd === 'Z') { cur.push([sx, sy]); cx = sx; cy = sy; cmd = ''; }
      else i++;
    }
    return lines.filter(l => l.length > 1);
  }

  // ------------------------------------------------------------- Gerber
  function gerberFile(model, fileFunction, polarity, draw) {
    const H = model.h;
    const c = v => Math.round(v * 1e6);
    const X = x => c(x), Y = y => c(H - y);
    const ap = new Map(); // "C,0.8" → código D
    let next = 10;
    const body = [];
    const aperture = (shape, w, h) => {
      const f = v => (Math.round(v * 1e4) / 1e4).toFixed(4);
      const key = shape === 'circle' || Math.abs(w - h) < 1e-9 && shape === 'oval' ? `C,${f(w)}`
        : shape === 'rect' ? `R,${f(w)}X${f(h)}` : `O,${f(w)}X${f(h)}`;
      if (!ap.has(key)) ap.set(key, next++);
      return ap.get(key);
    };
    let curAp = null;
    const use = d => { if (curAp !== d) { body.push(`D${d}*`); curAp = d; } };
    const g = {
      flash(x, y, shape, w, h) { use(aperture(shape, w, h ?? w)); body.push(`X${X(x)}Y${Y(y)}D03*`); },
      line(pts, width) {
        if (pts.length < 2) return;
        use(aperture('circle', width, width));
        body.push(`X${X(pts[0][0])}Y${Y(pts[0][1])}D02*`);
        for (let i = 1; i < pts.length; i++) body.push(`X${X(pts[i][0])}Y${Y(pts[i][1])}D01*`);
      },
    };
    draw(g);
    const head = [
      '%TF.GenerationSoftware,PlacaPrototipada,2.0*%',
      `%TF.CreationDate,${new Date().toISOString().slice(0, 19)}*%`,
      `%TF.FileFunction,${fileFunction}*%`,
      `%TF.FilePolarity,${polarity}*%`,
      '%FSLAX46Y46*%',
      '%MOMM*%',
      '%LPD*%',
      'G01*',
    ];
    for (const [key, d] of ap) {
      const [t, dims] = key.split(',');
      head.push(`%ADD${d}${t},${dims}*%`);
    }
    return [...head, ...body, 'M02*', ''].join('\n');
  }

  function excellon(model) {
    const H = model.h;
    const holes = [];
    for (const p of model.pads) holes.push([p.x, p.y, p.drill]);
    for (const v of model.vias) holes.push([v.x, v.y, model.via.drill]);
    const tools = [...new Set(holes.map(h => h[2].toFixed(3)))].sort((a, b) => a - b);
    const f = v => (Math.round(v * 1000) / 1000).toFixed(3);
    const out = ['M48', '; Placa Prototipada - furacao (furos metalizados)', '; FORMAT={-:-/ absolute / metric / decimal}', 'FMAT,2', 'METRIC,TZ'];
    tools.forEach((d, i) => out.push(`T${i + 1}C${d}`));
    out.push('%', 'G90', 'G05');
    tools.forEach((d, i) => {
      out.push(`T${i + 1}`);
      for (const h of holes) if (h[2].toFixed(3) === d) out.push(`X${f(h[0])}Y${f(H - h[1])}`);
    });
    out.push('T0', 'M30', '');
    return { text: out.join('\n'), tools: tools.map((d, i) => ({ tool: `T${i + 1}`, d: +d, n: holes.filter(h => h[2].toFixed(3) === d).length })) };
  }

  function buildFiles(model) {
    const files = {};
    const L = model.layers;
    const copper = layer => g => {
      for (const t of model.traces) if (t.l === layer) g.line(t.pts, t.w);
      for (const p of model.pads) g.flash(p.x, p.y, p.shape, p.w, p.h);
      if (L === 2) for (const v of model.vias) g.flash(v.x, v.y, 'circle', model.via.d);
    };
    const mask = g => { for (const p of model.pads) g.flash(p.x, p.y, p.shape, p.w + 2 * model.mask, p.h + 2 * model.mask); };
    if (L === 2) files['placa.GTL'] = gerberFile(model, 'Copper,L1,Top', 'Positive', copper(0));
    files['placa.GBL'] = gerberFile(model, L === 2 ? 'Copper,L2,Bot' : 'Copper,L1,Bot', 'Positive', copper(1));
    if (L === 2) files['placa.GTS'] = gerberFile(model, 'Soldermask,Top', 'Negative', mask);
    files['placa.GBS'] = gerberFile(model, 'Soldermask,Bot', 'Negative', mask);
    files['placa.GTO'] = gerberFile(model, 'Legend,Top', 'Positive', g => { for (const l of model.silk.lines) g.line(l, model.silk.width); });
    files['placa.GKO'] = gerberFile(model, 'Profile,NP', 'Positive', g => g.line([[0, 0], [model.w, 0], [model.w, model.h], [0, model.h], [0, 0]], 0.1));
    const drill = excellon(model);
    files['placa.DRL'] = drill.text;
    files['LEIA-ME.txt'] = model.info(drill.tools);
    return files;
  }

  // ------------------------------------------------------------- ZIP (sem compressão)
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zip(files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const [name, content] of Object.entries(files)) {
      const data = typeof content === 'string' ? enc.encode(content.replace(/\n/g, '\r\n')) : content;
      const nm = enc.encode(name), crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nm.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), nm, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nm.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), nm);
      offset += 30 + nm.length + data.length;
    }
    const csize = central.reduce((a, b) => a + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, Object.keys(files).length, true); end.setUint16(10, Object.keys(files).length, true);
    end.setUint32(12, csize, true); end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
    let p = 0;
    for (const b of all) { out.set(b, p); p += b.length; }
    return out;
  }

  const api = { buildFiles, zip, textLines, shapeLines, textUnits };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PCBGerber = api;
})(typeof window !== 'undefined' ? window : globalThis);
