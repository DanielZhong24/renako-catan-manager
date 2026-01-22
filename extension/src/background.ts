interface AuthPayload {
  discordId: string;
  apiKey: string;
}

chrome.runtime.onMessageExternal.addListener(
  (request, sender, sendResponse) => {
    if (request.type === "SET_CREDENTIALS") {
      const { discordId, apiKey } = request.payload as AuthPayload;

      // Save to storage
      chrome.storage.local.set({ discordId, apiKey }, () => {
        console.log("Credentials saved for user:", discordId);
        sendResponse({ success: true, message: "Linked to Backend" });
      });

      return true; // Keeps the channel open for async sendResponse
    }
  }
);