const { Router } = require('express');
const { createChatController } = require('../controllers/chat.controller');

function createChatRouter(dependencies) {
  const router = Router();
  router.post('/', createChatController(dependencies));
  return router;
}

module.exports = { createChatRouter };
