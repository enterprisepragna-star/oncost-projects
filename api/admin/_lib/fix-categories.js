const { createClient } = require('@supabase/supabase-js');

module.exports = async function fixCategoriesHandler(req, res) {
  const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jyvmmypalshebqmnrdma.supabase.co').trim();
  const SERVICE_KEY  = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!SERVICE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set in environment variables.' });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1. Fetch categories & products
    const { data: categories, error: catErr } = await supabase.from('categories').select('*');
    if (catErr) return res.status(500).json({ error: 'Failed to fetch categories: ' + catErr.message });

    const { data: products, error: prodErr } = await supabase.from('products').select('id, name, category');
    if (prodErr) return res.status(500).json({ error: 'Failed to fetch products: ' + prodErr.message });

    const normalize = s => s ? s.trim().replace(/\s+/g, ' ').toLowerCase() : '';

    // Find canonical "Brass Collection"
    const brassCats = categories.filter(c => normalize(c.name) === 'brass collection');
    let canonical = brassCats.find(c => c.name === 'Brass Collection') || brassCats[0];

    if (!canonical) {
      const { data: created, error: cErr } = await supabase
        .from('categories')
        .insert({ id: 'f5c49720-0abd-44dc-a904-9fb902775086', name: 'Brass Collection', description: 'Authentic handmade articles of pure divine brass' })
        .select()
        .single();
      if (cErr) return res.status(500).json({ error: 'Failed to create canonical category: ' + cErr.message });
      canonical = created;
    } else if (canonical.name !== 'Brass Collection') {
      await supabase.from('categories').update({ name: 'Brass Collection' }).eq('id', canonical.id);
      canonical.name = 'Brass Collection';
    }

    // Reassign products matching "brass collection" or "brass"
    const brassProds = products.filter(p => (normalize(p.category) === 'brass collection' || normalize(p.category) === 'brass') && p.category !== 'Brass Collection');
    let updatedProductsCount = 0;
    if (brassProds.length > 0) {
      const ids = brassProds.map(p => p.id);
      const { error: pErr } = await supabase.from('products').update({ category: 'Brass Collection' }).in('id', ids);
      if (pErr) return res.status(500).json({ error: 'Failed to update products: ' + pErr.message });
      updatedProductsCount = brassProds.length;
    }

    // Delete duplicate category records
    const dupes = categories.filter(c => normalize(c.name) === 'brass collection' && c.id !== canonical.id);
    let deletedCategoriesCount = 0;
    if (dupes.length > 0) {
      const dupIds = dupes.map(c => c.id);
      const { error: dErr } = await supabase.from('categories').delete().in('id', dupIds);
      if (dErr) return res.status(500).json({ error: 'Failed to delete duplicate categories: ' + dErr.message });
      deletedCategoriesCount = dupes.length;
    }

    return res.status(200).json({
      success: true,
      canonicalCategory: canonical.name,
      canonicalId: canonical.id,
      updatedProductsCount,
      deletedCategoriesCount
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
