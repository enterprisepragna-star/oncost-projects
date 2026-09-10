const initiateHandler = require('./ccavenue/_lib/initiate');
const responseHandler = require('./ccavenue/_lib/response');

module.exports = async function handler(req, res) {
  const action = req.query.action || '';
  if (action === 'initiate') return initiateHandler(req, res);
  if (action === 'response') return responseHandler(req, res);
  return res.status(404).json({ error: 'Action not found' });
};
