// bot/src/core/ApiClient.ts
export type ApiErrorKind = 'rate_limit' | 'upstream' | 'unknown';

export class ApiError extends Error {
    constructor(
        message: string,
        public status: number,
        public kind: ApiErrorKind,
        public details?: unknown
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

export class ApiClient {
    constructor(public baseUrl: string) {}

    /**
     * A private helper to handle all fetch logic.
     * <T> is a placeholder for the type we expect back from the server.
     */
    private async request<T>(path: string, options?: RequestInit, requesterId?: string): Promise<T | null> {
        const url = `${this.baseUrl}${path}`;

        let response: Response;
        try {
            response = await fetch(url, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    ...(requesterId ? { 'x-discord-id': requesterId } : {}),
                    ...options?.headers,
                },
            });
        } catch (error) {
            throw new ApiError('API_REQUEST_FAILED', 0, 'upstream', error);
        }

        // 404 is a common case for "not found," return null instead of throwing
        if (response.status === 404) return null;

        if (!response.ok) {
            let errorPayload: any = null;
            try {
                errorPayload = await response.json();
            } catch {
                errorPayload = null;
            }

            const errorCode = typeof errorPayload?.error === 'string' ? errorPayload.error : null;
            const kind: ApiErrorKind =
                response.status === 429 || errorCode === 'rate_limited'
                    ? 'rate_limit'
                    : response.status >= 500 || errorCode === 'upstream_error' || errorCode === 'external_rate_limited'
                        ? 'upstream'
                        : 'unknown';

            throw new ApiError(`API_ERROR: ${response.status} ${response.statusText}`, response.status, kind, errorPayload);
        }

        return await response.json() as T;
    }

    // --- GET Requests ---

    async getStats(discordId: string, requesterId: string = discordId) {
        return this.request<any>(`/api/discord/stats/${discordId}`, undefined, requesterId);
    }

    async getHistory(discordId: string, requesterId: string = discordId) {
        return this.request<any[]>(`/api/discord/history/${discordId}`, undefined, requesterId);
    }

    async checkUser(discordId: string, requesterId: string = discordId) {
        return this.request<any>(`/api/discord/user/${discordId}`, undefined, requesterId);
    }

    async getPlayerByCatanName(name: string, requesterId?: string) {
        return this.request<any>(`/api/discord/search?name=${encodeURIComponent(name)}`, undefined, requesterId);
    }

    async getLeaderboard(guildId: string, limit: number = 10, requesterId?: string) {
        return this.request<any[]>(`/api/discord/leaderboard/${guildId}?limit=${limit}`, undefined, requesterId);
    }

    // --- POST Requests ---

    async createPendingSession(uploaderId: string, guildId: string, channelId: string, requesterId: string = uploaderId) {
        return this.request<{ id: string }>('/api/discord/sessions', {
            method: 'POST',
            body: JSON.stringify({ uploaderId, guildId, channelId }),
        }, requesterId) as Promise<{ id: string }>; 
        // Force the type here because we know createPendingSession shouldn't return null if successful
    }
}