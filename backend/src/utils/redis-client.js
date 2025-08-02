const Redis = require('ioredis');
const config = require('./config');
const logger = require('./logger');

class RedisClient {
  constructor() {
    this.client = null;
    this.subscriber = null;
    this.publisher = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      // Main Redis client
      this.client = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        retryDelayOnFailover: config.redis.retryDelayOnFailover,
        maxRetriesPerRequest: config.redis.maxRetriesPerRequest,
        lazyConnect: config.redis.lazyConnect
      });

      // Subscriber for real-time updates
      this.subscriber = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password
      });

      // Publisher for broadcasting events
      this.publisher = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password
      });

      // Event handlers
      this.client.on('connect', () => {
        logger.info('Redis client connected');
        this.isConnected = true;
      });

      this.client.on('error', (err) => {
        logger.error('Redis client error:', err);
        this.isConnected = false;
      });

      this.client.on('close', () => {
        logger.warn('Redis client connection closed');
        this.isConnected = false;
      });

      // Test connection
      await this.client.ping();
      logger.info('✅ Redis connection established');

      // Initialize time series for trading data
      await this.initializeTimeSeries();

      return this;
    } catch (error) {
      logger.error('Failed to connect to Redis:', error);
      throw error;
    }
  }

  async initializeTimeSeries() {
    try {
      const timeSeries = [
        'prices:BTC-USDT',
        'prices:ETH-USDT', 
        'prices:SOL-USD',
        'prices:AVAX-USD',
        'rsi:BTC-USDT',
        'rsi:ETH-USDT',
        'rsi:SOL-USD', 
        'rsi:AVAX-USD',
        'volume:BTC-USDT',
        'volume:ETH-USDT',
        'volume:SOL-USD',
        'volume:AVAX-USD',
        'divergences:signals',
        'trades:executed',
        'portfolio:balance',
        'portfolio:pnl'
      ];

      for (const series of timeSeries) {
        try {
          // Try to create time series (will fail if exists)
          await this.client.call('TS.CREATE', series, 
            'RETENTION', 86400000, 
            'DUPLICATE_POLICY', 'LAST',
            'LABELS', 'type', 'trading');
        } catch (error) {
          // Series already exists, which is fine
          if (!error.message.includes('TSDB: key already exists')) {
            logger.warn(`Time series ${series}:`, error.message);
          }
        }
      }

      logger.info('✅ Time series initialized');
    } catch (error) {
      logger.error('Failed to initialize time series:', error);
    }
  }

  // Price data methods
  async setPriceData(pair, timestamp, price, volume) {
    try {
      const pipeline = this.client.pipeline();
      
      pipeline.call('TS.ADD', `prices:${pair}`, timestamp, price);
      pipeline.call('TS.ADD', `volume:${pair}`, timestamp, volume);
      
      await pipeline.exec();
    } catch (error) {
      logger.error(`Failed to set price data for ${pair}:`, error);
    }
  }

  async getPriceHistory(pair, fromTimestamp, toTimestamp) {
    try {
      const result = await this.client.call('TS.RANGE', `prices:${pair}`, fromTimestamp, toTimestamp);
      return result.map(([timestamp, value]) => ({
        timestamp: parseInt(timestamp),
        price: parseFloat(value)
      }));
    } catch (error) {
      logger.error(`Failed to get price history for ${pair}:`, error);
      return [];
    }
  }

  // RSI data methods
  async setRSIData(pair, timestamp, rsi) {
    try {
      await this.client.call('TS.ADD', `rsi:${pair}`, timestamp, rsi);
    } catch (error) {
      logger.error(`Failed to set RSI data for ${pair}:`, error);
    }
  }

  async getRSIHistory(pair, fromTimestamp, toTimestamp) {
    try {
      const result = await this.client.call('TS.RANGE', `rsi:${pair}`, fromTimestamp, toTimestamp);
      return result.map(([timestamp, value]) => ({
        timestamp: parseInt(timestamp),
        rsi: parseFloat(value)
      }));
    } catch (error) {
      logger.error(`Failed to get RSI history for ${pair}:`, error);
      return [];
    }
  }

  // Divergence signals
  async storeDivergenceSignal(signal) {
    try {
      const signalData = {
        id: signal.id,
        pair: signal.pair,
        type: signal.type, // 'bullish' or 'bearish'
        strength: signal.strength,
        timestamp: signal.timestamp,
        pricePoints: signal.pricePoints,
        rsiPoints: signal.rsiPoints,
        volumeConfirmed: signal.volumeConfirmed
      };

      await this.client.hset(`divergence:${signal.id}`, signalData);
      await this.client.expire(`divergence:${signal.id}`, 3600); // Expire in 1 hour
      
      // Add to signals time series
      await this.client.call('TS.ADD', 'divergences:signals', signal.timestamp, signal.strength);
      
      logger.info(`Stored divergence signal: ${signal.type} for ${signal.pair}`);
    } catch (error) {
      logger.error('Failed to store divergence signal:', error);
    }
  }

  async getDivergenceSignals(pair, limit = 10) {
    try {
      const pattern = pair ? `divergence:*${pair}*` : 'divergence:*';
      const keys = await this.client.keys(pattern);
      
      const signals = [];
      for (const key of keys.slice(0, limit)) {
        const signal = await this.client.hgetall(key);
        if (signal.id) {
          signals.push({
            ...signal,
            strength: parseFloat(signal.strength),
            timestamp: parseInt(signal.timestamp),
            pricePoints: JSON.parse(signal.pricePoints || '[]'),
            rsiPoints: JSON.parse(signal.rsiPoints || '[]'),
            volumeConfirmed: signal.volumeConfirmed === 'true'
          });
        }
      }
      
      return signals.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      logger.error('Failed to get divergence signals:', error);
      return [];
    }
  }

  // Trading data
  async storeTradeData(trade) {
    try {
      await this.client.hset(`trade:${trade.id}`, {
        id: trade.id,
        pair: trade.pair,
        side: trade.side,
        size: trade.size,
        price: trade.price,
        timestamp: trade.timestamp,
        status: trade.status,
        divergenceSignalId: trade.divergenceSignalId || ''
      });

      // Add to trades time series
      await this.client.call('TS.ADD', 'trades:executed', trade.timestamp, trade.size);
      
      logger.info(`Stored trade: ${trade.side} ${trade.size} ${trade.pair} @ ${trade.price}`);
    } catch (error) {
      logger.error('Failed to store trade data:', error);
    }
  }

  // Portfolio tracking
  async updatePortfolioBalance(balance, pnl, timestamp) {
    try {
      await this.client.call('TS.ADD', 'portfolio:balance', timestamp, balance);
      await this.client.call('TS.ADD', 'portfolio:pnl', timestamp, pnl);
      
      await this.client.hset('portfolio:current', {
        balance: balance,
        pnl: pnl,
        lastUpdate: timestamp
      });
    } catch (error) {
      logger.error('Failed to update portfolio balance:', error);
    }
  }

  async getPortfolioBalance() {
    try {
      const data = await this.client.hgetall('portfolio:current');
      return {
        balance: parseFloat(data.balance || 0),
        pnl: parseFloat(data.pnl || 0),
        lastUpdate: parseInt(data.lastUpdate || 0)
      };
    } catch (error) {
      logger.error('Failed to get portfolio balance:', error);
      return { balance: 0, pnl: 0, lastUpdate: 0 };
    }
  }

  // PubSub methods
  async subscribe(channel, callback) {
    try {
      await this.subscriber.subscribe(channel);
      this.subscriber.on('message', (receivedChannel, message) => {
        if (receivedChannel === channel) {
          try {
            const data = JSON.parse(message);
            callback(data);
          } catch (error) {
            callback(message);
          }
        }
      });
      
      logger.info(`Subscribed to channel: ${channel}`);
    } catch (error) {
      logger.error(`Failed to subscribe to ${channel}:`, error);
    }
  }

  async publish(channel, data) {
    try {
      const message = typeof data === 'string' ? data : JSON.stringify(data);
      await this.publisher.publish(channel, message);
    } catch (error) {
      logger.error(`Failed to publish to ${channel}:`, error);
    }
  }

  // Health check
  async healthCheck() {
    try {
      const response = await this.client.ping();
      return response === 'PONG';
    } catch (error) {
      logger.error('Redis health check failed:', error);
      return false;
    }
  }

  async disconnect() {
    try {
      if (this.client) {
        await this.client.quit();
      }
      if (this.subscriber) {
        await this.subscriber.quit();
      }
      if (this.publisher) {
        await this.publisher.quit();
      }
      
      this.isConnected = false;
      logger.info('Redis connections closed');
    } catch (error) {
      logger.error('Error disconnecting from Redis:', error);
    }
  }

  // Generic Redis operations for backtesting
  async set(key, value) {
    try {
      return await this.client.set(key, value);
    } catch (error) {
      logger.error(`Failed to set key ${key}:`, error);
      throw error;
    }
  }

  async get(key) {
    try {
      return await this.client.get(key);
    } catch (error) {
      logger.error(`Failed to get key ${key}:`, error);
      throw error;
    }
  }

  async keys(pattern) {
    try {
      return await this.client.keys(pattern);
    } catch (error) {
      logger.error(`Failed to get keys with pattern ${pattern}:`, error);
      throw error;
    }
  }
}

// Create singleton instance
const redisClient = new RedisClient();

module.exports = redisClient;
