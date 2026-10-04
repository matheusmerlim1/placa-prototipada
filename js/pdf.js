/*
 * Gerador de PDF vetorial mínimo, em milímetros reais.
 *
 * Cada página tem o tamanho físico em mm e tudo é desenhado em mm com o eixo
 * y para baixo (como no SVG). Impresso em "tamanho real / 100%", 1 mm do
 * desenho = 1 mm no papel — largura de trilha, pads e furos saem exatos.
 * Fontes: Helvetica e Helvetica-Bold (padrão de todo leitor de PDF).
 */
(function (root) {
  'use strict';

  const PT = 72 / 25.4; // pontos por mm
  const KAPPA = 0.5522847498;

  // larguras da Helvetica (AFM, /1000) para ASCII 32–126
  const HW = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
  // caracteres fora do Latin-1 → equivalente em WinAnsi
  const WIN = { '—': 0x97, '–': 0x96, '“': 0x93, '”': 0x94, '‘': 0x91, '’': 0x92, '…': 0x85, '•': 0x95, '−': 0x2d, '≥': null, '≤': null, 'Ω': null };
  const SUBST = { '≥': '>=', '≤': '<=', 'Ω': 'Ohm', '→': '->', '✓': 'ok' };

  function winAnsi(s) {
    let out = '';
    for (const ch of String(s)) {
      if (SUBST[ch]) { out += SUBST[ch]; continue; }
      out += ch;
    }
    const codes = [];
    for (const ch of out) {
      const c = ch.codePointAt(0);
      if (c < 128 || (c >= 160 && c <= 255)) codes.push(c);
      else if (WIN[ch]) codes.push(WIN[ch]);
      else codes.push(63); // '?'
    }
    return codes;
  }
  function textWidth(s, size, bold) {
    let w = 0;
    for (const c of winAnsi(s)) w += (c >= 32 && c <= 126 ? HW[c - 32] : 556);
    return w / 1000 * size * (bold ? 1.06 : 1);
  }
  const num = n => {
    const v = Math.round(n * 1000) / 1000;
    return (Object.is(v, -0) ? 0 : v).toString();
  };
  function hex(c) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
    if (!m) return [0, 0, 0];
    return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
  }

  // arco SVG (endpoint) → curvas de Bézier cúbicas
  function arcToBeziers(x1, y1, rx, ry, phi, fa, fs, x2, y2) {
    if (rx === 0 || ry === 0) return [[x1, y1, x2, y2, x2, y2]];
    const cos = Math.cos(phi), sin = Math.sin(phi);
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
    rx = Math.abs(rx); ry = Math.abs(ry);
    const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
    const num2 = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    let co = Math.sqrt(Math.max(0, num2 / den));
    if (fa === fs) co = -co;
    const cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
    const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
    const ang = (ux, uy, vx, vy) => {
      const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      return a;
    };
    let t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!fs && dt > 0) dt -= 2 * Math.PI;
    if (fs && dt < 0) dt += 2 * Math.PI;
    const n = Math.ceil(Math.abs(dt) / (Math.PI / 2));
    const out = [], d = dt / n, k = 4 / 3 * Math.tan(d / 4);
    const pt = t => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
    const dv = t => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
    for (let i = 0; i < n; i++) {
      const a = t1 + i * d, b = a + d;
      const p0 = pt(a), p3 = pt(b), d0 = dv(a), d3 = dv(b);
      out.push([p0[0] + k * d0[0], p0[1] + k * d0[1], p3[0] - k * d3[0], p3[1] - k * d3[1], p3[0], p3[1]]);
    }
    return out;
  }

  class Page {
    constructor(w, h) { this.w = w; this.h = h; this.ops = []; this.op(`${num(PT)} 0 0 ${num(-PT)} 0 ${num(h * PT)} cm`); }
    op(s) { this.ops.push(s); return this; }
    save() { return this.op('q'); }
    restore() { return this.op('Q'); }
    transform(a, b, c, d, e, f) { return this.op(`${num(a)} ${num(b)} ${num(c)} ${num(d)} ${num(e)} ${num(f)} cm`); }
    translate(x, y) { return this.transform(1, 0, 0, 1, x, y); }
    rotate90(steps) { // mesma convenção do SVG rotate() com y para baixo
      const t = (steps & 3) * Math.PI / 2, c = Math.round(Math.cos(t)), s = Math.round(Math.sin(t));
      return this.transform(c, s, -s, c, 0, 0);
    }
    fill(col) { const [r, g, b] = hex(col); return this.op(`${num(r)} ${num(g)} ${num(b)} rg`); }
    stroke(col) { const [r, g, b] = hex(col); return this.op(`${num(r)} ${num(g)} ${num(b)} RG`); }
    width(w) { return this.op(`${num(w)} w`); }
    round() { return this.op('1 J 1 j'); }
    butt() { return this.op('0 J 0 j'); }

    polyline(pts, w, col) {
      if (pts.length < 2) return this;
      this.stroke(col).width(w).round();
      let s = `${num(pts[0][0])} ${num(pts[0][1])} m`;
      for (let i = 1; i < pts.length; i++) s += ` ${num(pts[i][0])} ${num(pts[i][1])} l`;
      return this.op(s + ' S');
    }
    line(x1, y1, x2, y2, w, col) { return this.polyline([[x1, y1], [x2, y2]], w, col); }
    circlePath(cx, cy, r) {
      const k = r * KAPPA;
      return this.op(`${num(cx + r)} ${num(cy)} m ${num(cx + r)} ${num(cy + k)} ${num(cx + k)} ${num(cy + r)} ${num(cx)} ${num(cy + r)} c ` +
        `${num(cx - k)} ${num(cy + r)} ${num(cx - r)} ${num(cy + k)} ${num(cx - r)} ${num(cy)} c ` +
        `${num(cx - r)} ${num(cy - k)} ${num(cx - k)} ${num(cy - r)} ${num(cx)} ${num(cy - r)} c ` +
        `${num(cx + k)} ${num(cy - r)} ${num(cx + r)} ${num(cy - k)} ${num(cx + r)} ${num(cy)} c h`);
    }
    rrectPath(x, y, w, h, r) {
      r = Math.max(0, Math.min(r, w / 2, h / 2));
      if (r < 1e-6) return this.op(`${num(x)} ${num(y)} ${num(w)} ${num(h)} re`);
      const k = r * KAPPA, x2 = x + w, y2 = y + h;
      return this.op(`${num(x + r)} ${num(y)} m ${num(x2 - r)} ${num(y)} l ${num(x2 - r + k)} ${num(y)} ${num(x2)} ${num(y + r - k)} ${num(x2)} ${num(y + r)} c ` +
        `${num(x2)} ${num(y2 - r)} l ${num(x2)} ${num(y2 - r + k)} ${num(x2 - r + k)} ${num(y2)} ${num(x2 - r)} ${num(y2)} c ` +
        `${num(x + r)} ${num(y2)} l ${num(x + r - k)} ${num(y2)} ${num(x)} ${num(y2 - r + k)} ${num(x)} ${num(y2 - r)} c ` +
        `${num(x)} ${num(y + r)} l ${num(x)} ${num(y + r - k)} ${num(x + r - k)} ${num(y)} ${num(x + r)} ${num(y)} c h`);
    }
    fillCircle(cx, cy, r, col) { this.fill(col); this.circlePath(cx, cy, r); return this.op('f'); }
    strokeCircle(cx, cy, r, w, col) { this.stroke(col).width(w); this.circlePath(cx, cy, r); return this.op('S'); }
    fillRRect(x, y, w, h, r, col) { this.fill(col); this.rrectPath(x, y, w, h, r); return this.op('f'); }
    strokeRRect(x, y, w, h, r, lw, col) { this.stroke(col).width(lw).round(); this.rrectPath(x, y, w, h, r); return this.op('S'); }
    fillRect(x, y, w, h, col) { return this.fillRRect(x, y, w, h, 0, col); }

    // caminho SVG com comandos absolutos M L H V A Z
    svgPath(d, lw, col) {
      const tok = d.match(/[MLHVAZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
      let i = 0, cx = 0, cy = 0, sx = 0, sy = 0, cmd = '';
      const n = () => parseFloat(tok[i++]);
      let s = '';
      while (i < tok.length) {
        if (/[A-Z]/i.test(tok[i])) cmd = tok[i++].toUpperCase();
        if (cmd === 'M') { cx = n(); cy = n(); sx = cx; sy = cy; s += `${num(cx)} ${num(cy)} m `; cmd = 'L'; }
        else if (cmd === 'L') { cx = n(); cy = n(); s += `${num(cx)} ${num(cy)} l `; }
        else if (cmd === 'H') { cx = n(); s += `${num(cx)} ${num(cy)} l `; }
        else if (cmd === 'V') { cy = n(); s += `${num(cx)} ${num(cy)} l `; }
        else if (cmd === 'A') {
          const rx = n(), ry = n(), rot = n() * Math.PI / 180, fa = n(), fs = n(), x = n(), y = n();
          for (const b of arcToBeziers(cx, cy, rx, ry, rot, fa, fs, x, y)) s += `${b.map(num).join(' ')} c `;
          cx = x; cy = y;
        } else if (cmd === 'Z') { s += 'h '; cx = sx; cy = sy; cmd = ''; }
        else i++;
      }
      this.stroke(col).width(lw).round();
      return this.op(s + 'S');
    }

    // anchor: start | middle | end ; base: alphabetic | hanging | central
    // vertical: texto girado 90°, lendo de baixo para cima
    text(str, x, y, size, { bold = false, anchor = 'start', base = 'alphabetic', color = '#000000', vertical = false } = {}) {
      const w = textWidth(str, size, bold);
      let lx = 0, ly = 0; // deslocamento no referencial do texto (ly para baixo)
      if (anchor === 'middle') lx = -w / 2; else if (anchor === 'end') lx = -w;
      if (base === 'hanging') ly = size * 0.72; else if (base === 'central') ly = size * 0.36;
      const [ux, uy, vx, vy] = vertical ? [0, -1, 1, 0] : [1, 0, 0, 1]; // eixo do texto / eixo "para baixo"
      x += lx * ux + ly * vx; y += lx * uy + ly * vy;
      const codes = winAnsi(str);
      let lit = '';
      for (const c of codes) {
        if (c === 40 || c === 41 || c === 92) lit += '\\' + String.fromCharCode(c);
        else if (c < 32 || c > 126) lit += '\\' + c.toString(8).padStart(3, '0');
        else lit += String.fromCharCode(c);
      }
      this.fill(color);
      return this.op(`BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${num(ux)} ${num(uy)} ${num(-vx)} ${num(-vy)} ${num(x)} ${num(y)} Tm (${lit}) Tj ET`);
    }
  }

  class PDFDoc {
    constructor(meta = {}) { this.pages = []; this.meta = meta; }
    addPage(wmm, hmm) { const p = new Page(wmm, hmm); this.pages.push(p); return p; }
    build() {
      const objs = [];
      const add = s => { objs.push(s); return objs.length; };
      const catalog = add(null), pagesId = add(null);
      const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
      const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
      const kids = [];
      for (const p of this.pages) {
        const body = p.ops.join('\n');
        const content = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
        kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(p.w * PT)} ${num(p.h * PT)}] ` +
          `/Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`));
      }
      objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R /ViewerPreferences << /PrintScaling /None >> >>`;
      objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
      const info = add(`<< /Title (${String(this.meta.title || 'Placa').replace(/[()\\]/g, '')}) /Producer (Placa Prototipada) >>`);
      let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
      const offs = [];
      objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
      const xref = out.length;
      out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
      for (const o of offs) out += `${String(o).padStart(10, '0')} 00000 n \n`;
      out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
      const bytes = new Uint8Array(out.length);
      for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
      return bytes;
    }
  }

  const api = { PDFDoc, textWidth, arcToBeziers };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PCBPdf = api;
})(typeof window !== 'undefined' ? window : globalThis);
