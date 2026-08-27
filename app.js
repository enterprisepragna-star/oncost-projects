function generateSKU(name) {
  if (!name) return "";
  return name.split(/[\s-]+/).filter(w => w.length > 0).map(word => word[0]).join("").toUpperCase();
}

/* =================================================================
   ONCOST Storefront · app.js (Unified)
   Live data from Supabase: products, categories, sale_events,
   testimonials, site_settings, cart_items, coupons, wishlists.
   ================================================================= */
/* global supabaseClient */
'use strict';

const ADMIN_EMAILS = ['enterprisepragna@gmail.com'];

const state = {
  user: null,
  profile: null,
  settings: {},
  products: [],
  categories: [],
  testimonials: [],
  saleEvents: [],
  cart: [],            // [{ id, product_id, qty, product }]
  wishlist: [],        // [{ id, product_id }]
  appliedCoupon: null,
  isAdmin: false,
};

// ---------- Utilities ----------
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const fmtINR = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN');
const escapeHTML = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const param = (name) => new URLSearchParams(location.search).get(name);

function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + (kind || '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// ---------- Settings, SEO, Sale banner, Whatsapp ----------
async function loadSettings() {
  try {
    const { data } = await supabaseClient.from('site_settings').select('*').limit(1);
    state.settings = (data && data[0]) || {};
  } catch (e) { state.settings = {}; }
}
function applySEO() {
  const s = state.settings;
  if (s.site_title) document.title = s.site_title;
  if (s.meta_description) setMeta('description', s.meta_description);
  if (s.keywords) setMeta('keywords', s.keywords);
  if (s.canonical_url) {
    let link = document.querySelector('link[rel="canonical"]');
    if (!link) { link = document.createElement('link'); link.setAttribute('rel', 'canonical'); document.head.appendChild(link); }
    link.setAttribute('href', s.canonical_url);
  }
  // GA
  if (s.ga_id && !window._gaLoaded) {
    window._gaLoaded = true;
    const sc = document.createElement('script'); sc.async = true; sc.src = `https://www.googletagmanager.com/gtag/js?id=${s.ga_id}`;
    document.head.appendChild(sc);
    window.dataLayer = window.dataLayer || []; function gtag(){window.dataLayer.push(arguments)} window.gtag = gtag;
    gtag('js', new Date()); gtag('config', s.ga_id);
  }
}
function setMeta(name, content) {
  let tag = document.querySelector(`meta[name="${name}"]`);
  if (!tag) { tag = document.createElement('meta'); tag.setAttribute('name', name); document.head.appendChild(tag); }
  tag.setAttribute('content', content);
}

async function loadSaleEvents() {
  try {
    const { data } = await supabaseClient.from('sale_events').select('*').eq('is_active', true);
    state.saleEvents = data || [];
  } catch (e) { state.saleEvents = []; }
}
function renderSaleBanner() {
  const slot = $('#sale-banner');
  if (!slot) return;
  const now = new Date();
  const live = state.saleEvents.find(s => {
    const sd = new Date(s.start_date), ed = new Date(s.end_date);
    return sd <= now && ed >= now;
  });
  if (!live) { slot.classList.remove('show'); return; }
  slot.innerHTML = `<span class="pill">LIVE</span> ${escapeHTML(live.banner_text || live.name)}`;
  slot.classList.add('show');
}

function applyWhatsappFab() {
  const fab = $('#fab-whatsapp');
  if (!fab) return;
  const num = (state.settings.whatsapp_number || '').replace(/[^0-9]/g, '');
  if (!num) { fab.style.display = 'none'; return; }
  const msg = encodeURIComponent(state.settings.whatsapp_text || 'Hi, I would like to enquire about ONCOST gifts.');
  fab.href = `https://wa.me/${num}?text=${msg}`;
}

function applyFooterSocials() {
  const s = state.settings;
  const map = { instagram: s.instagram_url, facebook: s.facebook_url, youtube: s.youtube_url, pinterest: s.pinterest_url, twitter: s.twitter_url, whatsapp: s.whatsapp_number ? `https://wa.me/${s.whatsapp_number.replace(/[^0-9]/g,'')}` : '' };
  Object.entries(map).forEach(([k, v]) => {
    const a = $(`#social-${k}`);
    if (!a) return;
    if (v) { a.href = v; a.style.display = ''; } else { a.style.display = 'none'; }
  });
}

// ---------- Auth ----------
async function loadAuth() {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    state.user = session?.user || null;
    state.isAdmin = !!state.user && ADMIN_EMAILS.includes(state.user.email.toLowerCase());
    if (state.user) {
      try {
        const { data: prof } = await supabaseClient.from('profiles').select('*').eq('id', state.user.id).single();
        state.profile = prof;
      } catch { /* profile optional */ }
    }
  } catch (e) { state.user = null; }
}
function renderAuthState() {
  const userName = state.profile?.name || state.user?.email?.split('@')[0] || '';
  $$('[data-account-link]').forEach(a => {
    if (state.user) {
      a.innerHTML = a.querySelector('i') ? `<i class="fas fa-user"></i>` : escapeHTML(userName || 'Account');
      a.href = 'account.html';
    } else {
      a.innerHTML = a.querySelector('i') ? `<i class="fas fa-user"></i>` : 'Login';
      a.href = 'login.html';
    }
  });
  const adminLink = $('.admin-link');
  if (adminLink) {
    if (state.isAdmin) adminLink.classList.add('show');
    else adminLink.classList.remove('show');
  }
}
async function doLogout() {
  await supabaseClient.auth.signOut();
  location.href = 'index.html';
}
window.doLogout = doLogout;

// ---------- Products ----------
async function loadProducts() {
  try {
    const { data } = await supabaseClient.from('products').select('*').eq('status', 'Active').order('created_at', { ascending: false });
    state.products = data || [];
  } catch (e) { state.products = []; }
}
function productCardHTML(p) {
  const stock = Number(p.stock || 0);
  const imgHTML = p.image_url
    ? `<img src="${escapeHTML(p.image_url)}" alt="${escapeHTML(p.name)}" style="width:100%; height:100%; object-fit:cover;" onerror="this.onerror=null; this.src='https://via.placeholder.com/400x400.png?text=Image+Not+Found'; this.style.objectFit='contain';" />`
    : `<img src="https://via.placeholder.com/400x400.png?text=No+Image" alt="No image" style="width:100%; height:100%; object-fit:contain;" />`;
  const offer = p.offer_price && Number(p.offer_price) > 0 && Number(p.offer_price) < Number(p.price);
  const save = offer ? Math.round(((p.price - p.offer_price) / p.price) * 100) : 0;
  const inWishlist = state.wishlist.some(w => w.product_id === p.id);
  const wishBtn = state.user ? `<button class="wish-btn ${inWishlist?'on':''}" onclick="event.preventDefault();event.stopPropagation();toggleWishlist('${escapeHTML(p.id)}')" data-testid="wish-btn-${escapeHTML(p.id)}" title="${inWishlist?'Remove from wishlist':'Add to wishlist'}"><i class="${inWishlist?'fas':'far'} fa-heart"></i></button>` : '';
  const shareBtn = `<button class="share-btn" onclick="event.preventDefault();event.stopPropagation(); window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(window.location.origin + '/product.html?id=' + '${escapeHTML(p.id)}'), '_blank')" title="Share on WhatsApp"><i class="fas fa-share-nodes"></i></button>`;
  return `<a class="product-card" href="product.html?id=${encodeURIComponent(p.id)}" data-testid="product-card-${escapeHTML(p.id)}">
    <div class="img-wrap">
      ${imgHTML}
      ${p.badge ? `<span class="badge-pill ${p.badge.toLowerCase().includes('sale') || offer ? 'gold' : ''}">${escapeHTML(p.badge)}</span>` : ''}
      ${stock === 0 ? `<span class="stock-tag">Out of stock</span>` : ''}
      ${wishBtn}
      ${shareBtn}
    </div>
    <div class="info">
      <div class="cat">${escapeHTML(p.category || 'Premium')}</div>
      <h3>${escapeHTML(p.name)}</h3>
      <div class="price-row">
        <span class="price">${fmtINR(offer ? p.offer_price : p.price)}</span>
        ${offer ? `<span class="price-old">${fmtINR(p.price)}</span><span class="save">−${save}%</span>` : ''}
      </div>
    </div>
  </a>`;
}

function renderHomeProducts() {
  const slot = $('#home-products');
  if (!slot) return;
  const items = state.products.slice(0, 8);
  if (!items.length) {
    slot.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><i class="fas fa-box-open"></i><h3>Catalog refreshing soon</h3><p>Our team is curating the next collection.</p></div>`;
    return;
  }
  slot.innerHTML = items.map(productCardHTML).join('');
}

function renderHomeCollections() {
  const slot = $('#home-collections');
  if (!slot) return;
  const cats = state.categories.slice(0, 6);
  const fallbackImgs = ['bg-maroon','bg-gold','bg-rose','bg-sage','bg-silver','bg-cream'];
  if (!cats.length) { slot.innerHTML = ''; return; }
  slot.innerHTML = cats.map((c, i) => {
    const productsInCat = state.products.filter(p => (p.category||'') === c.name);
    // Image priority: 1) category's own image_url  2) first product image in this category  3) gradient fallback
    let img = c.image_url;
    if (!img) {
      const firstWithImg = productsInCat.find(p => p.image_url);
      if (firstWithImg) img = firstWithImg.image_url;
    }
    const bg  = img ? `style="background-image:url('${escapeHTML(img)}');background-size:cover;background-position:center;"` : '';
    const cls = img ? '' : fallbackImgs[i % fallbackImgs.length];
    return `<a class="collection-card" href="products.html?cat=${encodeURIComponent(c.name)}" data-testid="cat-card-${escapeHTML(c.name)}">
      <div class="visual ${cls}" ${bg}></div>
      <div class="label">
        <h3>${escapeHTML(c.name)}</h3>
        <span>${productsInCat.length} product${productsInCat.length===1?'':'s'}</span>
      </div>
    </a>`;
  }).join('');
}

// ---------- Hero slideshow: crossfades through admin-defined hero images or latest products ----------
function renderHeroSlideshow() {
  const slot = $('.hero-visual');
  if (!slot) return;
  
  // 1. Try to pull admin-defined hero images
  let pics = (state.settings?.hero_images || []).map(url => ({ url, name: 'Hero Image' }));
  
  // 2. Fallback: Pull up to 6 nice product images (de-duped) if no custom hero images set
  if (!pics.length) {
    const seen = new Set();
    for (const p of state.products) {
      const url = p.image_url;
      if (url && !seen.has(url)) { seen.add(url); pics.push({ url, name: p.name }); }
      if (pics.length >= 6) break;
    }
  }

  if (!pics.length) return; // keep gradient fallback when no images yet

  // Build slide DOM (preserve the existing .hero-kpi badge)
  const kpiHTML = slot.querySelector('.hero-kpi')?.outerHTML || '';
  slot.innerHTML = `
    <div class="hero-slides">
      ${pics.map((p, i) => `<img class="hero-slide${i===0?' active':''}" src="${escapeHTML(p.url)}" alt="${escapeHTML(p.name)}" loading="${i===0?'eager':'lazy'}" onerror="this.remove()" />`).join('')}
    </div>
    ${kpiHTML}
  `;

  // Cycle every 3.5s
  if (slot._slideTimer) clearInterval(slot._slideTimer);
  const slides = slot.querySelectorAll('.hero-slide');
  if (slides.length < 2) return;
  let idx = 0;
  slot._slideTimer = setInterval(() => {
    slides[idx].classList.remove('active');
    idx = (idx + 1) % slides.length;
    slides[idx].classList.add('active');
  }, 3500);
}

function renderProductsListing() {
  // Update page title if filtering by category
  const catParam = param('cat');
  if (catParam) {
    document.title = `${catParam} — ONCOST`;
    const h1 = document.querySelector('.page-hero h1');
    if (h1) h1.textContent = catParam;
    const sub = document.querySelector('.page-hero p');
    if (sub) sub.textContent = `Showing products in "${catParam}"`;
  }
  const slot = $('[data-products]');
  if (!slot) return;
  const q = ($('[data-product-search]')?.value || '').toLowerCase().trim();
  const cat = ($('[data-product-filter]')?.value || param('cat') || 'all');
  const sort = ($('[data-product-sort]')?.value || 'default');

  let items = state.products.slice();
  if (cat && cat !== 'all') items = items.filter(p => (p.category||'').toLowerCase() === cat.toLowerCase());
  if (q) items = items.filter(p => `${p.name} ${p.category||''} ${p.description||''} ${p.sku||''}`.toLowerCase().includes(q));
  const eff = (p) => p.offer_price && p.offer_price < p.price ? p.offer_price : p.price;
  if (sort === 'price_asc')  items.sort((a,b) => eff(a) - eff(b));
  if (sort === 'price_desc') items.sort((a,b) => eff(b) - eff(a));

  if (!items.length) {
    slot.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><i class="fas fa-search"></i><h3>No products found</h3><p>Try adjusting filters or browsing all collections.</p></div>`;
    return;
  }
  slot.innerHTML = items.map(productCardHTML).join('');
  const sub = $('#products-count');
  if (sub) sub.textContent = `${items.length} product${items.length===1?'':'s'}`;
}

function populateCategoryFilter() {
  const sel = $('[data-product-filter]');
  if (!sel) return;
  const existing = state.categories.map(c => c.name);
  sel.innerHTML = `<option value="all">All Collections</option>` + existing.map(n => `<option value="${escapeHTML(n)}">${escapeHTML(n)}</option>`).join('');
  // Apply pending cat param now that options exist
  const pending = sel.dataset.pendingCat || param('cat');
  if (pending) {
    sel.value = pending;
    delete sel.dataset.pendingCat;
  }
}

