const express = require('express');
const Message = require('../models/Message');
const router = express.Router();
const fileRoutes = require('./files');

router.use('/api/files', fileRoutes);

// SEND MESSAGE
router.post('/send', async (req, res) => {
  const logger = req.app.get('logger');
  try {
    // Validate that NO plaintext exists in body
    if (req.body.text || req.body.content) {
      logger('SECURITY_ALERT', { msg: "Plaintext detected, rejecting" });
      return res.status(400).json({ error: "Plaintext not allowed" });
    }

    const { sender, recipient, ciphertext, iv, signature, metadata } = req.body;

    const newMessage = new Message({
      sender,
      recipient,
      ciphertext, // [cite: 51]
      iv,         // [cite: 53]
      signature,
      metadata
    });

    await newMessage.save();
    logger('MSG_STORED', { sender, recipient, iv }); // Log metadata only [cite: 54]
    
    res.status(201).json({ message: "Message encrypted and stored" });
  } catch (error) {
    logger('MSG_ERROR', { error: error.message });
    res.status(500).json({ error: "Error storing message" });
  }
});

// GET MESSAGES
router.get('/:username', async (req, res) => {
  try {
    const { username } = req.params;
    // Fetch messages where the user is either sender or recipient
    const messages = await Message.find({
      $or: [{ sender: username }, { recipient: username }]
    }).sort({ timestamp: 1 });

    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: "Error fetching messages" });
  }
});

module.exports = router;