/*
 * Projetos de exemplo (circuitos didáticos simples).
 * Cada um devolve o estado completo do editor; coordenadas em mm
 * (origem = pino 1 de cada componente).
 */
(function (root) {
  'use strict';

  const LIB = Object.fromEntries(root.PCB_LIBRARY.map(l => [l.id, l]));
  const g = n => Math.round(n * 2.54 * 1000) / 1000; // múltiplo do passo 2,54 mm

  function builder(state) {
    const byRef = {};
    let seq = 0;
    const comp = (type, param, ref, value, x, y, rot = 0, pinNames) => {
      const c = { id: 'c' + (++seq), type, param, ref, value, x, y, rot };
      if (pinNames) c.pinNames = pinNames;
      state.components.push(c);
      byRef[ref] = c;
      state.nextId = seq + 1;
    };
    // "U1.8" (número) ou "A1.D13" (nome); "GND/29" = nome GND, pino 29
    const pin = label => {
      const dot = label.indexOf('.'); // só o primeiro ponto: "J1.3.3V" = J1, pino "3.3V"
      const ref = label.slice(0, dot), name = label.slice(dot + 1);
      const c = byRef[ref];
      if (!c) throw new Error('componente ' + ref);
      const fp = LIB[c.type].build(c.param);
      const [nm, num] = name.split('/');
      const nameOf = k => (c.pinNames && c.pinNames[k]) || fp.pins[k].name;
      let i = fp.pins.findIndex((p, k) => nameOf(k) === nm && (!num || p.num === num));
      if (i < 0) i = fp.pins.findIndex(p => p.num === name);
      if (i < 0) throw new Error('pino ' + label);
      return `${c.id}:${i}`;
    };
    const net = (name, ...labels) => {
      const ks = labels.map(pin);
      ks.slice(1).forEach((k, i) => state.connections.push({ a: ks[i], b: k }));
      if (name) state.netNames[ks[0]] = name;
    };
    return { comp, net };
  }

  const EXAMPLES = {
    '555': {
      title: 'Pisca-pisca com NE555',
      build(blank) {
        const e = blank();
        e.board = { w: 60, h: 40 };
        const { comp, net } = builder(e);
        comp('dip', 8, 'U1', 'NE555', g(9), g(9));
        comp('res-0207', 10.16, 'R1', '1k', g(15), g(3));
        comp('res-0207', 10.16, 'R2', '47k', g(15), g(5));
        comp('cap-ele', 6.3, 'C1', '10µF', g(16), g(10));
        comp('cap-disc', 5.0, 'C2', '10nF', g(4), g(11));
        comp('res-0207', 10.16, 'R3', '470', g(11), g(13));
        comp('led5', undefined, 'D1', '', g(19), g(13));
        comp('borne', 2, 'J1', '9V', g(2), g(14), 0, ['+9V', 'GND']);
        net('VCC', 'J1.+9V', 'U1.8', 'U1.4', 'R1.1');
        net(null, 'R1.2', 'U1.7', 'R2.1');
        net('THR', 'R2.2', 'U1.6', 'U1.2', 'C1.+');
        net('GND', 'J1.GND', 'U1.1', 'C1.−', 'C2.2', 'D1.K');
        net(null, 'U1.5', 'C2.1');
        net('OUT', 'U1.3', 'R3.1');
        net(null, 'R3.2', 'D1.A');
        return e;
      },
    },

    fonte: {
      title: 'Fonte regulada 5 V (7805)',
      build(blank) {
        const e = blank();
        e.board = { w: 60, h: 40 };
        e.settings = { ...e.settings, layers: 1, trace: 0.8, clearance: 0.4 };
        const { comp, net } = builder(e);
        comp('borne', 2, 'J1', 'entrada', g(1), g(8), 0, ['+VIN', 'GND']);
        comp('cap-ele', 10, 'C1', '470µF', g(6), g(8));
        comp('reg78', undefined, 'U1', '7805', g(11), g(3));
        comp('cap-disc', 2.5, 'C2', '330nF', g(10), g(7));
        comp('cap-disc', 2.5, 'C3', '100nF', g(13), g(7));
        comp('cap-ele', 6.3, 'C4', '10µF', g(16), g(9));
        comp('res-0207', 10.16, 'R1', '1k', g(12), g(12));
        comp('led5', undefined, 'D1', '', g(19), g(12), 2);
        comp('borne', 2, 'J2', 'saída', g(19), g(4), 0, ['+5V', 'GND']);
        net('VIN', 'J1.+VIN', 'C1.+', 'C2.1', 'U1.IN');
        net('GND', 'J1.GND', 'C1.−', 'C2.2', 'U1.GND', 'C3.2', 'C4.−', 'D1.K', 'J2.GND');
        net('5V', 'U1.OUT', 'C3.1', 'C4.+', 'R1.1', 'J2.+5V');
        net(null, 'R1.2', 'D1.A');
        return e;
      },
    },

    botao: {
      title: 'LED acionado por botão (transistor BC547)',
      build(blank) {
        const e = blank();
        e.board = { w: 50, h: 35 };
        e.settings = { ...e.settings, layers: 1, trace: 0.8, clearance: 0.4 };
        const { comp, net } = builder(e);
        comp('borne', 2, 'J1', '5V', g(2), g(10), 0, ['+5V', 'GND']);
        comp('tact6', undefined, 'SW1', '', g(2), g(2));
        comp('res-0207', 10.16, 'R3', '330', g(7), g(2));
        comp('led5', undefined, 'D1', '', g(13), g(2), 2);
        comp('res-0207', 10.16, 'R1', '10k', g(7), g(4));
        comp('to92-cbe', 2.54, 'Q1', 'BC547', g(13), g(7));
        comp('res-0207', 10.16, 'R2', '100k', g(14), g(10));
        net('+5V', 'J1.+5V', 'SW1.A1', 'R3.1');
        net(null, 'SW1.B2', 'R1.1');
        net('BASE', 'R1.2', 'Q1.B', 'R2.1');
        net(null, 'R3.2', 'D1.A');
        net(null, 'D1.K', 'Q1.C');
        net('GND', 'J1.GND', 'Q1.E', 'R2.2');
        return e;
      },
    },

    nano: {
      title: 'Termômetro com Arduino Nano (LM35, LED e buzzer)',
      build(blank) {
        const e = blank();
        e.board = { w: 60, h: 50 };
        e.settings = { ...e.settings, trace: 0.6, clearance: 0.3 };
        const { comp, net } = builder(e);
        comp('nano', undefined, 'A1', 'Nano', g(3), g(17));
        comp('lm35', 2.54, 'U1', 'LM35', g(13), g(6));
        comp('res-0207', 10.16, 'R1', '330', g(17), g(9));
        comp('led5', undefined, 'D1', '', g(22), g(8), 3);
        comp('buzzer', undefined, 'BZ1', '', g(2), g(3));
        net('5V', 'A1.5V', 'U1.+VS');
        net('TEMP', 'A1.A0', 'U1.VOUT');
        net('GND', 'A1.GND/29', 'U1.GND', 'D1.K', 'BZ1.−');
        net('LED', 'A1.D13', 'R1.1');
        net(null, 'R1.2', 'D1.A');
        net('BUZZ', 'A1.D8', 'BZ1.+');
        return e;
      },
    },
  };

  root.PCB_EXAMPLES = EXAMPLES;
  root.PCB_EXAMPLE_BUILDER = builder; // usado nos testes
})(typeof window !== 'undefined' ? window : globalThis);
