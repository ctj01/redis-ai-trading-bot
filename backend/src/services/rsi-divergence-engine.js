const uuid = require('uuid');
const technicalIndicators = require('../utils/technical-indicators');
const redisClient = require('../utils/redis-client');
const logger = require('../utils/logger');
const config = require('../utils/config');
const BingXClient = require('../utils/bingx-client');

class RSIDivergenceEngine {
  constructor() {
    this.divergenceBuffer = new Map(); // Store recent divergences
    this.priceData = new Map(); // Store price data by pair
    this.rsiData = new Map(); // Store RSI data by pair
    this.volumeData = new Map(); // Store volume data by pair
    this.bingxClient = new BingXClient();
  }

  /**
   * Initialize the RSI divergence engine
   */
  async initialize() {
    try {
      logger.info('Initializing RSI Divergence Engine...');
      
      // Load historical data for configured trading pairs
      for (const pair of config.trading.tradingPairs) {
        await this.loadHistoricalData(pair);
      }

      logger.info('✅ RSI Divergence Engine initialized');
    } catch (error) {
      logger.error('Failed to initialize RSI Divergence Engine:', error);
      throw error;
    }
  }

  /**
   * Load historical data for a trading pair
   * @param {string} pair - Trading pair (e.g., 'BTC-USD')
   */
  async loadHistoricalData(pair) {
    try {
      // For now, we'll initialize with empty arrays
      // In production, this would load from exchange APIs or database
      this.priceData.set(pair, []);
      this.rsiData.set(pair, []);
      this.volumeData.set(pair, []);

      logger.info(`Historical data loaded for ${pair}`);
    } catch (error) {
      logger.error(`Failed to load historical data for ${pair}:`, error);
    }
  }

  /**
   * Update price and volume data for a trading pair
   * @param {string} pair - Trading pair
   * @param {Object} candle - OHLCV candle data
   */
  async updateMarketData(pair, candle) {
    try {
      const { timestamp, open, high, low, close, volume } = candle;
      
      // Update price data
      const pricePoint = { timestamp, price: close };
      const prices = this.priceData.get(pair) || [];
      prices.push(pricePoint);
      
      // Keep only last 1000 candles in memory
      if (prices.length > config.performance.maxCandlesInMemory) {
        prices.shift();
      }
      this.priceData.set(pair, prices);

      // Update volume data
      const volumePoint = { timestamp, volume, high, low };
      const volumes = this.volumeData.get(pair) || [];
      volumes.push(volumePoint);
      
      if (volumes.length > config.performance.maxCandlesInMemory) {
        volumes.shift();
      }
      this.volumeData.set(pair, volumes);

      // Calculate and update RSI
      await this.updateRSI(pair);

      // Store in Redis for persistence
      await redisClient.setPriceData(pair, timestamp, close, volume);

      // Check for divergences
      await this.detectDivergences(pair);

    } catch (error) {
      logger.error(`Failed to update market data for ${pair}:`, error);
    }
  }

  /**
   * Calculate and update RSI for a trading pair
   * @param {string} pair - Trading pair
   */
  async updateRSI(pair) {
    try {
      const prices = this.priceData.get(pair) || [];
      
      if (prices.length < config.strategy.rsiPeriod + 1) {
        return; // Not enough data yet
      }

      // Extract closing prices
      const closePrices = prices.map(p => p.price);
      
      // Calculate RSI
      const rsiValues = technicalIndicators.calculateRSI(closePrices, config.strategy.rsiPeriod);
      
      if (rsiValues.length === 0) {
        return;
      }

      // Get the latest RSI value
      const latestRSI = rsiValues[rsiValues.length - 1];
      const latestTimestamp = prices[prices.length - 1].timestamp;

      // Update RSI data
      const rsiPoint = { timestamp: latestTimestamp, rsi: latestRSI };
      const rsiHistory = this.rsiData.get(pair) || [];
      rsiHistory.push(rsiPoint);
      
      if (rsiHistory.length > config.performance.maxCandlesInMemory) {
        rsiHistory.shift();
      }
      this.rsiData.set(pair, rsiHistory);

      // Store in Redis
      await redisClient.setRSIData(pair, latestTimestamp, latestRSI);

      logger.debug(`RSI updated for ${pair}: ${latestRSI.toFixed(2)}`);

    } catch (error) {
      logger.error(`Failed to update RSI for ${pair}:`, error);
    }
  }

