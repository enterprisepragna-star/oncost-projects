// POST /api/reviews/request
// Admin clicks "Request Review" on a Delivered order → we generate a magic-link
// token, stamp it on the order row, and send a WhatsApp message via AiSensy.
//
// Auth: x-admin-key header must match ADMIN_RECOVERY_KEY env var.
//
// Body: { order_id: uuid }  (the Supabase orders.id, NOT ccavenue_order_id)

const crypto = require('crypto');

// Sub-handler: scan Delivered orders aged ≥ N days and send review requests automatically.
// Triggered by Vercel cron: GET /api/reviews/request?cron=1
// Auth: relies on Vercel cron user-agent OR ?secret=$CRON_SECRET OR x-admin-key header.
async function handleCron(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ADMIN_KEY    = process.env.ADMIN_RECOVERY_KEY;
  const CRON_SECRET  = process.env.CRON_SECRET;
  const SITE_URL     = process.env.SITE_URL || `https://${req.headers.host}`;
  const INTERNAL_KEY = process.env.INTERNAL_API_KEY;
  const DELAY_DAYS   = Number(process.env.REVIEW_REQUEST_DELAY_DAYS || 2);

  // Auth: Vercel cron OR secret OR admin key
  const ua = req.headers['user-agent'] || '';
  const isVercelCron = ua.includes('vercel-cron');
  const okSecret = CRON_SECRET && (req.query.secret === CRON_SECRET || req.headers.authorization === `Bearer ${CRON_SECRET}`);
  const okAdmin  = req.headers['x-admin-key'] === ADMIN_KEY;
  if (!isVercelCron && !okSecret && !okAdmin) {
    return res.status(401).json({ error: 'Cron auth required (Vercel cron / x-admin-key / ?secret=)' });
  }
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Supabase env missing' });

  // Find Delivered orders ≥ DELAY_DAYS old that have not had a review request sent yet
  const cutoff = new Date(Date.now() - DELAY_DAYS * 86400000).toISOString();
  const qs = new URLSearchParams({
    status: 'eq.Delivered',
    review_request_sent_at: 'is.null',
    select: 'id,ccavenue_order_id,items,shipping_address,guest_email,guest_phone,delivered_at,updated_at,review_token',
    limit: '50',
  });
  // Either delivered_at OR updated_at <= cutoff (covers schemas where delivered_at not set)
  qs.append('or', `(delivered_at.lte.${cutoff},and(delivered_at.is.null,updated_at.lte.${cutoff}))`);

  const oRes = await fetch(`${SUPABASE_URL}/rest/v1/orders?${qs.toString()}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const orders = await oRes.json();
  if (!Array.isArray(orders)) {
    console.error('[reviews/cron] orders query failed', orders);
    return res.status(500).json({ error: 'orders query failed', detail: orders });
  }

  const results = [];
  for (const order of orders) {
    try {
      let token = order.review_token;
      if (!token) {
        token = crypto.randomBytes(20).toString('hex');
        await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(order.id)}`, {
          method: 'PATCH',
          headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ review_token: token }),
        });
      }
      const items = Array.isArray(order.items) ? order.items : [];
      const firstProductId = (items[0] && items[0].product_id) || '';
      const productName    = (items[0] && items[0].name)       || 'your order';
      const reviewLink = `${SITE_URL}/product.html?id=${encodeURIComponent(firstProductId)}&review_token=${encodeURIComponent(token)}`;
      const name  = order.shipping_address?.name || 'Customer';
      const email = order.guest_email || order.shipping_address?.email;
      const phone = order.guest_phone || order.shipping_address?.phone;

      const sentChannels = [];

      // Email via Resend (testimonial_request)
      if (email && process.env.RESEND_API_KEY) {
        try {
          await fetch(`${SITE_URL}/api/email/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal': '1' },
            body: JSON.stringify({
              type: 'testimonial_request',
              to: email,
              data: { name, product_name: productName, review_link: reviewLink },
            }),
          });
          sentChannels.push('email');
        } catch (e) { console.error('[reviews/cron] email failed', e.message); }
      }

      // WhatsApp via AiSensy
      if (phone) {
        try {
          await fetch(`${SITE_URL}/api/whatsapp?action=send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(INTERNAL_KEY ? { 'x-internal-key': INTERNAL_KEY } : {}) },
            body: JSON.stringify({
              type: 'review_request',
              to: phone,
              params: { customer_name: name, product_name: productName, review_link: reviewLink },
            }),
          });
          sentChannels.push('whatsapp');
        } catch (e) { console.error('[reviews/cron] whatsapp failed', e.message); }
      }

      // Mark sent so we never resend
      await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(order.id)}`, {
        method: 'PATCH',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_request_sent_at: new Date().toISOString() }),
      });
      results.push({ order_id: order.id, channels: sentChannels });
    } catch (e) {
      results.push({ order_id: order.id, error: e.message });
    }
  }

  console.log(`[reviews/cron] processed=${results.length}`);
  res.status(200).json({ ok: true, processed: results.length, results });
}

module.exports = async function handler(req, res) {
  // Cron mode (Vercel scheduled job)
  if (req.query && (req.query.cron === '1' || req.query.cron === 'true')) {
    return handleCron(req, res);
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ADMIN_KEY    = process.env.ADMIN_RECOVERY_KEY;
  const SITE_URL     = process.env.SITE_URL || `https://${req.headers.host}`;
  const INTERNAL_KEY = process.env.INTERNAL_API_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase not configured.' }); return; }
  if (!ADMIN_KEY)                    { res.status(500).json({ error: 'ADMIN_RECOVERY_KEY missing.' }); return; }
  if (req.headers['x-admin-key'] !== ADMIN_KEY) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const orderId = (req.body && req.body.order_id) || '';
  if (!orderId) { res.status(400).json({ error: 'order_id required' }); return; }

  try {
    // 1. Load order
    const oRes = await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=*&limit=1`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    const orders = await oRes.json();
    const order = Array.isArray(orders) ? orders[0] : null;
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }
    if (!['Paid','Packed','Shipped','Delivered'].includes(order.status)) {
      res.status(400).json({ error: 'Order must be Paid/Delivered before requesting a review.' }); return;
    }

    // 2. Ensure review_token exists on the order (idempotent — reuse if already set)
    let token = order.review_token;
    if (!token) {
      token = crypto.randomBytes(20).toString('hex');
      const upd = await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        headers: {
          apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ review_token: token }),
      });
      if (!upd.ok) {
        const t = await upd.text();
        console.error('[reviews/request] token persist failed', t);
        res.status(500).json({ error: 'Could not store review token (run migration_reviews.sql)' }); return;
      }
    }

    // 3. Build link — points to first product in the order for now
    const items = Array.isArray(order.items) ? order.items : [];
    const firstProductId = (items[0] && items[0].product_id) || '';
    const reviewLink = `${SITE_URL}/product.html?id=${encodeURIComponent(firstProductId)}&review_token=${encodeURIComponent(token)}`;

    // 4. Try sending WhatsApp via internal AiSensy endpoint
    const phone = order.guest_phone || (order.shipping_address && order.shipping_address.phone);
    const name  = (order.shipping_address && order.shipping_address.name) || 'Customer';
    let waSent = false;
    let waError = null;

    if (phone) {
      try {
        const waRes = await fetch(`${SITE_URL}/api/whatsapp?action=send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(INTERNAL_KEY ? { 'x-internal-key': INTERNAL_KEY } : {}) },
          body: JSON.stringify({
            type: 'review_request',
            to: phone,
            params: {
              customer_name: name,
              product_name: (items[0] && items[0].name) || 'your order',
              review_link: reviewLink,
            },
          }),
        });
        waSent = waRes.ok;
        if (!waRes.ok) waError = await waRes.text();
      } catch (e) {
        waError = e.message;
      }
    }

    // 5. Always return the link (admin can copy/share manually if WhatsApp fails)
    res.status(200).json({
      ok: true,
      token,
      review_link: reviewLink,
      whatsapp_sent: waSent,
      whatsapp_error: waSent ? null : waError,
      copy_paste_message: `Hi ${name}! Thanks for shopping with ONCOST. How was your experience with ${(items[0] && items[0].name) || 'your order'}? Leave a quick review: ${reviewLink}`,
    });
  } catch (e) {
    console.error('[reviews/request] exception', e.message);
    res.status(500).json({ error: e.message });
  }
};

module.exports.config = { api: { bodyParser: true } };
