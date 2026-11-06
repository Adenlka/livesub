// Build: npm run build  -> apps/extension/dist (load directly with 'Load unpacked') and apps/desktop/dist
import * as esbuild from 'esbuild';
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = (...p) => path.join(root, ...p);
const watch = process.argv.includes('--watch');

// Use the onnxruntime-web copy that transformers.js depends on (versions must match)
const ortDir = [r('node_modules/@huggingface/transformers/node_modules/onnxruntime-web'), r('node_modules/onnxruntime-web')].find(existsSync);
const CORE = r('packages/core/src');

async function copyOrt(dest) {
  await mkdir(dest, { recursive: true });
  for (const f of await readdir(path.join(ortDir, 'dist'))) {
    if (/^ort-wasm-simd-threaded\.asyncify\.(mjs|wasm)$/.test(f)) await cp(path.join(ortDir, 'dist', f), path.join(dest, f));
  }
}

const common = {
  bundle: true, platform: 'browser', target: ['chrome116'], logLevel: 'info',
  sourcemap: watch ? 'inline' : false, minify: !watch, legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
};

async function buildExtension() {
  const out = r('apps/extension/dist');
  if (existsSync(out)) await rm(out, { recursive: true, force: true }).catch(() => {});
  await mkdir(out, { recursive: true });
  await cp(r('apps/extension/static'), out, { recursive: true });
  await cp(path.join(CORE, 'capture-worklet.js'), path.join(out, 'capture-worklet.js'));
  await copyOrt(path.join(out, 'ort'));
  const src = (f) => r('apps/extension/src', f);
  await esbuild.build({ ...common, format: 'esm', outdir: out,
    entryPoints: { background: src('background.js'), popup: src('popup.js'), offscreen: src('offscreen.js'), 'asr-worker': path.join(CORE, 'asr-worker.js') } });
  await esbuild.build({ ...common, format: 'iife', outfile: path.join(out, 'content.js'), entryPoints: [src('content.js')] });
}

async function buildDesktop() {
  const out = r('apps/desktop/dist');
  const ren = path.join(out, 'renderer');
  if (existsSync(out)) await rm(out, { recursive: true, force: true }).catch(() => {});
  await mkdir(ren, { recursive: true });
  await cp(r('apps/desktop/static'), ren, { recursive: true });
  await cp(path.join(CORE, 'capture-worklet.js'), path.join(ren, 'capture-worklet.js'));
  await copyOrt(path.join(ren, 'ort'));
  const src = (f) => r('apps/desktop/src', f);
  await esbuild.build({ ...common, format: 'esm', outdir: ren,
    entryPoints: { control: src('renderer/control.js'), overlay: src('renderer/overlay.js'), 'asr-worker': path.join(CORE, 'asr-worker.js') } });
  // Electron main process and preload (CommonJS)
  await esbuild.build({ ...common, platform: 'node', format: 'cjs', target: ['node22'], external: ['electron'], outdir: out,
    entryPoints: { main: src('main/main.js'), preload: src('main/preload.js') } });
}

const which = process.argv[2];
if (!which || which === 'extension') await buildExtension();
if (!which || which === 'desktop') await buildDesktop();
console.log('✔ build done');
