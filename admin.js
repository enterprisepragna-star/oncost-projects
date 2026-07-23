/* 
   ONCOST Admin Console · admin.js
   Vanilla JS · Supabase JS v2 · Single-file SPA
*/
'use strict';

const ADMIN_EMAILS = ['enterprisepragna@gmail.com'];

// ------------------------- State -------------------------
const state = {
  user: null,
  settings: {},
  products: [],         // full list (paged client-side for simplicity)
  productsFiltered: [],
  productsPage: 1,
  productsPageSize: 20,
  categories: [],
  orders: [],
  coupons: [],
  sales: [],
  leads: [],
  testimonials: [],
  complaints: [],
  loyaltyCustomers: [],
  customers: [],
  inv: [],
  imgbbKey: '',
  selectedProducts: new Set(),
  selectedOrders: new Set(),
};

// ------------------------- Utilities -------------------------
const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, html = '') => {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') n.className = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  });
  if (html) n.innerHTML = html;
  return n;
};
const fmtINR = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN');
const escapeHTML = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const slugify = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || ('id-' + Date.now());

function showToast(msg, kind = 'success') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast ' + (kind === 'error' ? 'error' : kind === 'success' ? 'success' : '');
  t.style.display = 'block';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { t.style.display = 'none'; }, 3000);
}

function confirmDialog(message, { confirmLabel = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    const root = $('modal-root');
    root.innerHTML = `
      <div class="modal-backdrop" data-testid="confirm-overlay">
        <div class="modal sm">
          <div class="modal-head"><h3>Confirm</h3></div>
          <div class="modal-body"><p style="margin:0;color:var(--admin-text-mute)">${escapeHTML(message)}</p></div>
          <div class="modal-foot">
            <button class="btn btn-secondary" id="cnf-no" data-testid="confirm-no">Cancel</button>
            <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="cnf-yes" data-testid="confirm-yes">${escapeHTML(confirmLabel)}</button>
          </div>
        </div>
      </div>`;
    root.querySelector('.modal-backdrop').addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-backdrop')) { close(false); }
    });
    $('cnf-no').onclick = () => close(false);
    $('cnf-yes').onclick = () => close(true);
    function close(v) { root.innerHTML = ''; resolve(v); }
  });
}

function openModal({ title, size = '', body, footer, testid = 'modal' }) {
  const root = $('modal-root');
  const wrap = el('div', { class: 'modal-backdrop', 'data-testid': testid + '-overlay' });
  wrap.innerHTML = `
    <div class="modal ${size}">
      <div class="modal-head">
        <h3>${escapeHTML(title)}</h3>
        <button class="icon-btn" id="${testid}-close" data-testid="${testid}-close"><i class="fas fa-xmark"></i></button>
      </div>
      <div class="modal-body" id="${testid}-body"></div>
      <div class="modal-foot" id="${testid}-foot"></div>
    </div>`;
  root.appendChild(wrap);
  if (typeof body === 'string') $(`${testid}-body`).innerHTML = body;
  else if (body) $(`${testid}-body`).appendChild(body);
  if (footer) $(`${testid}-foot`).appendChild(footer);
  $(`${testid}-close`).onclick = () => close();
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  function close() { wrap.remove(); }
  return { close, root: wrap };
}

// ------------------------- Auth & Boot -------------------------
async function bootstrap() {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session || !ADMIN_EMAILS.includes(session.user.email.toLowerCase())) {
      window.location.href = 'admin-login.html'; return;
    }
    state.user = session.user;
    $('user-name').textContent = session.user.user_metadata?.name || 'Admin';
    $('user-email').textContent = session.user.email;
    $('user-avatar').textContent = (session.user.email || 'A').charAt(0).toUpperCase();

    setupNav();
    setupSearches();
    setupImport();

    await Promise.all([
      loadSettings(),
      loadBusinessProfile(),
      loadCategories(),
      loadProducts(),
      loadOrders(),
      loadCoupons(),
      loadSales(),
      loadLeads(),
      loadTestimonials(),
      loadComplaints(),
    ]);
    renderAllOnce();
  } catch (err) {
    console.error(err);
    showToast('Failed to load admin: ' + err.message, 'error');
  }
}

async function adminLogout() {
  if (!await confirmDialog('Sign out of the admin console?', { confirmLabel: 'Sign out' })) return;
  await supabaseClient.auth.signOut();
  window.location.href = 'admin-login.html';
}
window.adminLogout = adminLogout;

// ------------------------- Navigation -------------------------
const VIEW_TITLES = {
  dashboard: 'Dashboard', products: 'Products', categories: 'Categories',
  inventory: 'Inventory', import: 'Bulk Import', orders: 'Orders',
  coupons: 'Coupons', sales: 'Sale Events', leads: 'Enquiries',
  testimonials: 'Testimonials', complaints: 'Complaints', loyalty: 'Loyalty Program',
  customers: 'Customer Directory',
  settings: 'Site Settings',
};

function setupNav() {
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => goView(btn.dataset.view));
  });
}
function goView(view) {
  document.querySelectorAll('[data-view-pane]').forEach(p => p.classList.toggle('active', p.dataset.viewPane === view));
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('topbar-crumb').textContent = VIEW_TITLES[view] || 'Admin';
  if (window.innerWidth < 800) document.getElementById('sidebar').classList.remove('open');
  // Re-render views that need fresh data
  if (view === 'inventory') renderInventory();
  if (view === 'orders') renderOrders();
  if (view === 'loyalty') loadLoyaltyCustomers().then(renderLoyalty);
  if (view === 'customers') loadCustomerDirectory().then(renderCustomers);
  if (view === 'dashboard') { renderCharts(); renderLowStockAlert(); }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.goView = goView;

// ------------------------- Settings -------------------------
async function loadSettings() {
  const { data } = await supabaseClient.from('site_settings').select('*').limit(1);
  state.settings = (data && data[0]) || {};
  state.imgbbKey = state.settings.imgbb_api_key || '';
  // Populate form
  ['site_title','meta_description','keywords','og_image','canonical_url','ga_id','gsc_verification','robots_txt',
   'whatsapp_number','whatsapp_text','instagram_url','facebook_url','youtube_url','pinterest_url','twitter_url',
   'support_phone','support_email',
   'imgbb_api_key','openai_api_key','gemini_api_key','low_stock_threshold','alert_whatsapp'].forEach(k => {
    const node = $(`set-${k}`);
    if (node) node.value = state.settings[k] ?? '';
  });
  renderHeroImagesPreview();
}
async function saveSettings() {
  const payload = {};
  ['site_title','meta_description','keywords','og_image','canonical_url','ga_id','gsc_verification','robots_txt',
   'whatsapp_number','whatsapp_text','instagram_url','facebook_url','youtube_url','pinterest_url','twitter_url',
   'support_phone','support_email',
   'imgbb_api_key','openai_api_key','gemini_api_key','low_stock_threshold','alert_whatsapp'].forEach(k => {
    const node = $(`set-${k}`);
    if (node) payload[k] = k === 'low_stock_threshold' ? (Number(node.value) || 5) : node.value.trim();
  });
  payload.hero_images = state.settings.hero_images || [];
  let res;
  if (state.settings.id) {
    res = await supabaseClient.from('site_settings').update(payload).eq('id', state.settings.id).select().single();
  } else {
    res = await supabaseClient.from('site_settings').insert(payload).select().single();
  }
  if (res.error) {
    if (res.error.message?.includes('imgbb_api_key') || res.error.message?.includes('openai_api_key') || res.error.message?.includes('low_stock') || res.error.message?.includes('alert_whatsapp')) {
      showToast('Run the latest admin_setup.sql in Supabase SQL Editor to add new columns.', 'error');
    } else {
      showToast('Failed: ' + res.error.message, 'error');
    }
    return;
  }
  state.settings = res.data;
  state.imgbbKey = res.data.imgbb_api_key || '';
  renderHeroImagesPreview();
  showToast('Settings saved.');
}
window.saveSettings = saveSettings;

// ------------------------- Hero Images UI -------------------------
function renderHeroImagesPreview() {
  const container = $('hero-images-preview');
  if (!container) return;
  const images = state.settings.hero_images || [];
  if (images.length === 0) {
    container.innerHTML = `<div style="grid-column:1/-1;color:var(--admin-text-mute);font-size:14px;padding:12px;background:#f8f9fa;border-radius:8px;text-align:center;">No hero images uploaded. The gold gradient fallback will be shown.</div>`;
    return;
  }
  container.innerHTML = images.map((url, i) => `
    <div style="position:relative;border-radius:8px;overflow:hidden;border:1px solid var(--line);aspect-ratio:16/9;">
      <img src="${escapeHTML(url)}" style="width:100%;height:100%;object-fit:cover;" />
      <button class="btn btn-icon" style="position:absolute;top:4px;right:4px;background:rgba(255,255,255,0.9);color:var(--admin-danger);min-width:24px;height:24px;padding:0;font-size:12px;" onclick="removeHeroImage(${i})"><i class="fas fa-trash"></i></button>
    </div>
  `).join('');
}
window.removeHeroImage = async (idx) => {
  if (!confirm('Remove this hero image?')) return;
  const images = [...(state.settings.hero_images || [])];
  images.splice(idx, 1);
  state.settings.hero_images = images;
  renderHeroImagesPreview();
  await saveSettings();
};

const heroDrop = $('hero-image-drop');
const heroFile = $('hero-image-file');
if (heroDrop && heroFile) {
  heroDrop.addEventListener('click', () => heroFile.click());
  heroDrop.addEventListener('dragover', e => { e.preventDefault(); heroDrop.style.borderColor = 'var(--admin-primary)'; });
  heroDrop.addEventListener('dragleave', e => { e.preventDefault(); heroDrop.style.borderColor = 'var(--line)'; });
  heroDrop.addEventListener('drop', async e => {
    e.preventDefault(); heroDrop.style.borderColor = 'var(--line)';
    if (e.dataTransfer.files[0]) handleHeroUpload(e.dataTransfer.files[0]);
  });
  heroFile.addEventListener('change', e => {
    if (e.target.files[0]) handleHeroUpload(e.target.files[0]);
  });
}
async function handleHeroUpload(file) {
  if (!file.type.startsWith('image/')) return showToast('Images only', 'error');
  heroDrop.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size:24px;color:var(--admin-primary);"></i><div style="margin-top:8px">Uploading...</div>';
  try {
    const url = await uploadImage(file);
    if (!url) throw new Error('Upload returned null');
    const images = [...(state.settings.hero_images || [])];
    images.push(url);
    state.settings.hero_images = images;
    renderHeroImagesPreview();
    await saveSettings();
  } catch (e) {
    showToast(e.message, 'error');
  }
  heroDrop.innerHTML = '<i class="fas fa-cloud-upload-alt" style="font-size:24px;color:var(--admin-primary);margin-bottom:8px;display:block;"></i><div style="font-weight:500;">Click to browse</div><div style="font-size:12px;color:var(--admin-text-mute)">JPG/PNG/WEBP · max 5 MB</div>';
}

// ------------------------- Business Profile (for invoice) -------------------------
const BIZ_FIELDS = ['business_name','legal_name','gstin','pan','address_line1','address_line2','city','state','pincode','country','phone','email','invoice_notes'];

async function loadBusinessProfile() {
  const { data } = await supabaseClient.from('business_profile').select('*').limit(1);
  state.business = (data && data[0]) || {};
  BIZ_FIELDS.forEach(k => { const n = $(`biz-${k}`); if (n) n.value = state.business[k] ?? ''; });
  // Wire save button (idempotent — overrides any previous handler)
  const btn = $('biz-save-btn');
  if (btn) btn.onclick = saveBusinessProfile;
}

async function saveBusinessProfile() {
  const payload = {};
  BIZ_FIELDS.forEach(k => { const n = $(`biz-${k}`); if (n) payload[k] = n.value.trim() || null; });
  if (!payload.business_name) { showToast('Business name is required.', 'error'); return; }
  const btn = $('biz-save-btn');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
  let res;
  if (state.business && state.business.id) {
    res = await supabaseClient.from('business_profile').update(payload).eq('id', state.business.id).select().single();
  } else {
    res = await supabaseClient.from('business_profile').insert(payload).select().single();
  }
  btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Business Profile';
  if (res.error) {
    if (res.error.code === '42P01' || res.error.message?.includes('business_profile')) {
      showToast('Run /app/migration_ccavenue_fix.sql in Supabase first.', 'error');
    } else {
      showToast('Save failed: ' + res.error.message, 'error');
    }
    return;
  }
  state.business = res.data;
  showToast('Business profile saved. Future invoices will use these details.');
}
window.saveBusinessProfile = saveBusinessProfile;

// ------------------------- Image upload (Supabase Storage with imgbb fallback) -------------------------
// Primary: Supabase Storage (bucket: product-images) — free, built-in, no API key needed.
// Fallback: imgbb if a key is set (for users who prefer it).
async function uploadProductImage(file) {
  if (!file) throw new Error('No file selected.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Image too large. Max 5 MB.');
  if (!/^image\//.test(file.type)) throw new Error('Only image files (JPG, PNG, WEBP, GIF) supported.');

  // 1️⃣ Try Supabase Storage (preferred)
  try {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${ext}`;
    const { error } = await supabaseClient.storage.from('product-images').upload(path, file, {
      cacheControl: '31536000',
      upsert: false,
      contentType: file.type,
    });
    if (error) throw error;
    const { data } = supabaseClient.storage.from('product-images').getPublicUrl(path);
    return data.publicUrl;
  } catch (storageErr) {
    console.warn('[upload] Supabase Storage failed, trying imgbb fallback:', storageErr.message);
    // 2️⃣ Fall back to imgbb if a key is configured
    if (state.imgbbKey && state.imgbbKey.startsWith('http') === false && state.imgbbKey.length > 10) {
      const fd = new FormData();
      fd.append('image', file);
      const r = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(state.imgbbKey)}`, { method: 'POST', body: fd });
      const j = await r.json();
      if (!j.success) throw new Error(j.error?.message || 'imgbb upload failed');
      return j.data.url;
    }
    // No fallback available
    if (storageErr.message?.toLowerCase().includes('bucket') || storageErr.message?.toLowerCase().includes('not found')) {
      throw new Error('Run migration_phase1.sql in Supabase to enable image upload.');
    }
    if (storageErr.message?.toLowerCase().includes('policy') || storageErr.statusCode === '403' || storageErr.message?.toLowerCase().includes('unauthorized')) {
      throw new Error('Storage permission denied — make sure you are logged in to admin.');
    }
    throw new Error('Upload failed: ' + storageErr.message);
  }
}
// Keep old name as alias for backward compat with bulk-import code
const uploadImageToImgbb = uploadProductImage;

// ------------------------- Dashboard -------------------------
function renderDashboard() {
  const threshold = Number(state.settings.low_stock_threshold) || 5;
  const totalProducts = state.products.length;
  const active = state.products.filter(p => (p.status || 'Active') === 'Active').length;
  const totalCats = state.categories.length;
  const lowStock = state.products.filter(p => (p.stock ?? 0) <= threshold).length;
  const outStock = state.products.filter(p => (p.stock ?? 0) === 0).length;
  const totalOrders = state.orders.length;
  const revenue = state.orders.reduce((s, o) => s + Number(o.total_amount || 0), 0);
  const pendingOrders = state.orders.filter(o => o.status === 'Processing').length;
  const newLeads = state.leads.length;
  const invValue = state.products.reduce((s, p) => s + (Number(p.stock || 0) * Number(p.price || 0)), 0);
  const liveSales = state.sales.filter(s => s.is_active).length;

  $('kpi-grid').innerHTML = [
    kpi('Revenue', fmtINR(revenue), 'fa-indian-rupee-sign', `${totalOrders} orders`),
    kpi('Orders Pending', pendingOrders, 'fa-clock', `${totalOrders} total`),
    kpi('Total Products', totalProducts, 'fa-box', `${active} active`),
    kpi('Low Stock', lowStock, 'fa-triangle-exclamation', `${outStock} out of stock`, lowStock > 0 ? 'warn' : ''),
    kpi('Categories', totalCats, 'fa-layer-group'),
    kpi('Inventory Value', fmtINR(invValue), 'fa-warehouse'),
    kpi('Live Sales', liveSales, 'fa-bullhorn'),
    kpi('New Enquiries', newLeads, 'fa-envelope'),
  ].join('');

  // Recent orders
  const ro = $('recent-orders-list');
  if (state.orders.length === 0) {
    ro.innerHTML = `<div class="empty"><div class="ic"><i class="fas fa-receipt"></i></div><h4>No orders yet</h4><p>When customers place orders, they’ll appear here.</p></div>`;
  } else {
    ro.innerHTML = `<table class="data" style="border:none;"><tbody>` + state.orders.slice(0, 6).map(o => `
      <tr>
        <td><div style="font-weight:600;">#${escapeHTML(String(o.id).substring(0,8))}</div><div style="font-size:11px;color:var(--admin-text-mute);">${escapeHTML(o.guest_email || (o.user_id||'').substring(0,12))}</div></td>
        <td style="text-align:right;font-weight:600">${fmtINR(o.total_amount)}</td>
        <td>${statusBadge(o.status)}</td>
        <td style="font-size:11px;color:var(--admin-text-mute)">${new Date(o.created_at).toLocaleDateString()}</td>
      </tr>`).join('') + '</tbody></table>';
  }

  // --- Analytics Charts ---
  if (window.Chart) {
    if (window.adminCharts?.revenue) window.adminCharts.revenue.destroy();
    if (window.adminCharts?.category) window.adminCharts.category.destroy();
    window.adminCharts = window.adminCharts || {};

    // 1. Revenue Trend (last 30 days)
    const last30 = [...Array(30)].map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (29 - i));
      return d.toISOString().split('T')[0];
    });
    
    const revData = last30.map(dateStr => {
      return state.orders
        .filter(o => o.created_at.startsWith(dateStr) && o.status !== 'Cancelled')
        .reduce((s, o) => s + Number(o.total_amount || 0), 0);
    });

    const revCtx = document.getElementById('revenueChart');
    if (revCtx) {
      window.adminCharts.revenue = new Chart(revCtx, {
        type: 'line',
        data: {
          labels: last30.map(d => d.slice(5)), // MM-DD
          datasets: [{
            label: 'Revenue (₹)',
            data: revData,
            borderColor: '#7A1F35',
            backgroundColor: 'rgba(122, 31, 53, 0.1)',
            fill: true,
            tension: 0.4
          }]
        },
        options: { responsive: true, maintainAspectRatio: false }
      });
    }

    // 2. Category Sales
    const catSales = {};
    state.orders.forEach(o => {
      if (o.status === 'Cancelled') return;
      try {
        const items = typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || []);
        items.forEach(item => {
          const prod = state.products.find(p => p.id === item.product_id);
          const cat = prod ? prod.category_id : 'Unknown';
          catSales[cat] = (catSales[cat] || 0) + (Number(item.price || 0) * Number(item.quantity || 1));
        });
      } catch(e){}
    });

    const catLabels = Object.keys(catSales).map(id => {
      if (id === 'Unknown') return 'Unknown';
      const c = state.categories.find(cat => cat.id === id);
      return c ? c.name : 'Unknown';
    });
    const catData = Object.values(catSales);

    const catCtx = document.getElementById('categoryChart');
    if (catCtx && catData.length > 0) {
      window.adminCharts.category = new Chart(catCtx, {
        type: 'doughnut',
        data: {
          labels: catLabels,
          datasets: [{
            data: catData,
            backgroundColor: ['#7A1F35', '#D4AF37', '#2C3E50', '#E67E22', '#27AE60', '#8E44AD']
          }]
        },
        options: { responsive: true, maintainAspectRatio: false }
      });
    }
  }

  // Low stock list
  const lo = $('low-stock-list');
  const lows = state.products.filter(p => (p.stock ?? 0) <= threshold).sort((a,b) => (a.stock||0)-(b.stock||0)).slice(0, 7);
  if (lows.length === 0) {
    lo.innerHTML = `<div class="empty"><div class="ic"><i class="fas fa-circle-check"></i></div><h4>All healthy</h4><p>No products below threshold.</p></div>`;
  } else {
    lo.innerHTML = lows.map(p => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--admin-border)">
        <div style="min-width:0;">
          <div style="font-weight:500;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHTML(p.name)}</div>
          <div style="font-size:11px;color:var(--admin-text-mute)">${escapeHTML(p.category || 'Uncategorized')}</div>
        </div>
        <span class="badge ${p.stock === 0 ? 'b-error' : 'b-warn'}">${p.stock ?? 0} left</span>
      </div>`).join('');
  }
}

function renderLowStockAlert() {
  const threshold = Number(state.settings.low_stock_threshold) || 5;
  const lows = state.products.filter(p => (p.stock ?? 0) <= threshold);
  const banner = $('low-stock-alert');
  if (!banner) return;
  if (!lows.length) { banner.style.display = 'none'; return; }
  banner.style.display = 'flex';
  $('lsa-title').textContent = `${lows.length} product${lows.length===1?'':'s'} at or below threshold (${threshold})`;
  $('lsa-detail').textContent = lows.slice(0,3).map(p => `${p.name} (${p.stock||0} left)`).join(' · ') + (lows.length > 3 ? ` · +${lows.length-3} more` : '');
  const wa = (state.settings.alert_whatsapp || '').replace(/[^0-9]/g, '');
  const link = $('lsa-wa');
  if (wa) {
    const msg = encodeURIComponent(`🔔 ONCOST Low Stock Alert\n\n${lows.length} product(s) at/below ${threshold} units:\n\n` + lows.slice(0,10).map(p => `• ${p.name}: ${p.stock||0} left`).join('\n'));
    link.href = `https://wa.me/${wa}?text=${msg}`;
    link.style.display = '';
  } else {
    link.href = '#'; link.style.display = 'none';
  }
}

