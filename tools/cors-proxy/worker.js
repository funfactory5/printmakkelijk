// Optional: a tiny CORS proxy for PrintMakkelijk on Cloudflare Workers (free tier).
// Some model websites block downloads that start from another web page (CORS).
// Deploy this worker, then paste its URL in PrintMakkelijk → Instellingen → Proxy.
//
//   Usage: https://<your-worker>.workers.dev/?url=<encoded file url>
//
// Only file hosts in ALLOWED_HOSTS are proxied and only GET is allowed, so the
// worker cannot be abused as an open proxy. Set ALLOWED_ORIGIN to your
// GitHub Pages address (e.g. https://<user>.github.io).

const ALLOWED_ORIGIN = '*';
const ALLOWED_HOSTS = [
  'thingiverse.com', 'cdn.thingiverse.com', 'api.thingiverse.com',
  'printables.com', 'files.printables.com', 'media.printables.com',
  'makerworld.com', 'makerworld.bblmw.com',
  'thangs.com', 'cults3d.com', 'myminifactory.com',
  'githubusercontent.com', 'github.com',
];
const MAX_BYTES = 150 * 1024 * 1024;

export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'GET') return new Response('Only GET', { status: 405, headers: cors });

    const target = new URL(request.url).searchParams.get('url');
    let url;
    try { url = new URL(target); } catch { return new Response('Missing ?url=', { status: 400, headers: cors }); }
    const allowed = url.protocol === 'https:' && ALLOWED_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h));
    if (!allowed) return new Response('Host not allowed', { status: 403, headers: cors });

    const upstream = await fetch(url.toString(), { redirect: 'follow', headers: { 'User-Agent': 'PrintMakkelijk-proxy' } });
    const len = +upstream.headers.get('content-length') || 0;
    if (len > MAX_BYTES) return new Response('File too large', { status: 413, headers: cors });
    const headers = new Headers(cors);
    headers.set('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    if (len) headers.set('Content-Length', String(len));
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
