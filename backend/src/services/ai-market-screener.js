// AI Market Screener - Scans multiple pairs for trading opportunities
const ManualTradingEngine = require('./manual-trading-engine');
const logger = require('../utils/logger');

class AIMarketScreener {
  constructor(redisClient) {
    this.redisClient = redisClient;
    this.tradingEngine = new ManualTradingEngine(redisClient);
    
    // Default pairs to monitor
    this.watchlist = [
      'BTC-USDT', 'ETH-USDT', 'BNB-USDT', 'ADA-USDT', 'DOT-USDT',
      'LINK-USDT', 'LTC-USDT', 'BCH-USDT', 'XRP-USDT', 'MATIC-USDT'
    ];
    
    // Timeframes to analyze
    this.timeframes = ['1h', '4h', '1d'];
    
    // Market conditions cache
    this.marketConditions = new Map();
    this.lastScan = null;
  }

  /**
   * Scan all pairs for trading opportunities
   */
  async scanMarket() {
    try {
      logger.info('🔍 Starting AI Market Screener scan...');
      const startTime = Date.now();
      
      const opportunities = [];
      const marketOverview = {
        totalPairs: this.watchlist.length,
        totalTimeframes: this.timeframes.length,
        opportunities: 0,
        highPriority: 0,
        mediumPriority: 0,
        lowPriority: 0,
        marketTrend: 'NEUTRAL',
        volatilityLevel: 'MEDIUM'
      };

      // Parallel scanning for efficiency
      const scanPromises = [];
      
      for (const pair of this.watchlist) {
        for (const timeframe of this.timeframes) {
          scanPromises.push(
            this.analyzePairOpportunity(pair, timeframe)
              .catch(error => {
                logger.warn(`Failed to analyze ${pair} ${timeframe}:`, error.message);
                return null;
              })
          );
        }
      }

      const results = await Promise.allSettled(scanPromises);
      
      // Process results
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          const opportunity = result.value;
          opportunities.push(opportunity);
          
          // Categorize by priority
          if (opportunity.priority === 'HIGH') marketOverview.highPriority++;
          else if (opportunity.priority === 'MEDIUM') marketOverview.mediumPriority++;
          else marketOverview.lowPriority++;
        }
      }

      // Calculate market overview
      marketOverview.opportunities = opportunities.length;
      marketOverview.marketTrend = this.calculateMarketTrend(opportunities);
      marketOverview.volatilityLevel = this.calculateVolatilityLevel(opportunities);