  /**
   * Detect RSI divergences for a trading pair - IMPROVED VERSION
   * @param {string} pair - Trading pair
   */
  async detectDivergences(pair) {
    try {
      const prices = this.priceData.get(pair) || [];
      const rsiData = this.rsiData.get(pair) || [];

      if (prices.length < 20 || rsiData.length < 20) {
        return; // Need at least 20 points for reliable divergence detection
      }

      // Use recent data (last 50 points for analysis)
      const recentPrices = prices.slice(-50);
      const recentRSI = rsiData.slice(-50);

      // Find local extremes with smaller lookback for more sensitivity
      const priceExtremes = this.findLocalExtremes(recentPrices, 2);
      const rsiExtremes = this.findRSIExtremes(recentRSI, 2);

      // Check for bullish divergences (price down, RSI up)
      await this.checkBullishDivergences(pair, priceExtremes.lows, rsiExtremes.lows);

      // Check for bearish divergences (price up, RSI down)
      await this.checkBearishDivergences(pair, priceExtremes.highs, rsiExtremes.highs);

    } catch (error) {
      logger.error(`Failed to detect divergences for ${pair}:`, error);
    }
  }

  /**
   * Check for bullish RSI divergences - FIXED LOGIC
   * @param {string} pair - Trading pair
   * @param {Array} priceLows - Price low points
   * @param {Array} rsiLows - RSI low points
   */
  async checkBullishDivergences(pair, priceLows, rsiLows) {
    try {
      if (priceLows.length < 2 || rsiLows.length < 2) {
        return;
      }

      // Get the two most recent lows
      const recentPriceLows = priceLows.slice(-2);
      const recentRSILows = rsiLows.slice(-2);

      for (let i = 0; i < recentPriceLows.length - 1; i++) {
        for (let j = i + 1; j < recentPriceLows.length; j++) {
          const priceLow1 = recentPriceLows[i];
          const priceLow2 = recentPriceLows[j];

          // Find corresponding RSI lows (within reasonable time frame)
          const rsiLow1 = this.findCorrespondingRSI(rsiLows, priceLow1.timestamp);
          const rsiLow2 = this.findCorrespondingRSI(rsiLows, priceLow2.timestamp);

          if (!rsiLow1 || !rsiLow2) continue;

          // BULLISH DIVERGENCE: Price makes lower low, RSI makes higher low
          const priceMakesLowerLow = priceLow2.price < priceLow1.price;
          const rsiMakesHigherLow = rsiLow2.rsi > rsiLow1.rsi;

          if (priceMakesLowerLow && rsiMakesHigherLow) {
            // Calculate divergence strength
            const priceChange = Math.abs((priceLow2.price - priceLow1.price) / priceLow1.price);
            const rsiChange = Math.abs(rsiLow2.rsi - rsiLow1.rsi);
            const strength = Math.min(1, (priceChange * 100 + rsiChange) / 20);

            if (strength >= 0.1) { // Lower threshold for testing
              const divergence = {
                id: uuid.v4(),
                pair: pair,
                type: 'bullish',
                strength: strength,
                timestamp: priceLow2.timestamp,
                pricePoints: [priceLow1, priceLow2],
                rsiPoints: [rsiLow1, rsiLow2],
                signal: 'BUY',
                confidence: this.calculateConfidence(priceChange, rsiChange)
              };

              await this.processDivergenceSignal(divergence);
            }
          }
        }
      }

    } catch (error) {
      logger.error(`Failed to check bullish divergences for ${pair}:`, error);
    }
  }