async function renderProductDetail() {
  const slot = $('[data-product-detail]');
  if (!slot) return;
  const id = param('id');
  let p = state.products.find(x => String(x.id).trim().toLowerCase() === String(id).trim().toLowerCase());
  
  if (!p && id) {
    try {
      const { data } = await supabaseClient.from('products').select('*').ilike('id', id.trim()).single();
      if (data) {
        p = data;
        state.products.push(p);
      }
    } catch (e) {
      console.error("Direct product fetch failed", e);
    }
  }

  if (!p) {
    slot.innerHTML = `<div class="empty-state"><i class="fas fa-box-open"></i><h3>Product not found</h3><p>This item may have been removed.</p><a class="btn primary" href="products.html">Browse All</a></div>`;
    return;
  }
  if (state.settings.site_title) document.title = `${p.name} · ${state.settings.site_title}`;
  if (p.seo_description) setMeta('description', p.seo_description);

  // --- Track Recently Viewed ---
  try {
    let rv = JSON.parse(localStorage.getItem('recently_viewed') || '[]');
    rv = rv.filter(pid => pid !== p.id);
    rv.unshift(p.id);
    if (rv.length > 10) rv = rv.slice(0, 10);
    localStorage.setItem('recently_viewed', JSON.stringify(rv));
  } catch(e) {}

  // Load variants if this product has them
  let variants = [];
  let selectedVariant = null;
  if (p.has_variants) {
    try {
      const { data } = await supabaseClient.from('product_variants').select('*').eq('product_id', p.id).eq('status', 'Active').order('sort_order', { ascending: true });
      variants = data || [];
      selectedVariant = variants[0] || null;
    } catch (e) { console.warn('variants load failed', e); }
  }

  // Use selected variant data if available, else product data
  const v = selectedVariant;
  const offer = v ? (v.offer_price && v.offer_price < v.price) : (p.offer_price && p.offer_price < p.price);
  const displayPrice = v ? (offer ? v.offer_price : v.price) : (offer ? p.offer_price : p.price);
  const originalPrice = v ? v.price : p.price;
  const save = offer ? Math.round(((originalPrice - displayPrice) / originalPrice) * 100) : 0;
  const stock = v ? Number(v.stock || 0) : Number(p.stock || 0);
  const displayImage = v?.image_url || p.image_url;
  // Build full image array: primary + gallery
  const allImages = [];
  if (p.image_url) allImages.push(p.image_url);
  if (Array.isArray(p.image_urls)) p.image_urls.forEach(u => { if (u && u !== p.image_url) allImages.push(u); });
  const mainImg = allImages[0] || null;
  const galleryHTML = allImages.length > 1
    ? `<div class="pd-thumbs" data-testid="pd-thumbs">
        ${allImages.map((u, i) => `<button class="pd-thumb ${i===0?'active':''}" data-idx="${i}" data-img="${escapeHTML(u)}" type="button" aria-label="View image ${i+1}" data-testid="pd-thumb-${i}"><img src="${escapeHTML(u)}" alt="" loading="lazy" decoding="async" /></button>`).join('')}
      </div>`
    : '';
  const shareBtnDetail = `<button type="button" class="pd-share-btn" onclick="window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(window.location.origin + '/product.html?id=' + '${escapeHTML(p.id)}'), '_blank')" title="Share on WhatsApp"><i class="fas fa-share-nodes"></i></button>`;
  const imgHTML = mainImg
    ? `<img id="pd-main-img" src="${escapeHTML(mainImg)}" alt="${escapeHTML(p.name)}" style="width:100%; height:100%; object-fit:contain;" onerror="this.onerror=null; this.src='https://via.placeholder.com/600x600.png?text=Image+Not+Found';" />
       <button type="button" class="pd-expand-btn" id="pd-expand" title="View fullscreen" data-testid="pd-expand"><i class="fas fa-expand"></i></button>
       ${shareBtnDetail}`
    : `<img src="https://via.placeholder.com/600x600.png?text=No+Image" style="width:100%; height:100%; object-fit:contain;" />`;

  const related = state.products.filter(x => x.category === p.category && x.id !== p.id).slice(0, 4);
  const inWishlist = state.wishlist.some(w => w.product_id === p.id);
  const summary = productReviewSummary(p.id);
  const reviewToken = param('review_token') || '';

  slot.innerHTML = `
    <div class="product-detail">
      <div>
        <div class="pd-gallery">${imgHTML}</div>
        ${galleryHTML}
      </div>
      <div class="pd-info">
        ${p.category ? `<div class="cat">${escapeHTML(p.category)}</div>` : ''}
        <h1>${escapeHTML(p.name)}</h1>
        <div style="display:flex;align-items:center;gap:10px;margin:-2px 0 12px;font-size:13px;">
          ${summary.count
            ? `<a href="#reviews" style="display:inline-flex;align-items:center;gap:6px;text-decoration:none;color:var(--ink);"><span>${starsHTML(summary.avg, 13)}</span><strong style="font-size:13px;">${summary.avg.toFixed(1)}</strong><span style="color:var(--muted);">· ${summary.count} review${summary.count===1?'':'s'}</span></a>`
            : `<span style="color:var(--muted);font-size:12px;display:inline-flex;align-items:center;gap:6px;">${starsHTML(0, 13)} <span>No reviews yet</span></span>`}
          ${reviewToken ? `<button type="button" class="btn primary sm" onclick="openProductReviewModal('${escapeHTML(p.id)}','${escapeHTML(reviewToken)}')" style="margin-left:auto;" data-testid="pd-review-token-btn"><i class="fas fa-pen"></i> Write a Review</button>` : ''}
        </div>
        <div class="price-row">
          <span class="price" data-pd-price>${fmtINR(displayPrice)}</span>
          ${offer ? `<span class="price-old" data-pd-price-old>${fmtINR(originalPrice)}</span><span class="save-tag" data-pd-save>Save ${save}%</span>` : ''}
        </div>
        ${displayPrice >= 10 ? `<div class="earn-points" data-testid="pd-earn-points"><i class="fas fa-coins"></i> Earn <b data-pd-points>${Math.floor(displayPrice / 10)}</b> loyalty points — worth ₹${Math.floor(displayPrice / 10)} off your next order</div>` : ''}
        ${variants.length ? `
          <div class="variant-selector" style="margin:14px 0 18px;padding:14px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);">
            <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:10px;">
              <span style="font-weight:600;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:var(--muted);">${escapeHTML(variants[0]?.variant_type||'Variant')}:</span>
              <strong id="pd-variant-name" style="color:var(--burgundy);font-size:14px;">${escapeHTML(selectedVariant?.variant_label||'')}</strong>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;" data-testid="pd-variants">
              ${variants.map((vv, i) => {
                const outOfStock = Number(vv.stock||0) <= 0;
                return `<button type="button" class="variant-chip ${i===0?'active':''}" data-variant-id="${escapeHTML(vv.id)}" data-variant-idx="${i}" ${outOfStock?'data-oos':''} style="border:1.5px solid ${i===0?'var(--burgundy)':'var(--line)'};background:${i===0?'var(--burgundy)':'#fff'};color:${i===0?'#fff':'var(--ink)'};padding:8px 16px;border-radius:8px;cursor:pointer;font-weight:500;font-size:13px;transition:all 0.15s;${outOfStock?'opacity:0.4;text-decoration:line-through;':''}" data-testid="pd-variant-${i}">${escapeHTML(vv.variant_label)}${outOfStock?' · OOS':''}</button>`;
              }).join('')}
            </div>
          </div>` : ''}
        ${p.description ? `<p class="desc">${escapeHTML(p.description)}</p>` : ''}
        
        <div class="product-specs-table" style="margin:24px 0;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#fff;">
          <div style="background:#f8f9fa;padding:12px 16px;font-weight:600;font-size:14px;border-bottom:1px solid var(--line);">Product Details</div>
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            ${(v ? v.sku : p.sku) ? `<tr><td style="padding:10px 16px;border-bottom:1px solid var(--line);color:var(--muted);width:45%;font-weight:500;">SKU</td><td id="pd-spec-sku" style="padding:10px 16px;border-bottom:1px solid var(--line);font-weight:600;">${escapeHTML(v ? v.sku : p.sku)}</td></tr>` : `<tr id="pd-spec-sku-row" style="display:none"><td style="padding:10px 16px;border-bottom:1px solid var(--line);color:var(--muted);width:45%;font-weight:500;">SKU</td><td id="pd-spec-sku" style="padding:10px 16px;border-bottom:1px solid var(--line);font-weight:600;"></td></tr>`}
            ${(v ? v.weight_grams : p.weight_grams) ? `<tr><td style="padding:10px 16px;border-bottom:1px solid var(--line);color:var(--muted);font-weight:500;">Item Weight</td><td id="pd-spec-weight" style="padding:10px 16px;border-bottom:1px solid var(--line);font-weight:600;">${v ? v.weight_grams : p.weight_grams} Grams</td></tr>` : `<tr id="pd-spec-weight-row" style="display:none"><td style="padding:10px 16px;border-bottom:1px solid var(--line);color:var(--muted);font-weight:500;">Item Weight</td><td id="pd-spec-weight" style="padding:10px 16px;border-bottom:1px solid var(--line);font-weight:600;"></td></tr>`}
            ${(p.length_cm || p.breadth_cm || p.height_cm) ? `<tr><td style="padding:10px 16px;border-bottom:1px solid var(--line);color:var(--muted);font-weight:500;">Item Dimensions (L x W x H)</td><td style="padding:10px 16px;border-bottom:1px solid var(--line);font-weight:600;">${p.length_cm||0} x ${p.breadth_cm||0} x ${p.height_cm||0} cm</td></tr>` : ''}
            ${p.hsn_code ? `<tr><td style="padding:10px 16px;border-bottom:1px solid var(--line);color:var(--muted);font-weight:500;">HSN Code</td><td style="padding:10px 16px;border-bottom:1px solid var(--line);font-weight:600;">${escapeHTML(p.hsn_code)}</td></tr>` : ''}
            ${p.category ? `<tr><td style="padding:10px 16px;color:var(--muted);font-weight:500;">Category</td><td style="padding:10px 16px;font-weight:600;">${escapeHTML(p.category)}</td></tr>` : ''}
          </table>
        </div>
        <div class="qty-row">
          <span style="font-weight:600;font-size:13px;letter-spacing:1px;text-transform:uppercase;color:var(--muted);">Quantity</span>
          <div class="qty-stepper">
            <button onclick="changeQty(-1)" aria-label="Decrease" data-testid="pd-qty-minus"><i class="fas fa-minus"></i></button>
            <input id="pd-qty" type="number" min="${p.moq || 1}" max="${stock || 999}" value="${p.moq || 1}" data-testid="pd-qty" />
            <button onclick="changeQty(1)" aria-label="Increase" data-testid="pd-qty-plus"><i class="fas fa-plus"></i></button>
          </div>
          ${stock <= 5 && stock > 0 ? `<span style="font-size:12px;color:var(--error);font-weight:600;">Only ${stock} left</span>` : ''}
          ${stock === 0 ? `<span style="font-size:12px;color:var(--error);font-weight:600;">Out of stock</span>` : ''}
        </div>
        <div class="actions">
          <button class="btn primary" onclick="addToCartFromDetail('${escapeHTML(p.id)}')" ${stock===0?'disabled':''} data-testid="pd-add-cart"><i class="fas fa-cart-plus"></i> Add to Cart</button>
          <button class="btn outline" onclick="toggleWishlist('${escapeHTML(p.id)}')" data-testid="pd-wishlist"><i class="${inWishlist?'fas':'far'} fa-heart"></i> ${inWishlist?'SAVED TO WISHLIST':'ADD TO WISHLIST'}</button>
          <a class="btn secondary" href="bulk.html?product=${encodeURIComponent(p.id)}" data-testid="pd-bulk-enquiry"><i class="fab fa-whatsapp"></i> Bulk Enquiry</a>
        </div>

        <div class="pd-perks">
          <div class="perk"><i class="fas fa-truck"></i><div><b>Pan India delivery</b><br><span style="color:var(--muted)">Free shipping over ₹999</span></div></div>
          <div class="perk"><i class="fas fa-box-open"></i><div><b>Premium packaging</b><br><span style="color:var(--muted)">Gift-ready out of the box</span></div></div>
          <div class="perk"><i class="fas fa-shield-halved"></i><div><b>Secure checkout</b><br><span style="color:var(--muted)">CCAvenue · UPI · Card</span></div></div>
          <div class="perk"><i class="fas fa-rotate-left"></i><div><b>Easy returns</b><br><span style="color:var(--muted)">7-day return window</span></div></div>
        </div>
      </div>
    </div>

    <!-- ============ REVIEWS SECTION ============ -->
    <section id="reviews" style="margin-top:56px;max-width:780px;">
      <div class="section-head" style="text-align:left;margin-bottom:18px;display:flex;justify-content:space-between;align-items:flex-end;gap:18px;flex-wrap:wrap;">
        <div>
          <h2 style="font-size:1.6rem;margin:0;">Customer Reviews</h2>
          ${summary.count
            ? `<div style="margin-top:6px;display:flex;align-items:center;gap:10px;font-size:14px;">${starsHTML(summary.avg, 16)} <strong>${summary.avg.toFixed(1)} / 5</strong><span style="color:var(--muted);">based on ${summary.count} review${summary.count===1?'':'s'}</span></div>`
            : ''}
        </div>
        <button class="btn primary sm" onclick="openProductReviewModal('${escapeHTML(p.id)}','${escapeHTML(reviewToken)}')" data-testid="pd-write-review-btn"><i class="fas fa-pen"></i> Write a Review</button>
      </div>
      ${renderProductReviews(p.id)}
    </section>

    ${related.length ? `
      <section style="margin-top:64px;">
        <div class="section-head" style="text-align:left;margin-bottom:24px;"><h2 style="font-size:1.8rem;">You may also love</h2></div>
        <div class="product-grid">${related.map(productCardHTML).join('')}</div>
      </section>` : ''}
  `;

  // Gallery: thumbnail switching, hover zoom (desktop), lightbox
  state._pdImages = allImages;
  state._pdImageIdx = 0;
  $$('.pd-thumb').forEach(btn => btn.addEventListener('click', () => {
    $$('.pd-thumb').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const main = $('#pd-main-img');
    if (main) {
      main.src = btn.dataset.img;
    }
    state._pdImageIdx = Number(btn.dataset.idx || 0);
  }));
  const zoomWrap = $('.pd-gallery');
  const mainEl = $('#pd-main-img');
  if (zoomWrap && mainEl) {
    // Desktop hover zoom lens
    zoomWrap.addEventListener('mousemove', (e) => {
      if (window.matchMedia('(hover: none)').matches) return;
      const r = zoomWrap.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 100;
      const y = ((e.clientY - r.top) / r.height) * 100;
      mainEl.style.transformOrigin = `${x}% ${y}%`;
      mainEl.style.transform = 'scale(1.9)';
      zoomWrap.classList.add('zooming');
    });
    zoomWrap.addEventListener('mouseleave', () => {
      mainEl.style.transform = '';
      zoomWrap.classList.remove('zooming');
    });
    const openLB = () => allImages.length && openLightbox(allImages, state._pdImageIdx, p.name);
    zoomWrap.addEventListener('click', openLB);
    $('#pd-expand')?.addEventListener('click', (e) => { e.stopPropagation(); openLB(); });
  }

  // Variant chip handlers — swap price/stock/image when customer picks a variant
  if (variants.length) {
    state._selectedVariant = selectedVariant;
    $$('.variant-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        if (chip.hasAttribute('data-oos')) return;
        const idx = Number(chip.dataset.variantIdx);
        const vv = variants[idx];
        state._selectedVariant = vv;
        // Update visuals
        $$('.variant-chip').forEach(c => {
          c.style.background = '#fff'; c.style.color = 'var(--ink)';
          c.style.borderColor = 'var(--line)'; c.classList.remove('active');
        });
        chip.style.background = 'var(--burgundy)'; chip.style.color = '#fff';
        chip.style.borderColor = 'var(--burgundy)'; chip.classList.add('active');
        // Update display
        const sel = $('#pd-variant-name'); if (sel) sel.textContent = vv.variant_label;
        const priceEl = $('[data-pd-price]'); if (priceEl) priceEl.textContent = fmtINR(vv.offer_price && vv.offer_price < vv.price ? vv.offer_price : vv.price);
        const oldEl = $('[data-pd-price-old]'); if (oldEl) oldEl.textContent = vv.offer_price && vv.offer_price < vv.price ? fmtINR(vv.price) : '';
        const ptsWrap = $('[data-testid="pd-earn-points"]');
        if (ptsWrap) {
          const vPrice = vv.offer_price && vv.offer_price < vv.price ? vv.offer_price : vv.price;
          const pts = Math.floor(Number(vPrice) / 10);
          ptsWrap.innerHTML = `<i class="fas fa-coins"></i> Earn <b data-pd-points>${pts}</b> loyalty points — worth ₹${pts} off your next order`;
        }
        if (vv.image_url) { const main = $('#pd-main-img'); if (main) main.src = vv.image_url; }
        
        // Update product details table for variant
        const skuNode = $('#pd-spec-sku');
        const skuRow = $('#pd-spec-sku-row');
        if (skuNode) {
          const finalSku = vv.sku || p.sku;
          skuNode.textContent = finalSku || '';
          if (skuRow) skuRow.style.display = finalSku ? 'table-row' : 'none';
        }
        
        const wNode = $('#pd-spec-weight');
        const wRow = $('#pd-spec-weight-row');
        if (wNode) {
          const finalW = vv.weight_grams || p.weight_grams;
          wNode.textContent = finalW ? `${finalW} Grams` : '';
          if (wRow) wRow.style.display = finalW ? 'table-row' : 'none';
        }
      });
    });
  }
}
window.changeQty = function(delta) {
  const inp = $('#pd-qty');
  if (!inp) return;
  const v = Math.max(1, (parseInt(inp.value, 10) || 1) + delta);
  inp.value = v;
};
window.addToCartFromDetail = async function(productId) {
  const qty = Math.max(1, parseInt($('#pd-qty')?.value, 10) || 1);
  const variant = state._selectedVariant || null;
  await addToCart(productId, qty, variant);
};

