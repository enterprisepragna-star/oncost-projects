// POST /api/webhooks/order-status
// Triggered by Supabase Database Webhook on INSERT and UPDATE of the orders table.
//
// INSERT  → customer gets order confirmation + invoice email
// UPDATE  → customer gets status update email (Processing → Packed → Shipped → Delivered → Cancelled)
//
// Setup in Supabase Dashboard:
//   Database → Webhooks → Create webhook
//   Table: orders | Events: INSERT, UPDATE
//   Method: POST | URL: https://www.oncost.shop/api/webhooks/order-status
//   Headers: x-webhook-secret: <your ORDER_WEBHOOK_SECRET value>

const SITE_URL = process.env.SITE_URL || 'https://www.oncost.shop';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

  // Verify webhook secret
  const WEBHOOK_SECRET = (process.env.ORDER_WEBHOOK_SECRET || '').trim();
  if (WEBHOOK_SECRET && req.headers['x-webhook-secret'] !== WEBHOOK_SECRET) {
    console.warn('[webhook/order-status] Invalid secret');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const payload = req.body || {};
    const { type, table, record: newOrder, old_record: oldOrder } = payload;

    if (table !== 'orders') {
      return res.status(200).json({ message: 'Not orders table, ignoring.' });
    }
    if (!newOrder) {
      return res.status(400).json({ error: 'Missing record' });
    }

    // ── Parse shipping_address ───────────────────────────────────────────────
    let addr = newOrder.shipping_address || {};
    if (typeof addr === 'string') {
      try { addr = JSON.parse(addr); } catch (_) { addr = {}; }
    }

    // ── Resolve customer contact ─────────────────────────────────────────────
    const customerEmail = (
      newOrder.guest_email ||
      newOrder.user_email  ||
      addr.email           ||
      ''
    ).trim();
    const customerPhone = (
      newOrder.guest_phone ||
      addr.phone           ||
      ''
    ).trim();
    const customerName  = (addr.name || newOrder.customer_name || 'Customer').trim();

    // ── Parse items ──────────────────────────────────────────────────────────
    let items = newOrder.items || [];
    if (typeof items === 'string') {
      try { items = JSON.parse(items); } catch (_) { items = []; }
    }

    // Helper: call /api/email/send
    async function sendEmail(emailType, extra = {}) {
      if (!customerEmail) {
        console.warn(`[webhook/order-status] No customer email for order ${newOrder.id}, skipping ${emailType}`);
        return;
      }
      const body = {
        type: emailType,
        to: customerEmail,
        order_id: newOrder.id,
        data: {
          order_id:       newOrder.id,
          name:           customerName,
          amount:         newOrder.total_amount,
          items,
          courier:        newOrder.logistics_partner || 'Delhivery',
          awb:            newOrder.awb_number        || '',
          tracking_url:   newOrder.tracking_url      || '',
          invoice_number: newOrder.invoice_number    || newOrder.id,
          ...extra,
        },
      };
      const r = await fetch(`${SITE_URL}/api/email/send`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal': '1' },
        body:    JSON.stringify(body),
      });
      if (!r.ok) {
        const txt = await r.text();
        console.error(`[webhook/order-status] sendEmail(${emailType}) failed:`, txt);
      } else {
        console.log(`[webhook/order-status] sent ${emailType} → ${customerEmail}`);
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // INSERT — new order placed → send confirmation to customer
    // ══════════════════════════════════════════════════════════════════════════
    if (type === 'INSERT') {
      // Only email for paid orders (skip pending/failed at insert time)
      if (['Paid', 'Confirmed', 'Processing'].includes(newOrder.status)) {
        await sendEmail('order_confirm');
      }
      return res.status(200).json({ ok: true, action: 'order_confirm' });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // UPDATE — status changed → send status update to customer
    // ══════════════════════════════════════════════════════════════════════════
    if (type === 'UPDATE') {
      // Skip if status didn't change
      if (oldOrder && newOrder.status === oldOrder.status) {
        return res.status(200).json({ ok: true, action: 'no_change' });
      }

      const STATUS_TO_EMAIL = {
        'Confirmed':       'order_processing',
        'Processing':      'order_processing',
        'Packed':          'order_packed',
        'Shipped':         'order_shipped',
        'Out for Delivery':'out_for_delivery',
        'Delivered':       'order_delivered',
        'Cancelled':       'order_cancelled',
        'Failed':          'order_cancelled',
      };

      const emailType = STATUS_TO_EMAIL[newOrder.status];
      if (!emailType) {
        return res.status(200).json({ ok: true, action: 'no_template', status: newOrder.status });
      }

      await sendEmail(emailType);
      return res.status(200).json({ ok: true, action: emailType, status: newOrder.status });
    }

    return res.status(200).json({ ok: true, action: 'ignored', type });

  } catch (err) {
    console.error('[webhook/order-status] exception:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
