// POST /api/webhooks/order-status
// Triggered by Supabase database webhook when an order's status changes.
// It receives the OLD and NEW order records and dispatches an email via /api/email/send logic.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1. Verify Webhook Secret
  const WEBHOOK_SECRET = process.env.ORDER_WEBHOOK_SECRET;
  if (WEBHOOK_SECRET && req.headers['x-webhook-secret'] !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized: Invalid secret' });
  }

  try {
    const payload = req.body;
    
    // Supabase webhook payload structure:
    // { type: 'UPDATE', table: 'orders', record: { ...new }, old_record: { ...old } }
    if (payload.type !== 'UPDATE' || payload.table !== 'orders') {
      return res.status(400).json({ error: 'Invalid payload type or table' });
    }

    const newOrder = payload.record;
    const oldOrder = payload.old_record;

    if (!newOrder || !oldOrder) {
      return res.status(400).json({ error: 'Missing record data' });
    }

    // Only proceed if status actually changed
    if (newOrder.status === oldOrder.status) {
      return res.status(200).json({ message: 'Status did not change, ignoring.' });
    }

    // Map order status to email template type
    let emailType = '';
    switch (newOrder.status) {
      case 'Confirmed':
        emailType = 'order_processing';
        break;
      case 'Packed':
        emailType = 'order_packed';
        break;
      case 'Shipped':
        emailType = 'order_shipped';
        break;
      case 'Delivered':
        emailType = 'order_delivered';
        break;
      case 'Cancelled':
      case 'Failed':
        emailType = 'order_cancelled';
        break;
      default:
        return res.status(200).json({ message: `No email template for status: ${newOrder.status}` });
    }

    // Prepare data for the email dispatcher
    let customerEmail = '';
    let customerName = '';
    
    // Try to parse shipping_address to get email/name if not at root level
    let shippingAddress = newOrder.shipping_address;
    if (typeof shippingAddress === 'string') {
      try {
        shippingAddress = JSON.parse(shippingAddress);
      } catch(e) {}
    }
    
    // Attempt to extract email
    customerEmail = newOrder.user_email || shippingAddress?.email || '';

    // Determine the base URL for the API call
    const host = req.headers.host || 'www.oncost.shop';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const apiUrl = `${protocol}://${host}/api/email/send`;

    const sendData = {
      type: emailType,
      to: customerEmail || 'DUMMY_TO_BE_RESOLVED_BY_EMAIL_SEND', // email/send will resolve it if missing but order_id is present
      order_id: newOrder.id,
      data: {
        order: newOrder,
        order_id: newOrder.id,
        name: shippingAddress?.name || 'Customer',
        amount: newOrder.total_amount,
        courier: newOrder.logistics_partner || 'Delhivery',
        awb: newOrder.awb_number || '',
        tracking_url: newOrder.tracking_url || ''
      }
    };

    const emailRes = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal': '1' // authenticate internally
      },
      body: JSON.stringify(sendData)
    });

    if (!emailRes.ok) {
      const err = await emailRes.text();
      console.error('[webhook/order-status] Email dispatch failed:', err);
      return res.status(500).json({ error: 'Email dispatch failed', details: err });
    }

    return res.status(200).json({ message: `Successfully triggered ${emailType} email` });

  } catch (error) {
    console.error('[webhook/order-status] Error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};
