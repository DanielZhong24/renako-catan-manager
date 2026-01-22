import { Pool } from 'pg';

export interface BotContext {
    pool: Pool;
}