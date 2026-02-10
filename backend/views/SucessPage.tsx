import { html } from 'hono/html';

export const SuccessPage = (username: string, avatarUrl: string, discordId: string, apiKey: string) => html`
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Link Account | Renako</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Inter:wght@300;400;600&display=swap');
        
        body {
          font-family: 'Inter', sans-serif;
          background-color: #0f1115;
        }
        .mono { font-family: 'JetBrains Mono', monospace; }
        
        .theme-glow {
          box-shadow: 0 0 25px rgba(236, 72, 153, 0.15);
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        
        .animate-spin-custom {
          animation: spin 1.5s linear infinite;
        }
      </style>
    </head>
    <body class="flex items-center justify-center min-h-screen m-0 p-4">
      <div class="card bg-[#1a1c23] border border-gray-800 p-8 rounded-2xl text-center shadow-2xl w-full max-w-sm theme-glow transition-all duration-500">
        <div class="relative inline-block mb-6">
          <img src="${avatarUrl}" alt="Avatar" class="w-20 h-20 rounded-full border-2 border-pink-500 p-1" />
          <div class="absolute bottom-0 right-0 w-5 h-5 bg-green-500 border-4 border-[#1a1c23] rounded-full"></div>
        </div>

        <h1 class="text-xl font-semibold text-gray-100 mb-1">Welcome, ${username}</h1>
        <div class="id-badge mono text-[10px] bg-[#0f1115] text-pink-400/80 py-1 px-3 rounded-md inline-block mb-6 border border-pink-900/30">
          USER_ID: ${discordId}
        </div>

        <div class="text-left space-y-3 mb-8 bg-[#14151a] p-4 rounded-xl border border-gray-800/50">
          <div class="flex items-start gap-3">
            <span class="mono text-pink-500 font-bold text-xs">01.</span>
            <p class="text-[11px] text-gray-400 leading-relaxed">Ensure <span class="text-pink-300">Renako Catan Manager</span> is installed and enabled in your browser.</p>
          </div>
          <div class="flex items-start gap-3">
            <span class="mono text-pink-500 font-bold text-xs">02.</span>
            <p class="text-[11px] text-gray-400 leading-relaxed">Click below to establish the connection. <span class="italic">(Renako is nervous!)</span></p>
          </div>
        </div>

        <div class="space-y-3">
            <button onclick="window.location.href='https://chromewebstore.google.com/detail/colonist-game-logger/dgnoldnmedeoclgeieofphoaikogicff'" 
                  class="block w-full py-3 px-4 bg-pink-600 hover:bg-pink-500 text-white text-sm font-bold rounded-lg transition-all shadow-lg shadow-pink-900/40 active:scale-95">
           Install the extension
          </button>
          <button onclick="linkExtension('${discordId}', '${apiKey}')" 
                  class="block w-full py-3 px-4 bg-pink-600 hover:bg-pink-500 text-white text-sm font-bold rounded-lg transition-all shadow-lg shadow-pink-900/40 active:scale-95">
            Link to Extension
          </button>
          
          <a href="chrome://extensions" target="_blank" 
             class="block w-full py-2 px-4 bg-transparent hover:bg-gray-800 text-gray-500 hover:text-gray-300 text-[10px] mono uppercase tracking-widest rounded-lg transition-all">
            Troubleshoot Extensions
          </a>
        </div>

        <div id="status-message" class="mt-6 text-center h-4">
          <p class="text-[10px] text-gray-600 italic">System: Awaiting manual handshake...</p>
        </div>
      </div>

      <div id="loading-overlay" class="hidden fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50">
        <div class="bg-[#1a1c23] border border-pink-600/40 rounded-2xl p-8 text-center max-w-sm shadow-2xl">
          <div class="mb-6 flex justify-center">
            <div class="relative w-16 h-16">
              <div id="spinner" class="absolute inset-0 rounded-full border-4 border-transparent border-t-pink-500 border-r-pink-500 animate-spin-custom"></div>
              <div class="absolute inset-2 rounded-full border-2 border-pink-900/20"></div>
            </div>
          </div>
          
          <h2 id="modal-title" class="text-lg font-semibold text-gray-100 mb-2">Connecting...</h2>
          <p id="modal-desc" class="text-xs text-gray-400 mb-6">
            Renako is trying her best to find your browser...
          </p>
          
          <div class="bg-gray-950 rounded-lg p-4 border border-gray-800">
            <p class="text-[10px] text-pink-400/80 font-mono italic">
              "U-uuu... please let the connection work!"
            </p>
          </div>
        </div>
      </div>

      <script>
        const EXTENSION_ID = "dgnoldnmedeoclgeieofphoaikogicff";

        function updateUI(state) {
          const overlay = document.getElementById('loading-overlay');
          const status = document.getElementById('status-message');
          const title = document.getElementById('modal-title');
          const desc = document.getElementById('modal-desc');

          if (state === 'loading') {
            overlay.classList.remove('hidden');
            status.innerHTML = '<p class="text-[10px] text-pink-400 italic animate-pulse">✨ Handshaking with extension...</p>';
          } else if (state === 'success') {
            title.innerText = "Success! ♡";
            title.classList.add('text-green-400');
            desc.innerText = "Connection established. Renako has joined your party!";
            
            setTimeout(() => {
              overlay.classList.add('hidden');
              status.innerHTML = '<p class="text-[10px] text-green-400 font-bold">✅ LINKED SUCCESSFULLY</p>';
            }, 1800); // Artificial delay so user sees the success state
          } else if (state === 'error') {
            overlay.classList.add('hidden');
            status.innerHTML = '<p class="text-[10px] text-red-400 font-bold">❌ CONNECTION FAILED</p>';
          }
        }

        function linkExtension(discordId, apiKey) {
          updateUI('loading');

          // Small delay before sending to ensure overlay is visible
          setTimeout(() => {
            if (!window.chrome || !chrome.runtime) {
              alert("A-awawa! I can't find the Chrome Runtime. Are you using Google Chrome?");
              updateUI('error');
              return;
            }

            chrome.runtime.sendMessage(
              EXTENSION_ID,
              {
                type: "SET_CREDENTIALS",
                payload: { discordId, apiKey }
              },
              (response) => {
                if (chrome.runtime.lastError) {
                  console.error(chrome.runtime.lastError);
                  updateUI('error');
                  alert("Extension not detected. Make sure it is installed and Developer Mode is on!");
                } else if (response && response.success) {
                  updateUI('success');
                } else {
                  updateUI('error');
                }
              }
            );
          }, 600);
        }
      </script>
    </body>
  </html>
`;