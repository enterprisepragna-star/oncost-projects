/**
 * ONCOST Category Deduplication Utility
 * Usage: SUPABASE_SERVICE_ROLE_KEY=your_key node tools/fix-duplicate-categories.js
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jyvmmypalshebqmnrdma.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

function normalizeCategoryName(name) {
  if (!name) return '';
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

async function fixDuplicateCategories() {
  if (!SERVICE_KEY) {
    console.log('⚠️  SUPABASE_SERVICE_ROLE_KEY is not set in environment.');
    console.log('   Please run: SUPABASE_SERVICE_ROLE_KEY="your_service_role_key" node tools/fix-duplicate-categories.js');
    console.log('   Or execute migration_fix_duplicate_categories.sql directly in Supabase SQL Editor.');
    return;
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  console.log('🔍 Fetching categories and products from Supabase...');

  const { data: categories, error: catErr } = await supabase.from('categories').select('*');
  if (catErr) {
    console.error('❌ Error fetching categories:', catErr.message);
    return;
  }

  const { data: products, error: prodErr } = await supabase.from('products').select('id, name, category');
  if (prodErr) {
    console.error('❌ Error fetching products:', prodErr.message);
    return;
  }

  console.log(`📊 Found ${categories.length} total category rows and ${products.length} total products.`);

  // Find canonical category for 'brass collection'
  const brassCats = categories.filter(c => normalizeCategoryName(c.name) === 'brass collection');
  let canonicalBrass = brassCats.find(c => c.name === 'Brass Collection') || brassCats[0];

  if (!canonicalBrass) {
    console.log('➕ Creating canonical "Brass Collection" category...');
    const { data: newCat, error: createErr } = await supabase
      .from('categories')
      .insert({ id: 'f5c49720-0abd-44dc-a904-9fb902775086', name: 'Brass Collection', description: 'Authentic handmade articles of pure divine brass' })
      .select()
      .single();
    if (createErr) {
      console.error('❌ Error creating canonical category:', createErr.message);
      return;
    }
    canonicalBrass = newCat;
  } else if (canonicalBrass.name !== 'Brass Collection') {
    // Rename to canonical casing
    await supabase.from('categories').update({ name: 'Brass Collection' }).eq('id', canonicalBrass.id);
    canonicalBrass.name = 'Brass Collection';
  }

  console.log(`✅ Canonical Category: "${canonicalBrass.name}" (ID: ${canonicalBrass.id})`);

  // Identify product reassignments
  const brassProductsToUpdate = products.filter(p => {
    const norm = normalizeCategoryName(p.category);
    return (norm === 'brass collection' || norm === 'brass') && p.category !== 'Brass Collection';
  });

  if (brassProductsToUpdate.length > 0) {
    console.log(`📦 Reassigning ${brassProductsToUpdate.length} products to "Brass Collection"...`);
    const idsToUpdate = brassProductsToUpdate.map(p => p.id);
    const { error: updateErr } = await supabase
      .from('products')
      .update({ category: 'Brass Collection' })
      .in('id', idsToUpdate);

    if (updateErr) {
      console.error('❌ Error reassigning products:', updateErr.message);
    } else {
      console.log(`   ✅ Successfully reassigned ${brassProductsToUpdate.length} products to "Brass Collection".`);
    }
  } else {
    console.log('   All Brass products are already assigned to "Brass Collection".');
  }

  // Delete duplicate category records
  const dupesToDelete = categories.filter(c => {
    const norm = normalizeCategoryName(c.name);
    return norm === 'brass collection' && c.id !== canonicalBrass.id;
  });

  if (dupesToDelete.length > 0) {
    console.log(`🗑️ Deleting ${dupesToDelete.length} duplicate category rows...`);
    const dupIds = dupesToDelete.map(c => c.id);
    const { error: delErr } = await supabase.from('categories').delete().in('id', dupIds);
    if (delErr) {
      console.error('❌ Error deleting duplicate categories:', delErr.message);
    } else {
      console.log(`   ✅ Deleted duplicate categories: ${dupesToDelete.map(c => `"${c.name}"`).join(', ')}`);
    }
  } else {
    console.log('   No duplicate category rows found in DB to delete.');
  }

  console.log('\n🎉 Category cleanup completed successfully!');
}

if (require.main === module) {
  fixDuplicateCategories();
}

module.exports = { fixDuplicateCategories, normalizeCategoryName };
