// removed dotenv
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function seed() {
  const data = JSON.parse(fs.readFileSync('catalog.json', 'utf8'));
  
  const products = data.map(item => ({
    id: item.code,
    name: item.name || 'NOTEBOOK',
    price: item.price || 1280,
    category: 'Catalog',
    description: item.desc || '',
    image_url: item.image
  }));

  console.log(`Inserting ${products.length} products to Supabase...`);
  
  const { data: result, error } = await supabase
    .from('products')
    .upsert(products, { onConflict: 'id' });
    
  if (error) {
    console.error('Error inserting:', error);
  } else {
    console.log('Successfully inserted into Supabase!');
  }
}

seed();
