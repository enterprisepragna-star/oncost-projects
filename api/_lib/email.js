const { Resend } = require('resend');
const { generateInvoicePDF } = require('../email/_lib/invoice-pdf');

// Requires RESEND_API_KEY in environment
const resend = new Resend(process.env.RESEND_API_KEY || 're_dummy_key');
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'enterprisepragna@oncost.shop'; // Ensure this domain is verified in Resend

function formatINR(val) {
  return '₹' + Number(val || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function buildInvoiceHtml(order, isAdmin = false) {
  const items = Array.isArray(order.items) ? order.items : (order.items?.items || []);
  const ship = order.shipping_address || {};
  
  const itemsHtml = items.map(it => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: left;">
        <div style="font-weight:bold;">${it.name || it.product_id}</div>
        ${it.barcode ? `<div style="font-size:11px;color:#666;">Barcode: ${it.barcode}</div>` : ''}
        ${it.weight_grams ? `<div style="font-size:11px;color:#666;">Weight: ${it.weight_grams}g</div>` : ''}
      </td>
      <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center;">${it.qty || it.quantity || 1}</td>
      <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">${formatINR(it.price)}</td>
      <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right; font-weight: bold;">${formatINR((it.price || 0) * (it.qty || it.quantity || 1))}</td>
    </tr>
  `).join('');

  return `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333; line-height: 1.6;">
      <div style="text-align: center; padding: 20px 0; background-color: #6C2237; color: ${isAdmin ? '#f2dd92' : 'white'}; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 24px;">${isAdmin ? '🎉 NEW ORDER RECEIVED' : 'ONCOST'}</h1>
        <p style="margin: 5px 0 0;">${isAdmin ? 'Admin Notification Copy' : 'Order Confirmation & Invoice'}</p>
      </div>
      
      <div style="padding: 30px; border: 1px solid #eaeaea; border-top: none; border-radius: 0 0 8px 8px;">
        <p style="font-size: 16px;">Hi <strong>${isAdmin ? 'Admin' : (ship.name || 'Customer')}</strong>,</p>
        <p>${isAdmin ? 'A new order has just been successfully paid and placed on your website.' : 'Thank you for your purchase! We\'ve received your order and are getting it ready for shipment.'}</p>
        
        <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
          <tr>
            <td style="padding-bottom: 10px;"><strong>Invoice / Order ID:</strong> ${order.invoice_number || order.ccavenue_order_id || order.id.substring(0, 8).toUpperCase()}</td>
            <td style="padding-bottom: 10px; text-align: right;"><strong>Date:</strong> ${new Date(order.created_at || Date.now()).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
          </tr>
        </table>
        
        <h3 style="border-bottom: 2px solid #6C2237; padding-bottom: 8px; margin-top: 30px;">Order Summary</h3>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
          <thead>
            <tr style="background-color: #f9f9f9;">
              <th style="padding: 12px; text-align: left; border-bottom: 2px solid #ddd;">Product</th>
              <th style="padding: 12px; text-align: center; border-bottom: 2px solid #ddd;">Qty</th>
              <th style="padding: 12px; text-align: right; border-bottom: 2px solid #ddd;">Price</th>
              <th style="padding: 12px; text-align: right; border-bottom: 2px solid #ddd;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3" style="padding: 12px; text-align: right; border-bottom: 1px solid #eee;">Subtotal</td>
              <td style="padding: 12px; text-align: right; border-bottom: 1px solid #eee;">${formatINR(order.items_subtotal || order.total_amount)}</td>
            </tr>
            <tr>
              <td colspan="3" style="padding: 12px; text-align: right; border-bottom: 1px solid #eee;">Shipping</td>
              <td style="padding: 12px; text-align: right; border-bottom: 1px solid #eee;">${Number(order.shipping_amount) > 0 ? formatINR(order.shipping_amount) : '<span style="color:green;">Free</span>'}</td>
            </tr>
            ${order.discount_amount > 0 ? `
            <tr>
              <td colspan="3" style="padding: 12px; text-align: right; border-bottom: 1px solid #eee; color: green;">Discount</td>
              <td style="padding: 12px; text-align: right; border-bottom: 1px solid #eee; color: green;">-${formatINR(order.discount_amount)}</td>
            </tr>` : ''}
            <tr>
              <td colspan="3" style="padding: 12px; text-align: right; font-weight: bold; font-size: 18px;">Total Paid</td>
              <td style="padding: 12px; text-align: right; font-weight: bold; font-size: 18px; color: #6C2237;">${formatINR(order.total_amount)}</td>
            </tr>
          </tfoot>
        </table>

        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 6px;">
          <h4 style="margin-top: 0; margin-bottom: 10px;">${isAdmin ? 'Customer Details' : 'Shipping Details'}</h4>
          <p style="margin: 0;">
            <strong>${ship.name}</strong><br>
            ${ship.address}<br>
            ${ship.city}, ${ship.state} ${ship.zip}<br>
            Phone: ${ship.phone}<br>
            Email: ${ship.email || order.guest_email || '—'}
          </p>
        </div>
        
        <div style="margin-top: 30px; font-size: 14px; color: #666; text-align: left; background:#f9f9f9; padding: 16px; border-radius:6px; border:1px solid #eaeaea;">
          <strong>Notes:</strong> ${isAdmin ? 'Log into the ONCOST Admin Dashboard to fulfill this order and generate the shipping label.' : 'Thank you for shopping with us! For returns or queries, contact support within 7 days of delivery.'}<br><br>
          <em style="font-size:12px;">This is a computer-generated ${isAdmin ? 'notification' : 'invoice'}.</em>
        </div>
        
        <p style="margin-top: 30px; font-size: 14px; color: #666; text-align: center;">
          ${isAdmin ? 'Powered by ONCOST Platform' : 'If you have any questions, reply to this email or contact us via WhatsApp.'}
        </p>
      </div>
    </div>
  `;
}

function buildTrackingHtml(order, statusText, location) {
  const ship = order.shipping_address || {};
  return `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333; line-height: 1.6;">
      <div style="text-align: center; padding: 20px 0; background-color: #6C2237; color: white; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 24px;">Package Update</h1>
      </div>
      <div style="padding: 30px; border: 1px solid #eaeaea; border-top: none; border-radius: 0 0 8px 8px;">
        <p style="font-size: 16px;">Hi <strong>${ship.name || 'Customer'}</strong>,</p>
        <p>Your order <strong>#${order.id.substring(0, 8).toUpperCase()}</strong> has a new tracking update from Delhivery!</p>
        
        <div style="background-color: #f0f7ff; padding: 20px; border-radius: 6px; border-left: 4px solid #0066cc; margin: 25px 0;">
          <h3 style="margin-top: 0; color: #0066cc;">Status: ${statusText}</h3>
          ${location ? `<p style="margin: 0;"><strong>Location:</strong> ${location}</p>` : ''}
        </div>
        
        ${ship.tracking_url ? `
        <div style="text-align: center; margin: 30px 0;">
          <a href="${ship.tracking_url}" style="background-color: #6C2237; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">Track Package Live</a>
        </div>` : ''}
        
        <p style="margin-top: 30px; font-size: 14px; color: #666; text-align: center;">
          Thank you for shopping with ONCOST.
        </p>
      </div>
    </div>
  `;
}

async function sendAdminNewOrder(order) {
  if (!process.env.RESEND_API_KEY) {
    console.log('[Email] RESEND_API_KEY missing. Skipping admin email.');
    return;
  }
  
  const ADMIN_EMAIL = 'enterprisepragna@oncost.shop';
  const amount = String(order.total_amount || '');
  const orderId = order.id || order.ccavenue_order_id || '';
  
  const html = buildInvoiceHtml(order, true);

  try {
    const { data, error } = await resend.emails.send({
      from: `ONCOST System <system@oncost.shop>`,
      to: [ADMIN_EMAIL],
      subject: `🛒 New order on oncost.shop · ${orderId} · ₹${amount}`,
      html: html,
    });
    
    if (error) {
      console.error(`[Email] Failed to send admin notification (Resend API Error):`, JSON.stringify(error));
    } else {
      console.log(`[Email] Admin notification sent successfully to ${ADMIN_EMAIL}`);
    }
  } catch (err) {
    console.error(`[Email] Failed to send admin notification (Exception):`, err.message);
  }
}

async function sendOrderConfirmation(order) {
  if (!process.env.RESEND_API_KEY) {
    console.log('[Email] RESEND_API_KEY missing. Skipping email.');
    return;
  }
  const toEmail = order.guest_email || (order.shipping_address && order.shipping_address.email);
  if (!toEmail) return;

  try {
    let attachments = undefined;
    try {
      const pdfBuffer = await generateInvoicePDF({ order });
      attachments = [{
        filename: `Invoice_${order.invoice_number || order.id.substring(0, 8)}.pdf`,
        content: pdfBuffer
      }];
    } catch(e) {
      console.error('[Email] PDF generation failed:', e.message);
    }

    const { data, error } = await resend.emails.send({
      from: `ONCOST Orders <${FROM_EMAIL}>`,
      to: [toEmail],
      subject: `Order Confirmation & Invoice #${order.id.substring(0, 8).toUpperCase()}`,
      html: buildInvoiceHtml(order),
      attachments
    });
    
    if (error) {
      console.error(`[Email] Failed to send order confirmation to ${toEmail} (Resend API Error):`, JSON.stringify(error));
    } else {
      console.log(`[Email] Order confirmation sent to ${toEmail}`);
    }
  } catch (err) {
    console.error(`[Email] Failed to send order confirmation to ${toEmail} (Exception):`, err.message);
  }
}

async function sendTrackingUpdate(order, statusText, location = '') {
  if (!process.env.RESEND_API_KEY) {
    console.log('[Email] RESEND_API_KEY missing. Skipping email.');
    return;
  }
  const toEmail = order.guest_email || (order.shipping_address && order.shipping_address.email);
  if (!toEmail) return;

  try {
    await resend.emails.send({
      from: `ONCOST Updates <${FROM_EMAIL}>`,
      to: [toEmail],
      subject: `Package Update: ${statusText} - Order #${order.id.substring(0, 8).toUpperCase()}`,
      html: buildTrackingHtml(order, statusText, location),
    });
    console.log(`[Email] Tracking update sent to ${toEmail}`);
  } catch (err) {
    console.error(`[Email] Failed to send tracking update to ${toEmail}:`, err.message);
  }
}

module.exports = {
  sendOrderConfirmation,
  sendTrackingUpdate,
  sendAdminNewOrder
};
