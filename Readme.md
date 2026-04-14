# Secure End-to-End Encrypted Messaging System

## 1. Project Overview

This is a real-time, end-to-end encrypted (E2EE) messaging and file-sharing application built on a **Zero-Knowledge Architecture**. The server acts as a blind relay — it never sees plaintext data. All cryptographic operations (key generation, encryption, decryption, signing) are performed exclusively on the client side using the browser's native Web Crypto API.

Core functionality:

- **Authenticated key exchange** using ECDH with ECDSA digital signatures to prevent MITM attacks.
- **Symmetric message and file encryption** using AES-256-GCM with per-message random IVs.
- **Perfect Forward Secrecy** via ephemeral key pairs generated per chat session.
- **Secure file sharing** — files are encrypted client-side before upload; the server stores only encrypted blobs.
- **Real-time communication** over Socket.io with HTTPS transport.

The system follows a **client-server** architecture where the server is intentionally "dumb" — it stores ciphertext, relays signaling messages, and manages user authentication, but has no ability to read or decrypt user content.

---

## 2. Tech Stack

### Frontend

| Technology | Version | Purpose |
|---|---|---|
| React | 19.2.0 | UI framework |
| Socket.io Client | 4.8.1 | Real-time WebSocket communication |
| Axios | 1.7.5 | HTTP client for REST API calls |
| Tailwind CSS | 3.4.15 | Utility-first CSS framework |
| PostCSS | 8.4.38 | CSS processing pipeline |
| Autoprefixer | 10.4.20 | CSS vendor prefix automation |
| Web Crypto API (SubtleCrypto) | Browser-native | All cryptographic operations |
| IndexedDB | Browser-native | Client-side private key storage |

### Backend

| Technology | Version | Purpose |
|---|---|---|
| Node.js | — | Server runtime |
| Express | 5.1.0 | HTTP framework |
| Socket.io | 4.8.1 | WebSocket server for real-time signaling |
| Mongoose | 9.0.0 | MongoDB ODM |
| MongoDB | — | Document database for encrypted data |
| bcrypt | 6.0.0 | Password hashing (10 salt rounds) |
| Multer | 2.0.2 | Multipart file upload middleware |
| dotenv | 17.2.3 | Environment variable management |
| HTTPS (Node.js built-in) | — | TLS transport layer |

### Cryptographic Primitives

| Primitive | Specification | Usage |
|---|---|---|
| ECDSA | P-256 / SHA-256 | Digital signatures (identity verification) |
| ECDH | P-256 | Ephemeral key exchange |
| HKDF | SHA-256 | Session key derivation from ECDH shared secret |
| AES-256-GCM | 256-bit key, 12-byte IV, 128-bit auth tag | Symmetric encryption for messages and files |

---

## 3. Architecture

The system uses a **client-server architecture** with a Zero-Knowledge server model:

```
┌─────────────────────┐       HTTPS / WSS        ┌──────────────────────┐
│     Client A        │◄────────────────────────►│   Node.js Server     │
│  (React + WebCrypto)│                           │  (Express + Socket)  │
│                     │       HTTPS / WSS        │                      │
│  - Key generation   │◄──────────────────────   │  - Auth (bcrypt)     │
│  - Encryption       │                           │  - Public key store  │
│  - Decryption       │                           │  - Ciphertext store  │
│  - Signing          │                           │  - Signal relay      │
│  - IndexedDB store  │                           │  - File storage      │
└─────────────────────┘                           │  - Security logging  │
                                                  └──────────┬───────────┘
┌─────────────────────┐       HTTPS / WSS                    │
│     Client B        │◄─────────────────────────────────────┘
│  (React + WebCrypto)│
└─────────────────────┘
                                                  ┌──────────────────────┐
                                                  │     MongoDB          │
                                                  │  - Users (hashed pw, │
                                                  │    public keys)      │
                                                  │  - Messages (cipher- │
                                                  │    text, IV, meta)   │
                                                  │  - Files (metadata)  │
                                                  └──────────────────────┘
```

### Component Interaction

1. **Client ↔ Server (REST)**: User registration, login, public key retrieval, message storage/retrieval, file upload/download.
2. **Client ↔ Server (WebSocket)**: Real-time signaling for ECDH handshake, new-message notifications, new-file notifications, and user presence (online/offline).
3. **Client ↔ IndexedDB**: Private identity keys are stored in the browser's IndexedDB and never transmitted to the server.
4. **Server ↔ MongoDB**: Stores user credentials (hashed), public keys, encrypted messages, and file metadata.
5. **Server ↔ Disk**: Encrypted file blobs are stored on disk in an `uploads/` directory with `.enc` extension.

---

## 4. Core Systems / Features

### 4.1 Cryptographic Key Management

