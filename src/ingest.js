// Turns uploaded files into message content blocks, entirely in the browser.
// PDFs and images go to Claude as they are. Word and Excel files are converted to text first.

const LIBS = {
  mammoth: 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js',
  xlsx: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
};
const loaded = {};
function loadScript(name) {
  if (!loaded[name]) {
    loaded[name] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LIBS[name];
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Could not load the ${name} reader. Check your connection.`));
      document.head.appendChild(s);
    });
  }
  return loaded[name];
}

const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const TEXT_TYPES = ['txt', 'md', 'csv', 'tsv', 'json'];
export const ACCEPT = '.pdf,.docx,.xlsx,.xls,.txt,.md,.csv,.png,.jpg,.jpeg,.webp';
export const LIMITS = { pdfBytes: 25 * 1024 * 1024, imageBytes: 5 * 1024 * 1024, textChars: 400000, files: 10 };

const ext = (name) => name.split('.').pop().toLowerCase();

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// Returns { name, kind, size, block, chars } or throws a readable error.
export async function ingestFile(file) {
  const e = ext(file.name);
  if (e === 'pdf') {
    if (file.size > LIMITS.pdfBytes) throw new Error(`${file.name} is over 25 MB.`);
    const data = toBase64(await file.arrayBuffer());
    return { name: file.name, kind: 'PDF', size: file.size, block: { type: 'document', title: file.name, source: { type: 'base64', media_type: 'application/pdf', data } } };
  }
  if (IMAGE_TYPES[e]) {
    if (file.size > LIMITS.imageBytes) throw new Error(`${file.name} is over 5 MB. Try a smaller screenshot.`);
    const data = toBase64(await file.arrayBuffer());
    return { name: file.name, kind: 'Image', size: file.size, block: { type: 'image', source: { type: 'base64', media_type: IMAGE_TYPES[e], data } } };
  }
  let text;
  let kind;
  if (e === 'docx') {
    await loadScript('mammoth');
    text = (await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
    kind = 'Word';
  } else if (e === 'xlsx' || e === 'xls') {
    await loadScript('xlsx');
    const book = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
    text = book.SheetNames.map((n) => `## Sheet: ${n}\n${window.XLSX.utils.sheet_to_csv(book.Sheets[n])}`).join('\n\n');
    kind = 'Excel';
  } else if (TEXT_TYPES.includes(e)) {
    text = await file.text();
    kind = 'Text';
  } else {
    throw new Error(`${file.name} is not a supported file type.`);
  }
  text = text.trim();
  if (!text) throw new Error(`${file.name} has no readable text.`);
  return {
    name: file.name,
    kind,
    size: file.size,
    chars: text.length,
    block: { type: 'text', text: `<document name="${file.name.replace(/"/g, '')}">\n${text}\n</document>` }
  };
}
