import { html } from 'hono/html';

// Add apiKey to the parameters
export const SuccessPage = (username: string, avatarUrl: string, discordId: string, apiKey: string) => html`
  <!DOCTYPE html>
  <html>
    <head>
      <title>Account Linked</title>
      <style>
        body { font-family: -apple-system, sans-serif; background: #23272a; color: white; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .card { background: #2c2f33; padding: 2rem; border-radius: 15px; text-align: center; box-shadow: 0 8px 24px rgba(0,0,0,0.5); width: 320px; }
        .avatar { width: 80px; height: 80px; border-radius: 50%; border: 3px solid #7289da; margin-bottom: 1rem; }
        h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
        .btn { display: inline-block; background: #7289da; color: white; padding: 12px 24px; border-radius: 5px; text-decoration: none; font-weight: bold; margin-top: 10px; transition: 0.2s; cursor: pointer; border: none; width: 100%; }
        .btn-link { background: #43b581; }
        .btn-link:hover { background: #3ca374; }
        .id-badge { background: #1e2124; padding: 5px 10px; border-radius: 5px; font-family: monospace; font-size: 0.8rem; color: #99aab5; margin-bottom: 15px; }
        .steps { text-align: left; font-size: 0.85rem; color: #b9bbbe; margin: 15px 0; }
      </style>
    </head>
    <body>
      <div class="card">
        <img src="${avatarUrl}" class="avatar" />
        <h1>Welcome, ${username}!</h1>
        <div class="id-badge">ID: ${discordId}</div>
        
        <div class="steps">
          1. Install the Extension<br>
          2. Click the button below to sync
        </div>

        <a href="chrome://extensions" target="_blank" class="btn">Open Chrome Extensions</a>
        <p style="font-size: 0.7rem; color: #99aab5; margin-top: 5px;">
        Enable "Developer Mode" and click "Load Unpacked" to select your extension folder.
        </p>        
        <button class="btn btn-link" onclick="linkExtension('${discordId}', '${apiKey}')">
          Link to Extension
        </button>
      </div>

        <script>
        function linkExtension(discordId, apiKey) {
            const EXTENSION_ID = "opjhadmmncbekdhlfeejiifedndfobjn";

            // Most browsers on localhost won't show 'chrome.runtime' 
            // to the page unless the ID is whitelisted in manifest.json
            try {
            chrome.runtime.sendMessage(EXTENSION_ID, { 
                type: "SET_CREDENTIALS", 
                payload: { discordId, apiKey } 
            }, (response) => {
                if (chrome.runtime.lastError) {
                console.log("Runtime Error:", chrome.runtime.lastError);
                alert("Extension not detected. Make sure it is installed and Developer Mode is ON.");
                } else if (response && response.success) {
                alert("✅ Successfully Linked! Extension now has your credentials.");
                }
            });
            } catch (e) {
            console.error(e);
            alert("Communication failed. Is the extension ID correct?");
            }
        }
        </script>
    </body>
  </html>
`;