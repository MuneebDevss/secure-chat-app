const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const File = require('../models/File');
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

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// UPLOAD ENCRYPTED FILE
// [cite: 61] "Be stored on the server only in encrypted form"
router.post('/upload', upload.single('encryptedFile'), async (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded.');
  
  try {
    const { sender, recipient, filename, iv, authTag, mimeType } = req.body;
    
    // Validate required fields
    if (!sender || !recipient || !filename || !iv || !authTag) {
      fs.unlinkSync(req.file.path); // Clean up uploaded file
      return res.status(400).json({ error: 'Missing required metadata' });
    }
    
    // Store file metadata in database
    const fileRecord = new File({
      sender,
      recipient,
      filename, // Original filename (also encrypted client-side)
      encryptedFilename: req.file.filename,
      fileSize: req.file.size,
      mimeType,
      iv,
      authTag,
      filePath: req.file.path
    });
    
    await fileRecord.save();
    
    // Log metadata only
    const logger = req.app.get('logger');
    if(logger) logger('FILE_UPLOAD', { 
      sender, 
      recipient, 
      fileId: fileRecord._id, 
      size: req.file.size 
    });

    // Notify recipient via socket
    const io = req.app.get('io');
    if (io) {
      console.log('Emitting new-file event to:', recipient);
      io.to(recipient).emit('new-file', {
        from: sender,
        fileId: fileRecord._id,
        filename,
        size: req.file.size
      });
      console.log('File notification sent:', { from: sender, to: recipient, fileId: fileRecord._id });
    } else {
      console.log('Socket.io not available!');
    }

    res.json({ 
      message: "File uploaded successfully", 
      fileId: fileRecord._id,
      filename: req.file.filename
    });
  } catch (error) {
    console.error('File upload error:', error);
    if (req.file && req.file.path) {
      fs.unlinkSync(req.file.path); // Clean up on error
    }
    res.status(500).json({ error: "Error uploading file" });
  }
});

// GET FILES FOR USER
router.get('/list/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const files = await File.find({
      $or: [{ sender: username }, { recipient: username }]
    }).sort({ timestamp: -1 });
    
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: "Error fetching files" });
  }
});

// GET FILE METADATA
router.get('/metadata/:fileId', async (req, res) => {
  try {
    const fileRecord = await File.findById(req.params.fileId);
    
    if (!fileRecord) {
      return res.status(404).json({ error: "File not found" });
    }
    
    res.json({
      filename: fileRecord.filename,
      iv: fileRecord.iv,
      authTag: fileRecord.authTag,
      mimeType: fileRecord.mimeType,
      sender: fileRecord.sender,
      recipient: fileRecord.recipient,
      fileSize: fileRecord.fileSize
    });
  } catch (error) {
    console.error('Metadata fetch error:', error);
    res.status(500).json({ error: "Error fetching metadata" });
  }
});

// DOWNLOAD FILE
router.get('/download/:fileId', async (req, res) => {
  try {
    const fileRecord = await File.findById(req.params.fileId);
    
    if (!fileRecord) {
      return res.status(404).json({ error: "File not found in database" });
    }
    
    const filePath = fileRecord.filePath;
    
    if (fs.existsSync(filePath)) {
      // Send the encrypted file as binary
      res.sendFile(path.resolve(filePath));
    } else {
      res.status(404).json({ error: "File not found on disk" });
    }
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: "Error downloading file" });
  }
});

// DELETE FILE (Optional - for cleanup)
router.delete('/:fileId', async (req, res) => {
  try {
    const fileRecord = await File.findById(req.params.fileId);
    
    if (!fileRecord) {
      return res.status(404).json({ error: "File not found" });
    }
    
    // Delete from disk
    if (fs.existsSync(fileRecord.filePath)) {
      fs.unlinkSync(fileRecord.filePath);
    }
    
    // Delete from database
    await File.findByIdAndDelete(req.params.fileId);
    
    res.json({ message: "File deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Error deleting file" });
  }
});

module.exports = router;