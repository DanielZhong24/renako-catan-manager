console.log("Catan Logger: Active and watching...");

// 1. Create the observer to watch for the End Game Modal
const observer = new MutationObserver((mutations) => {
  // Colonist often uses 'game_end_modal' or similar in their obfuscated classes
  // For now, we look for the text "Winner" appearing in a new div
  const modal = document.querySelector('div[class*="game_end"]'); 

  if (modal && !modal.getAttribute('data-logged')) {
    modal.setAttribute('data-logged', 'true'); // Prevent duplicate logs
    console.log("Victory detected! Scraping data...");

    const gameData = {
      lobbyId: window.location.href.split('/').pop() || "unknown",
      winnerName: document.querySelector('div[class*="winner_name"]')?.innerText || "Unknown Winner",
      players: [] // We'll refine the player list scraping once you see the real HTML
    };

    // 2. Send the data to your Hono server
    fetch('http://localhost:3000/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(gameData)
    })
    .then(res => console.log("Hono Server Response:", res.status))
    .catch(err => console.error("Could not reach Hono:", err));
  }
});

// 3. Start observing the body for changes
observer.observe(document.body, { childList: true, subtree: true });