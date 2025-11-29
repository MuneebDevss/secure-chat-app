const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// Storage config (Disk storage for MVP)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = './uploads';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Save with .enc extension to denote it's encrypted
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + '.enc');
  }
});

const upload = multer({ storage: storage });

// UPLOAD ENCRYPTED FILE
// [cite: 61] "Be stored on the server only in encrypted form"
router.post('/upload', upload.single('encryptedFile'), (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded.');
  
  // Log metadata only
  const logger = req.app.get('logger');
  if(logger) logger('FILE_UPLOAD', { filename: req.file.filename, size: req.file.size });

  res.json({ 
    message: "File uploaded successfully", 
    fileId: req.file.filename,
    path: req.file.path
  });
});

// DOWNLOAD FILE
router.get('/download/:fileId', (req, res) => {
  const filePath = path.join(__dirname, '../uploads', req.params.fileId);
  if (fs.existsSync(filePath)) {
    res.download(filePath); // Sends the encrypted binary
  } else {
    res.status(404).json({ error: "File not found" });
  }
});

module.exports = router;