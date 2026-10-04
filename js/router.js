/*
 * Roteador de trilhas para placa de circuito (1 ou 2 camadas), em milímetros reais.
 *
 * - Grade de roteamento fina (0,635 mm por padrão) com movimentos em 0°/45°/90°.
 * - Pads com forma e tamanho reais (redondo, retangular, oblongo), em qualquer
 *   posição — não precisam cair na grade.
 * - Folgas calculadas pela distância geométrica exata entre o segmento de trilha
 *   e a borda do cobre do pad.
 * - A* por ligação + negociação de congestionamento (PathFinder): as redes que
 *   disputam espaço são refeitas com custo crescente até que nenhuma trilha
 *   encoste ou cruze outra.
 * - drc(): conferência final, mede a folga real entre todo o cobre de redes diferentes.
 */
(function (root) {
  'use strict';

  const SQRT2 = Math.SQRT2;
  const DX = [1, 1, 0, -1, -1, -1, 0, 1];
  const DY = [0, 1, 1, 1, 0, -1, -1, -1];
  const TURN = [0, 0.15, 0.6, 3, Infinity]; // penalidade por passos de 45°; 180° proibido
  const FREE = -1, BLOCK = -2, MULTI = -3;
  const NODIR = 8;
  const EPS = 1e-6;

  // ------------------------------------------------------------ geometria
  // Pad = retângulo de cantos arredondados: centro, meia-largura/altura do
  // "miolo" (sem o arredondamento) e raio. Círculo e oblongo são casos disso.
  function toShape(p) {
    const hw = p.w / 2, hh = p.h / 2;
    const rad = p.shape === 'rect' ? 0 : Math.min(hw, hh);
    return { cx: p.x, cy: p.y, ix: hw - rad, iy: hh - rad, rad };
  }
  function distPtBox(px, py, s) {
    const dx = Math.max(Math.abs(px - s.cx) - s.ix, 0), dy = Math.max(Math.abs(py - s.cy) - s.iy, 0);
    return Math.hypot(dx, dy);
  }
  function distPtSeg(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy;
    let t = L ? ((px - ax) * vx + (py - ay) * vy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - ax - t * vx, py - ay - t * vy);
  }
  function segHitsBox(ax, ay, bx, by, s) { // Liang–Barsky
    const x0 = s.cx - s.ix, x1 = s.cx + s.ix, y0 = s.cy - s.iy, y1 = s.cy + s.iy;
    let t0 = 0, t1 = 1;
    const dx = bx - ax, dy = by - ay;
    const clip = (p, q) => {
      if (Math.abs(p) < 1e-12) return q >= 0;
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
      return true;
    };
    return clip(-dx, ax - x0) && clip(dx, x1 - ax) && clip(-dy, ay - y0) && clip(dy, y1 - ay);
  }
  // distância entre a borda de um pad e um segmento (0 se tocam)
  function distSegShape(ax, ay, bx, by, s) {
    if (segHitsBox(ax, ay, bx, by, s)) return -s.rad;
    const x0 = s.cx - s.ix, x1 = s.cx + s.ix, y0 = s.cy - s.iy, y1 = s.cy + s.iy;
    const d = Math.min(
      distPtBox(ax, ay, s), distPtBox(bx, by, s),
      distPtSeg(x0, y0, ax, ay, bx, by), distPtSeg(x1, y0, ax, ay, bx, by),
      distPtSeg(x0, y1, ax, ay, bx, by), distPtSeg(x1, y1, ax, ay, bx, by));
    return d - s.rad;
  }
  function segsCross(ax, ay, bx, by, cx, cy, dx, dy) {
    const o = (px, py, qx, qy, rx, ry) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
    const o1 = o(ax, ay, bx, by, cx, cy), o2 = o(ax, ay, bx, by, dx, dy);
    const o3 = o(cx, cy, dx, dy, ax, ay), o4 = o(cx, cy, dx, dy, bx, by);
    return o1 * o2 < 0 && o3 * o4 < 0;
  }
  function distSegSeg(a, b) {
    if (segsCross(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1, b.x2, b.y2)) return 0;
    return Math.min(
      distPtSeg(a.x1, a.y1, b.x1, b.y1, b.x2, b.y2), distPtSeg(a.x2, a.y2, b.x1, b.y1, b.x2, b.y2),
      distPtSeg(b.x1, b.y1, a.x1, a.y1, a.x2, a.y2), distPtSeg(b.x2, b.y2, a.x1, a.y1, a.x2, a.y2));
  }
  function distShapeShape(a, b) { // aproximação exata o bastante p/ caixas alinhadas
    const dx = Math.max(Math.abs(a.cx - b.cx) - a.ix - b.ix, 0);
    const dy = Math.max(Math.abs(a.cy - b.cy) - a.iy - b.iy, 0);
    return Math.hypot(dx, dy) - a.rad - b.rad;
  }

  class Heap {
    constructor() { this.k = new Float64Array(4096); this.v = new Int32Array(4096); this.n = 0; }
    clear() { this.n = 0; }
    push(key, val) {
      if (this.n === this.k.length) {
        const k = new Float64Array(this.n * 2); k.set(this.k); this.k = k;
        const v = new Int32Array(this.n * 2); v.set(this.v); this.v = v;
      }
      let i = this.n++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (this.k[p] <= key) break;
        this.k[i] = this.k[p]; this.v[i] = this.v[p]; i = p;
      }
      this.k[i] = key; this.v[i] = val;
    }
    pop() {
      const top = this.v[0];
      const n = --this.n;
      if (n > 0) {
        const key = this.k[n], val = this.v[n];
        let i = 0;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= n) break;
          if (c + 1 < n && this.k[c + 1] < this.k[c]) c++;
          if (this.k[c] >= key) break;
          this.k[i] = this.k[c]; this.v[i] = this.v[c]; i = c;
        }
        this.k[i] = key; this.v[i] = val;
      }
      return top;
    }
  }

  const merge = (arr, i, key) => {
    const o = arr[i];
    if (o === FREE) arr[i] = key;
    else if (o !== key) arr[i] = BLOCK;
  };
  function offsets(radiusCells) {
    const out = [], R = Math.ceil(radiusCells);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++)
      if (Math.hypot(dx, dy) < radiusCells - EPS) out.push(dx, dy);
    return out;
  }

  /**
   * problem = {
   *   width, height (mm), layers (1|2), grid (mm, opcional),
   *   trace, clearance, via: {d, drill}, edge (folga até a borda),
   *   pads:  [{x, y, w, h, shape: 'circle'|'rect'|'oval', net}]   net = índice ou -1
   *   nets:  [{id, groups: [[padIdx]]}]   grupos = pinos já ligados por dentro
   * }
   */
  async function route(problem, opts = {}, onProgress) {
    const g = problem.grid || 0.635;
    const W = problem.width, H = problem.height;
    const cols = Math.floor(W / g + EPS) + 1, rows = Math.floor(H / g + EPS) + 1;
    const L = problem.layers === 2 ? 2 : 1;
    const N = cols * rows, NN = N * L;
    const tw = problem.trace, cl = problem.clearance, vd = problem.via.d;
    const edge = problem.edge ?? 0.4;
    const viaCost = opts.viaCost ?? 10;
    const maxIter = opts.maxIter ?? 60;
    const pads = problem.pads.map(p => ({ ...p, s: toShape(p) }));
    const errors = [];

    let extra = 1 << 24;
    const padKey = pads.map(p => (p.net >= 0 ? p.net : extra++));

    // ---------- células de cada pad ----------
    const padOf = new Int32Array(N).fill(-1);
    const padCells = pads.map(() => []);
    pads.forEach((p, i) => {
      const s = p.s, hw = s.ix + s.rad, hh = s.iy + s.rad;
      if (p.x - hw < 0 || p.y - hh < 0 || p.x + hw > W || p.y + hh > H) { errors.push({ type: 'edge', pad: i }); return; }
      const x0 = Math.floor((p.x - hw) / g), x1 = Math.ceil((p.x + hw) / g);
      const y0 = Math.floor((p.y - hh) / g), y1 = Math.ceil((p.y + hh) / g);
      let best = -1, bd = Infinity;
      for (let y = Math.max(0, y0); y <= Math.min(rows - 1, y1); y++)
        for (let x = Math.max(0, x0); x <= Math.min(cols - 1, x1); x++) {
          const d = distPtBox(x * g, y * g, s) - s.rad;
          const c = y * cols + x;
          if (d <= EPS) {
            if (padOf[c] >= 0 && padOf[c] !== i) errors.push({ type: 'overlap', pad: i, other: padOf[c] });
            padOf[c] = i; padCells[i].push(c);
          }
          if (d < bd) { bd = d; best = c; }
        }
      if (!padCells[i].length && best >= 0) { padOf[best] = i; padCells[i].push(best); }
    });
    // pads encostados (cobre com cobre) de redes diferentes também são erro
    for (let i = 0; i < pads.length; i++) for (let j = i + 1; j < pads.length; j++) {
      if (padKey[i] === padKey[j] || (pads[i].comp !== undefined && pads[i].comp === pads[j].comp)) continue;
      if (distShapeShape(pads[i].s, pads[j].s) < EPS) errors.push({ type: 'overlap', pad: i, other: j });
    }
    if (errors.length) return { ok: false, errors };

    // ---------- zonas proibidas ----------
    // ez[c*4+k]: segmento da célula c na direção k (0 L, 1 SE, 2 S, 3 SO)
    const ez = new Int32Array(N * 4).fill(FREE);
    const vz = new Int32Array(N).fill(FREE);
    const needT = cl + tw / 2, needV = cl + vd / 2;
    pads.forEach((p, i) => {
      const s = p.s, key = padKey[i];
      const reach = s.ix + s.rad + Math.max(needT, needV) + g * 1.5;
      const x0 = Math.max(0, Math.floor((p.x - reach) / g)), x1 = Math.min(cols - 1, Math.ceil((p.x + reach) / g));
      const y0 = Math.max(0, Math.floor((p.y - reach) / g)), y1 = Math.min(rows - 1, Math.ceil((p.y + reach) / g));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const c = y * cols + x, ax = x * g, ay = y * g;
        if (distPtBox(ax, ay, s) - s.rad < needV - EPS) merge(vz, c, key);
        for (let k = 0; k < 4; k++) {
          const nx = x + DX[k], ny = y + DY[k];
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          if (distSegShape(ax, ay, nx * g, ny * g, s) < needT - EPS) merge(ez, c * 4 + k, key);
        }
      }
    });
    const badCell = new Uint8Array(N);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const m = Math.min(x * g, W - x * g, y * g, H - y * g);
      const c = y * cols + x;
      if (m < tw / 2 + edge - EPS && padOf[c] < 0) badCell[c] = 1;
      if (m < vd / 2 + edge - EPS) vz[c] = BLOCK;
    }

    // ---------- vizinhanças de conflito ----------
    const halfDiag = g * SQRT2 / 2; // compensa a folga medida só nos nós da grade
    const offT = offsets(Math.sqrt((tw + cl) ** 2 + halfDiag ** 2) / g);            // trilha ↔ trilha
    const offV = offsets(Math.sqrt((vd / 2 + cl + tw / 2) ** 2 + halfDiag ** 2) / g); // via ↔ trilha
    const offVV = offsets((vd + cl) / g);                                              // via ↔ via

    const occ = new Uint16Array(NN), hist = new Float32Array(NN);
    const near = new Uint16Array(NN);   // células de outras redes por perto
    const vT = new Uint16Array(NN);     // vias de outras redes por perto (sobre trilhas)
    const vV = new Uint16Array(N);      // vias de outras redes por perto (sobre vias)
    const viaHist = new Float32Array(N);

    function stamp(arr, c, off, d, layerBase) {
      const x = c % cols, y = (c / cols) | 0;
      for (let i = 0; i < off.length; i += 2) {
        const xx = x + off[i], yy = y + off[i + 1];
        if (xx >= 0 && yy >= 0 && xx < cols && yy < rows) arr[layerBase + yy * cols + xx] += d;
      }
    }

    // ---------- A* ----------
    const S = NN * 9;
    const gs = new Float32Array(S), seen = new Int32Array(S), closed = new Int32Array(S), parent = new Int32Array(S);
    const isTarget = new Int32Array(N);
    const heap = new Heap();
    let sid = 0;

    function moveOK(net, c, k, nc) {
      if (badCell[nc]) return false;
      const e = k < 4 ? ez[c * 4 + k] : ez[nc * 4 + (k - 4)];
      return e === FREE || e === net;
    }

    function search(net, sources, targets, presFac) {
      sid++;
      heap.clear();
      const tx = [], ty = [], tr = [];
      for (const t of targets) {
        for (const c of padCells[t]) isTarget[c] = sid;
        const s = pads[t].s;
        tx.push(pads[t].x / g); ty.push(pads[t].y / g); tr.push((Math.max(s.ix, s.iy) + s.rad) * 1.1 / g);
      }
      const h = c => {
        const x = c % cols, y = (c / cols) | 0;
        let best = Infinity;
        for (let i = 0; i < tx.length; i++) {
          const ax = Math.abs(x - tx[i]), ay = Math.abs(y - ty[i]);
          const d = (ax > ay ? ax + (SQRT2 - 1) * ay : ay + (SQRT2 - 1) * ax) - tr[i];
          if (d < best) best = d;
        }
        return Math.max(0, best);
      };
      for (const node of sources) {
        const st = node * 9 + NODIR;
        seen[st] = sid; gs[st] = 0; parent[st] = -1;
        heap.push(h(node % N), st);
      }
      const relax = (ns, ng, from, c) => {
        if (seen[ns] !== sid || ng < gs[ns]) {
          seen[ns] = sid; gs[ns] = ng; parent[ns] = from;
          heap.push(ng + h(c), ns);
        }
      };
      while (heap.n) {
        const st = heap.pop();
        if (closed[st] === sid) continue;
        closed[st] = sid;
        const node = (st / 9) | 0, dir = st - node * 9;
        const l = (node / N) | 0, c = node - l * N;
        const x = c % cols, y = (c / cols) | 0;
        if (isTarget[c] === sid) {
          const path = [];
          for (let s = st; s !== -1; s = parent[s]) path.push((s / 9) | 0);
          return path.reverse();
        }
        const gc = gs[st];
        for (let k = 0; k < 8; k++) {
          let tp = 0;
          if (dir !== NODIR) {
            let d = Math.abs(k - dir); if (d > 4) d = 8 - d;
            tp = TURN[d];
            if (tp === Infinity) continue;
          }
          const nx = x + DX[k], ny = y + DY[k];
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const nc = ny * cols + nx;
          if (!moveOK(net, c, k, nc)) continue;
          const nn = l * N + nc;
          const step = ((k & 1) ? SQRT2 : 1) * (1 + hist[nn]) * (1 + presFac * (near[nn] + vT[nn]));
          relax(nn * 9 + k, gc + step + tp, st, nc);
        }
        if (L === 2) {
          const nn = (1 - l) * N + c;
          let cost;
          if (padOf[c] >= 0) {
            if (padKey[padOf[c]] !== net) continue;
            cost = 0.001; // pad metalizado já liga as duas faces
          } else {
            if (vz[c] !== FREE && vz[c] !== net) continue;
            let crowd = vV[c];
            for (let ll = 0; ll < L; ll++) {
              for (let i = 0; i < offV.length; i += 2) {
                const xx = x + offV[i], yy = y + offV[i + 1];
                if (xx >= 0 && yy >= 0 && xx < cols && yy < rows) crowd += occ[ll * N + yy * cols + xx];
              }
            }
            cost = viaCost * (1 + viaHist[c]) * (1 + presFac * crowd) * (1 + hist[nn]);
          }
          relax(nn * 9 + NODIR, gc + cost, st, c);
        }
      }
      return null;
    }

    // ---------- redes ----------
    const netKey = problem.nets.map(n => n.id);
    const states = problem.nets.map(() => ({ nodes: new Set(), vias: new Set(), paths: [], live: false }));

    function apply(s, d) {
      for (const n of s.nodes) {
        const l = (n / N) | 0;
        occ[n] += d;
        stamp(near, n - l * N, offT, d, l * N);
      }
      for (const v of s.vias) {
        stamp(vV, v, offVV, d, 0);
        for (let l = 0; l < L; l++) stamp(vT, v, offV, d, l * N);
      }
    }
    function ripUp(s) {
      if (s.live) apply(s, -1);
      s.live = false; s.nodes = new Set(); s.vias = new Set(); s.paths = [];
    }
    const padNodes = pi => {
      const out = [];
      for (const c of padCells[pi]) for (let l = 0; l < L; l++) out.push(l * N + c);
      return out;
    };

    function routeNet(i, presFac) {
      const s = states[i];
      ripUp(s);
      const groups = problem.nets[i].groups;
      if (groups.length < 2) return true;
      const net = netKey[i];
      const tree = [], done = [groups[0]];
      for (const p of groups[0]) tree.push(...padNodes(p));
      const rest = groups.slice(1);
      const nodes = new Set(), vias = new Set(), paths = [];
      while (rest.length) {
        let bi = 0, bd = Infinity;
        rest.forEach((grp, gi) => {
          for (const p of grp) for (const dgrp of done) for (const q of dgrp) {
            const d = Math.abs(pads[p].x - pads[q].x) + Math.abs(pads[p].y - pads[q].y);
            if (d < bd) { bd = d; bi = gi; }
          }
        });
        const grp = rest.splice(bi, 1)[0];
        const path = search(net, tree, grp, presFac);
        if (!path) return false;
        for (let k = 0; k < path.length; k++) {
          nodes.add(path[k]);
          if (k && ((path[k] / N) | 0) !== ((path[k - 1] / N) | 0)) {
            const c = path[k] % N;
            if (padOf[c] < 0) vias.add(c);
          }
        }
        paths.push(path);
        tree.push(...path);
        for (const p of grp) tree.push(...padNodes(p));
        done.push(grp);
      }
      s.nodes = nodes; s.vias = vias; s.paths = paths; s.live = true;
      apply(s, 1);
      return true;
    }

    // conflitos reais (com dono de cada célula), usados para decidir quem refazer
    const ownerOf = new Int32Array(NN), viaOwner = new Int32Array(N);
    function buildOwners(skip) {
      ownerOf.fill(FREE); viaOwner.fill(FREE);
      states.forEach((s, i) => {
        if (!s.live || (skip && skip.has(i))) return;
        const net = netKey[i];
        for (const n of s.nodes) ownerOf[n] = ownerOf[n] === FREE || ownerOf[n] === net ? net : MULTI;
        for (const v of s.vias) viaOwner[v] = viaOwner[v] === FREE || viaOwner[v] === net ? net : MULTI;
      });
    }
    function around(arr, base, c, off, net) {
      const x = c % cols, y = (c / cols) | 0;
      for (let i = 0; i < off.length; i += 2) {
        const xx = x + off[i], yy = y + off[i + 1];
        if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) continue;
        const o = arr[base + yy * cols + xx];
        if (o !== FREE && o !== net) return true;
      }
      return false;
    }
    function conflicts(i, markHist) {
      const s = states[i];
      if (!s.live) return 0;
      const net = netKey[i];
      let n = 0;
      for (const node of s.nodes) {
        const l = (node / N) | 0, c = node - l * N;
        if (around(ownerOf, l * N, c, offT, net) || around(viaOwner, 0, c, offV, net)) {
          n++;
          if (markHist) hist[node] += 0.4;
        }
      }
      for (const v of s.vias) {
        let bad = around(viaOwner, 0, v, offVV, net);
        for (let l = 0; l < L && !bad; l++) bad = around(ownerOf, l * N, v, offV, net);
        if (bad) { n++; if (markHist) viaHist[v] += 0.4; }
      }
      return n;
    }

    // ---------- negociação ----------
    const span = i => {
      const ps = problem.nets[i].groups.flat();
      const xs = ps.map(p => pads[p].x), ys = ps.map(p => pads[p].y);
      return (Math.max(...xs) - Math.min(...xs)) + (Math.max(...ys) - Math.min(...ys));
    };
    const order = problem.nets.map((n, i) => i).sort((a, b) => span(a) - span(b));
    const blocked = new Set();
    let presFac = 0.5, legal = false, it = 0;
    let dirty = order.slice();
    for (it = 0; it < maxIter; it++) {
      for (const i of dirty) {
        if (blocked.has(i)) continue;
        if (!routeNet(i, presFac)) blocked.add(i);
      }
      buildOwners();
      let total = 0;
      dirty = [];
      for (const i of order) {
        const c = conflicts(i, true);
        if (c) { total += c; dirty.push(i); }
      }
      if (onProgress) onProgress({ iteration: it + 1, maxIter, conflicts: total });
      if (!total) { legal = true; it++; break; }
      presFac *= 1.6;
      await new Promise(r => setTimeout(r, 0));
    }

    // ---------- legalização: tira as redes que ainda encostam ----------
    const failed = new Set(blocked);
    if (!legal) {
      for (;;) {
        buildOwners(failed);
        let worst = -1, wc = 0;
        states.forEach((s, i) => {
          if (failed.has(i)) return;
          const c = conflicts(i, false);
          if (c > wc) { wc = c; worst = i; }
        });
        if (worst < 0) break;
        ripUp(states[worst]);
        failed.add(worst);
      }
      for (const i of [...failed]) { // segunda chance sem aceitar disputa
        if (blocked.has(i)) continue;
        if (routeNet(i, 1e6)) {
          buildOwners(failed);
          if (conflicts(i, false) === 0) { failed.delete(i); continue; }
        }
        ripUp(states[i]);
      }
    }

    // ---------- resultado em mm ----------
    const pt = n => { const l = (n / N) | 0, c = n - l * N; return { x: (c % cols) * g, y: ((c / cols) | 0) * g, l }; };
    const nets = states.map((s, i) => {
      const ok = !failed.has(i) && s.live;
      const paths = ok ? s.paths.map(p => {
        const out = p.map(pt);
        // ponta da trilha até o centro do pad (fica dentro do cobre do pad)
        const first = padOf[p[0] % N], last = padOf[p[p.length - 1] % N];
        if (first >= 0) out.unshift({ x: pads[first].x, y: pads[first].y, l: out[0].l });
        if (last >= 0) out.push({ x: pads[last].x, y: pads[last].y, l: out[out.length - 1].l });
        return out;
      }) : [];
      let length = 0;
      for (const p of paths) for (let k = 1; k < p.length; k++)
        if (p[k].l === p[k - 1].l) length += Math.hypot(p[k].x - p[k - 1].x, p[k].y - p[k - 1].y);
      return {
        id: netKey[i], routed: ok || problem.nets[i].groups.length < 2, paths,
        vias: ok ? [...s.vias].map(c => ({ x: (c % cols) * g, y: ((c / cols) | 0) * g })) : [],
        length,
      };
    });
    return {
      ok: true, legal: failed.size === 0, iterations: it, nets,
      failed: [...failed].map(i => netKey[i]),
      blocked: [...blocked].map(i => netKey[i]),
    };
  }

  /**
   * Conferência de regras: mede a menor folga real entre cobre de redes diferentes.
   * items: pads [{x,y,w,h,shape,net,comp}], segs [{x1,y1,x2,y2,w,l,net}], vias [{x,y,d,net}]
   */
  function drc({ pads, segs, vias, clearance, layers }) {
    const objs = [];
    pads.forEach(p => objs.push({ kind: 'pad', net: p.net, comp: p.comp, s: toShape(p), layers: layers === 2 ? [0, 1] : [1], ref: p.ref }));
    vias.forEach(v => objs.push({ kind: 'via', net: v.net, s: toShape({ x: v.x, y: v.y, w: v.d, h: v.d, shape: 'circle' }), layers: [0, 1] }));
    segs.forEach(sg => objs.push({ kind: 'seg', net: sg.net, sg, hw: sg.w / 2, layers: [sg.l] }));
    objs.forEach(o => {
      if (o.kind === 'seg') {
        const { x1, y1, x2, y2 } = o.sg;
        o.bb = [Math.min(x1, x2) - o.hw, Math.min(y1, y2) - o.hw, Math.max(x1, x2) + o.hw, Math.max(y1, y2) + o.hw];
      } else {
        const s = o.s;
        o.bb = [s.cx - s.ix - s.rad, s.cy - s.iy - s.rad, s.cx + s.ix + s.rad, s.cy + s.iy + s.rad];
      }
    });
    let min = Infinity;
    const bad = [];
    const reach = clearance + 0.5;
    for (let i = 0; i < objs.length; i++) for (let j = i + 1; j < objs.length; j++) {
      const a = objs[i], b = objs[j];
      if (a.net === b.net && a.net >= 0) continue;
      if (a.kind === 'pad' && b.kind === 'pad' && a.comp === b.comp) continue; // definido pelo datasheet
      if (!a.layers.some(l => b.layers.includes(l))) continue;
      if (a.bb[0] > b.bb[2] + reach || b.bb[0] > a.bb[2] + reach || a.bb[1] > b.bb[3] + reach || b.bb[1] > a.bb[3] + reach) continue;
      let d;
      if (a.kind === 'seg' && b.kind === 'seg') d = distSegSeg(a.sg, b.sg) - a.hw - b.hw;
      else if (a.kind === 'seg') d = distSegShape(a.sg.x1, a.sg.y1, a.sg.x2, a.sg.y2, b.s) - a.hw;
      else if (b.kind === 'seg') d = distSegShape(b.sg.x1, b.sg.y1, b.sg.x2, b.sg.y2, a.s) - b.hw;
      else d = distShapeShape(a.s, b.s);
      if (d < min) min = d;
      if (d < clearance - 0.005) bad.push({ a, b, gap: d });
    }
    return { minGap: min, violations: bad };
  }

  const padGap = (a, b) => distShapeShape(toShape(a), toShape(b));
  const api = { route, drc, padGap };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PCBRouter = api;
})(typeof window !== 'undefined' ? window : globalThis);
