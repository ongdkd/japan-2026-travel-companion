// Resolves a maps.app.goo.gl short link to the long google.com/maps/place/... URL.
//
// Why this exists: a browser cannot read a cross-origin redirect, so the app has to ask something
// else to follow the link. The public CORS proxies it falls back on are unreliable — they time out,
// and they follow the whole redirect chain, which loses the one thing we need. Google's very first
// response already carries the answer in its Location header:
//
//   GET https://maps.app.goo.gl/WobMLT1MdMGF7Pby6
//   302 Location: https://www.google.com/maps/place/...〒110-0005 Tokyo...四万十屋 上野店/data=...
//
// So this reads that header and returns nothing else. redirect: 'manual' is the whole trick.
//
// Deploy (free, no card):
//   1. https://workers.cloudflare.com → Create Worker → paste this → Deploy
//   2. Copy the worker URL (https://<name>.<subdomain>.workers.dev)
//   3. Put it in MAPS_RESOLVER_URL at the top of dist/app.js
//
// Or with wrangler:  npx wrangler deploy maps-resolver/worker.js --name maps-resolver

const ALLOWED_HOSTS = ['maps.app.goo.gl', 'goo.gl', 'g.co', 'maps.google.com'];

export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Cache-Control': 'public, max-age=86400'
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const target = new URL(request.url).searchParams.get('url');
    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      return Response.json({ error: 'bad url' }, { status: 400, headers: cors });
    }
    // Open redirect resolvers get abused; only Google's own short-link hosts are worth following.
    if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.includes(parsed.hostname.replace(/^www\./, ''))) {
      return Response.json({ error: 'host not allowed' }, { status: 400, headers: cors });
    }

    try {
      const response = await fetch(parsed.href, { redirect: 'manual' });
      const location = response.headers.get('location') || '';
      return Response.json({ url: location, status: response.status }, { headers: cors });
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 502, headers: cors });
    }
  }
};