let _chartRevenue, _chartCategories;
function renderCharts() {
  if (typeof Chart === 'undefined') return;
  // Revenue last 30 days
  const days = [];
  const map = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0,0,0,0);
    const k = d.toISOString().slice(0,10);
    days.push(k); map[k] = 0;
  }
  state.orders.forEach(o => {
    const k = (o.created_at || '').slice(0,10);
    if (k in map) map[k] += Number(o.total_amount || 0);
  });
  const labels = days.map(d => new Date(d).toLocaleDateString('en-IN', { day:'numeric', month:'short' }));
  const data = days.map(d => map[d]);
  const rc = $('chart-revenue');
  if (rc) {
    if (_chartRevenue) _chartRevenue.destroy();
    _chartRevenue = new Chart(rc, {
      type: 'line',
      data: { labels, datasets: [{ label: 'Revenue (₹)', data, borderColor: '#7a1f35', backgroundColor: 'rgba(122,31,53,.10)', tension: .35, fill: true, pointRadius: 2, pointBackgroundColor: '#d4af37' }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 8, color: '#7A726B' }, grid: { display: false } }, y: { ticks: { color: '#7A726B', callback: v => '₹' + Number(v).toLocaleString('en-IN') }, grid: { color: '#F3EDE5' } } } }
    });
  }
  // Top categories by inventory value
  const catMap = {};
  state.products.forEach(p => {
    const c = p.category || 'Uncategorized';
    catMap[c] = (catMap[c] || 0) + Number(p.price || 0) * Number(p.stock || 0);
  });
  const cats = Object.entries(catMap).sort((a,b) => b[1] - a[1]).slice(0, 6);
  const cc = $('chart-categories');
  if (cc) {
    if (_chartCategories) _chartCategories.destroy();
    _chartCategories = new Chart(cc, {
      type: 'doughnut',
      data: { labels: cats.map(c => c[0]), datasets: [{ data: cats.map(c => c[1]), backgroundColor: ['#7a1f35','#d4af37','#b15f72','#f2dd92','#5c1527','#a47a45'] }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } } }, cutout: '55%' }
    });
  }
}

function kpi(label, value, icon, sub = '', tone = '') {
  return `<div class="kpi" data-testid="kpi-${slugify(label)}">
    <div class="kpi-icon" ${tone === 'warn' ? 'style="background:#FBF1E3;color:var(--admin-warn);"' : ''}><i class="fas ${icon}"></i></div>
    <div class="kpi-label">${escapeHTML(label)}</div>
    <div class="kpi-value">${escapeHTML(String(value))}</div>
    ${sub ? `<div class="kpi-sub">${escapeHTML(sub)}</div>` : ''}
  </div>`;
}
function statusBadge(s) {
  s = s || '';
  const cls = ({
    'Active': 'b-success', 'Live': 'b-success', 'Delivered': 'b-success', 'Approved': 'b-success',
    'Inactive': 'b-muted', 'Ended': 'b-muted',
    'Draft': 'b-warn', 'Processing': 'b-warn', 'Packed': 'b-warn', 'Shipped': 'b-warn', 'Pending': 'b-warn',
    'Cancelled': 'b-error', 'Rejected': 'b-error',
  })[s] || 'b-muted';
  return `<span class="badge ${cls}">${escapeHTML(s)}</span>`;
}

// ------------------------- Products -------------------------
async function loadProducts() {
  const { data, error } = await supabaseClient.from('products').select('*').order('created_at', { ascending: false });
  if (error) { showToast('Load products failed: ' + error.message, 'error'); return; }
  state.products = data || [];
}

function applyProductFilters() {
  const q = ($('products-search').value || '').toLowerCase().trim();
  const cat = $('products-cat-filter').value;
  const st = $('products-status-filter').value;
  state.productsFiltered = state.products.filter(p => {
    if (cat && (p.category || '') !== cat) return false;
    if (st && (p.status || 'Active') !== st) return false;
    if (q) {
      const hay = `${p.name || ''} ${p.sku || ''} ${p.barcode || ''} ${p.category || ''} ${p.id || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  state.productsPage = 1;
  renderProducts();
}

function renderProducts() {
  // Populate category filter dropdown
  const catSel = $('products-cat-filter');
  const cats = state.categories.map(c => c.name);
  const current = catSel.value;
  catSel.innerHTML = '<option value="">All categories</option>' + cats.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
  catSel.value = current;

  $('products-sub').textContent = `${state.productsFiltered.length} of ${state.products.length} products shown.`;

  const page = state.productsPage;
  const ps = state.productsPageSize;
  const slice = state.productsFiltered.slice((page-1) * ps, page * ps);

  if (slice.length === 0 && state.products.length === 0) {
    $('products-tbody').innerHTML = `<tr><td colspan="8"><div class="empty"><div class="ic"><i class="fas fa-box-open"></i></div><h4>No products yet</h4><p>Add manually or use Bulk Import.</p><button class="btn btn-primary" onclick="openProductForm()"><i class="fas fa-plus"></i> Add product</button></div></td></tr>`;
    $('products-pagination').style.display = 'none';
    return;
  }
  if (slice.length === 0) {
    $('products-tbody').innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--admin-text-mute);">No products match these filters.</td></tr>`;
    $('products-pagination').style.display = 'none';
    return;
  }

  $('products-tbody').innerHTML = slice.map(p => {
    const img = p.image_url ? `<img class="product-thumb" src="${escapeHTML(p.image_url)}" alt="" onerror="this.style.display='none'" />` :
      `<div class="product-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--admin-text-mute);"><i class="fas fa-image"></i></div>`;
    const stock = Number(p.stock || 0);
    const stockBadge = stock === 0 ? 'b-error' : stock <= 5 ? 'b-warn' : 'b-muted';
    const offer = (p.offer_price && Number(p.offer_price) !== Number(p.price));
    const checked = state.selectedProducts.has(p.id) ? 'checked' : '';
    return `<tr data-testid="product-row-${escapeHTML(p.id)}" ${state.selectedProducts.has(p.id)?'style="background:#FFF8E7;"':''}>
      <td style="text-align:center;"><input type="checkbox" class="product-row-check" data-id="${escapeHTML(p.id)}" ${checked} data-testid="check-product-${escapeHTML(p.id)}" /></td>
      <td>${img}</td>
      <td><div style="font-weight:600">${escapeHTML(p.name)}</div><div style="font-size:11px;color:var(--admin-text-mute)">${escapeHTML((p.description||'').substring(0,60))}</div></td>
      <td>
        <code style="font-size:11px;color:var(--admin-text-mute)">${escapeHTML(p.sku || '—')}</code>
        ${p.barcode ? `<div style="margin-top:4px;"><svg class="row-barcode" data-bc="${escapeHTML(p.barcode)}" style="display:block;max-width:140px;"></svg><div style="font-size:10px;color:var(--admin-text-mute);font-family:monospace;margin-top:1px;">${escapeHTML(p.barcode)}</div></div>` : ''}
      </td>
      <td>${escapeHTML(p.category || '—')}</td>
      <td style="text-align:right"><div style="font-weight:600">${fmtINR(p.price)}</div>${offer ? `<div style="font-size:11px;color:var(--admin-primary)">Sale ${fmtINR(p.offer_price)}</div>` : ''}</td>
      <td style="text-align:right"><span class="badge ${stockBadge}">${stock}</span></td>
      <td>${statusBadge(p.status || 'Active')}</td>
      <td style="position:sticky;right:0;background:#fff;z-index:1;">
        <div class="row-actions">
          ${p.barcode ? `<button class="icon-btn product-barcode-btn" data-pid="${escapeHTML(p.id)}" title="Print barcode label" data-testid="print-barcode-${escapeHTML(p.id)}"><i class="fas fa-print"></i></button>` : ''}
          <button class="icon-btn product-edit-btn" data-pid="${escapeHTML(p.id)}" data-testid="edit-product-${escapeHTML(p.id)}" title="Edit"><i class="fas fa-pen"></i></button>
          <button class="icon-btn danger product-delete-btn" data-pid="${escapeHTML(p.id)}" data-testid="delete-product-${escapeHTML(p.id)}" title="Delete"><i class="fas fa-trash"></i></button>
        </div>
      </td>
    </tr>`;
  }).join('');

  // Wire action buttons safely via data-pid (avoids escapeHTML encoding issues in onclick)
  document.querySelectorAll('.product-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => openProductForm(btn.dataset.pid));
  });
  document.querySelectorAll('.product-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteProduct(btn.dataset.pid));
  });
  document.querySelectorAll('.product-barcode-btn').forEach(btn => {
    btn.addEventListener('click', () => printBarcodeLabel(btn.dataset.pid));
  });

  // Wire row checkboxes
  document.querySelectorAll('.product-row-check').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = e.target.dataset.id;
      if (e.target.checked) state.selectedProducts.add(id);
      else state.selectedProducts.delete(id);
      updateProductsBulkBar();
      // Highlight row
      e.target.closest('tr').style.background = e.target.checked ? '#FFF8E7' : '';
    });
  });

  // Render inline barcodes after DOM update
  if (window.JsBarcode) {
    document.querySelectorAll('.row-barcode').forEach(svg => {
      const code = svg.dataset.bc;
      if (!code) return;
      try { window.JsBarcode(svg, code, { format: 'CODE128', width: 1.2, height: 28, fontSize: 0, margin: 0, displayValue: false }); } catch (_) { /* invalid */ }
    });
  }

  updateProductsBulkBar();

  // Pagination
  const totalPages = Math.max(1, Math.ceil(state.productsFiltered.length / ps));
  if (totalPages > 1) {
    $('products-pagination').style.display = 'flex';
    $('products-count').textContent = `Page ${page} / ${totalPages} · ${state.productsFiltered.length} products`;
    $('products-prev').disabled = page <= 1;
    $('products-next').disabled = page >= totalPages;
    $('products-prev').onclick = () => { state.productsPage = Math.max(1, page-1); renderProducts(); };
    $('products-next').onclick = () => { state.productsPage = Math.min(totalPages, page+1); renderProducts(); };
  } else {
    $('products-pagination').style.display = 'none';
  }
}

async function deleteProduct(id) {
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  if (!await confirmDialog(`Permanently delete "${p.name}"?`, { confirmLabel: 'Delete', danger: true })) return;
  const { error } = await supabaseClient.from('products').delete().eq('id', id);
  if (error) return showToast('Delete failed: ' + error.message, 'error');
  state.products = state.products.filter(x => x.id !== id);
  applyProductFilters();
  showToast('Product deleted.');
}
window.deleteProduct = deleteProduct;

// ------------------------- Bulk Product Actions -------------------------
function updateProductsBulkBar() {
  const bar = $('products-bulk-bar');
  const count = state.selectedProducts.size;
  if (!bar) return;
  if (count === 0) { bar.style.display = 'none'; }
  else {
    bar.style.display = 'flex';
    $('products-bulk-count').textContent = `${count} selected`;
  }
  // Sync header checkbox
  const all = $('products-check-all');
  if (all) {
    const visible = state.productsFiltered.slice((state.productsPage-1)*state.productsPageSize, state.productsPage*state.productsPageSize);
    const visIds = visible.map(p => p.id);
    const allSel = visIds.length > 0 && visIds.every(id => state.selectedProducts.has(id));
    all.checked = allSel;
    all.indeterminate = !allSel && visIds.some(id => state.selectedProducts.has(id));
  }
}
function clearProductSelection() {
  state.selectedProducts.clear();
  renderProducts();
}
window.clearProductSelection = clearProductSelection;

async function bulkProductDelete() {
  const ids = Array.from(state.selectedProducts);
  if (!ids.length) return;
  if (!await confirmDialog(`Delete ${ids.length} product${ids.length>1?'s':''} permanently? This cannot be undone.`, { confirmLabel: `Delete ${ids.length}`, danger: true })) return;
  const { error } = await supabaseClient.from('products').delete().in('id', ids);
  if (error) return showToast('Delete failed: ' + error.message, 'error');
  state.products = state.products.filter(p => !state.selectedProducts.has(p.id));
  state.selectedProducts.clear();
  applyProductFilters();
  showToast(`${ids.length} product${ids.length>1?'s':''} deleted.`);
}
window.bulkProductDelete = bulkProductDelete;

async function bulkProductStatus(status) {
  const ids = Array.from(state.selectedProducts);
  if (!ids.length) return;
  const { error } = await supabaseClient.from('products').update({ status }).in('id', ids);
  if (error) return showToast('Update failed: ' + error.message, 'error');
  state.products = state.products.map(p => state.selectedProducts.has(p.id) ? { ...p, status } : p);
  applyProductFilters();
  showToast(`${ids.length} product${ids.length>1?'s':''} → ${status}.`);
}
window.bulkProductStatus = bulkProductStatus;

async function bulkProductCategory() {
  const ids = Array.from(state.selectedProducts);
  if (!ids.length) return;
  const html = `
    <p style="margin:0 0 10px;color:var(--admin-text-mute);font-size:13px;">Set category for ${ids.length} selected product${ids.length>1?'s':''}.</p>
    <div class="field"><label>Category</label>
      <input class="input" list="bc-catlist" id="bc-cat" data-testid="bc-cat" placeholder="Pick or type new" />
      <datalist id="bc-catlist">${state.categories.map(c => `<option value="${escapeHTML(c.name)}">`).join('')}</datalist>
    </div>`;
  const footer = el('div', {});
  footer.innerHTML = `<button class="btn btn-secondary" id="bc-cancel" data-testid="bc-cancel">Cancel</button><button class="btn btn-primary" id="bc-save" data-testid="bc-save">Apply</button>`;
  const m = openModal({ title: 'Change Category', body: html, footer, size: 'sm', testid: 'bc' });
  $('bc-cancel').onclick = () => m.close();
  $('bc-save').onclick = async () => {
    const cat = $('bc-cat').value.trim();
    if (!cat) return showToast('Category required.', 'error');
    const { error } = await supabaseClient.from('products').update({ category: cat }).in('id', ids);
    if (error) return showToast('Update failed: ' + error.message, 'error');
    state.products = state.products.map(p => state.selectedProducts.has(p.id) ? { ...p, category: cat } : p);
    applyProductFilters();
    showToast(`${ids.length} product${ids.length>1?'s':''} moved to "${cat}".`);
    m.close();
  };
}
window.bulkProductCategory = bulkProductCategory;

// ------------------------- Barcode helpers -------------------------
function generateBarcodeForForm(formId) {
  // Strategy: if SKU exists → use SKU; else generate random 12-digit
  const sku = $(`${formId}-sku`).value.trim();
  const code = sku || String(Math.floor(100000000000 + Math.random() * 900000000000));
  $(`${formId}-barcode`).value = code;
  $(`${formId}-barcode`).dispatchEvent(new Event('input'));
}
window.generateBarcodeForForm = generateBarcodeForForm;

function printBarcodeLabel(productId) {
  const p = state.products.find(x => x.id === productId);
  if (!p || !p.barcode) return showToast('No barcode set for this product.', 'error');
  const w = window.open('', '_blank', 'width=420,height=320');
  if (!w) return showToast('Pop-up blocked. Allow pop-ups to print labels.', 'error');
  w.document.write(`<!doctype html><html><head><title>Label · ${escapeHTML(p.name)}</title>
    <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
    <style>
      @page { size: 60mm 40mm; margin: 0; }
      body { margin: 0; font-family: system-ui; padding: 4mm; }
      .lbl { text-align: center; }
      .lbl .nm { font-size: 11px; font-weight: 600; margin-bottom: 2px; line-height: 1.2; }
      .lbl .pr { font-size: 14px; font-weight: 700; margin-top: 4px; }
      .lbl .sku { font-size: 9px; color: #666; }
    </style></head><body>
    <div class="lbl">
      <div class="nm">${escapeHTML(p.name).substring(0, 32)}</div>
      <svg id="bc"></svg>
      <div class="sku">SKU: ${escapeHTML(p.sku || '—')}</div>
      <div class="pr">₹${Number(p.offer_price || p.price || 0).toFixed(2)}</div>
    </div>
    <script>
      JsBarcode('#bc', '${escapeHTML(p.barcode).replace(/'/g,"\\'")}', { format:'CODE128', width:1.6, height:40, fontSize:10, margin:2 });
      setTimeout(() => window.print(), 300);
    <\/script></body></html>`);
  w.document.close();
}
window.printBarcodeLabel = printBarcodeLabel;

