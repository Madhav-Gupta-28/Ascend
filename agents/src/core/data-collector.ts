/**
 * Ascend — Data Collector
 * 
 * Fetches HBAR/USD price data from CoinGecko API
 * and on-chain activity from Hedera Mirror Node.
 */

export interface PriceData {
    currentPrice: number;     // USD, e.g. 0.3218
    price24hAgo: number;      // USD
    change24hPct: number;     // percentage
    high24h: number;
    low24h: number;
    volume24h: number;
    marketCap: number;
}

export interface OHLCCandle {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
}

export interface MarketData {
    price: PriceData;
    ohlc: OHLCCandle[];
    fetchedAt: number;
}

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

/** Cache duration: 30 seconds. CoinGecko free tier allows ~30 calls/min. */
const PRICE_CACHE_TTL_MS = 30_000;

export class DataCollector {
    private apiKey?: string;
    private cachedMarketData: MarketData | null = null;
    private cacheTimestamp = 0;

    constructor(apiKey?: string) {
        this.apiKey = apiKey;
    }

    private async fetchJSON(url: string): Promise<any> {
        const headers: Record<string, string> = { "Accept": "application/json" };
        if (this.apiKey) {
            headers["x-cg-demo-api-key"] = this.apiKey;
        }

        // Retry with backoff on 429
        for (let attempt = 0; attempt < 3; attempt++) {
            const res = await fetch(url, { headers });
            if (res.status === 429) {
                const waitSecs = Math.pow(2, attempt + 1) * 5; // 10s, 20s, 40s
                console.warn(`[data-collector] CoinGecko 429 rate limit, waiting ${waitSecs}s...`);
                await new Promise((r) => setTimeout(r, waitSecs * 1000));
                continue;
            }
            if (!res.ok) throw new Error(`CoinGecko API error ${res.status}: ${url}`);
            return res.json();
        }
        throw new Error(`CoinGecko API error 429: rate limited after retries`);
    }

    /**
     * Fetch current HBAR/USD price data
     */
    async getHBARPrice(): Promise<PriceData> {
        const data = await this.fetchJSON(
            `${COINGECKO_BASE}/coins/hedera-hashgraph?localization=false&tickers=false&community_data=false&developer_data=false`
        );

        return {
            currentPrice: data.market_data.current_price.usd,
            price24hAgo: data.market_data.current_price.usd * (1 - data.market_data.price_change_percentage_24h / 100),
            change24hPct: data.market_data.price_change_percentage_24h,
            high24h: data.market_data.high_24h.usd,
            low24h: data.market_data.low_24h.usd,
            volume24h: data.market_data.total_volume.usd,
            marketCap: data.market_data.market_cap.usd,
        };
    }

    /**
     * Fetch OHLC candles (1-day, ~6 candles per day)
     */
    async getHBAROHLC(days: number = 1): Promise<OHLCCandle[]> {
        const data = await this.fetchJSON(
            `${COINGECKO_BASE}/coins/hedera-hashgraph/ohlc?vs_currency=usd&days=${days}`
        );

        return (data as number[][]).map((candle: number[]) => ({
            timestamp: candle[0],
            open: candle[1],
            high: candle[2],
            low: candle[3],
            close: candle[4],
        }));
    }

    /**
     * Collect all market data for agents.
     * Returns cached data if less than 30s old to avoid CoinGecko rate limits.
     */
    async collectMarketData(): Promise<MarketData> {
        const now = Date.now();
        if (this.cachedMarketData && now - this.cacheTimestamp < PRICE_CACHE_TTL_MS) {
            return this.cachedMarketData;
        }

        const [price, ohlc] = await Promise.all([
            this.getHBARPrice(),
            this.getHBAROHLC(1),
        ]);

        this.cachedMarketData = { price, ohlc, fetchedAt: now };
        this.cacheTimestamp = now;
        return this.cachedMarketData;
    }

    /**
     * Convert USD price to 8-decimal contract format
     * e.g. 0.3218 → 32180000
     */
    static priceToContract(usdPrice: number): bigint {
        return BigInt(Math.round(usdPrice * 1e8));
    }

    /**
     * Convert contract price back to USD
     * e.g. 32180000 → 0.3218
     */
    static contractToPrice(contractPrice: bigint): number {
        return Number(contractPrice) / 1e8;
    }
}
