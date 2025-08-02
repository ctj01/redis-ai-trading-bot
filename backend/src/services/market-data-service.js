const BingXClient = require('../utils/bingx-client');
const logger = require('../utils/logger');
const config = require('../utils/config');

class MarketDataService {
  constructor(divergenceEngine) {
    this.bingxClient = new BingXClient();
    this.divergenceEngine = divergenceEngine;
    this.isConnected = false;
    this.subscribedPairs = new Set();
  }

  /**
   * Initialize market data service
   */
  async initialize() {
    try {
      logger.info('Initializing Market Data Service with BingX...');

      // Test BingX connection
      const connected = await this.bingxClient.testConnection();
      if (!connected) {
        throw new Error('Failed to connect to BingX API');
      }

      this.isConnected = true;

      // Get VST trading pairs
      const vstPairs = await this.bingxClient.getVSTpairs();
      logger.info(`Available VST pairs: ${vstPairs.map(p => p.symbol).join(', ')}`);

      // Load historical data for configured pairs
      await this.loadHistoricalData();

      // Start real-time data stream
      await this.startRealTimeData();

      logger.info('✅ Market Data Service initialized');
    } catch (error) {
      logger.error('Failed to initialize Market Data Service:', error);
      throw error;
    }
  }

  /**
   * Load historical kline data for all trading pairs
   */
  async loadHistoricalData() {
    try {
      logger.info('Loading historical data from BingX...');

      for (const pair of config.trading.tradingPairs) {
        const symbol = this.convertPairToSymbol(pair);
        
        logger.info(`Loading ${symbol} historical data...`);
        
        // Get last 100 1-minute candles
        const klines = await this.bingxClient.getKlines(symbol, '1m', 100);
        
        if (klines.length > 0) {
          // Process each candle through the divergence engine
          for (const candle of klines) {
            await this.divergenceEngine.updateMarketData(pair, candle);
          }
          
          logger.info(`✅ Loaded ${klines.length} candles for ${pair}`);
        } else {
          logger.warn(`⚠️  No historical data found for ${pair}`);
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      logger.info('Historical data loading completed');
    } catch (error) {
      logger.error('Failed to load historical data:', error);
    }
  }

  /**
   * Start real-time WebSocket data stream
   */
  async startRealTimeData() {
    try {
      logger.info('Starting real-time data stream...');

      const symbols = config.trading.tradingPairs.map(pair => 
        this.convertPairToSymbol(pair)
      );

      this.bingxClient.initWebSocket(symbols, (candle) => {
        this.handleRealTimeCandle(candle);
      });

      logger.info(`✅ Real-time data stream started for: ${symbols.join(', ')}`);
    } catch (error) {
      logger.error('Failed to start real-time data stream:', error);
    }
  }

  /**
   * Handle incoming real-time candle data
   * @param {Object} candle - Real-time candle data
   */
  async handleRealTimeCandle(candle) {
    try {
      // Only process closed candles for accuracy
      if (!candle.isFinal) {
        return;
      }

      const pair = this.convertSymbolToPair(candle.symbol);
      
      if (config.trading.tradingPairs.includes(pair)) {
        logger.debug(`📊 New candle for ${pair}: $${candle.close} (Volume: ${candle.volume})`);
        
        // Process through divergence engine
        await this.divergenceEngine.updateMarketData(pair, candle);
        
        // Log current RSI for monitoring
        const currentRSI = this.divergenceEngine.getCurrentRSI(pair);
        if (currentRSI) {
          logger.debug(`📈 ${pair} RSI: ${currentRSI.toFixed(2)}`);
        }
      }
    } catch (error) {
      logger.error('Error handling real-time candle:', error);
    }
  }

  /**
   * Convert trading pair format to BingX symbol format (both use BTC-USDT format)
   * @param {string} pair - Trading pair
   * @returns {string} BingX symbol
   */
  convertPairToSymbol(pair) {
    // BingX uses the dash format, same as our internal format
    return pair; // BTC-USDT stays BTC-USDT
  }

  /**
   * Convert BingX symbol format to our trading pair format
   * @param {string} symbol - BingX symbol
   * @returns {string} Trading pair
   */
  convertSymbolToPair(symbol) {
    return symbol; // Same format
  }

  /**
   * Get current market data for a symbol
   * @param {string} pair - Trading pair
   * @returns {Promise<Object>} Current ticker data
   */
  async getCurrentPrice(pair) {
    try {
      const symbol = this.convertPairToSymbol(pair);
      return await this.bingxClient.getTicker(symbol);
    } catch (error) {
      logger.error(`Failed to get current price for ${pair}:`, error);
      return null;
    }
  }

  /**
   * Get account balance information
   * @returns {Promise<Object>} Account data
   */
  async getAccountInfo() {
    try {
      return await this.bingxClient.getAccountInfo();
    } catch (error) {
      logger.error('Failed to get account info:', error);
      return null;
    }
  }

  /**
   * Check service health
   * @returns {Object} Health status
   */
  getHealthStatus() {
    return {
      connected: this.isConnected,
      subscribedPairs: Array.from(this.subscribedPairs),
      wsConnected: this.bingxClient.ws && this.bingxClient.ws.readyState === 1
    };
  }

  /**
   * Shutdown the market data service
   */
  async shutdown() {
    try {
      logger.info('Shutting down Market Data Service...');
      
      this.bingxClient.closeWebSocket();
      this.isConnected = false;
      this.subscribedPairs.clear();
      
      logger.info('✅ Market Data Service shutdown complete');
    } catch (error) {
      logger.error('Error during Market Data Service shutdown:', error);
    }
  }
}

module.exports = MarketDataService;
