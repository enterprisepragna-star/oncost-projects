const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const EXCEL_FILE_PATH = path.resolve(process.cwd(), 'enquiries.xlsx');
const VALID_ENQUIRY_TYPES = ['Personal Gifting', 'Bulk Orders', 'Corporate Gifting'];

// Simple mutex queue to safely handle concurrent writes
let fileLock = Promise.resolve();

function lock(fn) {
  const result = fileLock.then(fn, fn);
  fileLock = result.catch(() => {});
  return result;
}

// Helper to format Date & Time as DD-MM-YYYY HH:mm:ss in IST or local timezone
function formatDateTime(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());
  return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`;
}

// Indian Phone Number Validation: accepts 9876543210, +919876543210, +91 9876543210, 91 9876543210
function isValidIndianPhone(phone) {
  if (!phone || typeof phone !== 'string') return false;
  const cleanPhone = phone.trim().replace(/[\s-]/g, '');
  return /^(?:\+?91)?[6-9]\d{9}$/.test(cleanPhone);
}

// Basic Email Validation
function isValidEmail(email) {
  if (!email) return true; // Optional field
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

async function getOrCreateWorkbook() {
  const workbook = new ExcelJS.Workbook();
  if (fs.existsSync(EXCEL_FILE_PATH)) {
    await workbook.xlsx.readFile(EXCEL_FILE_PATH);
  } else {
    const worksheet = workbook.addWorksheet('Enquiries');
    worksheet.columns = [
      { header: 'Enquiry ID', key: 'enquiry_id', width: 15 },
      { header: 'Date & Time', key: 'datetime', width: 22 },
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Phone Number', key: 'phone', width: 18 },
      { header: 'Email', key: 'email', width: 25 },
      { header: 'Address', key: 'address', width: 35 },
      { header: 'Enquiry Type', key: 'enquiry_type', width: 35 }
    ];
    // Style headers
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    await workbook.xlsx.writeFile(EXCEL_FILE_PATH);
  }
  return workbook;
}

function sendJson(res, statusCode, obj) {
  if (res.headersSent) return;
  res.statusCode = statusCode;
  if (typeof res.status === 'function') res.status(statusCode);
  res.setHeader('Content-Type', 'application/json');
  if (typeof res.json === 'function') {
    return res.json(obj);
  }
  return res.end(JSON.stringify(obj));
}

async function parseBody(req) {
  if (req.body) {
    if (typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string') {
      try { return JSON.parse(req.body); } catch (e) { return {}; }
    }
  }
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

async function handlePost(req, res) {
  let body = await parseBody(req);
  body = body || {};

  const name = String(body.name || '').trim();
  const phone = String(body.phone || '').trim();
  const email = String(body.email || '').trim();
  const address = String(body.address || '').trim();
  let enquiryTypes = body.enquiry_type || body.enquiry_types || [];

  if (typeof enquiryTypes === 'string') {
    enquiryTypes = enquiryTypes.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (!Array.isArray(enquiryTypes)) {
    enquiryTypes = [];
  }

  // Filter & validate enquiry types against allowed values, fallback to 'Bulk Orders' if empty
  let selectedTypes = enquiryTypes.filter(type => VALID_ENQUIRY_TYPES.includes(type));
  if (selectedTypes.length === 0) {
    if (enquiryTypes.length > 0) {
      selectedTypes = [enquiryTypes.join(', ')];
    } else {
      selectedTypes = ['Bulk Orders'];
    }
  }

  // Validation Rules
  if (!name) {
    return sendJson(res, 400, { success: false, message: 'Please enter your name.' });
  }

  if (!phone) {
    return sendJson(res, 400, { success: false, message: 'Please enter your phone number.' });
  }

  if (!isValidIndianPhone(phone)) {
    return sendJson(res, 400, { success: false, message: 'Please enter a valid Indian phone number (e.g. 9876543210 or +91 9876543210).' });
  }

  if (email && !isValidEmail(email)) {
    return sendJson(res, 400, { success: false, message: 'Please enter a valid email address.' });
  }

  // Perform excel write within lock
  try {
    const result = await lock(async () => {
      const workbook = await getOrCreateWorkbook();
      const worksheet = workbook.getWorksheet('Enquiries') || workbook.worksheets[0];

      // Generate Unique Enquiry ID by inspecting existing rows
      let maxId = 0;
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // Skip header
        const cell = row.getCell(1);
        let cellVal = cell.value;
        if (cellVal && typeof cellVal === 'object') {
          cellVal = cellVal.text || cellVal.result || String(cellVal);
        }
        const cellStr = String(cellVal || '');
        const match = cellStr.match(/ENQ(\d+)/i);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxId) maxId = num;
        }
      });

      const nextNum = maxId + 1;
      const enquiryId = 'ENQ' + String(nextNum).padStart(4, '0');
      const dateTimeStr = formatDateTime();
      const enquiryTypeStr = selectedTypes.join(', ');

      worksheet.addRow([
        enquiryId,
        dateTimeStr,
        name,
        phone,
        email || '',
        address || '',
        enquiryTypeStr
      ]);

      let SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
      if (!SUPABASE_URL.startsWith('http') || SUPABASE_URL.startsWith('sb_')) {
        SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jyvmmypalshebqmnrdma.supabase.co';
      }
      const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

      if (SUPABASE_URL && SERVICE_KEY) {
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
            method: 'POST',
            headers: {
              apikey: SERVICE_KEY,
              Authorization: `Bearer ${SERVICE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
              summary: `Name: ${name} | Email: ${email || ''} | Phone: ${phone} | Event: ${enquiryTypeStr} | Message: ${address || ''}`,
              status: 'New'
            })
          });
        } catch (dbErr) {
          console.error('Error saving lead to Supabase DB:', dbErr.message);
        }
      }

      const writeWithRetry = async (retries = 5, delay = 500) => {
        for (let i = 0; i < retries; i++) {
          try {
            await workbook.xlsx.writeFile(EXCEL_FILE_PATH);
            return;
          } catch (wErr) {
            if ((wErr.code === 'EBUSY' || wErr.code === 'EACCES') && i < retries - 1) {
              await new Promise(r => setTimeout(r, delay));
            } else {
              throw wErr;
            }
          }
        }
      };

      await writeWithRetry();

      return {
        enquiry_id: enquiryId,
        datetime: dateTimeStr
      };
    });

    return sendJson(res, 200, {
      success: true,
      message: 'Your enquiry has been submitted successfully.',
      enquiry_id: result.enquiry_id
    });
  } catch (err) {
    console.error('Error saving enquiry to Excel:', err);
    return sendJson(res, 500, {
      success: false,
      message: 'Server error while saving enquiry. Please try again.'
    });
  }
}