function openProductForm(id) {
  const p = id ? state.products.find(x => x.id === id) : null;
  // If id was given but product not found in local state, fetch from Supabase then retry
  if (id && !p) {
    supabaseClient.from('products').select('*').eq('id', id).single().then(({ data, error }) => {
      if (error || !data) return showToast('Product not found: ' + (error?.message || id), 'error');
      // Add to local state so form can find it
      const idx = state.products.findIndex(x => x.id === data.id);
      if (idx >= 0) state.products[idx] = data; else state.products.unshift(data);
      openProductForm(id); // retry now that state has the product
    });
    return;
  }
  const isEdit = !!p;
  const formId = 'pf';
  const html = `
    <div class="tabs">
      <button type="button" class="tab-btn active" data-tab="general" data-testid="pf-tab-general">General</button>
      <button type="button" class="tab-btn" data-tab="media" data-testid="pf-tab-media">Media</button>
      <button type="button" class="tab-btn" data-tab="variants" data-testid="pf-tab-variants">Variants</button>
      <button type="button" class="tab-btn" data-tab="shipping" data-testid="pf-tab-shipping">Shipping &amp; Tax</button>
      <button type="button" class="tab-btn" data-tab="inventory" data-testid="pf-tab-inventory">Inventory</button>
      <button type="button" class="tab-btn" data-tab="seo" data-testid="pf-tab-seo">SEO</button>
    </div>
    <form id="${formId}-form">
      <div class="tab-pane active" data-pane="general">
        <div class="grid-2">
          <div class="field" style="grid-column:1/-1"><label>Name *</label><input class="input" id="${formId}-name" required data-testid="pf-name" value="${escapeHTML(p?.name||'')}" /></div>
          <div class="field"><label>SKU</label><input class="input" id="${formId}-sku" data-testid="pf-sku" value="${escapeHTML(p?.sku||'')}" placeholder="ONC-001" /></div>
          <div class="field">
            <label>Barcode <span style="font-weight:400;color:var(--admin-text-mute);font-size:11px;">(optional — EAN-13, UPC, or any code)</span></label>
            <div style="display:flex;gap:6px;">
              <input class="input" id="${formId}-barcode" data-testid="pf-barcode" value="${escapeHTML(p?.barcode||'')}" placeholder="8901234567890" style="flex:1;" />
              <button type="button" class="btn btn-secondary btn-sm" onclick="generateBarcodeForForm('${formId}')" title="Auto-generate from SKU or random 12-digit number" data-testid="pf-gen-barcode"><i class="fas fa-wand-magic-sparkles"></i></button>
            </div>
            <div id="${formId}-barcode-preview" style="margin-top:8px;text-align:center;"></div>
          </div>
          <div class="field"><label>Status</label>
            <select class="select" id="${formId}-status" data-testid="pf-status">
              ${['Active','Inactive','Draft'].map(s => `<option ${(p?.status||'Active')===s?'selected':''}>${s}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Category</label>
            <input class="input" list="${formId}-catlist" id="${formId}-category" data-testid="pf-category" value="${escapeHTML(p?.category||'')}" placeholder="e.g. Brass Collection" />
            <datalist id="${formId}-catlist">${state.categories.map(c => `<option value="${escapeHTML(c.name)}">`).join('')}</datalist>
          </div>
          <div class="field"><label>Badge (e.g. "Best Seller")</label><input class="input" id="${formId}-badge" data-testid="pf-badge" value="${escapeHTML(p?.badge||'')}" /></div>
          <div class="field"><label>Price (₹) *</label><input class="input" id="${formId}-price" type="number" min="0" step="0.01" required data-testid="pf-price" value="${p?.price ?? ''}" /></div>
          <div class="field"><label>Offer / Sale Price (₹)</label><input class="input" id="${formId}-offer_price" type="number" min="0" step="0.01" data-testid="pf-offer" value="${p?.offer_price ?? ''}" /></div>
          <div class="field" style="grid-column:1/-1"><label>Description</label><textarea class="textarea" id="${formId}-description" data-testid="pf-description">${escapeHTML(p?.description||'')}</textarea></div>
        </div>
      </div>

      <div class="tab-pane" data-pane="media">
        <div id="${formId}-img-block">
          ${p?.image_url ? `<div style="margin-bottom:12px;"><img src="${escapeHTML(p.image_url)}" alt="" style="max-width:240px;border-radius:6px;border:1px solid var(--admin-border);" /></div>` : ''}
        </div>
        <div class="field"><label>Primary Image URL</label><input class="input" id="${formId}-image_url" data-testid="pf-image_url" value="${escapeHTML(p?.image_url||'')}" placeholder="https://..." /></div>
        <div style="margin:14px 0 6px;font-size:12px;color:var(--admin-text-mute);text-align:center;">— or —</div>
        <div class="dropzone" id="${formId}-drop" data-testid="pf-drop">
          <div class="big-icon"><i class="fas fa-image"></i></div>
          <div style="font-weight:600;margin-bottom:4px">Drop a JPG/PNG to upload</div>
          <div style="font-size:12px;color:var(--admin-text-mute)" id="${formId}-drop-sub">Stored in your Supabase project · JPG/PNG/WEBP/GIF · max 5 MB</div>
          <input type="file" id="${formId}-file" accept="image/jpeg,image/png,image/webp" hidden />
        </div>
        <div style="margin:14px 0 6px;font-size:12px;color:var(--admin-text-mute);text-align:center;">— or —</div>
        <div style="background:linear-gradient(135deg,#fdf6e9,#f6e9de);border:1px solid #e8c896;border-radius:6px;padding:14px;display:flex;gap:12px;align-items:center;">
          <div style="font-size:24px;">🎨</div>
          <div style="flex:1;">
            <div style="font-weight:600;font-size:13px;color:var(--admin-primary);">Generate with AI (Gemini Nano Banana)</div>
            <div style="font-size:11px;color:var(--admin-text-mute);">Auto-generated from product name + category. Free up to 1500/day.</div>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" id="${formId}-ai_img" data-testid="pf-ai-img"><i class="fas fa-wand-magic-sparkles"></i> Generate</button>
        </div>

        <div style="margin-top:24px;padding-top:18px;border-top:1px solid var(--admin-border);">
          <label class="label" style="display:block;margin-bottom:6px;">Product Images &nbsp;<span id="${formId}-gallery-count" style="font-size:11px;color:var(--admin-text-mute);font-weight:400;"></span></label>
          <div style="font-size:12px;color:var(--admin-text-mute);margin-bottom:10px;">Up to 5 images per product. First image is shown as the main photo.</div>
          <div id="${formId}-gallery" style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px;"></div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <input class="input" id="${formId}-gallery_url" placeholder="Paste image URL…" style="flex:1;min-width:180px;" />
            <button type="button" class="btn btn-secondary btn-sm" id="${formId}-gallery_add_url"><i class="fas fa-link"></i> Add URL</button>
            <button type="button" class="btn btn-secondary btn-sm" id="${formId}-gallery_upload_btn"><i class="fas fa-upload"></i> Upload file(s)</button>
            <input type="file" id="${formId}-gallery_file" accept="image/jpeg,image/png,image/webp" hidden multiple />
          </div>
          <div class="hint" style="margin-top:6px;">JPG / PNG / WEBP · max 5 MB each · max 5 images total.</div>
        </div>
      </div>

      <div class="tab-pane" data-pane="variants">
        <div style="background:#E6F4EA;border:1px solid #A4D4B4;color:#1E5631;padding:10px 14px;border-radius:6px;margin-bottom:14px;font-size:13px;">
          <i class="fas fa-layer-group"></i> <strong>Optional</strong> — add variants like sizes (55gms, 80gms), colors (Gold, Silver), or pack quantities. Customers will see Amazon-style chips to choose.
        </div>
        <div style="margin-bottom:12px;">
          <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;">
            <input type="checkbox" id="${formId}-has_variants" data-testid="pf-has-variants" ${p?.has_variants?'checked':''} />
            <span>This product has multiple variants</span>
          </label>
        </div>
        <div id="${formId}-variants-block" style="display:${p?.has_variants?'block':'none'};">
          <div style="display:flex;gap:8px;margin-bottom:10px;align-items:center;flex-wrap:wrap;">
            <select class="select" id="${formId}-variant-type" style="max-width:160px;" data-testid="pf-variant-type">
              <option value="Size">Size / Weight</option>
              <option value="Color">Color</option>
              <option value="Material">Material</option>
              <option value="Capacity">Capacity</option>
              <option value="Pack">Pack quantity</option>
              <option value="Other">Other</option>
            </select>
            <button type="button" class="btn btn-secondary btn-sm" id="${formId}-add-variant" data-testid="pf-add-variant"><i class="fas fa-plus"></i> Add Variant</button>
            <span style="font-size:11px;color:var(--admin-text-mute);margin-left:auto;">Tip: First variant becomes the default shown to customers</span>
          </div>
          <table class="data" style="font-size:13px;">
            <thead><tr><th style="width:30px"></th><th>Label *</th><th>SKU</th><th style="text-align:right">Price *</th><th style="text-align:right">Stock</th><th style="text-align:right">Weight (g)</th><th>Image URL</th><th style="width:40px"></th></tr></thead>
            <tbody id="${formId}-variants-tbody"></tbody>
          </table>
          <div id="${formId}-variants-empty" style="display:none;padding:24px;text-align:center;color:var(--admin-text-mute);font-size:13px;background:var(--admin-muted);border-radius:6px;">
            <i class="fas fa-layer-group" style="font-size:28px;display:block;margin-bottom:8px;"></i>
            No variants yet. Click <strong>Add Variant</strong> above to create one.
          </div>
        </div>
      </div>

      <div class="tab-pane" data-pane="shipping">
        <div style="background:#FFF8E7;border:1px solid #E8C36E;color:#7A4310;padding:10px 14px;border-radius:6px;margin-bottom:14px;font-size:13px;">
          <i class="fas fa-truck"></i> These details are used to calculate shipping cost (Delhivery) and generate GST-compliant invoices. Fill them once per product.
        </div>
        <h4 style="margin:0 0 10px;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:var(--admin-text-mute);">Package dimensions (per unit)</h4>
        <div class="grid-2">
          <div class="field"><label>Weight (grams) *</label><input class="input" id="${formId}-weight_grams" type="number" min="0" step="1" data-testid="pf-weight" value="${p?.weight_grams ?? ''}" placeholder="e.g. 500" />
            <div class="hint">Net weight of a single unit including packaging</div></div>
          <div class="field"><label>Length (cm)</label><input class="input" id="${formId}-length_cm" type="number" min="0" step="0.1" data-testid="pf-length" value="${p?.length_cm ?? ''}" placeholder="e.g. 15" /></div>
          <div class="field"><label>Breadth (cm)</label><input class="input" id="${formId}-breadth_cm" type="number" min="0" step="0.1" data-testid="pf-breadth" value="${p?.breadth_cm ?? ''}" placeholder="e.g. 10" /></div>
          <div class="field"><label>Height (cm)</label><input class="input" id="${formId}-height_cm" type="number" min="0" step="0.1" data-testid="pf-height" value="${p?.height_cm ?? ''}" placeholder="e.g. 6" /></div>
        </div>
        <h4 style="margin:18px 0 10px;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:var(--admin-text-mute);">Tax classification</h4>
        <div class="grid-2">
          <div class="field"><label>HSN Code</label><input class="input" id="${formId}-hsn_code" data-testid="pf-hsn" value="${escapeHTML(p?.hsn_code||'')}" placeholder="e.g. 7117 (imitation jewellery) or 4421 (wooden articles)" />
            <div class="hint">Harmonised System Nomenclature — required on GST invoices. <a href="https://services.gst.gov.in/services/searchhsnsac" target="_blank" style="color:var(--admin-primary);">Find your HSN →</a></div></div>
          <div class="field"><label>GST %</label>
            <select class="select" id="${formId}-gst_percent" data-testid="pf-gst">
              ${[0,5,12,18,28].map(g => `<option value="${g}" ${Number(p?.gst_percent ?? 0)===g?'selected':''}>${g}%</option>`).join('')}
            </select>
            <div class="hint">Standard rates: 5% (essentials), 12% (most), 18% (electronics/luxury), 28% (premium)</div></div>
        </div>
      </div>

      <div class="tab-pane" data-pane="inventory">
        <div class="grid-2">
          <div class="field"><label>Stock On Hand</label><input class="input" id="${formId}-stock" type="number" min="0" data-testid="pf-stock" value="${p?.stock ?? 0}" /></div>
        </div>
      </div>

      <div class="tab-pane" data-pane="seo">
        <div style="margin-bottom:14px;text-align:right;">
          <button type="button" class="btn btn-secondary btn-sm" id="${formId}-ai_seo" data-testid="pf-ai-seo"><i class="fas fa-wand-magic-sparkles"></i> AI Generate SEO</button>
        </div>
        <div class="field"><label>SEO Title <span class="hint" style="float:right;" id="${formId}-seoTL"></span></label><input class="input" id="${formId}-seo_title" data-testid="pf-seo_title" value="${escapeHTML(p?.seo_title||'')}" placeholder="${escapeHTML(p?.name||'Product name shown in Google')}" /></div>
        <div class="field"><label>SEO Description <span class="hint" style="float:right;" id="${formId}-seoDL"></span></label><textarea class="textarea" id="${formId}-seo_description" data-testid="pf-seo_description">${escapeHTML(p?.seo_description||'')}</textarea></div>
        <div class="field"><label>Storefront URL</label><div class="hint">www.oncost.shop/product.html?id=<b>${escapeHTML(p?.id || slugify(p?.name || 'new-product'))}</b></div></div>
      </div>
    </form>`;

  const footer = el('div', { style: 'display:flex;gap:8px;' });
  footer.innerHTML = `
    <button class="btn btn-secondary" id="${formId}-cancel" data-testid="pf-cancel">Cancel</button>
    <button class="btn btn-primary" id="${formId}-save" data-testid="pf-save"><i class="fas fa-save"></i> ${isEdit ? 'Save changes' : 'Create product'}</button>`;

  const m = openModal({ title: isEdit ? `Edit · ${p.name}` : 'New Product', size: 'lg', body: html, footer, testid: 'pf' });

  // tabs
  m.root.querySelectorAll('.tab-btn').forEach(b => b.onclick = () => {
    m.root.querySelectorAll('.tab-btn').forEach(x => x.classList.remove('active'));
    m.root.querySelectorAll('.tab-pane').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    m.root.querySelector(`[data-pane="${b.dataset.tab}"]`).classList.add('active');
  });

  // SEO counters
  const upd = () => {
    $(`${formId}-seoTL`).textContent = `${$(`${formId}-seo_title`).value.length}/60`;
    $(`${formId}-seoDL`).textContent = `${$(`${formId}-seo_description`).value.length}/160`;
  };
  $(`${formId}-seo_title`).addEventListener('input', upd);
  $(`${formId}-seo_description`).addEventListener('input', upd);
  upd();

  // Barcode live preview
  const renderBarcodePreview = () => {
    const code = $(`${formId}-barcode`).value.trim();
    const target = $(`${formId}-barcode-preview`);
    if (!code) { target.innerHTML = ''; return; }
    target.innerHTML = `<svg id="${formId}-bc-svg"></svg>`;
    try {
      if (window.JsBarcode) {
        window.JsBarcode(`#${formId}-bc-svg`, code, { format: 'CODE128', width: 1.8, height: 48, fontSize: 12, margin: 4, displayValue: true });
      }
    } catch (e) { target.innerHTML = `<div style="color:var(--admin-text-mute);font-size:11px;">Invalid barcode value</div>`; }
  };
  $(`${formId}-barcode`).addEventListener('input', renderBarcodePreview);
  renderBarcodePreview();

  let variants = [];   // [{ id, variant_type, variant_label, sku, price, stock, weight_grams, image_url, is_default, sort_order }]
  let nextLocalId = 1;

  async function loadExistingVariants() {
    if (!p?.id) return;
    const { data } = await supabaseClient.from('product_variants').select('*').eq('product_id', p.id).order('sort_order', { ascending: true });
    variants = (data || []).map(v => ({ ...v, _saved: true }));
    renderVariantRows();
  }

  function renderVariantRows() {
    const tbody = $(`${formId}-variants-tbody`);
    const empty = $(`${formId}-variants-empty`);
    if (!tbody) return;
    if (!variants.length) {
      tbody.innerHTML = '';
      if (empty) empty.style.display = 'block';
      return;
    }
    if (empty) empty.style.display = 'none';
    tbody.innerHTML = variants.map((v, i) => `
      <tr data-vrow="${i}">
        <td style="text-align:center;color:var(--admin-text-mute);"><i class="fas fa-grip-vertical"></i></td>
        <td><input class="input" data-vfield="variant_label" value="${escapeHTML(v.variant_label||'')}" placeholder="e.g. 55 gms" data-testid="pf-var-label-${i}" /></td>
        <td><input class="input" data-vfield="sku" value="${escapeHTML(v.sku||'')}" placeholder="ONC-55" /></td>
        <td><input class="input" type="number" min="0" step="0.01" data-vfield="price" value="${v.price ?? ''}" placeholder="299" style="text-align:right" /></td>
        <td><input class="input" type="number" min="0" step="1" data-vfield="stock" value="${v.stock ?? 0}" style="text-align:right" /></td>
        <td><input class="input" type="number" min="0" step="1" data-vfield="weight_grams" value="${v.weight_grams ?? ''}" placeholder="55" style="text-align:right" /></td>
        <td><input class="input" data-vfield="image_url" value="${escapeHTML(v.image_url||'')}" placeholder="(uses product image if blank)" /></td>
        <td style="text-align:center;"><button type="button" class="icon-btn danger" data-vdel="${i}" title="Remove variant"><i class="fas fa-trash"></i></button></td>
      </tr>`).join('');
    // Wire field updates
    tbody.querySelectorAll('input[data-vfield]').forEach(inp => {
      inp.addEventListener('input', e => {
        const tr = e.target.closest('tr');
        const idx = Number(tr.dataset.vrow);
        const f = e.target.dataset.vfield;
        let val = e.target.value;
        if (['price','stock','weight_grams'].includes(f)) val = val === '' ? null : Number(val);
        variants[idx][f] = val;
      });
    });
    // Wire delete
    tbody.querySelectorAll('[data-vdel]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const idx = Number(e.currentTarget.dataset.vdel);
        const v = variants[idx];
        if (v._saved && v.id) {
          if (!await confirmDialog(`Permanently delete variant "${v.variant_label}"?`, { confirmLabel:'Delete', danger:true })) return;
          await supabaseClient.from('product_variants').delete().eq('id', v.id);
        }
        variants.splice(idx, 1);
        renderVariantRows();
      });
    });
  }

  $(`${formId}-has_variants`).addEventListener('change', e => {
    $(`${formId}-variants-block`).style.display = e.target.checked ? 'block' : 'none';
    if (e.target.checked && !variants.length) loadExistingVariants();
  });
  $(`${formId}-add-variant`).addEventListener('click', () => {
    const type = $(`${formId}-variant-type`).value;
    const basePrice = Number($(`${formId}-price`).value) || 0;
    const baseSku = $(`${formId}-sku`).value.trim();
    variants.push({
      _localId: nextLocalId++,
      variant_type: type,
      variant_label: '',
      sku: baseSku ? `${baseSku}-V${variants.length+1}` : '',
      price: basePrice,
      stock: 0,
      weight_grams: null,
      image_url: '',
      is_default: variants.length === 0,
      sort_order: variants.length,
      _saved: false,
    });
    renderVariantRows();
  });

  // Load existing variants on open if editing
  if (p?.has_variants) loadExistingVariants();

  // Expose for save handler
  window.__pf_variants = variants;
  Object.defineProperty(window, '__pf_get_variants', { configurable: true, value: () => variants });


  // Upload
  const drop = $(`${formId}-drop`), file = $(`${formId}-file`);
  drop.addEventListener('click', () => file.click());
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('drag'); if (e.dataTransfer.files[0]) handleUpload(e.dataTransfer.files[0]); });
  file.addEventListener('change', (e) => e.target.files[0] && handleUpload(e.target.files[0]));
  async function handleUpload(f) {
    $(`${formId}-drop-sub`).innerHTML = '<span class="spin"></span> Uploading…';
    try {
      const url = await uploadProductImage(f);
      // Add to gallery (respects max 5 limit)
      if (gallery.length < MAX_IMAGES) {
        gallery.push(url);
        renderGallery();
      }
      $(`${formId}-image_url`).value = gallery[0] || url;
      $(`${formId}-img-block`).innerHTML = `<div style="margin-bottom:12px;"><img src="${escapeHTML(url)}" alt="" style="max-width:240px;border-radius:6px;border:1px solid var(--admin-border);" /></div>`;
      $(`${formId}-drop-sub`).textContent = 'Uploaded · ready to save';
      showToast('Image uploaded.');
    } catch (e) {
      showToast(e.message, 'error');
      $(`${formId}-drop-sub`).textContent = 'Stored in your Supabase project · JPG/PNG/WEBP/GIF · max 5 MB';
    }
  }

  // Save
  $(`${formId}-cancel`).onclick = () => m.close();

  // ---------- Gallery management (max 5 · reorder · make primary · remove) ----------
  // Seed gallery from image_urls; also include image_url as first if not already present
  let gallery = Array.isArray(p?.image_urls) ? [...p.image_urls] : [];
  if (p?.image_url && !gallery.includes(p.image_url)) gallery.unshift(p.image_url);

  const MAX_IMAGES = 5;

  function renderGallery() {
    const slot = $(`${formId}-gallery`);
    const countEl = $(`${formId}-gallery-count`);
    if (!slot) return;
    if (countEl) countEl.textContent = `(${gallery.length} / ${MAX_IMAGES})`;
    if (!gallery.length) {
      slot.innerHTML = `<div style="color:var(--admin-text-mute);font-size:12px;">No images yet. Upload or paste a URL below.</div>`;
      return;
    }
    slot.innerHTML = gallery.map((url, i) => `
      <div style="position:relative;width:96px;border-radius:6px;overflow:hidden;border:2px solid ${i===0?'var(--admin-primary)':'var(--admin-border)'};background:var(--admin-muted);" title="${i===0?'Main image':'Image '+(i+1)}" data-testid="pf-gallery-item-${i}">
        <img src="${escapeHTML(url)}" style="width:96px;height:80px;object-fit:cover;display:block;" onerror="this.style.display='none'" />
        ${i===0?'<div style="position:absolute;top:0;left:0;background:rgba(0,47,167,0.8);color:#fff;font-size:9px;padding:2px 6px;font-weight:600;letter-spacing:0.5px;border-radius:0 0 4px 0;">MAIN</div>':''}
        <div style="display:flex;justify-content:space-between;background:#fff;border-top:1px solid var(--admin-border);">
          <button type="button" data-gmove="${i}:-1" title="Move left" ${i===0?'disabled':''} style="flex:1;border:none;background:none;cursor:pointer;padding:3px 0;font-size:10px;color:var(--admin-text-mute);${i===0?'opacity:.3;':''}"><i class="fas fa-chevron-left"></i></button>
          <button type="button" data-gstar="${i}" title="Make main image" ${i===0?'disabled':''} style="flex:1;border:none;background:none;cursor:pointer;padding:3px 0;font-size:10px;color:#E8A53A;${i===0?'opacity:.3;':''}"><i class="fas fa-star"></i></button>
          <button type="button" data-gi="${i}" title="Remove" style="flex:1;border:none;background:none;cursor:pointer;padding:3px 0;font-size:10px;color:var(--admin-error);"><i class="fas fa-trash"></i></button>
          <button type="button" data-gmove="${i}:1" title="Move right" ${i===gallery.length-1?'disabled':''} style="flex:1;border:none;background:none;cursor:pointer;padding:3px 0;font-size:10px;color:var(--admin-text-mute);${i===gallery.length-1?'opacity:.3;':''}"><i class="fas fa-chevron-right"></i></button>
        </div>
      </div>`).join('');
    const syncPrimary = () => { if ($(`${formId}-image_url`)) $(`${formId}-image_url`).value = gallery[0] || ''; };
    slot.querySelectorAll('[data-gi]').forEach(btn => btn.onclick = () => {
      gallery.splice(parseInt(btn.dataset.gi, 10), 1);
      syncPrimary();
      renderGallery();
    });
    slot.querySelectorAll('[data-gmove]').forEach(btn => btn.onclick = () => {
      const [i, dir] = btn.dataset.gmove.split(':').map(Number);
      const j = i + dir;
      if (j < 0 || j >= gallery.length) return;
      [gallery[i], gallery[j]] = [gallery[j], gallery[i]];
      syncPrimary();
      renderGallery();
    });
    slot.querySelectorAll('[data-gstar]').forEach(btn => btn.onclick = () => {
      const i = parseInt(btn.dataset.gstar, 10);
      if (i === 0) return;
      const [promoted] = gallery.splice(i, 1);
      gallery.unshift(promoted);
      syncPrimary();
      renderGallery();
      showToast('Main image updated. Remember to save.');
    });
  }

  renderGallery();

  $(`${formId}-gallery_add_url`).onclick = () => {
    const u = $(`${formId}-gallery_url`).value.trim();
    if (!u) return;
    if (gallery.length >= MAX_IMAGES) return showToast(`Max ${MAX_IMAGES} images per product.`, 'error');
    gallery.push(u);
    $(`${formId}-gallery_url`).value = '';
    if (gallery.length === 1 && $(`${formId}-image_url`)) $(`${formId}-image_url`).value = u;
    renderGallery();
  };
  $(`${formId}-gallery_upload_btn`).onclick = () => $(`${formId}-gallery_file`).click();
  $(`${formId}-gallery_file`).onchange = async (e) => {
    for (const f of Array.from(e.target.files || [])) {
      if (gallery.length >= MAX_IMAGES) { showToast(`Max ${MAX_IMAGES} images reached.`, 'error'); break; }
      try {
        const url = await uploadProductImage(f);
        gallery.push(url);
        if (gallery.length === 1 && $(`${formId}-image_url`)) $(`${formId}-image_url`).value = url;
        renderGallery();
      } catch (err) { showToast(err.message, 'error'); }
    }
    e.target.value = '';
  };

  // ---------- AI Image generator (Gemini Nano Banana) ----------
  $(`${formId}-ai_img`).onclick = async () => {
    const geminiKey = state.settings.gemini_api_key;
    if (!geminiKey) return showToast('Add a Gemini API key in Site Settings → AI & Alerts.', 'error');
    const name = $(`${formId}-name`).value.trim();
    if (!name) return showToast('Enter product name first.', 'error');
    const category = $(`${formId}-category`).value.trim() || 'premium gift';
    const btn = $(`${formId}-ai_img`);
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Generating…';
    try {
      const prompt = `Professional product photography of "${name}" — a ${category} for an Indian luxury return-gifts e-commerce store. Single product centered on a soft cream/beige background with subtle warm lighting. Studio quality, ultra-detailed, brass/gold/copper tones. Square aspect ratio. No text, no watermark, no people. Tasteful, premium, gift-ready presentation.`;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${encodeURIComponent(geminiKey)}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['IMAGE'] },
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message || `Gemini error ${r.status}`);
      const parts = j.candidates?.[0]?.content?.parts || [];
      const img = parts.find(p => p.inlineData || p.inline_data);
      const dataBlock = img?.inlineData || img?.inline_data;
      if (!dataBlock?.data) throw new Error('No image returned by Gemini');
      const byteChars = atob(dataBlock.data);
      const byteArr = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
      const blob = new Blob([byteArr], { type: dataBlock.mimeType || dataBlock.mime_type || 'image/png' });
      const file = new File([blob], `ai-${slugify(name)}.png`, { type: blob.type });
      btn.innerHTML = '<span class="spin"></span> Uploading…';
      const imgUrl = await uploadProductImage(file);
      $(`${formId}-image_url`).value = imgUrl;
      $(`${formId}-img-block`).innerHTML = `<div style="margin-bottom:12px;"><img src="${escapeHTML(imgUrl)}" alt="" style="max-width:240px;border-radius:6px;border:1px solid var(--admin-border);" /></div>`;
      showToast('🎨 AI image generated. Review and save.');
    } catch (err) {
      showToast('AI image failed: ' + err.message, 'error');
    } finally {
      btn.disabled = false; btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Generate';
    }
  };

  // ---------- AI SEO generator ----------
  $(`${formId}-ai_seo`).onclick = async () => {
    const key = state.settings.openai_api_key;
    if (!key) return showToast('Add an OpenAI API key in Site Settings → AI & Alerts.', 'error');
    const name = $(`${formId}-name`).value.trim() || 'Product';
    const category = $(`${formId}-category`).value.trim() || 'Premium gift';
    const desc = $(`${formId}-description`).value.trim() || '';
    const price = $(`${formId}-price`).value || '';
    const btn = $(`${formId}-ai_seo`);
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Generating…';
    try {
      const prompt = `You are an SEO copywriter for ONCOST — a premium Indian e-commerce store selling brass, German silver, tin and thambulam return gifts for weddings, poojas, birthdays and corporate events.\n\nProduct:\nName: ${name}\nCategory: ${category}\nPrice: ₹${price}\nNotes: ${desc || '(none)'}\n\nWrite JSON with these exact keys:\n- seo_title: max 60 chars, includes product name + key benefit\n- seo_description: max 155 chars, persuasive, includes "ONCOST" and a buying intent phrase\n- description: 2 sentences, 30-50 words, warm and aspirational, mentions gifting use-case\n\nReturn ONLY valid JSON, no markdown, no commentary.`;
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.7,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message || 'OpenAI error');
      const content = j.choices?.[0]?.message?.content || '{}';
      const out = JSON.parse(content);
      if (out.seo_title) $(`${formId}-seo_title`).value = out.seo_title;
      if (out.seo_description) $(`${formId}-seo_description`).value = out.seo_description;
      if (out.description && !$(`${formId}-description`).value.trim()) $(`${formId}-description`).value = out.description;
      // refresh char counters
      $(`${formId}-seoTL`).textContent = `${$(`${formId}-seo_title`).value.length}/60`;
      $(`${formId}-seoDL`).textContent = `${$(`${formId}-seo_description`).value.length}/160`;
      showToast('✨ SEO generated. Review and save.');
    } catch (err) {
      showToast('AI failed: ' + err.message, 'error');
    } finally {
      btn.disabled = false; btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> AI Generate SEO';
    }
  };

  $(`${formId}-save`).onclick = async () => {
    const name = $(`${formId}-name`).value.trim();
    if (!name) return showToast('Name is required.', 'error');
    const newId = isEdit ? p.id : (slugify($(`${formId}-sku`).value.trim() || name));
    const primaryImage = $(`${formId}-image_url`).value.trim();
    const finalImages = [];
    [primaryImage, ...gallery].forEach(url => {
      const clean = (url || '').trim();
      if (clean && !finalImages.includes(clean) && finalImages.length < MAX_IMAGES) finalImages.push(clean);
    });
    const payload = {
      id: newId, name,
      sku: $(`${formId}-sku`).value.trim() || null,
      barcode: $(`${formId}-barcode`).value.trim() || null,
      weight_grams: $(`${formId}-weight_grams`).value ? Math.round(Number($(`${formId}-weight_grams`).value)) : null,
      length_cm:  $(`${formId}-length_cm`).value  ? Number($(`${formId}-length_cm`).value)  : null,
      breadth_cm: $(`${formId}-breadth_cm`).value ? Number($(`${formId}-breadth_cm`).value) : null,
      height_cm:  $(`${formId}-height_cm`).value  ? Number($(`${formId}-height_cm`).value)  : null,
      hsn_code:   $(`${formId}-hsn_code`).value.trim() || null,
      gst_percent: Number($(`${formId}-gst_percent`).value || 0),
      has_variants: $(`${formId}-has_variants`).checked,
      status: $(`${formId}-status`).value,
      category: $(`${formId}-category`).value.trim() || null,
      badge: $(`${formId}-badge`).value.trim() || null,
      price: Number($(`${formId}-price`).value) || 0,
      offer_price: $(`${formId}-offer_price`).value ? Number($(`${formId}-offer_price`).value) : null,
      description: $(`${formId}-description`).value.trim() || null,
      image_url: finalImages[0] || null,
      image_urls: finalImages.length ? finalImages : null,
      stock: Number($(`${formId}-stock`).value) || 0,
      seo_title: $(`${formId}-seo_title`).value.trim() || null,
      seo_description: $(`${formId}-seo_description`).value.trim() || null,
    };
    let res;
    if (isEdit) {
      res = await supabaseClient.from('products').update(payload).eq('id', p.id).select().single();
    } else {
      res = await supabaseClient.from('products').upsert(payload).select().single();
    }
    if (res.error && res.error.message?.includes('image_urls')) {
      // DB migration not run yet — retry without gallery so save still works
      delete payload.image_urls;
      res = isEdit
        ? await supabaseClient.from('products').update(payload).eq('id', p.id).select().single()
        : await supabaseClient.from('products').upsert(payload).select().single();
      if (!res.error) showToast('Saved without gallery — run migration_phase4_loyalty_multiimage.sql in Supabase to enable multiple images.', 'error');
    }
    if (res.error) return showToast('Save failed: ' + res.error.message, 'error');

    if (payload.has_variants && window.__pf_get_variants) {
      const productId = res.data.id;
      const vList = window.__pf_get_variants();
      for (let i = 0; i < vList.length; i++) {
        const v = vList[i];
        if (!v.variant_label || v.price == null) continue;   // skip incomplete rows
        const vRow = {
          product_id: productId,
          variant_type: v.variant_type || 'Size',
          variant_label: v.variant_label.trim(),
          sku: v.sku?.trim() || null,
          price: Number(v.price),
          stock: Number(v.stock || 0),
          weight_grams: v.weight_grams ? Number(v.weight_grams) : null,
          image_url: v.image_url?.trim() || null,
          is_default: i === 0,
          sort_order: i,
        };
        if (v._saved && v.id) {
          await supabaseClient.from('product_variants').update(vRow).eq('id', v.id);
        } else {
          await supabaseClient.from('product_variants').insert(vRow);
        }
      }
    }

    // Update local cache
    const idx = state.products.findIndex(x => x.id === res.data.id);
    if (idx >= 0) state.products[idx] = res.data; else state.products.unshift(res.data);
    applyProductFilters();
    renderDashboard();
    showToast(isEdit ? 'Product saved.' : 'Product created.');
    m.close();
  };
}
window.openProductForm = openProductForm;

