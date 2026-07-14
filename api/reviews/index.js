const requestHandler = require('./_lib/request');
const submitHandler = require('./_lib/submit');

module.exports = async function handler(req, res) {
  const action = req.query.action || '';
  if (action === 'request') return requestHandler(req, res);
  if (action === 'submit') return submitHandler(req, res);
  return res.status(404).json({ error: 'Action not found' });
};
