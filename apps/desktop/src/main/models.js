// Desktop model manager: downloads to <userData>/models/<id>/<file>, with progress, host fallback and .part temp files
const { net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

async function downloadTo(urls, dest, onProgress, sizeHint) {
  let lastErr;
  for (const url of urls) {
    const part = dest + '.part';
    try {
      const r = await net.fetch(url, { redirect: 'follow' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const total = Number(r.headers.get('content-length')) || sizeHint || 0;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const out = fs.createWriteStream(part);
      let loaded = 0, last = 0;
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        loaded += value.length;
        if (!out.write(value)) await new Promise(res => out.once('drain', res));
        if (loaded - last > 2e6) { last = loaded; onProgress(loaded, Math.max(total, loaded)); }
      }
      await new Promise((res, rej) => out.end(err => err ? rej(err) : res()));
      if (total && loaded < total * 0.99) throw new Error('下载不完整');
      fs.renameSync(part, dest);
      onProgress(loaded, loaded);
      return;
    } catch (e) {
      try { fs.rmSync(part, { force: true }); } catch {}
      lastErr = new Error(`${new URL(url).host}：${e.message}`);
    }
  }
  throw lastErr;
}

/** @param {{id:string, files:string[], urls:Record<string,string[]>, size:number}[]} specs */
async function ensureModels(root, specs, onProgress) {
  const todo = [];
  for (const s of specs) for (const f of s.files) {
    const dest = path.join(root, s.id, f);
    if (!fs.existsSync(dest)) todo.push({ dest, urls: s.urls[f], size: f.endsWith('.onnx') ? s.size : 0, label: s.name });
  }
  for (const t of todo) await downloadTo(t.urls, t.dest, (l, tot) => onProgress({ label: t.label, loaded: l, total: tot }), t.size);
  return { downloaded: todo.length };
}

function modelInfo(root) {
  let bytes = 0;
  const walk = (d) => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else bytes += fs.statSync(p).size; } };
  walk(root);
  return { dir: root, bytes };
}

module.exports = { ensureModels, modelInfo };
