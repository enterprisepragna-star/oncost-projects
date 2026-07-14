// Delhivery API client — shared library
// Docs: https://one.delhivery.com (uses the same legacy track.delhivery.com endpoints)
//
// Auth: header `Authorization: Token <DELHIVERY_TOKEN>` (NOT Bearer)
// Base URL: https://track.delhivery.com  (single endpoint for both prod & staging,
//           use ENV-specific tokens). For staging, can use https://staging-express.delhivery.com

const BASE = (process.env.DELHIVERY_BASE_URL || 'https://track.delhivery.com').replace(/\/+$/, '');
const TOKEN = (process.env.DELHIVERY_TOKEN || process.env.DELHIVERY_API_KEY || '').trim();
const CLIENT_NAME = (process.env.DELHIVERY_CLIENT_NAME || 'ONCOST').trim();
const PICKUP_PINCODE = (process.env.DELHIVERY_PICKUP_PINCODE || '560001').trim(); // Default fallback, admin must set real one

function authHeader() {
  if (!TOKEN) throw new Error('DELHIVERY_TOKEN not configured in env vars');
  return { Authorization: `Token ${TOKEN}` };
}

// ---------- Pincode serviceability ----------
// GET /c/api/pin-codes/json/?filter_codes={pincode}
async function checkPincode(pincode) {
  const url = `${BASE}/c/api/pin-codes/json/?filter_codes=${encodeURIComponent(pincode)}`;
  const r = await fetch(url, { headers: authHeader() });
  if (!r.ok) throw new Error(`Delhivery pincode check failed: HTTP ${r.status}`);
  const data = await r.json();
  const dc = data?.delivery_codes?.[0]?.postal_code;
  if (!dc) return { serviceable: false, pincode };
  return {
    serviceable: dc.pre_paid === 'Y' || dc.cash === 'Y',
    pincode: dc.pin,
    state: dc.state_code,
    district: dc.district,
    cod: dc.cash === 'Y',
    prepaid: dc.pre_paid === 'Y',
    cod_only: dc.cash === 'Y' && dc.pre_paid === 'N',
  };
}

// ---------- Shipping rate calculation ----------
// GET /api/kinko/v1/invoice/charges/.json?md=S&ss=Delivered&d_pin&o_pin&cgm&pt=Pre-paid
async function calculateRate({ pickup_pincode, drop_pincode, weight_grams, cod_amount = 0, mode = 'S' }) {
  const params = new URLSearchParams({
    md: mode,                            // S = surface, E = express
    ss: 'Delivered',
    d_pin: drop_pincode,
    o_pin: pickup_pincode,
    cgm: String(Math.max(50, Math.round(weight_grams))),
    pt: cod_amount > 0 ? 'COD' : 'Pre-paid',
    cod: String(cod_amount),
  });
  const url = `${BASE}/api/kinko/v1/invoice/charges/.json?${params.toString()}`;
  const r = await fetch(url, { headers: authHeader() });
  if (!r.ok) throw new Error(`Delhivery rate API failed: HTTP ${r.status}`);
  const data = await r.json();
  // Delhivery returns array; first item has total_amount
  const charge = Array.isArray(data) ? data[0] : data;
  return {
    total_amount: Number(charge?.total_amount || 0),
    charge_DL: charge?.charge_DL,
    charge_COD: charge?.charge_COD,
    chargeable_weight_g: Number(charge?.charged_weight) * 1000 || Math.round(weight_grams),
    zone: charge?.zone || null,
    raw: charge,
  };
}

