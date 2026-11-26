// Model sources: Thingiverse API (in-page search + download), other sites via links,
// direct links, and an optional user-owned CORS proxy.
import { isModelName, extOf } from './loaders.js';

const TV_API = 'https://api.thingiverse.com';

export const SITES = [
  { name: 'Printables', home: 'https://www.printables.com/', icon: '🟠', url: 'https://www.printables.com/search/models?q={q}' },
  { name: 'MakerWorld', home: 'https://makerworld.com/', icon: '🟢', url: 'https://makerworld.com/en/search/models?keyword={q}' },
  { name: 'Thingiverse', home: 'https://www.thingiverse.com/', icon: '🔵', url: 'https://www.thingiverse.com/search?q={q}&type=things' },
  { name: 'Thangs', home: 'https://thangs.com/', icon: '🟣', url: 'https://thangs.com/search/{q}?scope=all' },
  { name: 'Cults3D', home: 'https://cults3d.com/en', icon: '🟡', url: 'https://cults3d.com/en/search?q={q}&only_free=true' },
  { name: 'MyMiniFactory', home: 'https://www.myminifactory.com/', icon: '🔴', url: 'https://www.myminifactory.com/search/?query={q}' },
  { name: 'Yeggi', home: 'https://www.yeggi.com/', icon: '⚪', url: 'https://www.yeggi.com/q/{q}/' },
];

export const siteLinks = (q) => SITES.map((s) => ({ ...s, href: q ? s.url.replace('{q}', encodeURIComponent(q)) : s.home }));

// ---------------------------------------------------------------- fetching
export function proxied(url, proxy) {
  if (!proxy) return null;
  if (proxy.includes('{url}')) return proxy.replace('{url}', encodeURIComponent(url));
  return proxy + (proxy.includes('?') ? '&' : '?') + 'url=' + encodeURIComponent(url);
}

async function readWithProgress(res, onProgress) {
  const total = +res.headers.get('content-length') || 0;
  if (!res.body || !onProgress) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(got, total);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}

/** Download a file; tries each URL directly and then through the proxy. */
export async function fetchBinary(urls, { proxy, onProgress } = {}) {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
  const attempts = [];
  for (const u of list) attempts.push({ url: u, via: 'direct' });
  if (proxy) for (const u of list) attempts.push({ url: proxied(u, proxy), via: 'proxy' });
  let lastError = null;
  for (const a of attempts) {
    try {
      const res = await fetch(a.url, { mode: 'cors', credentials: 'omit', redirect: 'follow' });
      if (!res.ok) { lastError = new Error(`HTTP ${res.status}`); continue; }
      const type = res.headers.get('content-type') || '';
      if (/text\/html/.test(type)) { lastError = new Error('De link geeft een webpagina, geen modelbestand.'); continue; }
      return { buffer: await readWithProgress(res, onProgress), via: a.via, finalUrl: res.url };
    } catch (e) {
      lastError = e;
    }
  }
  const err = new Error(lastError && lastError.name === 'TypeError'
    ? 'De website staat downloaden vanuit een andere pagina niet toe (CORS).'
    : (lastError && lastError.message) || 'Downloaden mislukt.');
  err.cors = !lastError || lastError.name === 'TypeError';
  throw err;
}

// ---------------------------------------------------------------- Thingiverse
async function tv(path, token, params = {}) {
  const u = new URL(TV_API + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('access_token', token);
  let res;
  try {
    res = await fetch(u, { credentials: 'omit' });
  } catch (e) {
    throw new Error('Thingiverse is niet bereikbaar (netwerk of CORS).');
  }
  if (res.status === 401 || res.status === 403) throw new Error('Thingiverse-token wordt niet geaccepteerd. Controleer je App Token.');
  if (!res.ok) throw new Error(`Thingiverse gaf fout ${res.status}.`);
  return res.json();
}

export async function searchThingiverse(query, token, page = 1) {
  const data = await tv(`/search/${encodeURIComponent(query)}/`, token, { type: 'things', per_page: 24, page, sort: 'relevant' });
  const hits = Array.isArray(data) ? data : (data.hits || []);
  return {
    total: data.total || hits.length,
    items: hits.map((h) => ({
      id: h.id,
      name: h.name,
      thumb: h.preview_image || h.thumbnail,
      url: h.public_url || `https://www.thingiverse.com/thing:${h.id}`,
      creator: h.creator && (h.creator.name || h.creator.first_name) || '',
      likes: h.like_count || 0,
      license: h.license || '',
    })),
  };
}

export async function thingiverseFiles(thingId, token) {
  const files = await tv(`/things/${thingId}/files`, token);
  return (files || []).filter((f) => isModelName(f.name)).map((f) => ({
    id: f.id,
    name: f.name,
    size: f.size || 0,
    sizeText: f.formatted_size || '',
    thumb: f.thumbnail || '',
    urls: [
      f.direct_url,
      f.download_url && `${f.download_url}${f.download_url.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`,
      f.public_url,
    ].filter(Boolean),
  }));
}

// ---------------------------------------------------------------- links
/**
 * Understand a pasted link.
 * @returns {{kind:'thingiverse', id:string} | {kind:'file', urls:string[], name:string} | {kind:'page', site:string, url:string}}
 */
export function resolveLink(input) {
  let url;
  try { url = new URL(input.trim()); } catch (e) { throw new Error('Dat lijkt geen geldige link.'); }
  const host = url.hostname.replace(/^www\./, '');
  const tvm = /thing:(\d+)/.exec(url.href);
  if (host.endsWith('thingiverse.com') && tvm) return { kind: 'thingiverse', id: tvm[1], url: url.href };
  if (host === 'github.com') {
    const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/);
    if (m) {
      const raw = `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
      return { kind: 'file', urls: [raw], name: decodeURIComponent(m[3].split('/').pop()) };
    }
  }
  const fileName = decodeURIComponent(url.pathname.split('/').pop() || 'model');
  if (isModelName(fileName) || /download|raw|files?\//i.test(url.pathname)) {
    return { kind: 'file', urls: [url.href], name: isModelName(fileName) ? fileName : fileName + '.stl' };
  }
  const site = ['printables.com', 'makerworld.com', 'thangs.com', 'cults3d.com', 'myminifactory.com']
    .find((s) => host.endsWith(s));
  return { kind: 'page', site: site || host, url: url.href };
}

export { extOf };
