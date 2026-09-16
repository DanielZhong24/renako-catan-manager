interface AuthPayload {
  discordId: string;
  apiKey: string;
}

console.log('🔄 Extension background service worker loaded');

// Initialize icon based on saved state
chrome.storage.local.get(['apiKey'], (result) => {
  if (result.apiKey) {
    setConnectedIcon();
  } else {
    setDisconnectedIcon();
  }
});

// Function to set connected icon (pink with green dot)
function setConnectedIcon() {
  chrome.action.setIcon({
    path: {
      '16': 'icons/connected.png',
      '32': 'icons/connected.png',
      '48': 'icons/connected.png',
      '128': 'icons/connected.png'
    }
  });
}

// Function to set disconnected icon (gray)
function setDisconnectedIcon() {
  chrome.action.setIcon({
    path: {
      '16': 'icons/disconnected.png',
      '32': 'icons/disconnected.png',
      '48': 'icons/disconnected.png',
      '128': 'icons/disconnected.png'
    }
  });
}

chrome.runtime.onMessageExternal.addListener(
  (request, sender, sendResponse) => {
    console.log('📨 External message received:', request.type, 'from:', sender.url);
    
    if (request.type === "SET_CREDENTIALS") {
      const { discordId, apiKey } = request.payload as AuthPayload;
      
      console.log('💾 Saving credentials for:', discordId);

      // Save to storage with connection timestamp
      chrome.storage.local.set({ 
        discordId, 
        apiKey,
        connectionTimestamp: Date.now() // Mark when connection happened
      }, () => {
        console.log("✅ Credentials saved for user:", discordId);
        
        // Set connected icon
        setConnectedIcon();
        
        // Open popup to show successful connection
        chrome.action.openPopup();
        
        // Send confirmation response back to page
        sendResponse({ 
          success: true, 
          message: "Linked to Backend",
          timestamp: new Date().toISOString(),
          extensionVersion: chrome.runtime.getManifest().version
        });
      });

      return true; // Keep channel open for async response
    }
  }
);

// Listen for disconnect in popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'DISCONNECTED') {
    setDisconnectedIcon();
  }
  
  // Handle error notifications from content script
  if (message.type === 'ERROR_NOTIFICATION') {
    const { error, status } = message;
    console.error('❌ Game submission error:', error);
    
    // Set error badge on extension icon
    chrome.action.setBadgeText({ text: '⚠️' });
    chrome.action.setBadgeBackgroundColor({ color: '#ff0000' });
    
    // Store error for popup to display
    chrome.storage.local.set({ 
      lastError: error,
      lastErrorTime: Date.now(),
      lastErrorStatus: status
    });
    
    // Open popup to show error
    chrome.action.openPopup();
    
    // Clear badge after 10 seconds
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '' });
    }, 10000);
  }
  
  // Handle success notifications
  if (message.type === 'SUCCESS_NOTIFICATION') {
    console.log('✅ Game submitted successfully');

    chrome.storage.local.set({
      lastSuccess: message.message || 'Game recorded successfully!',
      lastSuccessTime: Date.now()
    });

    // Open the popup so displaySuccessMessage can show the confirmation.
    chrome.action.openPopup();
    
    // Set success badge
    chrome.action.setBadgeText({ text: '✓' });
    chrome.action.setBadgeBackgroundColor({ color: '#00ff00' });
    
    // Clear badge after 5 seconds
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '' });
    }, 5000);
  }
});