// ---------- Create shipment (AWB generation) ----------
// POST /api/cmu/create.json — multipart form: `format=json&data=<json string>`
async function createShipment(order) {
  if (!CLIENT_NAME) throw new Error('DELHIVERY_CLIENT_NAME not configured (your registered warehouse/client name)');
  if (!PICKUP_PINCODE) throw new Error('DELHIVERY_PICKUP_PINCODE not configured');

  const ship = order.shipping_address || {};
  const items = Array.isArray(order.items) ? order.items : [];
  const itemDesc = items.map(it => `${it.name || it.product_id} x${it.qty || it.quantity || 1}`).join(', ').substring(0, 250) || 'Gift items';

  const payload = {
    shipments: [{
      name: ship.name || 'Customer',
      add: ship.address || '',
      pin: String(ship.zip || ''),
      city: ship.city || '',
      state: ship.state || '',
      country: ship.country || 'India',
      phone: String(ship.phone || ''),
      order: order.ccavenue_order_id || String(order.id),
      payment_mode: 'Prepaid',
      return_pin: PICKUP_PINCODE,
      return_city: '',
      return_phone: '',
      return_add: '',
      return_state: '',
      return_country: 'India',
      products_desc: itemDesc,
      hsn_code: items[0]?.hsn_code || '',
      cod_amount: '0',
      order_date: new Date().toISOString().split('T')[0],
      total_amount: String(order.total_amount || 0),
      seller_add: '',
      seller_name: CLIENT_NAME,
      seller_inv: order.invoice_number || '',
      quantity: String(items.reduce((s, it) => s + (it.qty || it.quantity || 1), 0) || 1),
      waybill: '',
      shipment_width: String(order.shipping_dim_b || 15),
      shipment_height: String(order.shipping_dim_h || 10),
      weight: String(order.shipping_weight_g || 500),  // grams
      seller_gst_tin: '',
      shipping_mode: 'Surface',
      address_type: 'home',
    }],
    pickup_location: {
      name: CLIENT_NAME,
      add: '',
      city: '',
      pin_code: PICKUP_PINCODE,
      country: 'India',
      phone: '',
    },
  };

  const form = `format=json&data=${encodeURIComponent(JSON.stringify(payload))}`;
  const r = await fetch(`${BASE}/api/cmu/create.json`, {
    method: 'POST',
    headers: {
      ...authHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: form,
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!r.ok || !data.success) {
    const err = data?.rmk || data?.packages?.[0]?.remarks?.join(', ') || text;
    throw new Error(`Delhivery create shipment failed: ${err}`);
  }
  const pkg = data.packages?.[0];
  return {
    awb: pkg?.waybill,
    refnum: pkg?.refnum,
    status: pkg?.status,
    sort_code: pkg?.sort_code,
    cod_amount: pkg?.cod_amount,
    payment: pkg?.payment,
    tracking_url: pkg?.waybill ? `https://www.delhivery.com/track/package/${pkg.waybill}` : null,
    raw: data,
  };
}

// ---------- Track shipment ----------
async function trackShipment(awb) {
  const url = `${BASE}/api/v1/packages/json/?waybill=${encodeURIComponent(awb)}`;
  const r = await fetch(url, { headers: authHeader() });
  if (!r.ok) throw new Error(`Delhivery track API failed: HTTP ${r.status}`);
  return await r.json();
}

// ---------- Get shipping label PDF ----------
async function getLabelUrl(awb) {
  // Delhivery returns a JSON with packages[].pdf_download_link
  const url = `${BASE}/api/p/packing_slip?wbns=${encodeURIComponent(awb)}&pdf=true`;
  return { url, headers: authHeader() };
}

// ---------- Schedule pickup ----------
// POST /fm/request/new/
async function schedulePickup({ pickup_date, pickup_time = '12:00:00', expected_package_count = 1 }) {
  if (!CLIENT_NAME) throw new Error('DELHIVERY_CLIENT_NAME not configured');
  const body = {
    pickup_location: CLIENT_NAME,
    pickup_date,                                  // YYYY-MM-DD
    pickup_time,                                  // HH:MM:SS
    expected_package_count,
  };
  const r = await fetch(`${BASE}/fm/request/new/`, {
    method: 'POST',
    headers: { ...authHeader(), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!r.ok) throw new Error(`Pickup scheduling failed: ${data?.pr_exist || text}`);
  return { pickup_id: data.pickup_id, ...data };
}

module.exports = { checkPincode, calculateRate, createShipment, trackShipment, getLabelUrl, schedulePickup, BASE, CLIENT_NAME, PICKUP_PINCODE };
