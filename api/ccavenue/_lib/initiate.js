// POST /api/ccavenue/initiate
// Body: { items, total_amount, shipping_address: {name,email,phone,address,city,state,zip}, user_id, applied_coupon }
// 1. Inserts a 'Processing' order row into Supabase (using SERVICE_ROLE_KEY → bypasses RLS).
// 2. Returns an auto-submitting HTML form that posts to CCAvenue's secure checkout endpoint.
//
// This is the SINGLE source of order creation — frontend never touches the orders table directly
// for new orders. That guarantees no RLS / schema-mismatch failures.

const { encrypt, buildMerchantData } = require('./ccavenue-crypto');

const CCAV_URL = {
  test:       'https://test.ccavenue.com/transaction/transaction.do?command=initiateTransaction',
  production: 'https://secure.ccavenue.com/transaction/transaction.do?command=initiateTransaction',
};

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

  const MERCHANT_ID  = (process.env.CCAVENUE_MERCHANT_ID || '').trim();
  const ACCESS_CODE  = (process.env.CCAVENUE_ACCESS_CODE || '').trim();
  const WORKING_KEY  = (process.env.CCAVENUE_WORKING_KEY || '').trim();
  const ENV          = (process.env.CCAVENUE_ENV || 'test').trim().toLowerCase();
  const SITE_URL     = (process.env.SITE_URL || `https://${req.headers.host}`).trim();
  const SUPABASE_URL = (process.env.SUPABASE_URL?.replace(/\/$/, '').replace(/^(?!https?:\/\/)/, 'https://') || '').trim();
  const SERVICE_KEY  = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!MERCHANT_ID || !ACCESS_CODE || !WORKING_KEY) {
    console.error('[ccavenue/initiate] Missing CCAvenue env vars');
    res.status(500).json({ error: 'CCAvenue not configured. Set CCAVENUE_MERCHANT_ID / ACCESS_CODE / WORKING_KEY in Vercel env vars.' });
    return;
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('[ccavenue/initiate] Missing Supabase env vars');
    res.status(500).json({ error: 'Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel env vars.' });
    return;
  }

  const body = req.body || {};
  const orderId      = body.order_id || `OC-${Date.now()}-${Math.floor(Math.random()*9999)}`;
  const amount       = Number(body.total_amount || 0).toFixed(2);
  const ship         = body.shipping_address || {};
  const items        = Array.isArray(body.items) ? body.items : [];
  const userId       = body.user_id || null;
  const appliedCoup  = body.applied_coupon || '';
  const subtotal     = Number(body.items_subtotal || 0);
  const shippingAmt  = Number(body.shipping_amount || 0);
  let discountAmt    = Number(body.discount_amount || 0);

  if (Number(amount) <= 0) { res.status(400).json({ error: 'Invalid amount' }); return; }
  if (!ship.email || !ship.name || !ship.phone) { res.status(400).json({ error: 'Missing customer email / name / phone' }); return; }

  // 0️⃣ Validate Coupon & Recalculate Total (Security Check)
  if (appliedCoup) {
    try {
      const { data: coup } = await fetch(`${SUPABASE_URL}/rest/v1/coupons?code=ilike.${encodeURIComponent(appliedCoup)}&limit=1`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
      }).then(r => r.json()).then(arr => ({ data: arr && arr.length ? arr[0] : null }));
      
      if (coup) {
        if (coup.expires_at && new Date(coup.expires_at) < new Date()) throw new Error('Expired coupon');
        if (coup.usage_limit && coup.used_count >= coup.usage_limit) throw new Error('Coupon usage limit reached');
        if (coup.min_order_amount && subtotal < coup.min_order_amount) throw new Error('Minimum order not met for coupon');
        
        // Calculate verified discount amount from DB
        let calculatedDiscount = 0;
        if (coup.discount_type === 'percent') {
          calculatedDiscount = (subtotal * Number(coup.discount_value)) / 100;
        } else {
          calculatedDiscount = Number(coup.discount_value);
        }
        discountAmt = Math.min(calculatedDiscount, subtotal);
      } else {
        throw new Error('Invalid coupon');
      }
    } catch (e) {
      console.warn('[ccavenue/initiate] Coupon validation failed:', e.message);
      // We could reject here, but for safety against edge cases we just remove the invalid discount
      discountAmt = 0; 
    }
  }

  // Recalculate exact total amount
  const finalTotalAmount = Math.max(0, subtotal - discountAmt + shippingAmt).toFixed(2);

  // 1️⃣  Insert pending order in Supabase via service role (bypasses RLS, guaranteed write)
  try {
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/orders`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        user_id: userId && /^[0-9a-f-]{36}$/i.test(userId) ? userId : null,
        ccavenue_order_id: orderId,
        items,
        total_amount: Number(finalTotalAmount),
        items_subtotal: subtotal || Number(finalTotalAmount),
        shipping_amount: shippingAmt,
        discount_amount: discountAmt,
        status: 'Processing',
        payment_status: 'Pending',
        payment_method: 'CCAvenue',
        guest_email: ship.email,
        guest_phone: ship.phone,
        shipping_address: ship
      }),
    });
    if (!insertRes.ok) {
      const errTxt = await insertRes.text();
      console.error('[ccavenue/initiate] Supabase insert failed:', insertRes.status, errTxt);
      res.status(500).send(`<!DOCTYPE html><html><body><h2>Checkout Error</h2><p>Failed to create order in our database. Please try again.</p><p><a href="/cart.html">Return to Cart</a></p></body></html>`);
      return;
    } else {
      console.log('[ccavenue/initiate] Supabase order created:', orderId);
    }
  } catch (e) {
    console.error('[ccavenue/initiate] Supabase insert exception:', e.message);
    res.status(500).send(`<!DOCTYPE html><html><body><h2>Checkout Error</h2><p>Failed to connect to our database. Please try again.</p><p><a href="/cart.html">Return to Cart</a></p></body></html>`);
    return;
  }

  // Sanitize inputs to prevent CCAvenue WAF from blocking the transaction
  const safeStr = (str) => String(str || '').replace(/[^a-zA-Z0-9\s@.,-]/g, '').substring(0, 250);
  const safePhone = (str) => String(str || '').replace(/[^0-9+]/g, '').substring(0, 15);

  const SITE_URL_CLEAN = SITE_URL.replace(/\/$/, ''); // Remove trailing slash

  // 2️⃣  Build CCAvenue encrypted payload
  const payload = {
    merchant_id:      MERCHANT_ID,
    order_id:         orderId,
    amount:           finalTotalAmount,
    currency:         'INR',
    redirect_url:     `${SITE_URL_CLEAN}/api/ccavenue/response`,
    cancel_url:       `${SITE_URL_CLEAN}/api/ccavenue/response`,
    language:         'EN',
    billing_name:     safeStr(ship.name),
    billing_address:  safeStr(ship.address),
    billing_city:     safeStr(ship.city),
    billing_state:    safeStr(ship.state),
    billing_zip:      safeStr(ship.zip),
    billing_country:  safeStr(ship.country || 'India'),
    billing_tel:      safePhone(ship.phone),
    billing_email:    safeStr(ship.email),
    delivery_name:    safeStr(ship.name),
    delivery_address: safeStr(ship.address),
    delivery_city:    safeStr(ship.city),
    delivery_state:   safeStr(ship.state),
    delivery_zip:     safeStr(ship.zip),
    delivery_country: safeStr(ship.country || 'India'),
    delivery_tel:     safePhone(ship.phone),
    merchant_param1:  safeStr(userId || 'guest'),
    merchant_param2:  safeStr(ship.email),
    merchant_param3:  safeStr(appliedCoup),
    customer_identifier: userId && body.save_card ? safeStr(userId) : '',
  };

  const plaintext  = buildMerchantData(payload);
  const ciphertext = encrypt(plaintext, WORKING_KEY);

  // Force Production URL for CCAvenue to eliminate Test environment mismatch
  const checkoutUrl = 'https://secure.ccavenue.com/transaction/transaction.do?command=initiateTransaction';

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Redirecting to CCAvenue…</title>
<style>body{font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#7a1f35;color:#f2dd92;text-align:center;padding:24px;}.s{width:34px;height:34px;border:3px solid currentColor;border-bottom-color:transparent;border-radius:50%;animation:r 0.8s linear infinite;margin-bottom:14px;}@keyframes r{to{transform:rotate(360deg)}}</style></head>
<body>
  <div class="s"></div>
  <h2 style="font-family:Georgia,serif;margin:0 0 6px;">Redirecting to secure payment</h2>
  <p style="opacity:.8;margin:0;">Powered by CCAvenue · Order ${escapeHtml(orderId)} · ₹${escapeHtml(amount)}</p>
  <form id="f" method="post" action="${escapeHtml(checkoutUrl)}">
    <input type="hidden" name="encRequest" value="${escapeHtml(ciphertext)}" />
    <input type="hidden" name="access_code" value="${escapeHtml(ACCESS_CODE)}" />
  </form>
  <script>document.getElementById('f').submit();</script>
</body></html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(html);
};

module.exports.config = { api: { bodyParser: true } };
