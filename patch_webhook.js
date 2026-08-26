const fs = require('fs');
let code = fs.readFileSync('api/delhivery/index.js', 'utf8');

const webhookCode = `
async function handleWebhook(req, res) {
  // Always respond 200 to acknowledge receipt and prevent retries
  res.status(200).json({ ok: true });
  
  try {
    const payload = req.body || {};
    // Extract AWB robustly (handles various Delhivery webhook formats)
    const awb = payload.Waybill || payload.awb || payload.Shipment?.Waybill || payload.packages?.[0]?.waybill;
    const statusText = String(payload.Status?.Status || payload.status || payload.Shipment?.Status?.Status || payload.packages?.[0]?.status || '').toUpperCase();
    const statusCode = String(payload.Status?.StatusType || payload.status_code || payload.Shipment?.Status?.StatusType || '').toUpperCase();
    
    if (!awb) {
      console.warn('[delhivery/webhook] Unrecognized payload:', JSON.stringify(payload).substring(0, 300));
      return;
    }
    
    // Determine new status
    const isShipped = statusText.includes('TRANSIT') || statusText.includes('PICKED') || statusText.includes('DISPATCH') || statusCode === 'UD' || statusCode === 'PT';
    const isDelivered = statusText.includes('DELIVERED') || statusCode === 'DL';
    
    let newDbStatus = null;
    if (isDelivered) newDbStatus = 'Delivered';
    else if (isShipped) newDbStatus = 'Shipped';
    
    if (newDbStatus) {
      const SUPABASE_URL = process.env.SUPABASE_URL;
      const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (SUPABASE_URL && SERVICE_KEY) {
        await fetch(\`\${SUPABASE_URL}/rest/v1/orders?awb_number=eq.\${encodeURIComponent(awb)}\`, {
          method: 'PATCH',
          headers: { apikey: SERVICE_KEY, Authorization: \`Bearer \${SERVICE_KEY}\`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newDbStatus }),
        });
        console.log(\`[delhivery/webhook] AWB \${awb} -> \${newDbStatus}\`);
      }
    }
  } catch (err) {
    console.error('[delhivery/webhook] Process error:', err.message);
  }
}

module.exports = async function handler(req, res) {
`;

code = code.replace('module.exports = async function handler(req, res) {', webhookCode);

code = code.replace("case 'track':             return await handleTrack(req, res);", "case 'track':             return await handleTrack(req, res);\\n      case 'webhook':           return await handleWebhook(req, res);");
code = code.replace("valid_actions: ['serviceability', 'create-shipment', 'label', 'schedule-pickup', 'track']", "valid_actions: ['serviceability', 'create-shipment', 'label', 'schedule-pickup', 'track', 'webhook']");

fs.writeFileSync('api/delhivery/index.js', code);
