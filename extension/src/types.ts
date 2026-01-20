export interface Player {
  name: string;
  vp: number;
  isBot: boolean;
  isWinner: boolean;
}

export interface TableData {
  headers: string[];
  rows: string[][];
  rawText?: string;
}

export interface GameStats {
  lobbyId: string;
  timestamp: string;
  overview: Player[];
  dice_stats: Record<string, number>;
  res_card_stats: Record<string, number>;
  dev_card_stats: Record<string, number>;
  activity_stats: Array<Record<string, any>>;
  resource_stats: Array<Record<string, any>>;
}

export interface IScraperStrategy {
  tabName: string;
  dataKey: keyof GameStats; // Forces dataKey to match GameStats keys
  scrape(): Promise<any>;
}