const fs = require('fs');
let css = fs.readFileSync('admin.css', 'utf8');

const regex = /@media\s*\(max-width:\s*900px\)[\s\S]*$/;
const newMedia = `
@media (max-width: 900px) {
  .admin-login-shell { grid-template-columns: 1fr; }
  .admin-login-visual { padding: 32px; min-height: 220px; }
  .admin-login-visual h2 { font-size: 26px; }
}

.menu-btn { display: none; background: none; border: 1px solid var(--admin-border); padding: 8px 10px; border-radius: 6px; cursor: pointer; color: var(--admin-ink); }

@media (max-width: 800px) {
  .admin-sidebar { transform: translateX(-100%); transition: transform .2s; }
  .admin-sidebar.open { transform: none; box-shadow: 4px 0 24px rgba(0,0,0,0.2); }
  .admin-main { margin-left: 0; min-width: 0; width: 100vw; overflow-x: hidden; }
  .menu-btn { display: inline-flex !important; }
  
  .admin-topbar { padding: 0 16px; gap: 10px; }
  .admin-topbar .crumb { font-size: 15px; }
  .admin-content { padding: 16px 12px 60px; }
  
  .grid-2, .grid-3 { grid-template-columns: 1fr; }
  .grid-4 { grid-template-columns: 1fr 1fr; }
  
  /* Make cards scrollable horizontally to handle tables */
  .card { overflow-x: auto; padding: 16px; }
  table.data { white-space: nowrap; }
  
  /* Fix headers */
  .card-head { flex-direction: column; align-items: flex-start; gap: 12px; }
  .card-head > div, .card-head .actions { width: 100%; display: flex; flex-wrap: wrap; gap: 8px; }
  .card-head input.input, .card-head select.select { width: 100% !important; max-width: none !important; }
  
  /* Scrollable tabs */
  .admin-tabs { flex-wrap: nowrap; overflow-x: auto; white-space: nowrap; padding-bottom: 2px; }
  .admin-tabs::-webkit-scrollbar { height: 4px; }
  
  /* Modals */
  .modal { margin: 16px; width: calc(100vw - 32px) !important; max-width: none !important; max-height: calc(100vh - 32px); overflow-y: auto; }
  .modal-body { padding: 16px; }
  .modal-foot { padding: 16px; flex-direction: column; }
  .modal-foot .btn { width: 100%; }
  
  /* Form grids */
  .form-grid { grid-template-columns: 1fr !important; }
}

@media (max-width: 480px) {
  .grid-4 { grid-template-columns: 1fr; }
  .admin-topbar .btn { padding: 6px 10px; font-size: 11px; }
  .stat-val { font-size: 24px; }
  .admin-login-visual { min-height: 160px; }
}
`;

css = css.replace(regex, newMedia.trim());
fs.writeFileSync('admin.css', css);
