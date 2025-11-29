# Secure End-to-End Encrypted Messaging System

**Semester Project | Information Security**

## 📌 Project Overview

This project is a secure messaging and file-sharing application designed to ensure that the server never sees plaintext data ("Zero Knowledge Architecture"). It implements:

- **Hybrid Cryptography**: ECDH (Key Exchange) + AES-256-GCM (Message Encryption)
- **Identity Security**: ECDSA Digital Signatures to prevent Man-in-the-Middle (MITM) attacks
- **Secure Storage**: IndexedDB for private keys (Client) and Encrypted Blobs (Server)

## 🚀 Current Implementation Status (MVP)

### 1. Backend (/server)
- **Stack**: Node.js, Express, Socket.io, MongoDB
- **Functionality**: Acts as a blind relay. Stores encrypted messages and public keys
- **Security**: HTTPS enforced (Self-signed), Centralized Security Logging (server_security.log)

### 2. Frontend (/frontend)
- **Stack**: React.js
- **Cryptography**: Uses native Web Crypto API (SubtleCrypto)
- **Key Management**: Generates Identity Keys (long-term) and Ephemeral Keys (per session). Stores Private Identity Key in IndexedDB (non-extractable)

## ⚠️ CRITICAL NEXT STEPS (For Final Submission)

To get full marks, you must not just "run" the app, but break it and analyze it. Follow these instructions.

### 🛑 Task 1: MITM Attack Demonstration (15 Marks)

You need to prove that your Digital Signatures actually work. You must demonstrate two scenarios in your video/report.

#### How to do this (Rookie Friendly Guide):

**Step A: Create an "Attacker Script" (The Proxy)**
- Create a file `attacker_proxy.js`
- It listens on port 8080
- It forwards all traffic to your real server (port 443)
- The Attack: When it sees a JSON packet containing `ephemeralPublic` (the key exchange), it swaps that key with its own public key

**Step B: The "Vulnerable" Demo (Scenario 1)**
1. Go to your React code (`src/utils/crypto.js`)
2. Comment out the line that checks `verifySignature(...)`
3. Run the app through the Proxy
4. **Result**: The chat works! But the attacker (Proxy) can decrypt the messages
5. Screenshot this for the report as "Successful MITM on Unsecured Protocol"

**Step C: The "Secure" Demo (Scenario 2)**
1. Uncomment the `verifySignature(...)` line in React
2. Run the app through the Proxy again
3. **Result**: The chat fails. The client alerts: "MITM ATTACK DETECTED! Signature invalid."
4. Screenshot the alert and the console error for the report

### 📝 Task 2: Logging & Security Auditing (5 Marks)

The server already has basic logging (server_security.log). Ensure the following are captured:

- **Authentication**: Log every time `/api/auth/login` is hit
- **Key Exchange**: Log every `socket.emit('signal')` event on the server
- **Replay Attacks**: In `server/routes/messages.js`, check `metadata.timestamp` or `sequenceNumber`. If a message arrives with an old timestamp, reject it and log: `[SECURITY_ALERT] Replay Attack Detected from IP: ...`
- **Invalid Signatures**: In `Chat.jsx`, inside the catch block or `if (!isValid)`, send a fire-and-forget request: `axios.post('/api/log-security-event', { type: 'INVALID_SIGNATURE', user: ... })`

### 🛡️ Task 3: Threat Modeling (STRIDE) (10 Marks)

Write this section in your PDF. Map your architecture to STRIDE:

| Threat | Definition | Vulnerable Component | Your Countermeasure |
|--------|-----------|----------------------|-------------------|
| **Spoofing** | Pretending to be someone else | Login / Key Exchange | Digital Signatures (ECDSA). Bob verifies the key truly came from Alice |
| **Tampering** | Modifying data in transit | Message Payload | AES-GCM Auth Tag. If ciphertext is 1 bit different, decryption throws an error |
| **Repudiation** | Denying an action took place | Sending a message | Server Logs + Signatures. The database proves Alice signed the message |
| **Info Disclosure** | Leaking confidential data | Database / Network | E2EE (AES-256). Even if DB is leaked, it's gibberish. TLS (HTTPS) protects network |
| **Denial of Service** | Crashing the system | Server API | Rate Limiting (use `express-rate-limit` npm package) |
| **Elevation of Priv** | Gaining admin rights | Server Admin | No Admin Role. Architecture is peer-to-peer; server is "dumb" |

### 📐 Task 4: System Architecture & Diagrams (Documentation)

Use Draw.io or Lucidchart to create these 4 diagrams:

1. **High-Level Architecture**: Show Client A, Client B, and Node.js Server. Draw a "Safe Zone" around Clients and an "Unsafe Zone" around Server
2. **Key Exchange Protocol Flow**: Sequence Diagram with Alice -> Server -> Bob. Label arrows with math: `Alice sends (EphemKey_A + Sig_A)`
3. **Encrypted File Sharing Flow**: User Selects File -> AES Encrypt -> Upload Encrypted Blob -> Server Stores
4. **Database Schema**: Visual representation of MongoDB collections (User, Message)

## ☁️ Deployment Guide

### Option A: The "Localhost" Demo (Easiest)
- Run Server: `node server.js` (starts on https://localhost:443)
- Open Browser 1: https://localhost:443 (Log in as Alice)
- Open Incognito Window: https://localhost:443 (Log in as Bob)
- Explain in Video: "We are simulating two distinct clients on the same network"

### Option B: The "Ngrok" Tunnel (Best for Impressions)
1. Download Ngrok
2. Run your server on port 443
3. Run: `ngrok http https://localhost:443`
4. Ngrok gives you a public URL (e.g., https://random-name.ngrok.io)
5. Send that link to your group partner
6. Video Demo: Show yourself chatting while partner chats from their phone

## 🛠️ Setup Instructions

### Server Setup:
```bash
cd server
npm install
# Generate Certs
openssl req -nodes -new -x509 -keyout server.key -out server.cert
node server.js
```

### Client Setup:
```bash
cd frontend
npm install
npm start
```

### Database
Ensure MongoDB is running locally or use MongoDB Atlas connection string in `.env`