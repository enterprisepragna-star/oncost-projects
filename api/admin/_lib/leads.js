module.exports = async function handler(req, res) {
  let SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
  if (!SUPABASE_URL.startsWith('http') || SUPABASE_URL.startsWith('sb_')) {
    SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jyvmmypalshebqmnrdma.supabase.co';
  }
  const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: 'Missing Supabase config' });
  }

  // Verify Admin via Supabase token
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Missing authorization header' });

  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: authHeader, apikey: SERVICE_KEY }
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Invalid token' });
    const user = await userRes.json();
    
    if (user.email !== 'enterprisepragna@gmail.com') {
      return res.status(403).json({ error: 'Forbidden. Admin access required.' });
    }

    const { action, id, payload } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing lead ID' });

    if (req.method === 'PUT' || action === 'update') {
      const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(payload)
      });
      if (!updateRes.ok) throw new Error(await updateRes.text());
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE' || action === 'delete') {
      const delRes = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`
        }
      });
      if (!delRes.ok) throw new Error(await delRes.text());
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[admin/leads]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
module.exports.config = { api: { bodyParser: true } };