// ------------------------- Categories -------------------------
async function loadCategories() {
  const { data } = await supabaseClient.from('categories').select('*').order('name', { ascending: true });
  state.categories = data || [];
}
function renderCategories() {
  $('categories-sub').textContent = `${state.categories.length} categories.`;
  const tbody = $('categories-tbody');
  if (!state.categories.length) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty"><div class="ic"><i class="fas fa-layer-group"></i></div><h4>No categories yet</h4><p>Add one manually or import a CSV — categories auto-create from SHORTCODE column.</p><button class="btn btn-primary" onclick="openCategoryForm()"><i class="fas fa-plus"></i> Add category</button></div></td></tr>`;
    return;
  }
  tbody.innerHTML = state.categories.map(c => {
    const used = state.products.filter(p => (p.category||'') === c.name).length;
    return `<tr data-testid="cat-row-${escapeHTML(c.id)}">
      <td style="font-weight:600">${escapeHTML(c.name)}</td>
      <td style="color:var(--admin-text-mute)">${escapeHTML(c.description||'—')}</td>
      <td><span class="badge b-maroon">${used} products</span></td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" onclick="openCategoryForm('${escapeHTML(c.id)}')" title="Edit"><i class="fas fa-pen"></i></button>
          <button class="icon-btn danger" onclick="deleteCategory('${escapeHTML(c.id)}')" title="Delete"><i class="fas fa-trash"></i></button>
        </div>
      </td>
    </tr>`;
  }).join('');
}
function openCategoryForm(id) {
  const c = id ? state.categories.find(x => x.id === id) : null;
  const isEdit = !!c;
  const html = `
    <div class="field"><label>Name *</label><input class="input" id="cf-name" required data-testid="cf-name" value="${escapeHTML(c?.name||'')}" /></div>
    <div class="field"><label>Description</label><textarea class="textarea" id="cf-description" data-testid="cf-description">${escapeHTML(c?.description||'')}</textarea></div>
    <div class="field"><label>Image URL</label><input class="input" id="cf-image_url" data-testid="cf-image_url" value="${escapeHTML(c?.image_url||'')}" placeholder="https://..." /></div>`;
  const footer = el('div', {});
  footer.innerHTML = `<button class="btn btn-secondary" id="cf-cancel" data-testid="cf-cancel">Cancel</button><button class="btn btn-primary" id="cf-save" data-testid="cf-save"><i class="fas fa-save"></i> ${isEdit ? 'Save' : 'Create'}</button>`;
  const m = openModal({ title: isEdit ? `Edit Category` : 'New Category', size: 'sm', body: html, footer, testid: 'cf' });
  $('cf-cancel').onclick = () => m.close();
  $('cf-save').onclick = async () => {
    const name = $('cf-name').value.trim();
    if (!name) return showToast('Name required.', 'error');
    const payload = { name, description: $('cf-description').value.trim() || null, image_url: $('cf-image_url').value.trim() || null };
    let res;
    if (isEdit) res = await supabaseClient.from('categories').update(payload).eq('id', c.id).select().single();
    else        res = await supabaseClient.from('categories').insert(payload).select().single();
    if (res.error) return showToast('Save failed: ' + res.error.message, 'error');
    if (isEdit) {
      const idx = state.categories.findIndex(x => x.id === c.id);
      state.categories[idx] = res.data;
    } else state.categories.push(res.data);
    state.categories.sort((a,b) => a.name.localeCompare(b.name));
    renderCategories();
    renderProducts();
    showToast(isEdit ? 'Category saved.' : 'Category created.');
    m.close();
  };
}
window.openCategoryForm = openCategoryForm;
async function deleteCategory(id) {
  const c = state.categories.find(x => x.id === id);
  if (!c) return;
  if (!await confirmDialog(`Delete category "${c.name}"? Products keep their category text.`, { confirmLabel: 'Delete', danger: true })) return;
  const { error } = await supabaseClient.from('categories').delete().eq('id', id);
  if (error) return showToast('Delete failed: ' + error.message, 'error');
  state.categories = state.categories.filter(x => x.id !== id);
  renderCategories();
  showToast('Category deleted.');
}
window.deleteCategory = deleteCategory;