// ---------- Cart ----------
async function loadCart() {
  try { state.appliedCoupon = JSON.parse(sessionStorage.getItem('oncost_coupon') || 'null'); } catch { state.appliedCoupon = null; }
  if (!state.user) {
    // Guest cart in localStorage
    try { state.cart = JSON.parse(localStorage.getItem('oncost_cart') || '[]'); }
    catch { state.cart = []; }
    state.cart.forEach(it => { it.product = state.products.find(p => p.id === it.product_id); });
    return;
  }
  // Logged in — load server cart, then merge any guest cart left in localStorage
  let guest = [];
  try { guest = JSON.parse(localStorage.getItem('oncost_cart') || '[]'); } catch { guest = []; }
  try {
    const { data } = await supabaseClient.from('cart_items').select('*').eq('user_id', state.user.id);
    state.cart = (data || []).map(it => ({ ...it, product: state.products.find(p => p.id === it.product_id) }));
    if (guest.length) {
      for (const g of guest) {
        if (!g.product_id) continue;
        const existing = state.cart.find(it => it.product_id === g.product_id && (it.variant_id || null) === (g.variant_id || null));
        if (existing) {
          const newQty = existing.qty + (g.qty || 1);
          const { error } = await supabaseClient.from('cart_items').update({ qty: newQty }).eq('id', existing.id);
          if (!error) existing.qty = newQty;
        } else {
          const row = { user_id: state.user.id, product_id: g.product_id, qty: g.qty || 1 };
          if (g.variant_id) { row.variant_id = g.variant_id; row.variant_label = g.variant_label; }
          const { data: d, error } = await supabaseClient.from('cart_items').insert(row).select().single();
          if (!error && d) {
            d.product = state.products.find(p => p.id === g.product_id);
            d.unit_price = g.unit_price;
            state.cart.push(d);
          }
        }
      }
      localStorage.removeItem('oncost_cart');
    }
  } catch { state.cart = []; }
}
function saveGuestCart() {
  if (state.user) return;
  const minimal = state.cart.map(it => ({ id: it.id, product_id: it.product_id, variant_id: it.variant_id || null, variant_label: it.variant_label || null, unit_price: it.unit_price, qty: it.qty }));
  localStorage.setItem('oncost_cart', JSON.stringify(minimal));
}

async function addToCart(productId, qty = 1, variant = null) {
  const product = state.products.find(p => p.id === productId);
  if (!product) return toast('Product not available', 'err');
  qty = Math.max(qty, product.moq || 1);
  const variantId = variant?.id || null;
  const variantLabel = variant?.variant_label || null;
  const unitPrice = variant
    ? Number(variant.offer_price && variant.offer_price < variant.price ? variant.offer_price : variant.price)
    : Number(product.offer_price && product.offer_price < product.price ? product.offer_price : product.price);
  if (state.user) {
    // Match by product_id + variant_id
    const existing = state.cart.find(it => it.product_id === productId && (it.variant_id || null) === variantId);
    if (existing) {
      await supabaseClient.from('cart_items').update({ qty: existing.qty + qty }).eq('id', existing.id);
      existing.qty += qty;
    } else {
      const insertRow = { user_id: state.user.id, product_id: productId, qty };
      if (variantId) { insertRow.variant_id = variantId; insertRow.variant_label = variantLabel; }
      const { data, error } = await supabaseClient.from('cart_items').insert(insertRow).select().single();
      if (error) {
        // If variant columns don't exist yet, fall back to product-only insert (graceful pre-migration)
        if (error.message?.includes('variant_id') || error.message?.includes('variant_label')) {
          const { data: d2, error: e2 } = await supabaseClient.from('cart_items').insert({ user_id: state.user.id, product_id: productId, qty }).select().single();
          if (e2) return toast('Could not add: ' + e2.message, 'err');
          d2.product = product; d2.variant_id = variantId; d2.variant_label = variantLabel; d2.unit_price = unitPrice;
          state.cart.push(d2);
        } else return toast('Could not add: ' + error.message, 'err');
      } else {
        data.product = product; data.unit_price = unitPrice;
        state.cart.push(data);
      }
    }
  } else {
    const existing = state.cart.find(it => it.product_id === productId && (it.variant_id || null) === variantId);
    if (existing) existing.qty += qty;
    else state.cart.push({ id: 'g-' + Date.now(), product_id: productId, variant_id: variantId, variant_label: variantLabel, unit_price: unitPrice, qty, product });
    saveGuestCart();
  }
  toast(`Added "${product.name}${variantLabel?' · '+variantLabel:''}" × ${qty}`, 'ok');
  updateCartBadge();
}
async function updateCartQty(rowId, qty) {
  const it = state.cart.find(x => x.id === rowId);
  if (!it) return;
  const moq = it.product?.moq || 1;
  qty = Math.max(moq, parseInt(qty, 10) || moq);
  if (state.user && !String(rowId).startsWith('g-')) {
    const { error } = await supabaseClient.from('cart_items').update({ qty }).eq('id', rowId);
    if (error) { toast('Could not update quantity: ' + error.message, 'err'); return; }
  }
  it.qty = qty;
  if (!state.user) saveGuestCart();
  renderCart();
  updateCartBadge();
}
async function removeCartItem(rowId) {
  if (state.user && !String(rowId).startsWith('g-')) {
    const { error } = await supabaseClient.from('cart_items').delete().eq('id', rowId);
    if (error) { toast('Could not remove item: ' + error.message, 'err'); return; }
  }
  state.cart = state.cart.filter(x => x.id !== rowId);
  saveGuestCart();
  renderCart();
  updateCartBadge();
  toast('Item removed');
}
window.updateCartQty = updateCartQty;
window.removeCartItem = removeCartItem;

function updateCartBadge() {
  const count = state.cart.reduce((s, it) => s + (it.qty || 1), 0);
  $$('[data-cart-count]').forEach(el => {
    let b = el.querySelector('.badge');
    if (count > 0) {
      if (!b) { b = document.createElement('span'); b.className = 'badge'; el.appendChild(b); }
      b.textContent = count > 99 ? '99+' : count;
    } else if (b) b.remove();
  });
}

function cartTotals() {
  let subtotal = 0;
  state.cart.forEach(it => {
    if (!it.product) return;
    // Use variant unit_price if available, else product price
    let eff;
    if (it.unit_price != null) {
      eff = Number(it.unit_price);
    } else {
      eff = (it.product.offer_price && it.product.offer_price < it.product.price) ? it.product.offer_price : it.product.price;
    }
    subtotal += eff * it.qty;
  });
  let discount = 0;
  if (state.appliedCoupon) {
    const dv = Number(state.appliedCoupon.discount_value ?? state.appliedCoupon.discount_amount ?? 0) || 0;
    if (state.appliedCoupon.discount_type === 'percent' || state.appliedCoupon.discount_type === 'percentage') discount = subtotal * dv / 100;
    else discount = dv;
    discount = Math.min(Math.max(0, discount), subtotal);
  }
  const shipping = 0; // Live calculated at checkout
  const total = Math.max(0, subtotal - discount + shipping);
  return { subtotal, discount, shipping, total };
}

