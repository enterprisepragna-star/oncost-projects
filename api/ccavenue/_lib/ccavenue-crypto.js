// CCAvenue AES-128-CBC crypto helpers.
// Algorithm spec from CCAvenue's official Node.js integration kit.
const crypto = require('crypto');

const IV = Buffer.from([
  0x00,0x01,0x02,0x03,0x04,0x05,0x06,0x07,
  0x08,0x09,0x0a,0x0b,0x0c,0x0d,0x0e,0x0f,
]);

function workingKeyToBuffer(workingKey) {
  // CCAvenue: MD5 hash of working key, used as AES-128 key (16 bytes)
  return crypto.createHash('md5').update(workingKey).digest();
}

function encrypt(plaintext, workingKey) {
  const key = workingKeyToBuffer(workingKey);
  const cipher = crypto.createCipheriv('aes-128-cbc', key, IV);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

function decrypt(ciphertextHex, workingKey) {
  const key = workingKeyToBuffer(workingKey);
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, IV);
  let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Parse CCAvenue's URL-encoded response string into an object
function parseResponse(plaintext) {
  const out = {};
  plaintext.split('&').forEach(part => {
    const idx = part.indexOf('=');
    if (idx > -1) out[part.slice(0, idx)] = decodeURIComponent(part.slice(idx + 1));
  });
  return out;
}

// Build CCAvenue's "merchant_param" string (key=value&key=value, URL-encoded values)
function buildMerchantData(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
}

module.exports = { encrypt, decrypt, parseResponse, buildMerchantData };
