// Roteamento e conferência de folgas (DRC).
const { PCBRouter, example, routeState } = require('./helpers');

jest.setTimeout(120000);

describe('Roteamento dos exemplos', () => {
  test.each([
    ['555', 1, 0.4, 0.25],
    ['555', 2, 0.4, 0.25],
    ['555', 2, 0.8, 0.4],
    ['fonte', 1, 0.8, 0.4],
    ['botao', 1, 0.8, 0.4],
    ['nano', 2, 0.6, 0.3],
    ['nano', 1, 0.6, 0.3],
  ])('%s em %i camada(s), trilha %f, folga %f: tudo roteado e DRC sem violações', async (key, layers, trace, clearance) => {
    const S = example(key);
    Object.assign(S.settings, { layers, trace, clearance });
    const { res, drc } = await routeState(S);
    expect(res.ok).toBe(true);
    expect(res.failed).toEqual([]);
    expect(res.legal).toBe(true);
    expect(drc.violations).toEqual([]);
    expect(drc.minGap).toBeGreaterThanOrEqual(clearance - 0.005);
  });

  test('face simples sem vias', async () => {
    const S = example('555');
    S.settings.layers = 1;
    const { vias } = await routeState(S);
    expect(vias).toEqual([]);
  });
});

describe('Erros detectados pelo roteador', () => {
  const pad = (x, y, net) => ({ x, y, w: 1.6, h: 1.6, shape: 'circle', net });
  const base = { width: 30, height: 20, layers: 1, trace: 0.4, clearance: 0.25, via: { d: 1.2, drill: 0.6 } };

  test('pads de redes diferentes encostados são recusados', async () => {
    const r = await PCBRouter.route({ ...base, pads: [pad(10, 10, 0), pad(11, 10, 1), pad(20, 10, 0), pad(20, 15, 1)], nets: [{ id: 0, groups: [[0], [2]] }, { id: 1, groups: [[1], [3]] }] });
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.type === 'overlap')).toBe(true);
  });

  test('pad fora da placa é recusado', async () => {
    const r = await PCBRouter.route({ ...base, pads: [pad(0.2, 10, 0), pad(20, 10, 0)], nets: [{ id: 0, groups: [[0], [1]] }] });
    expect(r.ok).toBe(false);
    expect(r.errors[0].type).toBe('edge');
  });

  test('a trilha desvia de um pad de outra rede no caminho', async () => {
    const pads = [pad(5, 10, 0), pad(25, 10, 0), pad(15, 10, -1)];
    const r = await PCBRouter.route({ ...base, pads, nets: [{ id: 0, groups: [[0], [1]] }] });
    expect(r.ok && r.legal).toBe(true);
    const segs = [];
    for (const p of r.nets[0].paths) for (let k = 1; k < p.length; k++) segs.push({ x1: p[k - 1].x, y1: p[k - 1].y, x2: p[k].x, y2: p[k].y, w: 0.4, l: 1, net: 0 });
    const drc = PCBRouter.drc({ pads: pads.map((p, i) => ({ ...p, comp: 'c' + i })), segs, vias: [], clearance: 0.25, layers: 1 });
    expect(drc.violations).toEqual([]);
  });
});

describe('DRC', () => {
  test('acusa uma trilha passando por cima de um pad de outra rede', () => {
    const drc = PCBRouter.drc({
      pads: [{ x: 10, y: 10, w: 1.6, h: 1.6, shape: 'circle', net: 1, comp: 'a' }],
      segs: [{ x1: 5, y1: 10, x2: 15, y2: 10, w: 0.4, l: 1, net: 0 }],
      vias: [], clearance: 0.25, layers: 1,
    });
    expect(drc.violations.length).toBe(1);
    expect(drc.minGap).toBeLessThan(0);
  });

  test('mede a folga exata entre duas trilhas paralelas', () => {
    const drc = PCBRouter.drc({
      pads: [], vias: [], clearance: 0.25, layers: 1,
      segs: [{ x1: 0, y1: 0, x2: 10, y2: 0, w: 0.4, l: 1, net: 0 }, { x1: 0, y1: 1, x2: 10, y2: 1, w: 0.4, l: 1, net: 1 }],
    });
    expect(drc.minGap).toBeCloseTo(0.6, 6); // 1,0 entre eixos − 0,2 − 0,2
    expect(drc.violations).toEqual([]);
  });
});
