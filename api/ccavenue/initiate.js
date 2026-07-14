// POST /api/ccavenue/initiate
// Body: { items, total_amount, shipping_address: {name,email,phone,address,city,state,zip}, user_id, applied_coupon }
// 1. Inserts a 'Processing' order row into Supabase (using SERVICE_ROLE_KEY → bypasses RLS).
// 2. Returns an auto-submitting HTML form that posts to CCAvenue's secure checkout endpoint.
//
// This is the SINGLE source of order creation — frontend never touches the orders table directly
// for new orders. That guarantees no RLS / schema-mismatch failures.

const { encrypt, buildMerchantData } = require('./lib/ccavenue-crypto');

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
  const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
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
  const discountAmt  = Number(body.discount_amount || 0);

  if (Number(amount) <= 0) { res.status(400).json({ error: 'Invalid amount' }); return; }
  if (!ship.email || !ship.name || !ship.phone) { res.status(400).json({ error: 'Missing customer email / name / phone' }); return; }

  // ---------- LOYALTY REDEMPTION (server-side validation) ----------
  // 1 point = ₹1. Max redeemable = 50% of items subtotal, capped at balance.
  let loyaltyPoints = 0;
  const requestedPoints = Math.floor(Number(body.loyalty_points || 0));
  const validUser = userId && /^[0-9a-f-]{36}$/i.test(userId);
  if (requestedPoints > 0 && validUser) {
    try {
      const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=loyalty_points&limit=1`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      });
      const profs = await profRes.json();
      const balance = Math.max(0, Math.floor(Number((Array.isArray(profs) && profs[0] && profs[0].loyalty_points) || 0)));
      const maxByOrder = Math.floor(subtotal * 0.5);
      loyaltyPoints = Math.min(requestedPoints, balance, maxByOrder);
      if (loyaltyPoints > 0) {
        const txnRes = await fetch(`${SUPABASE_URL}/rest/v1/loyalty_transactions`, {
          method: 'POST',
          headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({
            user_id: userId, type: 'redeem', points: -loyaltyPoints,
            note: `Redeemed on order ${orderId}`, created_by: 'checkout',
          }),
        });
        if (!txnRes.ok) {
          console.error('[ccavenue/initiate] loyalty redeem txn failed:', await txnRes.text());
          loyaltyPoints = 0; // don't apply discount if ledger write failed
        }
      }
    } catch (e) {
      console.error('[ccavenue/initiate] loyalty validation failed:', e.message);
      loyaltyPoints = 0;
    }
  }
  // Recompute the payable amount server-side (client totals are advisory only)
  const serverTotal = Math.max(1, subtotal - discountAmt + shippingAmt - loyaltyPoints);
  const payAmount = loyaltyPoints > 0 ? serverTotal.toFixed(2) : amount;

  // 1️⃣  Insert pending order in Supabase via service role (bypasses RLS, guaranteed write)
  try {
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/orders`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        user_id: userId && /^[0-9a-f-]{36}$/i.test(userId) ? userId : null,
        ccavenue_order_id: orderId,
        items,
        total_amount: Number(payAmount),
        items_subtotal: subtotal || Number(payAmount),
        shipping_amount: shippingAmt,
        discount_amount: discountAmt,
        loyalty_points_redeemed: loyaltyPoints,
        loyalty_discount: loyaltyPoints,
        status: 'Processing',
        payment_status: 'Pending',
        payment_method: 'CCAvenue',
        guest_email: ship.email,
        guest_phone: ship.phone,
        shipping_address: ship,
      }),
    });
    if (!insertRes.ok) {
      const errTxt = await insertRes.text();
      console.error('[ccavenue/initiate] Supabase insert failed:', insertRes.status, errTxt);
      // Do NOT block payment — webhook will UPSERT later. But log it loudly.
    } else {
      console.log('[ccavenue/initiate] Supabase order created:', orderId);
    }
  } catch (e) {
    console.error('[ccavenue/initiate] Supabase insert exception:', e.message);
    // continue anyway — webhook will upsert
  }

  // 2️⃣  Build CCAvenue encrypted payload
  const payload = {
    merchant_id:      MERCHANT_ID,
    order_id:         orderId,
    amount:           payAmount,
    currency:         'INR',
    redirect_url:     `${SITE_URL}/api/ccavenue/response`,
    cancel_url:       `${SITE_URL}/api/ccavenue/response`,
    language:         'EN',
    billing_name:     ship.name,
    billing_address:  ship.address || '',
    billing_city:     ship.city || '',
    billing_state:    ship.state || '',
    billing_zip:      ship.zip || '',
    billing_country:  ship.country || 'India',
    billing_tel:      ship.phone,
    billing_email:    ship.email,
    delivery_name:    ship.name,
    delivery_address: ship.address || '',
    delivery_city:    ship.city || '',
    delivery_state:   ship.state || '',
    delivery_zip:     ship.zip || '',
    delivery_country: ship.country || 'India',
    delivery_tel:     ship.phone,
    merchant_param1:  userId || 'guest',
    merchant_param2:  ship.email.substring(0, 250),
    merchant_param3:  appliedCoup,
  };

  const plaintext  = buildMerchantData(payload);
  const ciphertext = encrypt(plaintext, WORKING_KEY);

  const checkoutUrl = CCAV_URL[ENV] || CCAV_URL.test;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Redirecting to CCAvenue…</title>
<style>body{font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#7a1f35;color:#f2dd92;text-align:center;padding:24px;}.s{width:34px;height:34px;border:3px solid currentColor;border-bottom-color:transparent;border-radius:50%;animation:r 0.8s linear infinite;margin-bottom:14px;}@keyframes r{to{transform:rotate(360deg)}}</style></head>
<body>
  <div class="s"></div>
  <h2 style="font-family:Georgia,serif;margin:0 0 6px;">Redirecting to secure payment</h2>
  <p style="opacity:.8;margin:0;">Powered by CCAvenue · Order ${escapeHtml(orderId)} · ₹${escapeHtml(payAmount)}</p>
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