      // Sort by priority and strength
      opportunities.sort((a, b) => {
        const priorityOrder = { 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1 };
        if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
          return priorityOrder[b.priority] - priorityOrder[a.priority];
        }
        return b.strength - a.strength;
      });

      // Store results in Redis
      await this.storeScreenerResults({
        timestamp: Date.now(),
        scanDuration: Date.now() - startTime,
        marketOverview,
        opportunities: opportunities.slice(0, 20), // Top 20 opportunities
        totalScanned: this.watchlist.length * this.timeframes.length
      });

      this.lastScan = Date.now();
      
      logger.info(`✅ Market scan completed: ${opportunities.length} opportunities found in ${Date.now() - startTime}ms`);
      
      return {
        marketOverview,
        opportunities,
        scanInfo: {
          timestamp: Date.now(),
          duration: Date.now() - startTime,
          totalScanned: this.watchlist.length * this.timeframes.length
        }
      };

    } catch (error) {
      logger.error('Market screener scan failed:', error);
      throw error;
    }
  }

  /**
   * Analyze individual pair for opportunities
   */
  async analyzePairOpportunity(pair, timeframe) {
    try {
      // Get trading suggestion from the engine
      const suggestion = await this.tradingEngine.getTradingSuggestions(pair, timeframe);
      
      if (!suggestion) {
        return null;
      }

      // Enhanced analysis
      const opportunity = {
        id: `${pair}-${timeframe}-${Date.now()}`,
        pair,
        timeframe,
        action: suggestion.action,
        entryPrice: suggestion.entryPrice,
        stopLoss: suggestion.stopLoss,
        takeProfit: suggestion.takeProfit,
        riskRewardRatio: suggestion.riskRewardRatio,
        
        // AI Analysis
        strength: suggestion.signal.strength,
        confidence: suggestion.signal.confidence,
        source: suggestion.signal.source,
        
        // Technical indicators
        rsi: suggestion.technicalAnalysis.rsi,
        adx: suggestion.technicalAnalysis.adx,
        trend: suggestion.technicalAnalysis.trend,
        volatility: suggestion.technicalAnalysis.volatility,
        
        // Market context
        volume: suggestion.marketContext.volume,
        volumeProfile: suggestion.marketContext.volumeProfile.trend,
        
        // Priority calculation
        priority: this.calculatePriority(suggestion),
        
        // Additional insights
        insights: this.generateInsights(suggestion),
        
        timestamp: Date.now(),
        expiresAt: suggestion.expiresAt
      };

      return opportunity;

    } catch (error) {
      logger.warn(`Failed to analyze ${pair} ${timeframe}:`, error.message);
      return null;
    }
  }

  /**
   * Calculate opportunity priority based on multiple factors
   */
  calculatePriority(suggestion) {
    let score = 0;
    
    // Signal strength (40% weight)
    score += suggestion.signal.strength * 0.4;
    
    // Risk/Reward ratio (25% weight)
    const rrWeight = Math.min(suggestion.riskRewardRatio / 3, 1); // Cap at 3:1
    score += rrWeight * 0.25;
    
    // ADX strength (20% weight)
    const adxScore = Math.min(suggestion.technicalAnalysis.adx / 50, 1);
    score += adxScore * 0.2;
    
    // Volume confirmation (15% weight)
    const volumeScore = suggestion.marketContext.volumeProfile.ratio > 1.5 ? 1 : 0.5;
    score += volumeScore * 0.15;
    
    // Convert to priority levels
    if (score >= 0.75) return 'HIGH';
    if (score >= 0.55) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Generate AI insights for the opportunity
   */
  generateInsights(suggestion) {
    const insights = [];
    
    // RSI insights
    if (suggestion.technicalAnalysis.rsi < 30) {
      insights.push('🔥 Strong oversold condition - High bounce potential');
    } else if (suggestion.technicalAnalysis.rsi > 70) {
      insights.push('⚠️ Overbought zone - Potential reversal ahead');
    }
    
    // ADX insights
    if (suggestion.technicalAnalysis.adx > 40) {
      insights.push('💪 Strong trend momentum detected');
    } else if (suggestion.technicalAnalysis.adx < 20) {
      insights.push('😴 Weak trend - Consider waiting for confirmation');
    }
    
    // Volume insights
    if (suggestion.marketContext.volumeProfile.ratio > 2) {
      insights.push('📈 Exceptional volume spike - High conviction move');
    } else if (suggestion.marketContext.volumeProfile.ratio < 0.8) {
      insights.push('📉 Below average volume - Wait for confirmation');
    }
    
    // Risk/Reward insights
    if (suggestion.riskRewardRatio > 2.5) {
      insights.push('💎 Excellent risk/reward setup');
    } else if (suggestion.riskRewardRatio < 1.5) {
      insights.push('⚖️ Moderate risk/reward - Consider position sizing');
    }
    
    return insights;
  }

  /**
   * Calculate overall market trend
   */
  calculateMarketTrend(opportunities) {
    if (opportunities.length === 0) return 'NEUTRAL';
    
    const bullish = opportunities.filter(op => op.action === 'BUY').length;
    const bearish = opportunities.filter(op => op.action === 'SELL').length;
    
    const bullishRatio = bullish / opportunities.length;
    
    if (bullishRatio >= 0.65) return 'BULLISH';
    if (bullishRatio <= 0.35) return 'BEARISH';
    return 'NEUTRAL';
  }

  /**
   * Calculate market volatility level
   */
  calculateVolatilityLevel(opportunities) {
    if (opportunities.length === 0) return 'LOW';
    
    const avgVolatility = opportunities.reduce((sum, op) => sum + op.volatility, 0) / opportunities.length;
    
    if (avgVolatility > 0.06) return 'HIGH';
    if (avgVolatility > 0.03) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Store screener results in Redis
   */
  async storeScreenerResults(results) {
    try {
      const key = `screener:results:${Date.now()}`;
      await this.redisClient.setEx(key, 3600, JSON.stringify(results)); // 1 hour expiry
      
      // Also store latest results
      await this.redisClient.set('screener:latest', JSON.stringify(results));
      
      logger.info(`✅ Screener results stored in Redis: ${key}`);
    } catch (error) {
      logger.error('Failed to store screener results:', error);
    }
  }

  /**
   * Get latest screener results
   */
  async getLatestResults() {
    try {
      const results = await this.redisClient.get('screener:latest');
      return results ? JSON.parse(results) : null;
    } catch (error) {
      logger.error('Failed to retrieve latest screener results:', error);
      return null;
    }
  }

  /**
   * Get top opportunities by criteria
   */
  async getTopOpportunities(limit = 10, criteria = 'priority') {
    try {
      const results = await this.getLatestResults();
      if (!results || !results.opportunities) return [];
      
      let sorted = [...results.opportunities];
      
      switch (criteria) {
        case 'strength':
          sorted.sort((a, b) => b.strength - a.strength);
          break;
        case 'riskReward':
          sorted.sort((a, b) => b.riskRewardRatio - a.riskRewardRatio);
          break;
        case 'priority':
        default:
          // Already sorted by priority in scanMarket
          break;
      }
      
      return sorted.slice(0, limit);
    } catch (error) {
      logger.error('Failed to get top opportunities:', error);
      return [];
    }
  }

  /**
   * Update watchlist
   */
  updateWatchlist(newWatchlist) {
    this.watchlist = newWatchlist;
    logger.info(`📝 Watchlist updated: ${this.watchlist.length} pairs`);
  }

  /**
   * Get current watchlist
   */
  getWatchlist() {
    return this.watchlist;
  }
}

module.exports = AIMarketScreener;
