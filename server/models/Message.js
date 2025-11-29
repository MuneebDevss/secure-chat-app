const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  sender: { type: String, required: true },
  recipient: { type: String, required: true },
  ciphertext: { type: String, required: true }, // Base64 encoded encrypted string
  iv: { type: String, required: true },         // Base64 encoded Initialization Vector
  metadata: { type: Object },                   // Optional: Sequence numbers, timestamps for replay protection
  signature: { type: String },                  // Digital signature for integrity
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Message', MessageSchema);