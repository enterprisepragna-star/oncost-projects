// POST/GET /api/delhivery/[action]
// Single dispatcher for all Delhivery operations. Keeps Vercel function count low (Hobby plan limit = 12).
//
// Actions:
//   GET  /api/delhivery?action=serviceability&drop_pincode=XXX&weight_grams=NNN
//   POST /api/delhivery?action=create-shipment       body: { order_id }       header: x-admin-key
//   GET  /api/delhivery?action=label&awb=XXX
//   POST /api/delhivery?action=schedule-pickup       body: { pickup_date }    header: x-admin-key
//   GET  /api/delhivery?action=track&awb=XXX
//
// Also accepts trailing path: /api/delhivery/serviceability?... (uses last path segment as action).

const { checkPincode, calculateRate, createShipment, schedulePickup, trackShipment, BASE, PICKUP_PINCODE } = require('./_lib/client');

function parseAction(req) {
  // Action from ?action= query OR last segment of URL path
  if (req.query && req.query.action) return req.query.action;
  const url = req.url || '';
  const path = url.split('?')[0].replace(/\/+$/, '');
  const seg = path.split('/').pop();
  if (seg && seg !== 'delhivery' && seg !== 'index') return seg;
  return null;
}

async function handleServiceability(req, res) {
  const drop_pincode = req.query.drop_pincode || req.query.pincode;
  const weight_grams = Number(req.query.weight_grams || req.query.weight || 500);
  const pickup_pincode = req.query.pickup_pincode || PICKUP_PINCODE;
  if (!drop_pincode) return res.status(400).json({ error: 'drop_pincode required' });
  if (!pickup_pincode) return res.status(500).json({ error: 'Set DELHIVERY_PICKUP_PINCODE env var' });

  const [svc, rate] = await Promise.all([
    checkPincode(drop_pincode).catch(e => ({ serviceable: false, error: e.message })),
    calculateRate({ pickup_pincode, drop_pincode, weight_grams }).catch(e => ({ total_amount: 0, error: e.message })),
  ]);
  if (!svc.serviceable) return res.status(200).json({ serviceable: false, message: 'Delivery not available to this pincode', ...svc });
  res.status(200).json({
    serviceable: true,
    pincode: drop_pincode,
    state: svc.state,
    district: svc.district,
    shipping_amount: Math.round(rate.total_amount || 79),
    chargeable_weight_g: rate.chargeable_weight_g,
    zone: rate.zone,
    mode: 'Surface',
    cod_available: svc.cod,
  });
}

async function handleCreateShipment(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ADMIN_KEY    = process.env.ADMIN_RECOVERY_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY || !ADMIN_KEY) return res.status(500).json({ error: 'Server env not configured' });
  if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });

  const orderId = (req.body && req.body.order_id) || '';
  if (!orderId) return res.status(400).json({ error: 'order_id required' });

  const oRes = await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=*&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const orders = await oRes.json();
  const order = Array.isArray(orders) ? orders[0] : null;
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.awb_number) return res.status(200).json({ ok: true, awb: order.awb_number, message: 'AWB already exists' });

  const items = Array.isArray(order.items) ? order.items : [];
  let totalWeight = Number(req.body.weight_grams) || 0;
  let maxL = Number(req.body.length_cm) || 0;
  let maxB = Number(req.body.breadth_cm) || 0;
  let totalH = Number(req.body.height_cm) || 0;

  if (!totalWeight) {
    for (const it of items) {
      if (!it.product_id) continue;
      const pRes = await fetch(`${SUPABASE_URL}/rest/v1/products?id=eq.${encodeURIComponent(it.product_id)}&select=weight_grams,length_cm,breadth_cm,height_cm,hsn_code&limit=1`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      });
      const ps = await pRes.json();
      const prod = ps?.[0] || {};
      const qty = it.qty || it.quantity || 1;
      totalWeight += Number(prod.weight_grams || 500) * qty;
      maxL = Math.max(maxL, Number(prod.length_cm || 15));
      maxB = Math.max(maxB, Number(prod.breadth_cm || 10));
      totalH += Number(prod.height_cm || 6) * qty;
      if (prod.hsn_code && !it.hsn_code) it.hsn_code = prod.hsn_code;
    }
    if (!totalWeight) totalWeight = 500;
  }

  await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: 'PATCH',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipping_weight_g: totalWeight, shipping_dim_l: maxL, shipping_dim_b: maxB, shipping_dim_h: totalH }),
  });

  const result = await createShipment({ ...order, items, shipping_weight_g: totalWeight, shipping_dim_l: maxL, shipping_dim_b: maxB, shipping_dim_h: totalH });

  await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: 'PATCH',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ awb_number: result.awb, tracking_url: result.tracking_url, courier_partner: 'Delhivery' }),
  });

  res.status(200).json({ ok: true, awb: result.awb, tracking_url: result.tracking_url, weight_g: totalWeight });
}

async function handleLabel(req, res) {
  const awb = req.query.awb;
  const TOKEN = (process.env.DELHIVERY_TOKEN || '').trim();
  if (!awb)   return res.status(400).json({ error: 'awb required' });
  if (!TOKEN) return res.status(500).json({ error: 'DELHIVERY_TOKEN missing' });
  const r = await fetch(`${BASE}/api/p/packing_slip?wbns=${encodeURIComponent(awb)}&pdf=true`, {
    headers: { Authorization: `Token ${TOKEN}` },
  });
  if (!r.ok) return res.status(r.status).json({ error: `Delhivery label HTTP ${r.status}` });
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('application/pdf')) {
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="label-${awb}.pdf"`);
    return res.status(200).send(buf);
  }
  const data = await r.json();
  const link = data?.packages?.[0]?.pdf_download_link || data?.pdf_download_link;
  if (link) return res.redirect(302, link);
  res.status(500).json({ error: 'No label URL returned', raw: data });
}

async function handleSchedulePickup(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  const ADMIN_KEY = process.env.ADMIN_RECOVERY_KEY;
  if (!ADMIN_KEY)                              return res.status(500).json({ error: 'ADMIN_RECOVERY_KEY not set' });
  if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  const { pickup_date, pickup_time, expected_package_count } = req.body || {};
  if (!pickup_date) return res.status(400).json({ error: 'pickup_date required (YYYY-MM-DD)' });
  const result = await schedulePickup({ pickup_date, pickup_time, expected_package_count });
  res.status(200).json(result);
}

async function handleTrack(req, res) {
  const awb = req.query.awb;
  if (!awb) return res.status(400).json({ error: 'awb required' });
  const data = await trackShipment(awb);
  res.status(200).json(data);
}

module.exports = async function handler(req, res) {
  try {
    const action = parseAction(req);
    switch (action) {
      case 'serviceability':    return await handleServiceability(req, res);
      case 'create-shipment':   return await handleCreateShipment(req, res);
      case 'label':             return await handleLabel(req, res);
      case 'schedule-pickup':   return await handleSchedulePickup(req, res);
      case 'track':             return await handleTrack(req, res);
      default:
        return res.status(400).json({
          error: 'Unknown action',
          valid_actions: ['serviceability', 'create-shipment', 'label', 'schedule-pickup', 'track'],
          usage: 'GET /api/delhivery?action=serviceability&drop_pincode=560001  OR  /api/delhivery/serviceability?drop_pincode=560001',
        });
    }
  } catch (e) {
    console.error('[delhivery] dispatcher error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
module.exports.config = { api: { bodyParser: true } };