async function handleDownload(req, res) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Enquiries');
  worksheet.columns = [
    { header: 'Enquiry ID', key: 'enquiry_id', width: 15 },
    { header: 'Date & Time', key: 'datetime', width: 22 },
    { header: 'Name', key: 'name', width: 25 },
    { header: 'Phone Number', key: 'phone', width: 18 },
    { header: 'Email', key: 'email', width: 25 },
    { header: 'Address', key: 'address', width: 35 },
    { header: 'Enquiry Type', key: 'enquiry_type', width: 35 }
  ];
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true };

  let SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
  if (!SUPABASE_URL.startsWith('http') || SUPABASE_URL.startsWith('sb_')) {
    SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jyvmmypalshebqmnrdma.supabase.co';
  }
  const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  let leads = [];
  if (SUPABASE_URL && SERVICE_KEY) {
    try {
      const lRes = await fetch(`${SUPABASE_URL}/rest/v1/leads?select=*&order=created_at.asc`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
      });
      if (lRes.ok) {
        leads = await lRes.json();
      }
    } catch (e) {
      console.error('Failed to fetch leads for excel download:', e.message);
    }
  }

  if (Array.isArray(leads) && leads.length > 0) {
    leads.forEach((l, idx) => {
      const enquiryId = 'ENQ' + String(idx + 1).padStart(4, '0');
      const d = parseSummary(l.summary || '');
      const dtStr = l.created_at ? formatDateTime(new Date(l.created_at)) : formatDateTime();
      worksheet.addRow([
        enquiryId,
        dtStr,
        d.Name || d.name || 'Customer',
        d.Phone || d.phone || '',
        d.Email || d.email || '',
        d.Message || d.message || d.summary || '',
        d.Event || d.event || 'Bulk Orders'
      ]);
    });
  } else if (fs.existsSync(EXCEL_FILE_PATH)) {
    try {
      const fileStream = fs.createReadStream(EXCEL_FILE_PATH);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="enquiries.xlsx"');
      return fileStream.pipe(res);
    } catch (e) {}
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="enquiries.xlsx"');
  const buffer = await workbook.xlsx.writeBuffer();
  return res.send ? res.send(Buffer.from(buffer)) : res.end(Buffer.from(buffer));
}

function parseSummary(summary) {
  if (!summary) return {};
  if (summary.trim().startsWith('{')) {
    try { return JSON.parse(summary); } catch (e) {}
  }
  const out = {};
  summary.split('|').forEach(part => {
    const m = part.match(/^\s*([^:]+):\s*(.*)$/);
    if (m) out[m[1].trim()] = m[2].trim();
  });
  return out;
}

module.exports = async function handler(req, res) {
  // CORS & Content-Type headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const url = req.url || '';
  const action = req.query?.action || (url.includes('download') ? 'download' : '');

  if (req.method === 'GET' || action === 'download') {
    return handleDownload(req, res);
  }

  if (req.method === 'POST') {
    return handlePost(req, res);
  }

  return sendJson(res, 405, { success: false, message: 'Method not allowed' });
};
