import React, { useState } from 'react';
import axios from 'axios';
import { generateIdentityKeyPair, exportKeyToJWK } from '../utils/crypto';
import { storePrivateKey } from '../utils/db';

const Register = ({ onRegisterSuccess, onSwitchToLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [generatingKeys, setGeneratingKeys] = useState(false);

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');

    // Validation
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    setGeneratingKeys(true);

    try {
      // 1. Generate Client-Side Keys
      const keyPair = await generateIdentityKeyPair();
      
      // 2. Store Private Key Securely (IndexedDB)
      await storePrivateKey(username, keyPair.privateKey);

      // 3. Export Public Key for Server Registration
      const publicKeyJWK = await exportKeyToJWK(keyPair.publicKey);

      setGeneratingKeys(false);

      // 4. Send to Server
      await axios.post('https://localhost:443/api/auth/register', {
        username,
        password,
        publicKey: JSON.stringify(publicKeyJWK)
      });

      // Success
      alert('✅ Registration successful! Your encryption keys have been generated and stored securely.');
      onRegisterSuccess();
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || 'Registration failed. Username may already exist.');
    } finally {
      setLoading(false);
      setGeneratingKeys(false);
    }
  };

  return (
    <form onSubmit={handleRegister} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Username
        </label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
          placeholder="Choose a username"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
          placeholder="Create a password"
          required
          minLength={6}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Confirm Password
        </label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
          placeholder="Confirm your password"
          required
          minLength={6}
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {generatingKeys && (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded-lg text-sm flex items-center">
          <svg className="animate-spin h-4 w-4 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Generating encryption keys...
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 text-white py-3 rounded-lg font-medium hover:from-blue-600 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg"
      >
        {loading ? (
          <span className="flex items-center justify-center">
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Creating Account...
          </span>
        ) : (
          'Create Secure Account'
        )}
      </button>

      <div className="text-center text-sm text-gray-600 mt-4">
        Already registered?{' '}
        <button
          type="button"
          onClick={onSwitchToLogin}
          className="text-blue-600 hover:text-blue-700 font-medium"
        >
          Login
        </button>
      </div>

      <div className="mt-4 p-4 bg-gray-50 rounded-lg text-xs text-gray-600">
        <p className="font-medium mb-1">🔐 What happens during registration:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>Encryption keys are generated on your device</li>
          <li>Private key stays in your browser (never sent to server)</li>
          <li>Only public key is shared for identity verification</li>
        </ul>
      </div>
    </form>
  );
};

export default Register;