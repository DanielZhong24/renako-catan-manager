// bot/src/core/ApiClient.ts
export class ApiClient {
    constructor(public baseUrl: string) {}

    async getStats(discordId: string) {
        const res = await fetch(`${this.baseUrl}/api/discord/stats/${discordId}`);
        if (res.status === 404) return null;
        if (!res.ok) throw new Error('API_ERROR');
        return res.json();
    }

    async getHistory(discordId: string) {
        const res = await fetch(`${this.baseUrl}/api/discord/history/${discordId}`);
        if (!res.ok) throw new Error('API_ERROR');
        return res.json();
    }

    async checkUser(discordId: string) {
        const res = await fetch(`${this.baseUrl}/api/discord/user/${discordId}`);
        if (res.status === 404) return null;
        return res.json(); 
    }


    async getPlayerByCatanName(name: string) {
        const response = await fetch(`${this.baseUrl}/api/discord/search?name=${encodeURIComponent(name)}`);
        
        if (response.status === 404) return null;
        if (!response.ok) throw new Error('API_ERROR');
        
        return await response.json();
    }


}