import React, { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import { getPrivateKey } from '../utils/db';
import { 
  generateEphemeralKeyPair, exportKeyToRaw, signData, 
  verifySignature, deriveSessionKey, encryptMessage, decryptMessage
} from '../utils/crypto';

const socket = io('https://localhost:443');

const Chat = ({ username, onLogout }) => {
  const [targetUser, setTargetUser] = useState('');
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [status, setStatus] = useState('idle');
  
  // SECURE STATE
  const identityPrivateKey = useRef(null);
  const sessionKey = useRef(null); 
  const ephemeralKeyPair = useRef(null);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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
      const isValid = await verifySignature(aliceIdentityKey, signature, ephemeralPublic);
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
      const mySignature = await signData(identityPrivateKey.current, myEphemeralPublicRaw);

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
      setStatus('connected');
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
      const isValid = await verifySignature(bobIdentityKey, signature, ephemeralPublic);
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
      identityPrivateKey.current = await getPrivateKey();
      if(identityPrivateKey.current) {
        setStatus('ready');
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
    });

    return () => {
      socket.off('signal');
    };
  }, [username, handleIncomingHandshake, handleHandshakeResponse]);

  // --- STEP 1: START HANDSHAKE (ALICE) ---
  const startSecureChat = async () => {
    if (!targetUser.trim()) {
      alert('Please enter a username to chat with');
      return;
    }
    
    setStatus('handshaking');
    
    try {
      // 1. Generate Ephemeral Keys
      ephemeralKeyPair.current = await generateEphemeralKeyPair();
      const myEphemeralPublicRaw = await exportKeyToRaw(ephemeralKeyPair.current.publicKey);

      // 2. Sign the Ephemeral Key with Identity Key (Prevents MITM)
      const signature = await signData(identityPrivateKey.current, myEphemeralPublicRaw);

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

  const getStatusInfo = () => {
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
              <div className="flex space-x-2">
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