function renderCart() {
  const slot = $('[data-cart]');
  if (!slot) return;
  if (!state.cart.length) {
    slot.innerHTML = `<div class="empty-state"><i class="fas fa-cart-shopping"></i><h3>Your cart is empty</h3><p>Discover our curated collections of brass &amp; gifting essentials.</p><a class="btn primary" href="products.html"><i class="fas fa-store"></i> Start Shopping</a></div>`;
    return;
  }
  const { subtotal, discount, shipping, total } = cartTotals();
  const guestNote = !state.user ? `<div style="background:var(--gold-soft);border:1px solid var(--gold);padding:12px;border-radius:6px;font-size:13px;margin-bottom:18px;"><b>Tip:</b> <a href="login.html" style="color:var(--burgundy);font-weight:700;">Log in</a> to save your cart across devices.</div>` : '';

  slot.innerHTML = `
    ${guestNote}
    <div class="cart-grid">
      <div class="cart-list">
        ${state.cart.map(it => {
          if (!it.product) return '';
          const p = it.product;
          const eff = it.unit_price != null ? Number(it.unit_price)
                    : ((p.offer_price && p.offer_price < p.price) ? p.offer_price : p.price);
          const img = p.image_url
            ? `<img src="${escapeHTML(p.image_url)}" alt="" onerror="this.style.display='none'" />`
            : `<div style="width:100%;height:100%;display:grid;place-items:center;color:var(--muted);"><i class="fas fa-image"></i></div>`;
          return `<div class="cart-row" data-testid="cart-row-${escapeHTML(it.id)}">
            <div class="thumb">${img}</div>
            <div class="meta"><h4>${escapeHTML(p.name)}${it.variant_label?` <span style="font-weight:400;font-size:12px;color:var(--burgundy);background:var(--gold-soft);padding:2px 8px;border-radius:999px;margin-left:4px;">${escapeHTML(it.variant_label)}</span>`:''}</h4><div class="c">${escapeHTML(p.category||'')} · ${fmtINR(eff)} each</div></div>
            <div class="qty-stepper">
              <button onclick="updateCartQty('${escapeHTML(it.id)}', ${it.qty - 1})"><i class="fas fa-minus"></i></button>
              <input value="${it.qty}" onchange="updateCartQty('${escapeHTML(it.id)}', this.value)" type="number" min="${p.moq || 1}" />
              <button onclick="updateCartQty('${escapeHTML(it.id)}', ${it.qty + 1})"><i class="fas fa-plus"></i></button>
            </div>
            <div class="line-total">${fmtINR(eff * it.qty)}</div>
            <button class="remove" onclick="removeCartItem('${escapeHTML(it.id)}')" title="Remove" data-testid="cart-remove-${escapeHTML(it.id)}"><i class="fas fa-trash"></i></button>
          </div>`;
        }).join('')}
      </div>
      <div class="cart-summary">
        <h3>Order Summary</h3>
        <div class="line"><span>Subtotal</span><span>${fmtINR(subtotal)}</span></div>
        ${discount > 0 ? `<div class="line" style="color:var(--success);"><span>Discount (${escapeHTML(state.appliedCoupon.code)})</span><span>−${fmtINR(discount)}</span></div>` : ''}
        <div class="line"><span>Shipping</span><span style="font-size:12px;color:var(--muted);">${subtotal > 999 ? 'Free' : 'Calculated at checkout'}</span></div>
        <div class="line total"><span>Total</span><span>${fmtINR(total)}</span></div>
        ${total >= 10 ? `<div class="earn-points" style="margin-top:10px;" data-testid="cart-earn-points"><i class="fas fa-coins"></i> You'll earn <b>${Math.floor(total / 10)}</b> loyalty points on this order</div>` : ''}

        <div class="coupon">
          <input class="field" id="coupon-input" placeholder="Coupon code" value="${state.appliedCoupon ? escapeHTML(state.appliedCoupon.code) : ''}" />
          <button class="btn outline sm" onclick="applyCoupon()" data-testid="apply-coupon">${state.appliedCoupon ? 'Remove' : 'Apply'}</button>
        </div>
        <div class="coupon-msg" id="coupon-msg"></div>

        <button class="btn primary block" style="margin-top:8px;" onclick="placeOrder()" data-testid="place-order"><i class="fas fa-lock"></i> Proceed to Checkout</button>
        <a class="btn ghost block" href="bulk.html"><i class="fab fa-whatsapp"></i> Or send bulk enquiry</a>
      </div>
    </div>
  `;
}
window.applyCoupon = async function() {
  if (state.appliedCoupon) {
    state.appliedCoupon = null;
    sessionStorage.removeItem('oncost_coupon');
    renderCart();
    return;
  }
  const code = ($('#coupon-input')?.value || '').trim().toUpperCase();
  const msgEl = $('#coupon-msg');
  if (!code) return;
  try {
    const { subtotal } = cartTotals();
    const r = await fetch('/api/coupons/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, cartSubtotal: subtotal })
    });
    const res = await r.json();
    if (!r.ok || !res.valid) {
      msgEl.textContent = res.error || 'Invalid coupon';
      msgEl.className = 'coupon-msg err';
      return;
    }
    state.appliedCoupon = res.coupon;
    sessionStorage.setItem('oncost_coupon', JSON.stringify(res.coupon));
    renderCart();
    toast(`Coupon ${res.coupon.code} applied`, 'ok');
  } catch (e) {
    msgEl.textContent = 'Could not validate coupon';
    msgEl.className = 'coupon-msg err';
  }
};

window.placeOrder = async function() {
  if (!state.cart.length) return;
  // Redirect to checkout page where customer enters shipping + pays via CCAvenue
  location.href = 'checkout.html';
};

// ---------- Testimonials ----------
async function loadTestimonials() {
  try {
    const { data } = await supabaseClient.from('testimonials').select('*').eq('status', 'Approved').order('created_at', { ascending: false });
    state.testimonials = data || [];
  } catch { state.testimonials = []; }
}
function renderReviewsMarquee() {
  const slot = $('#reviews-marquee');
  if (!slot) return;
  const fallback = [
    { customer_name: 'Priya S.', review_text: 'Absolutely stunning packaging!' },
    { customer_name: 'Rahul K.',  review_text: 'Perfect return gifts for our wedding.' },
    { customer_name: 'Ananya T.', review_text: 'Great quality brass items, highly recommend.' },
    { customer_name: 'Vikram M.', review_text: 'Super fast delivery for my bulk order.' },
    { customer_name: 'Sneha R.',  review_text: 'The guests loved the thambulam sets!' },
  ];
  const items = state.testimonials.length ? state.testimonials : fallback;
  const cardsHTML = items.map(t => `<div class="review-item">"${escapeHTML(t.review_text)}" <span class="author">— ${escapeHTML(t.customer_name)}</span></div>`).join('');
  slot.innerHTML = cardsHTML + cardsHTML;  // duplicate for seamless loop
}

// ---------- Product-level Reviews ----------
function starsHTML(rating, size = 14) {
  const r = Math.max(0, Math.min(5, Number(rating) || 0));
  const full = Math.floor(r);
  const half = (r - full) >= 0.5;
  let html = '';
  for (let i = 0; i < 5; i++) {
    if (i < full)        html += `<i class="fas fa-star" style="color:#E8A53A;font-size:${size}px;"></i>`;
    else if (i === full && half) html += `<i class="fas fa-star-half-stroke" style="color:#E8A53A;font-size:${size}px;"></i>`;
    else                 html += `<i class="far fa-star" style="color:#D6CFC2;font-size:${size}px;"></i>`;
  }
  return html;
}

function productReviewsFor(productId) {
  return state.testimonials.filter(t => t.product_id === productId);
}

function productReviewSummary(productId) {
  const list = productReviewsFor(productId);
  if (!list.length) return { count: 0, avg: 0 };
  const sum = list.reduce((s, t) => s + Number(t.rating || 0), 0);
  return { count: list.length, avg: sum / list.length };
}

function renderProductReviews(productId) {
  const list = productReviewsFor(productId);
  if (!list.length) {
    return `<div class="empty-state" style="background:#fdfaf3;border:1px dashed var(--line);padding:32px 24px;text-align:center;border-radius:var(--radius);">
      <i class="fas fa-comments" style="font-size:32px;color:var(--muted);"></i>
      <h4 style="margin:10px 0 4px;font-size:1.05rem;">No reviews yet</h4>
      <p style="color:var(--muted);font-size:13px;margin:0;">Be the first to share your experience with this product.</p>
    </div>`;
  }
  return `<div class="reviews-list" style="display:flex;flex-direction:column;gap:14px;">
    ${list.map(t => `
      <article class="review-card" style="background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:18px 20px;">
        <header style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:8px;">
          <div>
            <div style="display:flex;align-items:center;gap:10px;">
              <strong style="color:var(--ink);">${escapeHTML(t.customer_name)}</strong>
              ${t.is_verified ? '<span style="font-size:10px;background:#E6F4EA;color:#1E8449;padding:2px 8px;border-radius:999px;font-weight:600;letter-spacing:0.5px;"><i class="fas fa-circle-check"></i> Verified Buyer</span>' : ''}
            </div>
            <div style="margin-top:4px;">${starsHTML(t.rating, 12)} <span style="font-size:11px;color:var(--muted);margin-left:6px;">${new Date(t.created_at).toLocaleDateString('en-IN',{month:'short',year:'numeric'})}</span></div>
          </div>
        </header>
        ${t.title ? `<h4 style="margin:0 0 6px;font-size:14px;color:var(--ink);">${escapeHTML(t.title)}</h4>` : ''}
        <p style="margin:0;color:var(--ink-soft);font-size:14px;line-height:1.55;">${escapeHTML(t.review_text)}</p>
        ${t.image_url ? `<img src="${escapeHTML(t.image_url)}" alt="" style="margin-top:10px;max-width:140px;border-radius:8px;border:1px solid var(--line);" />` : ''}
      </article>`).join('')}
  </div>`;
}

// Modal launcher used by product detail page
window.openProductReviewModal = function(productId, reviewToken) {
  const modal = $('#product-review-modal');
  if (!modal) return;
  $('#prm-product-id').value = productId || '';
  $('#prm-review-token').value = reviewToken || '';
  $('#prm-error').style.display = 'none';
  $('#prm-error').textContent = '';
  $('#prm-text').value = '';
  $('#prm-title').value = '';
  $('#prm-rating').value = '5';
  modal.showModal();
};

// ---------- Fullscreen Image Lightbox (zoom, swipe, pinch, keyboard) ----------
window.openLightbox = function(images, startIdx = 0, alt = '') {
  if (!images || !images.length) return;
  let idx = Math.max(0, Math.min(startIdx, images.length - 1));
  let scale = 1, tx = 0, ty = 0;
  let pointers = new Map(), lastDist = 0, lastTap = 0, swipeStartX = null;

  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.setAttribute('data-testid', 'image-lightbox');
  lb.innerHTML = `
    <button class="lb-close" aria-label="Close" data-testid="lb-close"><i class="fas fa-xmark"></i></button>
    ${images.length > 1 ? `
      <button class="lb-nav lb-prev" aria-label="Previous image" data-testid="lb-prev"><i class="fas fa-chevron-left"></i></button>
      <button class="lb-nav lb-next" aria-label="Next image" data-testid="lb-next"><i class="fas fa-chevron-right"></i></button>` : ''}
    <div class="lb-stage"><img class="lb-img" src="${escapeHTML(images[idx])}" alt="${escapeHTML(alt)}" draggable="false" decoding="async" /></div>
    <div class="lb-footer">
      <span class="lb-counter" data-testid="lb-counter">${idx + 1} / ${images.length}</span>
      ${images.length > 1 ? `<div class="lb-dots">${images.map((_, i) => `<button class="lb-dot ${i===idx?'on':''}" data-i="${i}"></button>`).join('')}</div>` : ''}
    </div>`;
  document.body.appendChild(lb);
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => lb.classList.add('open'));

  const img = lb.querySelector('.lb-img');
  const stage = lb.querySelector('.lb-stage');
  const applyT = () => { img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`; };
  const resetT = () => { scale = 1; tx = 0; ty = 0; applyT(); };

  function show(i) {
    idx = (i + images.length) % images.length;
    resetT();
    img.style.opacity = '0';
    img.src = images[idx];
    img.onload = () => { img.style.opacity = '1'; };
    lb.querySelector('.lb-counter').textContent = `${idx + 1} / ${images.length}`;
    lb.querySelectorAll('.lb-dot').forEach((d, i2) => d.classList.toggle('on', i2 === idx));
  }
  function close() {
    lb.classList.remove('open');
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    setTimeout(() => lb.remove(), 220);
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') show(idx - 1);
    else if (e.key === 'ArrowRight') show(idx + 1);
  }
  document.addEventListener('keydown', onKey);
  lb.querySelector('.lb-close').addEventListener('click', close);
  lb.querySelector('.lb-prev')?.addEventListener('click', (e) => { e.stopPropagation(); show(idx - 1); });
  lb.querySelector('.lb-next')?.addEventListener('click', (e) => { e.stopPropagation(); show(idx + 1); });
  lb.querySelectorAll('.lb-dot').forEach(d => d.addEventListener('click', (e) => { e.stopPropagation(); show(Number(d.dataset.i)); }));
  lb.addEventListener('click', (e) => { if (e.target === lb || e.target === stage) close(); });

  // Double-click / double-tap zoom toggle
  img.addEventListener('dblclick', (e) => {
    e.preventDefault();
    if (scale > 1) resetT();
    else { scale = 2.4; applyT(); }
  });

  // Pointer events: pinch-zoom + pan + swipe
  stage.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      swipeStartX = e.clientX;
      const now = Date.now();
      if (now - lastTap < 300) { // double-tap
        if (scale > 1) resetT(); else { scale = 2.4; applyT(); }
        swipeStartX = null;
      }
      lastTap = now;
    }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      lastDist = Math.hypot(a.x - b.x, a.y - b.y);
      swipeStartX = null;
    }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (lastDist) {
        scale = Math.max(1, Math.min(4, scale * (dist / lastDist)));
        if (scale === 1) { tx = 0; ty = 0; }
        applyT();
      }
      lastDist = dist;
    } else if (pointers.size === 1 && scale > 1) {
      tx += e.clientX - prev.x;
      ty += e.clientY - prev.y;
      applyT();
    }
  });
  const endPointer = (e) => {
    if (pointers.size === 1 && swipeStartX != null && scale === 1) {
      const dx = e.clientX - swipeStartX;
      if (Math.abs(dx) > 60 && images.length > 1) show(dx < 0 ? idx + 1 : idx - 1);
    }
    pointers.delete(e.pointerId);
    if (pointers.size < 2) lastDist = 0;
    if (!pointers.size) swipeStartX = null;
  };
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
};

