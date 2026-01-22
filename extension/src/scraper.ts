import { IScraperStrategy, Player, GameStats } from './types';

abstract class BaseScraper {
  protected async sleep(ms: number = 300): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  protected async clickTab(tabName: string): Promise<boolean> {
    const tabs = document.querySelectorAll<HTMLDivElement>('div[class*="tab-"]');
    const target = Array.from(tabs).find(t => 
      t.innerText.trim().toLowerCase().includes(tabName.toLowerCase())
    );
    
    if (target) {
      if (target.classList.contains('active-gpVU3tHc')) return true;
      target.click();
      for (let i = 0; i < 10; i++) {
        await this.sleep(200);
        if (target.classList.contains('active-gpVU3tHc')) {
          await this.sleep(500);
          return true;
        }
      }
    }
    return false;
  }

  protected async scrapeTable(tabName: string, expectedMarker: string): Promise<any> {
    const success = await this.clickTab(tabName);
    if (!success) return null;
    for (let i = 0; i < 10; i++) {
      const content = document.querySelector('div[class*="container-sK9scnkJ"]');
      if (content?.innerHTML.includes(expectedMarker)) {
        const headers = Array.from(content.querySelectorAll('img[class*="headerIcon-"]'))
          .map(img => (img as HTMLImageElement).src.split('/').pop() || "");
        const rows = Array.from(content.querySelectorAll('div[class*="rowContainer-"]'))
          .map(row => Array.from(row.querySelectorAll('div[class*="value-"]'))
          .map(v => (v as HTMLElement).innerText.trim()));
        return { headers, rows };
      }
      await this.sleep(200);
    }
    return null;
  }

  protected async scrapeChart(tabName: string, containerClass: string): Promise<Record<string, number>> {
      const success = await this.clickTab(tabName);
      if (!success) return {};

      // 1. Give the container a moment to even exist
      for (let i = 0; i < 20; i++) { 
          const container = document.querySelector(`div[class*="${containerClass}"]`);
          
          // 2. CRITICAL: Check if the images (the icons) have actually loaded
          const icons = container?.querySelectorAll('img[class*="cardImage-"]');
          const hasValues = container?.querySelector('div[class*="value-"]');

          if (container && icons && icons.length > 0 && hasValues) {
              // Add one tiny extra "settle" sleep for React hydration
              await this.sleep(1000); 
              
              const stats: Record<string, number> = {};
              const bars = container.querySelectorAll<HTMLDivElement>('div[class*="barContainer-"]');
              
              bars.forEach(bar => {
                  const img = bar.querySelector('img') as HTMLImageElement;
                  const countEl = bar.querySelector('div[class*="value-"]') as HTMLElement;
                  const cardContainer = bar.querySelector('div[data-card-enum]');
                  
                  let key = "unknown";
                  if (img && img.src && img.src.includes('card_')) {
                      key = img.src.split('/').pop()?.split('.')[0]?.replace('card_', '') || "unknown";
                  } else if (cardContainer) {
                      const enumMap: Record<string, string> = {
                          "1": "lumber", "2": "brick", "3": "wool", "4": "grain", "5": "ore",
                          "11": "knight", "12": "victory_point", "13": "monopoly", "14": "road_building", "15": "year_of_plenty"
                      };
                      key = enumMap[cardContainer.getAttribute('data-card-enum') || ""] || "unknown";
                  }

                  if (key !== "unknown" && countEl) {
                      stats[key] = parseInt(countEl.innerText) || 0;
                  }
              });
              return stats;
          }
          // If not ready, wait and try again
          await this.sleep(250); 
      }
      return {};
  }
}

export class OverviewScraper extends BaseScraper implements IScraperStrategy {
  public tabName = "Overview";
  public dataKey = "overview" as const;
  public async scrape(): Promise<Player[]> {
    await this.clickTab(this.tabName);
    const container = document.querySelector('div[class*="container-f9bcDas7"]');
    if (!container) return [];
    const rows = Array.from(container.querySelectorAll<HTMLDivElement>('div[class*="row-vWs3"]'));
        const players = rows
      .filter(r => r.querySelector('div[class*="name-"]'))
      .map(row => {
        const nameEl = row.querySelector('div[class*="name-"]') as HTMLElement;
        const vpEl = row.querySelector('div[class*="victoryPoint-"]') as HTMLElement;
        
        return {
          name: nameEl.innerText.trim(),
          vp: parseInt(vpEl.innerText) || 0,
          isBot: !!row.querySelector('img[src*="icon_bot"]'),
          isWinner: false ,
          isMe: false
        };
      });

    if (players.length > 0) {
      const maxVP = Math.max(...players.map(p => p.vp));
      const winner = players.find(p => p.vp === maxVP);
      if (winner) {
        winner.isWinner = true;
      }
    }

    return players;
  }
}
export class DiceScraper extends BaseScraper implements IScraperStrategy {
  public tabName = "Dice Stats";
  public dataKey = "dice_stats" as const;
  public async scrape() {
    await this.clickTab(this.tabName);
    const container = document.querySelector('div[class*="container-mf2LWneM"]');
    const bars = container?.querySelectorAll<HTMLDivElement>('div[class*="barContainer-"]') || [];
    const stats: Record<string, number> = {};
    bars.forEach(bar => {
      const label = (bar.querySelector('div[class*="label-"]') as HTMLElement).innerText.trim();
      const count = (bar.querySelector('div[class*="value-"]') as HTMLElement)?.innerText || "0";
      stats[label] = parseInt(count);
    });
    return stats;
  }
}

export class ResCardScraper extends BaseScraper implements IScraperStrategy {
  public tabName = "Res Card Stats";
  public dataKey = "res_card_stats" as const;
  public async scrape() {
    return this.scrapeChart(this.tabName, "container-wiXsiUom");
  }
}

export class DevCardScraper extends BaseScraper implements IScraperStrategy {
  public tabName = "Dev Card Stats";
  public dataKey = "dev_card_stats" as const;
  public async scrape() {
    return this.scrapeChart(this.tabName, "container-BAeY6n7t");
  }
}

export class ActivityScraper extends BaseScraper implements IScraperStrategy {
  public tabName = "Activity Stats";
  public dataKey = "activity_stats" as const;
  public async scrape() {
    return this.scrapeTable(this.tabName, "stat_resources_used");
  }
}

export class ResourceScraper extends BaseScraper implements IScraperStrategy {
  public tabName = "Resource Stats";
  public dataKey = "resource_stats" as const;
  public async scrape() {
    return this.scrapeTable(this.tabName, "stat_res_gain");
  }
}