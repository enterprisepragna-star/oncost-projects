const fs = require('fs');
const data = JSON.parse(fs.readFileSync('catalog.json', 'utf8'));

let csv = 'id,name,price,category,description,image_url,created_at\n';
const seen = new Set();

data.forEach(item => {
  let rawId = item.code.replace(/"/g, '""').replace(/[\r\n]+/g, ' ');
  // Handle duplicates
  let id = rawId;
  let counter = 2;
  while (seen.has(id)) {
    id = `${rawId}_${counter}`;
    counter++;
  }
  seen.add(id);

  const name = (item.name || 'NOTEBOOK').replace(/"/g, '""').replace(/[\r\n]+/g, ' ');
  const price = item.price || 1280;
  const desc = (item.desc || '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ');
  const img = item.image.replace(/"/g, '""').replace(/[\r\n]+/g, ' ');
  const created_at = new Date().toISOString();
  
  csv += `"${id}","${name}",${price},"Catalog Notebooks","${desc}","${img}","${created_at}"\n`;
});

fs.writeFileSync('catalog_supabase.csv', csv);
console.log('Generated deduplicated catalog_supabase.csv');