// ---------- Complete-profile gate (mandatory mobile + email for marketing) ----------
function maybeShowCompleteProfile() {
  if (!state.user || state.isAdmin) return;
  const p = state.profile || {};
  const meta = state.user.user_metadata || {};
  const authEmail = state.user.email || '';
  const bestName = p.name || meta.full_name || meta.name || (authEmail ? authEmail.split('@')[0] : '');
  const hasPhone = p.phone && String(p.phone).replace(/\D/g, '').length >= 10;
  const hasEmail = !!(p.email || authEmail);

  // Silently sync auth email/name into the profile for the marketing directory
  if (hasPhone && hasEmail) {
    if ((!p.email && authEmail) || !p.name) {
      supabaseClient.from('profiles').upsert({
        id: state.user.id,
        name: bestName || 'Customer',
        email: p.email || authEmail,
        phone: p.phone,
      }).then(({ error }) => {
        if (error && error.message?.includes('email')) {
          supabaseClient.from('profiles').upsert({ id: state.user.id, name: bestName || 'Customer', phone: p.phone }).then(() => {});
        }
      });
    }
    if (!p.welcome_coupon_sent_at) claimWelcomeOffer();
    return;
  }

  const ov = document.createElement('div');
  ov.className = 'cp-overlay';
  ov.setAttribute('data-testid', 'complete-profile-modal');
  ov.innerHTML = `
    <div class="cp-card">
      <div style="text-align:center;margin-bottom:6px;"><i class="fas fa-user-check" style="font-size:28px;color:var(--gold);"></i></div>
      <h3 style="text-align:center;margin:0 0 4px;font-size:1.25rem;">Complete your profile</h3>
      <p style="text-align:center;color:var(--muted);font-size:13px;margin:0 0 18px;">Just once — so we can send order updates and exclusive offers.</p>
      <div id="cp-err" style="display:none;background:#fbecec;color:var(--error);border:1px solid #e8c1c1;padding:9px;border-radius:6px;font-size:12px;margin-bottom:12px;"></div>
      <label class="cp-label">Full Name
        <input class="field" id="cp-name" value="${escapeHTML(bestName)}" placeholder="Your name" data-testid="cp-name" />
      </label>
      <label class="cp-label">Mobile Number <span style="color:var(--error);">*</span>
        <div style="display:flex;gap:8px;margin-top:6px;">
          <span style="display:flex;align-items:center;padding:0 12px;background:var(--cream);border:1px solid var(--line);border-radius:8px;font-size:14px;font-weight:600;">+91</span>
          <input class="field" id="cp-phone" type="tel" maxlength="10" inputmode="numeric" value="${escapeHTML(String(p.phone || '').replace(/^\+?91/, '').replace(/\D/g, '').slice(-10))}" placeholder="10-digit mobile" style="flex:1;margin-top:0;" data-testid="cp-phone" />
        </div>
      </label>
      <label class="cp-label">Email ${authEmail ? '' : '<span style="color:var(--error);">*</span>'}
        <input class="field" id="cp-email" type="email" value="${escapeHTML(p.email || authEmail)}" ${authEmail ? 'readonly style="margin-top:6px;background:var(--cream);color:var(--muted);"' : 'placeholder="you@example.com"'} data-testid="cp-email" />
      </label>
      <button class="btn primary" id="cp-save" style="width:100%;margin-top:16px;" data-testid="cp-save"><i class="fas fa-check"></i> Save & Continue</button>
      <div style="text-align:center;margin-top:12px;"><button id="cp-logout" style="background:none;border:none;color:var(--muted);font-size:12px;cursor:pointer;text-decoration:underline;">Sign out instead</button></div>
    </div>`;
  document.body.appendChild(ov);
  document.body.style.overflow = 'hidden';

  const showErr = (m) => { const e = ov.querySelector('#cp-err'); e.textContent = m; e.style.display = 'block'; };
  ov.querySelector('#cp-logout').addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    location.href = 'index.html';
  });
  ov.querySelector('#cp-save').addEventListener('click', async () => {
    const name = ov.querySelector('#cp-name').value.trim();
    const phone = ov.querySelector('#cp-phone').value.replace(/\D/g, '');
    const email = ov.querySelector('#cp-email').value.trim().toLowerCase();
    if (name.length < 2) return showErr('Please enter your full name.');
    if (!/^[6-9]\d{9}$/.test(phone)) return showErr('Please enter a valid 10-digit Indian mobile number.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showErr('Please enter a valid email address.');
    const btn = ov.querySelector('#cp-save');
    btn.disabled = true; btn.innerHTML = 'Saving…';
    let { error } = await supabaseClient.from('profiles').upsert({
      id: state.user.id, name, phone: '+91' + phone, email,
    });
    if (error && error.message?.includes('email')) {
      // profiles.email column missing (migration not yet run) — save without it
      ({ error } = await supabaseClient.from('profiles').upsert({ id: state.user.id, name, phone: '+91' + phone }));
    }
    if (error) {
      btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Save & Continue';
      return showErr('Could not save: ' + error.message);
    }
    state.profile = { ...(state.profile || {}), name, phone: '+91' + phone, email };
    document.body.style.overflow = '';
    ov.remove();
    toast('Profile saved. Welcome to ONCOST!', 'ok');
    renderAuthState();
    claimWelcomeOffer();
  });
}

// One-time welcome coupon for new signups (server validates eligibility)
function claimWelcomeOffer() {
  if (!state.user?.created_at) return;
  if (Date.now() - new Date(state.user.created_at).getTime() > 14 * 86400000) return;
  supabaseClient.auth.getSession().then(({ data: { session } }) => {
    if (!session) return;
    fetch('/api/store/welcome-offer', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    }).then(r => (r.ok ? r.json() : null)).then(j => {
      if (j?.code) setTimeout(() => toast(`🎁 Welcome gift! Coupon ${j.code} (₹${j.amount} off) sent to your email`, 'ok'), 1200);
    }).catch(() => {});
  });
}

// ---------- UX layer: scroll polish, reveal animations, back-to-top, sticky mobile buy bar ----------
function initUXEnhancements() {
  const header = document.querySelector('.site-header');

  // Back-to-top button
  const backTop = document.createElement('button');
  backTop.className = 'back-to-top';
  backTop.setAttribute('aria-label', 'Back to top');
  backTop.setAttribute('data-testid', 'back-to-top');
  backTop.innerHTML = '<i class="fas fa-chevron-up"></i>';
  backTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  document.body.appendChild(backTop);

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      if (header) header.classList.toggle('scrolled', y > 8);
      backTop.classList.toggle('show', y > 600);
      ticking = false;
    });
  }, { passive: true });

  // Scroll-reveal + sticky buy bar are content-dependent; some renders finish
  // async after bootstrap, so scan now and re-scan shortly after.
  applyContentUX();
  setTimeout(applyContentUX, 1200);
  setTimeout(applyContentUX, 2800);
}

function applyContentUX() {
  // Scroll-reveal with gentle stagger
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    if (!window._revealIO) {
      window._revealIO = new IntersectionObserver((entries) => {
        entries.forEach(e => {
          if (e.isIntersecting) { e.target.classList.add('in'); window._revealIO.unobserve(e.target); }
        });
      }, { threshold: 0.06, rootMargin: '0px 0px -40px 0px' });
    }
    document.querySelectorAll('.product-card, .collection-card, .testimonial-card, .order-card, .loyalty-card').forEach((el, i) => {
      if (el.classList.contains('reveal')) return;
      el.classList.add('reveal');
      el.style.transitionDelay = `${(i % 4) * 70}ms`;
      window._revealIO.observe(el);
    });
  }

  // Sticky mobile buy bar on product detail (CSS hides it on desktop)
  const atc = document.querySelector('[data-testid="pd-add-cart"]');
  if (atc && !document.querySelector('.sticky-buy-bar')) {
    const priceText = document.querySelector('[data-pd-price]')?.textContent || '';
    const bar = document.createElement('div');
    bar.className = 'sticky-buy-bar';
    bar.setAttribute('data-testid', 'sticky-buy-bar');
    bar.innerHTML = `
      <div class="sbb-price"><span>${escapeHTML(priceText)}</span><small>incl. all taxes</small></div>
      <button class="btn primary" data-testid="sticky-add-cart" ${atc.disabled ? 'disabled' : ''}><i class="fas fa-cart-plus"></i> Add to Cart</button>`;
    bar.querySelector('[data-testid="sticky-add-cart"]').addEventListener('click', () => atc.click());
    document.body.appendChild(bar);
    const io2 = new IntersectionObserver((entries) => {
      bar.classList.toggle('show', !entries[0].isIntersecting);
    }, { threshold: 0 });
    io2.observe(atc);
    // Keep sticky price in sync with variant changes
    const priceEl = document.querySelector('[data-pd-price]');
    if (priceEl) new MutationObserver(() => {
      bar.querySelector('.sbb-price span').textContent = priceEl.textContent;
    }).observe(priceEl, { childList: true, characterData: true, subtree: true });
  }
}

// ---------- Categories ----------
async function loadCategories() {
  try {
    const { data } = await supabaseClient.from('categories').select('*').order('name', { ascending: true });
    state.categories = data || [];
  } catch { state.categories = []; }
}

// ---------- Account ----------
async function renderAccount() {
  const slot = $('[data-account]');
  if (!slot) return;
  if (!state.user) {
    slot.innerHTML = `<div class="empty-state"><i class="fas fa-user-lock"></i><h3>Please sign in</h3><p>Access your orders, wishlist and bulk enquiries.</p><a class="btn primary" href="login.html"><i class="fas fa-right-to-bracket"></i> Sign in</a> <a class="btn outline" href="signup.html">Create account</a></div>`;
    return;
  }
  const tab = param('tab') || 'orders';
  let orders = [], leads = [], loyaltyTxns = [], addresses = [], offers = [];
  // Match orders by user_id OR by email (so guest orders placed BEFORE signup also appear)
  try {
    const r = await supabaseClient
      .from('orders')
      .select('*')
      .or(`user_id.eq.${state.user.id},guest_email.eq.${state.user.email}`)
      .order('created_at', { ascending: false });
    orders = r.data || [];
  } catch { /* ignore */ }
  try { const r = await supabaseClient.from('leads').select('*').eq('user_id', state.user.id).order('created_at', { ascending: false }); leads = r.data || []; } catch { /* ignore */ }
  if (tab === 'loyalty') {
    try {
      const r = await supabaseClient.from('loyalty_transactions').select('*').eq('user_id', state.user.id).order('created_at', { ascending: false }).limit(50);
      loyaltyTxns = r.data || [];
    } catch { /* migration not run yet */ }
    try {
      const { data: prof } = await supabaseClient.from('profiles').select('*').eq('id', state.user.id).single();
      if (prof) state.profile = prof;
    } catch { /* ignore */ }
  }
  if (tab === 'addresses') {
    try { const r = await supabaseClient.from('addresses').select('*').eq('user_id', state.user.id).order('is_default', { ascending: false }).order('created_at', { ascending: false }); addresses = r.data || []; } catch { /* ignore */ }
  }
  if (tab === 'offers') {
    try { const r = await supabaseClient.from('coupons').select('*').or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).order('created_at', { ascending: false }); offers = r.data || []; } catch { /* ignore */ }
  }

  slot.innerHTML = `
    <div class="account-grid">
      <aside class="account-side">
        <div style="padding:6px 12px 16px;border-bottom:1px solid var(--line);margin-bottom:12px;">
          <div style="font-weight:600;font-size:14px;">${escapeHTML(state.profile?.name || state.user.email.split('@')[0])}</div>
          <div style="font-size:12px;color:var(--muted);">${escapeHTML(state.user.email)}</div>
        </div>
        <button class="${tab==='orders'?'active':''}" onclick="location.href='account.html?tab=orders'" data-testid="acct-tab-orders"><i class="fas fa-receipt"></i> My Orders</button>
        <button class="${tab==='loyalty'?'active':''}" onclick="location.href='account.html?tab=loyalty'" data-testid="acct-tab-loyalty"><i class="fas fa-coins"></i> Loyalty Points ${Number(state.profile?.loyalty_points||0) > 0 ? `<span style="margin-left:auto;background:var(--gold);color:var(--burgundy);padding:1px 7px;border-radius:10px;font-size:11px;font-weight:700;">${Number(state.profile.loyalty_points)}</span>` : ''}</button>
        <button class="${tab==='wishlist'?'active':''}" onclick="location.href='account.html?tab=wishlist'" data-testid="acct-tab-wishlist"><i class="fas fa-heart"></i> Wishlist ${state.wishlist.length ? `<span style="margin-left:auto;background:var(--burgundy);color:#fff;padding:1px 7px;border-radius:10px;font-size:11px;">${state.wishlist.length}</span>` : ''}</button>
        <button class="${tab==='offers'?'active':''}" onclick="location.href='account.html?tab=offers'" data-testid="acct-tab-offers"><i class="fas fa-ticket"></i> Offers</button>
        <button class="${tab==='enquiries'?'active':''}" onclick="location.href='account.html?tab=enquiries'" data-testid="acct-tab-enquiries"><i class="fas fa-envelope"></i> Enquiries</button>
        <button class="${tab==='addresses'?'active':''}" onclick="location.href='account.html?tab=addresses'" data-testid="acct-tab-addresses"><i class="fas fa-map-marker-alt"></i> Addresses</button>
        <button class="${tab==='profile'?'active':''}" onclick="location.href='account.html?tab=profile'" data-testid="acct-tab-profile"><i class="fas fa-user"></i> Profile</button>
        <button onclick="location.href='support.html'" data-testid="acct-tab-support"><i class="fas fa-headset"></i> Support</button>
        ${state.isAdmin ? `<button onclick="location.href='admin-dashboard.html'" style="color:var(--gold);font-weight:700;border-top:1px solid var(--line);margin-top:8px;padding-top:14px;"><i class="fas fa-shield-halved"></i> Admin Console</button>` : ''}
        <button onclick="doLogout()"><i class="fas fa-right-from-bracket"></i> Sign out</button>
      </aside>
      <main class="account-pane">
        ${tab === 'orders' ? renderAccountOrders(orders) : ''}
        ${tab === 'loyalty' ? renderAccountLoyalty(loyaltyTxns) : ''}
        ${tab === 'wishlist' ? renderAccountWishlist() : ''}
        ${tab === 'offers' ? renderAccountOffers(offers) : ''}
        ${tab === 'enquiries' ? renderAccountLeads(leads) : ''}
        ${tab === 'addresses' ? renderAccountAddresses(addresses) : ''}
        ${tab === 'profile' ? renderAccountProfile() : ''}
      </main>
    </div>
  `;
}

function renderAccountOffers(offers) {
  if (!offers.length) return `<h2>Active Offers</h2><div class="empty-state"><i class="fas fa-ticket"></i><h3>No active offers</h3><p>There are no discount codes currently available.</p></div>`;
  
  return `<h2>Active Offers</h2>
    <div style="display:grid;gap:16px;margin-top:16px;">
      ${offers.map(c => `
        <div style="border:1px dashed var(--gold);background:var(--champagne);padding:16px;border-radius:8px;display:flex;align-items:center;justify-content:space-between;">
          <div>
            <div style="font-weight:700;color:var(--burgundy);font-size:18px;margin-bottom:4px;">Save ${c.discount_type === 'percent' ? escapeHTML(c.discount_value) + '%' : '₹' + escapeHTML(c.discount_value)}</div>
            <div style="font-size:13px;color:var(--text);">
              ${c.min_order_amount ? `On minimum order of ₹${escapeHTML(c.min_order_amount)}.` : 'Applicable on all orders.'}
              ${c.expires_at ? `Expires: ${new Date(c.expires_at).toLocaleDateString()}` : ''}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;">
            <div style="font-family:monospace;background:#fff;border:1px solid var(--gold);padding:6px 12px;border-radius:4px;font-size:16px;font-weight:700;color:var(--burgundy);letter-spacing:1px;">${escapeHTML(c.code)}</div>
            <button class="btn outline btn-sm" onclick="copyCoupon('${escapeHTML(c.code)}')"><i class="far fa-copy"></i> Copy Code</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}
