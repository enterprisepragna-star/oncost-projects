// GET /api/sitemap  →  /sitemap.xml  (via vercel.json rewrite)
//
// Dynamically builds sitemap.xml from Supabase:
//   - static pages (homepage, shop, corporate, return-gifts, etc.)
//   - every Active product → /product.html?id=<uuid>
//   - every Active category → /products.html?cat=<name>
//
// Cached at the edge for 1 hour (s-maxage=3600).

const SITE = 'https://www.oncost.shop';

const STATIC_PAGES = [
  { loc: '/',                    priority: '1.0', changefreq: 'daily'   },
  { loc: '/products.html',       priority: '0.9', changefreq: 'daily'   },
  { loc: '/shop.html',           priority: '0.9', changefreq: 'daily'   },
  { loc: '/corporate-gifting.html', priority: '0.8', changefreq: 'weekly' },
  { loc: '/return-gifts.html',   priority: '0.8', changefreq: 'weekly'  },
  { loc: '/bulk.html',           priority: '0.7', changefreq: 'weekly'  },
  { loc: '/about-us.html',       priority: '0.6', changefreq: 'monthly' },
  { loc: '/contact-us.html',     priority: '0.6', changefreq: 'monthly' },
  { loc: '/support.html',        priority: '0.4', changefreq: 'monthly' },
  { loc: '/login.html',          priority: '0.3', changefreq: 'yearly'  },
  { loc: '/signup.html',         priority: '0.3', changefreq: 'yearly'  },
];

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function urlBlock({ loc, lastmod, changefreq, priority, image }) {
  return `  <url>
    <loc>${xmlEscape(loc)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}${changefreq ? `\n    <changefreq>${changefreq}</changefreq>` : ''}${priority ? `\n    <priority>${priority}</priority>` : ''}${image ? `\n    <image:image><image:loc>${xmlEscape(image)}</image:loc></image:image>` : ''}
  </url>`;
}

module.exports = async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const urls = STATIC_PAGES.map(p => urlBlock({
    loc: SITE + p.loc,
    priority: p.priority,
    changefreq: p.changefreq,
  }));

  // Products + categories from Supabase (best-effort — sitemap still works if DB is down)
  if (SUPABASE_URL && SERVICE_KEY) {
    try {
      const pRes = await fetch(
        `${SUPABASE_URL}/rest/v1/products?select=id,name,image_url,updated_at,status&status=eq.Active&order=updated_at.desc&limit=2000`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
      );
      const products = await pRes.json();
      if (Array.isArray(products)) {
        products.forEach(p => urls.push(urlBlock({
          loc: `${SITE}/product.html?id=${encodeURIComponent(p.id)}`,
          lastmod: p.updated_at ? p.updated_at.slice(0, 10) : null,
          changefreq: 'weekly',
          priority: '0.7',
          image: p.image_url || null,
        })));
      }
    } catch (e) { console.error('[sitemap] product fetch failed:', e.message); }

    try {
      const cRes = await fetch(
        `${SUPABASE_URL}/rest/v1/categories?select=name,updated_at&order=name.asc&limit=200`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
      );
      const cats = await cRes.json();
      if (Array.isArray(cats)) {
        cats.forEach(c => urls.push(urlBlock({
          loc: `${SITE}/products.html?cat=${encodeURIComponent(c.name)}`,
          lastmod: c.updated_at ? c.updated_at.slice(0, 10) : null,
          changefreq: 'weekly',
          priority: '0.6',
        })));
      }
    } catch (e) { console.error('[sitemap] category fetch failed:', e.message); }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.join('\n')}
</urlset>`;

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(xml);
};

module.exports.config = { api: { bodyParser: false } };
