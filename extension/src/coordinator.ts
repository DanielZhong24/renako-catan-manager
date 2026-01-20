import { IScraperStrategy, GameStats } from './types';

export class ScrapeCoordinator {
  private strategies: IScraperStrategy[] = [];

  public addStrategy(strategy: IScraperStrategy): void {
    this.strategies.push(strategy);
  }

  // coordinator.ts
  public async executeFullCrawl(): Promise<Partial<GameStats>> {
      // 1. Remember where the user was looking
      const originalTab = document.querySelector('div[class*="tab-"].active-gpVU3tHc') as HTMLElement;
      const results: Partial<GameStats> = {};
      
      for (const strategy of this.strategies) {
          results[strategy.dataKey] = await strategy.scrape();
          await new Promise(r => setTimeout(r, 400)); 
      }

      // 2. Click back to the original tab so the user doesn't get lost
      if (originalTab) originalTab.click();
      
      return results;
  }
}