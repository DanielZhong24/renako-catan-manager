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

const coordinator = new ScrapeCoordinator();
coordinator.addStrategy(new OverviewScraper());
coordinator.addStrategy(new DiceScraper());
coordinator.addStrategy(new ResCardScraper());
coordinator.addStrategy(new DevCardScraper());
coordinator.addStrategy(new ActivityScraper());
coordinator.addStrategy(new ResourceScraper());

const processAndSend = async (currentLobby: string) => {
    if (isProcessingGame) return;
    isProcessingGame = true;
    try {
        const stats = await coordinator.executeFullCrawl(); // returns Partial<GameStats>
        const overview = (stats.overview || []) as Player[];

        const zipTable = (tableData: any) => {
            if (!tableData || !tableData.headers) return [];
            return overview.map((player, index) => {
                const row = tableData.rows[index] || [];
                const result: Record<string, any> = { name: player.name };
                tableData.headers.forEach((header: string, i: number) => {
                    const cleanKey = STAT_MAP[header.split('.')[0]] || header;
                    result[cleanKey] = parseInt(row[i]) || 0;
                });
                return result;
            });
        };

        const payload: GameStats = {
            lobbyId: currentLobby,
            timestamp: new Date().toISOString(),
            overview: (stats.overview || []) as Player[],
            dice_stats: stats.dice_stats || {},
            res_card_stats: stats.res_card_stats || {}, // This should now be { lumber: 5, brick: 8 ... }
            dev_card_stats: stats.dev_card_stats || {},
            activity_stats: zipTable(stats.activity_stats),
            resource_stats: zipTable(stats.resource_stats)
        };
        console.log("[Catan Logger] Final Payload:", payload);
        await fetch('http://localhost:3000/api/ingest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        lastLoggedLobby = currentLobby;
    } catch (err) {
        console.error("Scrape failed", err);
    } finally {
        setTimeout(() => {
                isProcessingGame = false;
                console.log("[Catan Logger] Lock Released.");
        }, 2000);
    }
};

(window as any).runScraper = (force = false) => {
    if (force) { lastLoggedLobby = null; isProcessingGame = false; }
    processAndSend(window.location.href.split('/').pop() || "");
};

const observer = new MutationObserver(() => {
    const modal = document.querySelector('div[class*="contentContainer"]');
    const lobby = window.location.href.split('/').pop() || "";
    if (modal && !isProcessingGame && lobby !== lastLoggedLobby) processAndSend(lobby);
});
observer.observe(document.body, { childList: true, subtree: true });