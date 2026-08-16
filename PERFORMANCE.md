# ONCOST Website — Performance Audit & Fix Plan

Audited: August 2026  
Stack: Static HTML + Vanilla JS + Supabase + Vercel CDN

---

## Summary

| # | Issue | Severity | Effort | Status |
|---|-------|----------|--------|--------|
| 1 | Render-blocking scripts in `<head>` | 🔴 Critical | Low | ⏳ Pending |
| 2 | Font Awesome loaded synchronously | 🔴 Critical | Low | ⏳ Pending |
| 3 | `app.js` unminified (106 KB) | 🟠 High | Medium | ⏳ Pending |
| 4 | No lazy loading on product images | 🟠 High | Low | ⏳ Pending |
| 5 | No image optimization / WebP | 🟠 High | Medium | ⏳ Pending |
| 6 | All 172 products loaded at once | 🟡 Medium | Medium | ⏳ Pending |
| 7 | No resource hints (preconnect) | 🟡 Medium | Low | ⏳ Pending |
| 8 | `admin.js` unminified (185 KB) | 🟡 Medium | Medium | ⏳ Pending |
| 9 | No browser caching headers | 🟡 Medium | Low | ⏳ Pending |
| 10 | No skeleton / loading states | 🟢 Low | Medium | ⏳ Pending |

---

## Issue 1 — Render-blocking scripts in `<head>`

### What was identified
Every page loads the Supabase SDK and `supabase-client.js` in `<head>` with no `defer` or `async`:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="supabase-client.js"></script>
```

The browser stops parsing the HTML and waits for both scripts to download and execute before rendering **anything** on screen. On a slow 4G connection this adds 1–3 seconds of blank screen.

### Fix
Add `defer` to both script tags across all HTML pages:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2" defer></script>
<script src="supabase-client.js" defer></script>
```

Do the same for `app.js`, `seo.js`, `theme-manager.js` on every page.

### Files to change
`index.html`, `products.html`, `product.html`, `cart.html`, `account.html`, `login.html`, `signup.html`, `bulk.html`, `contact.html`

### Expected improvement
- First Contentful Paint (FCP): −1 to −2 seconds on mobile
- Largest Contentful Paint (LCP): −0.5 to −1 second

---

## Issue 2 — Font Awesome loaded synchronously

### What was identified
Font Awesome (~180 KB CSS + icon font files) is loaded as a render-blocking stylesheet:

```html
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
```

This blocks rendering until the full icon library downloads even though only ~20 icons are used across the site.

### Fix — Option A (recommended): Load async
```html
<link rel="preload" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
      as="style" onload="this.onload=null;this.rel='stylesheet'" />
<noscript>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
</noscript>
```

