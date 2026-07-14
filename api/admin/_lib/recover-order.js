// /api/admin/recover-order
//
//   POST /api/admin/recover-order              → manually upsert an order from CCAvenue lookup
//   GET  /api/admin/recover-order?action=diagnose&order_id=OC-...   → full diagnostic
//
// Auth (both): header `x-admin-key: $ADMIN_RECOVERY_KEY`  (or ?key= for GET diagnose only)

module.exports = async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ADMIN_KEY    = process.env.ADMIN_RECOVERY_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Supabase not configured.' });
  if (!ADMIN_KEY)                     return res.status(500).json({ error: 'ADMIN_RECOVERY_KEY not configured in env.' });

  const providedKey = req.headers['x-admin-key'] || (req.body && req.body.admin_key) || req.query.key;
  if (providedKey !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized — invalid admin key.' });

  // ----- DIAGNOSE MODE -----
  if (req.query.action === 'diagnose' || req.method === 'GET') {
    return diagnose(req, res, SUPABASE_URL, SERVICE_KEY);
  }

  // ----- RECOVER MODE (POST) -----
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  return recover(req, res, SUPABASE_URL, SERVICE_KEY);
};

async function diagnose(req, res, SUPABASE_URL, SERVICE_KEY) {
  const out = { ok: true, checks: {} };
  const sb = async (path) => {
    const r = await fetch(`${SUPABASE_URL}${path}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, ok: r.ok, body: json };
  };

  // 1) Supabase reachability + RLS bypass check via service key
  out.checks.connectivity = await sb('/rest/v1/orders?select=id&limit=1');

  // 2) Required columns sanity-check
  out.checks.schema = await sb('/rest/v1/orders?select=id,ccavenue_order_id,payment_response,payment_tracking_id,invoice_number,items,total_amount,shipping_amount,items_subtotal,discount_amount,guest_email,guest_phone,shipping_address,status,payment_status,payment_method,awb_number,tracking_url,delivered_at,review_request_sent_at&limit=1');

  // 3) Recent orders — are ANY orders being created?
  out.checks.recent_orders = await sb('/rest/v1/orders?select=id,ccavenue_order_id,status,payment_status,guest_email,created_at,invoice_number,awb_number&order=created_at.desc&limit=10');

  // 4) Specific order lookup (if order_id provided)
  const orderId = req.query.order_id;
  if (orderId) {
    out.checks.this_order = await sb(`/rest/v1/orders?ccavenue_order_id=eq.${encodeURIComponent(orderId)}&select=*&limit=1`);
  }

  // 5) Env summary (booleans only — never echo values)
  out.checks.env = {
    SUPABASE_URL:                !!process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY:   !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    CCAVENUE_MERCHANT_ID:        !!process.env.CCAVENUE_MERCHANT_ID,
    CCAVENUE_ACCESS_CODE:        !!process.env.CCAVENUE_ACCESS_CODE,
    CCAVENUE_WORKING_KEY:        !!process.env.CCAVENUE_WORKING_KEY,
    CCAVENUE_ENV:                process.env.CCAVENUE_ENV || 'test',
    SITE_URL:                    process.env.SITE_URL || null,
    RESEND_API_KEY:              !!process.env.RESEND_API_KEY,
    DELHIVERY_TOKEN:             !!process.env.DELHIVERY_TOKEN,
    DELHIVERY_PICKUP_PINCODE:    process.env.DELHIVERY_PICKUP_PINCODE || null,
    AISENSY_API_KEY:             !!process.env.AISENSY_API_KEY,
  };

  // 6) Try a dry-run insert + delete (proves writes work end-to-end)
  const probeId = `DIAG-${Date.now()}`;
  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/orders`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({
      ccavenue_order_id: probeId,
      items: [], total_amount: 1, items_subtotal: 1, shipping_amount: 0, discount_amount: 0,
      status: 'Processing', payment_status: 'Pending',
      guest_email: 'diag@oncost.shop', guest_phone: '0000000000',
      shipping_address: { name: 'Diagnostic', email: 'diag@oncost.shop', phone: '0000000000' },
    }),
  });
  const insertBody = await insertRes.text();
  let insertJson; try { insertJson = JSON.parse(insertBody); } catch { insertJson = insertBody; }
  out.checks.write_probe = { status: insertRes.status, ok: insertRes.ok, body: insertJson };

  // Clean up the probe row (best-effort)
  if (insertRes.ok) {
    await fetch(`${SUPABASE_URL}/rest/v1/orders?ccavenue_order_id=eq.${probeId}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
  }

  // Summary
  out.summary = {
    connectivity_ok:  out.checks.connectivity.ok,
    schema_ok:        out.checks.schema.ok,
    write_probe_ok:   out.checks.write_probe.ok,
    orders_in_db:     Array.isArray(out.checks.recent_orders.body) ? out.checks.recent_orders.body.length : 0,
    this_order_found: out.checks.this_order ? (Array.isArray(out.checks.this_order.body) && out.checks.this_order.body[0] ? true : false) : null,
  };

  res.status(200).json(out);
}

async function recover(req, res, SUPABASE_URL, SERVICE_KEY) {
  const b = req.body || {};
  const orderId = b.order_id;
  if (!orderId) return res.status(400).json({ error: 'order_id required' });

  const amount = Number(b.amount || 0);
  if (amount <= 0) return res.status(400).json({ error: 'Valid amount required' });

  const status = b.status || 'Paid';
  const payStatus = status === 'Paid' ? 'Paid' : (status === 'Cancelled' ? 'Cancelled' : status === 'Failed' ? 'Failed' : 'Pending');

  const row = {
    user_id: null,
    ccavenue_order_id: orderId,
    items: Array.isArray(b.items) ? b.items : [],
    total_amount: amount,
    items_subtotal: amount,
    shipping_amount: 0,
    discount_amount: 0,
    guest_email: b.guest_email || null,
    guest_phone: b.guest_phone || null,
    shipping_address: b.shipping_address || {},
    status,
    payment_status: payStatus,
    payment_method: 'CCAvenue',
    payment_tracking_id: b.tracking_id || null,
    payment_response: {
      recovered: true,
      recovered_at: new Date().toISOString(),
      notes: b.notes || 'Manually recovered from CCAvenue dashboard',
      order_status: status.toLowerCase(),
      amount: String(amount),
      tracking_id: b.tracking_id || '',
    },
  };

  try {
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/orders`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation,resolution=merge-duplicates',
      },
      body: JSON.stringify(row),
    });
    if (insertRes.ok) {
      const arr = await insertRes.json();
      return res.status(200).json({ ok: true, order: Array.isArray(arr) ? arr[0] : arr, action: 'upserted' });
    }
    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/orders?ccavenue_order_id=eq.${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: {
        apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(row),
    });
    if (patchRes.ok) {
      const arr = await patchRes.json();
      return res.status(200).json({ ok: true, order: Array.isArray(arr) ? arr[0] : arr, action: 'patched' });
    }
    const errTxt = await patchRes.text();
    res.status(500).json({ error: 'Recovery failed', insert_status: insertRes.status, details: errTxt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports.config = { api: { bodyParser: true } };
