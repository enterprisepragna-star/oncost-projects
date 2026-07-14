// GET /api/orders/lookup?order_id=OC-xxxx
// Returns order + business profile (for thank-you page invoice).
// Server-side fetch via service key so RLS doesn't block guests.

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '').replace(/^(?!https?:\/\/)/, 'https://');
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    res.status(500).json({ error: 'Supabase not configured.' });
    return;
  }

  const orderId = req.query.order_id;
  if (!orderId) { res.status(400).json({ error: 'order_id required' }); return; }

  try {
    const [orderRes, bizRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/orders?ccavenue_order_id=eq.${encodeURIComponent(orderId)}&select=*&limit=1`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      }),
      fetch(`${SUPABASE_URL}/rest/v1/business_profile?select=*&limit=1`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      }),
    ]);
    const orders = await orderRes.json();
    const biz    = await bizRes.json();
    const order  = Array.isArray(orders) ? orders[0] : null;
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }

    // Strip sensitive payment_response details before sending to client
    const safe = { ...order };
    if (safe.payment_response) {
      const r = safe.payment_response;
      safe.payment_response = {
        bank_ref_no: r.bank_ref_no || null,
        payment_mode: r.payment_mode || null,
        card_name: r.card_name || null,
        currency: r.currency || 'INR',
      };
    }

    res.status(200).json({
      order: safe,
      business: Array.isArray(biz) && biz[0] ? biz[0] : null,
    });
  } catch (e) {
    console.error('[orders/lookup] error:', e.message);
    res.status(500).json({ error: e.message });
  }
};

module.exports.config = { api: { bodyParser: true } };
