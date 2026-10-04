// Gerador de PDF em escala real.
const { PCBPdf } = require('./helpers');

const asText = bytes => Buffer.from(bytes).toString('latin1');

describe('PDF em milímetros', () => {
  test('página A4 tem o MediaBox exato (595,276 × 841,89 pt)', () => {
    const doc = new PCBPdf.PDFDoc();
    doc.addPage(210, 297);
    const s = asText(doc.build());
    const m = s.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
    expect(+m[1]).toBeCloseTo(210 * 72 / 25.4, 2);
    expect(+m[2]).toBeCloseTo(297 * 72 / 25.4, 2);
  });

  test('desenho em mm: matriz de 72/25,4 pt por mm e y para baixo', () => {
    const doc = new PCBPdf.PDFDoc();
    doc.addPage(100, 50);
    expect(asText(doc.build())).toContain('2.835 0 0 -2.835 0 141.732 cm');
  });

  test('largura da trilha sai em mm no PDF', () => {
    const doc = new PCBPdf.PDFDoc();
    doc.addPage(100, 50).polyline([[0, 0], [10, 0]], 0.8, '#000000');
    expect(asText(doc.build())).toContain('0 0 0 RG\n0.8 w\n1 J 1 j\n0 0 m 10 0 l S');
  });

  test('tabela xref aponta para o início de cada objeto', () => {
    const doc = new PCBPdf.PDFDoc({ title: 'teste' });
    const p = doc.addPage(210, 297);
    p.text('Ligação (Ø 1,0 mm) — µF', 10, 10, 3);
    p.fillCircle(50, 50, 5, '#ff0000');
    const s = asText(doc.build());
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    const xref = +s.match(/startxref\n(\d+)/)[1];
    expect(s.slice(xref, xref + 4)).toBe('xref');
    const offsets = [...s.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => +m[1]);
    offsets.forEach((o, i) => expect(s.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });

  test('acentos e símbolos viram WinAnsi (sem "?" no lugar)', () => {
    const doc = new PCBPdf.PDFDoc();
    doc.addPage(100, 50).text('ção Ø µ × —', 0, 10, 3);
    const s = asText(doc.build());
    const lit = s.match(/\((.*)\) Tj/)[1];
    expect(lit).not.toContain('?');
    expect(lit).toContain('\\330'); // Ø
    expect(lit).toContain('\\265'); // µ
  });

  test('texto vertical: matriz girada 90°, lendo de baixo para cima', () => {
    const doc = new PCBPdf.PDFDoc();
    doc.addPage(100, 50).text('GND', 10, 20, 2, { vertical: true, anchor: 'start', base: 'alphabetic' });
    expect(Buffer.from(doc.build()).toString('latin1')).toContain('0 -1 -1 0 10 20 Tm (GND) Tj');
  });

  test('régua: textWidth cresce com o texto e com o tamanho', () => {
    expect(PCBPdf.textWidth('MOSI', 2)).toBeGreaterThan(PCBPdf.textWidth('IO', 2));
    expect(PCBPdf.textWidth('MOSI', 4)).toBeCloseTo(PCBPdf.textWidth('MOSI', 2) * 2, 6);
  });
});
