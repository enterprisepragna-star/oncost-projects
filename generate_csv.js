const fs = require('fs');
const data = JSON.parse(fs.readFileSync('catalog.json', 'utf8'));

let csv = 'id,name,price,category,description,image_url\n';
data.forEach(item => {
  const id = item.code.replace(/"/g, '""');
  const name = (item.name || 'NOTEBOOK').replace(/"/g, '""');
  const price = item.price || 1280;
  const desc = (item.desc || '').replace(/"/g, '""');
  const img = item.image.replace(/"/g, '""');
  
  csv += `"${id}","${name}",${price},"Catalog Notebooks","${desc}","${img}"\n`;
});

fs.writeFileSync('catalog_supabase.csv', csv);
console.log('Generated catalog_supabase.csv');
