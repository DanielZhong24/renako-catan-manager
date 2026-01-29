/// <reference types="chrome" />
import { ScrapeCoordinator } from './coordinator';
import { OverviewScraper, DiceScraper, ResourceScraper, ActivityScraper, ResCardScraper, DevCardScraper } from './scraper';
import { GameStats, Player } from './types';

const STAT_MAP: Record<string, string> = {
    'stat_proposed_trades': 'trades_proposed', 'stat_successful_trades': 'trades_accepted',
    'stat_resources_used': 'resources_spent', 'stat_resource_income_blocked': 'income_blocked',
    'stat_dev_card_bought': 'dev_cards_bought', 'stat_dev_card_used': 'dev_cards_played',
    'stat_res_gain': 'total_gain', 'stat_res_loss': 'total_loss',
    'stat_res_score': 'net_efficiency', 'stat_rolling_income': 'income_roll',
    'stat_robbing_income': 'income_rob', 'stat_dev_card_income': 'income_dev',
    'stat_trade_income': 'income_trade', 'stat_rolling_loss': 'loss_roll',
    'stat_robbing_loss': 'loss_rob', 'stat_dev_card_loss': 'loss_dev',
    'stat_trade_loss': 'loss_trade', 'stat_gold_income': 'income_gold'
};

let isProcessingGame = false;
let lastLoggedLobby: string | null = null;
let failedLobbies = new Set<string>(); // Blacklist failed lobbies to prevent re-scraping

/**
 * Display an in-page notification banner to the user
 */
const showNotification = (message: string, type: 'error' | 'success' = 'error') => {
    let banner = document.getElementById('catan-notification-banner');
    
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'catan-notification-banner';
        document.body.insertBefore(banner, document.body.firstChild);
    }
    
    const bgColor = type === 'error' ? 'rgba(255, 59, 48, 0.95)' : 'rgba(76, 175, 80, 0.95)';
    const icon = type === 'error' ? '⚠️' : '✅';
    
    banner.innerHTML = `
        <div style="
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: ${bgColor};
            color: white;
            padding: 16px 24px;
            border-radius: 8px;
            font-weight: 600;
            font-size: 14px;
            z-index: 10000;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
            max-width: 500px;
            word-wrap: break-word;
            animation: slideDown 0.3s ease-out;
        ">
            ${icon} ${message}
        </div>
    `;
    
    // Auto-remove after 6 seconds
    setTimeout(() => banner?.remove(), 6000);
};

const coordinator = new ScrapeCoordinator();
coordinator.addStrategy(new OverviewScraper());
coordinator.addStrategy(new DiceScraper());
coordinator.addStrategy(new ResCardScraper());
coordinator.addStrategy(new DevCardScraper());
coordinator.addStrategy(new ActivityScraper());
coordinator.addStrategy(new ResourceScraper());

/**
 * LOBBY LOCK: Identifies the local user from the lobby list
 */
const lockIdentityInLobby = () => {
    // Select the player names in the lobby list
    const nameSpans = document.querySelectorAll('.room_player_username');
    
    for (const span of Array.from(nameSpans)) {
        const text = span.textContent || "";
        if (text.includes("(You)")) {
            const myName = text.replace("(You)", "").trim();
            // Store it so we remember it when the game ends
            chrome.storage.local.set({ session_me: myName });
            console.log("[Catan Logger] Identity Locked:", myName);
            return myName;
        }
    }
    return null;
};

