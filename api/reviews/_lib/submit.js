// POST /api/reviews/submit
// Customer submits a product review.
//
// Accepts:
//   - Logged-in user + product_id → verifies they have a Paid/Delivered order
//     containing this product; inserts is_verified=true.
//   - Magic-link token (review_token from /api/reviews/request) → no login needed,
//     inserts is_verified=true linked to the original order.
//
// Body: {
//   product_id:    string   (required)
//   rating:        1-5
//   review_text:   string
//   title?:        string
//   customer_name: string   (if guest via token)
//   image_url?:    string
//   user_token?:   string   (Supabase auth JWT — if logged in)
//   review_token?: string   (magic link token from email/WhatsApp request)
// }

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANON_KEY     = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    res.status(500).json({ error: 'Supabase not configured.' });
    return;
  }

  const b = req.body || {};
  const productId  = String(b.product_id || '').trim();
  const rating     = Math.max(1, Math.min(5, Number(b.rating) || 5));
  const reviewText = String(b.review_text || '').trim();
  const title      = String(b.title || '').trim() || null;
  const imageUrl   = b.image_url ? String(b.image_url).trim() : null;
  let   custName   = String(b.customer_name || '').trim();
  const userToken  = b.user_token;
  const reviewTok  = b.review_token;

  if (!productId)  { res.status(400).json({ error: 'product_id required' });  return; }
  if (!reviewText) { res.status(400).json({ error: 'review_text required' }); return; }
  if (reviewText.length < 10) { res.status(400).json({ error: 'Review must be at least 10 characters' }); return; }

  // -----------------------------------------------------------------------------
  // Determine reviewer identity via one of these paths:
  //   A) review_token (magic link) → look up order_id, infer user
  //   B) user_token (logged-in)    → verify ownership, find matching delivered order
  // -----------------------------------------------------------------------------
  let userId = null;
  let orderId = null;
  let isVerified = false;

  if (reviewTok) {
    // PATH A — magic link from admin "Request Review"
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/orders?review_token=eq.${encodeURIComponent(reviewTok)}&select=id,user_id,guest_email,shipping_address,items,status&limit=1`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      });
      const arr = await r.json();
      const order = Array.isArray(arr) ? arr[0] : null;
      if (!order) { res.status(404).json({ error: 'Invalid or expired review link.' }); return; }
      if (!['Paid','Packed','Shipped','Delivered'].includes(order.status)) {
        res.status(400).json({ error: 'Order is not eligible for review yet.' }); return;
      }
      const items = Array.isArray(order.items) ? order.items : [];
      if (!items.some(it => it.product_id === productId)) {
        res.status(403).json({ error: 'This product was not in your order.' }); return;
      }
      userId = order.user_id;
      orderId = order.id;
      isVerified = true;
      if (!custName) custName = order.shipping_address?.name || (order.guest_email || '').split('@')[0] || 'Verified Buyer';
    } catch (e) {
      console.error('[reviews/submit] magic-link lookup error', e.message);
      res.status(500).json({ error: 'Could not verify review link.' }); return;
    }
  } else if (userToken) {
    // PATH B — logged-in user, verify a paid order containing this product
    try {
      // Resolve user from JWT (service key works as apikey here)
      const meRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: ANON_KEY || SERVICE_KEY, Authorization: `Bearer ${userToken}` },
      });
      const me = await meRes.json();
      if (!me || !me.id) { res.status(401).json({ error: 'Invalid session — please log in again.' }); return; }
      userId = me.id;
      if (!custName) custName = me.user_metadata?.name || me.email?.split('@')[0] || 'Customer';

      // Find a Paid/Delivered order by this user containing the product
      const oRes = await fetch(`${SUPABASE_URL}/rest/v1/orders?user_id=eq.${encodeURIComponent(userId)}&status=in.(Paid,Packed,Shipped,Delivered)&select=id,items&order=created_at.desc&limit=20`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      });
      const orders = await oRes.json();
      const matching = (Array.isArray(orders) ? orders : []).find(o => Array.isArray(o.items) && o.items.some(it => it.product_id === productId));
      if (!matching) {
        res.status(403).json({ error: 'Only verified buyers can review this product. Please make a purchase first.' });
        return;
      }
      orderId = matching.id;
      isVerified = true;
    } catch (e) {
      console.error('[reviews/submit] auth verification error', e.message);
      res.status(500).json({ error: 'Could not verify your account.' }); return;
    }
  } else {
    res.status(401).json({ error: 'Please log in to submit a review (or use the review link sent to you).' });
    return;
  }

  if (!custName) custName = 'Customer';

  // Prevent duplicate review: same user + product
  try {
    const dupRes = await fetch(`${SUPABASE_URL}/rest/v1/testimonials?product_id=eq.${encodeURIComponent(productId)}&user_id=eq.${encodeURIComponent(userId || '')}&select=id&limit=1`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    const dup = await dupRes.json();
    if (Array.isArray(dup) && dup[0]) {
      res.status(409).json({ error: 'You have already reviewed this product.' }); return;
    }
  } catch (_) { /* non-fatal */ }

  // Insert testimonial
  try {
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/testimonials`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        user_id: userId,
        product_id: productId,
        order_id: orderId,
        customer_name: custName,
        rating,
        title,
        review_text: reviewText,
        image_url: imageUrl,
        is_verified: isVerified,
        status: 'Pending',   // admin moderation step (auto-approve config could be added later)
      }),
    });
    if (!insertRes.ok) {
      const err = await insertRes.text();
      console.error('[reviews/submit] insert failed', err);
      res.status(500).json({ error: 'Could not save your review.' }); return;
    }
    const arr = await insertRes.json();
    res.status(200).json({ ok: true, testimonial: Array.isArray(arr) ? arr[0] : arr, message: 'Thanks! Your review is pending moderation.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

module.exports.config = { api: { bodyParser: true } };
