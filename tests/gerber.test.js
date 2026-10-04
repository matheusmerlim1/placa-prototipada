// Arquivos para fabricante: Gerber RS-274X, Excellon e .zip.
const zlib = require('zlib');
const { PCBGerber, example, routeState } = require('./helpers');

jest.setTimeout(120000);

async function filesFor(key, layers) {
  const S = example(key);
  S.settings.layers = layers;
  const r = await routeState(S);
  const silkLines = [[[2, 2], [10, 2]], ...PCBGerber.textLines('R1 10K', 5, 5, 1.2)];
  const model = {
    w: S.board.w, h: S.board.h, layers, pads: r.pins, traces: r.traces, vias: layers === 2 ? r.vias : [], via: r.via,
    silk: { lines: silkLines, width: 0.15 }, mask: 0.05, info: tools => `furos: ${tools.map(t => t.n).join(',')}`,
  };
  return { S, r, model, files: PCBGerber.buildFiles(model) };
}

// lê as coordenadas X/Y (formato 4.6, mm) de um Gerber
const coords = g => [...g.matchAll(/X(-?\d+)Y(-?\d+)D0[123]\*/g)].map(m => [+m[1] / 1e6, +m[2] / 1e6]);

describe('Gerber de placa com 2 camadas', () => {
  let ctx;
  beforeAll(async () => { ctx = await filesFor('nano', 2); });

  test('gera todas as camadas que o fabricante pede', () => {
    expect(Object.keys(ctx.files).sort()).toEqual(['LEIA-ME.txt', 'placa.DRL', 'placa.GBL', 'placa.GBS', 'placa.GKO', 'placa.GTL', 'placa.GTO', 'placa.GTS']);
  });

  test.each(['placa.GTL', 'placa.GBL', 'placa.GTS', 'placa.GBS', 'placa.GTO', 'placa.GKO'])('%s: cabeçalho RS-274X em mm e fim M02', name => {
    const g = ctx.files[name];
    expect(g).toContain('%FSLAX46Y46*%');
    expect(g).toContain('%MOMM*%');
    expect(g.trim().endsWith('M02*')).toBe(true);
    // toda abertura usada (Dnn*) foi definida (%ADDnn...)
    const used = new Set([...g.matchAll(/^D(\d{2,})\*$/gm)].map(m => m[1]));
    for (const d of used) expect(g).toMatch(new RegExp(`%ADD${d}[CRO],`));
  });

  test('todas as coordenadas ficam dentro da placa', () => {
    const { w, h } = ctx.S.board;
    for (const name of ['placa.GTL', 'placa.GBL', 'placa.GTS', 'placa.GBS', 'placa.GKO']) {
      for (const [x, y] of coords(ctx.files[name])) {
        expect(x).toBeGreaterThanOrEqual(-1e-6); expect(x).toBeLessThanOrEqual(w + 1e-6);
        expect(y).toBeGreaterThanOrEqual(-1e-6); expect(y).toBeLessThanOrEqual(h + 1e-6);
      }
    }
  });

  test('um flash por pad em cada máscara; pads + vias em cada cobre', () => {
    const flashes = g => (g.match(/D03\*/g) || []).length;
    const pads = ctx.r.pins.length, vias = ctx.r.vias.length;
    expect(flashes(ctx.files['placa.GTS'])).toBe(pads);
    expect(flashes(ctx.files['placa.GBS'])).toBe(pads);
    expect(flashes(ctx.files['placa.GTL'])).toBe(pads + vias);
    expect(flashes(ctx.files['placa.GBL'])).toBe(pads + vias);
  });

  test('y invertido: origem no canto inferior esquerdo', () => {
    const p = ctx.r.pins[0];
    const needle = `X${Math.round(p.x * 1e6)}Y${Math.round((ctx.S.board.h - p.y) * 1e6)}D03*`;
    expect(ctx.files['placa.GBL']).toContain(needle);
  });

  test('contorno é o retângulo da placa', () => {
    const pts = coords(ctx.files['placa.GKO']);
    expect(pts).toHaveLength(5);
    expect(pts[0]).toEqual(pts[4]); // fechado
    const { w, h } = ctx.S.board;
    expect(pts.slice(0, 4).map(String).sort()).toEqual([`0,0`, `0,${h}`, `${w},0`, `${w},${h}`].sort());
  });

  test('Excellon: um furo por pad e por via, com o diâmetro certo', () => {
    const drl = ctx.files['placa.DRL'];
    expect(drl.startsWith('M48')).toBe(true);
    expect(drl).toContain('METRIC');
    expect(drl.trim().endsWith('M30')).toBe(true);
    const tools = Object.fromEntries([...drl.matchAll(/^T(\d+)C([\d.]+)$/gm)].map(m => [m[1], +m[2]]));
    let tool = null;
    const holes = [];
    for (const line of drl.split('\n').slice(drl.split('\n').indexOf('%'))) {
      const t = line.match(/^T(\d+)$/); if (t) tool = t[1];
      const xy = line.match(/^X([\d.]+)Y([\d.]+)$/); if (xy) holes.push({ d: tools[tool], x: +xy[1], y: +xy[2] });
    }
    expect(holes.length).toBe(ctx.r.pins.length + ctx.r.vias.length);
    const p = ctx.r.pins[0];
    const h = holes.find(q => Math.abs(q.x - p.x) < 1e-3 && Math.abs(q.y - (ctx.S.board.h - p.y)) < 1e-3);
    expect(h.d).toBeCloseTo(p.drill, 6);
  });
});

