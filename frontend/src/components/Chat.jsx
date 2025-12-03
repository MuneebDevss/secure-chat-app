import React, { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import { getPrivateKey } from '../utils/db';
import { 
  generateEphemeralKeyPair, exportKeyToRaw, signData, 
  verifySignature, deriveSessionKey, encryptMessage, decryptMessage
} from '../utils/crypto';
import { 
  encryptFile, uploadEncryptedFile, downloadAndDecryptFile, downloadFile 
} from '../utils/uploadFile';

const socket = io('https://localhost:443');

const Chat = ({ username, onLogout }) => {
  const [targetUser, setTargetUser] = useState('');
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [status, setStatus] = useState('idle');
  const [uploadProgress, setUploadProgress] = useState(null);
  
  // SECURE STATE
  const identityPrivateKey = useRef(null);
  const sessionKey = useRef(null); 
  const ephemeralKeyPair = useRef(null);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  
  const handshakeTimeoutRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // --- FETCH MESSAGES ---
  const fetchMessages = useCallback(async (otherUser) => {
    if (!sessionKey.current) return;
    
    try {
      const res = await axios.get(`https://localhost:443/api/messages/${username}`);
      const allMessages = res.data;
      
      // Filter messages between current user and target user
      const relevantMessages = allMessages.filter(
        m => (m.sender === username && m.recipient === otherUser) ||
             (m.sender === otherUser && m.recipient === username)
      );
      
      // Decrypt messages
      const decryptedMessages = [];
      for (const msg of relevantMessages) {
        try {
          const plaintext = await decryptMessage(sessionKey.current, msg.ciphertext, msg.iv);
          decryptedMessages.push({
            from: msg.sender,
            text: plaintext,
            timestamp: msg.timestamp
          });
        } catch (error) {
          console.error('Failed to decrypt message:', error);
          // Add the message anyway but mark it as undecryptable
          decryptedMessages.push({
            from: msg.sender,
            text: '[🔒 Message from previous session - requires new handshake]',
            timestamp: msg.timestamp
          });
        }
      }
      
      setMessages(decryptedMessages);
    } catch (error) {
      console.error('Failed to fetch messages:', error);
    }
  }, [username]);

  // --- STEP 2: RESPOND TO HANDSHAKE (BOB) ---
  const handleIncomingHandshake = useCallback(async (data) => {
    setStatus('handshaking');
    const { ephemeralPublic, signature } = data.payload;

    try {
      // 1. Fetch Alice's Identity Key from Server (To verify signature)
      const res = await axios.get(`https://localhost:443/api/auth/key/${data.from}`);
      const aliceIdentityKeyJWK = JSON.parse(res.data.publicKey);
      const aliceIdentityKey = await window.crypto.subtle.importKey(
          "jwk", aliceIdentityKeyJWK, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]
      );

      // 2. Verify Signature
      const isValid = await verifySignature(aliceIdentityKey, signature, String(ephemeralPublic));
      if (!isValid) {
          alert('⚠️ MITM ATTACK DETECTED! Signature invalid.');
          setStatus('error');
          return;
      }

      // 3. Generate Bob's Ephemeral Keys
      ephemeralKeyPair.current = await generateEphemeralKeyPair();
      const myEphemeralPublicRaw = await exportKeyToRaw(ephemeralKeyPair.current.publicKey);

      // 4. Derive Session Key
      sessionKey.current = await deriveSessionKey(ephemeralKeyPair.current.privateKey, ephemeralPublic);

      // 5. Sign Bob's Key
      const mySignature = await signData(identityPrivateKey.current, String(myEphemeralPublicRaw));

      clearTimeout(handshakeTimeoutRef.current);
      setStatus('connected');

      // 6. Send Response
      socket.emit('signal', {
        to: data.from,
        from: username,
        type: 'RESPONSE_HANDSHAKE',
        payload: {
          ephemeralPublic: myEphemeralPublicRaw,
          signature: mySignature
        }
      });
      setTargetUser(data.from);
    } catch (error) {
      console.error('Handshake response error:', error);
      setStatus('error');
    }
  }, [username]);

  // --- STEP 3: FINALIZE HANDSHAKE (ALICE) ---
  const handleHandshakeResponse = useCallback(async (data) => {
    const { ephemeralPublic, signature } = data.payload;

    try {
      // 1. Fetch Bob's Identity Key
      const res = await axios.get(`https://localhost:443/api/auth/key/${data.from}`);
      const bobIdentityKeyJWK = JSON.parse(res.data.publicKey);
      const bobIdentityKey = await window.crypto.subtle.importKey(
          "jwk", bobIdentityKeyJWK, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]
      );

      // 2. Verify Signature
      const isValid = await verifySignature(bobIdentityKey, signature, String(ephemeralPublic));
      if (!isValid) {
          alert('⚠️ MITM ATTACK DETECTED! Signature invalid.');
          setStatus('error');
          return;
      }

      // 3. Derive Session Key
      sessionKey.current = await deriveSessionKey(ephemeralKeyPair.current.privateKey, ephemeralPublic);
      setStatus('connected');
    } catch (error) {
      console.error('Handshake finalization error:', error);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    // Load Identity Key on Mount
    const loadKey = async () => {
      identityPrivateKey.current = await getPrivateKey(username);
      if(identityPrivateKey.current) {
        socket.emit('join', username);
      }
    };
    loadKey();

    // SOCKET LISTENERS FOR HANDSHAKE
    socket.on('signal', async (data) => {
      if (data.type === 'INIT_HANDSHAKE') {
        await handleIncomingHandshake(data);
      } else if (data.type === 'RESPONSE_HANDSHAKE') {
        await handleHandshakeResponse(data);
      }
      else if (data.type === 'END_SESSION') {
        alert(`🔒 Secure session with ${data.from} has ended.`);
        sessionKey.current = null;
        ephemeralKeyPair.current = null;
        setMessages([]);
        setTargetUser('');
        setStatus('ready');
      }

    });

    // SOCKET LISTENER FOR NEW MESSAGES
    socket.on('new-message', async (data) => {
      if (sessionKey.current) {
        await fetchMessages(data.from);
      }
    });

    // SOCKET LISTENER FOR NEW FILES
    socket.on('new-file', (data) => {
      console.log('Received new-file event:', data);
      if (sessionKey.current) {
        // Set target user if not already set (for Bob receiving files)
        if (!targetUser && data.from) {
          setTargetUser(data.from);
        }
        setMessages(prev => [...prev, {
          from: data.from,
          text: `📎 Received file: ${data.filename} (${(data.size / 1024).toFixed(2)} KB)`,
          timestamp: Date.now(),
          isFile: true,
          fileId: data.fileId
        }]);
      } else {
        console.log('Session key not available, file notification ignored');
      }
    });

    return () => {
      socket.off('signal');
      socket.off('new-message');
      socket.off('new-file');
    };
  }, [username, handleIncomingHandshake, handleHandshakeResponse, fetchMessages, targetUser]);

  // --- STEP 1: START HANDSHAKE (ALICE) ---
  const startSecureChat = async () => {
    if (!targetUser.trim()) {
      alert('Please enter a username to chat with');
      return;
    }
    
    // Clear old messages when starting new session
    setMessages([]);
    setStatus('handshaking');
    
    try {
      // 1. Generate Ephemeral Keys
      ephemeralKeyPair.current = await generateEphemeralKeyPair();
      const myEphemeralPublicRaw = await exportKeyToRaw(ephemeralKeyPair.current.publicKey);

      // 2. Sign the Ephemeral Key with Identity Key (Prevents MITM)
      const signature = await signData(identityPrivateKey.current, String(myEphemeralPublicRaw));

      // 3. Send Signal
      socket.emit('signal', {
        to: targetUser,
        from: username,
        type: 'INIT_HANDSHAKE',
        payload: {
          ephemeralPublic: myEphemeralPublicRaw,
          signature: signature
        }
      });
      handshakeTimeoutRef.current = setTimeout(() => {
    setStatus(prev => {
      if (prev === 'handshaking') {
        console.warn('Handshake timed out!');
        setMessages([]);
        setTargetUser('');
        return 'idle';
      }
      return prev;
    });
  }, 7000);
    } catch (error) {
      console.error('Handshake error:', error);
      setStatus('error');
    }
  };

  // --- MESSAGING ---
  const sendMessage = async () => {
    if (!sessionKey.current) {
      alert("⚠️ No secure connection! Start a handshake first.");
      return;
    }

    if (status !== 'connected') {
      alert("⚠️ Wait for secure connection to complete!");
      return;
    }

    if (!inputText.trim()) return;

    try {
      // Encrypt
      const { ciphertext, iv } = await encryptMessage(sessionKey.current, inputText);

      // Send to Server (Store) & Socket (Realtime)
      const payload = {
          sender: username,
          recipient: targetUser,
          ciphertext,
          iv,
          timestamp: Date.now()
      };

      // Store in DB
      await axios.post('https://localhost:443/api/messages/send', payload);
      
      // Update UI
      setMessages(prev => [...prev, { from: username, text: inputText, timestamp: Date.now() }]);
      setInputText('');
    } catch (error) {
      console.error('Send message error:', error);
      alert('Failed to send message');
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // --- FILE HANDLING ---
  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!sessionKey.current) {
      alert("⚠️ No secure connection! Start a handshake first.");
      return;
    }

    if (status !== 'connected') {
      alert("⚠️ Wait for secure connection to complete!");
      return;
    }

    try {
      setUploadProgress('Encrypting file...');
      
      // Encrypt file
      const encryptedFile = await encryptFile(sessionKey.current, file);
      
      setUploadProgress('Uploading encrypted file...');
      
      // Upload to server
      const response = await uploadEncryptedFile(encryptedFile, username, targetUser);
      
      setUploadProgress(null);
      
      // Add file message to UI
      console.log('File uploaded successfully:', response);
      setMessages(prev => [...prev, {
        from: username,
        text: `📎 Sent file: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`,
        timestamp: Date.now(),
        isFile: true,
        fileId: response.fileId
      }]);
      
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
  } catch (error) {
    console.error('File upload error:', error);
    alert(`Failed to send file: ${error.message}`);
    setUploadProgress(null);
  }
};  const handleFileDownload = async (fileId, filename) => {
    if (!sessionKey.current) {
      alert("⚠️ No secure connection!");
      return;
    }

    try {
      setUploadProgress('Downloading and decrypting file...');
      
      const decryptedFile = await downloadAndDecryptFile(sessionKey.current, fileId);
      
      // Trigger download
      downloadFile(decryptedFile.data, decryptedFile.filename, decryptedFile.mimeType);
      
      setUploadProgress(null);
  } catch (error) {
    console.error('File download error:', error);
    console.error('Error details:', error.response?.data || error.message);
    alert(`Failed to download file: ${error.message}. It may be from a previous session.`);
    setUploadProgress(null);
  }
};  const getStatusInfo = () => {
    switch(status) {
      case 'ready':
        return { text: 'Ready to connect', color: 'bg-gray-100 text-gray-700', icon: '⚪' };
      case 'handshaking':
        return { text: 'Establishing secure connection...', color: 'bg-yellow-100 text-yellow-700', icon: '🔄' };
      case 'connected':
        return { text: `Secure connection with ${targetUser}`, color: 'bg-green-100 text-green-700', icon: '🔒' };
      case 'error':
        return { text: 'Connection error', color: 'bg-red-100 text-red-700', icon: '⚠️' };
      default:
        return { text: 'Initializing...', color: 'bg-gray-100 text-gray-700', icon: '⏳' };
    }
  };

  const statusInfo = getStatusInfo();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex flex-col">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-lg">{username[0].toUpperCase()}</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-800">{username}</h2>
              <div className={`text-xs px-2 py-1 rounded-full inline-flex items-center ${statusInfo.color}`}>
                <span className="mr-1">{statusInfo.icon}</span>
                {statusInfo.text}
              </div>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 max-w-6xl w-full mx-auto p-4 flex flex-col">
        {!sessionKey.current ? (
          /* Connection Setup */
          <div className="flex-1 flex items-center justify-center">
            <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full">
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full mx-auto mb-4 flex items-center justify-center">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <h3 className="text-2xl font-bold text-gray-800 mb-2">Start Secure Chat</h3>
                <p className="text-gray-600">Enter a username to begin encrypted messaging</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Chat with
                  </label>
                  <input
                    type="text"
                    value={targetUser}
                    onChange={(e) => setTargetUser(e.target.value)}
                    placeholder="Enter username"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                    onKeyPress={(e) => e.key === 'Enter' && startSecureChat()}
                  />
                </div>

                <button
                  onClick={startSecureChat}
                  disabled={!targetUser.trim() || status === 'handshaking'}
                  className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 text-white py-3 rounded-lg font-medium hover:from-blue-600 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg"
                >
                  {status === 'handshaking' ? (
                    <span className="flex items-center justify-center">
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Connecting...
                    </span>
                  ) : (
                    'Start Encrypted Chat'
                  )}
                </button>

                <div className="mt-4 p-4 bg-blue-50 rounded-lg text-xs text-gray-600">
                  <p className="font-medium mb-1">🔐 Security Features:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>End-to-end encryption (AES-256-GCM)</li>
                    <li>Perfect forward secrecy (ephemeral keys)</li>
                    <li>Identity verification (digital signatures)</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Chat Interface */
          <div className="flex-1 flex flex-col bg-white rounded-2xl shadow-xl overflow-hidden">
            {/* Chat Header */}
            <div className="bg-gradient-to-r from-blue-500 to-indigo-600 px-6 py-4 text-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                    <span className="font-bold">{targetUser[0].toUpperCase()}</span>
                  </div>
                  <div>
                    <h3 className="font-semibold">{targetUser}</h3>
                    <p className="text-xs text-blue-100">🔒 End-to-end encrypted</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (window.confirm('End secure session?')) {
                      socket.emit('signal', {
                        to: targetUser,
                        from: username,
                        type: 'END_SESSION'
                      });
                      sessionKey.current = null;
                      ephemeralKeyPair.current = null;
                      setMessages([]);
                      setTargetUser('');
                      setStatus('ready');
                    }
                  }}
                  className="px-3 py-1 bg-white/20 hover:bg-white/30 rounded-lg text-sm transition"
                >
                  End Session
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-50">
              {messages.length === 0 ? (
                <div className="text-center text-gray-500 py-12">
                  <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  <p>No messages yet. Start the conversation!</p>
                </div>
              ) : (
                messages.map((m, i) => (
                  <div key={i} className={`flex ${m.from === username ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-2xl ${
                      m.from === username
                        ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white'
                        : 'bg-white text-gray-800 shadow-sm'
                    }`}>
                      <p className="break-words">{m.text}</p>
                      {m.isFile && m.fileId && (
                        <button
                          onClick={() => handleFileDownload(m.fileId, m.text)}
                          className={`mt-2 px-3 py-1 rounded-lg text-xs font-medium ${
                            m.from === username
                              ? 'bg-white/20 hover:bg-white/30 text-white'
                              : 'bg-blue-100 hover:bg-blue-200 text-blue-700'
                          }`}
                        >
                          ⬇️ Download
                        </button>
                      )}
                      <p className={`text-xs mt-1 ${m.from === username ? 'text-blue-100' : 'text-gray-500'}`}>
                        {new Date(m.timestamp).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="border-t bg-white p-4">
              {uploadProgress && (
                <div className="mb-3 text-sm text-blue-600 flex items-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  {uploadProgress}
                </div>
              )}
              <div className="flex space-x-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={status !== 'connected'}
                  className="px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  title="Send encrypted file"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                </button>
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Type your encrypted message..."
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                />
                <button
                  onClick={sendMessage}
                  disabled={!inputText.trim()}
                  className="px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg font-medium hover:from-blue-600 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Chat;