const processAndSend = async (currentLobby: string) => {
    if (isProcessingGame) return;
    isProcessingGame = true;

    try {
        const credentials = await chrome.storage.local.get(['apiKey', 'session_me']) as { 
                    apiKey?: string; 
                    session_me?: string; 
                };        
        const apiKey = credentials.apiKey || "";
        const sessionMe = credentials.session_me || "";

        if (!apiKey) {
            console.error("[Catan Logger] No API Key found! Please link account.");
            return;
        }

        const stats = await coordinator.executeFullCrawl();
        
        // --- PROFESSIONAL FIX: Apply isMe flag to Overview ---
        const rawOverview = (stats.overview || []) as Player[];
        const overviewWithIdentity = rawOverview.map(player => ({
            ...player,
            // Clean (You) just in case the end-game screen has it too
            name: player.name.replace("(You)", "").trim(),
            // Flag as 'Me' if name matches what we locked in the lobby
            isMe: player.name.includes("(You)") || player.name.trim() === sessionMe
        }));

        const zipTable = (tableData: any) => {
            if (!tableData || !tableData.headers) return [];
            return overviewWithIdentity.map((player, index) => {
                const row = tableData.rows[index] || [];
                const result: Record<string, any> = { name: player.name };
                tableData.headers.forEach((header: string, i: number) => {
                    const cleanKey = STAT_MAP[header.split('.')[0]] || header;
                    result[cleanKey] = parseInt(row[i]) || 0;
                });
                return result;
            });
        };

        const payload = {
            lobbyId: currentLobby,
            timestamp: new Date().toISOString(),
            overview: overviewWithIdentity,
            dice_stats: stats.dice_stats || {},
            res_card_stats: stats.res_card_stats || {},
            dev_card_stats: stats.dev_card_stats || {},
            activity_stats: zipTable(stats.activity_stats),
            resource_stats: zipTable(stats.resource_stats)
        };

        console.log(payload);

        const response = await fetch('http://localhost:3000/api/games/ingest', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-api-key': apiKey 
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const errorMessage = errorData.error || `Server error: ${response.status}`;
            
            // Mark this lobby as logged even on error to prevent re-scraping
            lastLoggedLobby = currentLobby;
            
            // Show error to user on-page
            showNotification(`Game not recorded: ${errorMessage}`, 'error');
            
            // Notify the user through the extension popup with error details
            chrome.runtime.sendMessage({ 
                type: 'ERROR_NOTIFICATION',
                error: errorMessage,
                status: response.status
            }).catch(() => {}); // Ignore if popup not open
            
            // Stop processing here - don't throw, just return
            return;
        }

        const successData = await response.json();
        console.log("[Catan Logger] Successfully uploaded game stats!", successData);
        
        // Show success to user on-page
        showNotification('Game recorded successfully!', 'success');
        
        // Notify success through extension
        chrome.runtime.sendMessage({ 
            type: 'SUCCESS_NOTIFICATION',
            message: 'Game recorded successfully!'
        }).catch(() => {});
        
        lastLoggedLobby = currentLobby;

    // Inside processAndSend catch block
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', status: 'ERR', error: errorMsg });
        console.error("[Catan Logger] Scrape or Upload failed:", err);
    } finally {
        // Always mark as done and clean up, even if error occurred
        chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', status: 'DONE' });
        setTimeout(() => { 
            chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', status: 'CLEAR' });
            isProcessingGame = false; // Critical: reset flag to allow future games
        }, 5000);
    }
};

// MUTATION OBSERVER: Watches for Lobby entry OR Game completion
const observer = new MutationObserver(() => {
    const lobbyList = document.querySelector('#scene_room_player_list');
    const modal = document.querySelector('div[class*="contentContainer"]');
    const lobbyId = window.location.href.split('/').pop() || "";

    // 1. If in Lobby, lock the identity
    if (lobbyList) {
        lockIdentityInLobby();
    }

    // 2. If end-game modal appears, trigger upload (but skip blacklisted lobbies)
    if (modal && !isProcessingGame && lobbyId !== lastLoggedLobby && !failedLobbies.has(lobbyId)) {
        processAndSend(lobbyId);
    }
});

observer.observe(document.body, { childList: true, subtree: true });
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === "GET_STATS") {
    const lobbyId = window.location.href.split('/').pop() || "manual-trigger";
    
    if (isProcessingGame) {
      sendResponse({ success: false, message: "Already processing..." });
    } else {
      processAndSend(lobbyId); // Trigger the full crawl and upload
      sendResponse({ success: true });
    }
  }
  return true; 
});