  /**
   * Check for bearish RSI divergences - FIXED LOGIC
   * @param {string} pair - Trading pair
   * @param {Array} priceHighs - Price high points
   * @param {Array} rsiHighs - RSI high points
   */
  async checkBearishDivergences(pair, priceHighs, rsiHighs) {
    try {
      if (priceHighs.length < 2 || rsiHighs.length < 2) {
        return;
      }

      // Get the two most recent highs
      const recentPriceHighs = priceHighs.slice(-2);
      const recentRSIHighs = rsiHighs.slice(-2);

      for (let i = 0; i < recentPriceHighs.length - 1; i++) {
        for (let j = i + 1; j < recentPriceHighs.length; j++) {
          const priceHigh1 = recentPriceHighs[i];
          const priceHigh2 = recentPriceHighs[j];

          // Find corresponding RSI highs
          const rsiHigh1 = this.findCorrespondingRSI(rsiHighs, priceHigh1.timestamp);
          const rsiHigh2 = this.findCorrespondingRSI(rsiHighs, priceHigh2.timestamp);

          if (!rsiHigh1 || !rsiHigh2) continue;

          // BEARISH DIVERGENCE: Price makes higher high, RSI makes lower high
          const priceMakesHigherHigh = priceHigh2.price > priceHigh1.price;
          const rsiMakesLowerHigh = rsiHigh2.rsi < rsiHigh1.rsi;

          if (priceMakesHigherHigh && rsiMakesLowerHigh) {
            // Calculate divergence strength
            const priceChange = Math.abs((priceHigh2.price - priceHigh1.price) / priceHigh1.price);
            const rsiChange = Math.abs(rsiHigh2.rsi - rsiHigh1.rsi);
            const strength = Math.min(1, (priceChange * 100 + rsiChange) / 20);

            if (strength >= 0.1) { // Lower threshold for testing
              const divergence = {
                id: uuid.v4(),
                pair: pair,
                type: 'bearish',
                strength: strength,
                timestamp: priceHigh2.timestamp,
                pricePoints: [priceHigh1, priceHigh2],
                rsiPoints: [rsiHigh1, rsiHigh2],
                signal: 'SELL',
                confidence: this.calculateConfidence(priceChange, rsiChange)
              };

              await this.processDivergenceSignal(divergence);
            }
          }
        }
      }

    } catch (error) {
      logger.error(`Failed to check bearish divergences for ${pair}:`, error);
    }
  }

  /**
   * Check volume confirmation for divergence
   * @param {string} pair - Trading pair
   * @param {number} timestamp - Timestamp to check
   * @param {string} type - Divergence type ('bullish' or 'bearish')
   * @returns {boolean} Whether volume confirms the divergence
   */
  async checkVolumeConfirmation(pair, timestamp, type) {
    try {
      const volumes = this.volumeData.get(pair) || [];
      
      if (volumes.length < config.strategy.volumeMAPeriod) {
        return false; // Not enough volume data
      }

      // Find the volume at the divergence point
      const divergenceVolume = volumes.find(v => Math.abs(v.timestamp - timestamp) < 60000); // Within 1 minute
      
      if (!divergenceVolume) {
        return false;
      }

      // Calculate volume moving average
      const recentVolumes = volumes.slice(-config.strategy.volumeMAPeriod).map(v => v.volume);
      const volumeMA = technicalIndicators.calculateSMA(recentVolumes, config.strategy.volumeMAPeriod);
      
      if (volumeMA.length === 0) {
        return false;
      }

      const avgVolume = volumeMA[volumeMA.length - 1];
      const volumeRatio = divergenceVolume.volume / avgVolume;

      // Volume should be at least 1.5x average for confirmation
      const confirmed = volumeRatio >= 1.5;

      logger.debug(`Volume confirmation for ${pair} ${type} divergence: ${confirmed} (ratio: ${volumeRatio.toFixed(2)})`);

      return confirmed;

    } catch (error) {
      logger.error(`Failed to check volume confirmation for ${pair}:`, error);
      return false;
    }
  }