function renderAccountWishlist() {
  if (!state.wishlist.length) return `<h2>My Wishlist</h2><div class="empty-state"><i class="fas fa-heart"></i><h3>No favorites yet</h3><p>Tap the ♡ on any product card to save it here.</p><a class="btn primary" href="products.html"><i class="fas fa-store"></i> Browse Products</a></div>`;
  const items = state.wishlist.map(w => state.products.find(p => p.id === w.product_id)).filter(Boolean);
  if (!items.length) return `<h2>My Wishlist</h2><div class="empty-state"><i class="fas fa-heart"></i><h3>Wishlist items unavailable</h3><p>Items in your wishlist are no longer in the catalog.</p></div>`;
  return `<h2>My Wishlist <span style="font-size:14px;color:var(--muted);font-weight:400;">· ${items.length} item${items.length===1?'':'s'}</span></h2>
    <div class="product-grid" style="margin-top:18px;">${items.map(productCardHTML).join('')}</div>`;
}
const ORDER_STATUS_TONES = {
  Paid: ['#E6F4EA', '#1E8449'], Delivered: ['#E6F4EA', '#1E8449'], Shipped: ['#E8F0FE', '#1A56DB'],
  Packed: ['#FFF8E7', '#92600A'], Confirmed: ['#FFF8E7', '#92600A'], Processing: ['#F4F0E8', '#7A726B'],
  Pending: ['#F4F0E8', '#7A726B'], Cancelled: ['#FBECEC', '#C0392B'], Failed: ['#FBECEC', '#C0392B'],
  Returned: ['#FBECEC', '#C0392B'], Refunded: ['#E8F0FE', '#1A56DB'],
};
function orderBadge(status) {
  const [bg, fg] = ORDER_STATUS_TONES[status] || ORDER_STATUS_TONES.Pending;
  return `<span style="padding:4px 12px;border-radius:999px;background:${bg};color:${fg};font-size:12px;font-weight:700;letter-spacing:.3px;">${escapeHTML(status || 'Pending')}</span>`;
}
const CANCELLABLE_STATUSES = ['Processing', 'Pending', 'Paid', 'Confirmed', 'Packed'];

