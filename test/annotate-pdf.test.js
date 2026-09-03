const test = require('node:test');
const assert = require('node:assert/strict');
const { create, quadraticPathToPdf, pdfString } = require('../_extensions/Pat-Laub/annotate/annotate-pdf.js');

test('quadratic freehand paths become exact cubic PDF paths', () => {
  assert.equal(
    quadraticPathToPdf('M 0 0 Q 3 6 6 0 9 -6 12 0 Z'),
    '0 0 m\n2 4 4 4 6 0 c\n8 -4 10 -4 12 0 c\nh'
  );
  assert.throws(() => quadraticPathToPdf('M 0 0 Q 3 6'), /Invalid SVG path data/);
});

test('PDF text escapes punctuation and common WinAnsi characters safely', () => {
  assert.equal(pdfString('Cost (net) \\ “high”'), '(Cost \\(net\\) \\\\ \\223high\\224)');
  assert.equal(pdfString('unsupported π'), '(unsupported ?)');
});

test('direct PDF output has widescreen pages, ruled guides and vector ink', () => {
  const pdf = create({
    width: 1244,
    height: 700,
    rules: [64, 116],
    ruleMargin: 64,
    pages: [
      { strokes: [
        { tool: 'highlighter', colour: '#facc15', path: 'M 10 20 Q 20 30 30 20 Z' },
        { tool: 'pen', colour: '#2668c7', path: 'M 100 200 Q 110 210 120 200 Z' }
      ], text: [{
        x: 80, y: 100, fontSize: 32, lineHeight: 40, padding: 5,
        colour: '#252525', lines: ['First line', 'Second line']
      }] },
      { strokes: [] }
    ]
  });
  const text = Buffer.from(pdf).toString('ascii');
  assert.match(text, /^%PDF-1\.7/);
  assert.match(text, /\/Count 2/);
  assert.match(text, /\/MediaBox \[0 0 959\.6571 540\]/);
  assert.match(text, /\/BM \/Multiply/);
  assert.match(text, /\/BaseFont \/Helvetica/);
  assert.match(text, /\(First line\) Tj/);
  assert.match(text, /\(Second line\) Tj/);
  assert.match(text, /64 64 m 1180 64 l S/);
  assert.match(text, /0\.149 0\.4078 0\.7804 rg/);
  assert.match(text, /%%EOF\n$/);

  const xrefAt = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.equal(text.slice(xrefAt, xrefAt + 4), 'xref');
  const entries = text.slice(xrefAt).match(/^\d{10} 00000 n /gm) || [];
  entries.forEach((entry, index) => {
    const offset = Number(entry.slice(0, 10));
    assert.equal(text.slice(offset, offset + String(index + 1).length + 6), `${index + 1} 0 obj`);
  });
});

// The other strategy: lay ink over a PDF published beside the deck, as an
// incremental update rather than a rewrite. Only classic xref tables are
// supported, which is what headless Chrome and PyMuPDF both write.
const { overlay, placement } = require('../_extensions/Pat-Laub/annotate/annotate-pdf.js');

// A stand-in for a printed deck whose page count and geometry the test controls.
function classicPdf(pageCount, width = 1248, height = 702) {
  const objects = [''];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  const kids = Array.from({ length: pageCount }, (_, i) => `${3 + i * 2} 0 R`).join(' ');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);
  for (let i = 0; i < pageCount; i++) {
    const page = 3 + i * 2, content = page + 1;
    objects[page] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << >> /Contents ${content} 0 R >>`;
    objects[content] = '<< /Length 0 >>\nstream\n\nendstream';
  }
  let source = '%PDF-1.4\n', offsets = [0];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = Buffer.byteLength(source);
    source += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const startxref = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) source += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  source += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(source, 'latin1'));
}

const inkedPage = () => ({
  pen: [{ colour: '#111111', path: 'M 80 100 Q 120 140 160 100 Z' }],
  highlighter: []
});

test('an overlay appends to the published PDF rather than rewriting it', () => {
  const original = classicPdf(3);
  const pages = [inkedPage(), { pen: [], highlighter: [] }, inkedPage()];
  const out = overlay(original, pages, { width: 1248, height: 702 });

  assert.ok(out.length > original.length, 'the overlay did not grow the file');
  // Incremental update: the original bytes are still there, untouched, in front.
  assert.deepEqual(Array.from(out.slice(0, original.length)), Array.from(original));

  const appended = Buffer.from(out.slice(original.length)).toString('latin1');
  assert.match(appended, /\/Type\s*\/Page(?!s)/, 'no page object was appended');
  assert.match(appended, /startxref/, 'no fresh xref was appended');
  assert.match(appended, /\/Prev\s+\d+/, 'the new trailer does not point at the old xref');
});

test('a deck with no ink on a page leaves that page alone', () => {
  const original = classicPdf(2);
  const out = overlay(original, [inkedPage(), { pen: [], highlighter: [] }],
                      { width: 1248, height: 702 });
  const appended = Buffer.from(out.slice(original.length)).toString('latin1');
  const pageObjects = appended.match(/\/Type\s*\/Page(?!s)/g) || [];
  assert.equal(pageObjects.length, 1, 'an untouched page was rewritten anyway');
});

test('ink is placed against the page box it is given', () => {
  // The box is a PDF MediaBox: [x0, y0, x1, y1], with y running upwards.
  const spot = placement([0, 0, 1248, 702], { width: 1248, height: 702 });
  assert.equal(spot.sx, 1);
  assert.equal(spot.sy, 1);
  assert.equal(spot.x, 0);
  // Slide coordinates run downwards, so the origin moves to the page top.
  assert.equal(spot.y, 702);

  // A page printed at twice the size scales the ink with it.
  const bigger = placement([0, 0, 2496, 1404], { width: 1248, height: 702 });
  assert.equal(bigger.sx, 2);
  assert.equal(bigger.sy, 2);
});
