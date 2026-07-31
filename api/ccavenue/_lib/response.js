// POST /api/ccavenue/response
// CCAvenue posts here with `encResp` (encrypted payload).
// We decrypt → UPSERT order row → redirect to /thank-you.html with order_id.
//
// UPSERT logic: PATCH by ccavenue_order_id; if 0 rows matched (i.e. pre-insert failed),
// INSERT a new row using the decrypted payload as the only source of truth.

const { decrypt, parseResponse } = require('./ccavenue-crypto');
const { sendOrderConfirmation } = require('../../_lib/email');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') { res.status(405).send('Method Not Allowed'); return; }

  const WORKING_KEY  = (process.env.CCAVENUE_WORKING_KEY || '').trim();
  const SUPABASE_URL = (process.env.SUPABASE_URL?.replace(/\/$/, '').replace(/^(?!https?:\/\/)/, 'https://') || '').trim();
  const SERVICE_KEY  = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const SITE_URL     = (process.env.SITE_URL || `https://${req.headers.host}`).trim();

  if (!WORKING_KEY) {
    console.error('[ccavenue/response] Missing CCAVENUE_WORKING_KEY');
    res.status(500).send('CCAvenue Working Key not configured.'); return;
  }

  const encResp = (req.body && req.body.encResp) || (req.query && req.query.encResp);
  if (!encResp) {
    console.error('[ccavenue/response] No encResp in payload. body=', JSON.stringify(req.body), 'query=', JSON.stringify(req.query));
    res.redirect(302, `${SITE_URL}/thank-you.html?status=invalid&reason=no_payload`);
    return;
  }

  let data = {};
  try {
    const plaintext = decrypt(String(encResp), WORKING_KEY);
    data = parseResponse(plaintext);
    console.log('[ccavenue/response] Decrypted payload:', JSON.stringify({ ...data, card_name: undefined, billing_email: data.billing_email }));
  } catch (err) {
    console.error('[ccavenue/response] Decrypt failed:', err.message);
    res.redirect(302, `${SITE_URL}/thank-you.html?status=invalid&reason=decrypt_failed`);
    return;
  }

  const orderId    = data.order_id;
  const ccStatus   = (data.order_status || '').toLowerCase();   // success | aborted | failure
  const trackingId = data.tracking_id;
  const amount     = data.amount;
  const failureMsg = data.failure_message || '';
  const paymentMode = data.payment_mode || '';

  // Map CCAvenue status → our internal status
  let dbStatus = 'Processing';
  let payStatus = 'Pending';
  if (ccStatus === 'success')        { dbStatus = 'Paid';      payStatus = 'Paid'; }
  else if (ccStatus === 'aborted')   { dbStatus = 'Cancelled'; payStatus = 'Cancelled'; }
  else if (ccStatus === 'failure')   { dbStatus = 'Failed';    payStatus = 'Failed'; }

  console.log(`[ccavenue/response] order=${orderId} status=${ccStatus}→${dbStatus} tracking=${trackingId} amount=${amount}`);

  // ============= UPSERT INTO SUPABASE =============
  let orderRow = null;
  if (SUPABASE_URL && SERVICE_KEY && orderId) {
    const commonFields = {
      status: dbStatus,
      payment_status: payStatus,
      payment_method: paymentMode || 'CCAvenue',
      payment_tracking_id: trackingId || null,
      payment_response: { ...data },
    };

    try {
      // 1️⃣ PATCH (update existing row created by /initiate)
      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/orders?ccavenue_order_id=eq.${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify(commonFields),
      });
      const patched = await patchRes.json();
      if (Array.isArray(patched) && patched[0]) {
        orderRow = patched[0];
        console.log(`[ccavenue/response] PATCH ok rows=${patched.length} id=${orderRow.id} invoice=${orderRow.invoice_number}`);
      } else {
        console.warn(`[ccavenue/response] PATCH returned no rows for order_id=${orderId}. Attempting INSERT (recovery path).`);

        // 2️⃣ INSERT (recovery) — pre-insert was missing, create a minimal order from CCAvenue payload
        const minimalShip = {
          name:    data.billing_name    || '',
          email:   data.billing_email   || '',
          phone:   data.billing_tel     || '',
          address: data.billing_address || '',
          city:    data.billing_city    || '',
          state:   data.billing_state   || '',
          zip:     data.billing_zip     || '',
          country: data.billing_country || 'India',
        };
        const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/orders`, {
          method: 'POST',
          headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
          },
          body: JSON.stringify({
            user_id: null,
            ccavenue_order_id: orderId,
            items: [],          // unknown — admin can add manually if needed
            total_amount: Number(amount || 0),
            items_subtotal: Number(amount || 0),
            shipping_amount: 0,
            discount_amount: 0,
            guest_email: minimalShip.email,
            guest_phone: minimalShip.phone,
            shipping_address: minimalShip,
            ...commonFields,
          }),
        });
        const ins = await insertRes.json();
        if (Array.isArray(ins) && ins[0]) {
          orderRow = ins[0];
          console.log(`[ccavenue/response] INSERT (recovery) ok id=${orderRow.id} invoice=${orderRow.invoice_number}`);
        } else {
          console.error('[ccavenue/response] INSERT recovery failed:', JSON.stringify(ins));
        }
      }
    } catch (e) {
      console.error('[ccavenue/response] Supabase upsert exception:', e.message);
    }
  } else {
    console.error('[ccavenue/response] Skipping DB write — Supabase env or order_id missing.');
  }

  // ============= AUTO-INCREMENT LOYALTY POINTS =============
  if (dbStatus === 'Paid' && orderRow && orderRow.user_id) {
    try {
      // Points = 1 per Rs. 100 spent (rounded up so small transactions get at least 1)
      const earnedPoints = Math.ceil(Number(orderRow.total_amount || 0) / 100);
      if (earnedPoints > 0) {
        const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${orderRow.user_id}&select=loyalty_points`, {
          headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
        }).then(r => r.json());
        
        if (profRes && profRes.length > 0) {
          const currentPoints = Number(profRes[0].loyalty_points || 0);
          await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${orderRow.user_id}`, {
            method: 'PATCH',
            headers: {
              apikey: SERVICE_KEY,
              Authorization: `Bearer ${SERVICE_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ loyalty_points: currentPoints + earnedPoints }),
          });
          console.log(`[ccavenue/response] Added ${earnedPoints} loyalty points to user ${orderRow.user_id}`);
        }
      }
    } catch (e) {
      console.error('[ccavenue/response] Loyalty points increment exception:', e.message);
    }

    // ============= CLEAR CART =============
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/cart_items?user_id=eq.${orderRow.user_id}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
      });
      console.log(`[ccavenue/response] Cleared cart for user ${orderRow.user_id}`);
    } catch(e) {
      console.error('[ccavenue/response] Cart clear exception:', e.message);
    }
  }

  // ============= AUTO-CREATE DELHIVERY AWB ON PAID =============
  if (dbStatus === 'Paid' && orderRow && !orderRow.awb_number && process.env.DELHIVERY_TOKEN) {
    const ADMIN_KEY = process.env.ADMIN_RECOVERY_KEY;
    fetch(`${SITE_URL}/api/delhivery/create-shipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY || '' },
      body: JSON.stringify({ order_id: orderRow.id }),
    }).then(r => r.json()).then(j => {
      console.log('[ccavenue/response] AWB auto-create result:', JSON.stringify(j));
    }).catch(err => console.error('[ccavenue/response] AWB auto-create failed:', err.message));
  }

  // ============= SEND NOTIFICATIONS =============
  if (dbStatus === 'Paid' && orderRow) {
    const phone = orderRow.guest_phone || (orderRow.shipping_address && orderRow.shipping_address.phone);
    const name  = (orderRow.shipping_address && orderRow.shipping_address.name) || 'Customer';
    
    // 1. Send WhatsApp confirmation directly via AiSensy
    const AISENSY_API_KEY = process.env.AISENSY_API_KEY;
    if (AISENSY_API_KEY && phone) {
      const e164 = String(phone).replace(/[^0-9]/g, '').replace(/^0+/, '');
      const finalPhone = e164.startsWith('91') ? e164 : `91${e164}`;
      if (finalPhone.length === 12) {
        fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey: AISENSY_API_KEY,
            campaignName: 'oncost_order_confirm',
            destination: finalPhone,
            userName: name,
            templateParams: [name, orderId, String(amount || orderRow.total_amount || ''), `${SITE_URL}/account.html?tab=orders`],
            source: 'oncost-storefront'
          })
        }).catch(err => console.error('[ccavenue/response] Direct WhatsApp failed:', err.message));
      }
    }

    // 2. Send Custom HTML Invoice Email (includes PDF)
    sendOrderConfirmation(orderRow).catch(err => console.error('[ccavenue/response] Email confirm failed:', err.message));
  }

  // ============= REDIRECT TO THANK-YOU =============
  const params = new URLSearchParams({
    status: ccStatus,
    order_id: orderId || '',
    tracking_id: trackingId || '',
    amount: amount || '',
  }).toString();
  res.redirect(302, `${SITE_URL}/thank-you.html?${params}`);
};

module.exports.config = { api: { bodyParser: true } };