function renderAccountOrders(orders) {
  if (!orders.length) return `<h2>My Orders</h2><div class="empty-state"><i class="fas fa-receipt"></i><h3>No orders yet</h3><p>Your orders will show up here.</p><a class="btn primary" href="products.html">Browse Products</a></div>`;
  state._accountOrders = orders;
  return `<h2>My Orders <span style="font-size:14px;color:var(--muted);font-weight:400;">· ${orders.length} order${orders.length===1?'':'s'}</span></h2>
  ${orders.map(o => {
    let items = [];
    try { items = typeof o.items === 'string' ? JSON.parse(o.items) : (Array.isArray(o.items) ? o.items : []); } catch (e) { items = []; }
    const displayId = o.ccavenue_order_id || ('#' + String(o.id).substring(0, 8));
    const awb = o.awb_number || o.shipping_awb || '';
    const canCancel = CANCELLABLE_STATUSES.includes(o.status);
    const isPaid = o.payment_status === 'Paid' || o.status === 'Paid' || ['Shipped','Delivered','Packed'].includes(o.status);
    const subtotal = Number(o.items_subtotal || 0);
    const shipping = Number(o.shipping_amount || 0);
    const discount = Number(o.discount_amount || 0);
    const loyalty  = Number(o.loyalty_discount || 0);
    const itemRows = items.length ? items.map(it => {
      const prod = state.products.find(p => p.id === it.product_id);
      const img = prod?.image_url
        ? `<img src="${escapeHTML(prod.image_url)}" alt="" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'" />`
        : `<i class="fas fa-gift" style="color:var(--muted);"></i>`;
      const qty = Number(it.qty || it.quantity || 1);
      const price = Number(it.price || 0);
      return `<div class="oc-item" data-testid="order-item">
        <a class="oc-thumb" href="product.html?id=${encodeURIComponent(it.product_id || '')}">${img}</a>
        <div class="oc-item-meta">
          <a href="product.html?id=${encodeURIComponent(it.product_id || '')}" class="oc-item-name">${escapeHTML(it.name || 'Item')}</a>
          <div class="oc-item-sub">${fmtINR(price)} × ${qty}</div>
        </div>
        <div class="oc-item-total">${fmtINR(price * qty)}</div>
        ${o.status === 'Delivered' && it.product_id ? `<button class="btn ghost sm" onclick="${typeof openFeedbackModal === 'function' ? `openFeedbackModal('${escapeHTML(String(o.id))}','${escapeHTML(it.product_id)}','${escapeHTML(it.name || '')}')` : `location.href='product.html?id=${encodeURIComponent(it.product_id)}#reviews'`}" title="Rate this product" data-testid="order-rate-btn"><i class="fas fa-star"></i> Rate</button>` : ''}
      </div>`;
    }).join('') : `<div style="padding:14px;color:var(--muted);font-size:13px;">Item details unavailable for this order.</div>`;

    return `<article class="order-card" data-testid="order-card-${escapeHTML(String(o.id))}">
      <header class="oc-head">
        <div>
          <div class="oc-id">${escapeHTML(displayId)}</div>
          <div class="oc-date"><i class="far fa-calendar"></i> ${new Date(o.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
        </div>
        <div class="oc-badges">
          ${orderBadge(o.status)}
          ${o.payment_status && o.payment_status !== o.status ? `<span style="font-size:11px;color:var(--muted);">Payment: ${escapeHTML(o.payment_status)}</span>` : ''}
          ${awb ? `<span style="font-size:11px;color:var(--muted);">AWB: ${escapeHTML(awb)}</span>` : ''}
        </div>
      </header>
      <div class="oc-items">${itemRows}</div>
      <div class="oc-summary">
        ${subtotal ? `<div class="line"><span>Subtotal</span><span>${fmtINR(subtotal)}</span></div>` : ''}
        ${discount > 0 ? `<div class="line" style="color:var(--success);"><span>Discount</span><span>−${fmtINR(discount)}</span></div>` : ''}
        ${loyalty > 0 ? `<div class="line" style="color:var(--success);"><span>Loyalty points used</span><span>−${fmtINR(loyalty)}</span></div>` : ''}
        ${Number(o.gift_wrap_charge || 0) > 0 ? `<div class="line"><span><i class="fas fa-gift" style="color:var(--burgundy);"></i> Gift wrap${o.gift_message ? ' + note' : ''}</span><span>${fmtINR(o.gift_wrap_charge)}</span></div>` : ''}
        ${subtotal ? `<div class="line"><span>Shipping</span><span>${shipping === 0 ? 'Free' : fmtINR(shipping)}</span></div>` : ''}
        <div class="line total"><span>Grand Total</span><span>${fmtINR(o.total_amount)}</span></div>
      </div>
      <footer class="oc-actions">
        ${isPaid ? `<a class="btn outline sm" href="/api/store/invoice-pdf?order_id=${encodeURIComponent(o.ccavenue_order_id || o.id)}&email=${encodeURIComponent(o.guest_email || state.user.email)}" data-testid="order-invoice-btn"><i class="fas fa-file-arrow-down"></i> Invoice</a>` : ''}
        ${o.tracking_url ? `<a class="btn outline sm" href="${escapeHTML(o.tracking_url)}" target="_blank" rel="noopener" data-testid="order-track-btn"><i class="fas fa-truck-fast"></i> Track</a>` : (awb ? `<a class="btn outline sm" href="https://www.delhivery.com/track-v2/package/${escapeHTML(awb)}" target="_blank" rel="noopener" data-testid="order-track-btn"><i class="fas fa-truck-fast"></i> Track</a>` : '')}
        ${items.length ? `<button class="btn outline sm" onclick="buyAgain('${escapeHTML(String(o.id))}')" data-testid="order-buyagain-btn"><i class="fas fa-rotate-right"></i> Buy Again</button>` : ''}
        ${canCancel ? `<button class="btn ghost sm" style="color:var(--error);" onclick="cancelMyOrder('${escapeHTML(String(o.id))}')" data-testid="order-cancel-btn"><i class="fas fa-ban"></i> Cancel</button>` : ''}
        <a class="btn ghost sm" href="support.html?order_id=${encodeURIComponent(o.ccavenue_order_id || o.id)}" data-testid="order-support-btn"><i class="fas fa-headset"></i> Help</a>
      </footer>
    </article>`;
  }).join('')}`;
}

window.buyAgain = async function(orderId) {
  const o = (state._accountOrders || []).find(x => String(x.id) === String(orderId));
  if (!o || !Array.isArray(o.items)) return;
  let added = 0;
  for (const it of o.items) {
    const prod = state.products.find(p => p.id === it.product_id);
    if (!prod || Number(prod.stock || 0) === 0) continue;
    await addToCart(it.product_id, Number(it.qty || it.quantity || 1));
    added++;
  }
  if (added) setTimeout(() => location.href = 'cart.html', 700);
  else toast('These items are no longer available', 'err');
};

window.cancelMyOrder = async function(orderId) {
  if (!confirm('Cancel this order? If you already paid, our team will process your refund within 5–7 working days.')) return;
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const r = await fetch('/api/store/cancel-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify({ order_id: orderId }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Cancellation failed');
    toast('Order cancelled', 'ok');
    renderAccount();
  } catch (e) { toast(e.message, 'err'); }
};

function renderAccountLoyalty(txns) {
  const p = state.profile || {};
  const balance = Number(p.loyalty_points || 0);
  const earned = Number(p.lifetime_points_earned || 0);
  const redeemed = Number(p.lifetime_points_redeemed || 0);
  const TXN_META = {
    earn:   ['fa-circle-plus', 'var(--success, #1E8449)', 'Earned'],
    redeem: ['fa-circle-minus', 'var(--burgundy)', 'Redeemed'],
    refund: ['fa-rotate-left', '#1A56DB', 'Refunded'],
    adjust: ['fa-sliders', '#92600A', 'Adjustment'],
  };
  return `<h2>Loyalty Points</h2>
    <div class="loyalty-cards">
      <div class="loyalty-card main" data-testid="loyalty-balance-card">
        <div class="lc-label"><i class="fas fa-coins"></i> Available Balance</div>
        <div class="lc-value">${balance.toLocaleString('en-IN')}</div>
        <div class="lc-sub">Worth ${fmtINR(balance)} on your next order</div>
      </div>
      <div class="loyalty-card">
        <div class="lc-label">Lifetime Earned</div>
        <div class="lc-value" style="font-size:1.6rem;">${earned.toLocaleString('en-IN')}</div>
      </div>
      <div class="loyalty-card">
        <div class="lc-label">Points Redeemed</div>
        <div class="lc-value" style="font-size:1.6rem;">${redeemed.toLocaleString('en-IN')}</div>
      </div>
    </div>
    <div style="background:var(--gold-soft);border:1px solid var(--gold);border-radius:var(--radius);padding:14px 18px;font-size:13px;margin:18px 0;line-height:1.6;">
      <strong><i class="fas fa-circle-info"></i> How it works:</strong>
      Earn <strong>1 point for every ₹10 spent</strong> — credited when your order is delivered.
      Redeem points at checkout (1 point = ₹1) for up to <strong>50% of your order value</strong>.
    </div>
    <h3 style="font-size:1.05rem;margin:22px 0 10px;">Points History</h3>
    ${!txns.length
      ? `<div class="empty-state" style="padding:32px;"><i class="fas fa-coins"></i><h3>No transactions yet</h3><p>Complete an order to start earning points.</p><a class="btn primary" href="products.html">Shop Now</a></div>`
      : `<div class="loyalty-history" data-testid="loyalty-history">${txns.map(t => {
          const [icon, color, label] = TXN_META[t.type] || TXN_META.adjust;
          const pts = Number(t.points || 0);
          return `<div class="lh-row">
            <i class="fas ${icon}" style="color:${color};font-size:18px;"></i>
            <div class="lh-meta">
              <div class="lh-title">${label}${t.note ? ` · <span style="font-weight:400;color:var(--muted);">${escapeHTML(t.note)}</span>` : ''}</div>
              <div class="lh-date">${new Date(t.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
            </div>
            <div class="lh-points" style="color:${pts >= 0 ? 'var(--success, #1E8449)' : 'var(--burgundy)'};">${pts >= 0 ? '+' : ''}${pts.toLocaleString('en-IN')}</div>
          </div>`;
        }).join('')}</div>`}`;
}
function renderAccountLeads(leads) {
  if (!leads.length) return `<h2>My Enquiries</h2><div class="empty-state"><i class="fas fa-envelope-open"></i><h3>No enquiries yet</h3><p>Need bulk pricing or customization? Send us an enquiry.</p><a class="btn primary" href="bulk.html">Submit Bulk Enquiry</a></div>`;
  return `<h2>My Enquiries</h2>${leads.map(l => `
    <div style="border:1px solid var(--line);border-radius:6px;padding:16px;margin-bottom:12px;">
      <div style="font-size:12px;color:var(--muted);margin-bottom:6px;">${new Date(l.created_at).toLocaleDateString()} ${l.product_id ? `· ${escapeHTML(l.product_id)}` : ''}</div>
      <div style="font-size:14px;">${escapeHTML(l.summary)}</div>
    </div>
  `).join('')}`;
}
function renderAccountProfile() {
  const p = state.profile || {};
  return `<h2>Profile</h2>
    <div style="display:grid;gap:14px;max-width:480px;">
      <label>Name <input id="prof-name" class="field" value="${escapeHTML(p.name||'')}" /></label>
      <label>Phone <input id="prof-phone" class="field" value="${escapeHTML(p.phone||'')}" /></label>
      <button class="btn primary" onclick="saveProfile()" style="justify-self:start;"><i class="fas fa-save"></i> Save</button>
    </div>`;
}

function renderAccountAddresses(addresses) {
  state.addresses = addresses; // Save to state for edit modal
  let html = `<h2>Saved Addresses</h2>`;
  if (!addresses.length) {
    html += `<div class="empty-state"><i class="fas fa-map-location-dot"></i><h3>No addresses saved</h3><p>Save an address to checkout faster next time.</p></div>`;
  } else {
    html += `<div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));">
      ${addresses.map(a => `
        <div style="border:1px solid var(--line);border-radius:6px;padding:16px;position:relative;">
          ${a.is_default ? '<span style="position:absolute;top:10px;right:10px;background:var(--burgundy);color:#fff;font-size:10px;padding:2px 6px;border-radius:4px;">Default</span>' : ''}
          <div style="font-weight:600;margin-bottom:4px;">${escapeHTML(a.name)}</div>
          <div style="font-size:13px;color:var(--muted);line-height:1.4;">
            ${escapeHTML(a.address)}<br/>
            ${escapeHTML(a.city)}, ${escapeHTML(a.state)} - ${escapeHTML(a.zip)}<br/>
            Phone: ${escapeHTML(a.phone)}<br/>
            ${a.email ? `Email: ${escapeHTML(a.email)}` : ''}
          </div>
          <div style="margin-top:10px;display:flex;gap:10px;">
            <button class="btn outline btn-sm" onclick="editAddress('${a.id}')"><i class="fas fa-edit"></i> Edit</button>
            <button class="btn outline btn-sm" onclick="deleteAddress('${a.id}')"><i class="fas fa-trash"></i> Delete</button>
          </div>
        </div>
      `).join('')}
    </div>`;
  }
  html += `<button class="btn primary" style="margin-top:16px;" onclick="editAddress(null)"><i class="fas fa-plus"></i> Add New Address</button>`;
  
  // Add modal for editing
  html += `
  <dialog id="addr-modal" style="border:none;border-radius:8px;padding:24px;max-width:400px;width:90%;box-shadow:0 10px 30px rgba(0,0,0,0.2);">
    <h3 id="addr-title" style="margin-top:0;">Add Address</h3>
    <input type="hidden" id="addr-id" />
    <div style="display:grid;gap:10px;margin:16px 0;">
      <label>Full Name <input class="field" id="addr-name" required /></label>
      <label>Email <input class="field" id="addr-email" type="email" /></label>
      <label>Phone <input class="field" id="addr-phone" required /></label>
      <label>Address <textarea class="field" id="addr-street" rows="2" required></textarea></label>
      <div style="display:flex;gap:10px;">
        <label style="flex:1">City <input class="field" id="addr-city" required /></label>
        <label style="flex:1">State <input class="field" id="addr-state" required /></label>
      </div>
      <label>ZIP/PIN Code <input class="field" id="addr-zip" required /></label>
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:4px;">
        <input type="checkbox" id="addr-default" /> Set as default shipping address
      </label>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;">
      <button class="btn outline" onclick="document.getElementById('addr-modal').close()">Cancel</button>
      <button class="btn primary" onclick="saveAddress()">Save Address</button>
    </div>
  </dialog>
  `;
  return html;
}

window.editAddress = function(id) {
  const m = document.getElementById('addr-modal');
  let a = {};
  if (id) {
    a = state.addresses.find(x => x.id === id) || {};
    document.getElementById('addr-title').innerText = 'Edit Address';
  } else {
    document.getElementById('addr-title').innerText = 'Add Address';
  }
  document.getElementById('addr-id').value = a.id || '';
  document.getElementById('addr-name').value = a.name || '';
  document.getElementById('addr-email').value = a.email || '';
  document.getElementById('addr-phone').value = a.phone || '';
  document.getElementById('addr-street').value = a.address || '';
  document.getElementById('addr-city').value = a.city || '';
  document.getElementById('addr-state').value = a.state || '';
  document.getElementById('addr-zip').value = a.zip || '';
  document.getElementById('addr-default').checked = !!a.is_default;
  m.showModal();
};

window.saveAddress = async function() {
  const id = document.getElementById('addr-id').value;
  const is_default = document.getElementById('addr-default').checked;
  const payload = {
    user_id: state.user.id,
    name: document.getElementById('addr-name').value,
    email: document.getElementById('addr-email').value,
    phone: document.getElementById('addr-phone').value,
    address: document.getElementById('addr-street').value,
    city: document.getElementById('addr-city').value,
    state: document.getElementById('addr-state').value,
    zip: document.getElementById('addr-zip').value,
    is_default
  };
  
  if (!payload.name || !payload.phone || !payload.address || !payload.city || !payload.state || !payload.zip) {
    return toast('Please fill all required fields', 'err');
  }

  // If this is set to default, unset others first
  if (is_default) {
    await supabaseClient.from('addresses').update({ is_default: false }).eq('user_id', state.user.id).neq('id', id || '00000000-0000-0000-0000-000000000000');
  }

  let res;
  if (id) {
    res = await supabaseClient.from('addresses').update(payload).eq('id', id);
  } else {
    res = await supabaseClient.from('addresses').insert(payload);
  }
  
  if (res.error) {
    if (res.error.message?.includes('addresses')) return toast('Address book is being set up — please try again after our next database update.', 'err');
    return toast('Save failed: ' + res.error.message, 'err');
  }
  toast('Address saved', 'ok');
  document.getElementById('addr-modal').close();
  renderAccount(); // Refresh
};

window.deleteAddress = async function(id) {
  if (!confirm('Are you sure you want to delete this address?')) return;
  const { error } = await supabaseClient.from('addresses').delete().eq('id', id);
  if (error) return toast('Delete failed: ' + error.message, 'err');
  toast('Address deleted', 'ok');
  renderAccount();
};
window.saveProfile = async function() {
  const payload = { id: state.user.id, name: $('#prof-name').value, phone: $('#prof-phone').value };
  const { data, error } = await supabaseClient.from('profiles').upsert(payload).select().single();
  if (error) return toast('Save failed: ' + error.message, 'err');
  state.profile = data;
  toast('Profile saved', 'ok');
};

// ---------- Bulk Enquiry ----------
function setupEnquiryForm() {
  const form = $('[data-enquiry-form]');
  if (!form) return;
  const productSlot = $('[data-selected-product]');
  if (productSlot) {
    const pid = param('product');
    if (pid) {
      const p = state.products.find(x => x.id === pid);
      if (p) productSlot.textContent = `Enquiry for: ${p.name}`;
    }
  }
  const waBtn = document.getElementById('bulk-whatsapp');
  if (waBtn) {
    waBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      const fd = new FormData(form);
      const msg = `Bulk Enquiry:\nName: ${fd.get('name')}\nEmail: ${fd.get('email')}\nPhone: ${fd.get('phone')}\nGSTIN: ${fd.get('gstin') || '-'}\nEvent: ${fd.get('eventType')}\nQuantity: ${fd.get('quantity')}\nDate: ${fd.get('eventDate') || '-'}\nBudget: ${fd.get('budget') || '-'}\nMessage: ${fd.get('message') || '-'}`;
      const num = (state.settings?.whatsapp_number || '').replace(/[^0-9]/g, '');
      if (!num) return toast('WhatsApp number not configured', 'err');
      window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, '_blank');
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const data = {
      name: fd.get('name'), email: fd.get('email'), phone: fd.get('phone'),
      gstin: fd.get('gstin')||'', event: fd.get('eventType'), qty: fd.get('quantity'),
      date: fd.get('eventDate')||'', budget: fd.get('budget')||'', message: fd.get('message')||'',
    };
    const summary = `Name: ${data.name} | Email: ${data.email} | Phone: ${data.phone} | GSTIN: ${data.gstin||'—'} | Event: ${data.event} | Qty: ${data.qty} | Date: ${data.date||'—'} | Budget: ${data.budget||'—'} | Message: ${data.message||'—'}`;
    try {
      // Delegate both insertion (via service role to bypass RLS) and email sending to the secure backend endpoint
      const r = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          type: 'enquiry_admin_notify', 
          data: {
            ...data,
            save_lead: true,
            user_id: state.user?.id || null,
            product_id: param('product') || null,
            summary
          } 
        }),
      });
      if (!r.ok) throw new Error('Could not submit enquiry');
      toast('Enquiry sent — we will reach out soon!', 'ok');
      form.reset();
    } catch (err) { toast('Failed: ' + err.message, 'err'); }
  });
}

// ---------- Wishlist ----------
async function loadWishlist() {
  if (!state.user) { state.wishlist = []; return; }
  try {
    const { data } = await supabaseClient.from('wishlists').select('*').eq('user_id', state.user.id);
    state.wishlist = data || [];
  } catch { state.wishlist = []; }
}
async function toggleWishlist(productId) {
  if (!state.user) {
    toast('Please log in to save favorites', '');
    setTimeout(() => location.href = 'login.html?redirect=' + encodeURIComponent(location.pathname + location.search), 900);
    return;
  }
  const existing = state.wishlist.find(w => w.product_id === productId);
  if (existing) {
    await supabaseClient.from('wishlists').delete().eq('id', existing.id);
    state.wishlist = state.wishlist.filter(w => w.id !== existing.id);
    toast('Removed from wishlist');
  } else {
    const { data, error } = await supabaseClient.from('wishlists').insert({ user_id: state.user.id, product_id: productId }).select().single();
    if (error) return toast('Failed: ' + error.message, 'err');
    state.wishlist.push(data);
    toast('Saved to wishlist ❤', 'ok');
  }
  // Re-render any visible product cards
  renderHomeProducts();
  renderProductsListing();
  renderProductDetail();
  if ($('[data-account]')) renderAccount();
}
window.toggleWishlist = toggleWishlist;

// ---------- Offers Popup ----------
async function fetchAndRenderOffers() {
  const popup = $('#offers-popup');
  if (!popup || sessionStorage.getItem('offers_closed')) return;

  try {
    const now = new Date().toISOString();
    const { data } = await supabaseClient.from('coupons')
      .select('*')
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order('created_at', { ascending: false });

    if (!data || !data.length) return;

    const list = $('#offers-list');
    list.innerHTML = data.map(c => `
      <div style="border:1px dashed var(--gold);background:var(--champagne);padding:12px;border-radius:8px;position:relative;">
        <div style="font-weight:700;color:var(--burgundy);display:flex;align-items:center;gap:6px;font-size:16px;">
          <i class="fas fa-ticket"></i> ${escapeHTML(c.code)}
          <button onclick="copyCoupon('${escapeHTML(c.code)}')" title="Copy Code" style="background:none;border:none;color:var(--burgundy);cursor:pointer;margin-left:auto;font-size:16px;padding:4px;"><i class="far fa-copy"></i></button>
        </div>
        <div style="font-size:13px;color:var(--text);margin-top:6px;">
          Save ${c.discount_type === 'percent' ? escapeHTML(c.discount_value) + '%' : '₹' + escapeHTML(c.discount_value)}${c.min_order_amount ? ` on orders above ₹${escapeHTML(c.min_order_amount)}` : ''}!
        </div>
        ${c.expires_at ? `<div style="font-size:11px;color:var(--muted);margin-top:6px;"><i class="far fa-clock"></i> Expires: ${new Date(c.expires_at).toLocaleDateString()}</div>` : ''}
      </div>
    `).join('');

    setTimeout(() => popup.show(), 2000);
  } catch(e) { console.error('Error fetching offers:', e); }
}

window.copyCoupon = function(code) {
  navigator.clipboard.writeText(code);
  toast('Coupon code copied: ' + code, 'ok');
};

// ---------- Feedback Modal ----------
window.openFeedbackModal = function(orderId, productId, productName) {
  const modalHtml = `
    <div id="feedback-modal" class="modal" style="display:flex;">
      <div class="modal-content" style="max-width:400px;text-align:center;">
        <h3>Rate ${escapeHTML(productName)}</h3>
        <p style="font-size:13px;color:var(--muted);margin-bottom:16px;">How was your experience with this product?</p>
        <div id="star-rating" style="font-size:24px;color:#ccc;cursor:pointer;margin-bottom:16px;display:flex;justify-content:center;gap:8px;">
          <i class="fas fa-star" data-val="1"></i>
          <i class="fas fa-star" data-val="2"></i>
          <i class="fas fa-star" data-val="3"></i>
          <i class="fas fa-star" data-val="4"></i>
          <i class="fas fa-star" data-val="5"></i>
        </div>
        <textarea id="feedback-text" class="textarea" placeholder="Tell us more about it..." rows="3"></textarea>
        <div style="display:flex;gap:12px;margin-top:20px;justify-content:center;">
          <button class="btn outline" onclick="document.getElementById('feedback-modal').remove()">Cancel</button>
          <button class="btn primary" onclick="submitFeedback('${escapeHTML(orderId)}', '${escapeHTML(productId)}')">Submit Review</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  
  let currentRating = 0;
  const stars = document.querySelectorAll('#star-rating .fa-star');
  stars.forEach(star => {
    star.addEventListener('click', (e) => {
      currentRating = parseInt(e.target.dataset.val);
      stars.forEach(s => {
        s.style.color = parseInt(s.dataset.val) <= currentRating ? 'var(--gold)' : '#ccc';
      });
      document.getElementById('feedback-modal').dataset.rating = currentRating;
    });
  });
};