**Identity Keys (Long-term)**
- Generated once at user registration using `crypto.subtle.generateKey()` with ECDSA P-256.
- The private key is stored in IndexedDB (marked non-extractable where possible).
- The public key is exported to JWK format and sent to the server during registration.

**Ephemeral Keys (Per-session)**
- Generated at the start of each chat session using ECDH P-256.
- Used for a single key exchange, then discarded.
- Provides Perfect Forward Secrecy — compromise of identity keys does not reveal past session keys.

**Session Key Derivation**
- After ECDH exchange, both parties derive a shared secret.
- The shared secret is passed through HKDF with SHA-256 to produce a 256-bit AES key.
- This derived key is used for all AES-256-GCM encryption in that session.

Implementation: `frontend/src/utils/crypto.js`

### 4.2 Key Exchange Protocol (Three-Step Handshake)

The handshake runs over Socket.io signaling:

1. **INIT_HANDSHAKE (Alice → Server → Bob)**
   - Alice generates an ephemeral ECDH key pair.
   - Alice signs the ephemeral public key with her identity private key (ECDSA).
   - Sends `{ephemeralPublic, signature}` via Socket.io `signal` event.

2. **RESPONSE_HANDSHAKE (Bob → Server → Alice)**
   - Bob fetches Alice's identity public key from the server (`GET /api/auth/key/:username`).
   - Bob verifies the signature — if invalid, alerts "MITM ATTACK DETECTED" and aborts.
   - Bob generates his own ephemeral ECDH key pair, derives the session key via ECDH + HKDF.
   - Bob signs his ephemeral public key and sends back `{ephemeralPublic, signature}`.

3. **Finalization (Alice)**
   - Alice fetches Bob's identity public key and verifies the signature.
   - Alice derives the same session key via ECDH + HKDF.
   - Both sides now share an identical AES-256 session key.

A 7-second timeout is enforced on the handshake. If the peer does not respond, the connection attempt fails.

Implementation: `frontend/src/components/Chat.jsx`

### 4.3 Message Encryption / Decryption

- Each message is encrypted with AES-256-GCM using the session key.
- A fresh 12-byte random IV is generated per message via `crypto.getRandomValues()`.
- The ciphertext and IV (both Base64-encoded) are sent to the server via `POST /api/messages/send`.
- The server validates that no plaintext fields (`text`, `content`) are present before storing.
- On retrieval, the client decrypts using the session key, ciphertext, and IV.

Implementation: `encryptMessage()` / `decryptMessage()` in `frontend/src/utils/crypto.js`

### 4.4 Encrypted File Sharing

- The sender reads the file as an `ArrayBuffer`, generates a 12-byte IV, and encrypts with AES-256-GCM (128-bit tag length).
- The GCM authentication tag (last 16 bytes) is extracted and stored separately as metadata.
- The encrypted blob is uploaded via `POST /api/files/upload` using `multipart/form-data` (Multer).
- The server stores the encrypted file on disk (`uploads/{timestamp}-{random}.enc`) with a 50 MB size limit.
- File metadata (IV, auth tag, original filename, MIME type) is stored in MongoDB.
- The recipient downloads the encrypted file, reconstructs the ciphertext + auth tag, and decrypts client-side.

Implementation: `frontend/src/utils/uploadFile.js`, `server/routes/files.js`

### 4.5 User Authentication

- Registration: username, password, and public key (JWK). Password is hashed with bcrypt (10 salt rounds) before storage.
- Login: username + password verified against bcrypt hash. Server returns the user's public key on success.
- No session tokens or JWTs — authentication is password-based; the cryptographic identity is tied to the client-side key pair.

Implementation: `server/routes/auth.js`, `server/models/User.js`

### 4.6 Real-Time Communication (Socket.io)

- The server manages a `Map` of `username → socketId` for online user tracking.
- Events:
  - `join` — registers a user as online.
  - `signal` — relays handshake messages (`INIT_HANDSHAKE`, `RESPONSE_HANDSHAKE`, `END_SESSION`) between users.
  - `new-message` — notifies recipient of a new encrypted message.
  - `new-file` — notifies recipient of a new encrypted file.
  - `disconnect` — removes user from online map.

Implementation: `server/server.js`

### 4.7 Security Logging

- A custom `logEvent(type, details)` function appends entries to `server_security.log`.
- Logged events include: `AUTH_REGISTER`, `AUTH_LOGIN_SUCCESS`, `AUTH_LOGIN_FAIL`, `MSG_STORED`, `FILE_UPLOAD`, and connection/disconnection.
- Only metadata is logged — no plaintext content.

Implementation: `server/server.js` (logger), referenced across all route files.

---

## 5. Data Management

### MongoDB Collections

**Users**

