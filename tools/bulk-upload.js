/**
 * ONCOST Bulk Product Upload Script
 * ===================================
 * Reads an Excel/CSV file and a folder of product images,
 * uploads images to Supabase Storage, and inserts all products
 * into your Supabase database in one batch.
 *
 * SETUP (run once):
 *   cd tools
 *   npm install @supabase/supabase-js xlsx dotenv
 *
 * USAGE:
 *   node bulk-upload.js --file "C:\path\to\products.xlsx" --images "E:\ProductImages"
 *
 * OPTIONS:
 *   --file    Path to your Excel (.xlsx) or CSV (.csv) file
 *   --images  Path to your folder of product images (hard drive)
 *   --dry-run Just preview what will be uploaded, no actual inserts
 *   --skip-images  Skip image uploads (products only)
 */

require('dotenv').config({ path: '../.env.local' });
const fs   = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// ── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL         = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_BUCKET       = 'product-images';
const CHUNK_SIZE           = 20; // insert in batches of 20

// ── Parse CLI args ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const get  = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
const FILE_PATH    = get('--file');
const IMAGES_DIR   = get('--images');
const DRY_RUN      = args.includes('--dry-run');
const SKIP_IMAGES  = args.includes('--skip-images');

if (!FILE_PATH) {
  console.error('❌  --file is required. Example: node bulk-upload.js --file products.xlsx --images E:\\Images');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌  SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in ../.env.local');
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const slugify = (s) =>
  String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || ('id-' + Date.now());

const supabaseHeaders = {
  apikey:        SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Prefer:        'return=representation',
};

async function supabaseFetch(endpoint, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
  const res = await fetch(url, { ...options, headers: { ...supabaseHeaders, ...(options.headers || {}) } });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`Supabase error ${res.status}: ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  return json;
}

// ── Find image file ───────────────────────────────────────────────────────────
function findImageFile(imagesDir, baseName) {
  if (!imagesDir || !baseName) return null;
  const exts = ['.jpg', '.JPG', '.jpeg', '.JPEG', '.png', '.PNG', '.webp', '.WEBP'];
  for (const ext of exts) {
    const full = path.join(imagesDir, baseName + ext);
    if (fs.existsSync(full)) return full;
  }
  // Try searching subdirectories one level deep
  try {
    const entries = fs.readdirSync(imagesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        for (const ext of exts) {
          const full = path.join(imagesDir, entry.name, baseName + ext);
          if (fs.existsSync(full)) return full;
        }
      }
    }
  } catch (_) {}
  return null;
}

// ── Upload image to Supabase Storage ─────────────────────────────────────────
async function uploadImage(localPath, sku) {
  const ext      = path.extname(localPath).toLowerCase().replace('.', '');
  const mimeMap  = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  const mime     = mimeMap[ext] || 'image/jpeg';
  const fileName = `${slugify(sku)}-${Date.now()}.${ext}`;
  const fileData = fs.readFileSync(localPath);

  const url = `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${fileName}`;
  const res = await fetch(url, {
    method:  'POST',
    headers: {
      apikey:         SUPABASE_SERVICE_KEY,
      Authorization:  `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': mime,
      'Cache-Control':'31536000',
    },
    body: fileData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Storage upload failed: ${err}`);
  }

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${fileName}`;
  return publicUrl;
}

// ── Parse Excel / CSV ─────────────────────────────────────────────────────────
function parseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let rows;
  if (ext === '.csv') {
    const wb = XLSX.readFile(filePath, { type: 'file', raw: false });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  } else {
    const wb = XLSX.readFile(filePath);
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  }
  // Normalize headers to uppercase
  return rows.map(r => {
    const o = {};
    Object.entries(r).forEach(([k, v]) => { o[String(k).trim().toUpperCase().replace(/\s+/g, '_')] = v; });
    return o;
  });
}

// ── Map row to product ────────────────────────────────────────────────────────
function mapRow(r) {
  const name = String(r.NAME || '').trim();
  if (!name) return null;
  const sku    = String(r.SKU || '').trim() || null;
  const id     = slugify(sku || name);
  const isCombo = String(r.IS_COMBO || '').toLowerCase() === 'yes';
  return {
    id,
    name,
    sku,
    category:     String(r.CATEGORY || '').trim() || null,
    price:        Number(String(r.PRICE || '0').replace(/,/g,'')) || 0,
    offer_price:  r.SALE_PRICE ? Number(String(r.SALE_PRICE).replace(/,/g,'')) || null : null,
    stock:        parseInt(String(r.STOCK || '0')) || 0,
    moq:          parseInt(String(r.MOQ || '1')) || 1,
    description:  String(r.DESCRIPTION || '').trim() || null,
    status:       String(r.STATUS || 'Active').trim() || 'Active',
    badge:        String(r.BADGE || '').trim() || null,
    barcode:      String(r.BARCODE || '').trim() || null,
    hsn_code:     String(r.HSN_CODE || '').trim() || null,
    gst_percent:  Number(r.GST_PERCENT || 0) || 0,
    is_combo:     isCombo,
    combo_moq:    isCombo && r.COMBO_MOQ ? Number(r.COMBO_MOQ) || null : null,
    combo_label:  isCombo ? String(r.COMBO_LABEL || '').trim() || null : null,
    image_file:   String(r.IMAGE_FILE || '').trim() || null, // temp field, replaced with URL
    image_url:    null,
    image_urls:   null,
  };
}

