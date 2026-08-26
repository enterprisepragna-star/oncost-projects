const fs = require('fs');
let css = fs.readFileSync('admin.css', 'utf8');

// Replace the line `.card { overflow-x: auto; padding: 16px; }` with `.card, .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; } .card { padding: 16px; }`
css = css.replace('.card { overflow-x: auto; padding: 16px; }', '.card, .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }\\n  .card { padding: 16px; }');

// Add global overflow hidden to html, body for mobile
css = css.replace('@media (max-width: 800px) {', '@media (max-width: 800px) {\\n  html, body { overflow-x: hidden; width: 100%; position: relative; }');

fs.writeFileSync('admin.css', css);