// ------------------------- Inventory -------------------------
function renderInventory() {
  const q = ($('inv-search').value || '').toLowerCase().trim();
  const lowOnly = $('inv-low-only').checked;
  const rows = state.products.filter(p => {
    if (lowOnly && (p.stock ?? 0) > 5) return false;
    if (q) {
      const hay = `${p.name} ${p.sku || ''} ${p.category || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const tbody = $('inv-tbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--admin-text-mute);">No products match.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(p => {
    const stock = Number(p.stock || 0);
    const sb = stock === 0 ? 'b-error' : stock <= 5 ? 'b-warn' : 'b-success';
    return `<tr data-testid="inv-row-${escapeHTML(p.id)}">
      <td style="font-weight:600">${escapeHTML(p.name)}</td>
      <td><code style="font-size:11px">${escapeHTML(p.sku||'—')}</code></td>
      <td>${escapeHTML(p.category||'—')}</td>
      <td style="text-align:center"><span class="badge ${sb}" data-testid="inv-stock-${escapeHTML(p.id)}">${stock}</span></td>
      <td style="text-align:right">
        ${[-10,-1,1,10].map(d => `<button class="btn btn-secondary btn-sm" style="min-width:46px;padding:5px 8px" onclick="adjustStock('${escapeHTML(p.id)}',${d})" data-testid="inv-adj-${escapeHTML(p.id)}-${d}">${d>0?'+'+d:d}</button>`).join(' ')}
      </td>
    </tr>`;
  }).join('');
}
async function adjustStock(id, delta) {
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  const newStock = Math.max(0, Number(p.stock||0) + delta);
  const { error } = await supabaseClient.from('products').update({ stock: newStock }).eq('id', id);
  if (error) return showToast('Adjust failed: ' + error.message, 'error');
  p.stock = newStock;
  renderInventory();
  renderDashboard();
}
window.adjustStock = adjustStock;

// ------------------------- Bulk Import -------------------------
function setupImport() {
  const drop = $('import-drop'), file = $('import-file');
  drop.addEventListener('click', () => file.click());
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('drag'); if (e.dataTransfer.files[0]) onImportFile(e.dataTransfer.files[0]); });
  file.addEventListener('change', (e) => e.target.files[0] && onImportFile(e.target.files[0]));
  $('import-preview-btn').addEventListener('click', doImportPreview);
  $('import-commit-btn').addEventListener('click', doImportCommit);
}

let importFile = null, importRows = null;
function onImportFile(f) {
  importFile = f; importRows = null;
  $('import-droptext').textContent = f.name;
  $('import-dropsub').textContent = `${(f.size/1024).toFixed(1)} KB · click to replace`;
  $('import-preview-btn').disabled = false;
  $('import-commit-btn').disabled = false;
  $('import-result').innerHTML = '';
  $('import-preview-block').style.display = 'none';
}

function parseImportFile() {
  return new Promise((resolve, reject) => {
    if (!importFile) return reject(new Error('No file'));
    const name = importFile.name.toLowerCase();
    if (name.endsWith('.csv')) {
      Papa.parse(importFile, {
        header: true, skipEmptyLines: true,
        transformHeader: h => (h || '').trim().toUpperCase(),
        complete: (r) => resolve(r.data),
        error: (e) => reject(e),
      });
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
          // Normalize keys
          const normalized = rows.map(r => {
            const o = {};
            Object.entries(r).forEach(([k, v]) => o[(k || '').trim().toUpperCase()] = v);
            return o;
          });
          resolve(normalized);
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(importFile);
    }
  });
}

function mapRow(r) {
  const status = (r.STATUS || 'ACTIVE').toString().trim().toUpperCase();
  const statusUI = status === 'ACTIVE' ? 'Active' : status === 'INACTIVE' ? 'Inactive' : status === 'DRAFT' ? 'Draft' : 'Active';
  const name = (r.NAME || '').toString().trim();
  return {
    name,
    sku: (r.SKU || '').toString().trim() || null,
    barcode: (r.BARCODE || r.EAN || r.UPC || '').toString().trim() || null,
    weight_grams: r.WEIGHT_G || r.WEIGHT || r['WEIGHT (G)'] ? Math.round(Number(r.WEIGHT_G || r.WEIGHT || r['WEIGHT (G)'])) || null : null,
    length_cm:  r.LENGTH  || r['LENGTH (CM)']  ? Number(r.LENGTH  || r['LENGTH (CM)'])  || null : null,
    breadth_cm: r.BREADTH || r['BREADTH (CM)'] ? Number(r.BREADTH || r['BREADTH (CM)']) || null : null,
    height_cm:  r.HEIGHT  || r['HEIGHT (CM)']  ? Number(r.HEIGHT  || r['HEIGHT (CM)'])  || null : null,
    hsn_code:   (r.HSN || r['HSN CODE'] || '').toString().trim() || null,
    gst_percent: r.GST || r['GST %'] || r['GST PERCENT'] ? Number(r.GST || r['GST %'] || r['GST PERCENT']) || 0 : 0,
    category: (r.SHORTCODE || r.CATEGORY || '').toString().trim() || null,
    badge: (r.BADGE || '').toString().trim() || null,
    description: (r.DESCRIPTION || '').toString().trim() || null,
    price: Number(String(r.PRICE || '').replace(/,/g,'')) || 0,
    offer_price: Number(String(r['SALE PRICE'] || '').replace(/,/g,'')) || null,
    stock: parseInt(String(r['ON HAND'] || r.AVAILABLE || '').replace(/,/g,''), 10) || 0,
    status: statusUI,
    image_url: (r['IMAGE URL'] || '').toString().trim() || null,
    seo_title: null, seo_description: null,
  };
}

async function doImportPreview() {
  try {
    if (!importRows) importRows = await parseImportFile();
    const preview = importRows.slice(0, 20).map(mapRow);
    $('import-preview-block').style.display = 'block';
    $('import-preview-tbody').innerHTML = preview.map(r => `
      <tr>
        <td style="font-weight:500">${escapeHTML(r.name || '(blank)')}</td>
        <td><code style="font-size:11px">${escapeHTML(r.sku||'—')}</code></td>
        <td>${escapeHTML(r.category||'—')}</td>
        <td style="text-align:right">${fmtINR(r.price)}</td>
        <td style="text-align:right">${r.stock}</td>
        <td>${statusBadge(r.status)}</td>
      </tr>`).join('');
    $('import-result').innerHTML = `<div style="font-size:13px;color:var(--admin-text-mute);">Detected <b>${importRows.length}</b> rows in the file.</div>`;
  } catch (e) {
    showToast('Preview failed: ' + e.message, 'error');
  }
}

async function doImportCommit() {
  try {
    $('import-commit-btn').disabled = true;
    $('import-commit-btn').innerHTML = '<span class="spin"></span> Importing…';
    if (!importRows) importRows = await parseImportFile();
    const mapped = importRows.map(mapRow).filter(r => r.name);

    // Auto-create missing categories
    const existingCatNames = new Set(state.categories.map(c => c.name));
    const newCats = [...new Set(mapped.map(r => r.category).filter(Boolean).filter(c => !existingCatNames.has(c)))];
    let catsCreated = 0;
    if (newCats.length) {
      const ins = newCats.map(name => ({ name }));
      const { data, error } = await supabaseClient.from('categories').insert(ins).select();
      if (!error && data) { state.categories = state.categories.concat(data); catsCreated = data.length; }
    }

    // Upsert products in batches of 50 (PK by id - we generate slug-based id)
    let created = 0, updated = 0, skipped = 0;
    const seen = new Set(state.products.map(p => p.id));
    // build payload with stable ids
    const idCount = {};
    const toUpsert = mapped.map(r => {
      // pick id: if sku exists, prefer slug from sku; else from name
      let base = slugify(r.sku || r.name);
      idCount[base] = (idCount[base] || 0) + 1;
      const id = idCount[base] > 1 ? `${base}-${idCount[base]}` : base;
      const isUpdate = seen.has(id);
      if (isUpdate) updated++; else created++;
      return { id, ...r };
    });

    // Upsert in chunks
    const CHUNK = 50;
    for (let i = 0; i < toUpsert.length; i += CHUNK) {
      const slice = toUpsert.slice(i, i + CHUNK);
      const { error } = await supabaseClient.from('products').upsert(slice, { onConflict: 'id' });
      if (error) {
        skipped += slice.length;
        console.error('Upsert error:', error);
      }
    }

    await loadProducts();
    applyProductFilters();
    renderCategories();
    renderDashboard();

    $('import-result').innerHTML = `
      <div style="background:#E8F4E9;border:1px solid #C2DFC4;color:var(--admin-success);padding:12px 14px;border-radius:6px;display:flex;gap:10px;align-items:center;">
        <i class="fas fa-circle-check" style="font-size:18px"></i>
        <div>
          <div style="font-weight:600;">Import complete</div>
          <div style="font-size:12px;">Created: <b>${created - updated < 0 ? 0 : created - updated}</b> · Updated: <b>${updated}</b> · Skipped: <b>${skipped}</b> · New categories: <b>${catsCreated}</b></div>
        </div>
      </div>`;
    showToast('Import complete.');
  } catch (e) {
    showToast('Import failed: ' + e.message, 'error');
    $('import-result').innerHTML = `<div style="background:#FBECEC;border:1px solid #E8C1C1;color:var(--admin-error);padding:12px 14px;border-radius:6px;">${escapeHTML(e.message)}</div>`;
  } finally {
    $('import-commit-btn').disabled = false;
    $('import-commit-btn').innerHTML = '<i class="fas fa-check"></i> Import All';
  }
}

// ------------------------- Orders -------------------------
async function loadOrders() {
  const { data } = await supabaseClient.from('orders').select('*').order('created_at', { ascending: false });
  state.orders = data || [];
}
function renderOrders() {
  $('orders-sub').textContent = `${state.orders.length} orders to date.`;
  const tbody = $('orders-tbody');
  const q = ($('orders-search').value || '').toLowerCase();
  const st = $('orders-status-filter').value;
  const filtered = state.orders.filter(o => {
    if (st && o.status !== st) return false;
    if (q) {
      const hay = `${o.id} ${o.guest_email||''} ${o.user_id||''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty"><div class="ic"><i class="fas fa-receipt"></i></div><h4>No orders ${state.orders.length ? 'match filters' : 'yet'}</h4><p>Orders placed through the storefront will appear here.</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map(o => {
    let items = [];
    try { items = typeof o.items === 'string' ? JSON.parse(o.items) : (Array.isArray(o.items) ? o.items : (o.items?.items || [])); } catch(e){}
    const qty = items.reduce((s, it) => s + Number(it.qty || it.quantity || 1), 0);
    const ccId = o.ccavenue_order_id || '';
    const invLink = ccId ? `<a href="thank-you.html?status=success&order_id=${encodeURIComponent(ccId)}&tracking_id=${encodeURIComponent(o.payment_tracking_id||'')}&amount=${encodeURIComponent(o.total_amount||'')}" target="_blank" class="icon-btn" title="View / print invoice" data-testid="invoice-btn-${escapeHTML(o.id)}"><i class="fas fa-file-invoice"></i></a>` : '';
    const reviewable = ['Paid','Packed','Shipped','Delivered'].includes(o.status);
    const reviewBtn = reviewable ? `<button class="icon-btn" onclick="requestReview('${escapeHTML(o.id)}')" title="Request review via WhatsApp" data-testid="review-req-${escapeHTML(o.id)}"><i class="fas fa-star"></i></button>` : '';
    const checked = state.selectedOrders.has(o.id) ? 'checked' : '';
    return `<tr data-testid="order-row-${escapeHTML(o.id)}" ${state.selectedOrders.has(o.id)?'style="background:#FBECEC;"':''}>
      <td style="text-align:center;"><input type="checkbox" class="order-row-check" data-id="${escapeHTML(o.id)}" ${checked} data-testid="check-order-${escapeHTML(o.id)}" /></td>
      <td><code style="font-size:11px">${escapeHTML(ccId || '#' + String(o.id).substring(0,8))}</code><div style="font-size:10px;color:var(--admin-text-mute);font-family:monospace;">${escapeHTML(o.payment_tracking_id || '')}</div></td>
      <td><div style="font-size:12px;font-weight:600;color:var(--admin-primary);">${escapeHTML(o.invoice_number || '—')}</div></td>
      <td><div style="font-size:12px">${escapeHTML(o.guest_email || o.user_id || '—')}</div><div style="font-size:11px;color:var(--admin-text-mute)">${escapeHTML(o.guest_phone || '')}</div></td>
      <td style="text-align:right;font-weight:600">${fmtINR(o.total_amount)}</td>
      <td>
        <div style="font-weight:600">${qty} item${qty===1?'':'s'}</div>
        <div style="font-size:11px;color:var(--admin-text-mute);margin-top:2px;max-width:180px;">${escapeHTML(items.map(i => { const p=state.products.find(x=>x.id===i.product_id); return p ? p.name : (i.name || 'Product'); }).join(', '))}</div>
      </td>
      <td>
        <select class="select" style="padding:5px 8px;font-size:12px;min-width:130px;" onchange="updateOrderStatus('${escapeHTML(o.id)}', this.value)" data-testid="order-status-${escapeHTML(o.id)}">
          ${['Processing','Paid','Packed','Shipped','Delivered','Cancelled','Failed'].map(s => `<option ${o.status===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </td>
      <td style="font-size:12px;color:var(--admin-text-mute)">${new Date(o.created_at).toLocaleDateString()}</td>
      <td><div class="row-actions">${invLink}${reviewBtn}<button class="icon-btn" onclick="viewOrder('${escapeHTML(o.id)}')" title="View"><i class="fas fa-eye"></i></button><button class="icon-btn danger" onclick="deleteOrder('${escapeHTML(o.id)}')" title="Delete" data-testid="del-order-${escapeHTML(o.id)}"><i class="fas fa-trash"></i></button></div></td>
    </tr>`;
  }).join('');

  // Wire row checkboxes
  document.querySelectorAll('.order-row-check').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = e.target.dataset.id;
      if (e.target.checked) state.selectedOrders.add(id);
      else state.selectedOrders.delete(id);
      updateOrdersBulkBar();
      e.target.closest('tr').style.background = e.target.checked ? '#FBECEC' : '';
    });
  });

  updateOrdersBulkBar();
}
// Update order status + append timestamped status_history entry
async function updateOrderStatus(id, status, opts = {}) {
  const o = state.orders.find(x => x.id === id);
  if (!o) return;
  const now = new Date().toISOString();
  const update = { status };
  const history = Array.isArray(o.status_history) ? [...o.status_history] : [];
  history.push({ status, at: now, by: state.user?.email || 'admin', note: opts.note || null });
  update.status_history = history;

  // Stamp timestamps for major lifecycle events
  if (status === 'Confirmed' && !o.confirmed_at) update.confirmed_at = now;
  if (status === 'Packed'    && !o.packed_at)    update.packed_at    = now;
  if (status === 'Shipped'   && !o.shipped_at)   update.shipped_at   = now;
  if (status === 'Delivered' && !o.delivered_at) update.delivered_at = now;
  if (status === 'Cancelled' && !o.cancelled_at) update.cancelled_at = now;

  const { error } = await supabaseClient.from('orders').update(update).eq('id', id);
  if (error) {
    if (error.message?.includes('status_history') || error.message?.includes('confirmed_at')) {
      return showToast('Run migration_phase1.sql in Supabase first.', 'error');
    }
    return showToast('Update failed: ' + error.message, 'error');
  }
  Object.assign(o, update);
  renderOrders();
  renderDashboard();
  showToast(`Order → ${status}`);
}
window.updateOrderStatus = updateOrderStatus;

// ------------------------- Enhanced Order Detail / Fulfilment View -------------------------
function viewOrder(id) {
  const o = state.orders.find(x => x.id === id);
  if (!o) return;
  let items = [];
  try { items = typeof o.items === 'string' ? JSON.parse(o.items) : (Array.isArray(o.items) ? o.items : (o.items?.items || [])); } catch(e){}
  let ship = {};
  try { ship = typeof o.shipping_address === 'string' ? JSON.parse(o.shipping_address) : (o.shipping_address || {}); } catch(e){}
  const cc = o.ccavenue_order_id || ('#' + String(o.id).substring(0, 8));
  const totalWeight = items.reduce((s, it) => {
    const prod = state.products.find(p => p.id === it.product_id);
    const w = (prod?.weight_grams || 500) * (it.qty || it.quantity || 1);
    return s + w;
  }, 0);

  // Status timeline
  const stages = ['Pending', 'Confirmed', 'Packed', 'Shipped', 'Delivered'];
  const stageTimestamps = {
    'Pending':   o.created_at,
    'Confirmed': o.confirmed_at,
    'Packed':    o.packed_at,
    'Shipped':   o.shipped_at,
    'Delivered': o.delivered_at,
  };
  const currentIdx = stages.indexOf(o.status === 'Paid' ? 'Confirmed' : o.status);
  const cancelled = o.status === 'Cancelled' || o.status === 'Failed';

  const timelineHTML = cancelled
    ? `<div style="background:#FBECEC;border:1px solid #E8C1C1;color:#C0392B;padding:10px 14px;border-radius:6px;font-size:13px;"><strong><i class="fas fa-circle-xmark"></i> Order ${o.status}</strong>${o.cancelled_at ? ' on ' + new Date(o.cancelled_at).toLocaleString() : ''}</div>`
    : `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:4px;margin:14px 0 4px;">
        ${stages.map((st, i) => {
          const done = i <= currentIdx && currentIdx >= 0;
          const ts = stageTimestamps[st];
          return `<div style="flex:1;text-align:center;position:relative;">
            <div style="width:32px;height:32px;border-radius:50%;margin:0 auto;background:${done?'var(--admin-primary)':'#E8E0D2'};color:${done?'#fff':'var(--admin-text-mute)'};display:flex;align-items:center;justify-content:center;font-weight:600;font-size:13px;border:2px solid ${done?'var(--admin-primary)':'#E8E0D2'};">${done?'<i class="fas fa-check"></i>':(i+1)}</div>
            ${i<stages.length-1?`<div style="position:absolute;top:15px;left:calc(50% + 22px);right:calc(-50% + 22px);height:2px;background:${done && i<currentIdx ? 'var(--admin-primary)' : '#E8E0D2'};"></div>`:''}
            <div style="margin-top:6px;font-size:11px;font-weight:${done?'600':'400'};color:${done?'var(--admin-ink)':'var(--admin-text-mute)'};">${st}</div>
            <div style="font-size:9px;color:var(--admin-text-mute);">${ts ? new Date(ts).toLocaleDateString('en-IN',{day:'2-digit',month:'short'}) : ''}</div>
          </div>`;
        }).join('')}
      </div>`;

  // Action buttons based on current status
  const actionBtns = [];
  if (o.status === 'Paid' || o.status === 'Processing') actionBtns.push({ label: 'Confirm Order', status: 'Confirmed', icon: 'fa-circle-check', style: 'btn-primary' });
  if (o.status === 'Confirmed' || o.status === 'Paid') actionBtns.push({ label: 'Mark as Packed', status: 'Packed',   icon: 'fa-box',         style: 'btn-primary' });
  if (o.status === 'Packed')                          actionBtns.push({ label: 'Mark as Shipped', status: 'Shipped',  icon: 'fa-truck',       style: 'btn-primary' });
  if (o.status === 'Shipped')                         actionBtns.push({ label: 'Mark Delivered', status: 'Delivered', icon: 'fa-circle-check', style: 'btn-primary' });
  if (!['Cancelled','Delivered','Failed'].includes(o.status)) actionBtns.push({ label: 'Cancel', status: 'Cancelled', icon: 'fa-circle-xmark', style: 'btn-danger' });

  const invLink = cc ? `<a href="thank-you.html?status=success&order_id=${encodeURIComponent(o.ccavenue_order_id||'')}&tracking_id=${encodeURIComponent(o.payment_tracking_id||'')}&amount=${encodeURIComponent(o.total_amount||'')}" target="_blank" class="btn btn-secondary btn-sm"><i class="fas fa-file-invoice"></i> View / Print Invoice</a>` : '';

  const body = `
    <!-- TOP STATUS BAR -->
    ${timelineHTML}

    <!-- ACTION BAR -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:18px 0 22px;padding-top:14px;border-top:1px solid var(--admin-border);">
      ${actionBtns.map(b => `<button class="btn ${b.style} btn-sm" data-status-action="${b.status}" data-testid="ov-action-${b.status.toLowerCase()}"><i class="fas ${b.icon}"></i> ${b.label}</button>`).join('')}
      ${invLink}
    </div>

    <div class="grid-2" style="gap:18px;">
      <!-- CUSTOMER -->
      <div style="background:var(--admin-muted);padding:14px 16px;border-radius:8px;">
        <h4 style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:1.2px;color:var(--admin-text-mute);">Customer</h4>
        <div style="font-size:14px;font-weight:600;color:var(--admin-ink);">${escapeHTML(ship.name || '—')}</div>
        <div style="font-size:13px;color:var(--admin-text-soft);margin-top:4px;">
          <div><i class="fas fa-envelope" style="width:14px;color:var(--admin-text-mute);"></i> ${escapeHTML(o.guest_email || ship.email || '—')}</div>
          <div><i class="fas fa-phone" style="width:14px;color:var(--admin-text-mute);"></i> ${escapeHTML(o.guest_phone || ship.phone || '—')}</div>
        </div>
      </div>

      <!-- PAYMENT -->
      <div style="background:var(--admin-muted);padding:14px 16px;border-radius:8px;">
        <h4 style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:1.2px;color:var(--admin-text-mute);">Payment</h4>
        <div style="font-size:14px;font-weight:600;color:var(--admin-ink);">${fmtINR(o.total_amount)} <span style="font-weight:400;font-size:11px;color:#1E5631;">· ${escapeHTML(o.payment_status || 'Pending')}</span></div>
        <div style="font-size:12px;color:var(--admin-text-soft);margin-top:4px;font-family:monospace;">
          <div>Order: ${escapeHTML(cc)}</div>
          <div>Track ID: ${escapeHTML(o.payment_tracking_id || '—')}</div>
          <div>Invoice: <strong style="color:var(--admin-primary);">${escapeHTML(o.invoice_number || '—')}</strong></div>
        </div>
      </div>

      <!-- SHIPPING ADDRESS -->
      <div style="background:var(--admin-muted);padding:14px 16px;border-radius:8px;grid-column:1/-1;">
        <h4 style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:1.2px;color:var(--admin-text-mute);">Ship To</h4>
        <div style="font-size:13px;color:var(--admin-text-soft);line-height:1.5;">
          ${escapeHTML(ship.name||'')}<br>
          ${escapeHTML(ship.address||'—')}<br>
          ${escapeHTML([ship.city, ship.state, ship.zip].filter(Boolean).join(', '))}<br>
          ${escapeHTML(ship.country||'India')} · <i class="fas fa-phone"></i> ${escapeHTML(ship.phone||'')}
        </div>
      </div>
    </div>

    <!-- SHIPPING / LOGISTICS -->
    <h4 class="card-title" style="margin:18px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:1.2px;color:var(--admin-text-mute);">Logistics</h4>
    <div class="grid-2" style="gap:14px;">
      <div class="field"><label>Courier Partner</label><div><strong>${escapeHTML(o.courier_partner || 'Delhivery')}</strong> ${o.awb_number ? '· <span style="color:#1E5631;font-size:12px;"><i class="fas fa-check-circle"></i> AWB generated</span>' : '<span style="color:var(--admin-text-mute);font-size:11px;">(click below to generate AWB)</span>'}</div></div>
      <div class="field"><label>AWB / Tracking Number</label><div>${o.awb_number ? `<code style="font-size:13px;">${escapeHTML(o.awb_number)}</code> · <a href="${escapeHTML(o.tracking_url||'#')}" target="_blank" style="color:var(--admin-primary);font-size:12px;">Track →</a>` : '<span style="color:var(--admin-text-mute);font-size:12px;">Not yet generated</span>'}</div></div>
      <div class="field"><label>Total Shipment Weight</label><div><strong>${totalWeight} g</strong> (${(totalWeight/1000).toFixed(2)} kg)</div></div>
      <div class="field"><label>Internal Notes</label><textarea id="ov-notes" class="input" rows="2" data-testid="ov-notes" placeholder="e.g. Customer requested gift wrapping">${escapeHTML(o.internal_notes||'')}</textarea></div>
    </div>

    <!-- DELHIVERY ACTIONS -->
    <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">
      ${o.awb_number
        ? `<a class="btn btn-secondary btn-sm" href="/api/delhivery/label?awb=${encodeURIComponent(o.awb_number)}" target="_blank" data-testid="ov-print-label"><i class="fas fa-print"></i> Print Shipping Label</a>
           <a class="btn btn-secondary btn-sm" href="${escapeHTML(o.tracking_url||'#')}" target="_blank" data-testid="ov-track"><i class="fas fa-truck-fast"></i> Track Shipment</a>`
        : (['Paid','Confirmed','Packed'].includes(o.status) ? `<button class="btn btn-primary btn-sm" id="ov-gen-awb" data-testid="ov-gen-awb"><i class="fas fa-truck"></i> Generate Delhivery AWB</button>` : '')}
      <button class="btn btn-secondary btn-sm" id="ov-schedule-pickup" data-testid="ov-pickup"><i class="fas fa-calendar-day"></i> Schedule Pickup</button>
    </div>

    <!-- ITEMS -->
    <h4 class="card-title" style="margin:18px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:1.2px;color:var(--admin-text-mute);">Items (${items.length})</h4>
    <table class="data">
      <thead><tr><th style="width:50px"></th><th>Product</th><th>SKU</th><th>HSN</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Subtotal</th></tr></thead>
      <tbody>
        ${items.map(it => {
          const prod = state.products.find(p => p.id === it.product_id);
          const qty = it.qty || it.quantity || 1;
          const price = Number(it.price || 0);
          const img = prod?.image_url || (Array.isArray(prod?.image_urls) && prod.image_urls[0]) || null;
          return `<tr>
            <td>${img ? `<img src="${escapeHTML(img)}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;border:1px solid var(--admin-border);" onerror="this.style.display='none'" />` : '<i class="fas fa-image" style="color:var(--admin-text-mute);"></i>'}</td>
            <td><div style="font-weight:500;font-size:13px;">${escapeHTML(it.name || it.product_id || '—')}</div>${prod?.weight_grams ? `<div style="font-size:11px;color:var(--admin-text-mute);">${prod.weight_grams}g per unit</div>`:''}</td>
            <td><code style="font-size:11px;">${escapeHTML(prod?.sku || '—')}</code></td>
            <td style="font-size:12px;">${escapeHTML(prod?.hsn_code || '—')}</td>
            <td style="text-align:right;font-weight:500;">${qty}</td>
            <td style="text-align:right;">${fmtINR(price)}</td>
            <td style="text-align:right;font-weight:600;">${fmtINR(price * qty)}</td>
          </tr>`;
        }).join('')}
      </tbody>
      <tfoot>
        <tr><td colspan="6" style="text-align:right">Subtotal</td><td style="text-align:right">${fmtINR(o.items_subtotal || o.total_amount)}</td></tr>
        ${o.shipping_amount ? `<tr><td colspan="6" style="text-align:right">Shipping</td><td style="text-align:right">${fmtINR(o.shipping_amount)}</td></tr>` : ''}
        ${o.discount_amount ? `<tr><td colspan="6" style="text-align:right;color:#2E7D32;">Discount</td><td style="text-align:right;color:#2E7D32;">− ${fmtINR(o.discount_amount)}</td></tr>` : ''}
        <tr><td colspan="6" style="text-align:right;font-weight:700;border-top:2px solid var(--admin-border);">Total</td><td style="text-align:right;font-weight:700;color:var(--admin-primary);border-top:2px solid var(--admin-border);">${fmtINR(o.total_amount)}</td></tr>
      </tfoot>
    </table>

    <!-- STATUS HISTORY -->
    ${Array.isArray(o.status_history) && o.status_history.length ? `
      <h4 class="card-title" style="margin:18px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:1.2px;color:var(--admin-text-mute);">Status History</h4>
      <div style="background:var(--admin-muted);border-radius:6px;padding:10px 14px;font-size:12px;max-height:160px;overflow-y:auto;">
        ${o.status_history.slice().reverse().map(h => `<div style="padding:4px 0;border-bottom:1px solid var(--admin-border);"><strong>${escapeHTML(h.status)}</strong> · <span style="color:var(--admin-text-mute);">${new Date(h.at).toLocaleString('en-IN')}</span> by ${escapeHTML(h.by||'system')}${h.note?` · <em>${escapeHTML(h.note)}</em>`:''}</div>`).join('')}
      </div>` : ''}
  `;

  const footer = el('div', {});
  footer.innerHTML = `<button class="btn btn-secondary" id="ov-close" data-testid="ov-close">Close</button><button class="btn btn-primary" id="ov-save-notes" data-testid="ov-save-notes"><i class="fas fa-save"></i> Save Notes</button>`;
  const m = openModal({ title: `Order ${cc}`, body, footer, size: 'lg', testid: 'order-view' });
  $('ov-close').onclick = () => m.close();
  $('ov-save-notes').onclick = async () => {
    const notes = $('ov-notes').value.trim();
    const { error } = await supabaseClient.from('orders').update({ internal_notes: notes }).eq('id', o.id);
    if (error) return showToast('Save failed: ' + error.message, 'error');
    o.internal_notes = notes;
    showToast('Notes saved.');
  };

  // Generate AWB
  const awbBtn = $('ov-gen-awb');
  if (awbBtn) awbBtn.onclick = async () => {
    const dimHtml = `
      <div id="dim-modal" class="modal" style="display:flex;z-index:9999;">
        <div class="modal-content" style="max-width:400px;background:#fff;border-radius:8px;padding:24px;">
          <h3 style="margin-top:0;color:var(--burgundy);"><i class="fas fa-box"></i> Package Dimensions</h3>
          <p style="font-size:13px;color:var(--admin-text-mute);margin-bottom:16px;">Please confirm the final package details.</p>
          <div class="field" style="margin-bottom:12px;"><label style="font-size:12px;font-weight:600;">Weight (grams)</label><input id="dim-w" type="number" class="input" value="500"></div>
          <div style="display:flex;gap:10px;margin-bottom:16px;">
            <div class="field"><label style="font-size:12px;font-weight:600;">Length (cm)</label><input id="dim-l" type="number" class="input" value="10"></div>
            <div class="field"><label style="font-size:12px;font-weight:600;">Breadth (cm)</label><input id="dim-b" type="number" class="input" value="10"></div>
            <div class="field"><label style="font-size:12px;font-weight:600;">Height (cm)</label><input id="dim-h" type="number" class="input" value="10"></div>
          </div>
          <div style="display:flex;gap:12px;justify-content:flex-end;">
            <button class="btn btn-secondary" onclick="document.getElementById('dim-modal').remove()">Cancel</button>
            <button class="btn btn-primary" id="dim-confirm"><i class="fas fa-truck"></i> Confirm & Generate AWB</button>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', dimHtml);

    $('dim-confirm').onclick = async () => {
      const weight = parseInt($('dim-w').value) || 500;
      const length = parseInt($('dim-l').value) || 10;
      const breadth = parseInt($('dim-b').value) || 10;
      const height = parseInt($('dim-h').value) || 10;
      $('dim-modal').remove();

      const key = localStorage.getItem('oncost_recover_key') || prompt('Enter your ADMIN_RECOVERY_KEY (from Vercel env):');
      if (!key) return;

      awbBtn.disabled = true; awbBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Calling Delhivery…';
      try {
        const r = await fetch('/api/delhivery/create-shipment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-key': key },
          body: JSON.stringify({ 
            order_id: o.id,
            weight_grams: weight,
            length_cm: length,
            breadth_cm: breadth,
            height_cm: height
          }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'AWB creation failed');
        localStorage.setItem('oncost_recover_key', key);
        o.awb_number = j.awb;
        o.tracking_url = j.tracking_url;
        showToast(`AWB generated: ${j.awb}`);
        m.close();
        viewOrder(o.id);
        loadOrders().then(() => renderOrders());
      } catch (err) {
        showToast(err.message, 'error');
        awbBtn.disabled = false; awbBtn.innerHTML = '<i class="fas fa-truck"></i> Generate Delhivery AWB';
      }
    };
  };

  // Schedule pickup
  const pickupBtn = $('ov-schedule-pickup');
  if (pickupBtn) pickupBtn.onclick = async () => {
    const today = new Date();
    today.setDate(today.getDate() + 1);
    const tomorrow = today.toISOString().split('T')[0];
    const date = prompt('Schedule pickup for date (YYYY-MM-DD):', tomorrow);
    if (!date) return;
    const key = localStorage.getItem('oncost_recover_key') || prompt('Enter your ADMIN_RECOVERY_KEY:');
    if (!key) return;
    try {
      const r = await fetch('/api/delhivery/schedule-pickup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': key },
        body: JSON.stringify({ pickup_date: date, expected_package_count: 1 }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Pickup scheduling failed');
      showToast(`Pickup scheduled for ${date} (ref ${j.pickup_id || 'OK'})`);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };
  // Wire action buttons
  m.root.querySelectorAll('[data-status-action]').forEach(btn => {
    btn.onclick = async () => {
      const newStatus = btn.dataset.statusAction;
      if (newStatus === 'Cancelled') {
        if (!await confirmDialog(`Cancel order ${cc}? This cannot be undone.`, { confirmLabel: 'Yes, cancel', danger: true })) return;
      }
      await updateOrderStatus(o.id, newStatus);
      m.close();
      viewOrder(o.id);  // reopen with new state
    };
  });
}
window.viewOrder = viewOrder;

window.createDelhiveryShipment = async function(id) {
  const btn = document.getElementById(`btn-delhivery-${id}`);
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Generating...'; }
  
  let savedKey = localStorage.getItem('oncost_recover_key') || '';
  if (!savedKey) {
    savedKey = prompt('Please enter the Admin Recovery Key (found in Vercel environment variables) to authorize Delhivery shipment creation:');
    if (!savedKey) {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-truck"></i> Auto-Generate via Delhivery'; }
      return;
    }
    localStorage.setItem('oncost_recover_key', savedKey);
  }

  try {
    const r = await fetch('/api/admin/create-delhivery-shipment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': savedKey },
      body: JSON.stringify({ order_id: id })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Server error');
    
    showToast(`Shipment created! AWB: ${j.awb}`);
    const o = state.orders.find(x => x.id === id);
    if (o) {
      if (!o.shipping_address) o.shipping_address = {};
      o.shipping_address.tracking_url = j.tracking_url;
      o.status = 'Packed';
    }
    renderOrders();
    // close modal if open
    document.getElementById('ov-close')?.click();
  } catch(err) {
    showToast(err.message, 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-truck"></i> Auto-Generate via Delhivery'; }
  }
};

window.saveTrackingUrl = async function(id) {
  const o = state.orders.find(x => x.id === id); if (!o) return;
  const url = document.getElementById('ov-tracking-url').value.trim();
  const ship = o.shipping_address || {};
  ship.tracking_url = url || null;
  const { error } = await supabaseClient.from('orders').update({ shipping_address: ship }).eq('id', id);
  if (error) return showToast('Failed to save tracking: ' + error.message, 'error');
  o.shipping_address = ship;
  showToast('Tracking URL saved.');
  renderOrders();
};

// ------------------------- Order Delete + Bulk Actions -------------------------
async function deleteOrder(id) {
  const o = state.orders.find(x => x.id === id);
  if (!o) return;
  const label = o.ccavenue_order_id || ('#' + String(o.id).substring(0, 8));
  if (!await confirmDialog(`Permanently delete order ${label}? This cannot be undone.`, { confirmLabel: 'Delete', danger: true })) return;
  const { error } = await supabaseClient.from('orders').delete().eq('id', id);
  if (error) return showToast('Delete failed: ' + error.message, 'error');
  state.orders = state.orders.filter(x => x.id !== id);
  state.selectedOrders.delete(id);
  renderOrders();
  renderDashboard();
  showToast('Order deleted.');
}
window.deleteOrder = deleteOrder;

function updateOrdersBulkBar() {
  const bar = $('orders-bulk-bar');
  const count = state.selectedOrders.size;
  if (!bar) return;
  if (count === 0) { bar.style.display = 'none'; }
  else {
    bar.style.display = 'flex';
    $('orders-bulk-count').textContent = `${count} selected`;
  }
  const all = $('orders-check-all');
  if (all) {
    const visible = (state.orders || []).filter(o => {
      const q = ($('orders-search').value || '').toLowerCase().trim();
      const st = $('orders-status-filter').value;
      if (st && o.status !== st) return false;
      if (q) { const hay = `${o.id} ${o.ccavenue_order_id||''} ${o.guest_email||''} ${o.guest_phone||''}`.toLowerCase(); if (!hay.includes(q)) return false; }
      return true;
    });
    const allSel = visible.length > 0 && visible.every(o => state.selectedOrders.has(o.id));
    all.checked = allSel;
    all.indeterminate = !allSel && visible.some(o => state.selectedOrders.has(o.id));
  }
}
function clearOrderSelection() {
  state.selectedOrders.clear();
  renderOrders();
}
window.clearOrderSelection = clearOrderSelection;

async function bulkOrderDelete() {
  const ids = Array.from(state.selectedOrders);
  if (!ids.length) return;
  if (!await confirmDialog(`Permanently delete ${ids.length} order${ids.length>1?'s':''}? This cannot be undone. Customer payment data will be lost.`, { confirmLabel: `Delete ${ids.length}`, danger: true })) return;
  const { error } = await supabaseClient.from('orders').delete().in('id', ids);
  if (error) return showToast('Delete failed: ' + error.message, 'error');
  state.orders = state.orders.filter(o => !state.selectedOrders.has(o.id));
  state.selectedOrders.clear();
  renderOrders();
  renderDashboard();
  showToast(`${ids.length} order${ids.length>1?'s':''} deleted.`);
}
window.bulkOrderDelete = bulkOrderDelete;

async function bulkOrderDeleteByStatus(status) {
  const candidates = state.orders.filter(o => o.status === status);
  if (!candidates.length) return showToast(`No ${status} orders to delete.`, '');
  if (!await confirmDialog(`Permanently delete ALL ${candidates.length} ${status} order${candidates.length>1?'s':''}? This is typically done to clear out test/abandoned orders before going live.`, { confirmLabel: `Delete ${candidates.length}`, danger: true })) return;
  const ids = candidates.map(c => c.id);
  const { error } = await supabaseClient.from('orders').delete().in('id', ids);
  if (error) return showToast('Delete failed: ' + error.message, 'error');
  state.orders = state.orders.filter(o => o.status !== status);
  ids.forEach(id => state.selectedOrders.delete(id));
  renderOrders();
  renderDashboard();
  showToast(`${candidates.length} ${status} order${candidates.length>1?'s':''} cleared.`);
}
window.bulkOrderDeleteByStatus = bulkOrderDeleteByStatus;

// ------------------------- Recover Missed Order -------------------------
// Used to backfill orders that succeeded on CCAvenue but never reached Supabase
// (e.g. webhook ran before schema migration). Stores the admin recovery key in
// localStorage so admin doesn't have to retype it every time.
function openRecoverOrderForm() {
  const savedKey = localStorage.getItem('oncost_recover_key') || '';
  const html = `
    <div style="background:#FFF3E0;border:1px solid #E6B580;color:#7A4310;padding:12px 14px;border-radius:6px;margin-bottom:14px;font-size:13px;">
      <strong><i class="fas fa-life-ring"></i> Use this when a CCAvenue order doesn't show up here automatically.</strong><br>
      Copy details from your <a href="https://login.ccavenue.com" target="_blank" style="color:#7A4310;font-weight:600;">CCAvenue dashboard → Order Lookup</a>.
    </div>
    <div class="grid-2">
      <div class="field"><label>Order ID (from CCAvenue) *</label><input class="input" id="rc-order-id" data-testid="rc-order-id" placeholder="OC-1781110752895-6373" required /></div>
      <div class="field"><label>Tracking / Ref. # *</label><input class="input" id="rc-tracking-id" data-testid="rc-tracking-id" placeholder="114571273239" /></div>
      <div class="field"><label>Amount (INR) *</label><input class="input" id="rc-amount" type="number" step="0.01" data-testid="rc-amount" placeholder="139.00" required /></div>
      <div class="field"><label>Status</label>
        <select class="select" id="rc-status" data-testid="rc-status">
          <option value="Paid" selected>Paid</option>
          <option value="Failed">Failed</option>
          <option value="Cancelled">Cancelled</option>
        </select>
      </div>
      <div class="field"><label>Customer Email</label><input class="input" id="rc-email" type="email" data-testid="rc-email" /></div>
      <div class="field"><label>Customer Phone</label><input class="input" id="rc-phone" data-testid="rc-phone" /></div>
      <div class="field" style="grid-column:1/-1"><label>Customer Name</label><input class="input" id="rc-name" data-testid="rc-name" /></div>
      <div class="field" style="grid-column:1/-1"><label>Shipping Address</label><textarea class="input" id="rc-address" rows="2" data-testid="rc-address" placeholder="Full address"></textarea></div>
      <div class="field" style="grid-column:1/-1"><label>Notes</label><input class="input" id="rc-notes" data-testid="rc-notes" placeholder="Any context (e.g. 'CCAvenue test on 10 Jun 2026')" /></div>
      <div class="field" style="grid-column:1/-1">
        <label>Admin Recovery Key <span style="font-weight:400;color:var(--admin-text-mute);font-size:11px;">(from Vercel env var <code>ADMIN_RECOVERY_KEY</code>, saved locally after first use)</span></label>
        <input class="input" id="rc-key" type="password" data-testid="rc-key" value="${escapeHTML(savedKey)}" placeholder="Paste your ADMIN_RECOVERY_KEY" required />
      </div>
    </div>`;
  const footer = el('div', {});
  footer.innerHTML = `<button class="btn btn-secondary" id="rc-cancel" data-testid="rc-cancel">Cancel</button><button class="btn btn-primary" id="rc-save" data-testid="rc-save"><i class="fas fa-life-ring"></i> Recover Order</button>`;
  const m = openModal({ title: 'Recover Missed Order', body: html, footer, size: 'lg', testid: 'recover-order' });
  $('rc-cancel').onclick = () => m.close();
  $('rc-save').onclick = async () => {
    const orderId = $('rc-order-id').value.trim();
    const amount  = Number($('rc-amount').value);
    const key     = $('rc-key').value.trim();
    if (!orderId)  return showToast('Order ID required.', 'error');
    if (!amount)   return showToast('Amount required.', 'error');
    if (!key)      return showToast('Admin recovery key required.', 'error');

    const payload = {
      order_id: orderId,
      tracking_id: $('rc-tracking-id').value.trim(),
      amount,
      status: $('rc-status').value,
      guest_email: $('rc-email').value.trim() || null,
      guest_phone: $('rc-phone').value.trim() || null,
      shipping_address: {
        name:    $('rc-name').value.trim(),
        email:   $('rc-email').value.trim(),
        phone:   $('rc-phone').value.trim(),
        address: $('rc-address').value.trim(),
      },
      notes: $('rc-notes').value.trim(),
    };
    $('rc-save').disabled = true;
    $('rc-save').innerHTML = '<i class="fas fa-spinner fa-spin"></i> Recovering…';
    try {
      const r = await fetch('/api/admin/recover-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': key },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
      localStorage.setItem('oncost_recover_key', key);   // remember for next time
      showToast('Order recovered. Refreshing list…');
      m.close();
      await loadOrders();
      renderOrders();
      renderDashboard();
    } catch (err) {
      showToast('Recovery failed: ' + err.message, 'error');
      $('rc-save').disabled = false;
      $('rc-save').innerHTML = '<i class="fas fa-life-ring"></i> Recover Order';
    }
  };
}
window.openRecoverOrderForm = openRecoverOrderForm;

// ------------------------- Coupons -------------------------
async function loadCoupons() {
  const { data } = await supabaseClient.from('coupons').select('*').order('created_at', { ascending: false });
  state.coupons = data || [];
}
function renderCoupons() {
  const tbody = $('coupons-tbody');
  if (!state.coupons.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty"><div class="ic"><i class="fas fa-tags"></i></div><h4>No coupons yet</h4><p>Create your first discount code.</p><button class="btn btn-primary" onclick="openCouponForm()"><i class="fas fa-plus"></i> Add coupon</button></div></td></tr>`;
    return;
  }
  tbody.innerHTML = state.coupons.map(c => {
    const disc = c.discount_type === 'percent' ? `${c.discount_value}%` : fmtINR(c.discount_value);
    return `<tr data-testid="coupon-row-${escapeHTML(c.id)}">
      <td><code style="font-weight:600;font-size:13px;background:var(--admin-muted);padding:2px 8px;border-radius:4px;">${escapeHTML(c.code)}</code></td>
      <td><span class="badge b-gold">${disc} off</span></td>
      <td>${fmtINR(c.min_order_amount || 0)}</td>
      <td>${c.used_count || 0}${c.usage_limit ? ' / '+c.usage_limit : ''}</td>
      <td style="font-size:12px;color:var(--admin-text-mute)">${c.expires_at ? new Date(c.expires_at).toLocaleDateString() : 'No expiry'}</td>
      <td><div class="row-actions">
        <button class="icon-btn" onclick="openCouponForm('${escapeHTML(c.id)}')" title="Edit"><i class="fas fa-pen"></i></button>
        <button class="icon-btn danger" onclick="deleteCoupon('${escapeHTML(c.id)}')" title="Delete"><i class="fas fa-trash"></i></button>
      </div></td>
    </tr>`;
  }).join('');
}
function openCouponForm(id) {
  const c = id ? state.coupons.find(x => x.id === id) : null;
  const isEdit = !!c;
  const html = `
    <div class="grid-2">
      <div class="field" style="grid-column:1/-1"><label>Code *</label><input class="input" id="co-code" required style="text-transform:uppercase;" data-testid="co-code" value="${escapeHTML(c?.code||'')}" placeholder="FESTIVE10" /></div>
      <div class="field"><label>Discount Type</label>
        <select class="select" id="co-discount_type" data-testid="co-type">
          <option value="percent" ${c?.discount_type==='percent'?'selected':''}>Percent (%)</option>
          <option value="flat" ${c?.discount_type==='flat'?'selected':''}>Flat (₹)</option>
        </select></div>
      <div class="field"><label>Discount Value *</label><input class="input" id="co-discount_value" type="number" min="0" step="0.01" required data-testid="co-value" value="${c?.discount_value ?? ''}" /></div>
      <div class="field"><label>Minimum Order (₹)</label><input class="input" id="co-min_order_amount" type="number" min="0" data-testid="co-min" value="${c?.min_order_amount ?? 0}" /></div>
      <div class="field"><label>Usage Limit (blank = unlimited)</label><input class="input" id="co-usage_limit" type="number" min="0" data-testid="co-limit" value="${c?.usage_limit ?? ''}" /></div>
      <div class="field" style="grid-column:1/-1"><label>Expires At</label><input class="input" id="co-expires_at" type="datetime-local" data-testid="co-expires" value="${c?.expires_at ? new Date(c.expires_at).toISOString().slice(0,16) : ''}" /></div>
    </div>`;
  const footer = el('div', {});
  footer.innerHTML = `<button class="btn btn-secondary" id="co-cancel" data-testid="co-cancel">Cancel</button><button class="btn btn-primary" id="co-save" data-testid="co-save"><i class="fas fa-save"></i> ${isEdit?'Save':'Create'}</button>`;
  const m = openModal({ title: isEdit ? 'Edit Coupon' : 'New Coupon', body: html, footer, testid: 'co' });
  $('co-cancel').onclick = () => m.close();
  $('co-save').onclick = async () => {
    const code = $('co-code').value.trim().toUpperCase();
    if (!code) return showToast('Code required.', 'error');
    const payload = {
      code,
      discount_type: $('co-discount_type').value,
      discount_value: Number($('co-discount_value').value) || 0,
      min_order_amount: Number($('co-min_order_amount').value) || 0,
      usage_limit: $('co-usage_limit').value ? Number($('co-usage_limit').value) : null,
      expires_at: $('co-expires_at').value ? new Date($('co-expires_at').value).toISOString() : null,
    };
    let res;
    if (isEdit) res = await supabaseClient.from('coupons').update(payload).eq('id', c.id).select().single();
    else res = await supabaseClient.from('coupons').insert(payload).select().single();
    if (res.error) return showToast('Save failed: ' + res.error.message, 'error');
    if (isEdit) state.coupons = state.coupons.map(x => x.id === c.id ? res.data : x);
    else state.coupons.unshift(res.data);
    renderCoupons();
    showToast('Coupon saved.');
    m.close();
  };
}
window.openCouponForm = openCouponForm;
async function deleteCoupon(id) {
  if (!await confirmDialog('Delete this coupon?', { confirmLabel: 'Delete', danger: true })) return;
  const { error } = await supabaseClient.from('coupons').delete().eq('id', id);
  if (error) return showToast('Delete failed: ' + error.message, 'error');
  state.coupons = state.coupons.filter(x => x.id !== id);
  renderCoupons();
  showToast('Coupon deleted.');
}
window.deleteCoupon = deleteCoupon;

// ------------------------- Sale Events -------------------------
async function loadSales() {
  const { data } = await supabaseClient.from('sale_events').select('*').order('start_date', { ascending: false });
  state.sales = data || [];
}
function renderSales() {
  const tbody = $('sales-tbody');
  if (!state.sales.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty"><div class="ic"><i class="fas fa-bullhorn"></i></div><h4>No sale events yet</h4><p>Schedule your first promotion: Diwali Sale, Festival of Brass…</p><button class="btn btn-primary" onclick="openSaleForm()"><i class="fas fa-plus"></i> Add sale event</button></div></td></tr>`;
    return;
  }
  tbody.innerHTML = state.sales.map(s => `
    <tr data-testid="sale-row-${escapeHTML(s.id)}">
      <td style="font-weight:600">${escapeHTML(s.name)}</td>
      <td style="font-size:12px;color:var(--admin-text-mute)">${escapeHTML(s.banner_text||'—')}</td>
      <td><span class="badge b-maroon">${s.discount_percent}%</span></td>
      <td style="font-size:12px">${new Date(s.start_date).toLocaleDateString()}</td>
      <td style="font-size:12px">${new Date(s.end_date).toLocaleDateString()}</td>
      <td>${s.is_active ? statusBadge('Live') : statusBadge('Inactive')}</td>
      <td><div class="row-actions">
        <button class="icon-btn" onclick="openSaleForm('${escapeHTML(s.id)}')" title="Edit"><i class="fas fa-pen"></i></button>
        <button class="icon-btn danger" onclick="deleteSale('${escapeHTML(s.id)}')" title="Delete"><i class="fas fa-trash"></i></button>
      </div></td>
    </tr>`).join('');
}
function openSaleForm(id) {
  const s = id ? state.sales.find(x => x.id === id) : null;
  const isEdit = !!s;
  const today = new Date().toISOString().slice(0,10);
  const wk = new Date(Date.now() + 7*86400000).toISOString().slice(0,10);
  const html = `
    <div class="grid-2">
      <div class="field" style="grid-column:1/-1"><label>Event Name *</label><input class="input" id="se-name" required data-testid="se-name" value="${escapeHTML(s?.name||'')}" placeholder="Diwali Brass Festival" /></div>
      <div class="field" style="grid-column:1/-1"><label>Banner Text *</label><input class="input" id="se-banner_text" required data-testid="se-banner" value="${escapeHTML(s?.banner_text||'')}" placeholder="🪔 Diwali Sale: Flat 20% off on Brass!" /></div>
      <div class="field"><label>Discount %</label><input class="input" id="se-discount_percent" type="number" min="0" max="100" data-testid="se-discount" value="${s?.discount_percent ?? 10}" /></div>
      <div class="field"><label>Active</label>
        <select class="select" id="se-is_active" data-testid="se-active">
          <option value="true" ${s?.is_active!==false?'selected':''}>Live</option>
          <option value="false" ${s?.is_active===false?'selected':''}>Inactive</option>
        </select></div>
      <div class="field"><label>Start Date</label><input class="input" id="se-start_date" type="date" data-testid="se-start" value="${s?.start_date ? new Date(s.start_date).toISOString().slice(0,10) : today}" /></div>
      <div class="field"><label>End Date</label><input class="input" id="se-end_date" type="date" data-testid="se-end" value="${s?.end_date ? new Date(s.end_date).toISOString().slice(0,10) : wk}" /></div>
    </div>`;
  const footer = el('div', {});
  footer.innerHTML = `<button class="btn btn-secondary" id="se-cancel" data-testid="se-cancel">Cancel</button><button class="btn btn-primary" id="se-save" data-testid="se-save"><i class="fas fa-save"></i> ${isEdit?'Save':'Create'}</button>`;
  const m = openModal({ title: isEdit ? 'Edit Sale Event' : 'New Sale Event', body: html, footer, testid: 'se' });
  $('se-cancel').onclick = () => m.close();
  $('se-save').onclick = async () => {
    const name = $('se-name').value.trim();
    const banner = $('se-banner_text').value.trim();
    if (!name || !banner) return showToast('Name and banner required.', 'error');
    const payload = {
      name, banner_text: banner,
      discount_percent: Number($('se-discount_percent').value) || 0,
      start_date: new Date($('se-start_date').value).toISOString(),
      end_date: new Date($('se-end_date').value).toISOString(),
      is_active: $('se-is_active').value === 'true',
    };
    let res;
    if (isEdit) res = await supabaseClient.from('sale_events').update(payload).eq('id', s.id).select().single();
    else res = await supabaseClient.from('sale_events').insert(payload).select().single();
    if (res.error) return showToast('Save failed: ' + res.error.message, 'error');
    if (isEdit) state.sales = state.sales.map(x => x.id === s.id ? res.data : x);
    else state.sales.unshift(res.data);
    renderSales();
    renderDashboard();
    showToast('Sale event saved.');
    m.close();
  };
}
window.openSaleForm = openSaleForm;
async function deleteSale(id) {
  if (!await confirmDialog('Delete this sale event?', { confirmLabel: 'Delete', danger: true })) return;
  const { error } = await supabaseClient.from('sale_events').delete().eq('id', id);
  if (error) return showToast('Delete failed: ' + error.message, 'error');
  state.sales = state.sales.filter(x => x.id !== id);
  renderSales();
  showToast('Sale event deleted.');
}
window.deleteSale = deleteSale;

// ------------------------- Leads -------------------------
async function loadLeads() {
  const { data } = await supabaseClient.from('leads').select('*').order('created_at', { ascending: false });
  state.leads = data || [];
}
function parseLeadSummary(summary) {
  if (!summary) return {};
  // Try JSON parse first
  if (summary.trim().startsWith('{')) {
    try { return JSON.parse(summary); } catch { /* fall through */ }
  }
  // Parse pipe-separated "Name: X | Email: Y | Phone: Z..."
  const out = {};
  summary.split('|').forEach(part => {
    const m = part.match(/^\s*([^:]+):\s*(.*)$/);
    if (m) out[m[1].trim()] = m[2].trim();
  });
  return out;
}

function renderLeads() {
  const tbody = $('leads-tbody');
  if (!state.leads.length) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty"><div class="ic"><i class="fas fa-envelope"></i></div><h4>No enquiries yet</h4><p>Customer enquiries from the storefront will appear here.</p></div></td></tr>`;
    return;
  }
  const statusColor = { 'New':'#1E88E5', 'Contacted':'#7A4310', 'Discussed':'#7A4310', 'Accepted':'#1E5631', 'Converted':'#1E5631', 'Not Converted':'#C0392B', 'Lost':'#C0392B' };
  tbody.innerHTML = state.leads.map(l => {
    const d = parseLeadSummary(l.summary || '');
    const status = l.status || 'New';
    const color = statusColor[status] || '#7A726B';
    return `<tr data-testid="lead-row-${escapeHTML(l.id)}">
      <td style="font-size:12px;">${new Date(l.created_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'2-digit'})}</td>
      <td><div style="font-weight:500;">${escapeHTML(d.Name || d.name || '—')}</div></td>
      <td><div style="font-size:12px;">${escapeHTML(d.Email || d.email || '—')}</div><div style="font-size:11px;color:var(--admin-text-mute);">${escapeHTML(d.Phone || d.phone || '')}</div></td>
      <td style="font-size:12px;">${escapeHTML(d.Event || d.event || '—')}</td>
      <td style="font-size:12px;text-align:right;">${escapeHTML(d.Qty || d.qty || '—')}</td>
      <td style="font-size:12px;text-align:right;">${d.Budget||d.budget ? '₹'+escapeHTML(d.Budget || d.budget) : '—'}</td>
      <td style="max-width:240px;font-size:12px;color:var(--admin-text-soft);">${escapeHTML((d.Message || d.message || '').substring(0,80))}${(d.Message||d.message||'').length>80?'…':''}</td>
      <td>
        <select class="select" style="font-size:11px; padding:3px 6px; width:110px; background:${color}20; color:${color}; font-weight:600; border:1px solid ${color}40;" onchange="updateLeadInline('${escapeHTML(l.id)}', this.value)">
          ${['New','Contacted','Discussed','Quoted','Accepted','Converted','Not Converted','Lost'].map(s => `<option value="${s}" ${status===s?'selected':''} style="color:#000;background:#fff;">${s}</option>`).join('')}
        </select>
      </td>
      <td><div class="row-actions">
        <button class="icon-btn" onclick="viewLead('${escapeHTML(l.id)}')" title="View / Update" data-testid="view-lead-${escapeHTML(l.id)}"><i class="fas fa-eye"></i></button>
        <button class="icon-btn danger" onclick="deleteLead('${escapeHTML(l.id)}')" title="Delete" data-testid="del-lead-${escapeHTML(l.id)}"><i class="fas fa-trash"></i></button>
      </div></td>
    </tr>`;
  }).join('');
}

function viewLead(id) {
  const l = state.leads.find(x => x.id === id);
  if (!l) return;
  const d = parseLeadSummary(l.summary || '');
  const html = `
    <div class="grid-2" style="gap:14px;margin-bottom:14px;">
      <div><label class="hint" style="font-weight:700;text-transform:uppercase;letter-spacing:1px;">Name</label><div style="font-size:14px;font-weight:600;">${escapeHTML(d.Name||d.name||'—')}</div></div>
      <div><label class="hint" style="font-weight:700;text-transform:uppercase;letter-spacing:1px;">Date</label><div style="font-size:13px;">${new Date(l.created_at).toLocaleString('en-IN')}</div></div>
      <div><label class="hint" style="font-weight:700;text-transform:uppercase;letter-spacing:1px;">Email</label><div style="font-size:13px;"><a href="mailto:${escapeHTML(d.Email||d.email||'')}" style="color:var(--admin-primary);">${escapeHTML(d.Email||d.email||'—')}</a></div></div>
      <div><label class="hint" style="font-weight:700;text-transform:uppercase;letter-spacing:1px;">Phone</label><div style="font-size:13px;"><a href="tel:${escapeHTML(d.Phone||d.phone||'')}" style="color:var(--admin-primary);">${escapeHTML(d.Phone||d.phone||'—')}</a> · <a href="https://wa.me/${(d.Phone||d.phone||'').replace(/[^\d]/g,'').replace(/^0+/,'91')}" target="_blank" style="color:#25D366;"><i class="fab fa-whatsapp"></i> WhatsApp</a></div></div>
      <div><label class="hint" style="font-weight:700;text-transform:uppercase;letter-spacing:1px;">Event Type</label><div style="font-size:13px;">${escapeHTML(d.Event||d.event||'—')}</div></div>
      <div><label class="hint" style="font-weight:700;text-transform:uppercase;letter-spacing:1px;">Event Date</label><div style="font-size:13px;">${escapeHTML(d.Date||d.date||'—')}</div></div>
      <div><label class="hint" style="font-weight:700;text-transform:uppercase;letter-spacing:1px;">Quantity</label><div style="font-size:13px;font-weight:600;">${escapeHTML(d.Qty||d.qty||'—')}</div></div>
      <div><label class="hint" style="font-weight:700;text-transform:uppercase;letter-spacing:1px;">Budget</label><div style="font-size:13px;font-weight:600;color:var(--admin-primary);">${d.Budget||d.budget ? '₹'+escapeHTML(d.Budget||d.budget) : '—'}</div></div>
      <div style="grid-column:1/-1;"><label class="hint" style="font-weight:700;text-transform:uppercase;letter-spacing:1px;">Message</label><div style="font-size:13px;background:var(--admin-muted);padding:10px;border-radius:6px;white-space:pre-wrap;line-height:1.5;">${escapeHTML(d.Message||d.message||'—')}</div></div>
      <div><label class="hint" style="font-weight:700;text-transform:uppercase;letter-spacing:1px;">Status *</label>
        <select class="select" id="lv-status" data-testid="lv-status">
          ${['New','Contacted','Discussed','Quoted','Accepted','Converted','Not Converted','Lost'].map(s => `<option ${(l.status||'New')===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </div>
      <div><label class="hint" style="font-weight:700;text-transform:uppercase;letter-spacing:1px;">Deal Value (₹) <span style="font-weight:400;">if converted</span></label>
        <input class="input" id="lv-deal-value" type="number" min="0" step="100" data-testid="lv-deal-value" value="${l.deal_value || ''}" placeholder="0" />
      </div>
      <div style="grid-column:1/-1;"><label class="hint" style="font-weight:700;text-transform:uppercase;letter-spacing:1px;">Admin Notes (call log, next steps)</label>
        <textarea class="input" id="lv-notes" rows="3" data-testid="lv-notes" placeholder="e.g. Called 14-Jun, said they'll confirm by Friday. Sent quote for 50 boxes at ₹6/each.">${escapeHTML(l.admin_notes||'')}</textarea>
      </div>
    </div>`;
  const footer = el('div', {});
  footer.innerHTML = `<button class="btn btn-secondary" id="lv-close" data-testid="lv-close">Close</button><button class="btn btn-primary" id="lv-save" data-testid="lv-save"><i class="fas fa-save"></i> Save Update</button>`;
  const m = openModal({ title: `Enquiry · ${d.Name || d.name || '—'}`, body: html, footer, size: 'lg', testid: 'lead-view' });
  $('lv-close').onclick = () => m.close();
  $('lv-save').onclick = async () => {
    const update = {
      status: $('lv-status').value,
      admin_notes: $('lv-notes').value.trim() || null,
      deal_value: Number($('lv-deal-value').value) || null,
    };
    
    const session = await supabaseClient.auth.getSession();
    const token = session.data?.session?.access_token;
    
    const r = await fetch('/api/admin/leads', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ id: l.id, payload: update })
    });
    
    if (!r.ok) {
      const e = await r.json();
      return showToast('Save failed: ' + (e.error || 'Unknown error'), 'error');
    }
    
    Object.assign(l, update);
    renderLeads();
    showToast(`Enquiry → ${update.status}`);
    m.close();
  };
}
window.viewLead = viewLead;

async function updateLeadInline(id, newStatus) {
  const l = state.leads.find(x => x.id === id);
  if (!l) return;
  const oldStatus = l.status;
  
  // Optimistic UI update
  l.status = newStatus;
  renderLeads();
  
  const session = await supabaseClient.auth.getSession();
  const token = session.data?.session?.access_token;
  
  const r = await fetch('/api/admin/leads', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ id: id, payload: { status: newStatus } })
  });
  
  if (!r.ok) {
    const e = await r.json();
    l.status = oldStatus;
    renderLeads();
    return showToast('Save failed: ' + (e.error || 'Unknown error'), 'error');
  }
  showToast(`Enquiry → ${newStatus}`);
}
window.updateLeadInline = updateLeadInline;

async function deleteLead(id) {
  if (!await confirmDialog('Delete this enquiry permanently?', { confirmLabel:'Delete', danger:true })) return;
  
  const session = await supabaseClient.auth.getSession();
  const token = session.data?.session?.access_token;
  
  const r = await fetch('/api/admin/leads', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ id })
  });
  
  if (!r.ok) {
    const e = await r.json();
    return showToast('Delete failed: ' + (e.error || 'Unknown error'), 'error');
  }
  
  state.leads = state.leads.filter(x => x.id !== id);
  renderLeads();
  showToast('Enquiry deleted.');
}
window.deleteLead = deleteLead;

// ------------------------- Loyalty Program -------------------------
async function loadLoyaltyCustomers() {
  try {
    const { data, error } = await supabaseClient.from('profiles').select('*').order('loyalty_points', { ascending: false }).limit(500);
    if (error) throw error;
    state.loyaltyCustomers = data || [];
  } catch (e) {
    state.loyaltyCustomers = [];
    if (e.message?.includes('loyalty_points')) showToast('Run migration_phase4_loyalty_multiimage.sql in Supabase to enable Loyalty.', 'error');
  }
}

function renderLoyalty() {
  const list = state.loyaltyCustomers || [];
  const kpis = $('loyalty-kpis');
  if (kpis) {
    const totBal = list.reduce((s, p) => s + Number(p.loyalty_points || 0), 0);
    const totEarn = list.reduce((s, p) => s + Number(p.lifetime_points_earned || 0), 0);
    const totRed = list.reduce((s, p) => s + Number(p.lifetime_points_redeemed || 0), 0);
    kpis.innerHTML = kpi('Outstanding Points', totBal.toLocaleString('en-IN'), 'fa-coins', `Liability ₹${totBal.toLocaleString('en-IN')}`) +
      kpi('Lifetime Issued', totEarn.toLocaleString('en-IN'), 'fa-circle-plus') +
      kpi('Lifetime Redeemed', totRed.toLocaleString('en-IN'), 'fa-circle-minus') +
      kpi('Members', String(list.length), 'fa-users');
  }
  const tbody = $('loyalty-tbody');
  if (!tbody) return;
  const q = ($('loyalty-search')?.value || '').toLowerCase().trim();
  const rows = q
    ? list.filter(p => (p.name || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q) || (p.phone || '').includes(q))
    : list;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty"><div class="ic"><i class="fas fa-coins"></i></div><h4>No customers${q ? ' match your search' : ' yet'}</h4><p>Points are credited automatically when an order is marked Delivered.</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(p => `<tr data-testid="loyalty-row-${escapeHTML(p.id)}">
    <td><strong>${escapeHTML(p.name || '—')}</strong></td>
    <td style="font-size:12px;">${escapeHTML(p.email || '—')}</td>
    <td style="font-size:12px;">${escapeHTML(p.phone || '—')}</td>
    <td style="text-align:right;font-weight:700;color:var(--admin-primary);">${Number(p.loyalty_points || 0).toLocaleString('en-IN')}</td>
    <td style="text-align:right;">${Number(p.lifetime_points_earned || 0).toLocaleString('en-IN')}</td>
    <td style="text-align:right;">${Number(p.lifetime_points_redeemed || 0).toLocaleString('en-IN')}</td>
    <td>
      <button class="icon-btn" onclick="openLoyaltyAdjust('${escapeHTML(p.id)}')" title="Adjust points" data-testid="loyalty-adjust-${escapeHTML(p.id)}"><i class="fas fa-sliders"></i></button>
      <button class="icon-btn" onclick="viewLoyaltyHistory('${escapeHTML(p.id)}')" title="View history" data-testid="loyalty-history-${escapeHTML(p.id)}"><i class="fas fa-clock-rotate-left"></i></button>
    </td>
  </tr>`).join('');
}

window.openLoyaltyAdjust = function(userId) {
  const p = (state.loyaltyCustomers || []).find(x => x.id === userId);
  if (!p) return;
  const html = `
    <div style="margin-bottom:14px;font-size:13px;">
      <strong>${escapeHTML(p.name || '')}</strong> · ${escapeHTML(p.email || '')}<br>
      Current balance: <strong style="color:var(--admin-primary);">${Number(p.loyalty_points || 0).toLocaleString('en-IN')} points</strong>
    </div>
    <div class="grid-2">
      <div class="field"><label>Action</label>
        <select class="select" id="la-mode" data-testid="la-mode"><option value="add">Add points</option><option value="remove">Remove points</option></select>
      </div>
      <div class="field"><label>Points *</label><input class="input" id="la-points" type="number" min="1" step="1" placeholder="e.g. 50" data-testid="la-points" /></div>
      <div class="field" style="grid-column:1/-1;"><label>Reason / Note *</label><input class="input" id="la-note" placeholder="e.g. Goodwill for delayed delivery" data-testid="la-note" /></div>
    </div>`;
  const footer = el('div', {});
  footer.innerHTML = `<button class="btn btn-secondary" id="la-cancel">Cancel</button><button class="btn btn-primary" id="la-save" data-testid="la-save"><i class="fas fa-check"></i> Apply</button>`;
  const m = openModal({ title: 'Adjust Loyalty Points', body: html, footer, testid: 'loyalty-adjust' });
  $('la-cancel').onclick = () => m.close();
  $('la-save').onclick = async () => {
    const pts = Math.floor(Number($('la-points').value || 0));
    const note = $('la-note').value.trim();
    if (pts <= 0) return showToast('Enter a valid points amount.', 'error');
    if (!note) return showToast('A note is required for audit history.', 'error');
    const signed = $('la-mode').value === 'remove' ? -pts : pts;
    if (signed < 0 && Number(p.loyalty_points || 0) + signed < 0) return showToast('Cannot remove more points than the customer has.', 'error');
    const { error } = await supabaseClient.from('loyalty_transactions').insert({
      user_id: userId, type: 'adjust', points: signed, note, created_by: 'admin',
    });
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast(`${signed > 0 ? 'Added' : 'Removed'} ${pts} points.`);
    m.close();
    await loadLoyaltyCustomers();
    renderLoyalty();
  };
};

window.viewLoyaltyHistory = async function(userId) {
  const p = (state.loyaltyCustomers || []).find(x => x.id === userId);
  const { data: txns } = await supabaseClient.from('loyalty_transactions').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(100);
  const list = txns || [];
  const html = `
    <div style="margin-bottom:12px;font-size:13px;"><strong>${escapeHTML(p?.name || '')}</strong> · ${escapeHTML(p?.email || '')} · Balance: <strong style="color:var(--admin-primary);">${Number(p?.loyalty_points || 0)}</strong></div>
    ${!list.length ? '<div class="empty" style="padding:24px;"><h4>No transactions yet</h4></div>' : `
    <table class="data" style="font-size:12px;">
      <thead><tr><th>Date</th><th>Type</th><th style="text-align:right">Points</th><th>Note</th><th>By</th></tr></thead>
      <tbody>${list.map(t => `<tr>
        <td>${new Date(t.created_at).toLocaleString('en-IN')}</td>
        <td><span class="badge b-muted">${escapeHTML(t.type)}</span></td>
        <td style="text-align:right;font-weight:700;color:${Number(t.points) >= 0 ? '#1E8449' : '#C0392B'};">${Number(t.points) >= 0 ? '+' : ''}${t.points}</td>
        <td>${escapeHTML(t.note || '—')}</td>
        <td>${escapeHTML(t.created_by || 'system')}</td>
      </tr>`).join('')}</tbody>
    </table>`}`;
  const footer = el('div', {});
  footer.innerHTML = `<button class="btn btn-secondary" id="lh-close">Close</button>`;
  const m = openModal({ title: 'Points History', body: html, footer, size: 'lg', testid: 'loyalty-history' });
  $('lh-close').onclick = () => m.close();
};

// ------------------------- Customer Directory -------------------------
const SPEND_STATUSES = ['Paid', 'Confirmed', 'Packed', 'Shipped', 'Delivered'];

async function loadCustomerDirectory() {
  try {
    const [profRes, orderRes] = await Promise.all([
      supabaseClient.from('profiles').select('*').order('created_at', { ascending: false }).limit(2000),
      supabaseClient.from('orders').select('user_id,guest_email,guest_phone,shipping_address,total_amount,status,created_at').limit(5000),
    ]);
    const profiles = profRes.data || [];
    const orders = orderRes.data || [];

    const byId = new Map();
    profiles.forEach(p => byId.set(p.id, {
      id: p.id, name: p.name || '—', phone: p.phone || '', email: (p.email || '').toLowerCase(),
      type: 'Registered', joined: p.created_at, orders: 0, spend: 0,
      points: Number(p.loyalty_points || 0),
    }));
    const byEmail = new Map();
    byId.forEach(c => { if (c.email) byEmail.set(c.email, c); });

    const guests = new Map();
    for (const o of orders) {
      const counts = SPEND_STATUSES.includes(o.status);
      const email = (o.guest_email || '').toLowerCase();
      let target = (o.user_id && byId.get(o.user_id)) || (email && byEmail.get(email)) || null;
      if (!target && email) {
        target = guests.get(email);
        if (!target) {
          target = {
            id: 'guest-' + email, name: (o.shipping_address && o.shipping_address.name) || 'Guest',
            phone: o.guest_phone || (o.shipping_address && o.shipping_address.phone) || '',
            email, type: 'Guest', joined: o.created_at, orders: 0, spend: 0, points: 0,
          };
          guests.set(email, target);
        }
      }
      if (!target) continue;
      if (counts) { target.orders += 1; target.spend += Number(o.total_amount || 0); }
      if (!target.phone && o.guest_phone) target.phone = o.guest_phone;
      if (new Date(o.created_at) < new Date(target.joined)) target.joined = o.created_at;
    }
    state.customers = [...byId.values(), ...guests.values()].sort((a, b) => b.spend - a.spend || new Date(b.joined) - new Date(a.joined));
  } catch (e) {
    state.customers = [];
    showToast('Could not load customers: ' + e.message, 'error');
  }
}

function filteredCustomers() {
  const q = ($('customers-search')?.value || '').toLowerCase().trim();
  const type = $('customers-type-filter')?.value || '';
  return (state.customers || []).filter(c =>
    (!type || c.type === type) &&
    (!q || (c.name || '').toLowerCase().includes(q) || (c.email || '').includes(q) || (c.phone || '').includes(q))
  );
}

function renderCustomers() {
  const list = state.customers || [];
  const kpis = $('customers-kpis');
  if (kpis) {
    const reg = list.filter(c => c.type === 'Registered').length;
    const withPhone = list.filter(c => c.phone).length;
    const withEmail = list.filter(c => c.email).length;
    kpis.innerHTML = kpi('Total Customers', String(list.length), 'fa-users') +
      kpi('Registered', String(reg), 'fa-user-check', `${list.length - reg} guest buyers`) +
      kpi('With Mobile', String(withPhone), 'fa-phone') +
      kpi('With Email', String(withEmail), 'fa-envelope');
  }
  const tbody = $('customers-tbody');
  if (!tbody) return;
  const rows = filteredCustomers();
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty"><div class="ic"><i class="fas fa-users"></i></div><h4>No customers found</h4><p>Customers appear here when they sign up or place an order.</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(c => `<tr data-testid="customer-row">
    <td><strong>${escapeHTML(c.name)}</strong></td>
    <td style="font-size:12px;">${c.phone ? escapeHTML(c.phone) : '<span style="color:var(--admin-text-mute);">—</span>'}</td>
    <td style="font-size:12px;">${c.email ? escapeHTML(c.email) : '<span style="color:var(--admin-text-mute);">—</span>'}</td>
    <td><span class="badge ${c.type === 'Registered' ? 'b-success' : 'b-muted'}">${c.type}</span></td>
    <td style="font-size:12px;">${new Date(c.joined).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
    <td style="text-align:right;">${c.orders}</td>
    <td style="text-align:right;font-weight:600;">₹${c.spend.toLocaleString('en-IN')}</td>
    <td style="text-align:right;">${c.points || 0}</td>
  </tr>`).join('');
}

function exportCustomersCSV() {
  const rows = filteredCustomers();
  if (!rows.length) return showToast('Nothing to export.', 'error');
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = ['Name,Mobile,Email,Type,Joined,Orders,Lifetime Spend (INR),Loyalty Points']
    .concat(rows.map(c => [c.name, c.phone, c.email, c.type, new Date(c.joined).toLocaleDateString('en-IN'), c.orders, c.spend, c.points].map(esc).join(',')))
    .join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `oncost-customers-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast(`Exported ${rows.length} customers.`);
}

// ------------------------- Testimonials -------------------------
async function loadTestimonials() {
  const { data } = await supabaseClient.from('testimonials').select('*').order('created_at', { ascending: false });
  state.testimonials = data || [];
}
function renderTestimonials() {
  const tbody = $('testimonials-tbody');
  if (!state.testimonials.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty"><div class="ic"><i class="fas fa-star"></i></div><h4>No testimonials yet</h4><p>Customer reviews submitted via storefront will appear here for moderation, or add one manually.</p><button class="btn btn-primary" onclick="openTestimonialForm()" data-testid="empty-add-testi"><i class="fas fa-plus"></i> Add Testimonial</button></div></td></tr>`;
    return;
  }
  tbody.innerHTML = state.testimonials.map(t => {
    const product = t.product_id ? state.products.find(p => p.id === t.product_id) : null;
    return `
    <tr data-testid="testi-row-${escapeHTML(t.id)}">
      <td>
        <div style="font-weight:500">${escapeHTML(t.customer_name||'—')}</div>
        ${t.is_verified ? '<div style="font-size:10px;color:#1E8449;margin-top:2px;"><i class="fas fa-circle-check"></i> Verified buyer</div>' : ''}
      </td>
      <td style="font-size:12px">${product ? escapeHTML(product.name) : '<span style="color:var(--admin-text-mute)">Site-wide</span>'}</td>
      <td>${'★'.repeat(t.rating||0)}<span style="color:var(--admin-text-mute)">${'☆'.repeat(5-(t.rating||0))}</span></td>
      <td style="max-width:300px;font-size:13px">${t.title ? '<strong>'+escapeHTML(t.title)+'</strong><br>' : ''}${escapeHTML((t.review_text||'').substring(0,140))}${(t.review_text||'').length>140?'…':''}</td>
      <td>${statusBadge(t.status||'Pending')}</td>
      <td style="font-size:12px">${new Date(t.created_at).toLocaleDateString()}</td>
      <td style="text-align:right">
        <div class="row-actions" style="justify-content:flex-end;">
          ${t.status !== 'Approved' ? `<button class="btn btn-secondary btn-sm" onclick="updateTestimonial('${escapeHTML(t.id)}','Approved')" data-testid="testi-approve-${escapeHTML(t.id)}">Approve</button>` : ''}
          ${t.status !== 'Rejected' ? `<button class="btn btn-ghost btn-sm" onclick="updateTestimonial('${escapeHTML(t.id)}','Rejected')" data-testid="testi-reject-${escapeHTML(t.id)}">Reject</button>` : ''}
          <button class="icon-btn" onclick="openTestimonialForm('${escapeHTML(t.id)}')" title="Edit" data-testid="testi-edit-${escapeHTML(t.id)}"><i class="fas fa-pen"></i></button>
          <button class="icon-btn danger" onclick="deleteTestimonial('${escapeHTML(t.id)}')" title="Delete" data-testid="testi-del-${escapeHTML(t.id)}"><i class="fas fa-trash"></i></button>
        </div>
      </td>
    </tr>`;
  }).join('');
}
async function updateTestimonial(id, status) {
  const { error } = await supabaseClient.from('testimonials').update({ status }).eq('id', id);
  if (error) return showToast('Update failed: ' + error.message, 'error');
  const t = state.testimonials.find(x => x.id === id); if (t) t.status = status;
  renderTestimonials();
  showToast(`Testimonial ${status.toLowerCase()}.`);
}
window.updateTestimonial = updateTestimonial;

function openTestimonialForm(id) {
  const t = id ? state.testimonials.find(x => x.id === id) : null;
  const isEdit = !!t;
  const productOptions = state.products.map(p => `<option value="${escapeHTML(p.id)}" ${t?.product_id===p.id?'selected':''}>${escapeHTML(p.name)}</option>`).join('');
  const html = `
    <div class="grid-2">
      <div class="field"><label>Customer Name *</label><input class="input" id="te-customer_name" required data-testid="te-customer_name" value="${escapeHTML(t?.customer_name||'')}" placeholder="Priya Sharma" /></div>
      <div class="field"><label>Rating *</label>
        <select class="select" id="te-rating" data-testid="te-rating">
          ${[5,4,3,2,1].map(n => `<option value="${n}" ${t?.rating===n?'selected':''}>${'★'.repeat(n)}${'☆'.repeat(5-n)} (${n})</option>`).join('')}
        </select>
      </div>
      <div class="field" style="grid-column:1/-1"><label>Product (optional — leave blank for site-wide testimonial)</label>
        <select class="select" id="te-product_id" data-testid="te-product_id">
          <option value="">— Site-wide testimonial —</option>
          ${productOptions}
        </select>
      </div>
      <div class="field" style="grid-column:1/-1"><label>Headline (optional)</label><input class="input" id="te-title" maxlength="80" data-testid="te-title" value="${escapeHTML(t?.title||'')}" placeholder="Loved the packaging!" /></div>
      <div class="field" style="grid-column:1/-1">
        <label style="display:flex;justify-content:space-between;align-items:center;">Review Text *
          <button type="button" class="btn btn-secondary" id="te-polish" data-testid="te-polish" style="padding:4px 12px;font-size:11px;"><i class="fas fa-wand-magic-sparkles"></i> Polish with AI</button>
        </label>
        <textarea class="input" id="te-review_text" rows="4" required data-testid="te-review_text" placeholder="What did the customer say?">${escapeHTML(t?.review_text||'')}</textarea>
        <div style="font-size:11px;color:var(--admin-text-mute);margin-top:4px;">AI improves grammar & professionalism only — never invents details.</div>
      </div>
      <div class="field"><label>Image URL (optional)</label><input class="input" id="te-image_url" data-testid="te-image_url" value="${escapeHTML(t?.image_url||'')}" placeholder="https://..." /></div>
      <div class="field"><label>Status</label>
        <select class="select" id="te-status" data-testid="te-status">
          <option value="Approved" ${(!t||t.status==='Approved')?'selected':''}>Approved (publish immediately)</option>
          <option value="Pending"  ${t?.status==='Pending'?'selected':''}>Pending (hidden)</option>
          <option value="Rejected" ${t?.status==='Rejected'?'selected':''}>Rejected (hidden)</option>
        </select>
      </div>
      <div class="field" style="grid-column:1/-1;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="te-is_verified" data-testid="te-is_verified" ${t?.is_verified?'checked':'checked'} />
          <span>Mark as <strong>verified buyer</strong> (shows green checkmark on storefront)</span>
        </label>
      </div>
    </div>`;
  const footer = el('div', {});
  footer.innerHTML = `<button class="btn btn-secondary" id="te-cancel" data-testid="te-cancel">Cancel</button><button class="btn btn-primary" id="te-save" data-testid="te-save"><i class="fas fa-save"></i> ${isEdit?'Save':'Add Testimonial'}</button>`;
  const m = openModal({ title: isEdit ? 'Edit Testimonial' : 'Add Testimonial', body: html, footer, size: 'lg', testid: 'te' });
  $('te-cancel').onclick = () => m.close();
  $('te-polish').onclick = async () => {
    const ta = $('te-review_text');
    const original = ta.value.trim();
    if (original.length < 5) return showToast('Enter the review text first.', 'error');
    const pb = $('te-polish');
    pb.disabled = true; pb.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Polishing…';
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      const r = await fetch('/api/admin/polish-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ text: original }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.polished) throw new Error(j.error || 'AI polish unavailable (works on the live site after deploy).');
      ta.value = j.polished;
      showToast('Polished! Review the text, edit if needed, then save.');
    } catch (e) { showToast(e.message, 'error'); }
    pb.disabled = false; pb.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Polish with AI';
  };
  $('te-save').onclick = async () => {
    const payload = {
      customer_name: $('te-customer_name').value.trim(),
      rating: Number($('te-rating').value),
      product_id: $('te-product_id').value || null,
      title: $('te-title').value.trim() || null,
      review_text: $('te-review_text').value.trim(),
      image_url: $('te-image_url').value.trim() || null,
      status: $('te-status').value,
      is_verified: $('te-is_verified').checked,
    };
    if (!payload.customer_name) return showToast('Customer name required.', 'error');
    if (!payload.review_text) return showToast('Review text required.', 'error');
    let res;
    if (isEdit) res = await supabaseClient.from('testimonials').update(payload).eq('id', t.id).select().single();
    else        res = await supabaseClient.from('testimonials').insert(payload).select().single();
    if (res.error) {
      if (res.error.message?.includes('product_id') || res.error.message?.includes('title')) {
        return showToast('Run migration_reviews.sql in Supabase first.', 'error');
      }
      return showToast('Save failed: ' + res.error.message, 'error');
    }
    if (isEdit) state.testimonials = state.testimonials.map(x => x.id === t.id ? res.data : x);
    else        state.testimonials.unshift(res.data);
    renderTestimonials();
    showToast(`Testimonial ${isEdit ? 'updated' : 'added'}.`);
    m.close();
  };
}
window.openTestimonialForm = openTestimonialForm;

async function deleteTestimonial(id) {
  if (!await confirmDialog('Delete this testimonial permanently?', { confirmLabel: 'Delete', danger: true })) return;
  const { error } = await supabaseClient.from('testimonials').delete().eq('id', id);
  if (error) return showToast('Delete failed: ' + error.message, 'error');
  state.testimonials = state.testimonials.filter(x => x.id !== id);
  renderTestimonials();
  showToast('Testimonial deleted.');
}
window.deleteTestimonial = deleteTestimonial;

// ---- Request Review (sends WhatsApp magic link to a Delivered order's customer) ----
async function requestReview(orderId) {
  const o = state.orders.find(x => x.id === orderId);
  if (!o) return showToast('Order not found.', 'error');
  if (!['Paid','Packed','Shipped','Delivered'].includes(o.status)) {
    return showToast('Order must be Paid/Delivered to request a review.', 'error');
  }
  const key = localStorage.getItem('oncost_recover_key') || prompt('Enter your ADMIN_RECOVERY_KEY (set in Vercel env):');
  if (!key) return;
  try {
    const r = await fetch('/api/reviews/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': key },
      body: JSON.stringify({ order_id: orderId }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    localStorage.setItem('oncost_recover_key', key);

    // Show a result modal with the link + WA status + copy-paste fallback
    const html = `
      <div style="background:${j.whatsapp_sent ? '#E6F4EA' : '#FFF3E0'};border:1px solid ${j.whatsapp_sent ? '#A4D4B4' : '#E6B580'};color:${j.whatsapp_sent ? '#1E5631' : '#7A4310'};padding:12px 14px;border-radius:6px;margin-bottom:14px;font-size:13px;">
        <strong><i class="fas fa-${j.whatsapp_sent ? 'circle-check' : 'circle-info'}"></i> ${j.whatsapp_sent ? 'WhatsApp sent successfully' : 'WhatsApp not sent (' + escapeHTML(j.whatsapp_error || 'AiSensy not configured') + ')'}</strong>
      </div>
      <div class="field"><label>Review Link (share with customer)</label>
        <div style="display:flex;gap:6px;">
          <input class="input" id="rv-link" value="${escapeHTML(j.review_link)}" readonly style="font-size:12px;font-family:monospace;" />
          <button class="btn btn-secondary" id="rv-copy-link" data-testid="rv-copy-link">Copy</button>
        </div>
      </div>
      <div class="field"><label>WhatsApp Message Template</label>
        <textarea class="input" id="rv-msg" rows="4" readonly style="font-size:13px;">${escapeHTML(j.copy_paste_message)}</textarea>
        <div style="display:flex;gap:6px;margin-top:6px;">
          <button class="btn btn-secondary" id="rv-copy-msg" data-testid="rv-copy-msg">Copy Message</button>
          <a class="btn btn-primary" id="rv-wa-link" target="_blank" data-testid="rv-wa-link"><i class="fab fa-whatsapp"></i> Open in WhatsApp</a>
        </div>
      </div>`;
    const footer = el('div', {});
    footer.innerHTML = `<button class="btn btn-secondary" id="rv-close" data-testid="rv-close">Done</button>`;
    const m = openModal({ title: 'Review Request', body: html, footer, size: 'lg', testid: 'rv-result' });

    const phone = (o.guest_phone || o.shipping_address?.phone || '').replace(/[^\d]/g, '');
    const waLink = phone ? `https://wa.me/${phone.startsWith('91') || phone.length > 10 ? phone : '91' + phone}?text=${encodeURIComponent(j.copy_paste_message)}` : `https://wa.me/?text=${encodeURIComponent(j.copy_paste_message)}`;
    $('rv-wa-link').href = waLink;
    $('rv-close').onclick = () => m.close();
    $('rv-copy-link').onclick = () => { $('rv-link').select(); document.execCommand('copy'); showToast('Link copied.'); };
    $('rv-copy-msg').onclick  = () => { $('rv-msg').select();  document.execCommand('copy'); showToast('Message copied.'); };
  } catch (err) {
    showToast('Request failed: ' + err.message, 'error');
  }
}
window.requestReview = requestReview;

// ------------------------- Complaints -------------------------
async function loadComplaints() {
  try {
    const { data } = await supabaseClient.from('complaints').select('*').order('created_at', { ascending: false });
    state.complaints = data || [];
  } catch { state.complaints = []; }
  // Badge for sidebar showing open count
  const openCount = state.complaints.filter(c => c.status === 'Open' || c.status === 'In Progress').length;
  const badge = $('nav-complaints-badge');
  if (badge) { badge.style.display = openCount ? 'inline-block' : 'none'; badge.textContent = openCount; }
}

function renderComplaints() {
  const tbody = $('complaints-tbody');
  if (!tbody) return;
  const filter = $('complaints-status-filter')?.value;
  let list = state.complaints;
  if (filter) list = list.filter(c => c.status === filter);
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty"><div class="ic"><i class="fas fa-headset"></i></div><h4>No complaints ${filter?`with status "${filter}"`:'yet'}</h4><p>Customer complaints submitted via the storefront contact form will appear here.</p></div></td></tr>`;
    return;
  }
  const priorityColor = { Low:'#7A726B', Normal:'#1E5631', High:'#E8A53A', Urgent:'#C0392B' };
  tbody.innerHTML = list.map(c => {
    const order = c.order_id ? state.orders.find(o => o.id === c.order_id) : null;
    return `<tr data-testid="complaint-row-${escapeHTML(c.id)}">
      <td><strong style="color:var(--admin-primary);font-size:12px;">${escapeHTML(c.ticket_number || '—')}</strong></td>
      <td><div style="font-weight:500;">${escapeHTML(c.customer_name)}</div><div style="font-size:11px;color:var(--admin-text-mute);">${escapeHTML(c.guest_email||'')}</div></td>
      <td style="max-width:260px;"><div style="font-size:13px;font-weight:500;">${escapeHTML(c.subject)}</div><div style="font-size:11px;color:var(--admin-text-mute);">${escapeHTML((c.description||'').substring(0,80))}${(c.description||'').length>80?'…':''}</div></td>
      <td><span class="badge b-muted" style="font-size:10px;">${escapeHTML(c.category)}</span></td>
      <td style="font-size:11px;">${order ? `<code>${escapeHTML(order.ccavenue_order_id||'#'+String(order.id).substring(0,8))}</code>` : '<span style="color:var(--admin-text-mute);">—</span>'}</td>
      <td><span style="color:${priorityColor[c.priority||'Normal']};font-weight:600;font-size:12px;">${escapeHTML(c.priority||'Normal')}</span></td>
      <td>${statusBadge(c.status || 'Open')}</td>
      <td style="font-size:12px;color:var(--admin-text-mute);">${new Date(c.created_at).toLocaleDateString()}</td>
      <td><div class="row-actions">
        <button class="icon-btn" onclick="viewComplaint('${escapeHTML(c.id)}')" title="View / respond" data-testid="view-complaint-${escapeHTML(c.id)}"><i class="fas fa-eye"></i></button>
        <button class="icon-btn danger" onclick="deleteComplaint('${escapeHTML(c.id)}')" title="Delete" data-testid="del-complaint-${escapeHTML(c.id)}"><i class="fas fa-trash"></i></button>
      </div></td>
    </tr>`;
  }).join('');
}

function viewComplaint(id) {
  const c = state.complaints.find(x => x.id === id);
  if (!c) return;
  const order = c.order_id ? state.orders.find(o => o.id === c.order_id) : null;
  const responses = Array.isArray(c.responses) ? c.responses : [];
  const html = `
    <div class="grid-2" style="gap:14px;margin-bottom:18px;">
      <div><label class="hint" style="font-weight:700;text-transform:uppercase;letter-spacing:1px;">Customer</label><div style="font-size:14px;font-weight:600;">${escapeHTML(c.customer_name)}</div><div style="font-size:12px;color:var(--admin-text-mute);">${escapeHTML(c.guest_email || '')} · ${escapeHTML(c.guest_phone || '')}</div></div>
      <div><label class="hint" style="font-weight:700;text-transform:uppercase;letter-spacing:1px;">Ticket</label><div style="font-size:14px;font-weight:600;color:var(--admin-primary);">${escapeHTML(c.ticket_number || '—')}</div><div style="font-size:11px;color:var(--admin-text-mute);">Opened ${new Date(c.created_at).toLocaleString('en-IN')}</div></div>
      ${order ? `<div style="grid-column:1/-1;"><label class="hint" style="font-weight:700;text-transform:uppercase;letter-spacing:1px;">Related Order</label><div style="font-size:13px;"><code>${escapeHTML(order.ccavenue_order_id||'#'+String(order.id).substring(0,8))}</code> · ${fmtINR(order.total_amount)} · <a href="#" onclick="event.preventDefault();viewOrder('${escapeHTML(order.id)}')" style="color:var(--admin-primary);">Open →</a></div></div>` : ''}
    </div>

    <div class="grid-2" style="gap:14px;">
      <div class="field"><label>Category</label><div><span class="badge b-muted">${escapeHTML(c.category)}</span></div></div>
      <div class="field"><label>Priority</label>
        <select class="select" id="cv-priority" data-testid="cv-priority">
          ${['Low','Normal','High','Urgent'].map(p => `<option ${(c.priority||'Normal')===p?'selected':''}>${p}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Status</label>
        <select class="select" id="cv-status" data-testid="cv-status">
          ${['Open','In Progress','Resolved','Closed'].map(s => `<option ${(c.status||'Open')===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="grid-column:1/-1;"><label>Subject</label><div style="font-size:14px;font-weight:500;">${escapeHTML(c.subject)}</div></div>
      <div class="field" style="grid-column:1/-1;"><label>Description</label><div style="font-size:13px;color:var(--admin-text-soft);background:var(--admin-muted);padding:10px 14px;border-radius:6px;white-space:pre-wrap;line-height:1.5;">${escapeHTML(c.description)}</div></div>
      ${Array.isArray(c.attachments) && c.attachments.length ? `<div class="field" style="grid-column:1/-1;"><label>Attachments</label><div style="display:flex;gap:8px;flex-wrap:wrap;">${c.attachments.map(u => `<a href="${escapeHTML(u)}" target="_blank"><img src="${escapeHTML(u)}" style="width:60px;height:60px;object-fit:cover;border-radius:4px;border:1px solid var(--admin-border);" /></a>`).join('')}</div></div>` : ''}
      <div class="field" style="grid-column:1/-1;"><label>Admin Notes (internal)</label><textarea class="input" id="cv-notes" rows="2" data-testid="cv-notes" placeholder="Internal notes — not visible to customer">${escapeHTML(c.admin_notes || '')}</textarea></div>
      <div class="field" style="grid-column:1/-1;"><label>Resolution (visible to customer)</label><textarea class="input" id="cv-resolution" rows="3" data-testid="cv-resolution" placeholder="How was the issue resolved? This message is shown to the customer.">${escapeHTML(c.resolution || '')}</textarea></div>
    </div>

    ${responses.length ? `
      <h4 style="margin:18px 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--admin-text-mute);">Conversation</h4>
      <div style="max-height:200px;overflow-y:auto;background:var(--admin-muted);padding:10px;border-radius:6px;font-size:12px;">
        ${responses.map(r => `<div style="padding:6px 8px;margin-bottom:6px;background:#fff;border-radius:4px;border-left:3px solid ${r.author==='admin'?'var(--admin-primary)':'#A4D4B4'};"><strong>${escapeHTML(r.author||'system')}</strong> · <span style="color:var(--admin-text-mute);">${new Date(r.at).toLocaleString('en-IN')}</span><div style="margin-top:4px;white-space:pre-wrap;">${escapeHTML(r.message)}</div></div>`).join('')}
      </div>` : ''}
  `;
  const footer = el('div', {});
  footer.innerHTML = `<button class="btn btn-secondary" id="cv-close" data-testid="cv-close">Close</button><button class="btn btn-primary" id="cv-save" data-testid="cv-save"><i class="fas fa-save"></i> Save Changes</button>`;
  const m = openModal({ title: `Ticket ${c.ticket_number || ''}`, body: html, footer, size: 'lg', testid: 'complaint-view' });
  $('cv-close').onclick = () => m.close();
  $('cv-save').onclick = async () => {
    const update = {
      status: $('cv-status').value,
      priority: $('cv-priority').value,
      admin_notes: $('cv-notes').value.trim() || null,
      resolution: $('cv-resolution').value.trim() || null,
    };
    if (update.status === 'Resolved' && !c.resolved_at) update.resolved_at = new Date().toISOString();
    const { error } = await supabaseClient.from('complaints').update(update).eq('id', c.id);
    if (error) return showToast('Save failed: ' + error.message, 'error');
    Object.assign(c, update);
    renderComplaints();
    loadComplaints();   // refresh badge
    showToast('Ticket updated.');
    m.close();
  };
}
window.viewComplaint = viewComplaint;

async function deleteComplaint(id) {
  if (!await confirmDialog('Permanently delete this complaint ticket? This cannot be undone.', { confirmLabel: 'Delete', danger: true })) return;
  const { error } = await supabaseClient.from('complaints').delete().eq('id', id);
  if (error) return showToast('Delete failed: ' + error.message, 'error');
  state.complaints = state.complaints.filter(c => c.id !== id);
  renderComplaints();
  loadComplaints();
  showToast('Ticket deleted.');
}
window.deleteComplaint = deleteComplaint;

// ------------------------- Render orchestration -------------------------
function setupSearches() {
  let pt; $('products-search').addEventListener('input', () => { clearTimeout(pt); pt = setTimeout(applyProductFilters, 200); });
  $('products-cat-filter').addEventListener('change', applyProductFilters);
  $('products-status-filter').addEventListener('change', applyProductFilters);
  let it; $('inv-search').addEventListener('input', () => { clearTimeout(it); it = setTimeout(renderInventory, 200); });
  $('inv-low-only').addEventListener('change', renderInventory);
  let ot; $('orders-search').addEventListener('input', () => { clearTimeout(ot); ot = setTimeout(renderOrders, 200); });
  $('orders-status-filter').addEventListener('change', renderOrders);
  $('complaints-status-filter')?.addEventListener('change', renderComplaints);
  let lt; $('loyalty-search')?.addEventListener('input', () => { clearTimeout(lt); lt = setTimeout(renderLoyalty, 200); });
  let ct; $('customers-search')?.addEventListener('input', () => { clearTimeout(ct); ct = setTimeout(renderCustomers, 200); });
  $('customers-type-filter')?.addEventListener('change', renderCustomers);
  $('customers-export')?.addEventListener('click', exportCustomersCSV);

  // Products "select all on page" header checkbox
  $('products-check-all').addEventListener('change', (e) => {
    const visible = state.productsFiltered.slice((state.productsPage-1)*state.productsPageSize, state.productsPage*state.productsPageSize);
    if (e.target.checked) visible.forEach(p => state.selectedProducts.add(p.id));
    else                  visible.forEach(p => state.selectedProducts.delete(p.id));
    renderProducts();
  });

  // Orders "select all on page" header checkbox
  $('orders-check-all').addEventListener('change', (e) => {
    const visible = (state.orders || []).filter(o => {
      const q = ($('orders-search').value || '').toLowerCase().trim();
      const st = $('orders-status-filter').value;
      if (st && o.status !== st) return false;
      if (q) { const hay = `${o.id} ${o.ccavenue_order_id||''} ${o.guest_email||''} ${o.guest_phone||''}`.toLowerCase(); if (!hay.includes(q)) return false; }
      return true;
    });
    if (e.target.checked) visible.forEach(o => state.selectedOrders.add(o.id));
    else                  visible.forEach(o => state.selectedOrders.delete(o.id));
    renderOrders();
  });
}

function renderAllOnce() {
  applyProductFilters();
  renderCategories();
  renderCoupons();
  renderSales();
  renderLeads();
  renderTestimonials();
  renderComplaints();
  renderInventory();
  renderOrders();
  renderDashboard();
  renderLowStockAlert();
  renderCharts();
}

// kick it off
document.addEventListener('DOMContentLoaded', bootstrap);