### Fix — Option B (best): Use only needed icons
Generate a custom kit at [fontawesome.com/kits](https://fontawesome.com/kits) with only the ~20 icons you use. Reduces download from 180 KB to ~8 KB.

### Expected improvement
- FCP: −0.5 to −1 second on mobile
- Total blocking time: significant reduction

---

## Issue 3 — `app.js` unminified (106 KB)

### What was identified
`app.js` is 106 KB of unminified JavaScript with comments, whitespace, and long variable names. After minification it would be ~55–60 KB. After Brotli compression (which Vercel applies) it would be ~18–22 KB.

### Fix
Add a build step using a minifier. Simplest approach with `terser`:

```bash
npm install -g terser
terser app.js -o app.min.js --compress --mangle
```

Then update HTML references from `app.js` to `app.min.js`.

Or add to `package.json`:
```json
"scripts": {
  "build": "terser app.js -o app.min.js --compress --mangle && terser admin.js -o admin.min.js --compress --mangle"
}
```

### Expected improvement
- Script parse/execute time: −40% on low-end Android devices
- Transfer size: −80% (after Brotli)

---

## Issue 4 — No lazy loading on product images

### What was identified
All product images in the grid load simultaneously on page load, even those far below the fold. With 172 products this means the browser initiates 100+ image requests immediately, competing for bandwidth with critical resources.

### Fix
Add `loading="lazy"` to all product `<img>` tags in `app.js` where product cards are rendered:

```javascript
// Before
`<img src="${product.image_url}" alt="${product.name}" />`

// After
`<img src="${product.image_url}" alt="${product.name}" loading="lazy" decoding="async" />`
```

Also add explicit `width` and `height` attributes to prevent layout shift (CLS):

```javascript
`<img src="${product.image_url}" alt="${product.name}" loading="lazy" decoding="async" width="300" height="300" />`
```

### Expected improvement
- Initial page load: −50 to −100 image requests
- LCP: improved (browser focuses bandwidth on above-fold images)
- CLS score: improved (no layout shift from image load)

---

## Issue 5 — No image optimization / WebP conversion

### What was identified
Product images are stored and served as raw JPEG files from Supabase Storage. A typical product image uploaded at 10 MB is served at full resolution to every visitor including mobile users viewing a 90×90 px thumbnail.

### Fix
Supabase Storage has a built-in Image Transform API. Use it to serve resized WebP images:

```javascript
// Current — serves full-size JPEG
const imageUrl = `${SUPABASE_URL}/storage/v1/object/public/product-images/${filename}`;

// Fixed — serves WebP at correct size
const imageUrl = `${SUPABASE_URL}/storage/v1/render/image/public/product-images/${filename}?width=400&quality=80&format=webp`;

// For thumbnails in product grid (smaller)
const thumbUrl = `${SUPABASE_URL}/storage/v1/render/image/public/product-images/${filename}?width=300&height=300&resize=cover&quality=75&format=webp`;
```

**Note:** Supabase Image Transform requires the Pro plan or higher. On free tier, serve pre-optimized images at upload time using the admin's `uploadProductImage` function — compress to 800×800 max before upload (already partially done).

### Expected improvement
- Image transfer size: −60 to −70% (WebP vs JPEG)
- Mobile LCP: −1 to −2 seconds

---

## Issue 6 — All 172 products loaded at once

### What was identified
`products.html` fetches all products in a single Supabase query:

```javascript
const { data } = await supabaseClient.from('products').select('*');
```

This loads 172 rows of data on every page visit. As the catalog grows this will get worse.

### Fix
Implement pagination — load 24 products at a time with a "Load more" button:

```javascript
const PAGE_SIZE = 24;
let currentPage = 0;

async function loadProducts(reset = false) {
  if (reset) currentPage = 0;
  const from = currentPage * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, count } = await supabaseClient
    .from('products')
    .select('*', { count: 'exact' })
    .eq('status', 'Active')
    .order('created_at', { ascending: false })
    .range(from, to);

  currentPage++;
  // render data...
  // show/hide "Load more" based on count
}
```

### Expected improvement
- Initial data transfer: −75% (24 vs 172 products)
- Time to interactive: −0.5 to −1 second

---

## Issue 7 — No resource hints (preconnect)

### What was identified
The browser wastes 100–300ms on DNS lookup + TCP handshake for external domains on first use. No `preconnect` hints are set.

### Fix
Add to `<head>` of every HTML page:

```html
<!-- Supabase -->
<link rel="preconnect" href="https://jyvmmypalshebqmnrdma.supabase.co" crossorigin />
<!-- Supabase CDN -->
<link rel="preconnect" href="https://jyvmmypalshebqmnrdma.supabase.in" crossorigin />
<!-- jsDelivr (Supabase SDK) -->
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />
<!-- Font Awesome -->
<link rel="preconnect" href="https://cdnjs.cloudflare.com" crossorigin />
<!-- DNS prefetch for less-critical domains -->
<link rel="dns-prefetch" href="https://api.resend.com" />
```

### Expected improvement
- Connection setup time: −100 to −300ms per external domain
- Cumulative: −0.3 to −0.5 seconds

---

## Issue 8 — `admin.js` unminified (185 KB)

### What was identified
`admin.js` is 185 KB unminified. The admin dashboard is only used by you, not customers — but a slow admin panel affects your productivity.

### Fix
Same approach as Issue 3 — minify with `terser` as part of the build step. After minification + Brotli compression: ~25–30 KB.

---

## Issue 9 — No browser caching headers for static assets

### What was identified
Static files (`app.js`, `storefront.css`, `admin.js`) are served without long-lived cache headers. Every page visit re-downloads them even if nothing changed.

### Fix
Update `vercel.json` to add cache headers for static assets:

```json
{
  "headers": [
    {
      "source": "/(app|admin|seo|theme-manager)\\.js",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
      ]
    },
    {
      "source": "/(storefront|themes|luxury)\\.css",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
      ]
    }
  ]
}
```

**Important:** When you update these files, change the cache-buster query string in HTML (e.g. `app.js?v=2026-08`) so returning users get the new version.

### Expected improvement
- Repeat visit load time: −70 to −90% (files served from browser cache)

---

## Issue 10 — No skeleton / loading states

### What was identified
Product grid shows blank white space while Supabase data loads. Users on slow connections see nothing for 1–3 seconds and may think the page is broken.

### Fix
Add CSS skeleton screens that display while products load:

```css
.skeleton {
  background: linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.2s infinite;
  border-radius: 6px;
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

Show 8 skeleton cards while loading, replace with real data on arrival.

---

## Implementation Priority

### Do these first (low effort, high impact):
1. ✅ Add `defer` to all scripts — **Issue 1**
2. ✅ Load Font Awesome async — **Issue 2**
3. ✅ Add `loading="lazy"` to product images — **Issue 4**
4. ✅ Add `preconnect` hints — **Issue 7**
5. ✅ Add cache headers in `vercel.json` — **Issue 9**

### Do these next (medium effort, high impact):
6. ⏳ Pagination for products — **Issue 6**
7. ⏳ Minify `app.js` and `admin.js` — **Issues 3 & 8**
8. ⏳ Supabase image transform for WebP — **Issue 5**

### Do these last (polish):
9. ⏳ Skeleton loading screens — **Issue 10**

---

## How to measure improvement

Before and after each fix, run:

1. **Google PageSpeed Insights** (free): https://pagespeed.web.dev — test `https://www.oncost.shop/products.html`
2. **WebPageTest** (free): https://webpagetest.org — choose Mumbai server, mobile preset
3. **Chrome DevTools** → Lighthouse tab → Mobile → Run audit

Target scores:
| Metric | Current (estimated) | Target |
|--------|-------------------|--------|
| Performance | 40–55 | 80+ |
| LCP | 4–6 sec | < 2.5 sec |
| FCP | 2–4 sec | < 1.5 sec |
| CLS | 0.2–0.4 | < 0.1 |
| TBT | 500–800ms | < 200ms |
