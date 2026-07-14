const leadsHandler = require('./_lib/leads');
const recoverOrderHandler = require('./_lib/recover-order');

module.exports = async function handler(req, res) {
  const action = req.query.action || '';
  if (action === 'leads') return leadsHandler(req, res);
  if (action === 'recover-order') return recoverOrderHandler(req, res);
  return res.status(404).json({ error: 'Action not found' });
};
