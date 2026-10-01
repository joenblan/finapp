// Bundles src/ into ONE self-contained file: dist/financien.html (JS + CSS inline).
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => path.join(rootDir, 'src', p);

const common = { bundle: true, write: false, target: 'es2022', legalComments: 'none', logLevel: 'warning' };
const js = await build({ ...common, entryPoints: [src('main.js')], format: 'iife', minify: false });
const css = await build({ ...common, entryPoints: [src('ui/styles.css')], minify: true });

let jsText = js.outputFiles[0].text;
const cssText = css.outputFiles[0].text;
// Never let bundled code close the inline <script> element early.
jsText = jsText.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

// Guard: the single-file app must not reference the network.
const forbidden = /\b(fetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\b|https?:\/\/(?!www\.w3\.org)/;
const hit = jsText.match(forbidden) || cssText.match(/url\(\s*['"]?https?:/);
if (hit) {
  console.error(`Build geweigerd: netwerkverwijzing gevonden: ${hit[0]}`);
  process.exit(1);
}

const template = await readFile(src('index.html'), 'utf8');
const html = template.replace('/*__CSS__*/', () => cssText).replace('/*__JS__*/', () => jsText);
await mkdir(path.join(rootDir, 'dist'), { recursive: true });
const out = path.join(rootDir, 'dist', 'financien.html');
await writeFile(out, html, 'utf8');
console.log(`OK: ${path.relative(rootDir, out)} (${Math.round(html.length / 1024)} kB)`);