// ── Ensure categories exist ───────────────────────────────────────────────────
async function ensureCategories(categoryNames) {
  if (!categoryNames.length) return;
  console.log(`\n📁  Ensuring ${categoryNames.length} categories exist...`);
  const existing = await supabaseFetch('categories?select=name');
  const existSet = new Set((existing || []).map(c => c.name));
  const toCreate = categoryNames.filter(n => !existSet.has(n));
  if (!toCreate.length) { console.log('   All categories already exist.'); return; }
  for (const name of toCreate) {
    if (DRY_RUN) { console.log(`   [dry-run] Would create category: ${name}`); continue; }
    await supabaseFetch('categories', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    console.log(`   ✅ Created category: ${name}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🚀  ONCOST Bulk Product Upload');
  console.log('================================');
  console.log(`File:    ${FILE_PATH}`);
  console.log(`Images:  ${IMAGES_DIR || '(skipped)'}`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log('================================\n');

  // 1. Parse file
  console.log('📄  Reading product file...');
  const raw = parseFile(FILE_PATH);
  console.log(`   Found ${raw.length} rows.`);

  // 2. Map rows
  const products = raw.map(mapRow).filter(Boolean);
  console.log(`   Valid products: ${products.length}`);
  if (!products.length) { console.error('❌  No valid products found. Make sure NAME column exists.'); process.exit(1); }

  // 3. Ensure categories
  const cats = [...new Set(products.map(p => p.category).filter(Boolean))];
  await ensureCategories(cats);

  // 4. Upload images
  if (!SKIP_IMAGES && IMAGES_DIR) {
    console.log('\n🖼️   Uploading images...');
    let uploaded = 0, missing = 0, failed = 0;
    for (const p of products) {
      if (!p.image_file) { missing++; continue; }
      const localPath = findImageFile(IMAGES_DIR, p.image_file);
      if (!localPath) {
        console.warn(`   ⚠️  Image not found: ${p.image_file} (product: ${p.name})`);
        missing++;
        continue;
      }
      if (DRY_RUN) {
        console.log(`   [dry-run] Would upload: ${localPath} → ${p.sku || p.name}`);
        uploaded++;
        continue;
      }
      try {
        const url = await uploadImage(localPath, p.sku || p.name);
        p.image_url  = url;
        p.image_urls = [url];
        uploaded++;
        process.stdout.write(`   ✅ ${p.image_file} → uploaded (${uploaded}/${products.length - missing})\r`);
      } catch (err) {
        console.warn(`\n   ❌ Upload failed for ${p.image_file}: ${err.message}`);
        failed++;
      }
    }
    console.log(`\n   Images: ${uploaded} uploaded, ${missing} not found, ${failed} failed.`);
  }

  // 5. Insert products in batches
  console.log('\n💾  Inserting products into Supabase...');
  let inserted = 0, skipped = 0, updated = 0;

  // Remove temp image_file field before insert
  const toInsert = products.map(p => {
    const { image_file, ...rest } = p;
    return rest;
  });

  for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
    const chunk = toInsert.slice(i, i + CHUNK_SIZE);
    if (DRY_RUN) {
      console.log(`   [dry-run] Would upsert ${chunk.length} products (batch ${Math.floor(i/CHUNK_SIZE)+1})`);
      inserted += chunk.length;
      continue;
    }
    try {
      await supabaseFetch('products?on_conflict=id', {
        method:  'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body:    JSON.stringify(chunk),
      });
      inserted += chunk.length;
      console.log(`   Batch ${Math.floor(i/CHUNK_SIZE)+1}: inserted ${chunk.length} products (total: ${inserted})`);
    } catch (err) {
      console.error(`   ❌ Batch failed: ${err.message}`);
      skipped += chunk.length;
    }
  }

  // 6. Summary
  console.log('\n================================');
  console.log('✅  Upload complete!');
  console.log(`   Products processed: ${products.length}`);
  console.log(`   Inserted/updated:   ${inserted}`);
  console.log(`   Failed:             ${skipped}`);
  if (DRY_RUN) console.log('\n   ℹ️  This was a dry run — no actual changes were made.');
  console.log('   Open admin to review: https://www.oncost.shop/admin-dashboard.html');
  console.log('================================\n');
}

main().catch(err => {
  console.error('❌  Fatal error:', err.message);
  process.exit(1);
});
