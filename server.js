const express = require('express');
const path = require('path');
const enquiriesHandler = require('./api/enquiries');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Handle API endpoints
app.all('/api/enquiries', (req, res) => enquiriesHandler(req, res));
app.all('/api/enquiries/:action', (req, res) => {
  req.query = req.query || {};
  req.query.action = req.params.action;
  return enquiriesHandler(req, res);
});

// Serve static frontend files
app.use(express.static(path.join(__dirname)));

// Fallback route to index.html for undefined HTML pages
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`ONCOST Server running on http://localhost:${PORT}`);
});
