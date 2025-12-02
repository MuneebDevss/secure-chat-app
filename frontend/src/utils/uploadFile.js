// Client-side file encryption utilities for browser environment
import axios from 'axios';
import { ab2str, str2ab } from './crypto';

/**
 * Encrypt a file using AES-256-GCM with the session key
 * @param {CryptoKey} sessionKey - The derived session key
 * @param {File} file - The file object to encrypt
 * @returns {Object} - Encrypted data with iv, authTag, and encrypted blob
 */
export const encryptFile = async (sessionKey, file) => {
  try {
    // Read file as ArrayBuffer
    const fileBuffer = await file.arrayBuffer();
    
    // Generate random IV (12 bytes for GCM)
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    
    // Encrypt the file content
    const encryptedData = await window.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv,
        tagLength: 128 // 16 bytes authentication tag
      },
      sessionKey,
      fileBuffer
    );
    
    // Split encrypted data and auth tag
    // In Web Crypto API, the auth tag is appended to the ciphertext
    const encryptedArray = new Uint8Array(encryptedData);
    const ciphertext = encryptedArray.slice(0, -16);
    const authTag = encryptedArray.slice(-16);
    
    return {
      ciphertext,
      iv,
      authTag,
      originalName: file.name,
      mimeType: file.type,
      size: file.size
    };
  } catch (error) {
    console.error('File encryption error:', error);
    throw new Error('Failed to encrypt file');
  }
};

/**
 * Upload encrypted file to server
 * @param {Object} encryptedFile - Encrypted file data
 * @param {string} sender - Sender username
 * @param {string} recipient - Recipient username
 * @returns {Object} - Upload response
 */
export const uploadEncryptedFile = async (encryptedFile, sender, recipient) => {
  try {
    const formData = new FormData();
    
    // Create a blob from the encrypted ciphertext
    const blob = new Blob([encryptedFile.ciphertext], { type: 'application/octet-stream' });
    formData.append('encryptedFile', blob, `${Date.now()}.enc`);
    
    // Add metadata
    formData.append('sender', sender);
    formData.append('recipient', recipient);
    formData.append('filename', encryptedFile.originalName);
    formData.append('iv', ab2str(encryptedFile.iv));
    formData.append('authTag', ab2str(encryptedFile.authTag));
    formData.append('mimeType', encryptedFile.mimeType || 'application/octet-stream');
    
    const response = await axios.post('https://localhost:443/api/files/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
    
    return response.data;
  } catch (error) {
    console.error('File upload error:', error);
    throw new Error('Failed to upload file');
  }
};

/**
 * Download and decrypt file from server
 * @param {CryptoKey} sessionKey - The derived session key
 * @param {string} fileId - The file ID to download
 * @returns {Object} - Decrypted file data
 */
export const downloadAndDecryptFile = async (sessionKey, fileId) => {
  try {
    // First, get file metadata
    const metadataResponse = await axios.get(`https://localhost:443/api/files/metadata/${fileId}`);
    const metadata = metadataResponse.data;
    
    // Then download encrypted file
    const fileResponse = await axios.get(`https://localhost:443/api/files/download/${fileId}`, {
      responseType: 'arraybuffer'
    });
    
    // Convert metadata from base64
    const iv = str2ab(metadata.iv);
    const authTag = str2ab(metadata.authTag);
    
    // Combine ciphertext and authTag for decryption
    const ciphertext = new Uint8Array(fileResponse.data);
    const encryptedData = new Uint8Array(ciphertext.length + authTag.byteLength);
    encryptedData.set(ciphertext, 0);
    encryptedData.set(new Uint8Array(authTag), ciphertext.length);
    
    // Decrypt the file
    const decryptedData = await window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: new Uint8Array(iv),
        tagLength: 128
      },
      sessionKey,
      encryptedData
    );
    
    return {
      data: decryptedData,
      filename: metadata.filename,
      mimeType: metadata.mimeType || 'application/octet-stream'
    };
  } catch (error) {
    console.error('File decryption error:', error);
    throw new Error('Failed to decrypt file');
  }
};

/**
 * Download decrypted file to user's computer
 * @param {ArrayBuffer} data - Decrypted file data
 * @param {string} filename - Original filename
 * @param {string} mimeType - MIME type
 */
export const downloadFile = (data, filename, mimeType) => {
  const blob = new Blob([data], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
};