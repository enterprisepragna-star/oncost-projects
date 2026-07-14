const { sendTrackingUpdate } = require('../_lib/email');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const payload = req.body;
    console.log('[webhook/delhivery] Received payload:', JSON.stringify(payload));

    // Delhivery Webhook payload structure usually contains Waybill and Status
    const shipment = payload.Shipment || payload.shipment || {};
    const awb = shipment.Waybill || shipment.AWB || payload.waybill;
    
    let statusObj = shipment.Status || payload.status || {};
    if (typeof statusObj === 'string') {
      statusObj = { Status: statusObj };
    }
    
    const statusText = statusObj.Status || statusObj.status || payload.current_status;
    const location = statusObj.StatusLocation || statusObj.location || '';

    if (!awb || !statusText) {
      console.error('[webhook/delhivery] Missing AWB or Status in payload');
      return res.status(400).json({ error: 'Missing AWB or Status' });
    }

    const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
    const SERVICE_KEY  = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    const SITE_URL     = (process.env.SITE_URL || `https://${req.headers.host}`).trim();

    if (!SUPABASE_URL || !SERVICE_KEY) {
      console.error('[webhook/delhivery] Missing Supabase credentials');
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    // Find the order with this AWB in Supabase
    const searchRes = await fetch(`${SUPABASE_URL}/rest/v1/orders?awb_number=eq.${encodeURIComponent(awb)}&select=*&limit=1`, {
      method: 'GET',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const orders = await searchRes.json();
    if (!Array.isArray(orders) || orders.length === 0) {
      console.warn(`[webhook/delhivery] No order found for AWB: ${awb}`);
      return res.status(200).json({ message: 'No matching order found, ignoring.' });
    }

    const orderRow = orders[0];
    
    // Determine mapping to our internal status if needed, or just save the raw status
    // Common Delhivery statuses: "Dispatched", "In Transit", "Out for Delivery", "Delivered", "RTO"
    let mappedStatus = statusText;
    if (statusText.toLowerCase() === 'delivered') mappedStatus = 'Delivered';
    if (statusText.toLowerCase() === 'rto') mappedStatus = 'Returned';

    // Update the database
    await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${orderRow.id}`, {
      method: 'PATCH',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        shipping_status: mappedStatus
      })
    });

    // Send the custom email notification to the customer
    await sendTrackingUpdate(orderRow, statusText, location);

    // Send WhatsApp tracking update if internal API is configured
    const INTERNAL_KEY = process.env.INTERNAL_API_KEY;
    const phone = orderRow.guest_phone || (orderRow.shipping_address && orderRow.shipping_address.phone);
    if (phone && INTERNAL_KEY) {
      fetch(`${SITE_URL}/api/whatsapp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL_KEY },
        body: JSON.stringify({
          type: 'shipping_update',
          to: phone,
          params: {
            customer_name: (orderRow.shipping_address && orderRow.shipping_address.name) || 'Customer',
            order_id: orderRow.id.substring(0, 8).toUpperCase(),
            tracking_url: orderRow.shipping_tracking_url || `https://www.delhivery.com/track/package/${awb}`,
          },
        }),
      }).catch(err => console.error('[webhook/delhivery] WhatsApp tracking update failed:', err.message));
    }

    return res.status(200).json({ success: true, message: 'Tracking updated successfully' });
  } catch (err) {
    console.error('[webhook/delhivery] Error:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
