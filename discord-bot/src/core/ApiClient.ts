// bot/src/core/ApiClient.ts
export class ApiClient {
    constructor(public baseUrl: string) {}

    /**
     * A private helper to handle all fetch logic.
     * <T> is a placeholder for the type we expect back from the server.
     */
    private async request<T>(path: string, options?: RequestInit): Promise<T | null> {
        const url = `${this.baseUrl}${path}`;
        
        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options?.headers,
            },
        });

        // 404 is a common case for "not found," return null instead of throwing
        if (response.status === 404) return null;
        
        if (!response.ok) {
            throw new Error(`API_ERROR: ${response.status} ${response.statusText}`);
        }

        // Fetch requires awaiting the .json() stream
        return await response.json() as T;
    }

    // --- GET Requests ---

    async getStats(discordId: string) {
        return this.request<any>(`/api/discord/stats/${discordId}`);
    }

    async getHistory(discordId: string) {
        return this.request<any[]>(`/api/discord/history/${discordId}`);
    }

    async checkUser(discordId: string) {
        return this.request<any>(`/api/discord/user/${discordId}`);
    }

    async getPlayerByCatanName(name: string) {
        return this.request<any>(`/api/discord/search?name=${encodeURIComponent(name)}`);
    }

    async getLeaderboard(guildId: string, limit: number = 10) {
        return this.request<any[]>(`/api/discord/leaderboard/${guildId}?limit=${limit}`);
    }

    // --- POST Requests ---

    async createPendingSession(uploaderId: string, guildId: string,channelId:string) {
        return this.request<{ id: string }>('/api/discord/sessions', {
            method: 'POST',
            body: JSON.stringify({ uploaderId, guildId,channelId }),
        }) as Promise<{ id: string }>; 
        // Force the type here because we know createPendingSession shouldn't return null if successful
    }
}