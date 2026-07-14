// /api/store — customer-facing dispatcher (Vercel 12-function limit workaround)
//
// Actions (via vercel.json rewrite /api/store/:action or ?action=):
//   complaint-submit  (POST)  — insert complaint via service key, email notifications
//   cancel-order      (POST)  — customer cancels own un-shipped order (user token auth)
//   invoice-pdf       (GET)   — stream GST invoice PDF for an order

const { generateInvoicePDF } = require('../email/lib/invoice-pdf');

function env() {
  return {
    SUPABASE_URL: (process.env.SUPABASE_URL || '').trim(),
    SERVICE_KEY: (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
    SITE_URL: (process.env.SITE_URL || 'https://www.oncost.shop').trim(),
  };
}

async function sb(path, opts = {}) {
  const { SUPABASE_URL, SERVICE_KEY } = env();
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { ok: r.ok, status: r.status, body: json };
}

async function getUserFromToken(req) {
  const auth = req.headers.authorization;
  if (!auth) return null;
  const { SUPABASE_URL, SERVICE_KEY } = env();
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey: SERVICE_KEY } });
  if (!r.ok) return null;
  return r.json();
}

module.exports = async function handler(req, res) {
  const { SUPABASE_URL, SERVICE_KEY } = env();
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Supabase not configured' });

  const url = req.url || '';
  const lastSeg = url.split('?')[0].split('/').filter(Boolean).pop() || '';
  const action = (req.query.action || lastSeg || '').toLowerCase();

  if (action === 'complaint-submit') return complaintSubmit(req, res);
  if (action === 'cancel-order') return cancelOrder(req, res);
  if (action === 'invoice-pdf') return invoicePdf(req, res);
  res.status(404).json({ error: 'Unknown store action', got: action });
};
module.exports.config = { api: { bodyParser: true } };

