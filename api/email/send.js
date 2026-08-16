// POST /api/email/send
// Unified email dispatcher via Resend.
// Auth: x-admin-key OR called internally from other API routes (x-internal: 1)
// Body: { type, to, data, order_id? }
//   types: enquiry_admin_notify | order_confirm | order_invoice | order_shipped |
//          testimonial_request | custom

const { generateInvoicePDF } = require('./_lib/invoice-pdf');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

  const RESEND_API_KEY  = (process.env.RESEND_API_KEY  || '').trim();
  const FROM_EMAIL      = (process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev').trim();
  const REPLY_TO        = (process.env.RESEND_REPLY_TO || '').trim();
  const ADMIN_EMAIL     = (process.env.ADMIN_EMAIL || 'enterprisepragna@oncost.shop').trim();
  const ADMIN_KEY       = process.env.ADMIN_RECOVERY_KEY;
  let SUPABASE_URL    = (process.env.SUPABASE_URL || '').trim();
  if (!SUPABASE_URL.startsWith('http') || SUPABASE_URL.startsWith('sb_')) {
    SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jyvmmypalshebqmnrdma.supabase.co';
  }
  const SERVICE_KEY     = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  // Allow internal calls (no key check) OR admin key
  const isAdmin = req.headers['x-admin-key'] === ADMIN_KEY;
  const isInternal = req.headers['x-internal'] === '1';
  if (!isAdmin && !isInternal) {
    // Public endpoint = enquiry-only (used by storefront contact form)
    if (req.body?.type !== 'enquiry_admin_notify') return res.status(401).json({ error: 'Unauthorized' });
  }

  const { type = 'custom', to, data = {}, order_id } = req.body || {};
  let subject = '', html = '', recipient = to;
  let attachments = undefined;

  switch (type) {
    case 'enquiry_admin_notify':
      if (data.save_lead && SUPABASE_URL && SERVICE_KEY) {
        try {
          const lRes = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
            method: 'POST',
            headers: {
              apikey: SERVICE_KEY,
              Authorization: `Bearer ${SERVICE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
              user_id: data.user_id || null,
              product_id: data.product_id || null,
              summary: data.summary || '',
              status: 'New'
            })
          });
          if (!lRes.ok) console.error('[email/send] lead insert failed', await lRes.text());
        } catch (e) {
          console.error('[email/send] lead insert exception', e.message);
        }
      }

      recipient = ADMIN_EMAIL;
      subject = `🔔 New enquiry from ${data.name || 'a customer'}`;
      html = `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#fdfaf3;">
        <div style="background:#7a1f35;color:#f2dd92;padding:18px 24px;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;font-family:Georgia,serif;">New Enquiry</h2>
          <p style="margin:4px 0 0;opacity:.85;font-size:13px;">${new Date().toLocaleString('en-IN')}</p>
        </div>
        <div style="background:#fff;padding:24px;border:1px solid #e8e0d2;border-top:none;border-radius:0 0 8px 8px;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr><td style="padding:6px 0;color:#7a726b;width:120px;">Name:</td><td><strong>${(data.name||'—')}</strong></td></tr>
            <tr><td style="padding:6px 0;color:#7a726b;">Email:</td><td><a href="mailto:${(data.email||'')}">${(data.email||'—')}</a></td></tr>
            <tr><td style="padding:6px 0;color:#7a726b;">Phone:</td><td><a href="tel:${(data.phone||'')}">${(data.phone||'—')}</a></td></tr>
            <tr><td style="padding:6px 0;color:#7a726b;">Event:</td><td>${(data.event||'—')}</td></tr>
            <tr><td style="padding:6px 0;color:#7a726b;">Date:</td><td>${(data.date||'—')}</td></tr>
            <tr><td style="padding:6px 0;color:#7a726b;">Quantity:</td><td>${(data.qty||'—')}</td></tr>
            <tr><td style="padding:6px 0;color:#7a726b;">Budget:</td><td><strong>${data.budget?'₹'+data.budget:'—'}</strong></td></tr>
            <tr><td style="padding:6px 0;color:#7a726b;vertical-align:top;">Message:</td><td style="white-space:pre-wrap;background:#fdfaf3;padding:10px;border-radius:6px;">${(data.message||'—')}</td></tr>
          </table>
          <div style="margin-top:18px;display:flex;gap:10px;">
            <a href="https://www.oncost.shop/admin-dashboard.html#leads" style="background:#7a1f35;color:#f2dd92;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;">Open in Admin →</a>
            ${data.phone ? `<a href="https://wa.me/${(data.phone||'').replace(/[^\d]/g,'').replace(/^0+/,'91')}" style="background:#25D366;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;">WhatsApp customer</a>` : ''}
          </div>
        </div>
      </div>`;
      break;

    case 'order_confirm':
    case 'order_invoice': {
      // Optionally load order + products from Supabase to attach PDF invoice
      let order = data.order || null;
      let products = {};
      if ((type === 'order_invoice' || data.attach_invoice) && order_id && SUPABASE_URL && SERVICE_KEY) {
        try {
          const oRes = await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(order_id)}&select=*&limit=1`, {
            headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
          });
          const arr = await oRes.json();
          order = (Array.isArray(arr) ? arr[0] : null) || order;
          // Enrich items with HSN/GST from products table
          const ids = Array.from(new Set((order?.items || []).map(it => it.product_id).filter(Boolean)));
          if (ids.length) {
            const filter = ids.map(id => `"${id}"`).join(',');
            const pRes = await fetch(`${SUPABASE_URL}/rest/v1/products?id=in.(${filter})&select=id,name,hsn_code,gst_percent`, {
              headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
            });
            const ps = await pRes.json();
            (Array.isArray(ps) ? ps : []).forEach(p => { products[p.id] = p; });
          }
        } catch (e) { console.error('[email/send] order load failed:', e.message); }
      }

      const invoiceNo = (order && order.invoice_number) || data.invoice_number || data.order_id || '';
      const grand = (order && order.total_amount) || data.amount || '';
      subject = type === 'order_invoice'
        ? `Your ONCOST Invoice · ${invoiceNo}`
        : `✓ Order confirmed · ${data.order_id || invoiceNo}`;

      html = `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#fdfaf3;">
        <div style="background:#7a1f35;color:#f2dd92;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
          <h1 style="margin:0;font-family:Georgia,serif;font-size:26px;">ONCOST</h1>
          <p style="margin:6px 0 0;font-size:14px;opacity:.9;">Thank you for your order!</p>
        </div>
        <div style="background:#fff;padding:24px;border:1px solid #e8e0d2;border-top:none;border-radius:0 0 8px 8px;">
          <p style="font-size:15px;">Hi ${(data.name || order?.shipping_address?.name || 'Customer')},</p>
          <p>Your order <strong>${(data.order_id || order?.ccavenue_order_id || invoiceNo)}</strong> is confirmed.
             Total paid: <strong style="color:#7a1f35;">₹${grand}</strong></p>
          ${invoiceNo ? `<p style="margin:6px 0 0;color:#7a726b;font-size:13px;">Invoice number: <strong>${invoiceNo}</strong></p>` : ''}
          <p style="margin-top:14px;">${type === 'order_invoice' ? 'Your GST invoice is attached to this email (PDF).' : ''}</p>
          ${data.invoice_url ? `<p><a href="${data.invoice_url}" style="background:#7a1f35;color:#f2dd92;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;">View Order →</a></p>` : ''}
          <p style="color:#7a726b;font-size:13px;margin-top:24px;">We'll send tracking details once your order ships (usually within 24 hours).</p>
          <hr style="border:none;border-top:1px solid #e8e0d2;margin:24px 0;">
          <p style="font-size:12px;color:#7a726b;margin:0;">Questions? Reply to this email or visit <a href="https://www.oncost.shop/support.html" style="color:#7a1f35;">support</a>.</p>
        </div>
      </div>`;

      if (type === 'order_invoice' && order) {
        try {
          const pdfBuf = await generateInvoicePDF({ order, products });
          attachments = [{
            filename: `Invoice-${(invoiceNo || 'oncost').replace(/[^A-Za-z0-9_-]/g,'_')}.pdf`,
            content: pdfBuf.toString('base64'),
          }];
        } catch (e) {
          console.error('[email/send] invoice PDF generation failed:', e.message);
        }
      }
      break;
    }

    case 'order_processing':
      subject = `Order is being processed · ${data.order_id || ''}`;
      html = `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#fdfaf3;">
        <div style="background:#7a1f35;color:#f2dd92;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
          <h2 style="margin:0;font-family:Georgia,serif;">Order Processing</h2>
        </div>
        <div style="background:#fff;padding:24px;border:1px solid #e8e0d2;border-top:none;border-radius:0 0 8px 8px;">
          <p>Hi ${(data.name || 'Customer')},</p>
          <p>We've received your order <strong>${(data.order_id || '')}</strong> and we are now processing it.</p>
          <p>We'll notify you once it's packed and ready to ship.</p>
        </div>
      </div>`;
      break;

    case 'order_shipped':
      subject = `📦 Your order is on the way · ${data.order_id || ''}`;
      html = `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#fdfaf3;">
        <div style="background:#7a1f35;color:#f2dd92;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
          <h2 style="margin:0;font-family:Georgia,serif;">Your order has shipped!</h2>
        </div>
        <div style="background:#fff;padding:24px;border:1px solid #e8e0d2;border-top:none;border-radius:0 0 8px 8px;">
          <p>Hi ${(data.name || 'Customer')},</p>
          <p>Order <strong>${(data.order_id || '')}</strong> is now on its way.</p>
          <p><strong>Courier:</strong> ${(data.courier || 'Delhivery')}<br>
             <strong>AWB:</strong> ${(data.awb || '—')}</p>
          ${data.tracking_url ? `<p><a href="${data.tracking_url}" style="background:#7a1f35;color:#f2dd92;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;">Track shipment →</a></p>` : ''}
        </div>
      </div>`;
      break;

    case 'order_packed':
      subject = `Your order is packed and ready! · ${data.order_id || ''}`;
      html = `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#fdfaf3;">
        <div style="background:#7a1f35;color:#f2dd92;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
          <h2 style="margin:0;font-family:Georgia,serif;">Order Packed</h2>
        </div>
        <div style="background:#fff;padding:24px;border:1px solid #e8e0d2;border-top:none;border-radius:0 0 8px 8px;">
          <p>Hi ${(data.name || 'Customer')},</p>
          <p>Great news! Your order <strong>${(data.order_id || '')}</strong> has been packed and is awaiting pickup from our delivery partner.</p>
          <p>We'll send you another email with tracking details as soon as it ships.</p>
        </div>
      </div>`;
      break;

    case 'out_for_delivery':
      subject = `Your order is Out for Delivery! · ${data.order_id || ''}`;
      html = `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#fdfaf3;">
        <div style="background:#7a1f35;color:#f2dd92;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
          <h2 style="margin:0;font-family:Georgia,serif;">Out for Delivery</h2>
        </div>
        <div style="background:#fff;padding:24px;border:1px solid #e8e0d2;border-top:none;border-radius:0 0 8px 8px;">
          <p>Hi ${(data.name || 'Customer')},</p>
          <p>Great news! Your order <strong>${(data.order_id || '')}</strong> is out for delivery and will arrive today.</p>
          <p>Please make sure someone is available to receive the package.</p>
        </div>
      </div>`;
      break;

    case 'order_delivered':
      subject = `Your order has been delivered! · ${data.order_id || ''}`;
      html = `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#fdfaf3;">
        <div style="background:#7a1f35;color:#f2dd92;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
          <h2 style="margin:0;font-family:Georgia,serif;">Order Delivered</h2>
        </div>
        <div style="background:#fff;padding:24px;border:1px solid #e8e0d2;border-top:none;border-radius:0 0 8px 8px;">
          <p>Hi ${(data.name || 'Customer')},</p>
          <p>Your order <strong>${(data.order_id || '')}</strong> has been successfully delivered.</p>
          <p>We hope you enjoy your purchase! We would love to hear your feedback.</p>
          <p style="text-align:center;margin:24px 0;">
            <a href="https://www.oncost.shop/account.html#orders" style="background:#7a1f35;color:#f2dd92;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;">Leave a Review ★★★★★</a>
          </p>
          <p>If you have any issues or questions, please don't hesitate to reach out to our support team.</p>
        </div>
      </div>`;
      break;

    case 'order_cancelled':
      subject = `Order Cancelled · ${data.order_id || ''}`;
      html = `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#fdfaf3;">
        <div style="background:#8b2424;color:#f2dd92;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
          <h2 style="margin:0;font-family:Georgia,serif;">Order Cancelled</h2>
        </div>
        <div style="background:#fff;padding:24px;border:1px solid #e8e0d2;border-top:none;border-radius:0 0 8px 8px;">
          <p>Hi ${(data.name || 'Customer')},</p>
          <p>This email is to confirm that your order <strong>${(data.order_id || '')}</strong> has been cancelled.</p>
          <p>If you have already paid for this order, your refund will be processed according to our refund policy. Please contact support if you have any questions.</p>
        </div>
      </div>`;
      break;

    case 'testimonial_request':
      subject = `How was your ONCOST order?`;
      html = `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#fdfaf3;">
        <div style="background:#7a1f35;color:#f2dd92;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
          <h2 style="margin:0;font-family:Georgia,serif;">Loved your order?</h2>
        </div>
        <div style="background:#fff;padding:24px;border:1px solid #e8e0d2;border-top:none;border-radius:0 0 8px 8px;">
          <p>Hi ${(data.name || 'Customer')},</p>
          <p>Hope you enjoyed <strong>${(data.product_name || 'your recent order')}</strong>. Your review helps other customers and means the world to us.</p>
          <p style="text-align:center;margin:28px 0;">
            <a href="${(data.review_link || 'https://www.oncost.shop')}" style="background:#7a1f35;color:#f2dd92;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;">Leave a review ★★★★★</a>
          </p>
          <p style="color:#7a726b;font-size:13px;">It only takes 30 seconds. Thank you!</p>
        </div>
      </div>`;
      break;

    case 'complaint_admin_notify':
      recipient = ADMIN_EMAIL;
      subject = `🛎️ New complaint ${data.ticket || ''} — ${data.category || ''}`;
      html = `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#fdfaf3;">
        <div style="background:#7a1f35;color:#f2dd92;padding:18px 24px;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;font-family:Georgia,serif;">New Complaint · ${(data.ticket||'')}</h2>
          <p style="margin:4px 0 0;opacity:.85;font-size:13px;">${new Date().toLocaleString('en-IN')}</p>
        </div>
        <div style="background:#fff;padding:24px;border:1px solid #e8e0d2;border-top:none;border-radius:0 0 8px 8px;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr><td style="padding:6px 0;color:#7a726b;width:120px;">Customer:</td><td><strong>${(data.name||'—')}</strong></td></tr>
            <tr><td style="padding:6px 0;color:#7a726b;">Email:</td><td>${(data.email||'—')}</td></tr>
            <tr><td style="padding:6px 0;color:#7a726b;">Phone:</td><td>${(data.phone||'—')}</td></tr>
            <tr><td style="padding:6px 0;color:#7a726b;">Order:</td><td>${(data.order_id||'—')}</td></tr>
            <tr><td style="padding:6px 0;color:#7a726b;">Category:</td><td><strong>${(data.category||'—')}</strong></td></tr>
            <tr><td style="padding:6px 0;color:#7a726b;">Subject:</td><td>${(data.subject||'—')}</td></tr>
            <tr><td style="padding:6px 0;color:#7a726b;vertical-align:top;">Description:</td><td style="white-space:pre-wrap;background:#fdfaf3;padding:10px;border-radius:6px;">${(data.description||'—')}</td></tr>
          </table>
          <p style="margin-top:18px;"><a href="https://www.oncost.shop/admin-dashboard.html" style="background:#7a1f35;color:#f2dd92;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;">Open Complaints Dashboard →</a></p>
        </div>
      </div>`;
      break;

    case 'complaint_ack':
      subject = `We received your complaint · ${data.ticket || ''}`;
      html = `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#fdfaf3;">
        <div style="background:#7a1f35;color:#f2dd92;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
          <h2 style="margin:0;font-family:Georgia,serif;">We're on it!</h2>
        </div>
        <div style="background:#fff;padding:24px;border:1px solid #e8e0d2;border-top:none;border-radius:0 0 8px 8px;">
          <p>Hi ${(data.name || 'Customer')},</p>
          <p>Thank you for reaching out. Your complaint <strong>"${(data.subject||'')}"</strong> has been registered with ticket number:</p>
          <p style="text-align:center;margin:18px 0;"><span style="font-family:monospace;font-size:18px;background:#fdfaf3;border:1px dashed #7a1f35;color:#7a1f35;padding:10px 18px;border-radius:8px;font-weight:700;">${(data.ticket||'')}</span></p>
          <p>Our support team will get back to you within <strong>24 hours</strong>. Please keep this ticket number handy for any follow-ups.</p>
          <hr style="border:none;border-top:1px solid #e8e0d2;margin:24px 0;">
          <p style="font-size:12px;color:#7a726b;margin:0;">ONCOST Customer Care · <a href="https://www.oncost.shop" style="color:#7a1f35;">www.oncost.shop</a></p>
        </div>
      </div>`;
      break;

    case 'welcome_offer':
      subject = `🎁 Your welcome gift from ONCOST — ₹${data.amount || 100} off!`;
      html = `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#fdfaf3;">
        <div style="background:#7a1f35;color:#f2dd92;padding:28px 24px;border-radius:8px 8px 0 0;text-align:center;">
          <h2 style="margin:0;font-family:Georgia,serif;font-size:24px;">Welcome to ONCOST!</h2>
          <p style="margin:6px 0 0;opacity:.85;font-size:13px;">A little gift to get you started</p>
        </div>
        <div style="background:#fff;padding:28px 24px;border:1px solid #e8e0d2;border-top:none;border-radius:0 0 8px 8px;">
          <p>Hi ${(data.name || 'there')},</p>
          <p>Thanks for joining the ONCOST family. Here's <strong>₹${data.amount || 100} off</strong> your first order:</p>
          <div style="text-align:center;margin:22px 0;">
            <div style="display:inline-block;background:#fdfaf3;border:2px dashed #7a1f35;border-radius:10px;padding:16px 30px;">
              <div style="font-family:monospace;font-size:24px;font-weight:800;color:#7a1f35;letter-spacing:2px;">${(data.code || '')}</div>
              <div style="font-size:11px;color:#7a726b;margin-top:6px;">Min. order ₹${data.min_order || 999} · Valid till ${(data.expires || '30 days')}</div>
            </div>
          </div>
          <p style="text-align:center;"><a href="https://www.oncost.shop/products.html" style="background:#7a1f35;color:#f2dd92;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">Start Shopping →</a></p>
          <p style="font-size:12px;color:#7a726b;">Apply the code at checkout. Plus — earn 1 loyalty point for every ₹10 you spend, redeemable on future orders!</p>
          <hr style="border:none;border-top:1px solid #e8e0d2;margin:22px 0;">
          <p style="font-size:12px;color:#7a726b;margin:0;">ONCOST · Premium Gifting · <a href="https://www.oncost.shop" style="color:#7a1f35;">www.oncost.shop</a></p>
        </div>
      </div>`;
      break;

    default:
      subject = data.subject || 'Notification from ONCOST';
      html = data.html || `<p>${(data.message || 'You have a new notification.')}</p>`;
  }

  if (!recipient) return res.status(400).json({ error: 'No recipient address' });

  if (!RESEND_API_KEY) {
    console.error('[email/send] RESEND_API_KEY missing, skipping email send.');
    if (type === 'enquiry_admin_notify') {
      return res.status(200).json({ ok: true, warning: 'Email notification skipped (no API key), but lead saved' });
    }
    return res.status(500).json({ error: 'RESEND_API_KEY missing in Vercel env' });
  }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: Array.isArray(recipient) ? recipient : [recipient],
        subject,
        html,
        reply_to: REPLY_TO || undefined,
        attachments: attachments || undefined,
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      console.error('[email/send] Resend error:', j);
      if (type === 'enquiry_admin_notify') {
        return res.status(200).json({ ok: true, warning: 'Email notification failed, but lead saved', detail: j });
      }
      return res.status(500).json({ error: j.message || 'Resend send failed', detail: j });
    }
    console.log(`[email/send] type=${type} to=${recipient} id=${j.id}`);
    res.status(200).json({ ok: true, id: j.id });
  } catch (e) {
    console.error('[email/send] exception:', e.message);
    if (type === 'enquiry_admin_notify') {
      return res.status(200).json({ ok: true, warning: 'Email notification exception, but lead saved', error: e.message });
    }
    res.status(500).json({ error: e.message });
  }
};
module.exports.config = { api: { bodyParser: true } };
