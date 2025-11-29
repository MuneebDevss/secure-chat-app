import './App.css';
import React, { useState } from 'react';
import Register from './components/Register';
import Login from './components/Login';
import Chat from './components/Chat';

function App() {
  const [view, setView] = useState('login'); // 'login', 'register', 'chat'
  const [username, setUsername] = useState('');

  const handleLoginSuccess = (user) => {
    setUsername(user);
    setView('chat');
  };

  const handleRegisterSuccess = () => {
    setView('login');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      {view === 'chat' ? (
        <Chat username={username} onLogout={() => { setView('login'); setUsername(''); }} />
      ) : (
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="w-full max-w-md">
            {/* Header */}
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl mb-4 shadow-lg">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h1 className="text-3xl font-bold text-gray-800 mb-2">Secure Chat</h1>
              <p className="text-gray-600">End-to-end encrypted messaging</p>
            </div>

            {/* Auth Card */}
            <div className="bg-white rounded-2xl shadow-xl p-8">
              {/* Tabs */}
              <div className="flex gap-2 mb-6 bg-gray-100 p-1 rounded-lg">
                <button
                  onClick={() => setView('login')}
                  className={`flex-1 py-2 px-4 rounded-md font-medium transition-all ${
                    view === 'login'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-800'
                  }`}
                >
                  Login
                </button>
                <button
                  onClick={() => setView('register')}
                  className={`flex-1 py-2 px-4 rounded-md font-medium transition-all ${
                    view === 'register'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-800'
                  }`}
                >
                  Register
                </button>
              </div>

              {/* Content */}
              {view === 'login' ? (
                <Login onLoginSuccess={handleLoginSuccess} onSwitchToRegister={() => setView('register')} />
              ) : (
                <Register onRegisterSuccess={handleRegisterSuccess} onSwitchToLogin={() => setView('login')} />
              )}
            </div>

            {/* Footer */}
            <div className="text-center mt-6 text-sm text-gray-600">
              <p>🔒 Your messages are encrypted end-to-end</p>
              <p className="mt-1">Keys never leave your device</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
