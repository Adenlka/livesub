// Model file access: a local URL (desktop: already on disk) or remote download + Cache Storage (extension)
import { MODELS, modelUrls } from './config.js';

const CACHE = 'livesub-models-v1';
const cacheKey = (id, file) => `https://livesub.invalid/models/${id}/${file}`;

async function openCache() {
  try { return await caches.open(CACHE); } catch { return null; }
}

/**
 * @param {string} id   key in MODELS
 * @param {string} file
 * @param {{host?:string, localBase?:string, onProgress?:(loaded:number,total:number)=>void}} o
 * @returns {Promise<Uint8Array>}
 */
export async function getModelFile(id, file, { host = 'hf', localBase, onProgress } = {}) {
  if (localBase) return download([`${localBase}${id}/${file}`], onProgress);
  const cache = await openCache();
  const hit = await cache?.match(cacheKey(id, file));
  if (hit) {
    const b = new Uint8Array(await hit.arrayBuffer());
    onProgress?.(b.length, b.length);
    return b;
  }
  const bytes = await download(modelUrls(id, file, host), onProgress, MODELS[id]?.size);
  try { await cache?.put(cacheKey(id, file), new Response(bytes)); } catch { /* out of space etc.: download again next time */ }
  return bytes;
}

export async function isModelCached(id) {
  const cache = await openCache();
  if (!cache) return false;
  for (const f of MODELS[id].files) if (!(await cache.match(cacheKey(id, f)))) return false;
  return true;
}

export async function deleteCachedModels() {
  try { await caches.delete(CACHE); } catch {}
}

async function download(urls, onProgress, sizeHint = 0) {
  let lastErr;
  for (const url of urls) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const total = Number(r.headers.get('content-length')) || sizeHint;
      if (!r.body) { const b = new Uint8Array(await r.arrayBuffer()); onProgress?.(b.length, b.length); return b; }
      const reader = r.body.getReader();
      const chunks = []; let loaded = 0, lastReport = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); loaded += value.length;
        if (loaded - lastReport > 2e6) { lastReport = loaded; onProgress?.(loaded, Math.max(total, loaded)); }
      }
      const out = new Uint8Array(loaded); let o = 0;
      for (const c of chunks) { out.set(c, o); o += c.length; }
      onProgress?.(loaded, loaded);
      return out;
    } catch (e) { lastErr = new Error(`${url.split('/').slice(2, 3)} 下载失败：${e.message}`); }
  }
  throw lastErr ?? new Error('没有可用的下载地址');
}
