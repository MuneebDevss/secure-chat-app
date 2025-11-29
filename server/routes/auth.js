    const express = require('express');
const bcrypt = require('bcrypt'); // [cite: 24]
const User = require('../models/User');
const router = express.Router();

// REGISTER
router.post('/register', async (req, res) => {
  const logger = req.app.get('logger');
  try { 
    const { username, password, publicKey } = req.body;

    // Check if user exists
    const existing = await User.findOne({ username });
    if (existing) return res.status(400).json({ error: "Username taken" });

    // Hash password [cite: 24]
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({
      username,
      password: hashedPassword,
      publicKey // Storing the RSA/ECC public key for others to find
    });

    await newUser.save();
    logger('AUTH_REGISTER', { username, status: 'SUCCESS' });
    res.status(201).json({ message: "User registered" });

  } catch (error) {
    logger('AUTH_ERROR', { error: error.message });
    res.status(500).json({ error: "Server error" });
  }
});

// LOGIN
router.post('/login', async (req, res) => {
  const logger = req.app.get('logger');
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });

    if (!user) {
      logger('AUTH_LOGIN_FAIL', { username });
      return res.status(400).json({ error: "Invalid credentials" });
    }

    const validPass = await bcrypt.compare(password, user.password);
    if (!validPass) {
      logger('AUTH_LOGIN_FAIL', { username });
      return res.status(400).json({ error: "Invalid credentials" });
    }

    logger('AUTH_LOGIN_SUCCESS', { username });
    // Return the user's own public key helps client verify storage integrity
    res.json({ message: "Logged in", publicKey: user.publicKey });

  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
});

// GET PUBLIC KEY (For Key Exchange)
router.get('/key/:username', async (req, res) => {
  const user = await User.findOne({ username: req.params.username });
  if (!user) return res.status(404).json({ error: "User not found" });
  
  // Respond with just the public key so the requester can start encryption
  res.json({ username: user.username, publicKey: user.publicKey });
});

module.exports = router;