const mongoose = require('mongoose');

const FileSchema = new mongoose.Schema({
  sender: { type: String, required: true },
  recipient: { type: String, required: true },
  filename: { type: String, required: true }, // Original filename (encrypted)
  encryptedFilename: { type: String, required: true }, // Server-side storage filename
  fileSize: { type: Number, required: true },
  mimeType: { type: String },
  iv: { type: String, required: true }, // IV for file encryption
  authTag: { type: String, required: true }, // GCM authentication tag
  filePath: { type: String, required: true }, // Server storage path
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('File', FileSchema);
