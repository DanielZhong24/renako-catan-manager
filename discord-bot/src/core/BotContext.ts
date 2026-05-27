import { ApiClient } from './ApiClient.js';
import { Collection } from 'discord.js';

export interface BotContext {
    api: ApiClient;
    commands: Collection<string, any>;

}