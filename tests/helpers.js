// Carrega os módulos do app no Node e monta pads/redes como o app.js faz.
require('../js/library.js');
require('../js/examples.js');
const PCBRouter = require('../js/router.js');
const PCBPdf = require('../js/pdf.js');
globalThis.PCBPdf = PCBPdf; // o gerber.js usa a conversão de arcos do pdf.js
const PCBGerber = require('../js/gerber.js');

const LIB = Object.fromEntries(globalThis.PCB_LIBRARY.map(l => [l.id, l]));
const rot = (x, y, r) => [[x, y], [-y, x], [-x, -y], [y, -x]][r & 3];

function blank() {
  return {
    version: 2, board: { w: 80, h: 60 }, components: [], connections: [], netNames: {},
    settings: { layers: 2, trace: 0.4, clearance: 0.25, ring: 0, via: '1.2/0.6', snap: 2.54 }, nextId: 1,
  };
}

const example = key => globalThis.PCB_EXAMPLES[key].build(blank);

/** Pinos com posição absoluta (mm) e pad já girado, como o pinsOf() do app. */
function pinsOf(S) {
  const pins = [];
  for (const c of S.components) {
    const fp = LIB[c.type].build(c.param);
    fp.pins.forEach((p, i) => {
      const [rx, ry] = rot(p.x, p.y, c.rot), odd = c.rot & 1;
      pins.push({
        key: `${c.id}:${i}`, comp: c.id, ref: c.ref, num: p.num,
        name: (c.pinNames && c.pinNames[i]) || p.name,
        x: c.x + rx, y: c.y + ry,
        w: (odd ? p.pad.h : p.pad.w) + S.settings.ring, h: (odd ? p.pad.w : p.pad.h) + S.settings.ring,
        shape: p.pad.shape, drill: p.pad.drill,
      });
    });
  }
  return pins;
}

/** Redes: união das ligações + ligações internas dos componentes. */
function netsOf(S) {
  const par = new Map();
  const find = k => { while (par.get(k) !== k) k = par.get(k); return k; };
  const add = k => { if (!par.has(k)) par.set(k, k); };
  const uni = (a, b) => { add(a); add(b); const ra = find(a), rb = find(b); if (ra !== rb) par.set(rb, ra); };
  S.connections.forEach(c => uni(c.a, c.b));
  const internal = [];
  for (const c of S.components) (LIB[c.type].build(c.param).internal || []).forEach(([i, j]) => {
    const a = `${c.id}:${i}`, b = `${c.id}:${j}`;
    if (par.has(a) || par.has(b)) { uni(a, b); internal.push([a, b]); }
  });
  const roots = new Map();
  for (const k of par.keys()) { const r = find(k); if (!roots.has(r)) roots.set(r, []); roots.get(r).push(k); }
  return { nets: [...roots.values()], internal };
}

/** Roteia um estado do editor e devolve resultado + DRC. */
async function routeState(S) {
  const st = S.settings;
  const via = { d: 1.2, drill: 0.6 };
  const pins = pinsOf(S);
  const { nets, internal } = netsOf(S);
  const idx = new Map(pins.map((p, i) => [p.key, i]));
  const netOf = new Map();
  nets.forEach((ks, i) => ks.forEach(k => netOf.set(k, i)));
  const pads = pins.map(p => ({ x: p.x, y: p.y, w: p.w, h: p.h, shape: p.shape, comp: p.comp, net: netOf.has(p.key) ? netOf.get(p.key) : -1 }));
  const groupsOf = ks => {
    const gp = new Map(ks.map(k => [k, k]));
    const gf = k => { while (gp.get(k) !== k) k = gp.get(k); return k; };
    internal.forEach(([a, b]) => { if (gp.has(a) && gp.has(b)) gp.set(gf(b), gf(a)); });
    const m = new Map();
    ks.forEach(k => { const r = gf(k); if (!m.has(r)) m.set(r, []); m.get(r).push(idx.get(k)); });
    return [...m.values()];
  };
  const res = await PCBRouter.route({
    width: S.board.w, height: S.board.h, layers: st.layers, trace: st.trace, clearance: st.clearance, via, pads,
    nets: nets.map((ks, i) => ({ id: i, groups: groupsOf(ks) })),
  }, { maxIter: 60 });
  if (!res.ok) return { res, pins, pads };
  const L = st.layers;
  const segs = [], traces = [];
  res.nets.forEach((n, ni) => n.paths.forEach(p => {
    let run = [p[0]];
    const flush = () => { if (run.length > 1) traces.push({ l: L === 1 ? 1 : run[0].l, w: st.trace, pts: run.map(q => [q.x, q.y]) }); };
    for (let k = 1; k < p.length; k++) {
      if (p[k].l !== p[k - 1].l) { flush(); run = [p[k]]; continue; }
      run.push(p[k]);
      if (p[k].x !== p[k - 1].x || p[k].y !== p[k - 1].y) {
        segs.push({ x1: p[k - 1].x, y1: p[k - 1].y, x2: p[k].x, y2: p[k].y, w: st.trace, l: L === 1 ? 1 : p[k].l, net: ni });
      }
    }
    flush();
  }));
  const vias = res.nets.flatMap((n, ni) => n.vias.map(v => ({ ...v, d: via.d, net: ni })));
  const drc = PCBRouter.drc({ pads, segs, vias, clearance: st.clearance, layers: L });
  return { res, drc, pins, pads, traces, vias, via, nets };
}

module.exports = { LIB, PCBRouter, PCBPdf, PCBGerber, blank, example, pinsOf, netsOf, routeState };