describe('Gerber de face simples', () => {
  test('só o cobre e a máscara do lado da solda', async () => {
    const { files } = await filesFor('555', 1);
    expect(files['placa.GTL']).toBeUndefined();
    expect(files['placa.GTS']).toBeUndefined();
    expect(files['placa.GBL']).toContain('%TF.FileFunction,Copper,L1,Bot*%');
  });
});

describe('ZIP', () => {
  test('arquivo válido: assinaturas, nomes e CRC32 de cada arquivo', async () => {
    const { files } = await filesFor('555', 2);
    const buf = Buffer.from(PCBGerber.zip(files));
    const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    expect(end).toBeGreaterThan(0);
    const count = buf.readUInt16LE(end + 10), cdOffset = buf.readUInt32LE(end + 16);
    expect(count).toBe(Object.keys(files).length);
    let p = cdOffset;
    for (let i = 0; i < count; i++) {
      expect(buf.readUInt32LE(p)).toBe(0x02014b50);
      const crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), local = buf.readUInt32LE(p + 42);
      const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
      expect(buf.readUInt32LE(local)).toBe(0x04034b50);
      const data = buf.slice(local + 30 + buf.readUInt16LE(local + 26), local + 30 + buf.readUInt16LE(local + 26) + size);
      expect(zlib.crc32 ? zlib.crc32(data) : crc).toBe(crc);
      expect(data.toString('utf8').replace(/\r\n/g, '\n')).toBe(files[name]);
      p += 46 + nlen;
    }
  });
});

describe('Fonte de traço da serigrafia', () => {
  test('texto centralizado tem a largura esperada', () => {
    const lines = PCBGerber.textLines('AB', 10, 10, 1.2, { anchor: 'middle' });
    const xs = lines.flat().map(q => q[0]);
    const width = PCBGerber.textUnits('AB') * 1.2 / 6;
    expect(Math.min(...xs)).toBeCloseTo(10 - width / 2, 6);
    expect(Math.max(...xs)).toBeCloseTo(10 + width / 2, 6);
  });

  test('texto vertical sobe a partir do ponto e não sai da coluna', () => {
    const pts = PCBGerber.textLines('AREF', 10, 20, 1, { vertical: true, anchor: 'start', base: 'central' }).flat();
    const ys = pts.map(q => q[1]), xs = pts.map(q => q[0]);
    expect(Math.max(...ys)).toBeCloseTo(20, 6); // começa no ponto
    expect(Math.min(...ys)).toBeCloseTo(20 - PCBGerber.textUnits('AREF') / 6, 6); // sobe o comprimento do texto
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(1 + 1e-9); // largura = altura da letra
  });

  test('todo caractere usado nos exemplos tem glifo', () => {
    const used = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+-./µ';
    for (const ch of used) expect(PCBGerber.textLines(ch, 0, 0, 1).length).toBeGreaterThan(0);
  });

  test('retângulo arredondado vira polilinha fechada', () => {
    const [l] = PCBGerber.shapeLines({ t: 'rect', x: 0, y: 0, w: 4, h: 2, r: 0.5 });
    expect(l[0][0]).toBeCloseTo(l[l.length - 1][0], 9);
    expect(l[0][1]).toBeCloseTo(l[l.length - 1][1], 9);
  });

  test('arco do caminho SVG (corpo do TO-92) é amostrado sem pontos fora do raio', () => {
    // corda de 0,75 a 4,33 em y = 1,6 com raio 2,4 → centro em (2,54 ; 1,6 − √(2,4² − 1,79²))
    const cy = 1.6 - Math.sqrt(2.4 ** 2 - 1.79 ** 2);
    const lines = PCBGerber.shapeLines({ t: 'path', d: 'M 0.75 1.6 L 4.33 1.6 A 2.4 2.4 0 1 0 0.75 1.6 Z' });
    const arc = lines[0].slice(2, -1); // pontos do arco (sem a corda)
    for (const [x, y] of arc) expect(Math.abs(Math.hypot(x - 2.54, y - cy) - 2.4)).toBeLessThan(0.002);
  });
});
