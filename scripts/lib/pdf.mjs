/**
 * A minimal PDF writer for the job search eval's fictional resumes, with no dependencies: text
 * pages in Helvetica, one or two columns each, or one page that is only a grey image. Enough for
 * a model to read; not a general PDF library.
 */
import { deflateSync } from 'node:zlib';

// PDF strings escape backslashes and brackets; anything outside printable ASCII becomes '?'.
const escape = (text) =>
  text.replace(/[\\()]/g, (char) => `\\${char}`).replace(/[^\x20-\x7e]/g, '?');

function wrap(text, width) {
  const lines = [];

  for (const paragraph of text.split('\n')) {
    let line = '';

    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > width) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }

    lines.push(line);
  }

  return lines;
}

// One page's text: each column down from its top-left corner, 11-point Helvetica, 14-point leading.
function pageText(columns) {
  const width = columns.length === 1 ? 90 : 42;
  const lefts = columns.length === 1 ? [56] : [56, 320];

  return columns
    .map((column, index) =>
      [
        'BT',
        '/F1 11 Tf',
        '14 TL',
        `${lefts[index]} 770 Td`,
        ...wrap(column, width)
          .slice(0, 50)
          .map((line) => `(${escape(line)}) '`),
        'ET',
      ].join('\n'),
    )
    .join('\n');
}

const stream = (dict, data) =>
  Buffer.concat([
    Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, 'latin1'),
    data,
    Buffer.from('\nendstream', 'latin1'),
  ]);

// Objects numbered from 1, the first being the catalog, with their cross-reference table.
function pdf(objects) {
  const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets = [];
  let length = chunks[0].length;

  objects.forEach((body, index) => {
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, 'latin1'),
      Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'),
      Buffer.from('\nendobj\n', 'latin1'),
    ]);

    offsets.push(length);
    chunks.push(chunk);
    length += chunk.length;
  });

  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    '0000000000 65535 f \n',
    ...offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`,
  ].join('');

  return new Uint8Array(Buffer.concat([...chunks, Buffer.from(xref, 'latin1')]));
}

/** Text pages: each page is one or two columns, a string each (`\n` breaks a line). */
export function textPdf(pages) {
  const kids = pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  pages.forEach((columns, index) => {
    objects.push(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
      stream('', Buffer.from(pageText(columns), 'latin1')),
    );
  });

  return pdf(objects);
}

/** One page that is only a grey image: `pixels` holds one byte per pixel, row by row. */
export function imagePdf(width, height, pixels) {
  const drawn = Buffer.from(`q 540 0 0 ${Math.round((540 * height) / width)} 36 100 cm /Im1 Do Q`);

  return pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>',
    stream(
      `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray ` +
        '/BitsPerComponent 8 /Filter /FlateDecode',
      deflateSync(pixels),
    ),
    stream('', drawn),
  ]);
}

/** Grey noise over faint bands, like a scan too blurred to read. Seeded, so every run matches. */
export function noise(width, height, seed = 7) {
  let state = seed;
  const next = () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;

    return state / 2_147_483_648;
  };
  const pixels = Buffer.alloc(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels[y * width + x] = Math.round(150 + 90 * next() - (y % 18 < 3 ? 60 : 0));
    }
  }

  return pixels;
}
