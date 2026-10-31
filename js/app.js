(() => {
  'use strict';

  const GRID = 0.635;   // grade de roteamento (mm)
  const PITCH = 2.54;   // grade visual (mm)
  const STORE = 'placa-prototipada:v2';
  const DRILL_GUIDE = 0.4; // ponto-guia da broca no desenho do cobre (mm)
  const VIAS = { '1.2/0.6': { d: 1.2, drill: 0.6 }, '1.6/0.8': { d: 1.6, drill: 0.8 }, '2.0/1.0': { d: 2.0, drill: 1.0 } };
  const LIB = window.PCB_LIBRARY;
  const LIBMAP = Object.fromEntries(LIB.map(l => [l.id, l]));
  const COLORS = ['#f2a93b', '#5cc8f0', '#f0708a', '#96d66e', '#b996f5', '#f5dc5a', '#4fd6c2', '#f59a64', '#e08ae0', '#a8bcd6', '#d4e36b', '#ff8f8f'];

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, d = 2) => n.toFixed(d).replace('.', ',');
  const r3 = n => Math.round(n * 1000) / 1000;

  // ------------------------------------------------------------------ estado
  function blank() {
    return {
      version: 2,
      board: { w: 80, h: 60 },
      components: [],
      connections: [],
      netNames: {},
      settings: { layers: 2, trace: 0.4, clearance: 0.25, ring: 0, via: '1.2/0.6', snap: 2.54 },
      route: null,
      nextId: 1,
    };
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE);
      return raw ? sanitize(JSON.parse(raw)) : null;
    } catch { return null; }
  }
  function sanitize(d) {
    if (!d || d.version !== 2 || !Array.isArray(d.components) || !Array.isArray(d.connections)) throw new Error('arquivo inválido ou de uma versão antiga');
    const b = blank();
    d.components = d.components.filter(c => LIBMAP[c.type]);
    const ids = new Set(d.components.map(c => c.id));
    d.connections = d.connections.filter(c => ids.has(c.a.split(':')[0]) && ids.has(c.b.split(':')[0]));
    return { ...b, ...d, board: { ...b.board, ...d.board }, settings: { ...b.settings, ...d.settings }, netNames: d.netNames || {} };
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(S)); } catch { /* armazenamento indisponível */ }
  }

  let S = load() || blank();
  const ui = {
    step: 'comp', sel: null, pending: null, hoverNet: null, formPins: [],
    show: { top: true, bottom: true, silk: true, rats: true, pins: true },
    view: null, drag: null, pan: null, routing: false, progress: null, routeMsg: null,
  };

  // --------------------------------------------------------------- geometria
  const fpCache = new Map();
  function footprint(c) {
    const key = c.type + ':' + (c.param ?? '');
    if (!fpCache.has(key)) {
      const fp = LIBMAP[c.type].build(c.param);
      fp.bbox = measure(fp);
      const allRow = fp.pins.length > 2 && fp.pins.every(p => p.y === fp.pins[0].y);
      const cx = (fp.bbox.x0 + fp.bbox.x1) / 2, cy = (fp.bbox.y0 + fp.bbox.y1) / 2;
      const hw = (fp.bbox.x1 - fp.bbox.x0) / 2 || 1, hh = (fp.bbox.y1 - fp.bbox.y0) / 2 || 1;
      // direção do rótulo de cada pino: para fora do componente
      fp.labelDir = fp.pins.map(p => {
        if (allRow) return [0, 1];
        const vx = (p.x - cx) / hw, vy = (p.y - cy) / hh;
        if (Math.abs(vx) < 0.05 && Math.abs(vy) < 0.05) return [0, 1];
        return Math.abs(vx) > Math.abs(vy) ? [Math.sign(vx), 0] : [0, Math.sign(vy)];
      });
      // pino com vizinho lado a lado na mesma fileira: nome longo vai na vertical
      fp.crowded = fp.pins.map((p, i) => {
        const [dx, dy] = fp.labelDir[i];
        return fp.pins.some((q, j) => j !== i &&
          Math.abs((q.x - p.x) * dx + (q.y - p.y) * dy) < 0.01 &&
          Math.abs((q.x - p.x) * -dy + (q.y - p.y) * dx) < 3.2);
      });
      fpCache.set(key, fp);
    }
    return fpCache.get(key);
  }
  let measureSvg = null;
  function measure(fp) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    fp.pins.forEach(p => { add(p.x - p.pad.w / 2, p.y - p.pad.h / 2); add(p.x + p.pad.w / 2, p.y + p.pad.h / 2); });
    for (const s of fp.body) {
      if (s.t === 'rect') { add(s.x, s.y); add(s.x + s.w, s.y + s.h); }
      else if (s.t === 'circle') { add(s.cx - s.r, s.cy - s.r); add(s.cx + s.r, s.cy + s.r); }
      else if (s.t === 'line') { add(s.x1, s.y1); add(s.x2, s.y2); }
      else if (s.t === 'path') {
        if (!measureSvg) {
          measureSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          measureSvg.setAttribute('style', 'position:absolute;width:0;height:0;visibility:hidden');
          document.body.appendChild(measureSvg);
        }
        measureSvg.innerHTML = `<path d="${s.d}"/>`;
        const b = measureSvg.firstChild.getBBox();
        add(b.x, b.y); add(b.x + b.width, b.y + b.height);
      }
    }
    return { x0: x0 - 0.2, y0: y0 - 0.2, x1: x1 + 0.2, y1: y1 + 0.2 };
  }
  function rot(x, y, r) {
    switch (r & 3) {
      case 0: return [x, y];
      case 1: return [-y, x];
      case 2: return [-x, -y];
      default: return [y, -x];
    }
  }
  // nome do pino: o do datasheet ou o digitado pelo usuário (conectores)
  const pinName = (fp, c, i) => (c && c.pinNames && c.pinNames[i]) || fp.pins[i].name;
  function pinTag(fp, i, c) {
    const name = pinName(fp, c, i);
    if (!name) return fp.pins[i].num;
    return fp.pins.filter((q, j) => pinName(fp, c, j) === name).length > 1 ? `${name}/${fp.pins[i].num}` : name;
  }
  function pinsOf(c) {
    const fp = footprint(c);
    const ring = S.settings.ring;
    return fp.pins.map((p, i) => {
      const [rx, ry] = rot(p.x, p.y, c.rot);
      const odd = c.rot & 1;
      const w = (odd ? p.pad.h : p.pad.w) + ring, h = (odd ? p.pad.w : p.pad.h) + ring;
      return {
        key: `${c.id}:${i}`, comp: c, idx: i, num: p.num, name: pinName(fp, c, i),
        x: r3(c.x + rx), y: r3(c.y + ry), w, h, shape: p.pad.shape, drill: p.pad.drill,
        dir: rot(...fp.labelDir[i], c.rot), crowded: fp.crowded[i],
        short: pinName(fp, c, i) || p.num, // texto do rótulo na placa
        tag: pinTag(fp, i, c), label: `${c.ref}.${pinTag(fp, i, c)}`,
      };
    });
  }
  function boxOf(c) {
    const b = footprint(c).bbox;
    const pts = [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].map(([x, y]) => rot(x, y, c.rot));
    const xs = pts.map(p => p[0] + c.x), ys = pts.map(p => p[1] + c.y);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }
  const via = () => VIAS[S.settings.via] || VIAS['1.2/0.6'];

  // ------------------------------------------------------- derivações (cache)
  let D = null;
  function derive() {
    const pins = new Map();
    S.components.forEach(c => pinsOf(c).forEach(p => pins.set(p.key, p)));

    const parent = new Map();
    const find = k => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
    const add = k => { if (!parent.has(k)) parent.set(k, k); };
    const union = (a, b) => { add(a); add(b); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
    S.connections.forEach(cn => union(cn.a, cn.b));
    const internal = [];
    S.components.forEach(c => (footprint(c).internal || []).forEach(([i, j]) => {
      const a = `${c.id}:${i}`, b = `${c.id}:${j}`;
      if (parent.has(a) || parent.has(b)) { union(a, b); internal.push([a, b]); }
    }));
    const byRoot = new Map();
    for (const k of parent.keys()) {
      const r = find(k);
      if (!byRoot.has(r)) byRoot.set(r, []);
      byRoot.get(r).push(k);
    }
    const netOf = new Map();
    const nets = [...byRoot.values()].map((keys, i) => {
      keys.forEach(k => netOf.set(k, i));
      const gp = new Map(keys.map(k => [k, k]));
      const gf = k => { while (gp.get(k) !== k) k = gp.get(k); return k; };
      internal.forEach(([a, b]) => { if (gp.has(a) && gp.has(b)) { const ra = gf(a), rb = gf(b); if (ra !== rb) gp.set(rb, ra); } });
      const groups = new Map();
      keys.forEach(k => { const r = gf(k); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(k); });
      const named = keys.find(k => S.netNames[k]);
      return { index: i, keys, groups: [...groups.values()], name: named ? S.netNames[named] : `N${i + 1}`, color: COLORS[i % COLORS.length], conns: [] };
    });
    S.connections.forEach((cn, ci) => nets[netOf.get(cn.a)].conns.push(ci));

    // cobre encostado entre componentes diferentes, ou fora da placa
    const clash = new Set(), clashMsgs = [];
    const list = [...pins.values()];
    const edge = 0.4;
    for (const p of list) {
      if (p.x - p.w / 2 < edge || p.y - p.h / 2 < edge || p.x + p.w / 2 > S.board.w - edge || p.y + p.h / 2 > S.board.h - edge) {
        clash.add(p.comp.id); clashMsgs.push(`${p.label} está fora da placa (ou encostado na borda)`);
      }
    }
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.comp === b.comp) continue;
      if (Math.abs(a.x - b.x) > 6 || Math.abs(a.y - b.y) > 6) continue;
      const na = netOf.get(a.key), nb = netOf.get(b.key);
      const gap = window.PCBRouter.padGap(a, b);
      if (gap < 0.01 || (gap < S.settings.clearance && (na === undefined || na !== nb))) {
        clash.add(a.comp.id); clash.add(b.comp.id);
        clashMsgs.push(`${a.label} muito perto de ${b.label} (${fmt(Math.max(0, gap))} mm)`);
      }
    }
    D = { pins, nets, netOf, clash, clashMsgs };
    return D;
  }

  function signature() {
    const st = S.settings;
    return JSON.stringify([
      S.board, st.layers, st.trace, st.clearance, st.ring, st.via,
      S.components.map(c => [c.id, c.type, c.param, c.x, c.y, c.rot]),
      S.connections.map(c => [c.a, c.b]),
    ]);
  }
  const routeValid = () => S.route && S.route.sig === signature();

  // ------------------------------------------------------------- componentes
  function nextRef(prefix) {
    let n = 0;
    const re = new RegExp('^' + prefix + '(\\d+)$');
    S.components.forEach(c => { const m = c.ref.match(re); if (m) n = Math.max(n, +m[1]); });
    return prefix + (n + 1);
  }
  function addComponent(type, param) {
    const def = LIBMAP[type];
    const c = { id: 'c' + S.nextId++, type, param: def.param ? param : undefined, ref: nextRef(def.prefix), value: '', x: 0, y: 0, rot: 0 };
    placeFree(c);
    S.components.push(c);
    ui.sel = c.id;
    changed();
  }
  function placeFree(c) {
    const others = S.components.map(boxOf);
    const hit = b => others.some(o => b.x0 < o.x1 + 1.5 && b.x1 > o.x0 - 1.5 && b.y0 < o.y1 + 2.5 && b.y1 > o.y0 - 2.5);
    for (let y = PITCH; y < S.board.h; y += PITCH) {
      for (let x = PITCH; x < S.board.w; x += PITCH) {
        c.x = r3(x); c.y = r3(y);
        const b = boxOf(c);
        if (b.x0 < 1.5 || b.y0 < 3 || b.x1 > S.board.w - 1.5 || b.y1 > S.board.h - 1.5) continue;
        if (!hit(b)) return;
      }
    }
    c.x = r3(Math.round(S.board.w / 3 / PITCH) * PITCH);
    c.y = r3(Math.round(S.board.h / 3 / PITCH) * PITCH);
  }
  function removeComponent(id) {
    if (!S.components.some(c => c.id === id)) return;
    S.components = S.components.filter(x => x.id !== id);
    S.connections = S.connections.filter(cn => !cn.a.startsWith(id + ':') && !cn.b.startsWith(id + ':'));
    Object.keys(S.netNames).forEach(k => { if (k.startsWith(id + ':')) delete S.netNames[k]; });
    if (ui.sel === id) ui.sel = null;
    if (ui.pending && ui.pending.startsWith(id + ':')) ui.pending = null;
    changed();
  }
  function rotateComponent(id) {
    const c = S.components.find(c => c.id === id);
    if (!c) return;
    c.rot = (c.rot + 1) & 3;
    changed();
  }

  // ---------------------------------------------------------------- ligações
  function connect(a, b) {
    if (a === b) return false;
    derive();
    const na = D.netOf.get(a), nb = D.netOf.get(b);
    if (na !== undefined && na === nb) { flash('Esses pinos já estão na mesma rede.'); return false; }
    S.connections.push({ a, b });
    changed();
    flash(`Ligado: ${D.pins.get(a).label} — ${D.pins.get(b).label}`);
    return true;
  }
  function clickPin(key, keep) {
    if (!ui.pending) ui.pending = key;
    else if (ui.pending === key) ui.pending = null;
    else {
      const ok = connect(ui.pending, key);
      ui.pending = ok && keep ? key : null;
    }
    render();
  }
  function changed() { save(); render(); }

  // ------------------------------------------------------------- roteamento
  function segmentsOf(R) {
    const segs = [];
    R.nets.forEach((n, ni) => n.routed && n.paths.forEach(p => {
      for (let k = 1; k < p.length; k++) {
        if (p[k].l !== p[k - 1].l) continue;
        if (p[k].x === p[k - 1].x && p[k].y === p[k - 1].y) continue;
        segs.push({ x1: p[k - 1].x, y1: p[k - 1].y, x2: p[k].x, y2: p[k].y, w: S.settings.trace, l: p[k].l, net: ni });
      }
    }));
    return segs;
  }

  async function runRouting() {
    derive();
    const nets = D.nets;
    if (!nets.some(n => n.groups.length > 1)) { ui.routeMsg = { bad: true, html: 'Não há ligações para rotear. Ligue os pinos no passo 2.' }; render(); return; }
    if (D.clash.size) {
      ui.routeMsg = { bad: true, html: 'Corrija antes de rotear:<ul>' + D.clashMsgs.slice(0, 6).map(m => `<li>${esc(m)}</li>`).join('') + '</ul>' };
      render(); return;
    }
    const st = S.settings;
    const pinList = [...D.pins.values()];
    const padIndex = new Map(pinList.map((p, i) => [p.key, i]));
    const pads = pinList.map(p => ({ x: p.x, y: p.y, w: p.w, h: p.h, shape: p.shape, comp: p.comp.id, net: D.netOf.has(p.key) ? D.netOf.get(p.key) : -1 }));
    const problem = {
      width: S.board.w, height: S.board.h, layers: st.layers, grid: GRID,
      trace: st.trace, clearance: st.clearance, via: via(), edge: 0.4, pads,
      nets: nets.map(n => ({ id: n.index, groups: n.groups.map(g => g.map(k => padIndex.get(k))) })),
    };
    const sig = signature();
    ui.routing = true; ui.progress = null; ui.routeMsg = null;
    render();
    const t0 = performance.now();
    let res;
    try {
      res = await window.PCBRouter.route(problem, { maxIter: 60 }, p => { ui.progress = p; renderRouteStatus(); });
    } catch (err) {
      ui.routing = false;
      ui.routeMsg = { bad: true, html: 'Erro no roteamento: ' + esc(err.message) };
      render(); return;
    }
    ui.routing = false;
    if (!res.ok) {
      const e = res.errors[0], p = pinList[e.pad];
      ui.routeMsg = { bad: true, html: e.type === 'edge' ? `O pino ${esc(p.label)} está fora da placa.` : `O cobre de ${esc(p.label)} encosta em ${esc(pinList[e.other].label)}.` };
      render(); return;
    }
    if (sig !== signature()) { ui.routeMsg = { bad: true, html: 'O projeto mudou durante o cálculo. Calcule de novo.' }; render(); return; }
    const L = st.layers;
    const R = {
      sig, layers: L, ms: Math.round(performance.now() - t0), iterations: res.iterations, blocked: res.blocked,
      nets: res.nets.map(n => ({
        routed: n.routed, length: n.length,
        // camada 0 = superior (vermelha), 1 = inferior (azul). Face simples usa só a inferior.
        paths: n.paths.map(p => p.map(q => ({ x: r3(q.x), y: r3(q.y), l: L === 1 ? 1 : q.l }))),
        vias: n.vias.map(v => ({ x: r3(v.x), y: r3(v.y) })),
      })),
    };
    // conferência independente das folgas reais
    const v = via();
    const drc = window.PCBRouter.drc({
      pads: pinList.map((p, i) => ({ ...pads[i], ref: p.label })),
      segs: segmentsOf(R),
      vias: R.nets.flatMap((n, ni) => n.vias.map(q => ({ x: q.x, y: q.y, d: v.d, net: ni }))),
      clearance: st.clearance, layers: L,
    });
    R.drc = { minGap: Number.isFinite(drc.minGap) ? drc.minGap : null, violations: drc.violations.length };
    S.route = R;
    save();
    render();
  }

  // ------------------------------------------------------------------ render
  function render() {
    const foco = focoAtual(); // a11y: a lista é refeita por innerHTML; o foco volta para o mesmo botão
    derive();
    if (S.route && !routeValid()) S.route = null;
    renderSteps();
    renderCompList();
    renderConnForm();
    renderNets();
    renderRoutePanel();
    renderBoard();
    renderStatus();
    renderA11y(foco); // a11y
  }

  function renderSteps() {
    $$('.steps button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.step === ui.step)));
    $$('.step').forEach(s => { s.hidden = s.dataset.step !== ui.step; });
    $('#board').classList.toggle('mode-conn', ui.step === 'conn');
    $('#board-w').value = S.board.w;
    $('#board-h').value = S.board.h;
    $('#snap').value = String(S.settings.snap);
  }

  function renderLibrary() {
    const q = $('#lib-search').value.trim();
    const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const items = LIB.filter(l => !q || norm(l.name + ' ' + l.hint + ' ' + l.group).includes(norm(q)));
    let html = '', group = '';
    for (const l of items) {
      if (l.group !== group) { group = l.group; html += `<div class="lib-group">${esc(group)}</div>`; }
      const param = l.param
        ? `<select data-param="${l.id}" aria-label="${esc(l.param.label)}" title="${esc(l.param.label)}">${l.param.options.map(o => `<option value="${o}"${o === l.param.def ? ' selected' : ''}>${String(o).replace('.', ',')}</option>`).join('')}</select>`
        : '<span></span>';
      html += `<div class="lib-item" title="${esc(l.src || '')}"><div><b>${esc(l.name)}</b><small>${esc(l.hint)}</small></div>${param}<button type="button" data-add="${l.id}" title="Adicionar à placa" aria-label="Adicionar ${esc(l.name)} à placa">+</button></div>`;
    }
    $('#lib-list').innerHTML = html || '<p class="empty">Nada encontrado.</p>';
  }

  function renderCompList() {
    $('#comp-count').textContent = S.components.length ? `· ${S.components.length}` : '';
    if (!S.components.length) {
      $('#comp-list').innerHTML = '<p class="empty">Nenhum componente ainda. Use o “+” na biblioteca, ou carregue o exemplo.</p>';
      $('#comp-info').hidden = true;
      return;
    }
    if (!($('#comp-list').contains(document.activeElement) && document.activeElement.tagName === 'INPUT')) {
      $('#comp-list').innerHTML = S.components.map(c => {
        const def = LIBMAP[c.type];
        const nm = def.name + (c.param !== undefined ? ` · ${String(c.param).replace('.', ',')}` : '');
        return `<div class="comp-row${ui.sel === c.id ? ' sel' : ''}${D.clash.has(c.id) ? ' clash' : ''}" data-row="${c.id}">
          <span class="ref">${esc(c.ref)}</span>
          <span class="nm" title="${esc(nm)}">${esc(nm)}</span>
          <input type="text" data-value="${c.id}" value="${esc(c.value || '')}" placeholder="valor" aria-label="Valor de ${esc(c.ref)}">
          <button type="button" class="mini" data-rot="${c.id}" title="Girar 90° (R)" aria-label="Girar ${esc(c.ref)} 90°">⟳</button>
          <button type="button" class="mini del" data-del="${c.id}" title="Remover (Del)" aria-label="Remover ${esc(c.ref)}">×</button>
        </div>`;
      }).join('');
    }
    // ficha do componente selecionado: pinos, pads e furos reais
    const c = S.components.find(c => c.id === ui.sel);
    const info = $('#comp-info');
    if (!c) { info.hidden = true; return; }
    const def = LIBMAP[c.type];
    info.hidden = false;
    info.innerHTML = `<h3>${esc(c.ref)} — ${esc(def.name)}</h3>
      <p class="src">${esc(def.src || '')}${def.namedPins ? ' · Dê um nome a cada pino (ex.: GND, SDA) para identificar a ligação.' : ''}</p>
      <table><thead><tr><th>Pino</th><th>Nome</th><th>Pad (mm)</th><th>Furo</th><th>Posição x ; y (mm)</th></tr></thead><tbody>
      ${pinsOf(c).map(p => `<tr><td>${esc(p.num)}</td><td>${def.namedPins ? `<input type="text" class="pin-name" data-pinname="${c.id}:${p.idx}" value="${esc(p.name || '')}" placeholder="—" maxlength="8" aria-label="Nome do pino ${esc(p.num)}">` : esc(p.name || '—')}</td><td>${p.shape === 'circle' ? 'Ø ' + fmt(p.w) : fmt(p.w) + ' × ' + fmt(p.h) + (p.shape === 'rect' ? ' ▢' : ' ⬭')}</td><td>Ø ${fmt(p.drill)}</td><td>${fmt(p.x)} ; ${fmt(p.y)}</td></tr>`).join('')}
      </tbody></table>`;
  }

  function renderConnForm() {
    const opts = S.components.map(c =>
      `<optgroup label="${esc(c.ref)} — ${esc(LIBMAP[c.type].name)}">` +
      pinsOf(c).map(p => `<option value="${p.key}">${esc(p.label)}${p.name ? ` (pino ${esc(p.num)})` : ''}</option>`).join('') + '</optgroup>'
    ).join('');
    for (const id of ['#conn-a', '#conn-b']) {
      const sel = $(id), v = sel.value;
      sel.innerHTML = `<option value="">— pino —</option>${opts}`;
      if (D.pins.has(v)) sel.value = v;
    }
    ui.formPins = [$('#conn-a').value, $('#conn-b').value].filter(Boolean);
    const pend = $('#pending');
    if (ui.pending && D.pins.has(ui.pending)) {
      pend.hidden = false;
      pend.innerHTML = `<span>Selecionado: <b>${esc(D.pins.get(ui.pending).label)}</b> — clique no próximo pino</span><button type="button" class="mini" id="pending-cancel">Cancelar</button>`;
    } else pend.hidden = true;
  }

  function renderNets() {
    const nets = D.nets;
    $('#net-count').textContent = nets.length ? `· ${nets.length}` : '';
    if ($('#net-list').contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    if (!nets.length) { $('#net-list').innerHTML = '<p class="empty">Nenhuma ligação ainda.</p>'; return; }
    const R = routeValid() ? S.route : null;
    $('#net-list').innerHTML = nets.map(n => {
      let state = '';
      if (R) {
        const rn = R.nets[n.index];
        state = n.groups.length < 2 ? '<span class="net-state">interna</span>'
          : rn && rn.routed ? `<span class="net-state good">✓ ${fmt(rn.length, 0)} mm</span>` : '<span class="net-state bad">sem rota</span>';
      }
      const chips = n.conns.map(ci => {
        const cn = S.connections[ci];
        return `<span class="conn-chip">${esc(D.pins.get(cn.a).label)} — ${esc(D.pins.get(cn.b).label)}<button type="button" data-delconn="${ci}" title="Desfazer ligação" aria-label="Desfazer ligação ${esc(D.pins.get(cn.a).label)} — ${esc(D.pins.get(cn.b).label)}">×</button></span>`;
      }).join('');
      return `<div class="net" data-net="${n.index}">
        <div class="net-head"><i class="dot" style="background:${n.color}"></i>
          <input type="text" data-netname="${n.index}" value="${esc(n.name)}" aria-label="Nome da rede" title="Renomeie (ex.: GND, VCC)">${state}</div>
        <div class="net-conns">${chips}</div></div>`;
    }).join('');
  }

  function renderRoutePanel() {
    const st = S.settings;
    $$('.seg button').forEach(b => b.classList.toggle('on', +b.dataset.layers === st.layers));
    $('#layer-hint').textContent = st.layers === 1
      ? 'Face simples: todas as trilhas no lado da solda (inferior), sem nenhum cruzamento.'
      : 'Dupla face: trilhas em cima e embaixo; onde precisam se cruzar, trocam de lado por uma via.';
    $('#trace-w').value = String(st.trace);
    $('#clearance-sel').value = String(st.clearance);
    $('#ring').value = String(st.ring);
    $('#via-sel').value = st.via;
    $('#via-row').hidden = st.layers === 1;
    // cabe uma trilha entre dois pinos de CI (2,54 mm, pad Ø 1,6)?
    const between = PITCH - (1.6 + st.ring) - 2 * st.clearance;
    const fits = between >= st.trace - 1e-9;
    $('#clearance').classList.toggle('warn', !fits);
    $('#clearance').innerHTML = fits
      ? `Cabe trilha entre dois pinos de CI (2,54 mm): espaço livre ${fmt(between)} mm ≥ trilha ${fmt(st.trace)} mm.`
      : `Não passa trilha entre pinos de CI vizinhos (espaço livre ${fmt(Math.max(0, between))} mm &lt; trilha ${fmt(st.trace)} mm) — as trilhas vão contornar. Placa mais fácil de fazer, mas precisa de mais espaço.`;
    $('#export-top').hidden = st.layers === 1;

    const btn = $('#btn-route');
    btn.disabled = ui.routing;
    btn.textContent = ui.routing ? 'Calculando…' : routeValid() ? 'Recalcular trilhas' : 'Calcular trilhas';
    renderRouteStatus();

    const out = $('#route-result');
    const R = routeValid() ? S.route : null;
    let html = '';
    if (R) {
      const need = D.nets.filter(n => n.groups.length > 1);
      const ok = need.filter(n => R.nets[n.index] && R.nets[n.index].routed);
      const len = R.nets.reduce((a, n) => a + (n.routed ? n.length : 0), 0);
      const vias = R.nets.reduce((a, n) => a + n.vias.length, 0);
      html += `<div class="stats">
        <div class="stat"><b>${ok.length}/${need.length}</b><span>redes roteadas</span></div>
        <div class="stat"><b>${fmt(len, 0)}</b><span>mm de trilha</span></div>
        <div class="stat"><b>${R.layers === 2 ? vias : '—'}</b><span>${R.layers === 2 ? 'vias' : 'face simples'}</span></div>
      </div>`;
      const fail = need.filter(n => !(R.nets[n.index] && R.nets[n.index].routed));
      if (!fail.length) {
        html += `<p class="result-msg good">Pronto: nenhuma trilha se cruza. (${R.iterations} ${R.iterations === 1 ? 'passada' : 'passadas'}, ${R.ms} ms)</p>`;
      } else {
        const blocked = new Set(R.blocked || []);
        html += `<div class="result-msg bad">Não foi possível rotear sem cruzar:<ul>${fail.map(n =>
          `<li><b>${esc(n.name)}</b> — ${blocked.has(n.index) ? 'caminho fechado por pinos de outros componentes' : 'não coube sem encostar em outra trilha'}</li>`).join('')}</ul>
          <p style="margin:6px 0 0">${R.layers === 1 ? 'Tente <b>2 camadas</b>, aumente a placa, gire ou afaste componentes. Numa face simples também dá para ligar o que faltou com um fio (jumper).' : 'Aumente a placa, afaste os componentes, afine a trilha ou reduza a folga.'}</p></div>`;
      }
      if (R.drc) {
        const okDrc = R.drc.violations === 0;
        html += `<p class="result-msg ${okDrc ? 'good' : 'bad'}">Conferência de folgas (DRC): ${R.drc.minGap === null ? 'nada para medir' : `menor folga medida entre cobres de redes diferentes <b>${fmt(R.drc.minGap, 3)} mm</b>`} ${okDrc ? `≥ ${fmt(st.clearance)} mm ✓` : `— ${R.drc.violations} ponto(s) abaixo de ${fmt(st.clearance)} mm`}</p>`;
      }
    } else if (ui.routeMsg) {
      html = `<div class="result-msg ${ui.routeMsg.bad ? 'bad' : 'good'}">${ui.routeMsg.html}</div>`;
    }
    out.innerHTML = html;
  }

  function renderRouteStatus() {
    const el = $('#route-status');
    if (ui.routing) {
      const p = ui.progress;
      const pct = p ? Math.min(100, Math.round(100 * p.iteration / p.maxIter)) : 3;
      el.innerHTML = p
        ? `Passada ${p.iteration} · ${p.conflicts} ${p.conflicts === 1 ? 'ponto de conflito' : 'pontos de conflito'}<div class="progress"><i style="width:${pct}%"></i></div>`
        : 'Preparando…<div class="progress"><i style="width:3%"></i></div>';
    } else el.innerHTML = '';
  }

  // --------------------------------------------------------------- desenho
  function traceRuns(path) {
    const runs = [];
    let run = [path[0]];
    for (let i = 1; i < path.length; i++) {
      if (path[i].l !== path[i - 1].l) { if (run.length > 1) runs.push(run); run = [path[i]]; }
      else run.push(path[i]);
    }
    if (run.length > 1) runs.push(run);
    return runs.map(r => r.filter((p, i) => {
      if (i === 0 || i === r.length - 1) return true;
      const a = r[i - 1], b = r[i + 1];
      const cross = (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x);
      return Math.abs(cross) > 1e-6;
    }));
  }
  const pts = run => run.map(p => `${r3(p.x)},${r3(p.y)}`).join(' ');

  function ratsLines(n) {
    const G = n.groups.map(g => g.map(k => D.pins.get(k)));
    if (G.length < 2) return [];
    const inT = [0], out = G.map((_, i) => i).slice(1), lines = [];
    while (out.length) {
      let best = null;
      for (const ti of inT) for (const oi of out) for (const a of G[ti]) for (const b of G[oi]) {
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (!best || d < best.d) best = { d, a, b, oi };
      }
      lines.push([best.a, best.b]);
      inT.push(best.oi); out.splice(out.indexOf(best.oi), 1);
    }
    return lines;
  }

  function silkShapes(fp) {
    return fp.body.map(s => {
      switch (s.t) {
        case 'rect': return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.r || 0}"/>`;
        case 'circle': return `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}"/>`;
        case 'line': return `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}"/>`;
        default: return `<path d="${s.d}"/>`;
      }
    }).join('');
  }

  // pad com forma real; ox/oy = origem do grupo
  function padShape(p, ox, oy, attrs, grow = 0) {
    const w = p.w + grow, h = p.h + grow;
    const x = r3(p.x - ox - w / 2), y = r3(p.y - oy - h / 2);
    const rx = p.shape === 'rect' ? 0 : r3(Math.min(w, h) / 2);
    return `<rect ${attrs} x="${x}" y="${y}" width="${r3(w)}" height="${r3(h)}" rx="${rx}"/>`;
  }

  // Serigrafia (contornos + referências), recortada 0,2 mm em volta de cada pad
  // para não cair tinta onde vai solda.
  let maskSeq = 0;
  function refPos(c) {
    const bx = boxOf(c);
    let top = bx.y0;
    for (const p of pinsOf(c)) {
      if (p.dir[1] >= 0) continue;
      const L = labelSpec(p);
      top = Math.min(top, L.vert ? L.y - p.short.length * 0.62 - 0.3 : p.y - p.h / 2 - 1.4);
    }
    return { x: r3((bx.x0 + bx.x1) / 2), y: r3(top - 0.5) };
  }
  function silkLayer(shapeAttrs, textAttrs, pinAttrs = null) {
    const id = 'silkmask' + (++maskSeq);
    const { w, h } = S.board;
    let m = `<mask id="${id}" maskUnits="userSpaceOnUse" x="-20" y="-20" width="${w + 40}" height="${h + 40}"><rect x="-20" y="-20" width="${w + 40}" height="${h + 40}" fill="#fff"/>`;
    for (const p of D.pins.values()) m += padShape(p, 0, 0, 'fill="#000"', 0.4);
    m += '</mask>';
    let g = '';
    for (const c of S.components) {
      const rp = refPos(c);
      g += `<g transform="translate(${c.x} ${c.y}) rotate(${c.rot * 90})" ${shapeAttrs}>${silkShapes(footprint(c))}</g>`;
      g += `<text ${textAttrs} x="${rp.x}" y="${rp.y}" text-anchor="middle">${esc(c.ref + (c.value ? ' ' + c.value : ''))}</text>`;
    }
    if (pinAttrs) for (const p of D.pins.values()) g += pinLabel(p, pinAttrs);
    return `<defs>${m}</defs><g class="silk-layer" mask="url(#${id})">${g}</g>`;
  }

  // Posição do nome do pino, para fora do componente. Em fileira de pinos
  // lado a lado, nome com mais de 2 letras é escrito na vertical.
  function labelSpec(p, gap = 0.35) {
    const [dx, dy] = p.dir;
    const off = (dx ? p.w : p.h) / 2 + gap;
    const x = r3(p.x + dx * off), y = r3(p.y + dy * off);
    if (dy && p.crowded && p.short.length > 2) {
      // vertical, lendo de baixo para cima; começa na borda do pad
      return { text: p.short, x, y, vert: true, anchor: dy < 0 ? 'start' : 'end', base: 'central' };
    }
    return {
      text: p.short, x, y, vert: false,
      anchor: dx > 0 ? 'start' : dx < 0 ? 'end' : 'middle',
      base: dy > 0 ? 'hanging' : dy < 0 ? 'alphabetic' : 'central',
    };
  }

  function pinLabel(p, attrs) {
    const L = labelSpec(p);
    const rotAttr = L.vert ? ` transform="rotate(-90 ${L.x} ${L.y})"` : '';
    const base = L.base === 'alphabetic' ? 'auto' : L.base;
    return `<text ${attrs} x="${L.x}" y="${L.y}"${rotAttr} text-anchor="${L.anchor}" dominant-baseline="${base}">${esc(L.text)}</text>`;
  }

  function renderBoard() {
    const svg = $('#board');
    const { w, h } = S.board;
    const R = routeValid() ? S.route : null;
    const tw = S.settings.trace;
    const hl = ui.hoverNet;
    const v = via();
    let s = `<defs><pattern id="gridp" width="${PITCH}" height="${PITCH}" patternUnits="userSpaceOnUse">
      <circle cx="0" cy="0" r=".12" class="b-grid"/><circle cx="${PITCH}" cy="0" r=".12" class="b-grid"/>
      <circle cx="0" cy="${PITCH}" r=".12" class="b-grid"/><circle cx="${PITCH}" cy="${PITCH}" r=".12" class="b-grid"/></pattern></defs>`;
    s += `<g class="${hl !== null ? 'hl-dim' : ''}">`;
    s += `<rect class="b-board" x="0" y="0" width="${w}" height="${h}"/>`;
    s += `<rect x="0" y="0" width="${w}" height="${h}" fill="url(#gridp)"/>`;

    if (R) {
      const under = R.layers === 2 && ui.show.top ? ' layer-bottom-under' : '';
      for (const layer of [1, 0]) {
        if ((layer === 1 && !ui.show.bottom) || (layer === 0 && !ui.show.top)) continue;
        s += `<g class="traces${under}">`;
        R.nets.forEach((n, ni) => {
          if (!n.routed) return;
          for (const p of n.paths) for (const run of traceRuns(p)) {
            if (run[0].l !== layer) continue;
            s += `<polyline class="tr l${layer}${hl === ni ? ' hl' : ''}" stroke-width="${tw}" points="${pts(run)}"/>`;
          }
        });
        s += '</g>';
      }
      if (R.layers === 2 && (ui.show.top || ui.show.bottom)) {
        R.nets.forEach(n => n.vias.forEach(q => {
          s += `<circle class="via" cx="${q.x}" cy="${q.y}" r="${v.d / 2}"/><circle class="hole" cx="${q.x}" cy="${q.y}" r="${v.drill / 2}"/>`;
        }));
      }
    }

    const labels = [];
    for (const c of S.components) {
      const fp = footprint(c);
      const cls = ['comp', ui.sel === c.id ? 'sel' : '', D.clash.has(c.id) ? 'clash' : ''].join(' ');
      const b = fp.bbox;
      s += `<g class="${cls}" data-comp="${c.id}" transform="translate(${c.x} ${c.y})">`;
      s += `<g transform="rotate(${c.rot * 90})"><rect class="comp-hit" x="${r3(b.x0)}" y="${r3(b.y0)}" width="${r3(b.x1 - b.x0)}" height="${r3(b.y1 - b.y0)}" rx=".4"/>`;
      s += '</g>';
      for (const p of pinsOf(c)) {
        s += padShape(p, c.x, c.y, 'class="pad"');
        s += `<circle class="hole" cx="${r3(p.x - c.x)}" cy="${r3(p.y - c.y)}" r="${p.drill / 2}"/>`;
        if (ui.step === 'conn' && D.netOf.has(p.key)) {
          s += padShape(p, c.x, c.y, `class="pin-netmark" stroke="${D.nets[D.netOf.get(p.key)].color}"`, 0.55);
        }
        s += `<circle class="pin-hit" data-pin="${p.key}" cx="${r3(p.x - c.x)}" cy="${r3(p.y - c.y)}" r="${r3(Math.max(Math.min(p.w, p.h) / 2 + 0.15, 0.9))}"><title>${esc(c.ref)} · pino ${esc(p.num)}${p.name ? ' (' + esc(p.name) + ')' : ''}</title></circle>`;
        if (ui.show.pins) labels.push(pinLabel(p, 'class="pin-label"'));
      }
      s += '</g>';
    }
    if (ui.show.silk) s += silkLayer('class="silk"', 'class="ref"');
    s += labels.join('');

    if (ui.show.rats) {
      D.nets.forEach(n => {
        if (R && R.nets[n.index] && R.nets[n.index].routed) return;
        for (const [a, b] of ratsLines(n)) {
          s += `<line class="rats${hl === n.index ? ' hl' : ''}" stroke="${n.color}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
        }
      });
    }
    const rings = [ui.pending, ...(ui.step === 'conn' ? ui.formPins : [])].filter(k => k && D.pins.has(k));
    for (const k of rings) s += padShape(D.pins.get(k), 0, 0, 'class="pin-pending"', 1.1);
    s += '</g>';
    svg.innerHTML = s;
    if (!ui.view) fitView();
    applyView();
  }

  function renderStatus() {
    const hints = {
      comp: 'Arraste os componentes para posicioná-los. Clique num componente para ver pinos, pads e furos.',
      conn: 'Clique em dois pinos para ligá-los. Shift+clique continua a partir do último pino. Esc cancela.',
      route: 'Escolha 1 ou 2 camadas e calcule. Passe o mouse sobre uma rede (passo 2) para destacá-la.',
    };
    if (!flashTimer) $('#status-hint').textContent = hints[ui.step];
  }
  let flashTimer = null;
  function flash(msg) {
    $('#status-hint').textContent = msg;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flashTimer = null; renderStatus(); }, 2800);
  }

  // ------------------------------------------------------------------- vista
  function fitView() {
    const m = 6, { w, h } = S.board;
    ui.view = { x: -m, y: -m, w: w + 2 * m, h: h + 2 * m };
  }
  function applyView() {
    const v = ui.view;
    $('#board').setAttribute('viewBox', `${r3(v.x)} ${r3(v.y)} ${r3(v.w)} ${r3(v.h)}`);
  }
  function svgPoint(e) {
    const svg = $('#board');
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }
  function zoomAt(f, cx, cy) {
    const v = ui.view;
    const nw = Math.min(Math.max(v.w * f, 6), 800);
    f = nw / v.w;
    v.x = cx - (cx - v.x) * f; v.y = cy - (cy - v.y) * f;
    v.w *= f; v.h *= f;
    applyView();
  }
  function zoomCenter(f) { const v = ui.view; zoomAt(f, v.x + v.w / 2, v.y + v.h / 2); }

  // ---------------------------------------------------------------- eventos
  function bindBoard() {
    const svg = $('#board');
    svg.addEventListener('pointerdown', e => {
      const pinEl = e.target.closest('[data-pin]');
      const compEl = e.target.closest('[data-comp]');
      if (e.button === 0 && ui.step === 'conn' && pinEl) { clickPin(pinEl.dataset.pin, e.shiftKey); return; }
      if (e.button === 0 && ui.step !== 'conn' && compEl) {
        const c = S.components.find(c => c.id === compEl.dataset.comp);
        const p = svgPoint(e);
        ui.sel = c.id;
        ui.drag = { id: c.id, sx: p.x, sy: p.y, ox: c.x, oy: c.y, moved: false };
        svg.setPointerCapture(e.pointerId);
        render();
        return;
      }
      if (e.button === 0 || e.button === 1) {
        if (ui.step === 'comp' && ui.sel) { ui.sel = null; render(); }
        ui.pan = { cx: e.clientX, cy: e.clientY, vx: ui.view.x, vy: ui.view.y };
        svg.classList.add('panning');
        svg.setPointerCapture(e.pointerId);
        e.preventDefault();
      }
    });
    svg.addEventListener('pointermove', e => {
      const p = svgPoint(e);
      const pinEl = e.target.closest && e.target.closest('[data-pin]');
      if (pinEl && D.pins.has(pinEl.dataset.pin)) {
        const q = D.pins.get(pinEl.dataset.pin);
        $('#status-pos').textContent = `${q.label} · pino ${q.num} · x ${fmt(q.x)} · y ${fmt(q.y)} mm`;
      } else {
        $('#status-pos').textContent = p.x >= 0 && p.y >= 0 && p.x <= S.board.w && p.y <= S.board.h ? `x ${fmt(p.x)} · y ${fmt(p.y)} mm` : '';
      }
      if (ui.drag) {
        const c = S.components.find(c => c.id === ui.drag.id);
        const sn = S.settings.snap;
        const nx = r3(Math.round((ui.drag.ox + p.x - ui.drag.sx) / sn) * sn);
        const ny = r3(Math.round((ui.drag.oy + p.y - ui.drag.sy) / sn) * sn);
        if (c && (nx !== c.x || ny !== c.y)) {
          c.x = nx; c.y = ny; ui.drag.moved = true;
          derive();
          renderBoard();
        }
      } else if (ui.pan) {
        const v = ui.view;
        const k = Math.max(v.w / svg.clientWidth, v.h / svg.clientHeight);
        v.x = ui.pan.vx - (e.clientX - ui.pan.cx) * k;
        v.y = ui.pan.vy - (e.clientY - ui.pan.cy) * k;
        applyView();
      }
    });
    const end = () => {
      if (ui.drag && ui.drag.moved) changed();
      ui.drag = null; ui.pan = null;
      svg.classList.remove('panning');
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('wheel', e => {
      e.preventDefault();
      const p = svgPoint(e);
      zoomAt(e.deltaY > 0 ? 1.15 : 1 / 1.15, p.x, p.y);
    }, { passive: false });
    svg.addEventListener('pointerleave', () => { $('#status-pos').textContent = ''; });
  }

  function bindPanel() {
    $$('.steps button').forEach(b => b.addEventListener('click', () => {
      ui.step = b.dataset.step;
      ui.pending = null;
      render();
    }));

    const setBoard = () => {
      const w = Math.min(300, Math.max(20, +$('#board-w').value || S.board.w));
      const h = Math.min(300, Math.max(20, +$('#board-h').value || S.board.h));
      S.board = { w, h };
      fitView();
      changed();
    };
    $('#board-w').addEventListener('change', setBoard);
    $('#board-h').addEventListener('change', setBoard);
    $('#snap').addEventListener('change', e => { S.settings.snap = +e.target.value; save(); });

    $('#lib-search').addEventListener('input', renderLibrary);
    $('#lib-list').addEventListener('click', e => {
      const b = e.target.closest('[data-add]');
      if (!b) return;
      const sel = $(`[data-param="${b.dataset.add}"]`);
      addComponent(b.dataset.add, sel ? +sel.value : undefined);
    });

    $('#comp-list').addEventListener('click', e => {
      const del = e.target.closest('[data-del]'), r = e.target.closest('[data-rot]'), row = e.target.closest('[data-row]');
      if (del) return removeComponent(del.dataset.del);
      if (r) { ui.sel = r.dataset.rot; return rotateComponent(r.dataset.rot); }
      if (row && e.target.tagName !== 'INPUT') { ui.sel = row.dataset.row; render(); }
    });
    $('#comp-info').addEventListener('change', e => {
      const k = e.target.dataset.pinname;
      if (!k) return;
      const [id, idx] = k.split(':');
      const c = S.components.find(c => c.id === id);
      if (!c) return;
      c.pinNames = c.pinNames || [];
      c.pinNames[+idx] = e.target.value.trim().slice(0, 8);
      changed();
    });
    $('#comp-list').addEventListener('input', e => {
      const id = e.target.dataset.value;
      const c = id && S.components.find(c => c.id === id);
      if (c) { c.value = e.target.value.slice(0, 16); save(); renderBoard(); }
    });

    const formChange = () => { ui.formPins = [$('#conn-a').value, $('#conn-b').value].filter(Boolean); renderBoard(); };
    $('#conn-a').addEventListener('change', formChange);
    $('#conn-b').addEventListener('change', formChange);
    $('#conn-add').addEventListener('click', () => {
      const a = $('#conn-a').value, b = $('#conn-b').value;
      if (!a || !b) return flash('Escolha os dois pinos.');
      if (a === b) return flash('Escolha dois pinos diferentes.');
      if (connect(a, b)) $('#conn-b').value = '';
      render();
    });
    $('#pending').addEventListener('click', e => { if (e.target.id === 'pending-cancel') { ui.pending = null; render(); } });

    $('#net-list').addEventListener('click', e => {
      const d = e.target.closest('[data-delconn]');
      if (!d) return;
      S.connections.splice(+d.dataset.delconn, 1);
      ui.hoverNet = null;
      changed();
    });
    $('#net-list').addEventListener('change', e => {
      const i = e.target.dataset.netname;
      if (i === undefined) return;
      const n = D.nets[+i];
      n.keys.forEach(k => delete S.netNames[k]);
      const v = e.target.value.trim().slice(0, 20);
      if (v && v !== `N${n.index + 1}`) S.netNames[n.keys[0]] = v;
      e.target.blur();
      changed();
    });
    $('#net-list').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.netname !== undefined) e.target.blur(); });
    $('#net-list').addEventListener('mouseover', e => {
      const n = e.target.closest('[data-net]');
      const v = n ? +n.dataset.net : null;
      if (v !== ui.hoverNet) { ui.hoverNet = v; renderBoard(); }
    });
    $('#net-list').addEventListener('mouseleave', () => { ui.hoverNet = null; renderBoard(); });

    $$('.seg button').forEach(b => b.addEventListener('click', () => { S.settings.layers = +b.dataset.layers; ui.routeMsg = null; changed(); }));
    $('#trace-w').addEventListener('change', e => { S.settings.trace = +e.target.value; changed(); });
    $('#clearance-sel').addEventListener('change', e => { S.settings.clearance = +e.target.value; changed(); });
    $('#ring').addEventListener('change', e => { S.settings.ring = +e.target.value; changed(); });
    $('#via-sel').addEventListener('change', e => { S.settings.via = e.target.value; changed(); });
    $('#btn-route').addEventListener('click', runRouting);

    $$('[data-show]').forEach(b => b.addEventListener('click', () => {
      ui.show[b.dataset.show] = !ui.show[b.dataset.show];
      b.classList.toggle('on', ui.show[b.dataset.show]);
      renderBoard();
    }));
    $('#zoom-in').addEventListener('click', () => zoomCenter(1 / 1.3));
    $('#zoom-out').addEventListener('click', () => zoomCenter(1.3));
    $('#zoom-fit').addEventListener('click', () => { fitView(); applyView(); });

    $$('[data-export]').forEach(b => b.addEventListener('click', () => exportLayer(b.dataset.export)));
    $('#btn-pdf').addEventListener('click', exportPDF);
    $('#btn-pdf-asm').addEventListener('click', exportAssemblyPDF);
    $('#btn-gerber').addEventListener('click', exportGerber);

    $('#btn-new').addEventListener('click', () => {
      if (S.components.length && !confirm('Começar um projeto novo? O atual será apagado deste navegador (salve antes se quiser guardar).')) return;
      S = blank(); ui.sel = null; ui.pending = null; ui.routeMsg = null; ui.step = 'comp'; fitView(); changed();
    });
    $('#example-sel').addEventListener('change', e => {
      const ex = window.PCB_EXAMPLES[e.target.value];
      e.target.value = '';
      if (!ex) return;
      if (S.components.length && !confirm(`Substituir o projeto atual pelo exemplo “${ex.title}”?`)) return;
      S = ex.build(blank); ui.sel = null; ui.pending = null; ui.routeMsg = null; fitView(); changed();
      flash(`Exemplo carregado: ${ex.title}. Vá ao passo 3 e calcule as trilhas.`);
    });
    $('#btn-save').addEventListener('click', () => download('placa-prototipada.json', JSON.stringify(S, null, 1), 'application/json'));
    $('#btn-open').addEventListener('click', () => $('#file-open').click());
    $('#file-open').addEventListener('change', async e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        S = sanitize(JSON.parse(await f.text()));
        ui.sel = null; ui.pending = null; ui.routeMsg = null; fitView(); changed();
        flash(`Projeto “${f.name}” aberto.`);
      } catch (err) { alert('Não foi possível abrir o arquivo: ' + err.message); }
    });

    document.addEventListener('keydown', e => {
      if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
      if (e.key === 'Escape') { ui.pending = null; render(); }
      if (!ui.sel || ui.step === 'conn') return;
      if (e.key === 'r' || e.key === 'R') rotateComponent(ui.sel);
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeComponent(ui.sel); }
    });
  }

  // ---------------------------------------------------------------- exportar
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Desenho independente de CSS, em mm reais (1 unidade = 1 mm).
  function layerSVG(kind, { mirror = false, negative = false } = {}) {
    derive();
    const { w, h } = S.board;
    const R = routeValid() ? S.route : null;
    const tw = S.settings.trace, v = via();
    const colored = kind === 'view';
    const ink = negative ? '#fff' : '#000', paper = negative ? '#000' : '#fff';
    const allPins = [...D.pins.values()];
    const circle = (x, y, r, fill) => `<circle cx="${r3(x)}" cy="${r3(y)}" r="${r3(r)}" fill="${fill}"/>`;
    let body = '';

    if (colored) body += `<rect x="0" y="0" width="${w}" height="${h}" fill="#1d5b3e"/>`;

    const copper = layer => {
      let s = '';
      if (R) R.nets.forEach(n => n.routed && n.paths.forEach(p => traceRuns(p).forEach(run => {
        if (layer !== null && run[0].l !== layer) return;
        const col = colored ? (run[0].l === 0 ? '#e0564a' : '#4f9be0') : ink;
        s += `<polyline points="${pts(run)}" fill="none" stroke="${col}" stroke-width="${tw}" stroke-linecap="round" stroke-linejoin="round"${colored && run[0].l === 1 && R.layers === 2 ? ' opacity=".6"' : ''}/>`;
      })));
      const pc = colored ? '#d9b35c' : ink, hc = colored ? '#10261b' : paper;
      // furo desenhado em tamanho real: serve de guia de centro para a broca
      const hole = d => (colored ? d : Math.min(DRILL_GUIDE, d)) / 2; // fabricação: ponto-guia da broca
      allPins.forEach(p => { s += padShape(p, 0, 0, `fill="${pc}"`) + circle(p.x, p.y, hole(p.drill), hc); });
      if (R && R.layers === 2) R.nets.forEach(n => n.vias.forEach(q => { s += circle(q.x, q.y, v.d / 2, colored ? '#c9c3b0' : ink) + circle(q.x, q.y, hole(v.drill), hc); }));
      return s;
    };
    const silk = (col, pins) => silkLayer(
      `fill="none" stroke="${col}" stroke-width="0.15" stroke-linecap="round"`,
      `font-family="Arial, sans-serif" font-weight="700" font-size="1.5" fill="${col}"`,
      pins ? `font-family="Arial, sans-serif" font-weight="700" font-size="0.9" fill="${col}"` : null);
    const pinNames = col => allPins.map(p => pinLabel(p, `font-family="Arial, sans-serif" font-size="0.9" fill="${col}"`)).join('');

    if (kind === 'bottom') body += copper(1);
    else if (kind === 'top') body += copper(0);
    else if (kind === 'silk') {
      body += silk(ink, $('#export-pins').checked);
    } else if (kind === 'drill') {
      allPins.forEach(p => { body += circle(p.x, p.y, p.drill / 2, ink); });
      if (R && R.layers === 2) R.nets.forEach(n => n.vias.forEach(q => { body += circle(q.x, q.y, v.drill / 2, ink); }));
    } else {
      body += copper(null) + silk('#f4f1e8', false);
      if (ui.show.pins) body += pinNames('#ffe27a');
    }
    // contorno da placa (linha de corte)
    body += `<rect x="0.075" y="0.075" width="${w - 0.15}" height="${h - 0.15}" fill="none" stroke="${colored ? '#0f3a26' : ink}" stroke-width="0.15"/>`;
    if (mirror) body = `<g transform="translate(${w} 0) scale(-1 1)">${body}</g>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">${colored ? '' : `<rect width="${w}" height="${h}" fill="${paper}"/>`}${body}</svg>`;
  }

  // Espelhar ou não depende de como a imagem vai para a placa:
  //  view   — tudo visto por cima, como na tela
  //  toner  — transferência térmica: o papel vai virado sobre o cobre
  //  screen — serigrafia/fotolito: imagem como fica vista de frente para a face
  function mirrorFor(kind, proc) {
    if (proc === 'toner') return kind === 'top' || kind === 'silk';
    if (proc === 'screen') return kind === 'bottom';
    return false;
  }
  const PROC_NAME = { view: 'vista por cima', toner: 'transferência térmica', screen: 'serigrafia / fotolito' };
  function orientationText(kind, mirrored) {
    if (kind === 'drill') return 'vista pelo lado dos componentes';
    if (kind === 'bottom') return mirrored ? 'vista de frente para o lado da solda (espelhada em relação à tela)' : 'vista por cima, através da placa (como na tela)';
    return mirrored ? 'espelhada (lado dos componentes)' : 'vista de frente para o lado dos componentes (como na tela)';
  }

  function exportLayer(kind) {
    if ((kind === 'bottom' || kind === 'top') && !routeValid()) { flash('Calcule as trilhas antes de exportar o cobre.'); return; }
    const mirror = kind !== 'view' && mirrorFor(kind, $('#export-proc').value), negative = $('#export-neg').checked && kind !== 'view';
    const names = { bottom: 'cobre-inferior', top: 'cobre-superior', silk: 'serigrafia', drill: 'furacao', view: 'vista' };
    download(`placa-${names[kind]}${mirror ? '-espelhada' : ''}${negative ? '-negativo' : ''}.svg`, layerSVG(kind, { mirror, negative }), 'image/svg+xml');
  }

  // ------------------------------------------------------------ PDF 1:1
  // Desenha uma camada na página; a origem já está no canto da placa.
  function drawLayerPDF(pg, kind, { mirror, negative, pinNames }) {
    const { w, h } = S.board;
    const R = routeValid() ? S.route : null;
    const tw = S.settings.trace, v = via();
    const ink = negative ? '#ffffff' : '#000000', paper = negative ? '#000000' : '#ffffff';
    const pins = [...D.pins.values()];
    const pad = (p, grow, col) => {
      const pw = p.w + grow, ph = p.h + grow;
      pg.fillRRect(p.x - pw / 2, p.y - ph / 2, pw, ph, p.shape === 'rect' ? 0 : Math.min(pw, ph) / 2, col);
    };
    pg.save();
    if (mirror) pg.transform(-1, 0, 0, 1, w, 0);
    if (negative) pg.fillRect(0, 0, w, h, paper);

    if (kind === 'bottom' || kind === 'top') {
      const layer = kind === 'bottom' ? 1 : 0;
      if (R) R.nets.forEach(n => n.routed && n.paths.forEach(p => traceRuns(p).forEach(run => {
        if (run[0].l === layer) pg.polyline(run.map(q => [q.x, q.y]), tw, ink);
      })));
      // pad inteiro no tamanho real; no centro só o ponto-guia da broca
      pins.forEach(p => { pad(p, 0, ink); pg.fillCircle(p.x, p.y, Math.min(DRILL_GUIDE, p.drill) / 2, paper); });
      if (R && R.layers === 2) R.nets.forEach(n => n.vias.forEach(q => { pg.fillCircle(q.x, q.y, v.d / 2, ink); pg.fillCircle(q.x, q.y, Math.min(DRILL_GUIDE, v.drill) / 2, paper); }));
    } else if (kind === 'silk') {
      for (const c of S.components) {
        pg.save().translate(c.x, c.y).rotate90(c.rot);
        for (const sh of footprint(c).body) {
          if (sh.t === 'rect') pg.strokeRRect(sh.x, sh.y, sh.w, sh.h, sh.r || 0, 0.15, ink);
          else if (sh.t === 'circle') pg.strokeCircle(sh.cx, sh.cy, sh.r, 0.15, ink);
          else if (sh.t === 'line') pg.line(sh.x1, sh.y1, sh.x2, sh.y2, 0.15, ink);
          else pg.svgPath(sh.d, 0.15, ink);
        }
        pg.restore();
        const rp = refPos(c);
        pg.text(c.ref + (c.value ? ' ' + c.value : ''), rp.x, rp.y, 1.5, { bold: true, anchor: 'middle', color: ink });
      }
      pins.forEach(p => pad(p, 0.4, paper)); // serigrafia recortada em volta dos pads
      if (pinNames) pins.forEach(p => {
        const L = labelSpec(p);
        pg.text(L.text, L.x, L.y, 0.9, { bold: true, color: ink, anchor: L.anchor, base: L.base, vertical: L.vert });
      });
    } else if (kind === 'drill') {
      pins.forEach(p => pg.fillCircle(p.x, p.y, p.drill / 2, ink));
      if (R && R.layers === 2) R.nets.forEach(n => n.vias.forEach(q => pg.fillCircle(q.x, q.y, v.drill / 2, ink)));
    }
    pg.strokeRRect(0.075, 0.075, w - 0.15, h - 0.15, 0, 0.15, ink); // contorno = linha de corte
    pg.restore();
  }

  function drillTable() {
    const count = new Map();
    for (const p of D.pins.values()) count.set(p.drill, (count.get(p.drill) || 0) + 1);
    const R = routeValid() ? S.route : null;
    if (R && R.layers === 2) {
      const n = R.nets.reduce((a, x) => a + x.vias.length, 0);
      if (n) count.set(via().drill, (count.get(via().drill) || 0) + n);
    }
    return [...count.entries()].sort((a, b) => a[0] - b[0]).map(([d, n]) => `Ø ${fmt(d)} mm × ${n}`);
  }

  function buildPDF() {
    derive();
    const proc = $('#export-proc').value, negative = $('#export-neg').checked, pinNames = $('#export-pins').checked;
    const st = S.settings, { w, h } = S.board, R = S.route;
    const doc = new window.PCBPdf.PDFDoc({ title: 'Placa Prototipada' });
    const kinds = ['bottom', ...(R.layers === 2 ? ['top'] : []), ...($('#export-silk').checked ? ['silk'] : []), 'drill'];
    const titles = { bottom: 'Cobre inferior (lado da solda)', top: 'Cobre superior (lado dos componentes)', silk: 'Serigrafia (lado dos componentes)', drill: 'Furação' };
    const date = new Date().toLocaleDateString('pt-BR');
    // A4 retrato ou paisagem; se a placa não couber, página do tamanho da placa + margens
    const fits = (pw, ph) => w + 30 <= pw && h + 62 <= ph;
    const [PW, PH] = fits(210, 297) ? [210, 297] : fits(297, 210) ? [297, 210] : [Math.ceil(w + 30), Math.ceil(h + 62)];
    for (const kind of kinds) {
      const mirror = mirrorFor(kind, proc);
      const neg = negative && kind !== 'drill';
      const pg = doc.addPage(PW, PH);
      const ox = Math.round((PW - w) / 2 * 10) / 10, oy = 32;
      pg.text(`${titles[kind]} — escala 1:1`, 15, 13, 4.2, { bold: true });
      pg.text(`Imagem ${orientationText(kind, mirror)} · processo: ${PROC_NAME[proc]}${neg ? ' · NEGATIVO' : ''}`, 15, 19, 2.8);
      pg.text(`Placa ${fmt(w, 1)} × ${fmt(h, 1)} mm · trilha ${fmt(st.trace)} mm · folga mínima ${fmt(st.clearance)} mm · ${R.layers === 2 ? '2 camadas' : 'face simples'} · ${date}`, 15, 24, 2.8);
      for (const [cx, cy, sx, sy] of [[0, 0, -1, -1], [w, 0, 1, -1], [0, h, -1, 1], [w, h, 1, 1]]) { // marcas de corte
        pg.line(ox + cx + sx * 1.5, oy + cy, ox + cx + sx * 6, oy + cy, 0.15, '#000000');
        pg.line(ox + cx, oy + cy + sy * 1.5, ox + cx, oy + cy + sy * 6, 0.15, '#000000');
      }
      pg.save().translate(ox, oy);
      drawLayerPDF(pg, kind, { mirror, negative: neg, pinNames });
      pg.restore();
      // régua de 50 mm e amostra da trilha, para conferir a escala impressa
      const y0 = oy + h + 10;
      pg.line(15, y0, 65, y0, 0.2, '#000000');
      for (let i = 0; i <= 50; i++) pg.line(15 + i, y0, 15 + i, y0 + (i % 10 === 0 ? 3 : i % 5 === 0 ? 2 : 1), 0.12, '#000000');
      for (let i = 0; i <= 50; i += 10) pg.text(String(i), 15 + i, y0 + 5.8, 2.2, { anchor: 'middle' });
      pg.text('mm — confira com uma régua; se não medir 50 mm, imprima em “Tamanho real / 100%”', 68, y0 + 2.5, 2.6);
      if (kind === 'bottom' || kind === 'top') {
        pg.line(15, y0 + 11, 45, y0 + 11, st.trace, '#000000');
        pg.text(`amostra de trilha: ${fmt(st.trace)} mm de largura × 30 mm`, 48, y0 + 12, 2.6);
        pg.text(`Pads no tamanho real (datasheet); o ponto branco no centro (Ø ${fmt(DRILL_GUIDE, 1)} mm) é só a guia da broca — diâmetros dos furos na página “Furação”.`, 15, y0 + 18, 2.6);
      }
      if (kind === 'drill') pg.text('Brocas: ' + drillTable().join(' · '), 15, y0 + 12, 2.8, { bold: true });
    }
    return doc.build();
  }

  function savePDF(bytes, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function exportPDF() {
    if (!routeValid()) { flash('Calcule as trilhas antes de gerar o PDF.'); return; }
    const neg = $('#export-neg').checked ? '-negativo' : '';
    savePDF(buildPDF(), `placa-trilhas-1x1-${$('#export-proc').value}${neg}.pdf`);
    flash('PDF das trilhas gerado. Imprima em “Tamanho real / 100%” e confira a régua de 50 mm.');
  }

  // ------------------------------------------------------- PDF de montagem
  // Desenho ampliado com a identificação de cada pino + tabelas de
  // componentes e pinos (posição, rotação, rede e ligações).
  function buildAssemblyPDF() {
    derive();
    const { PDFDoc, textWidth } = window.PCBPdf;
    const doc = new PDFDoc({ title: 'Montagem da placa' });
    const { w, h } = S.board, st = S.settings;
    const R = routeValid() ? S.route : null;
    const date = new Date().toLocaleDateString('pt-BR');
    const pins = [...D.pins.values()];
    const fit = (str, width, size, bold) => {
      str = String(str);
      if (textWidth(str, size, bold) <= width) return str;
      while (str.length > 1 && textWidth(str + '…', size, bold) > width) str = str.slice(0, -1);
      return str + '…';
    };
    // quebra em linhas que cabem na coluna; sep = separador entre itens
    const wrap = (parts, width, size, sep = ', ') => {
      const lines = [];
      let cur = '';
      const push = word => {
        const next = cur ? cur + sep + word : word;
        if (cur && textWidth(next, size) > width) { lines.push(cur + sep.trimEnd()); cur = word; } else cur = next;
      };
      for (const part of parts) {
        if (textWidth(part, size) <= width) { push(part); continue; }
        for (const word of part.split(' ')) { // item longo: quebra por palavra
          const next = cur ? cur + ' ' + word : word;
          if (cur && textWidth(next, size) > width) { lines.push(cur); cur = word; } else cur = next;
        }
      }
      if (cur) lines.push(cur);
      return lines.length ? lines : ['—'];
    };
    const netName = k => (D.netOf.has(k) ? D.nets[D.netOf.get(k)].name : '—');
    const linkedTo = k => {
      if (!D.netOf.has(k)) return [];
      return D.nets[D.netOf.get(k)].keys.filter(o => o !== k).map(o => D.pins.get(o).label);
    };

    // ---- página 1: desenho ampliado (A4 paisagem)
    const PW = 297, PH = 210, M = 15;
    const areaW = PW - 2 * M - 10, areaH = PH - 52;
    const k = [5, 4, 3, 2.5, 2, 1.5, 1].find(z => w * z <= areaW && h * z <= areaH) || Math.min(areaW / w, areaH / h);
    const pg = doc.addPage(PW, PH);
    pg.text('Montagem — identificação dos componentes e pinos', M, 13, 4.6, { bold: true });
    pg.text(`Vista pelo lado dos componentes · escala ${String(k).replace('.', ',')}:1 (ampliado — use o PDF das trilhas para fabricar) · placa ${fmt(w, 1)} × ${fmt(h, 1)} mm · ${date}`, M, 19.5, 2.8);
    pg.text('Pad quadrado = pino 1 (ou polo +/catodo, conforme o componente). Nome ou número de cada pino ao lado do pad. Coordenadas em mm a partir do canto superior esquerdo.', M, 24.5, 2.6);
    const ox = Math.round((PW - w * k) / 2), oy = 38;
    pg.save().translate(ox, oy).transform(k, 0, 0, k, 0, 0);
    const u = mm => mm / k; // tamanho impresso → unidades da placa
    pg.fillRect(0, 0, w, h, '#f4f4ef');
    // trilhas em tom claro, só como referência
    if (R) for (const layer of [1, 0]) R.nets.forEach(n => n.routed && n.paths.forEach(p => traceRuns(p).forEach(run => {
      if (run[0].l === layer) pg.polyline(run.map(q => [q.x, q.y]), st.trace, layer === 0 ? '#f2b8b0' : '#b7d3ee');
    })));
    if (R && R.layers === 2) R.nets.forEach(n => n.vias.forEach(q => pg.fillCircle(q.x, q.y, via().d / 2, '#c8c8c0')));
    // corpos dos componentes
    for (const c of S.components) {
      pg.save().translate(c.x, c.y).rotate90(c.rot);
      for (const sh of footprint(c).body) {
        if (sh.t === 'rect') pg.strokeRRect(sh.x, sh.y, sh.w, sh.h, sh.r || 0, u(0.35), '#222222');
        else if (sh.t === 'circle') pg.strokeCircle(sh.cx, sh.cy, sh.r, u(0.35), '#222222');
        else if (sh.t === 'line') pg.line(sh.x1, sh.y1, sh.x2, sh.y2, u(0.35), '#222222');
        else pg.svgPath(sh.d, u(0.35), '#222222');
      }
      pg.restore();
    }
    // pads e nomes dos pinos
    for (const p of pins) {
      pg.fillRRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h, p.shape === 'rect' ? 0 : Math.min(p.w, p.h) / 2, '#c9a24a');
      pg.fillCircle(p.x, p.y, p.drill / 2, '#ffffff');
    }
    for (const p of pins) {
      const L = labelSpec(p, u(0.6));
      pg.text(L.text, L.x, L.y, u(L.vert ? 1.6 : 2.0), { bold: true, color: '#1a3d8f', anchor: L.anchor, base: L.base, vertical: L.vert });
    }
    for (const c of S.components) {
      const rp = refPos(c);
      pg.text(c.ref, rp.x, rp.y - u(0.6), u(3.0), { bold: true, anchor: 'middle', color: '#000000' });
    }
    pg.strokeRRect(0, 0, w, h, 0, u(0.3), '#000000');
    pg.restore();
    // réguas nas bordas (mm reais da placa)
    for (let x = 0; x <= w + 1e-6; x += 5) {
      const X = ox + x * k, big = x % 10 === 0;
      pg.line(X, oy - (big ? 3 : 1.6), X, oy, 0.15, '#000000');
      if (big) pg.text(String(x), X, oy - 4, 2.2, { anchor: 'middle' });
    }
    for (let y = 0; y <= h + 1e-6; y += 5) {
      const Y = oy + y * k, big = y % 10 === 0;
      pg.line(ox - (big ? 3 : 1.6), Y, ox, Y, 0.15, '#000000');
      if (big) pg.text(String(y), ox - 4, Y, 2.2, { anchor: 'end', base: 'central' });
    }
    pg.text('x (mm)', ox + w * k + 2, oy - 4, 2.2);
    pg.text('y (mm)', ox - 4, oy + h * k + 5, 2.2, { anchor: 'end' });
    const ly = Math.min(PH - 8, oy + h * k + 10);
    pg.line(M, ly, M + 8, ly, 1.2, '#b7d3ee'); pg.text('trilha inferior', M + 10, ly + 0.9, 2.4);
    pg.line(M + 40, ly, M + 48, ly, 1.2, '#f2b8b0'); pg.text('trilha superior', M + 50, ly + 0.9, 2.4);
    pg.text('nome do pino', M + 82, ly + 0.9, 2.4, { bold: true, color: '#1a3d8f' });

    // ---- tabelas (A4 retrato, com quebra de página)
    const TW = 210, TH = 297, LH = 4.1, FS = 2.7;
    let tp = null, ty = 0, cols = null, title = '';
    const header = () => {
      let x = M;
      tp.fillRect(M, ty - 3.4, TW - 2 * M, 5, '#e8e8e2');
      cols.forEach(cdef => { tp.text(cdef.t, x + 1, ty, FS, { bold: true }); x += cdef.w; });
      ty += 5;
    };
    const newPage = (heading, sub) => {
      tp = doc.addPage(TW, TH);
      tp.text(heading, M, 15, 4.4, { bold: true });
      if (sub) tp.text(sub, M, 21, 2.7);
      ty = sub ? 30 : 26;
      if (cols) header();
    };
    const table = (heading, sub, columns, rows) => {
      cols = columns; title = heading;
      newPage(heading, sub);
      for (const row of rows) {
        const cells = row.map((v, i) => (Array.isArray(v) ? v : [fit(v, columns[i].w - 2, FS, i === 0)]));
        const n = Math.max(...cells.map(cl => cl.length));
        if (ty + n * LH > TH - 14) newPage(title + ' (continuação)', '');
        let x = M;
        cells.forEach((cl, i) => { cl.forEach((line, j) => tp.text(line, x + 1, ty + j * LH, FS, { bold: i === 0 })); x += columns[i].w; });
        tp.line(M, ty + (n - 1) * LH + 1.6, TW - M, ty + (n - 1) * LH + 1.6, 0.1, '#cccccc');
        ty += n * LH + 1.2;
      }
    };
    const rotTxt = r => `${r * 90}°`;
    table('Lista de componentes', 'Posição = centro do pino 1, em mm a partir do canto superior esquerdo da placa (vista pelo lado dos componentes). Rotação no sentido horário.', [
      { t: 'Ref', w: 14 }, { t: 'Componente', w: 58 }, { t: 'Valor', w: 22 }, { t: 'Pino 1 (x ; y)', w: 26 }, { t: 'Rotação', w: 16 }, { t: 'Medidas (datasheet)', w: 44 },
    ], S.components.map(c => {
      const def = LIBMAP[c.type], p1 = pinsOf(c)[0];
      const nm = def.name + (c.param !== undefined ? ` · ${String(c.param).replace('.', ',')}` : '');
      return [c.ref, nm, c.value || '—', `${fmt(p1.x)} ; ${fmt(p1.y)}`, rotTxt(c.rot), wrap([def.src || '—'], 42, FS).slice(0, 4)];
    }));

    const pinRows = [];
    for (const c of S.components) for (const p of pinsOf(c)) {
      const others = linkedTo(p.key);
      pinRows.push([`${c.ref}.${p.num}`, p.name || '—', fmt(p.x), fmt(p.y),
        p.shape === 'circle' ? `Ø ${fmt(p.w)} / ${fmt(p.drill)}` : `${fmt(p.w)}×${fmt(p.h)} / ${fmt(p.drill)}`,
        netName(p.key), others.length ? wrap(others, 52, FS) : ['não ligado']]);
    }
    table('Pinos e ligações', 'Cada pino: posição do centro do furo (mm), pad / furo (mm), rede e os outros pinos ligados a ele.', [
      { t: 'Pino', w: 17 }, { t: 'Nome', w: 16 }, { t: 'x', w: 14 }, { t: 'y', w: 14 }, { t: 'Pad / furo', w: 25 }, { t: 'Rede', w: 18 }, { t: 'Liga em', w: 76 },
    ], pinRows);

    return doc.build();
  }

  function exportAssemblyPDF() {
    if (!S.components.length) { flash('Adicione componentes antes de gerar o PDF de montagem.'); return; }
    savePDF(buildAssemblyPDF(), 'placa-montagem-pinos.pdf');
    flash('PDF de montagem gerado: desenho com os pinos identificados e tabelas de componentes e ligações.');
  }

  // ------------------------------------------------ arquivos para fabricante
  // Gerber RS-274X + Excellon num .zip — o pacote que as empresas de placas pedem.
  const SILK_W = 0.15;   // largura da linha da serigrafia (mm)
  const MASK_EXP = 0.05; // abertura da máscara de solda além do pad (mm)

  // corta as polilinhas da serigrafia onde passam sobre um pad (+ folga)
  function clipSilk(lines, pins, gap) {
    const inside = (x, y) => pins.some(p => {
      const hw = p.w / 2 + gap, hh = p.h / 2 + gap;
      if (Math.abs(x - p.x) > hw || Math.abs(y - p.y) > hh) return false;
      const rad = p.shape === 'rect' ? 0 : Math.min(p.w, p.h) / 2 + gap;
      const dx = Math.max(Math.abs(x - p.x) - (hw - rad), 0), dy = Math.max(Math.abs(y - p.y) - (hh - rad), 0);
      return Math.hypot(dx, dy) < rad || rad === 0;
    });
    const out = [];
    for (const line of lines) {
      let cur = [];
      const flush = () => { if (cur.length > 1) out.push(cur); cur = []; };
      for (let i = 1; i < line.length; i++) {
        const [x1, y1] = line[i - 1], [x2, y2] = line[i];
        const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 0.05));
        for (let k = i === 1 ? 0 : 1; k <= n; k++) {
          const x = x1 + (x2 - x1) * k / n, y = y1 + (y2 - y1) * k / n;
          if (inside(x, y)) flush(); else cur.push([r3(x), r3(y)]);
        }
      }
      flush();
    }
    // junta pontos colineares para o arquivo não ficar enorme
    return out.map(l => l.filter((q, i) => {
      if (i === 0 || i === l.length - 1) return true;
      const a = l[i - 1], b = l[i + 1];
      return Math.abs((q[0] - a[0]) * (b[1] - q[1]) - (q[1] - a[1]) * (b[0] - q[0])) > 1e-6;
    }));
  }

  function fabModel() {
    derive();
    const G = window.PCBGerber;
    const R = S.route, st = S.settings, v = via();
    const pins = [...D.pins.values()];
    const traces = [];
    R.nets.forEach(n => n.routed && n.paths.forEach(p => traceRuns(p).forEach(run => {
      traces.push({ l: run[0].l, w: st.trace, pts: run.map(q => [q.x, q.y]) });
    })));
    const vias = R.layers === 2 ? R.nets.flatMap(n => n.vias) : [];
    // serigrafia: contornos dos corpos + referências (e nomes dos pinos, se marcado)
    let silk = [];
    for (const c of S.components) {
      for (const sh of footprint(c).body) for (const line of G.shapeLines(sh)) {
        silk.push(line.map(([x, y]) => { const [rx, ry] = rot(x, y, c.rot); return [c.x + rx, c.y + ry]; }));
      }
      const rp = refPos(c);
      silk.push(...G.textLines(c.ref + (c.value ? ' ' + c.value : ''), rp.x, rp.y, 1.2, { anchor: 'middle' }));
    }
    // nomes dos pinos; em peças de 2 pinos sem nome (resistor, capacitor cerâmico) o número não identifica nada
    const labelled = p => p.name || footprint(p.comp).pins.length > 2;
    if ($('#export-pins').checked) for (const p of pins.filter(labelled)) {
      const L = labelSpec(p);
      silk.push(...G.textLines(L.text, L.x, L.y, 1.0, { anchor: L.anchor, base: L.base, vertical: L.vert }));
    }
    silk = clipSilk(silk, pins, 0.1 + SILK_W / 2);
    const minDrill = Math.min(...pins.map(p => p.drill), ...(vias.length ? [v.drill] : []));
    const date = new Date().toLocaleDateString('pt-BR');
    const files = R.layers === 2
      ? ['placa.GTL  cobre superior', 'placa.GBL  cobre inferior', 'placa.GTS  mascara de solda superior', 'placa.GBS  mascara de solda inferior']
      : ['placa.GBL  cobre (face unica, lado da solda)', 'placa.GBS  mascara de solda (lado da solda)'];
    const info = tools => [
      'PLACA PROTOTIPADA - ARQUIVOS PARA FABRICACAO',
      '=============================================',
      `Gerado em ${date} por https://matheusmerlim1.github.io/placa-prototipada/`,
      '',
      'DADOS PARA O PEDIDO',
      `  Dimensoes ............ ${fmt(S.board.w, 1)} x ${fmt(S.board.h, 1)} mm`,
      `  Camadas .............. ${R.layers}${R.layers === 1 ? ' (face simples: cobre so no lado da solda)' : ''}`,
      '  Material ............. FR-4, espessura 1,6 mm (sugerido)',
      '  Cobre ................ 1 oz (35 um)',
      `  Trilha minima ........ ${fmt(st.trace)} mm`,
      `  Folga minima ......... ${fmt(st.clearance)} mm (conferida por DRC: ${R.drc && R.drc.minGap !== null ? fmt(R.drc.minGap, 3) + ' mm' : '-'})`,
      `  Furo minimo .......... ${fmt(minDrill)} mm`,
      `  Furos ................ ${tools.reduce((a, t) => a + t.n, 0)} no total, todos metalizados (PTH)`,
      ...tools.map(t => `                         ${t.tool}: diametro ${fmt(t.d)} mm x ${t.n}`),
      `  Vias ................. ${vias.length}${vias.length ? ` (diametro ${fmt(v.d)} mm, furo ${fmt(v.drill)} mm, cobertas pela mascara)` : ''}`,
      '  Acabamento ........... HASL (com ou sem chumbo)',
      '  Mascara / serigrafia . verde / branca (ou a cor que preferir)',
      '  Componentes .......... todos PTH (furo passante), sem SMD; nao precisa de stencil',
      '',
      'ARQUIVOS',
      ...files.map(f => '  ' + f),
      '  placa.GTO  serigrafia (legenda) superior',
      '  placa.GKO  contorno da placa (linha de corte)',
      '  placa.DRL  furacao Excellon (metrico, furos metalizados)',
      '',
      'FORMATO',
      '  Gerber RS-274X (X2), unidades mm, formato 4.6, coordenadas absolutas.',
      '  Excellon metrico com ponto decimal. Origem (0,0) no canto inferior esquerdo da placa.',
      `  Mascara de solda aberta ${fmt(MASK_EXP)} mm alem de cada pad; serigrafia de ${fmt(SILK_W)} mm ja recortada fora dos pads.`,
      '',
      'COMO ENVIAR',
      '  Envie este .zip inteiro (sem descompactar) no campo "Gerber" do site do fabricante.',
      '  Confira a visualizacao que o site gera antes de confirmar o pedido.',
      '',
    ].join('\n');
    return { w: S.board.w, h: S.board.h, layers: R.layers, pads: pins, traces, vias, via: v, silk: { lines: silk, width: SILK_W }, mask: MASK_EXP, info };
  }

  function exportGerber() {
    if (!routeValid()) { flash('Calcule as trilhas antes de gerar os arquivos de fabricação.'); return; }
    const G = window.PCBGerber;
    const bytes = G.zip(G.buildFiles(fabModel()));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    a.download = 'placa-gerber.zip';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    flash('Arquivos de fabricação gerados (Gerber + furação). Envie o .zip inteiro no site do fabricante.');
  }

  // ----------------------------------------------------- acessibilidade (teclado e leitor de tela)
  // chave do controle com foco, para devolvê-lo depois que a lista for refeita
  function focoAtual() {
    const el = document.activeElement;
    if (!el || !el.dataset) return null;
    for (const k of ['rot', 'del', 'delconn']) if (el.dataset[k] !== undefined) return `[data-${k}="${el.dataset[k]}"]`;
    return null;
  }
  function renderA11y(foco) {
    // abas: só a ativa entra na tabulação; as outras se alcançam pelas setas
    $$('.steps button').forEach(b => { b.tabIndex = b.dataset.step === ui.step ? 0 : -1; });
    const mode = S.settings.layers === 2 ? '2' : S.settings.jumpers ? '1j' : '1';
    $$('.seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    $$('[data-show]').forEach(b => b.setAttribute('aria-pressed', String(!!ui.show[b.dataset.show])));
    if (foco && document.activeElement === document.body) {
      const el = $(foco);
      if (el) el.focus();
    }
  }
  function bindA11y() {
    // setas, Home e End trocam de aba (padrão de abas da WAI-ARIA)
    const tabs = $$('.steps button');
    $('.steps').addEventListener('keydown', e => {
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (j === undefined) return;
      e.preventDefault();
      const t = tabs[(j + tabs.length) % tabs.length];
      t.click();
      t.focus();
    });
    $$('[data-show]').forEach(b => b.addEventListener('click', () => b.setAttribute('aria-pressed', String(!!ui.show[b.dataset.show]))));
    // levar o foco a uma linha da lista seleciona o componente (alternativa ao clique na placa)
    $('#comp-list').addEventListener('focusin', e => {
      const row = e.target.closest('[data-row]');
      if (!row || ui.sel === row.dataset.row) return;
      ui.sel = row.dataset.row;
      render();
      $$('.comp-row').forEach(r => r.classList.toggle('sel', r.dataset.row === ui.sel));
    });
    // setas movem o componente selecionado um passo do encaixe (alternativa ao arrastar, WCAG 2.1.1 e 2.5.7)
    document.addEventListener('keydown', e => {
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!d || !ui.sel || ui.step === 'conn') return;
      const el = document.activeElement;
      if (/INPUT|SELECT|TEXTAREA/.test(el.tagName) || el.getAttribute('role') === 'tab') return;
      const c = S.components.find(c => c.id === ui.sel);
      if (!c) return;
      e.preventDefault();
      const sn = S.settings.snap;
      c.x = r3(c.x + d[0] * sn); c.y = r3(c.y + d[1] * sn);
      changed();
      flash(`${c.ref} em x ${fmt(c.x)} · y ${fmt(c.y)} mm`);
    });
  }

  // ------------------------------------------------------------------- início
  renderLibrary();
  bindBoard();
  bindPanel();
  bindA11y(); // a11y
  render();
  window.addEventListener('resize', applyView);
})();