// ---------------------------------------------------------------------------
// COMPLAINT SUBMIT — guest-safe (service key insert returns ticket_number)
// ---------------------------------------------------------------------------
async function complaintSubmit(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  const b = req.body || {};
  const name = String(b.customer_name || '').trim();
  const email = String(b.email || '').trim();
  const category = String(b.category || '').trim();
  const subject = String(b.subject || '').trim();
  const description = String(b.description || '').trim();

  if (name.length < 2) return res.status(400).json({ error: 'Please enter your name.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (b.phone && !/^[+\d][\d\s-]{7,15}$/.test(String(b.phone).trim())) return res.status(400).json({ error: 'Please enter a valid mobile number.' });
  if (!category) return res.status(400).json({ error: 'Please select an issue category.' });
  if (subject.length < 3) return res.status(400).json({ error: 'Please enter a short subject.' });
  if (description.length < 20) return res.status(400).json({ error: 'Description must be at least 20 characters.' });

  // Resolve order UUID from CCAvenue order id or raw UUID
  let orderUuid = null;
  const orderInput = String(b.order_id || '').trim();
  if (orderInput) {
    const isUuid = /^[0-9a-f-]{36}$/i.test(orderInput);
    const q = isUuid
      ? `/rest/v1/orders?or=(id.eq.${orderInput},ccavenue_order_id.eq.${encodeURIComponent(orderInput)})&select=id&limit=1`
      : `/rest/v1/orders?ccavenue_order_id=eq.${encodeURIComponent(orderInput)}&select=id&limit=1`;
    const found = await sb(q);
    if (found.ok && Array.isArray(found.body) && found.body[0]) orderUuid = found.body[0].id;
  }

  const ins = await sb('/rest/v1/complaints', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      user_id: b.user_id && /^[0-9a-f-]{36}$/i.test(b.user_id) ? b.user_id : null,
      order_id: orderUuid,
      guest_email: email,
      guest_phone: b.phone ? String(b.phone).trim() : null,
      customer_name: name,
      category, subject, description,
      attachments: Array.isArray(b.attachments) ? b.attachments.slice(0, 4) : [],
      status: 'Open',
      priority: 'Normal',
    }),
  });
  if (!ins.ok) {
    console.error('[store/complaint-submit] insert failed:', ins.status, JSON.stringify(ins.body));
    return res.status(500).json({ error: 'Could not save your complaint. Please try again or WhatsApp us.' });
  }
  const row = Array.isArray(ins.body) ? ins.body[0] : ins.body;
  const ticket = row.ticket_number || ('CMP-' + String(row.id).substring(0, 8));

  // Fire-and-forget email notifications
  const { SITE_URL } = env();
  const fire = (payload) => fetch(`${SITE_URL}/api/email/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal': '1' },
    body: JSON.stringify(payload),
  }).catch((e) => console.error('[store/complaint-submit] email failed:', e.message));

  fire({ type: 'complaint_admin_notify', data: { ticket, name, email, phone: b.phone || '', category, subject, description, order_id: orderInput || '' } });
  fire({ type: 'complaint_ack', to: email, data: { ticket, name, subject } });

  res.status(200).json({ ok: true, ticket_number: ticket, id: row.id });
}

// ---------------------------------------------------------------------------
// CANCEL ORDER — logged-in customer, own order, not yet shipped
// ---------------------------------------------------------------------------
const CANCELLABLE = ['Processing', 'Pending', 'Paid', 'Confirmed', 'Packed'];

async function cancelOrder(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  const user = await getUserFromToken(req);
  if (!user || !user.id) return res.status(401).json({ error: 'Please sign in to cancel an order.' });

  const orderId = String((req.body || {}).order_id || '').trim();
  if (!orderId) return res.status(400).json({ error: 'order_id required' });

  const isUuid = /^[0-9a-f-]{36}$/i.test(orderId);
  const q = isUuid
    ? `/rest/v1/orders?id=eq.${orderId}&select=*&limit=1`
    : `/rest/v1/orders?ccavenue_order_id=eq.${encodeURIComponent(orderId)}&select=*&limit=1`;
  const found = await sb(q);
  const order = found.ok && Array.isArray(found.body) ? found.body[0] : null;
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const owns = order.user_id === user.id ||
    (order.guest_email && user.email && order.guest_email.toLowerCase() === user.email.toLowerCase());
  if (!owns) return res.status(403).json({ error: 'This order does not belong to your account.' });
  if (!CANCELLABLE.includes(order.status)) {
    return res.status(400).json({ error: `Order can no longer be cancelled (status: ${order.status}). Please contact support.` });
  }

  const patch = await sb(`/rest/v1/orders?id=eq.${order.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'Cancelled', cancelled_at: new Date().toISOString() }),
  });
  if (!patch.ok) return res.status(500).json({ error: 'Cancellation failed. Please contact support.' });

  // Refund redeemed loyalty points, once
  if (Number(order.loyalty_points_redeemed || 0) > 0 && !order.loyalty_refunded_at && order.user_id) {
    await sb('/rest/v1/loyalty_transactions', {
      method: 'POST',
      body: JSON.stringify({
        user_id: order.user_id, order_id: order.id, type: 'refund',
        points: Number(order.loyalty_points_redeemed),
        note: `Refund — order ${order.ccavenue_order_id || order.id} cancelled`, created_by: 'system',
      }),
    });
    await sb(`/rest/v1/orders?id=eq.${order.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ loyalty_refunded_at: new Date().toISOString() }),
    });
  }

  res.status(200).json({ ok: true, status: 'Cancelled' });
}

// ---------------------------------------------------------------------------
// INVOICE PDF — stream branded GST invoice; auth via user token OR email match
// ---------------------------------------------------------------------------
async function invoicePdf(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET required' });
  const orderId = String(req.query.order_id || '').trim();
  if (!orderId) return res.status(400).json({ error: 'order_id required' });

  const isUuid = /^[0-9a-f-]{36}$/i.test(orderId);
  const q = isUuid
    ? `/rest/v1/orders?id=eq.${orderId}&select=*&limit=1`
    : `/rest/v1/orders?ccavenue_order_id=eq.${encodeURIComponent(orderId)}&select=*&limit=1`;
  const found = await sb(q);
  const order = found.ok && Array.isArray(found.body) ? found.body[0] : null;
  if (!order) return res.status(404).json({ error: 'Order not found' });

  // Auth: token owner OR email matches the order
  let authorized = false;
  const emailParam = String(req.query.email || '').trim().toLowerCase();
  if (emailParam && order.guest_email && order.guest_email.toLowerCase() === emailParam) authorized = true;
  if (!authorized) {
    const user = await getUserFromToken(req);
    if (user && (user.id === order.user_id ||
        (order.guest_email && user.email && order.guest_email.toLowerCase() === user.email.toLowerCase()))) {
      authorized = true;
    }
  }
  if (!authorized) return res.status(403).json({ error: 'Not authorized for this invoice.' });

  // Enrich items with HSN / GST from products
  const products = {};
  const ids = Array.from(new Set((order.items || []).map((it) => it.product_id).filter(Boolean)));
  if (ids.length) {
    const filter = ids.map((id) => `"${id}"`).join(',');
    const pr = await sb(`/rest/v1/products?id=in.(${filter})&select=id,name,hsn_code,gst_percent`);
    if (pr.ok && Array.isArray(pr.body)) pr.body.forEach((p) => { products[p.id] = p; });
  }

  try {
    const pdf = await generateInvoicePDF({ order, products });
    const fname = `Invoice-${(order.invoice_number || order.ccavenue_order_id || 'oncost').replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.status(200).send(Buffer.from(pdf));
  } catch (e) {
    console.error('[store/invoice-pdf] failed:', e.message);
    res.status(500).json({ error: 'Invoice generation failed: ' + e.message });
  }
}