| Field | Type | Description |
|---|---|---|
| `username` | String (unique, required) | User identifier |
| `password` | String (required) | bcrypt-hashed password |
| `publicKey` | String (required) | ECDSA identity public key in JWK format |
| `createdAt` | Date | Account creation timestamp |

**Messages**

| Field | Type | Description |
|---|---|---|
| `sender` | String (required) | Sender username |
| `recipient` | String (required) | Recipient username |
| `ciphertext` | String (required) | Base64-encoded AES-256-GCM ciphertext |
| `iv` | String (required) | Base64-encoded 12-byte IV |
| `metadata` | Object (optional) | Replay protection metadata (timestamps, sequence numbers) |
| `signature` | String (optional) | Digital signature |
| `timestamp` | Date | Message storage timestamp |

**Files**

| Field | Type | Description |
|---|---|---|
| `sender` | String (required) | Sender username |
| `recipient` | String (required) | Recipient username |
| `filename` | String (required) | Original filename |
| `encryptedFilename` | String (required) | Server-side storage name |
| `fileSize` | Number (required) | File size in bytes |
| `mimeType` | String (optional) | MIME type |
| `iv` | String (required) | Base64-encoded 12-byte IV |
| `authTag` | String (required) | Base64-encoded 128-bit GCM auth tag |
| `filePath` | String (required) | Server disk path |
| `timestamp` | Date | Upload timestamp |

### Client-Side Storage

- **IndexedDB** (`SecureChatDB`, object store `keys`): stores the user's ECDSA identity private key, keyed by username. Private keys never leave the browser.

### File Storage

- Encrypted files are stored on the server's disk in an `uploads/` directory.
- Filename format: `{timestamp}-{randomNumber}.enc`.
- Maximum file size: 50 MB (enforced by Multer).

### Limitations

- No message pagination — all messages between two users are fetched at once.
- No limit on total stored messages or files.
- Private keys are tied to a single browser instance (no cross-device sync).
- No key backup or recovery mechanism — if IndexedDB is cleared, the identity key is permanently lost.

---

## 6. Setup & Installation

### Prerequisites

- **Node.js** (v18+ recommended)
- **MongoDB** (local instance or MongoDB Atlas)
- **OpenSSL** (for generating self-signed TLS certificates)

### Step 1: Clone the Repository

```bash
git clone https://github.com/MuneebDevss/secure-chat-app.git
cd secure-chat-app
```

### Step 2: Set Up the Server

```bash
cd server
npm install
```

Generate self-signed TLS certificates (required for HTTPS):

```bash
openssl req -nodes -new -x509 -keyout server.key -out server.crt
```

Create a `.env` file (optional — defaults are provided):

```env
MONGO_URI=mongodb://localhost:27017/secure-chat
PORT=443
```

Start the server:

```bash
node server.js
```

The server starts on `https://localhost:443`.

### Step 3: Set Up the Frontend

```bash
cd frontend
npm install
npm start
```

The React development server starts on `http://localhost:3000` by default.

### Step 4: Use the Application

1. Open `https://localhost:443` in a browser (accept the self-signed certificate warning).
2. Register a user (this generates the ECDSA identity key pair and stores the private key in IndexedDB).
3. Open a second browser window (or incognito) and register a second user.
4. Start a chat — the ECDH handshake runs automatically when both users are online.

---

## 7. Build & Deployment

### Frontend Production Build

```bash
cd frontend
npm run build
```

This produces an optimized static build in `frontend/build/` using `react-scripts build`. The output can be served by any static file server or integrated into the Express server.

### Server Deployment

The server requires:

- A running MongoDB instance (configure via `MONGO_URI` in `.env`).
- Valid TLS certificates (`server.key` and `server.crt` in the `server/` directory). Replace self-signed certificates with CA-signed certificates for production.
- The `uploads/` directory must be writable for file storage.

To run in production:

```bash
cd server
NODE_ENV=production node server.js
```

### Tunnel-Based Deployment (Development/Demo)

For cross-network testing without deploying to a cloud provider:

1. Start the server on port 443.
2. Use a tunneling tool (e.g., ngrok): `ngrok http https://localhost:443`.
3. Share the generated public URL with other users.

---

## 8. Folder Structure