  /**
   * Find local extremes in price data - IMPROVED
   * @param {Array} data - Price data points
   * @param {number} lookback - Lookback period
   * @returns {Object} Object with highs and lows arrays
   */
  findLocalExtremes(data, lookback = 2) {
    const highs = [];
    const lows = [];

    for (let i = lookback; i < data.length - lookback; i++) {
      const current = data[i];
      let isHigh = true;
      let isLow = true;

      // Check if current point is a local extreme
      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j !== i) {
          if (data[j].price >= current.price) {
            isHigh = false;
          }
          if (data[j].price <= current.price) {
            isLow = false;
          }
        }
      }

      if (isHigh) {
        highs.push({
          index: i,
          timestamp: current.timestamp,
          price: current.price
        });
      }

      if (isLow) {
        lows.push({
          index: i,
          timestamp: current.timestamp,
          price: current.price
        });
      }
    }

    return { highs, lows };
  }

  /**
   * Find RSI extremes - IMPROVED
   * @param {Array} rsiData - RSI data points
   * @param {number} lookback - Lookback period
   * @returns {Object} Object with highs and lows arrays
   */
  findRSIExtremes(rsiData, lookback = 2) {
    const highs = [];
    const lows = [];

    for (let i = lookback; i < rsiData.length - lookback; i++) {
      const current = rsiData[i];
      let isHigh = true;
      let isLow = true;

      // Check if current point is a local RSI extreme
      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j !== i) {
          if (rsiData[j].rsi >= current.rsi) {
            isHigh = false;
          }
          if (rsiData[j].rsi <= current.rsi) {
            isLow = false;
          }
        }
      }

      if (isHigh) {
        highs.push({
          index: i,
          timestamp: current.timestamp,
          rsi: current.rsi
        });
      }

      if (isLow) {
        lows.push({
          index: i,
          timestamp: current.timestamp,
          rsi: current.rsi
        });
      }
    }

    return { highs, lows };
  }

  /**
   * Find corresponding RSI value for a given timestamp
   * @param {Array} rsiData - RSI data array
   * @param {number} timestamp - Target timestamp
   * @returns {Object|null} Corresponding RSI point
   */
  findCorrespondingRSI(rsiData, timestamp) {
    // Find RSI point within 5 minutes of the price timestamp
    const tolerance = 5 * 60 * 1000; // 5 minutes in milliseconds
    
    return rsiData.find(rsi => 
      Math.abs(rsi.timestamp - timestamp) <= tolerance
    );
  }

  /**
   * Calculate confidence score for divergence
   * @param {number} priceChange - Price change percentage
   * @param {number} rsiChange - RSI change
   * @returns {number} Confidence score (0-1)
   */
  calculateConfidence(priceChange, rsiChange) {
    // Higher price change + higher RSI change = higher confidence
    const normalizedPriceChange = Math.min(1, priceChange * 10);
    const normalizedRSIChange = Math.min(1, rsiChange / 20);
    
    return (normalizedPriceChange + normalizedRSIChange) / 2;
  }

  /**
   * Process a detected divergence signal
   * @param {Object} divergence - Divergence signal data
   */
  async processDivergenceSignal(divergence) {
    try {
      // Store in memory buffer
      this.divergenceBuffer.set(divergence.id, divergence);

      // Store in Redis
      await redisClient.storeDivergenceSignal(divergence);

      // Log the divergence
      logger.divergence(`${divergence.type.toUpperCase()} divergence detected for ${divergence.pair}`, {
        strength: divergence.strength,
        volumeConfirmed: divergence.volumeConfirmed,
        pricePoints: divergence.pricePoints.map(p => p.price),
        rsiPoints: divergence.rsiPoints.map(r => r.rsi)
      });

      // Publish to trading engine
      await redisClient.publish('divergence-signals', {
        type: 'divergence-detected',
        data: divergence
      });

      // Clean up old divergences (keep last 100)
      if (this.divergenceBuffer.size > 100) {
        const oldest = Array.from(this.divergenceBuffer.keys())[0];
        this.divergenceBuffer.delete(oldest);
      }

    } catch (error) {
      logger.error('Failed to process divergence signal:', error);
    }
  }

  /**
   * Get recent divergences for a trading pair
   * @param {string} pair - Trading pair
   * @param {number} limit - Maximum number of divergences to return
   * @param {string} timeframe - Timeframe for analysis (5m, 1h, 4h, 1d)
   * @returns {Array} Recent divergences
   */
  async getRecentDivergences(pair, limit = 10, timeframe = '1h') {
    try {
      // First, try to get from existing buffer
      let divergences = Array.from(this.divergenceBuffer.values())
        .filter(d => d.pair === pair)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit);

      // If we don't have enough divergences, try to detect new ones with the timeframe data
      if (divergences.length < Math.min(limit, 5)) {
        logger.info(`Limited divergences found, analyzing ${timeframe} timeframe for ${pair}`);
        await this.analyzeTimeframeForDivergences(pair, timeframe);
        
        // Try again after analysis
        divergences = Array.from(this.divergenceBuffer.values())
          .filter(d => d.pair === pair)
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, limit);
      }

      // Add timeframe info to each divergence for UI display
      const enrichedDivergences = divergences.map(d => ({
        ...d,
        timeframe: timeframe
      }));

      logger.info(`Found ${enrichedDivergences.length} divergences for ${pair} on ${timeframe} timeframe`);
      return enrichedDivergences;
    } catch (error) {
      logger.error(`Failed to get recent divergences for ${pair}:`, error);
      return [];
    }
  }

  /**
   * Analyze a specific timeframe for divergences
   * @param {string} pair - Trading pair
   * @param {string} timeframe - Timeframe to analyze
   */
  async analyzeTimeframeForDivergences(pair, timeframe) {
    try {
      const symbol = pair; // BingX uses dash format: BTC-USDT
      const klines = await this.bingxClient.getKlines(symbol, timeframe, 100);
      
      if (!klines || klines.length < 20) {
        logger.warn(`Insufficient data for divergence analysis: ${klines?.length || 0} candles`);
        return;
      }

      // Process the historical data to look for divergences
      const closePrices = klines.map(k => parseFloat(k.close));
      const rsi = technicalIndicators.calculateRSI(closePrices, 14);
      
      // Simple divergence detection on historical data
      for (let i = 14; i < klines.length - 1; i++) {
        const price1 = closePrices[i - 5];
        const price2 = closePrices[i];
        const rsi1 = rsi[i - 5];
        const rsi2 = rsi[i];
        
        if (price1 && price2 && rsi1 && rsi2) {
          // Check for bullish divergence (price makes lower low, RSI makes higher low)
          if (price2 < price1 && rsi2 > rsi1 && rsi1 < 40) {
            const divergence = {
              id: uuid.v4(),
              pair: pair,
              type: 'bullish',
              timestamp: parseInt(klines[i].openTime),
              price: price2,
              rsi: rsi2,
              strength: Math.abs(rsi2 - rsi1) / 100,
              timeframe: timeframe
            };
            this.divergenceBuffer.set(divergence.id, divergence);
          }
          
          // Check for bearish divergence (price makes higher high, RSI makes lower high)
          if (price2 > price1 && rsi2 < rsi1 && rsi1 > 60) {
            const divergence = {
              id: uuid.v4(),
              pair: pair,
              type: 'bearish',
              timestamp: parseInt(klines[i].openTime),
              price: price2,
              rsi: rsi2,
              strength: Math.abs(rsi1 - rsi2) / 100,
              timeframe: timeframe
            };
            this.divergenceBuffer.set(divergence.id, divergence);
          }
        }
      }
      
    } catch (error) {
      logger.error(`Failed to analyze timeframe for divergences:`, error);
    }
  }

  /**
   * Get current RSI value for a trading pair
   * @param {string} pair - Trading pair
   * @param {string} timeframe - Timeframe for analysis (5m, 1h, 4h, 1d)
   * @returns {number|null} Current RSI value
   */
  async getCurrentRSI(pair, timeframe = '1h') {
    try {
      // Always fetch fresh data from BingX for accurate real-time RSI
      logger.info(`Fetching fresh RSI data for ${pair} on ${timeframe} timeframe`);
      return await this.fetchAndCalculateRSI(pair, timeframe);
      
    } catch (error) {
      logger.error(`Failed to get current RSI for ${pair}:`, error);
      return null;
    }
  }

  /**
   * Fetch historical data and calculate RSI for a specific timeframe
   * @param {string} pair - Trading pair
   * @param {string} timeframe - Timeframe (5m, 1h, 4h, 1d)
   * @returns {number|null} Current RSI value
   */
  async fetchAndCalculateRSI(pair, timeframe) {
    try {
      // BingX uses the dash format (BTC-USDT), so no conversion needed
      const symbol = pair; // Keep original format: BTC-USDT
      
      // Fetch more candles to ensure we have enough data for accurate RSI
      // Use 100 candles to get more historical context
      logger.info(`Fetching ${symbol} klines for ${timeframe} timeframe`);
      const klines = await this.bingxClient.getKlines(symbol, timeframe, 100);
      
      if (!klines || klines.length < 15) {
        logger.warn(`Insufficient data for RSI calculation: ${klines?.length || 0} candles`);
        return null;
      }

      logger.info(`Retrieved ${klines.length} candles for ${symbol}`);
      
      // Sort klines by timestamp to ensure correct order
      klines.sort((a, b) => a.timestamp - b.timestamp);
      
      // Log the most recent candles for debugging
      const recent = klines.slice(-3);
      logger.info(`Recent candles for ${symbol}:`);
      recent.forEach((candle, idx) => {
        const time = new Date(candle.timestamp).toISOString();
        logger.info(`  ${idx + 1}: ${time} - Close: ${candle.close}`);
      });

      // Calculate RSI from the fetched data
      const closePrices = klines.map(k => parseFloat(k.close));
      logger.info(`Close prices (last 5): [${closePrices.slice(-5).join(', ')}]`);
      
      const rsi = technicalIndicators.calculateRSI(closePrices, 14);
      logger.info(`RSI calculation result: ${rsi.length} values`);
      
      if (rsi.length > 0) {
        const currentRSI = rsi[rsi.length - 1];
        const previousRSI = rsi.length > 1 ? rsi[rsi.length - 2] : null;
        
        logger.info(`Current RSI for ${pair} on ${timeframe}: ${currentRSI.toFixed(2)}`);
        if (previousRSI) {
          logger.info(`Previous RSI: ${previousRSI.toFixed(2)}, Change: ${(currentRSI - previousRSI).toFixed(2)}`);
        }
        
        // Store the calculated data for future reference (but always fetch fresh)
        const timeframedKey = `${pair}_${timeframe}`;
        const newRSIData = klines.map((candle, index) => ({
          timestamp: parseInt(candle.timestamp),
          rsi: rsi[index] || null
        })).filter(item => item.rsi !== null);

        this.rsiData.set(timeframedKey, newRSIData);
        
        return currentRSI;
      }
      
      logger.warn(`No RSI values calculated for ${pair}`);
      return null;
      
    } catch (error) {
      logger.error(`Failed to fetch and calculate RSI for ${pair} on ${timeframe}:`, error);
      return null;
    }
  }

  /**
   * Get engine statistics
   * @returns {Object} Engine statistics
   */
  getStatistics() {
    try {
      const stats = {
        divergencesDetected: this.divergenceBuffer.size,
        pairsMonitored: this.priceData.size,
        dataPoints: {}
      };

      for (const [pair, data] of this.priceData.entries()) {
        stats.dataPoints[pair] = {
          pricePoints: data.length,
          rsiPoints: (this.rsiData.get(pair) || []).length,
          volumePoints: (this.volumeData.get(pair) || []).length,
          currentRSI: this.getCurrentRSI(pair)
        };
      }

      return stats;
    } catch (error) {
      logger.error('Failed to get engine statistics:', error);
      return {};
    }
  }
}

module.exports = RSIDivergenceEngine;
