// PDF invoice generator using pdf-lib (pure JS, serverless-friendly).
// Returns a Buffer ready for Resend attachment (base64) or Supabase upload.
//
// generateInvoicePDF({ order, seller, products }) → Promise<Buffer>
//
// order: { invoice_number, ccavenue_order_id, created_at, items, total_amount, items_subtotal,
//          shipping_amount, discount_amount, shipping_address, guest_email, guest_phone,
//          payment_method, payment_tracking_id }
// products: optional map { [product_id]: { hsn_code, gst_percent, name } } - enriches items
// seller: { name, address, gstin, state, email, phone, logo? }  (sensible defaults applied)

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const DEFAULT_SELLER = {
  name: 'ONCOST',
  legal: 'Pragna Enterprise',
  address: 'Bengaluru, Karnataka, India',
  gstin: '',
  state: 'Karnataka',
  state_code: '29',
  email: 'enterprisepragna@gmail.com',
  phone: '+91-99001-23456',
  website: 'www.oncost.shop',
};

function inr(n) {
  const v = Number(n || 0);
  return 'Rs. ' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function safe(s) { return String(s == null ? '' : s); }

async function generateInvoicePDF({ order, products = {}, seller = {} }) {
  const S = { ...DEFAULT_SELLER, ...seller };
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4 portrait
  const fontReg = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const W = 595.28;
  const H = 841.89;
  const M = 36;
  const colors = {
    brand:  rgb(0.478, 0.122, 0.208),   // #7a1f35 wine
    accent: rgb(0.949, 0.867, 0.573),   // #f2dd92 gold
    line:   rgb(0.86, 0.83, 0.78),
    text:   rgb(0.12, 0.12, 0.14),
    muted:  rgb(0.40, 0.38, 0.36),
  };

  const draw = (txt, x, y, opts = {}) => {
    page.drawText(safe(txt), {
      x, y,
      size: opts.size || 9,
      font: opts.bold ? fontBold : fontReg,
      color: opts.color || colors.text,
      maxWidth: opts.maxWidth,
    });
  };

  // ---------- Header band ----------
  page.drawRectangle({ x: 0, y: H - 80, width: W, height: 80, color: colors.brand });
  draw('ONCOST', M, H - 38, { size: 26, bold: true, color: colors.accent });
  draw('Premium gifting  ·  oncost.shop', M, H - 58, { size: 9, color: colors.accent });

  draw('TAX INVOICE', W - M - 110, H - 36, { size: 16, bold: true, color: colors.accent });
  draw(`Invoice #: ${safe(order.invoice_number || order.ccavenue_order_id || '-')}`, W - M - 200, H - 56, { size: 9, color: colors.accent });
  draw(`Date: ${new Date(order.created_at || Date.now()).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })}`, W - M - 200, H - 70, { size: 9, color: colors.accent });

  // ---------- Seller / buyer block ----------
  let y = H - 110;
  draw('SOLD BY', M, y, { size: 8, bold: true, color: colors.muted });
  draw('BILL TO', W/2 + 10, y, { size: 8, bold: true, color: colors.muted });
  y -= 14;
  draw(S.legal || S.name, M, y, { size: 11, bold: true });
  draw(safe(order.shipping_address?.name || order.guest_email || '-'), W/2 + 10, y, { size: 11, bold: true });
  y -= 13;
  draw(S.address, M, y, { size: 9 });
  draw(safe(order.shipping_address?.address || ''), W/2 + 10, y, { size: 9, maxWidth: 250 });
  y -= 12;
  if (S.gstin) draw(`GSTIN: ${S.gstin}`, M, y, { size: 9 });
  const cityLine = [order.shipping_address?.city, order.shipping_address?.state, order.shipping_address?.zip].filter(Boolean).join(', ');
  draw(cityLine, W/2 + 10, y, { size: 9, maxWidth: 250 });
  y -= 12;
  draw(`State: ${S.state} (${S.state_code})`, M, y, { size: 9 });
  draw(`State: ${safe(order.shipping_address?.state || '-')}`, W/2 + 10, y, { size: 9 });
  y -= 12;
  draw(`Email: ${S.email}`, M, y, { size: 9 });
  draw(`Email: ${safe(order.guest_email || order.shipping_address?.email || '-')}`, W/2 + 10, y, { size: 9 });
  y -= 12;
  draw(`Phone: ${S.phone}`, M, y, { size: 9 });
  draw(`Phone: ${safe(order.guest_phone || order.shipping_address?.phone || '-')}`, W/2 + 10, y, { size: 9 });

  // ---------- Order meta ----------
  y -= 22;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.7, color: colors.line });
  y -= 12;
  draw(`Order ID: ${safe(order.ccavenue_order_id || order.id || '')}`, M, y, { size: 9 });
  draw(`Payment: ${safe(order.payment_method || 'CCAvenue')}`, M + 220, y, { size: 9 });
  draw(`Txn: ${safe(order.payment_tracking_id || '-')}`, M + 360, y, { size: 9 });

  // ---------- Items table ----------
  y -= 22;
  // Column layout
  const cols = [
    { key: 'sl',    label: '#',           x: M,         w: 22,  align: 'left' },
    { key: 'name',  label: 'Description', x: M + 24,   w: 200, align: 'left' },
    { key: 'hsn',   label: 'HSN',         x: M + 226,  w: 50,  align: 'left' },
    { key: 'qty',   label: 'Qty',         x: M + 280,  w: 32,  align: 'right' },
    { key: 'rate',  label: 'Rate',        x: M + 316,  w: 70,  align: 'right' },
    { key: 'gst',   label: 'GST%',        x: M + 388,  w: 40,  align: 'right' },
    { key: 'total', label: 'Amount',      x: M + 430,  w: 90,  align: 'right' },
  ];
  // Header row
  page.drawRectangle({ x: M - 4, y: y - 4, width: W - 2*M + 8, height: 18, color: colors.accent });
  cols.forEach(c => {
    const tx = c.align === 'right' ? c.x + c.w - (fontBold.widthOfTextAtSize(c.label, 9)) : c.x;
    page.drawText(c.label, { x: tx, y: y + 2, size: 9, font: fontBold, color: colors.brand });
  });
  y -= 20;

  // Body rows
  const items = Array.isArray(order.items) ? order.items : [];
  let taxableTotal = 0;
  let gstTotal = 0;
  items.forEach((it, idx) => {
    const prod = products[it.product_id] || {};
    const name = it.name || prod.name || '-';
    const variant = it.variant_name ? ` (${it.variant_name})` : '';
    const qty = Number(it.qty || it.quantity || 1);
    const price = Number(it.price || it.unit_price || 0);
    const gstPct = Number(it.gst_percent != null ? it.gst_percent : (prod.gst_percent != null ? prod.gst_percent : 18));
    const hsn = it.hsn_code || prod.hsn_code || '-';
    const lineGross = price * qty;
    const lineTaxable = +(lineGross / (1 + gstPct/100)).toFixed(2);
    const lineGst = +(lineGross - lineTaxable).toFixed(2);
    taxableTotal += lineTaxable;
    gstTotal += lineGst;

    if (y < 140) {
      // simple page break
      const newPage = doc.addPage([W, H]);
      newPage.drawText('- continued -', { x: M, y: H - 40, size: 9, font: fontReg, color: colors.muted });
      y = H - 70;
    }

    const vals = {
      sl:    String(idx + 1),
      name:  (name + variant).slice(0, 50),
      hsn:   String(hsn),
      qty:   String(qty),
      rate:  inr(price),
      gst:   `${gstPct}%`,
      total: inr(lineGross),
    };
    cols.forEach(c => {
      const t = vals[c.key];
      const w = fontReg.widthOfTextAtSize(t, 9);
      const tx = c.align === 'right' ? c.x + c.w - w : c.x;
      draw(t, tx, y, { size: 9 });
    });
    y -= 16;
  });

  // ---------- Totals ----------
  page.drawLine({ start: { x: M, y: y - 2 }, end: { x: W - M, y: y - 2 }, thickness: 0.7, color: colors.line });
  y -= 14;
  const subtotal = Number(order.items_subtotal != null ? order.items_subtotal : taxableTotal + gstTotal);
  const shipping = Number(order.shipping_amount || 0);
  const discount = Number(order.discount_amount || 0);
  const grand    = Number(order.total_amount != null ? order.total_amount : (subtotal + shipping - discount));

  const labelX = W - M - 200;
  const valueX = W - M;
  const drawTot = (lbl, val, bold = false) => {
    const t = inr(val);
    const w = (bold ? fontBold : fontReg).widthOfTextAtSize(t, 10);
    draw(lbl, labelX, y, { size: 10, bold });
    draw(t, valueX - w, y, { size: 10, bold });
    y -= 14;
  };

  drawTot('Taxable value', taxableTotal);
  drawTot(`GST (CGST+SGST or IGST)`, gstTotal);
  if (shipping)  drawTot('Shipping', shipping);
  if (discount)  drawTot('Discount', -discount);
  y -= 4;
  page.drawRectangle({ x: labelX - 8, y: y - 4, width: (valueX - labelX) + 12, height: 22, color: colors.accent });
  drawTot('GRAND TOTAL', grand, true);

  // ---------- Footer ----------
  y -= 24;
  draw('Notes', M, y, { size: 9, bold: true, color: colors.muted });
  y -= 12;
  draw('Thank you for shopping with us! For returns or queries, contact support within 7 days of delivery.', M, y, { size: 8, color: colors.muted, maxWidth: W - 2*M });
  y -= 10;
  draw('This is a computer-generated invoice - no signature required.', M, y, { size: 8, color: colors.muted });

  // Bottom band
  page.drawRectangle({ x: 0, y: 0, width: W, height: 28, color: colors.brand });
  draw(`${S.website}  ·  ${S.email}  ·  ${S.phone}`, M, 10, { size: 9, color: colors.accent });
  draw('Thank you for shopping with ONCOST', W - M - 200, 10, { size: 9, bold: true, color: colors.accent });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

module.exports = { generateInvoicePDF };
