const axios = require('axios');
const crypto = require('crypto');
const WebSocket = require('ws');
const zlib = require('zlib');
const logger = require('./logger');
const config = require('./config');

class BingXClient {
  constructor() {
    this.apiKey = config.apis.bingx.apiKey;
    this.secretKey = config.apis.bingx.secretKey;
    this.baseURL = config.apis.bingx.baseURL;
    this.ws = null;
    this.reconnectInterval = null;
    this.subscriptions = new Set();
    this.callbacks = new Map();
  }

  /**
   * Generate signature for BingX API requests
   * @param {string} queryString - Query parameters as string
   * @returns {string} HMAC signature
   */
  generateSignature(queryString) {
    return crypto
      .createHmac('sha256', this.secretKey)
      .update(queryString)
      .digest('hex');
  }

  /**
   * Make authenticated API request to BingX
   * @param {string} endpoint - API endpoint
   * @param {string} method - HTTP method
   * @param {Object} params - Request parameters
   * @returns {Promise<Object>} API response
   */
  async makeRequest(endpoint, method = 'GET', params = {}) {
    try {
      const timestamp = Date.now();
      
      // Build query string manually for BingX format
      let queryString = '';
      for (const key in params) {
        if (queryString) queryString += '&';
        queryString += `${key}=${encodeURIComponent(params[key])}`;
      }
      
      // Add timestamp
      if (queryString) queryString += '&';
      queryString += `timestamp=${timestamp}`;

      const signature = this.generateSignature(queryString);
      const url = `${this.baseURL}${endpoint}?${queryString}&signature=${signature}`;

      const headers = {
        'X-BX-APIKEY': this.apiKey,
        'Content-Type': 'application/json'
      };

      console.log(`🔗 BingX Request: ${method} ${endpoint}`);
      console.log(`📊 Parameters: ${queryString}`);

      const response = await axios({
        method,
        url,
        headers,
        timeout: 15000  // Increased timeout
      });

      console.log(`✅ BingX Response: ${response.status}`);
      return response.data;
    } catch (error) {
      console.error(`❌ BingX API request failed: ${endpoint}`);
      console.error(`Error:`, error.response?.data || error.message);
      logger.error(`BingX API request failed: ${endpoint}`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get account information
   * @returns {Promise<Object>} Account data
   */
  async getAccountInfo() {
    try {
      return await this.makeRequest('/openApi/spot/v1/account');
    } catch (error) {
      logger.error('Failed to get BingX account info:', error);
      throw error;
    }
  }

  /**
   * Get kline/candlestick data
   * @param {string} symbol - Trading symbol (e.g., 'VST-USDT')
   * @param {string} interval - Time interval (1m, 5m, 15m, 1h, etc.)
   * @param {number} limit - Number of candles to retrieve
   * @returns {Promise<Array>} Kline data
   */
  async getKlines(symbol, interval = '1m', limit = 100) {
    try {
      // Add current timestamp to ensure we get the most recent data
      const endTime = Date.now();
      
      const params = {
        symbol: symbol,
        interval: interval,
        limit: limit,
        endTime: endTime  // Force fresh data by specifying end time
      };

      logger.info(`Fetching fresh klines for ${symbol} ${interval} (limit: ${limit}, endTime: ${new Date(endTime).toISOString()})`);
      
      const response = await this.makeRequest('/openApi/spot/v1/market/kline', 'GET', params);
      
      if (response.code === 0 && response.data) {
        logger.info(`BingX returned ${response.data.length} candles for ${symbol} ${interval}`);
        if (response.data.length > 0) {
          const firstCandle = response.data[0];
          const lastCandle = response.data[response.data.length - 1];
          logger.info(`Data range: ${new Date(parseInt(firstCandle[0])).toISOString()} to ${new Date(parseInt(lastCandle[0])).toISOString()}`);
          logger.info(`Latest close price: ${lastCandle[4]}`);
        }
        
        // Sort by timestamp to ensure correct chronological order
        const sortedData = response.data.sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
        
        return sortedData.map(candle => ({
          timestamp: parseInt(candle[0]),
          open: parseFloat(candle[1]),
          high: parseFloat(candle[2]),
          low: parseFloat(candle[3]),
          close: parseFloat(candle[4]),
          volume: parseFloat(candle[5])
        }));
      }

      logger.warn(`No data returned from BingX for ${symbol} ${interval}`);
      return [];
    } catch (error) {
      logger.error(`Failed to get BingX klines for ${symbol}:`, error);
      return [];
    }
  }

  /**
   * Get current ticker price
   * @param {string} symbol - Trading symbol
   * @returns {Promise<Object>} Ticker data
   */
  async getTicker(symbol) {
    try {
      const params = { symbol };
      const response = await this.makeRequest('/openApi/spot/v1/ticker/24hr', 'GET', params);
      
      if (response.code === 0 && response.data) {
        return {
          symbol: response.data.symbol,
          price: parseFloat(response.data.lastPrice),
          volume: parseFloat(response.data.volume),
          change: parseFloat(response.data.priceChangePercent)
        };
      }

      return null;
    } catch (error) {
      logger.error(`Failed to get BingX ticker for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get all available trading symbols
   * @returns {Promise<Array>} List of symbols
   */
  async getExchangeInfo() {
    try {
      const response = await this.makeRequest('/openApi/spot/v1/common/symbols', 'GET');
      
      if (response.code === 0 && response.data && response.data.symbols) {
        return response.data.symbols.map(symbol => ({
          symbol: symbol.symbol,
          baseAsset: symbol.baseAsset,
          quoteAsset: symbol.quoteAsset,
          status: symbol.status
        }));
      }

      return [];
    } catch (error) {
      logger.error('Failed to get BingX exchange info:', error);
      return [];
    }
  }

  /**
   * Initialize WebSocket connection for real-time data
   * @param {Array} symbols - Symbols to subscribe to
   * @param {Function} onMessage - Callback for incoming messages
   */
  initWebSocket(symbols = ['VST-USDT'], onMessage) {
    try {
      const wsUrl = 'wss://open-api-ws.bingx.com/market';
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        logger.info('BingX WebSocket connected');
        
        // Subscribe to kline streams for each symbol
        symbols.forEach(symbol => {
          const subscription = {
            id: Date.now(),
            reqType: 'sub',
            dataType: `${symbol}@kline_1m`
          };
          
          this.ws.send(JSON.stringify(subscription));
          this.subscriptions.add(symbol);
          logger.info(`Subscribed to BingX ${symbol} kline stream`);
        });
      });

      this.ws.on('message', (data) => {
        try {
          let messageData;
          
          // Check if data is compressed (gzip)
          if (data[0] === 0x1f && data[1] === 0x8b) {
            // Data is gzipped, decompress it
            messageData = zlib.gunzipSync(data).toString();
          } else {
            // Data is not compressed
            messageData = data.toString();
          }
          
          const message = JSON.parse(messageData);
          
          if (message.dataType && message.dataType.includes('kline')) {
            const klineData = message.data;
            if (klineData && klineData.k) {
              const candle = {
                symbol: klineData.s,
                timestamp: parseInt(klineData.k.t),
                open: parseFloat(klineData.k.o),
                high: parseFloat(klineData.k.h),
                low: parseFloat(klineData.k.l),
                close: parseFloat(klineData.k.c),
                volume: parseFloat(klineData.k.v),
                isFinal: klineData.k.x // true when kline is closed
              };

              if (onMessage) {
                onMessage(candle);
              }
            }
          }
        } catch (error) {
          logger.error('Error processing BingX WebSocket message:', error);
        }
      });

      this.ws.on('error', (error) => {
        logger.error('BingX WebSocket error:', error);
      });

      this.ws.on('close', () => {
        logger.warn('BingX WebSocket closed, attempting to reconnect...');
        this.scheduleReconnect(symbols, onMessage);
      });

    } catch (error) {
      logger.error('Failed to initialize BingX WebSocket:', error);
    }
  }

  /**
   * Schedule WebSocket reconnection
   * @param {Array} symbols - Symbols to subscribe to
   * @param {Function} onMessage - Callback for incoming messages
   */
  scheduleReconnect(symbols, onMessage) {
    if (this.reconnectInterval) {
      clearTimeout(this.reconnectInterval);
    }

    this.reconnectInterval = setTimeout(() => {
      logger.info('Reconnecting to BingX WebSocket...');
      this.initWebSocket(symbols, onMessage);
    }, 5000); // Reconnect after 5 seconds
  }

  /**
   * Close WebSocket connection
   */
  closeWebSocket() {
    if (this.reconnectInterval) {
      clearTimeout(this.reconnectInterval);
      this.reconnectInterval = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.subscriptions.clear();
    logger.info('BingX WebSocket connection closed');
  }

  /**
   * Test connection and API credentials
   * @returns {Promise<boolean>} Connection status
   */
  async testConnection() {
    try {
      logger.info('Testing BingX API connection...');
      
      // Test public endpoint first
      const exchangeInfo = await this.getExchangeInfo();
      if (exchangeInfo.length === 0) {
        throw new Error('Failed to get exchange info');
      }

      // Test authenticated endpoint
      const accountInfo = await this.getAccountInfo();
      if (!accountInfo) {
        throw new Error('Failed to get account info');
      }

      logger.info('✅ BingX API connection successful');
      logger.info(`Available symbols: ${exchangeInfo.length}`);
      
      return true;
    } catch (error) {
      logger.error('❌ BingX API connection failed:', error.message);
      return false;
    }
  }

  /**
   * Get VST trading pairs
   * @returns {Promise<Array>} VST pairs
   */
  async getVSTpairs() {
    try {
      const symbols = await this.getExchangeInfo();
      
      // Look for VST in symbol names (more flexible search)
      const vstPairs = symbols.filter(s => 
        s.symbol.includes('VST') || s.baseAsset === 'VST' || s.quoteAsset === 'VST'
      );

      logger.info(`Found ${vstPairs.length} VST trading pairs`);
      logger.info(`Available VST pairs: ${vstPairs.map(s => s.symbol).join(', ')}`);
      return vstPairs;
    } catch (error) {
      logger.error('Failed to get VST pairs:', error);
      return [];
    }
  }
}

module.exports = BingXClient;
