import { Collection } from 'discord.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { IBotCommand } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class CommandHandler {
    private commands = new Collection<string, IBotCommand>();

    async load() {
        // Path to your commands directory
        const commandsPath = path.join(__dirname, '../commands');
        const files = await fs.readdir(commandsPath);

        // Filter for TS or JS files and skip map files
        const commandFiles = files.filter(file => 
            (file.endsWith('.ts') || file.endsWith('.js')) && !file.endsWith('.map')
        );

        for (const file of commandFiles) {
            const filePath = path.join(commandsPath, file);
            const fileUrl = pathToFileURL(filePath).href;
            
            // Dynamically import the module
            const module = await import(fileUrl);
            
            // Get the first exported class (assuming one command per file)
            const CommandClass = Object.values(module).find(
                (val) => typeof val === 'function' && val.prototype.execute
            ) as any;

            if (CommandClass) {
                const command: IBotCommand = new CommandClass();
                this.commands.set(command.data.name, command);
                console.log(`✅ Loaded command: ${command.data.name}`);
            }
        }
        return this.commands;
    }
}