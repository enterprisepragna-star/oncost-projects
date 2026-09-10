// Unified WhatsApp dispatcher — replaces send.js + webhook.js + abandoned-cart-cron.js
// Action via ?action=... or trailing path segment.
//
//   POST /api/whatsapp/send                    → outbound message (x-internal-key)
//   POST /api/whatsapp/webhook                 → AiSensy inbound (called by AiSensy)
//   GET  /api/whatsapp/abandoned-cart-cron     → Vercel cron (daily 12:00 UTC)

function parseAction(req) {
  if (req.query && req.query.action) return req.query.action;
  const path = (req.url || '').split('?')[0].replace(/\/+$/, '');
  const seg = path.split('/').pop();
  if (seg && seg !== 'whatsapp' && seg !== 'index') return seg;
  return null;
}

async function handleSend(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const AISENSY_API_KEY = process.env.AISENSY_API_KEY;
  const INTERNAL_KEY    = process.env.INTERNAL_API_KEY;
  if (!AISENSY_API_KEY) { res.status(500).json({ error: 'AISENSY_API_KEY not configured' }); return; }
  if (INTERNAL_KEY && req.headers['x-internal-key'] !== INTERNAL_KEY) {
    res.status(401).json({ error: 'Unauthorized' }); return;
  }
  const { type, to, params = {}, template, campaignName } = req.body || {};
  if (!to) { res.status(400).json({ error: 'Missing recipient phone' }); return; }
  const phone = String(to).replace(/[^0-9]/g, '').replace(/^0+/, '');
  const e164 = phone.startsWith('91') ? phone : `91${phone}`;
  if (e164.length !== 12) { res.status(400).json({ error: 'Invalid Indian phone number' }); return; }
  const T = {
    order_confirm:   { campaignName: campaignName||'oncost_order_confirm',   templateParams: [params.customer_name||'Customer', params.order_id||'', params.amount||'', params.tracking_url||'https://www.oncost.shop'] },
    abandoned_cart:  { campaignName: campaignName||'oncost_abandoned_cart',  templateParams: [params.customer_name||'Customer', params.cart_value||'', params.recovery_url||'https://www.oncost.shop/cart.html'] },
    shipping_update: { campaignName: campaignName||'oncost_shipping_update', templateParams: [params.customer_name||'Customer', params.order_id||'', params.status||'Shipped', params.tracking_url||''] },
    review_request:  { campaignName: campaignName||'oncost_review_request',  templateParams: [params.customer_name||'Customer', params.product_name||'your order', params.review_link||'https://www.oncost.shop'] },
    custom:          { campaignName: campaignName||template, templateParams: params.template_params||[] },
  };
  const tpl = T[type];
  if (!tpl || !tpl.campaignName) { res.status(400).json({ error: 'Unknown message type or missing campaignName' }); return; }
  try {
    const r = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: AISENSY_API_KEY, campaignName: tpl.campaignName, destination: e164,
        userName: params.customer_name || 'Customer', templateParams: tpl.templateParams,
        source: 'oncost-storefront',
        media: params.image_url ? { url: params.image_url, filename: 'product.jpg' } : undefined,
      }),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: 'AiSensy error', detail: json });
    res.status(200).json({ ok: true, type, to: e164, aisensy: json });
  } catch (err) {
    res.status(500).json({ error: 'Send failed', detail: err.message });
  }
}

async function handleWebhook(req, res) {
  // AiSensy may GET-probe for verification — always respond 200
  if (req.method === 'GET') return res.status(200).send('ok');
  if (req.method !== 'POST') return res.status(405).send('POST only');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const body = req.body || {};
  const from    = (body.waId || body.from || body.phone || '').replace(/[^0-9]/g, '');
  const message = (body.text || body.message || body.body || '').trim();
  if (!from || !message) return res.status(200).json({ ok: true, skipped: true });

  if (SUPABASE_URL && SERVICE_KEY) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_logs`, {
        method: 'POST',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates' },
        body: JSON.stringify({ phone: from, direction: 'in', message, raw: body }),
      });
    } catch (_) { /* non-fatal */ }
  }
  console.log(`[whatsapp/webhook] from=${from} msg="${message.substring(0,80)}"`);
  res.status(200).json({ ok: true, received: true });
}

async function handleCron(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const INTERNAL_KEY = process.env.INTERNAL_API_KEY;
  const SITE_URL     = process.env.SITE_URL || `https://${req.headers.host}`;
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Supabase env missing' });

  // Find guest-cart phone numbers from leads (or your cart_items table) that haven't paid in 24h
  // For now: just respond OK — full implementation can come later
  console.log('[whatsapp/cron] abandoned-cart cron triggered');
  res.status(200).json({ ok: true, message: 'Cron ran (placeholder — abandoned cart logic to be added)' });
}

module.exports = async function handler(req, res) {
  try {
    const action = parseAction(req);
    switch (action) {
      case 'send':                   return await handleSend(req, res);
      case 'webhook':                return await handleWebhook(req, res);
      case 'abandoned-cart-cron':
      case 'cron':                   return await handleCron(req, res);
      default:
        return res.status(400).json({ error: 'Unknown action', valid: ['send','webhook','abandoned-cart-cron'] });
    }
  } catch (e) {
    console.error('[whatsapp] dispatcher error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
module.exports.config = { api: { bodyParser: true } };
