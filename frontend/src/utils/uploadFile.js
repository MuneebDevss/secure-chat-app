const fs = require('fs');
const axios = require('axios');

async function uploadEncryptedFile(secureClient, filePath) {
    // 1. Read File
    const fileBuffer = fs.readFileSync(filePath);

    // 2. Encrypt File Content (AES-256-GCM) [cite: 60]
    // Note: For large files, use Streams. For MVP/Report, Buffer is fine.
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', secureClient.sessionKey, iv);
    
    const encryptedBuffer = Buffer.concat([
        cipher.update(fileBuffer),
        cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    // 3. Pack Payload
    // We append IV and AuthTag to the file start so we can decrypt later
    // Format: [IV (12b)] [AuthTag (16b)] [EncryptedData]
    const finalPayload = Buffer.concat([iv, authTag, encryptedBuffer]);

    // 4. Upload
    const formData = new FormData();
    // In Node env, FormData requires headers. In browser, it's automatic.
    // Assuming browser-like environment for React:
    const blob = new Blob([finalPayload]); 
    formData.append('encryptedFile', blob, 'secret_doc.pdf.enc');

    await axios.post('https://localhost:443/api/files/upload', formData);
    console.log("Encrypted file uploaded.");
}

async function downloadAndDecryptFile(secureClient, fileId) {
    // 1. Download
    const response = await axios.get(`https://localhost:443/api/files/download/${fileId}`, {
        responseType: 'arraybuffer'
    });
    const rawData = Buffer.from(response.data);

    // 2. Extract IV, Tag, and Ciphertext
    const iv = rawData.slice(0, 12);
    const authTag = rawData.slice(12, 28);
    const ciphertext = rawData.slice(28);

    // 3. Decrypt
    const decipher = crypto.createDecipheriv('aes-256-gcm', secureClient.sessionKey, iv);
    decipher.setAuthTag(authTag);
    
    const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final()
    ]);

    // 4. Save/View
    fs.writeFileSync('decrypted_file_output.pdf', decrypted);
    console.log("File decrypted locally.");
}