```
secure-chat-app/
├── server/                          # Backend (Node.js + Express)
│   ├── server.js                    # Entry point: HTTPS server, Socket.io, logging, routes
│   ├── package.json                 # Server dependencies
│   ├── server.crt                   # TLS certificate (self-signed)
│   ├── server.key                   # TLS private key (not committed)
│   ├── models/                      # Mongoose schemas
│   │   ├── User.js                  # User schema (username, hashed password, public key)
│   │   ├── Message.js               # Message schema (ciphertext, IV, metadata)
│   │   └── File.js                  # File metadata schema (IV, auth tag, path)
│   └── routes/                      # Express route handlers
│       ├── auth.js                  # Registration, login, public key retrieval
│       ├── messages.js              # Encrypted message storage and retrieval
│       └── files.js                 # Encrypted file upload, download, metadata, deletion
│
├── frontend/                        # Frontend (React)
│   ├── package.json                 # Frontend dependencies
│   ├── tailwind.config.js           # Tailwind CSS configuration with custom color theme
│   ├── postcss.config.js            # PostCSS pipeline (Tailwind + Autoprefixer)
│   ├── public/                      # Static assets (index.html, favicon)
│   └── src/
│       ├── App.js                   # Root component: view routing (login/register/chat)
│       ├── index.js                 # React entry point
│       ├── index.css                # Tailwind CSS imports
│       ├── components/
│       │   ├── Chat.jsx             # Main chat UI, ECDH handshake, message send/receive
│       │   ├── Login.jsx            # Login form, IndexedDB key validation
│       │   └── Register.jsx         # Registration, key generation, public key upload
│       └── utils/
│           ├── crypto.js            # All cryptographic functions (ECDSA, ECDH, AES-GCM, HKDF)
│           ├── db.js                # IndexedDB wrapper (private key storage)
│           └── uploadFile.js        # File encryption, upload, download, and decryption
│
├── COMPLIANCE_CHECKLIST.md          # Security requirements and compliance tracking
└── Readme.md                        # This file
```

---

## 9. Design Decisions

### Zero-Knowledge Server
The server is intentionally excluded from the trust model. It stores only ciphertext, IVs, and public keys. Even a fully compromised server cannot read messages. This simplifies server security requirements but places the burden of key management on the client.

### Web Crypto API Over Third-Party Libraries
All cryptographic operations use the browser-native `SubtleCrypto` API rather than libraries like `tweetnacl` or `libsodium.js`. This avoids supply-chain risks and leverages hardware-accelerated cryptography where available. The trade-off is that the API is lower-level and requires more boilerplate.

### ECDSA + ECDH Separation
Identity keys (ECDSA) are separated from key-exchange keys (ECDH). ECDSA keys are long-lived and used for signing; ECDH keys are ephemeral and used for deriving session keys. This enforces Perfect Forward Secrecy and limits the blast radius of a key compromise.

### IndexedDB for Private Key Storage
Private keys are stored in the browser's IndexedDB, which is sandboxed per origin. This means keys do not leave the device, but it also means there is no key backup, recovery, or cross-device sync. If the browser data is cleared, the identity key is permanently lost.

### AES-256-GCM with Per-Message IVs
GCM mode provides both confidentiality and integrity (authenticated encryption). A fresh 12-byte random IV per message prevents IV reuse. The 128-bit authentication tag detects any tampering with the ciphertext.

### Socket.io for Signaling
Socket.io is used for real-time handshake signaling and notifications rather than building a custom WebSocket protocol. This provides automatic reconnection, room management, and cross-browser compatibility. The signaling layer only relays encrypted handshake data — it does not carry plaintext.

### No Session Tokens / JWTs
The application does not issue session tokens after login. Authentication relies on password verification for API access and ECDSA signatures for cryptographic identity. This simplifies the server but means each sensitive operation requires re-authentication or relies on the client-side key.

### CORS Open in Development
CORS is set to `origin: "*"` for development convenience. This must be restricted to specific origins in production.

---

## 10. Future Improvements

- **Rate limiting**: Add `express-rate-limit` to protect API endpoints against brute-force and denial-of-service attacks.
- **JWT-based sessions**: Introduce token-based authentication to avoid re-sending credentials on every request and enable proper session management.
- **Message pagination**: Implement cursor-based pagination for message retrieval to handle large conversation histories efficiently.
- **Key backup and recovery**: Provide an encrypted key export/import mechanism so users can transfer their identity across devices.
- **Group chat support**: Extend the handshake protocol to support multi-party key exchange (e.g., sender keys or pairwise sessions).
- **Message deletion and expiry**: Allow users to delete messages and implement automatic expiry (TTL) on stored ciphertext.
- **Database indexing**: Add indexes on `sender`, `recipient`, and `timestamp` fields for query performance at scale.
- **Production TLS**: Replace self-signed certificates with CA-signed certificates and enforce HSTS.
- **Input validation and sanitization**: Add comprehensive request validation middleware (e.g., `express-validator`) to all API endpoints.
- **Replay attack enforcement**: Fully implement server-side timestamp and sequence number validation on incoming messages.
- **CORS hardening**: Restrict CORS to specific allowed origins in production configuration.
- **Containerization**: Add Docker and Docker Compose configuration for consistent development and deployment environments.
- **Automated testing**: Add unit tests for cryptographic functions and integration tests for the handshake protocol and API endpoints.
