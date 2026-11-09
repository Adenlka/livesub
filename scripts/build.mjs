// Build: npm run build [extension|desktop]
//     apps/extension/dist -- load this folder in Chrome with 'Load unpacked'
//     apps/desktop/dist   -- Electron main process + pages
import * as esbuild from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = (...p) => path.join(root, ...p);
const dev = process.argv.includes('--dev');
const CORE = r('packages/core/src');
const ORT = r('node_modules/onnxruntime-web/dist');

const common = {
  bundle: true, platform: 'browser', target: ['chrome116'], logLevel: 'warning',
  sourcemap: dev ? 'inline' : false, minify: !dev, legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
};

/** Runtime assets shared by both platforms: recognition/segmenter workers, AudioWorklet, ONNX Runtime wasm, Silero VAD */
export async function buildRuntime(out) {
  await mkdir(path.join(out, 'ort'), { recursive: true });
  await mkdir(path.join(out, 'models'), { recursive: true });
  for (const f of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) await cp(path.join(ORT, f), path.join(out, 'ort', f));
  await cp(r('packages/core/assets/silero_vad.onnx'), path.join(out, 'models/silero_vad.onnx'));
  await cp(r('packages/core/assets/sensevoice-cmvn.json'), path.join(out, 'models/sensevoice-cmvn.json'));
  await cp(path.join(CORE, 'capture-worklet.js'), path.join(out, 'capture-worklet.js'));
  await esbuild.build({ ...common, format: 'esm', outdir: out, splitting: false,
    entryPoints: { 'asr-worker': path.join(CORE, 'asr-worker.js'), 'vad-worker': path.join(CORE, 'vad-worker.js') } });
}

async function fresh(dir) {
  if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
}

async function buildExtension() {
  const out = r('apps/extension/dist');
  await fresh(out);
  await cp(r('apps/extension/static'), out, { recursive: true });
  await buildRuntime(out);
  const src = (f) => r('apps/extension/src', f);
  await esbuild.build({ ...common, format: 'esm', outdir: out,
    entryPoints: { background: src('background.js'), popup: src('popup.js'), offscreen: src('offscreen.js'), sidepanel: src('sidepanel.js') } });
  await esbuild.build({ ...common, format: 'iife', outfile: path.join(out, 'content.js'), entryPoints: [src('content.js')] });
}

async function buildDesktop() {
  const out = r('apps/desktop/dist');
  const ren = path.join(out, 'renderer');
  await fresh(out);
  await cp(r('apps/desktop/static'), ren, { recursive: true });
  await buildRuntime(ren);
  const src = (f) => r('apps/desktop/src', f);
  await esbuild.build({ ...common, format: 'esm', outdir: ren,
    entryPoints: { control: src('renderer/control.js'), overlay: src('renderer/overlay.js') } });
  await esbuild.build({ ...common, platform: 'node', format: 'cjs', target: ['node22'], external: ['electron'], outdir: out,
    entryPoints: { main: src('main/main.js'), preload: src('main/preload.js') } });
}


const which = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
if (!which || which === 'extension') await buildExtension();
if (!which || which === 'desktop') await buildDesktop();
console.log('✔ build', which ?? 'all');
