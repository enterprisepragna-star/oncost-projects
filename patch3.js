const fs = require('fs');
let css = fs.readFileSync('admin.css', 'utf8');
css = css.replace('.card, .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }\\n  .card { padding: 16px; }', 
`.card, .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .card { padding: 16px; }
  .page-head { flex-direction: column; align-items: flex-start; gap: 12px; }
  .page-head > div, .page-head > button { width: 100%; display: flex; flex-wrap: wrap; }`
);
fs.writeFileSync('admin.css', css);
