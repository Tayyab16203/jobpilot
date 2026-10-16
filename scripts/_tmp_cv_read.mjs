// Read the CV text by rendering the PDF in the debug Chrome (via pdf.js in-page).
import { getContext } from '../src/agent/browser.js';
import fs from 'fs';
import path from 'path';

const cvPath = path.resolve('data/uploads/Tayyab-Ur-Rehman-CV.pdf');
const bytes = Array.from(fs.readFileSync(cvPath)); // pass bytes into the page
const ctx = await getContext();
const page = await ctx.newPage();
page.setDefaultTimeout(60000);

// Load a real https page first so the CDN script + worker are same-protocol and allowed.
await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
const text = await page.evaluate(async (byteArr) => {
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  await new Promise((res, rej) => { s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  const pdfjsLib = window['pdfjs-dist/build/pdf'] || window.pdfjsLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const data = new Uint8Array(byteArr);
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  let out = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i);
    const tc = await pg.getTextContent();
    out += tc.items.map(it => it.str).join(' ') + '\n\n';
  }
  return out;
}, bytes).catch(e => 'ERR: ' + e.message);

console.log('=== CV TEXT ===');
console.log(text);
await page.close().catch(() => {});
process.exit(0);
