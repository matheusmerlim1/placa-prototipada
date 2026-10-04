/*
 * Biblioteca de componentes PTH (furo passante) — medidas reais em milímetros.
 *
 * Posições, pads e furos seguem os footprints padrão IPC-7251 / KiCad, que são
 * desenhados a partir dos datasheets dos fabricantes. O contorno da serigrafia
 * é o corpo do componente pelo datasheet (tamanho nominal).
 *
 * pins:  { num, name, x, y, pad: {shape: circle|rect|oval, w, h, drill} }
 *        coordenadas relativas ao pino 1, eixo y para baixo (vista de cima)
 * body:  formas da serigrafia (rect, circle, line, path), em mm
 * internal: pares de pinos ligados por dentro do componente
 * src:   de onde vieram as medidas
 */
(function (root) {
  'use strict';

  const pad = (shape, w, h, drill) => ({ shape, w, h: h ?? w, drill });
  const pin = (num, x, y, p, name = '') => ({ num: String(num), name, x, y, pad: p });
  const rect = (x, y, w, h, r = 0) => ({ t: 'rect', x, y, w, h, r });
  const circle = (cx, cy, r) => ({ t: 'circle', cx, cy, r });
  const line = (x1, y1, x2, y2) => ({ t: 'line', x1, y1, x2, y2 });
  const path = d => ({ t: 'path', d });
  const plus = (x, y, s = 0.6) => path(`M ${x - s} ${y} H ${x + s} M ${x} ${y - s} V ${y + s}`);
  const round = (w, drill) => pad('circle', w, w, drill);
  const square = (w, drill) => pad('rect', w, w, drill);

  // Componente axial deitado: corpo L × D centrado entre os dois furos.
  function axial({ pitch, L, D, p1, p2, band, names = ['', ''], nums = [1, 2] }) {
    const x0 = (pitch - L) / 2;
    // pernas: da borda do pad até o corpo (a serigrafia não entra no pad)
    const e1 = p1.w / 2 + 0.3, e2 = p2.w / 2 + 0.3;
    const body = [rect(x0, -D / 2, L, D, D * 0.2)];
    if (x0 - e1 > 0.3) body.push(line(e1, 0, x0, 0));
    if (pitch - e2 - (x0 + L) > 0.3) body.push(line(x0 + L, 0, pitch - e2, 0));
    if (band === 1) body.push(rect(x0 + L * 0.08, -D / 2, L * 0.12, D));
    return { pins: [pin(nums[0], 0, 0, p1, names[0]), pin(nums[1], pitch, 0, p2, names[1])], body };
  }

  function to92(names, pitch) {
    const p = pitch === 1.27 ? pad('oval', 1.05, 1.5, 0.75) : pad('oval', 1.5, 1.8, 0.8);
    const p1 = pitch === 1.27 ? pad('rect', 1.05, 1.5, 0.75) : pad('rect', 1.5, 1.8, 0.8);
    const mid = pitch; // centro do corpo no pino do meio
    // TO-92 (JEDEC): Ø 4,8 mm, face plana a 1,6 mm da linha dos terminais
    return {
      pins: names.map((n, i) => pin(i + 1, i * pitch, 0, i === 0 ? p1 : p, n)),
      body: [path(`M ${mid - 1.79} 1.6 L ${mid + 1.79} 1.6 A 2.4 2.4 0 1 0 ${mid - 1.79} 1.6 Z`)],
    };
  }
  function to220(names) {
    // TO-220-3 em pé: corpo 10,0 × 4,4 mm, aba metálica (1,3 mm) atrás
    const p = pad('oval', 1.905, 2.0, 1.1), p1 = pad('rect', 1.905, 2.0, 1.1);
    return {
      pins: names.map((n, i) => pin(i + 1, i * 2.54, 0, i === 0 ? p1 : p, n)),
      body: [rect(-2.46, -3.15, 10.0, 4.4), line(-2.46, -1.85, 7.54, -1.85)],
    };
  }

  const DIP_LEN = { 4: 4.58, 6: 8.6, 8: 9.27, 14: 19.05, 16: 19.3, 18: 22.86, 20: 26.16, 24: 31.75, 28: 34.67 };
  const CAP_E = { // Ø do capacitor eletrolítico → passo, pad, furo
    5: [2.0, 1.6, 0.8], 6.3: [2.5, 1.6, 0.8], 8: [3.5, 1.6, 0.8], 10: [5.0, 2.0, 1.0], 12.5: [5.0, 2.4, 1.2], 16: [7.5, 2.4, 1.2],
  };

  const LIBRARY = [
    // ---------------- Resistores ----------------
    {
      id: 'res-0207', group: 'Resistores', name: 'Resistor 1/4 W (DIN 0207)', prefix: 'R',
      hint: 'corpo 6,3 × Ø 2,5 mm · pad 1,6 / furo 0,8',
      param: { label: 'Passo (mm)', options: [7.62, 10.16, 12.7, 15.24], def: 10.16 },
      src: 'DIN 0207 (CFR-25): L 6,3 mm, Ø 2,5 mm, terminal Ø 0,6 mm',
      build: p => axial({ pitch: p, L: 6.3, D: 2.5, p1: round(1.6, 0.8), p2: round(1.6, 0.8) }),
    },
    {
      id: 'res-0204', group: 'Resistores', name: 'Resistor 1/8 W (DIN 0204)', prefix: 'R',
      hint: 'corpo 3,6 × Ø 1,6 mm · pad 1,4 / furo 0,7',
      param: { label: 'Passo (mm)', options: [5.08, 7.62], def: 7.62 },
      src: 'DIN 0204: L 3,6 mm, Ø 1,6 mm, terminal Ø 0,5 mm',
      build: p => axial({ pitch: p, L: 3.6, D: 1.6, p1: round(1.4, 0.7), p2: round(1.4, 0.7) }),
    },
    {
      id: 'res-0309', group: 'Resistores', name: 'Resistor 1/2 W (DIN 0309)', prefix: 'R',
      hint: 'corpo 9,0 × Ø 3,2 mm · pad 1,6 / furo 0,8',
      param: { label: 'Passo (mm)', options: [12.7, 15.24], def: 12.7 },
      src: 'DIN 0309: L 9,0 mm, Ø 3,2 mm, terminal Ø 0,6 mm',
      build: p => axial({ pitch: p, L: 9.0, D: 3.2, p1: round(1.6, 0.8), p2: round(1.6, 0.8) }),
    },
    {
      id: 'res-v', group: 'Resistores', name: 'Resistor 1/4 W em pé', prefix: 'R',
      hint: 'passo 2,54 mm · pad 1,6 / furo 0,8',
      src: 'DIN 0207 vertical: corpo Ø 2,5 mm sobre o pino 1',
      build: () => ({
        pins: [pin(1, 0, 0, round(1.6, 0.8)), pin(2, 2.54, 0, round(1.6, 0.8))],
        body: [circle(0, 0, 1.25 + 0.15), line(1.4, 0, 2.54, 0)],
      }),
    },
    {
      id: 'trimpot', group: 'Resistores', name: 'Trimpot Bourns 3386P', prefix: 'RV',
      hint: 'corpo 9,53 × 9,53 mm · furo 0,8',
      src: 'Bourns 3386P: 9,53 × 9,53 mm, pinos 1–3 a 5,08 mm, pino 2 recuado 2,54 mm (posição do corpo aproximada)',
      build: () => ({
        pins: [pin(1, 0, 0, square(1.6, 0.8)), pin(2, 2.54, -2.54, round(1.6, 0.8), 'cursor'), pin(3, 5.08, 0, round(1.6, 0.8))],
        body: [rect(2.54 - 4.765, -1.27 - 4.765, 9.53, 9.53, 0.3), circle(2.54, -1.27, 2.2)],
      }),
    },

    // ---------------- Capacitores ----------------
    {
      id: 'cap-disc', group: 'Capacitores', name: 'Capacitor cerâmico disco', prefix: 'C',
      hint: 'pad 1,6 / furo 0,8',
      param: { label: 'Passo (mm)', options: [2.5, 5.0], def: 5.0 },
      src: 'Disco cerâmico: Ø 3,0 × 1,6 mm (passo 2,5) ou Ø 5,0 × 2,5 mm (passo 5,0)',
      build: p => {
        const [L, T] = p === 2.5 ? [3.0, 1.6] : [5.0, 2.5];
        return {
          pins: [pin(1, 0, 0, round(1.6, 0.8)), pin(2, p, 0, round(1.6, 0.8))],
          body: [rect(p / 2 - L / 2, -T / 2, L, T, T / 2)],
        };
      },
    },
    {
      id: 'cap-film', group: 'Capacitores', name: 'Capacitor de poliéster', prefix: 'C',
      hint: 'corpo 7,2 × 2,5 mm · passo 5,0 mm',
      src: 'Poliéster/MKT caixa retangular: L 7,2 × W 2,5 mm, passo 5,0 mm',
      build: () => ({
        pins: [pin(1, 0, 0, round(1.6, 0.8)), pin(2, 5.0, 0, round(1.6, 0.8))],
        body: [rect(2.5 - 3.6, -1.25, 7.2, 2.5, 0.2)],
      }),
    },
    {
      id: 'cap-ele', group: 'Capacitores', name: 'Capacitor eletrolítico radial', prefix: 'C',
      hint: 'passo e furo conforme o diâmetro',
      param: { label: 'Ø (mm)', options: [5, 6.3, 8, 10, 12.5, 16], def: 6.3 },
      src: 'Eletrolítico radial: Ø 5/6,3/8/10/12,5/16 mm → passo 2,0/2,5/3,5/5,0/5,0/7,5 mm',
      build: D => {
        const [p, pw, dr] = CAP_E[D];
        const cx = p / 2, r = D / 2;
        return {
          pins: [pin(1, 0, 0, square(pw, dr), '+'), pin(2, p, 0, round(pw, dr), '−')],
          body: [circle(cx, 0, r), plus(cx - r - 0.9, -r * 0.6, Math.min(0.6, r * 0.25)),
            path(`M ${cx + r * 0.55} ${-r * 0.835} A ${r} ${r} 0 0 1 ${cx + r * 0.55} ${r * 0.835}`)],
        };
      },
    },

    // ---------------- Diodos e LEDs ----------------
    {
      id: 'do41', group: 'Diodos e LEDs', name: 'Diodo 1N4001–1N4007 (DO-41)', prefix: 'D',
      hint: 'corpo 5,2 × Ø 2,7 mm · pad 2,2 / furo 1,1',
      param: { label: 'Passo (mm)', options: [7.62, 10.16, 12.7], def: 10.16 },
      src: 'DO-41: L 5,2 mm, Ø 2,7 mm, terminal Ø 0,86 mm; faixa = catodo (pino 1)',
      build: p => axial({ pitch: p, L: 5.2, D: 2.7, p1: square(2.2, 1.1), p2: round(2.2, 1.1), band: 1, names: ['K', 'A'] }),
    },
    {
      id: 'do35', group: 'Diodos e LEDs', name: 'Diodo 1N4148 / Zener (DO-35)', prefix: 'D',
      hint: 'corpo 4,0 × Ø 2,0 mm · pad 1,6 / furo 0,8',
      param: { label: 'Passo (mm)', options: [5.08, 7.62, 10.16], def: 7.62 },
      src: 'DO-35: L 4,0 mm, Ø 2,0 mm, terminal Ø 0,5 mm; faixa = catodo (pino 1)',
      build: p => axial({ pitch: p, L: 4.0, D: 2.0, p1: square(1.6, 0.8), p2: round(1.6, 0.8), band: 1, names: ['K', 'A'] }),
    },
    {
      id: 'do201', group: 'Diodos e LEDs', name: 'Diodo 1N5400–1N5408 (DO-201AD)', prefix: 'D',
      hint: 'corpo 9,5 × Ø 5,3 mm · pad 3,0 / furo 1,5',
      src: 'DO-201AD: L 9,5 mm, Ø 5,3 mm, terminal Ø 1,3 mm; faixa = catodo (pino 1)',
      build: () => axial({ pitch: 15.24, L: 9.5, D: 5.3, p1: square(3.0, 1.5), p2: round(3.0, 1.5), band: 1, names: ['K', 'A'] }),
    },
    {
      id: 'led5', group: 'Diodos e LEDs', name: 'LED 5 mm', prefix: 'D',
      hint: 'passo 2,54 · pad 1,8 / furo 0,9',
      src: 'LED T-1¾: Ø 5,0 mm, aba Ø 5,8 mm com chanfro no catodo (pino 1)',
      build: () => ({
        pins: [pin(1, 0, 0, square(1.8, 0.9), 'K'), pin(2, 2.54, 0, round(1.8, 0.9), 'A')],
        body: [circle(1.27, 0, 2.5), path('M -1.23 -1.47 A 2.9 2.9 0 1 1 -1.23 1.47 Z')],
      }),
    },
    {
      id: 'led3', group: 'Diodos e LEDs', name: 'LED 3 mm', prefix: 'D',
      hint: 'passo 2,54 · pad 1,8 / furo 0,9',
      src: 'LED T-1: Ø 3,0 mm, aba Ø 3,8 mm com chanfro no catodo (pino 1)',
      build: () => ({
        pins: [pin(1, 0, 0, square(1.8, 0.9), 'K'), pin(2, 2.54, 0, round(1.8, 0.9), 'A')],
        body: [circle(1.27, 0, 1.5), path('M -0.23 -1.17 A 1.9 1.9 0 1 1 -0.23 1.17 Z')],
      }),
    },

    // ---------------- Transistores e CIs ----------------
    {
      id: 'to92-cbe', group: 'Transistores e CIs', name: 'Transistor BC547/BC548/BC337 (TO-92)', prefix: 'Q',
      hint: 'C · B · E (face plana para baixo)',
      param: { label: 'Passo (mm)', options: [1.27, 2.54], def: 2.54 },
      src: 'TO-92 JEDEC: Ø 4,8 mm; terminais a 1,27 mm (original) ou abertos a 2,54 mm',
      build: p => to92(['C', 'B', 'E'], p),
    },
    {
      id: 'to92-ebc', group: 'Transistores e CIs', name: 'Transistor 2N2222A/2N3904 (TO-92)', prefix: 'Q',
      hint: 'E · B · C (face plana para baixo)',
      param: { label: 'Passo (mm)', options: [1.27, 2.54], def: 2.54 },
      src: 'TO-92 JEDEC: Ø 4,8 mm; terminais a 1,27 mm (original) ou abertos a 2,54 mm',
      build: p => to92(['E', 'B', 'C'], p),
    },
    {
      id: 'lm35', group: 'Transistores e CIs', name: 'Sensor LM35 (TO-92)', prefix: 'U',
      hint: '+Vs · Vout · GND',
      param: { label: 'Passo (mm)', options: [1.27, 2.54], def: 2.54 },
      src: 'LM35DZ, encapsulamento TO-92 (LP)',
      build: p => to92(['+VS', 'VOUT', 'GND'], p),
    },
    { id: 'reg78', group: 'Transistores e CIs', name: 'Regulador 78xx (TO-220)', prefix: 'U', hint: 'IN · GND · OUT · pad 1,9 × 2,0 / furo 1,1', src: 'TO-220-3: corpo 10,0 × 4,4 mm, passo 2,54 mm', build: () => to220(['IN', 'GND', 'OUT']) },
    { id: 'lm317', group: 'Transistores e CIs', name: 'Regulador LM317 (TO-220)', prefix: 'U', hint: 'ADJ · OUT · IN', src: 'TO-220-3: corpo 10,0 × 4,4 mm, passo 2,54 mm', build: () => to220(['ADJ', 'OUT', 'IN']) },
    { id: 'tip', group: 'Transistores e CIs', name: 'Transistor TIP120/TIP31 (TO-220)', prefix: 'Q', hint: 'B · C · E', src: 'TO-220-3: corpo 10,0 × 4,4 mm, passo 2,54 mm', build: () => to220(['B', 'C', 'E']) },
    { id: 'mosfet', group: 'Transistores e CIs', name: 'MOSFET IRF540N/IRFZ44N (TO-220)', prefix: 'Q', hint: 'G · D · S', src: 'TO-220AB: corpo 10,0 × 4,4 mm, passo 2,54 mm', build: () => to220(['G', 'D', 'S']) },
    {
      id: 'dip', group: 'Transistores e CIs', name: 'Circuito integrado DIP', prefix: 'U',
      hint: 'fileiras a 7,62 mm · pad 1,6 / furo 0,8',
      param: { label: 'Pinos', options: [4, 6, 8, 14, 16, 18, 20, 24, 28], def: 8 },
      src: 'PDIP 300 mil (JEDEC MS-001): largura do corpo 6,35 mm, comprimento conforme nº de pinos',
      build: n => {
        const half = n / 2, pins = [];
        for (let i = 0; i < half; i++) pins.push(pin(i + 1, i * 2.54, 0, i === 0 ? square(1.6, 0.8) : round(1.6, 0.8)));
        for (let i = 0; i < half; i++) pins.push(pin(half + i + 1, (half - 1 - i) * 2.54, -7.62, round(1.6, 0.8)));
        const len = DIP_LEN[n], cx = (half - 1) * 2.54 / 2, x0 = cx - len / 2;
        return {
          pins,
          body: [rect(x0, -3.81 - 3.175, len, 6.35), path(`M ${x0} -4.81 A 1 1 0 0 1 ${x0} -2.81`)],
        };
      },
    },

    // ---------------- Conectores e chaves ----------------
    {
      id: 'header', group: 'Conectores e chaves', name: 'Barra de pinos 1×N (2,54 mm)', prefix: 'J', namedPins: true,
      hint: 'pad 1,7 / furo 1,0',
      param: { label: 'Pinos', options: [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 16, 20], def: 3 },
      src: 'Pin header 2,54 mm, pino quadrado 0,64 mm',
      build: n => {
        const pins = [];
        for (let i = 0; i < n; i++) pins.push(pin(i + 1, i * 2.54, 0, i === 0 && n > 1 ? square(1.7, 1.0) : round(1.7, 1.0)));
        return { pins, body: [rect(-1.27, -1.27, n * 2.54, 2.54)] };
      },
    },
    {
      id: 'header2', group: 'Conectores e chaves', name: 'Barra de pinos 2×N (2,54 mm)', prefix: 'J', namedPins: true,
      hint: 'pad 1,7 / furo 1,0',
      param: { label: 'Colunas', options: [2, 3, 4, 5, 6, 8, 10, 20], def: 3 },
      src: 'Pin header 2,54 mm, pino quadrado 0,64 mm',
      build: n => {
        const pins = [];
        for (let i = 0; i < n; i++) {
          pins.push(pin(2 * i + 1, i * 2.54, 0, i === 0 ? square(1.7, 1.0) : round(1.7, 1.0)));
          pins.push(pin(2 * i + 2, i * 2.54, -2.54, round(1.7, 1.0)));
        }
        return { pins, body: [rect(-1.27, -3.81, n * 2.54, 5.08)] };
      },
    },
    {
      id: 'jst-xh', group: 'Conectores e chaves', name: 'Conector JST XH (2,50 mm)', prefix: 'J', namedPins: true,
      hint: 'B·B-XH-A · pad 1,7 × 2,0 / furo 0,95',
      param: { label: 'Pinos', options: [2, 3, 4, 5, 6], def: 2 },
      src: 'JST XH, B nB-XH-A: passo 2,50 mm, corpo (n−1)·2,5 + 4,9 × 5,75 mm',
      build: n => {
        const pins = [];
        for (let i = 0; i < n; i++) pins.push(pin(i + 1, i * 2.5, 0, pad(i === 0 ? 'rect' : 'oval', 1.7, 2.0, 0.95)));
        return { pins, body: [rect(-2.45, -2.35, (n - 1) * 2.5 + 4.9, 5.75), line(-2.45, 2.6, (n - 1) * 2.5 + 2.45, 2.6)] };
      },
    },
    {
      id: 'borne', group: 'Conectores e chaves', name: 'Borne KF301 (5,08 mm)', prefix: 'J', namedPins: true,
      hint: 'pad 2,4 / furo 1,3',
      param: { label: 'Vias', options: [2, 3], def: 2 },
      src: 'KF301-5.08: passo 5,08 mm, corpo n·5,08 × 7,5 mm, terminal 1,0 mm',
      build: n => {
        const pins = [];
        for (let i = 0; i < n; i++) pins.push(pin(i + 1, i * 5.08, 0, i === 0 ? square(2.4, 1.3) : round(2.4, 1.3)));
        const body = [rect(-2.54, -3.5, n * 5.08, 7.5)];
        for (let i = 0; i < n; i++) body.push(circle(i * 5.08, -1.6, 1.4));
        return { pins, body };
      },
    },
    {
      id: 'tact6', group: 'Conectores e chaves', name: 'Botão tátil 6×6 mm (4 pinos)', prefix: 'SW',
      hint: 'furação 6,5 × 4,5 mm · A1=A2 e B1=B2 ligados por dentro',
      src: 'Chave tátil 6×6 (Omron B3F-1000 / TS-1187): terminais 6,5 × 4,5 mm, furo Ø 1,0 mm',
      build: () => ({
        pins: [
          pin(1, 0, 0, round(2.0, 1.0), 'A1'), pin(2, 6.5, 0, round(2.0, 1.0), 'A2'),
          pin(3, 0, 4.5, round(2.0, 1.0), 'B1'), pin(4, 6.5, 4.5, round(2.0, 1.0), 'B2'),
        ],
        body: [rect(0.25, -0.75, 6.0, 6.0, 0.3), circle(3.25, 2.25, 1.75)],
        internal: [[0, 1], [2, 3]],
      }),
    },
    {
      id: 'crystal', group: 'Conectores e chaves', name: 'Cristal HC-49/US', prefix: 'Y',
      hint: 'passo 4,88 mm · pad 1,5 / furo 0,8',
      src: 'HC-49/US: corpo 11,0 × 4,65 mm, terminais a 4,88 mm',
      build: () => ({
        pins: [pin(1, 0, 0, round(1.5, 0.8)), pin(2, 4.88, 0, round(1.5, 0.8))],
        body: [rect(2.44 - 5.5, -2.325, 11.0, 4.65, 2.325)],
      }),
    },
    {
      id: 'buzzer', group: 'Conectores e chaves', name: 'Buzzer 12 mm (TMB12A05)', prefix: 'BZ',
      hint: 'passo 7,6 mm · pad 1,8 / furo 1,0',
      src: 'TMB12A05: Ø 12,0 mm, terminais a 7,6 mm',
      build: () => ({
        pins: [pin(1, 0, 0, square(1.8, 1.0), '+'), pin(2, 7.6, 0, round(1.8, 1.0), '−')],
        body: [circle(3.8, 0, 6.0), plus(3.8 - 6.8, -3.8), circle(3.8, 0, 1.0)],
      }),
    },

    // ---------------- Módulos ----------------
    {
      id: 'nano', group: 'Módulos', name: 'Arduino Nano', prefix: 'A',
      hint: 'placa 45 × 18 mm · fileiras a 15,24 mm',
      src: 'Arduino Nano (Rev3): 18 × 45 mm, 2 × 15 pinos 2,54 mm',
      build: () => {
        const bottom = ['TX1', 'RX0', 'RST', 'GND', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12'];
        const top = ['D13', '3V3', 'AREF', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', '5V', 'RST', 'GND', 'VIN'];
        const pins = [];
        bottom.forEach((n, i) => pins.push(pin(i + 1, i * 2.54, 0, i === 0 ? square(1.6, 1.0) : round(1.6, 1.0), n)));
        top.forEach((n, i) => pins.push(pin(16 + i, (14 - i) * 2.54, -15.24, round(1.6, 1.0), n)));
        const cx = 17.78;
        // os dois GND são o mesmo nó dentro da placa do Arduino
        return { pins, body: [rect(cx - 22.5, -7.62 - 9, 45, 18, 0.5), rect(cx + 22.5 - 7.5, -7.62 - 3.75, 9.2, 7.5)], internal: [[3, 28]] };
      },
    },
    {
      id: 'esp32', group: 'Módulos', name: 'ESP32 DevKit V1 (30 pinos)', prefix: 'A',
      hint: 'placa 51,4 × 28,3 mm · fileiras a 25,4 mm',
      src: 'DOIT ESP32 DevKit V1 30 pinos: 28,3 × 51,4 mm (varia entre fabricantes — confira)',
      build: () => {
        const left = ['EN', 'VP', 'VN', 'D34', 'D35', 'D32', 'D33', 'D25', 'D26', 'D27', 'D14', 'D12', 'D13', 'GND', 'VIN'];
        const right = ['D23', 'D22', 'TX0', 'RX0', 'D21', 'D19', 'D18', 'D5', 'TX2', 'RX2', 'D4', 'D2', 'D15', 'GND', '3V3'];
        const pins = [];
        left.forEach((n, i) => pins.push(pin(i + 1, 0, i * 2.54, i === 0 ? square(1.6, 1.0) : round(1.6, 1.0), n)));
        right.forEach((n, i) => pins.push(pin(16 + i, 25.4, i * 2.54, round(1.6, 1.0), n)));
        // os dois GND são o mesmo nó dentro do módulo
        return { pins, body: [rect(12.7 - 14.15, -12.0, 28.3, 51.4, 0.5), rect(12.7 - 4, 37.4, 8, 3), rect(12.7 - 9, -11.2, 18, 6.2)], internal: [[13, 28]] };
      },
    },
  ];

  root.PCB_LIBRARY = LIBRARY;
})(typeof window !== 'undefined' ? window : globalThis);