window.submitFeedback = async function(orderId, productId) {
  const modal = document.getElementById('feedback-modal');
  const rating = parseInt(modal.dataset.rating || 0);
  const text = document.getElementById('feedback-text').value.trim();
  
  if (!rating) return toast('Please select a star rating', 'error');
  if (!text) return toast('Please enter your review', 'error');
  
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return toast('Please login first', 'error');

  const { error } = await supabaseClient.from('testimonials').insert([{
    user_id: session.user.id,
    customer_name: session.user.user_metadata?.full_name || 'Customer',
    rating: rating,
    review_text: text,
    product_id: productId,
    order_id: orderId,
    status: 'Pending'
  }]);

  if (error) {
    console.error(error);
    return toast('Error submitting feedback. You might have already reviewed this.', 'error');
  }

  toast('Thank you for your review!', 'ok');
  modal.remove();
};

// ---------- Boot ----------
async function bootstrap() {
  // Restore coupon applied on a previous page (cart → checkout persistence)
  try {
    const c = JSON.parse(sessionStorage.getItem('oncost_coupon') || 'null');
    if (c && c.code) state.appliedCoupon = c;
  } catch { /* ignore */ }
  await Promise.all([loadAuth(), loadSettings(), loadSaleEvents(), loadCategories(), loadProducts(), loadTestimonials()]);
  await Promise.all([loadCart(), loadWishlist()]);

  applySEO();
  applyWhatsappFab();
  applyFooterSocials();
  renderSaleBanner();
  renderAuthState();
  updateCartBadge();

  // Page-specific renders
  renderHomeProducts();
  renderHomeCollections();
  renderHeroSlideshow();
  if (typeof initSocialProofToast === 'function') initSocialProofToast();
  populateCategoryFilter();
  // Apply ?cat= URL param to filter dropdown AFTER options are populated
  const catParam = param('cat');
  if (catParam) {
    const sel = $('[data-product-filter]');
    if (sel) {
      sel.value = catParam;
      // If the option doesn't exist yet (categories still loading), store it
      if (sel.value !== catParam) sel.dataset.pendingCat = catParam;
    }
  }
  renderProductsListing();
  renderProductDetail();
  renderReviewsMarquee();
  renderCart();
  await renderAccount();
  setupEnquiryForm();
  fetchAndRenderOffers();
  renderRecentlyViewed();
  maybeShowCompleteProfile();
  initUXEnhancements();
function renderRecentlyViewed() {
  const slot = $('[data-recently-viewed]');
  if (!slot) return;
  try {
    const rv = JSON.parse(localStorage.getItem('recently_viewed') || '[]');
    if (!rv.length) { slot.innerHTML = ''; return; }
    const items = rv.map(id => state.products.find(p => p.id === id)).filter(Boolean);
    if (!items.length) { slot.innerHTML = ''; return; }
    
    const currentProductId = param('id');
    const displayItems = items.filter(p => p.id !== currentProductId).slice(0, 4);
    if (!displayItems.length) { slot.innerHTML = ''; return; }

    slot.innerHTML = `
      <section style="margin-top: 40px; padding: 0 5%;">
        <h2 style="font-size: 24px; font-weight: 600; margin-bottom: 20px;">Recently Viewed By You</h2>
        <div class="product-grid">
          ${displayItems.map(p => {
            const offer = p.offer_price && p.offer_price < p.price;
            const inWishlist = state.wishlist.some(w => w.product_id === p.id);
            const wishBtn = state.user ? `<button class="wish-btn ${inWishlist?'on':''}" onclick="event.preventDefault();event.stopPropagation();toggleWishlist('${escapeHTML(p.id)}')"><i class="${inWishlist?'fas':'far'} fa-heart"></i></button>` : '';
            const shareBtn = `<button class="share-btn" onclick="event.preventDefault();event.stopPropagation(); window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(window.location.origin + '/product.html?id=' + '${escapeHTML(p.id)}'), '_blank')" title="Share on WhatsApp"><i class="fas fa-share-nodes"></i></button>`;
            return `
            <a href="product.html?id=${p.id}" class="product-card">
              <div class="product-img">
                <img src="${escapeHTML(p.image_url)}" alt="${escapeHTML(p.name)}" style="width:100%; height:100%; object-fit:cover;" onerror="this.onerror=null; this.src='https://via.placeholder.com/400x400.png?text=Image+Not+Found'; this.style.objectFit='contain';" />
                ${wishBtn}
                ${shareBtn}
                ${offer ? `<span class="badge save">Save ${Math.round(((p.price - p.offer_price)/p.price)*100)}%</span>` : ''}
              </div>
              <div class="product-info">
                <h3>${escapeHTML(p.name)}</h3>
                <div class="price">
                  ${offer ? `<span>${fmtINR(p.offer_price)}</span> <del>${fmtINR(p.price)}</del>` : `<span>${fmtINR(p.price)}</span>`}
                </div>
              </div>
            </a>`;
          }).join('')}
        </div>
      </section>
    `;
  } catch(e) {}
}

  // Hook up controls
  const s = $('[data-product-search]'); if (s) s.addEventListener('input', renderProductsListing);
  const f = $('[data-product-filter]'); if (f) f.addEventListener('change', renderProductsListing);
  const so = $('[data-product-sort]'); if (so) so.addEventListener('change', renderProductsListing);
  const lo = $('[data-logout]'); if (lo) lo.addEventListener('click', doLogout);

  // Review modal (if on home)
  const writeBtn = $('#write-review-btn');
  if (writeBtn) writeBtn.addEventListener('click', () => $('#review-modal')?.showModal());
  $('#close-review-modal')?.addEventListener('click', () => $('#review-modal')?.close());
  $('#submit-review-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.user) return toast('Please log in to submit a review', '');
    try {
      await supabaseClient.from('testimonials').insert({
        user_id: state.user.id,
        customer_name: state.profile?.name || state.user.email.split('@')[0],
        rating: parseInt($('#review-rating').value, 10),
        review_text: $('#review-text').value,
        status: 'Pending',
      });
      $('#review-modal')?.close();
      toast('Review submitted! Awaiting moderation.', 'ok');
    } catch (err) { toast('Failed: ' + err.message, 'err'); }
  });

  // ---------- Product-specific review modal (on product.html) ----------
  $('#prm-close-x')?.addEventListener('click', () => $('#product-review-modal')?.close());
  $('#prm-cancel')?.addEventListener('click',  () => $('#product-review-modal')?.close());
  $('#product-review-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const productId   = $('#prm-product-id').value;
    const reviewToken = $('#prm-review-token').value;
    const rating      = parseInt($('#prm-rating').value, 10);
    const title       = $('#prm-title').value.trim();
    const text        = $('#prm-text').value.trim();
    const errBox      = $('#prm-error');
    const btn         = $('#prm-submit');

    if (text.length < 10) {
      errBox.textContent = 'Review must be at least 10 characters.';
      errBox.style.display = 'block';
      return;
    }
    if (!reviewToken && !state.user) {
      errBox.innerHTML = 'Please <a href="login.html" style="color:#C0392B;text-decoration:underline;">sign in</a> to submit a review. Only verified buyers can review.';
      errBox.style.display = 'block';
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting…';
    errBox.style.display = 'none';

    try {
      // Get current Supabase auth token (if logged in)
      let userToken = null;
      try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        userToken = session?.access_token || null;
      } catch (_) { /* noop */ }

      const r = await fetch('/api/reviews/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: productId,
          rating, title, review_text: text,
          user_token: userToken,
          review_token: reviewToken || undefined,
          customer_name: state.profile?.name || (state.user?.email?.split('@')[0]) || '',
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));

      $('#product-review-modal').close();
      toast('Thanks! Your review is awaiting moderation.', 'ok');
    } catch (err) {
      errBox.textContent = err.message || 'Could not submit review.';
      errBox.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Review';
    }
  });
}

// ---------- Dynamic Validation Rules (Phone & ZIP) ----------
window.updateCountryRules = function(selectEl) {
  const wrapper = selectEl.closest('.phone-input-group');
  if (!wrapper) return;
  const displayEl = wrapper.querySelector('.prefix-display');
  const inputEl = wrapper.querySelector('input[type="tel"]');
  
  const zipEl = document.getElementById('ck-zip') || document.getElementById('biz-pincode');
  
  const rules = {
    'IN': { phonePat: '[0-9]{10}', phoneMax: 10, phonePlace: '9876543210', zipPat: '[0-9]{6}', zipMax: 6, zipPlace: '500001' },
    'US': { phonePat: '[0-9]{10}', phoneMax: 10, phonePlace: '2025550123', zipPat: '[0-9]{5}', zipMax: 5, zipPlace: '90210' },
    'GB': { phonePat: '[0-9]{10,11}', phoneMax: 11, phonePlace: '7700900123', zipPat: '[A-Za-z0-9 ]{5,8}', zipMax: 8, zipPlace: 'SW1A 1AA' },
    'AE': { phonePat: '[0-9]{9}', phoneMax: 9, phonePlace: '501234567', zipPat: '.*', zipMax: 10, zipPlace: '00000' },
    'AU': { phonePat: '[0-9]{9}', phoneMax: 9, phonePlace: '400123456', zipPat: '[0-9]{4}', zipMax: 4, zipPlace: '2000' },
    'CA': { phonePat: '[0-9]{10}', phoneMax: 10, phonePlace: '4165550123', zipPat: '[A-Za-z][0-9][A-Za-z] [0-9][A-Za-z][0-9]', zipMax: 7, zipPlace: 'M5V 2H1' },
    'DEFAULT': { phonePat: '[0-9]{7,15}', phoneMax: 15, phonePlace: 'Phone number', zipPat: '.*', zipMax: 12, zipPlace: 'Postal Code' }
  };
  
  const optText = selectEl.options[selectEl.selectedIndex]?.text || '';
  const match = optText.match(/\((\+\d+)\)/);
  const codeStr = match ? match[1] : '';
  const nameStr = optText.replace(/\s*\(\+\d+\)\s*$/, '');
  
  if (displayEl && codeStr) displayEl.textContent = codeStr;
  
  const countryInput1 = document.getElementById('ck-country');
  const countryInput2 = document.getElementById('biz-country');
  if (countryInput1) countryInput1.value = nameStr;
  if (countryInput2) countryInput2.value = nameStr;
  
  const r = rules[selectEl.value] || rules['DEFAULT'];
  
  if (inputEl) {
    inputEl.pattern = r.phonePat;
    inputEl.maxLength = r.phoneMax;
    inputEl.placeholder = r.phonePlace;
    inputEl.setCustomValidity('');
  }
  
  if (zipEl) {
    zipEl.pattern = r.zipPat;
    zipEl.maxLength = r.zipMax;
    zipEl.placeholder = r.zipPlace;
    zipEl.setCustomValidity('');
  }
};

document.addEventListener('DOMContentLoaded', () => {
  bootstrap();
  // Initialize rules on page load for all selects
  document.querySelectorAll('.prefix-select').forEach(sel => {
    if(window.updateCountryRules) window.updateCountryRules(sel);
  });
});

// Independence Day Theme (Active only on Aug 15)
(function() {
  const today = new Date();
  if (today.getMonth() === 7 && today.getDate() === 15) {
    document.addEventListener('DOMContentLoaded', () => {
      const topbar = document.querySelector('.topbar');
      if (topbar) {
        topbar.style.background = 'linear-gradient(90deg, #FF9933 0%, #FFFFFF 50%, #138808 100%)';
        topbar.style.color = '#000080';
        const spans = topbar.querySelectorAll('span');
        spans.forEach(span => span.style.color = '#000080');
        topbar.insertAdjacentHTML('afterbegin', '<span style="font-weight:bold;font-size:1.1em;text-transform:uppercase;"><i class="fas fa-flag"></i> Happy Independence Day!</span>');
      }
      const style = document.createElement('style');
      style.textContent = `
        .btn.primary { background-color: #FF9933 !important; border-color: #FF9933 !important; color: white !important; }
        .btn.primary:hover { filter: brightness(0.9); }
        .eyebrow { color: #138808 !important; border-color: rgba(19, 136, 8, 0.2) !important; background: rgba(19, 136, 8, 0.05) !important; }
        .site-header { border-bottom: 3px solid #FF9933; }
      `;
      document.head.appendChild(style);
    });
  }
})();

// Social Proof Toast Logic
let socialProofTimer;
function initSocialProofToast() {
  if (window.location.pathname.includes('admin')) return;
  if (!state.products || !state.products.length) return;
  
  let toast = document.getElementById('social-proof-toast');
  if (!toast) {
    toast = document.createElement('a');
    toast.id = 'social-proof-toast';
    toast.className = 'social-proof-toast';
    document.body.appendChild(toast);
  }

  const cities = ['Mumbai', 'Delhi', 'Bangalore', 'Hyderabad', 'Chennai', 'Pune', 'Ahmedabad'];
  
  function showRandomPurchase() {
    const p = state.products[Math.floor(Math.random() * state.products.length)];
    const city = cities[Math.floor(Math.random() * cities.length)];
    const minAgo = Math.floor(Math.random() * 59) + 1;
    
    toast.href = 'product.html?id=' + encodeURIComponent(p.id);
    toast.innerHTML = `
      <img src="${escapeHTML(p.image_url)}" alt="${escapeHTML(p.name)}">
      <div class="social-proof-info">
        <div class="social-proof-title">Someone in ${city} just bought</div>
        <div class="social-proof-name">${escapeHTML(p.name)}</div>
        <div class="social-proof-time">${minAgo} min${minAgo > 1 ? 's' : ''} ago</div>
      </div>
      <button class="social-proof-close" onclick="event.preventDefault(); document.getElementById('social-proof-toast').classList.remove('show'); clearTimeout(socialProofTimer);">&times;</button>
    `;
    
    // Add show class to slide it up
    setTimeout(() => toast.classList.add('show'), 100);
    
    // Slide down after 10 seconds
    socialProofTimer = setTimeout(() => {
      toast.classList.remove('show');
      // Schedule next one after 10 seconds
      setTimeout(showRandomPurchase, 10000);
    }, 10000);
  }

  // Start the first one after 10 seconds
  setTimeout(showRandomPurchase, 10000);
}

// Call init once data is loaded (around line 1700 where re-renders happen)
