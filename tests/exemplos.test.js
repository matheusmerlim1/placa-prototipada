// Confere a fiação dos exemplos, rede por rede.
const { LIB, blank, example, netsOf } = require('./helpers');

// rede = lista ordenada de "REF.número do pino"
function wiring(S) {
  const label = k => {
    const [id, i] = k.split(':');
    const c = S.components.find(c => c.id === id);
    return `${c.ref}.${LIB[c.type].build(c.param).pins[i].num}`;
  };
  return netsOf(S).nets.map(ks => ks.map(label).sort().join(' ')).sort();
}
const norm = list => list.map(n => n.split(' ').sort().join(' ')).sort();

describe('Fiação dos exemplos', () => {
  test('pisca-pisca com NE555', () => {
    expect(wiring(example('555'))).toEqual(norm([
      'J1.1 R1.1 U1.4 U1.8', 'R1.2 R2.1 U1.7', 'C1.1 R2.2 U1.2 U1.6', 'C1.2 C2.2 D1.1 J1.2 U1.1',
      'C2.1 U1.5', 'R3.1 U1.3', 'D1.2 R3.2',
    ]));
  });

  test('fonte regulada 5 V (7805: 1 = IN, 2 = GND, 3 = OUT)', () => {
    expect(wiring(example('fonte'))).toEqual(norm([
      'C1.1 C2.1 J1.1 U1.1', // VIN
      'C1.2 C2.2 C3.2 C4.2 D1.1 J1.2 J2.2 U1.2', // GND
      'C3.1 C4.1 J2.1 R1.1 U1.3', // 5V
      'D1.2 R1.2', // R1 → anodo do LED
    ]));
  });

  test('LED acionado por botão (BC547: 1 = C, 2 = B, 3 = E)', () => {
    expect(wiring(example('botao'))).toEqual(norm([
      'J1.1 R3.1 SW1.1 SW1.2', // +5V (A1 e A2 do botão são ligados por dentro)
      'R1.1 SW1.3 SW1.4', // saída do botão (B1 = B2)
      'Q1.2 R1.2 R2.1', // base
      'D1.2 R3.2', // R3 → anodo do LED
      'D1.1 Q1.1', // catodo do LED → coletor
      'J1.2 Q1.3 R2.2', // GND
    ]));
  });

  test('termômetro com Arduino Nano (A0 = pino 19, D13 = 16, D8 = 11, 5V = 27)', () => {
    expect(wiring(example('nano'))).toEqual(norm([
      'A1.27 U1.1', // 5V → +Vs do LM35
      'A1.19 U1.2', // A0 ← Vout do LM35
      'A1.29 A1.4 BZ1.2 D1.1 U1.3', // GND (os dois GND do Nano são o mesmo nó)
      'A1.16 R1.1', // D13 → resistor do LED
      'D1.2 R1.2',
      'A1.11 BZ1.1', // D8 → buzzer
    ]));
  });

  test.each(Object.keys(globalThis.PCB_EXAMPLES))('%s: todos os componentes dentro da placa', key => {
    const S = example(key);
    for (const c of S.components) {
      expect(c.x).toBeGreaterThan(0); expect(c.x).toBeLessThan(S.board.w);
      expect(c.y).toBeGreaterThan(0); expect(c.y).toBeLessThan(S.board.h);
    }
  });
});

describe('Rótulos de pino nos exemplos', () => {
  // regressão: "J1.3.3V" era lido como "pino número 3" em vez do pino chamado "3.3V"
  test('nome com ponto ("3.3V") é o pino com esse nome, não o número', () => {
    const S = blank();
    const { comp, net } = globalThis.PCB_EXAMPLE_BUILDER(S);
    comp('header', 4, 'J1', '', 10, 10, 0, ['GND', 'SDA', 'SCL', '3.3V']);
    comp('header', 1, 'J2', '', 10, 20);
    net('3V3', 'J1.3.3V', 'J2.1');
    expect(wiring(S)).toEqual(['J1.4 J2.1']);
  });

  test('"GND/29" escolhe o GND do pino 29 quando há dois pinos GND', () => {
    const S = blank();
    const { comp, net } = globalThis.PCB_EXAMPLE_BUILDER(S);
    comp('nano', undefined, 'A1', '', 10, 30);
    comp('header', 1, 'J1', '', 10, 5);
    net(null, 'A1.GND/29', 'J1.1');
    expect(S.connections[0].a).toBe('c1:28');
  });
});
