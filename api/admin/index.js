const leadsHandler = require('./_lib/leads');
const recoverOrderHandler = require('./_lib/recover-order');

module.exports = async function handler(req, res) {
  const action = req.query.action || '';
  if (action === 'leads') return leadsHandler(req, res);
  if (action === 'recover-order') return recoverOrderHandler(req, res);
  if (action === 'polish-review') return polishReview(req, res);
  if (action === 'ai-parse-products') return aiParseProducts(req, res);
  return res.status(404).json({ error: 'Action not found' });
};

// ---------------------------------------------------------------------------
// AI Document Parsing — extracts product catalog data from raw text
// via Emergent LLM key (gpt-4o-mini).
// ---------------------------------------------------------------------------
async function aiParseProducts(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

  // Auth: Supabase user token must belong to an admin email
  const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
  const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'enterprisepragna@gmail.com')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Admin sign-in required' });
  const uRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey: SERVICE_KEY } });
  const user = uRes.ok ? await uRes.json() : null;
  if (!user || !ADMIN_EMAILS.includes((user.email || '').toLowerCase())) {
    return res.status(403).json({ error: 'Admin access only' });
  }

  const text = String((req.body || {}).text || '').trim();
  if (text.length < 10) return res.status(400).json({ error: 'Text too short.' });
  
  // Truncate to avoid massive context window blowouts if they upload a 100 page PDF
  const safeText = text.slice(0, 15000); 

  const LLM_KEY = (process.env.EMERGENT_LLM_KEY || '').trim();
  if (!LLM_KEY) return res.status(500).json({ error: 'EMERGENT_LLM_KEY not set.' });

  try {
    const r = await fetch('https://integrations.emergentagent.com/llm/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${LLM_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are a data extraction assistant. The user will provide raw text from a PDF, Word document, or raw notes. Extract all distinct products mentioned. Return a JSON object with a single key "products", which is an array of objects. Each object should have these exact uppercase keys: "NAME", "SKU", "CATEGORY", "PRICE", "SALE PRICE", "ON HAND", "DESCRIPTION". Infer categories and prices if obvious. If a value is unknown, use an empty string. Output ONLY valid JSON.',
          },
          { role: 'user', content: safeText },
        ],
      }),
    });
    const j = await r.json();
    const rawContent = j?.choices?.[0]?.message?.content?.trim();
    if (!r.ok || !rawContent) {
      console.error('[admin/ai-parse] LLM error:', JSON.stringify(j).slice(0, 300));
      return res.status(502).json({ error: j?.error?.message || 'AI service unavailable.' });
    }
    
    let parsed;
    try {
      parsed = JSON.parse(rawContent);
    } catch(err) {
      return res.status(500).json({ error: 'AI returned invalid JSON.' });
    }
    
    res.status(200).json({ ok: true, products: parsed.products || [] });
  } catch (e) {
    console.error('[admin/ai-parse] failed:', e.message);
    res.status(500).json({ error: 'AI Parse failed: ' + e.message });
  }
}

// ---------------------------------------------------------------------------
// AI review polish — admin-only. Rewrites a customer review professionally
// via Emergent LLM key (gpt-4o-mini). Never invents facts.
// ---------------------------------------------------------------------------
async function polishReview(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

  // Auth: Supabase user token must belong to an admin email
  const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
  const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'enterprisepragna@gmail.com')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Admin sign-in required' });
  const uRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey: SERVICE_KEY } });
  const user = uRes.ok ? await uRes.json() : null;
  if (!user || !ADMIN_EMAILS.includes((user.email || '').toLowerCase())) {
    return res.status(403).json({ error: 'Admin access only' });
  }

  const text = String((req.body || {}).text || '').trim();
  if (text.length < 5) return res.status(400).json({ error: 'Review text too short to polish.' });
  if (text.length > 1500) return res.status(400).json({ error: 'Review text too long (max 1500 chars).' });

  const LLM_KEY = (process.env.EMERGENT_LLM_KEY || '').trim();
  if (!LLM_KEY) return res.status(500).json({ error: 'EMERGENT_LLM_KEY not set in Vercel environment variables.' });

  try {
    const r = await fetch('https://integrations.emergentagent.com/llm/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${LLM_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.4,
        max_tokens: 200,
        messages: [
          {
            role: 'system',
            content: 'You polish customer reviews for ONCOST, a premium Indian gifting brand. Improve grammar, clarity and professionalism while strictly preserving the original meaning and sentiment. NEVER invent facts, products, features or praise that are not in the original text. Keep it 1–3 warm, authentic sentences in first person. Return ONLY the polished review text, no quotes, no preamble.',
          },
          { role: 'user', content: text },
        ],
      }),
    });
    const j = await r.json();
    const polished = j?.choices?.[0]?.message?.content?.trim();
    if (!r.ok || !polished) {
      console.error('[admin/polish-review] LLM error:', JSON.stringify(j).slice(0, 300));
      return res.status(502).json({ error: j?.error?.message || 'AI service unavailable, try again.' });
    }
    res.status(200).json({ ok: true, polished });
  } catch (e) {
    console.error('[admin/polish-review] failed:', e.message);
    res.status(500).json({ error: 'Polish failed: ' + e.message });
  }
}
