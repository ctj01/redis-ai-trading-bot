// ManualTradingEngine.js - Replace BacktestingEngine with Manual Trading Assistant
const logger = require('../utils/logger');
const { ATR, ADX, SMA } = require('technicalindicators');
const BingXClient = require('../utils/bingx-client');

class ManualTradingEngine {
  constructor(redisClient) {
    this.redisClient = redisClient;
    this.bingxClient = new BingXClient();
    this.activeSuggestions = new Map(); // Store active trade suggestions
    this.manualTrades = []; // Store manual trades history
    this.virtualBalance = 10000; // Virtual portfolio for paper trading
  }

  /**
   * Get real-time trading suggestions based on current market conditions
   * @param {string} pair - Trading pair (e.g., 'BTC-USDT')
   * @param {string} timeframe - Timeframe (e.g., '1h', '4h')
   */
  async getTradingSuggestions(pair = 'BTC-USDT', timeframe = '4h') {
    try {
      console.log(`🔍 Analyzing ${pair} on ${timeframe} for trading opportunities...`);

      // 1. Fetch real-time market data
      const marketData = await this.fetchRealtimeMarketData(pair, timeframe);
      if (!marketData || marketData.length < 50) {
        throw new Error(`Insufficient market data: ${marketData?.length || 0} candles`);
      }

      // 2. Calculate technical indicators
      const indicators = this.calculateTechnicalIndicators(marketData);
      
      // 3. Generate trading signals
      const currentSignal = this.analyzeCurrentMarketConditions(marketData, indicators);
      
      // 4. Create trade suggestion if signal exists
      if (currentSignal) {
        const tradeSuggestion = await this.createTradeSuggestion(pair, timeframe, currentSignal, marketData, indicators);
        
        // Store suggestion for dashboard using the suggestion ID
        this.activeSuggestions.set(tradeSuggestion.id, tradeSuggestion);
        
        console.log(`✅ Trade suggestion generated for ${pair}:`, tradeSuggestion.action);
        return tradeSuggestion;
      }

      console.log(`❌ No trading opportunities found for ${pair} on ${timeframe}`);
      return null;

    } catch (error) {
      logger.error(`Error generating trading suggestions for ${pair}:`, error);
      throw error;
    }
  }

  /**
   * Create detailed trade suggestion with all necessary information
   */
  async createTradeSuggestion(pair, timeframe, signal, marketData, indicators) {
    const currentCandle = marketData[marketData.length - 1];
    const currentPrice = currentCandle.close;
    const atr = indicators.atr[indicators.atr.length - 1];
    const rsi = indicators.rsi[indicators.rsi.length - 1];

    // Calculate position sizing based on risk management
    const suggestedSize = this.calculateSuggestedPositionSize(signal, rsi);
    
    // Calculate stop loss and take profit levels
    const stopLossDistance = atr * 1.5; // ATR-based stop loss
    const takeProfitDistance = atr * 2.0; // ATR-based take profit
    
    const stopLoss = signal.type === 'bullish' 
      ? currentPrice - stopLossDistance 
      : currentPrice + stopLossDistance;
      
    const takeProfit = signal.type === 'bullish'
      ? currentPrice + takeProfitDistance
      : currentPrice - takeProfitDistance;

    // Calculate risk/reward ratio
    const riskAmount = Math.abs(currentPrice - stopLoss);
    const rewardAmount = Math.abs(takeProfit - currentPrice);
    const riskRewardRatio = rewardAmount / riskAmount;

    const suggestion = {
      id: `${pair}-${Date.now()}`,
      timestamp: Date.now(),
      pair: pair,
      timeframe: timeframe,
      action: signal.type === 'bullish' ? 'BUY' : 'SELL',
      signal: signal,
      
      // Entry details
      entryPrice: currentPrice,
      currentPrice: currentPrice,
      
      // Risk management
      stopLoss: stopLoss,
      takeProfit: takeProfit,
      riskRewardRatio: riskRewardRatio,
      
      // Position sizing
      suggestedPositionSize: suggestedSize,
      maxRiskAmount: this.virtualBalance * 0.02, // 2% risk per trade
      
      // Technical analysis
      technicalAnalysis: {
        rsi: rsi,
        atr: atr,
        adx: indicators.adx[indicators.adx.length - 1]?.adx || 0,
        trend: this.analyzeTrendDirection(indicators),
        volatility: this.calculateVolatility(marketData.slice(-20)),
        strength: signal.strength,
        confidence: signal.confidence,
        confirmations: signal.confirmations || 1
      },
      
      // Market context
      marketContext: {
        timeframe: timeframe,
        volume: currentCandle.volume,
        volumeProfile: this.analyzeVolumeProfile(marketData.slice(-10))
      },
      
      // Status
      status: 'PENDING', // PENDING, EXECUTED, CANCELLED, EXPIRED
      expiresAt: Date.now() + (30 * 60 * 1000), // Expires in 30 minutes
      
      // Manual analysis helpers
      fibonacciLevels: this.calculateFibonacciLevels(marketData.slice(-50)),
      supportResistance: this.findSupportResistanceLevels(marketData.slice(-100)),
      
      // Copy trading data
      copyTradeData: {
        exchange: 'BingX',
        symbol: pair,
        side: signal.type === 'bullish' ? 'BUY' : 'SELL',
        type: 'MARKET', // or LIMIT
        quantity: suggestedSize,
        stopPrice: stopLoss,
        takeProfitPrice: takeProfit,
        timeInForce: 'GTC'
      }
    };

    return suggestion;
  }

  /**
   * Execute manual trade (for paper trading or copy to exchange)
   */
  async executeManualTrade(suggestionId, executionType = 'PAPER', customParams = {}) {
    try {
      const suggestion = this.activeSuggestions.get(suggestionId);
      
      if (!suggestion) {
        throw new Error('Trade suggestion not found or expired');
      }

      // Update suggestion with custom parameters if provided
      const finalParams = {
        ...suggestion.copyTradeData,
        ...customParams
      };

      const trade = {
        id: `trade-${Date.now()}`,
        suggestionId: suggestionId,
        timestamp: Date.now(),
        pair: suggestion.pair,
        action: suggestion.action,
        executionType: executionType, // PAPER, LIVE, COPY
        
        // Execution details
        entryPrice: finalParams.entryPrice || suggestion.currentPrice,
        quantity: finalParams.quantity || suggestion.suggestedPositionSize,
        stopLoss: finalParams.stopPrice || suggestion.stopLoss,
        takeProfit: finalParams.takeProfitPrice || suggestion.takeProfit,
        
        // Trade tracking
        status: 'ACTIVE',
        pnl: 0,
        unrealizedPnl: 0,
        commission: finalParams.quantity * 0.001, // 0.1% commission
        
        // References
        originalSuggestion: suggestion,
        manualNotes: customParams.notes || '',
        
        // Timestamps
        entryTime: Date.now(),
        exitTime: null
      };

      // Store trade
      this.manualTrades.push(trade);
      
      // Update suggestion status
      suggestion.status = 'EXECUTED';
      
      // Update virtual balance if paper trading
      if (executionType === 'PAPER') {
        this.virtualBalance -= trade.commission;
      }

      console.log(`✅ Manual trade executed: ${trade.action} ${trade.pair} @ ${trade.entryPrice}`);
      
      // Save to Redis for persistence
      if (this.redisClient?.set) {
        await this.redisClient.set(`manual_trade:${trade.id}`, JSON.stringify(trade));
        await this.redisClient.set(`active_suggestions:${suggestion.pair}`, JSON.stringify(suggestion));
      }

      return trade;

    } catch (error) {
      logger.error('Error executing manual trade:', error);
      throw error;
    }
  }

  /**
   * Get active trading suggestions for dashboard
   */
  getActiveSuggestions(pair = null) {
    if (pair) {
      return this.activeSuggestions.get(pair) || null;
    }
    
    return Array.from(this.activeSuggestions.values())
      .filter(suggestion => suggestion.status === 'PENDING')
      .filter(suggestion => Date.now() < suggestion.expiresAt)
      .sort((a, b) => b.signal.strength - a.signal.strength);
  }

  /**
   * Get manual trades history
   */
  getManualTradesHistory(limit = 20) {
    return this.manualTrades
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Calculate performance metrics for manual trading
   */
  calculateManualTradingPerformance() {
    const closedTrades = this.manualTrades.filter(trade => trade.status === 'CLOSED');
    
    if (closedTrades.length === 0) {
      return {
        totalTrades: 0,
        winRate: 0,
        totalPnL: 0,
        averagePnL: 0,
        bestTrade: 0,
        worstTrade: 0,
        currentBalance: this.virtualBalance
      };
    }

    const winningTrades = closedTrades.filter(trade => trade.pnl > 0);
    const totalPnL = closedTrades.reduce((sum, trade) => sum + trade.pnl, 0);

    return {
      totalTrades: closedTrades.length,
      winRate: (winningTrades.length / closedTrades.length) * 100,
      totalPnL: totalPnL,
      averagePnL: totalPnL / closedTrades.length,
      bestTrade: Math.max(...closedTrades.map(t => t.pnl)),
      worstTrade: Math.min(...closedTrades.map(t => t.pnl)),
      currentBalance: this.virtualBalance + totalPnL
    };
  }

  // Helper methods (keeping your existing signal analysis logic)
  
  async fetchRealtimeMarketData(pair, timeframe, limit = 200) {
    try {
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - (limit * this.getIntervalMs(timeframe)));
      
      return await this.fetchBingXHistoricalData(pair, timeframe, startDate, endDate);
    } catch (error) {
      logger.error('Error fetching realtime market data:', error);
      throw error;
    }
  }

  calculateTechnicalIndicators(marketData) {
    const closes = marketData.map(c => c.close);
    const highs = marketData.map(c => c.high);
    const lows = marketData.map(c => c.low);

    return {
      rsi: this.calculateRSI(closes, 14),
      atr: ATR.calculate({ period: 14, high: highs, low: lows, close: closes }),
      adx: ADX.calculate({ period: 14, high: highs, low: lows, close: closes }),
      sma20: SMA.calculate({ period: 20, values: closes }),
      sma50: SMA.calculate({ period: 50, values: closes })
    };
  }

  analyzeCurrentMarketConditions(marketData, indicators) {
    const recentPrices = marketData.slice(-30);
    const recentRSI = indicators.rsi.slice(-30);
    const currentRSI = indicators.rsi[indicators.rsi.length - 1];

    console.log(`🔍 Current RSI: ${currentRSI?.toFixed(2)} for market analysis`);

    // Use your existing signal detection methods
    const wmSignal = this.detectWMPatterns(recentPrices, recentRSI);
    const volumeSignal = this.analyzeVolumePattern(recentPrices, recentPrices.length - 1);
    const candleSignal = this.analyzeCandlestickPatterns(recentPrices, recentPrices.length - 1);
    const divSignal = this.detectDivergence(recentPrices, recentRSI);
    const rsiExtreme = this.detectRSIExtremes(currentRSI);

    console.log(`🎯 Signals detected: WM=${!!wmSignal}, Volume=${!!volumeSignal}, Candle=${!!candleSignal}, Div=${!!divSignal}, RSI=${!!rsiExtreme}`);
    if (rsiExtreme) console.log(`📊 RSI Signal: ${rsiExtreme.type} (strength: ${rsiExtreme.strength?.toFixed(2)})`);

    return this.combineSignalsSimplified(wmSignal, volumeSignal, candleSignal, divSignal, rsiExtreme);
  }

  calculateSuggestedPositionSize(signal, rsi) {
    const riskPercentage = 0.02; // 2% risk per trade
    const baseSize = this.virtualBalance * riskPercentage;
    
    // Adjust based on signal strength
    let multiplier = 1.0;
    if (signal.strength > 0.7) multiplier = 1.2;
    if (signal.strength < 0.3) multiplier = 0.8;
    
    // Adjust based on RSI extremes
    if ((signal.type === 'bullish' && rsi < 30) || (signal.type === 'bearish' && rsi > 70)) {
      multiplier *= 1.1; // Increase size for extreme RSI levels
    }
    
    return baseSize * multiplier;
  }

  calculateFibonacciLevels(marketData) {
    const prices = marketData.map(c => c.close);
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    const range = high - low;

    return {
      high: high,
      low: low,
      fibonacci_786: high - (range * 0.786),
      fibonacci_618: high - (range * 0.618),
      fibonacci_500: high - (range * 0.500),
      fibonacci_382: high - (range * 0.382),
      fibonacci_236: high - (range * 0.236)
    };
  }

  findSupportResistanceLevels(marketData) {
    const prices = marketData.map(c => c.close);
    const highs = marketData.map(c => c.high);
    const lows = marketData.map(c => c.low);

    // Simple support/resistance detection based on local extremes
    const resistance = this.findLocalExtrema(highs, 'maxima', 3).slice(-3);
    const support = this.findLocalExtrema(lows, 'minima', 3).slice(-3);

    return {
      resistance: resistance.map(idx => highs[idx]),
      support: support.map(idx => lows[idx])
    };
  }

  analyzeTrendDirection(indicators) {
    const sma20 = indicators.sma20;
    const sma50 = indicators.sma50;
    
    if (sma20.length < 2 || sma50.length < 2) return 'UNKNOWN';
    
    const currentSma20 = sma20[sma20.length - 1];
    const currentSma50 = sma50[sma50.length - 1];
    const prevSma20 = sma20[sma20.length - 2];
    
    if (currentSma20 > currentSma50 && prevSma20 < currentSma20) return 'BULLISH';
    if (currentSma20 < currentSma50 && prevSma20 > currentSma20) return 'BEARISH';
    
    return 'SIDEWAYS';
  }

  calculateVolatility(marketData) {
    const prices = marketData.map(c => c.close);
    const returns = [];
    
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i-1]) / prices[i-1]);
    }
    
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance) * Math.sqrt(252); // Annualized volatility
  }

  analyzeVolumeProfile(marketData) {
    const volumes = marketData.map(c => c.volume);
    const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
    const currentVolume = volumes[volumes.length - 1];
    
    return {
      current: currentVolume,
      average: avgVolume,
      ratio: currentVolume / avgVolume,
      trend: currentVolume > avgVolume ? 'HIGH' : 'LOW'
    };
  }

  // Import your existing methods from BacktestingEngine
  async fetchBingXHistoricalData(pair, timeframe, startDate, endDate) {
    try {
      const symbol = pair.replace('-', '-');
      const interval = this.convertTimeframeToBingX(timeframe);
      const startTime = startDate.getTime();
      
      const params = {
        symbol: symbol,
        interval: interval,
        startTime: startTime.toString(),
        limit: '1000'
      };

      const response = await this.bingxClient.makeRequest('/openApi/spot/v1/market/kline', 'GET', params);
      
      if (!response || !response.data || !Array.isArray(response.data)) {
        throw new Error('Invalid response format from BingX API');
      }

      const data = response.data.map(candle => ({
        timestamp: parseInt(candle[0]),
        open: parseFloat(candle[1]),
        high: parseFloat(candle[2]),
        low: parseFloat(candle[3]),
        close: parseFloat(candle[4]),
        volume: parseFloat(candle[5])
      }));

      return data.filter(candle => 
        candle.timestamp >= startTime && candle.timestamp <= endDate.getTime()
      );

    } catch (error) {
      logger.error(`BingX API Error:`, error.message);
      throw error;
    }
  }

  convertTimeframeToBingX(timeframe) {
    const mapping = {
      '1m': '1m', '5m': '5m', '15m': '15m',
      '1h': '1h', '4h': '4h', '1d': '1d'
    };
    return mapping[timeframe] || '4h';
  }

  getIntervalMs(tf) {
    return {
      '1m': 60e3, '5m': 5*60e3, '15m': 15*60e3,
      '1h': 60*60e3, '4h': 4*60*60e3, '1d': 24*60*60e3
    }[tf] || 60*60e3;
  }

  // Include all your existing signal detection methods
  calculateRSI(prices, period = 14) {
    const rsi = [];
    if (prices.length < period + 1) return new Array(prices.length).fill(50);
    const gains = [], losses = [];
    for (let i = 1; i < prices.length; i++) {
      const d = prices[i] - prices[i-1];
      gains.push(Math.max(d,0));
      losses.push(Math.max(-d,0));
    }
    let avgG = gains.slice(0,period).reduce((a,b)=>a+b)/period;
    let avgL = losses.slice(0,period).reduce((a,b)=>a+b)/period;
    rsi.push(...Array(period).fill(50));
    rsi.push(100 - (100/(1 + avgG/avgL)));
    for (let i = period; i < gains.length; i++) {
      avgG = ((avgG*(period-1)) + gains[i]) / period;
      avgL = ((avgL*(period-1)) + losses[i]) / period;
      rsi.push(avgL===0 ? 100 : 100 - (100/(1 + avgG/avgL)));
    }
    return rsi;
  }

  detectWMPatterns(prices, rsi, tol=10, low=30, high=70) {
    if (rsi.length < 5) return null;
    const order = 2;
    const minima = this.findLocalExtrema(rsi,'minima',order);
    const maxima = this.findLocalExtrema(rsi,'maxima',order);
    const i = rsi.length-1;
    if (minima.includes(i-1)||minima.includes(i-2)) {
      const idx = minima.includes(i-1)?i-1:i-2;
      if (rsi[idx] < low + tol) {
        return { type:'bullish', strength:Math.min(1,(low+tol-rsi[idx])/20), confidence:0.8, source:'W_pattern' };
      }
    }
    if (maxima.includes(i-1)||maxima.includes(i-2)) {
      const idx = maxima.includes(i-1)?i-1:i-2;
      if (rsi[idx] > high - tol) {
        return { type:'bearish', strength:Math.min(1,(rsi[idx]-(high-tol))/20), confidence:0.8, source:'M_pattern' };
      }
    }
    return null;
  }

  analyzeVolumePattern(data, idx) {
    if (data.length<5||idx<4) return null;
    const curr = data[idx], prev = data.slice(idx-4,idx);
    const avg = prev.reduce((sum,c)=>sum+c.volume,0)/4;
    const ratio = curr.volume/avg;
    const change= (curr.close-curr.open)/curr.open;
    
    if (ratio>1.3) {
      if (change>0.005) {
        return { type:'bullish', strength:Math.min(ratio/2.5,0.8), confidence:0.7, source:'volume_surge' };
      }
      if (change< -0.005) {
        return { type:'bearish', strength:Math.min(ratio/2.5,0.8), confidence:0.7, source:'volume_dump' };
      }
    }
    return null;
  }

  analyzeCandlestickPatterns(data, idx) {
    if (data.length<3||idx<2) return null;
    const c = data[idx], p = data[idx-1];
    const body = Math.abs(c.close-c.open);
    const total= c.high-c.low;
    const up   = c.high - Math.max(c.close,c.open);
    const down = Math.min(c.close,c.open) - c.low;
    
    if (down>body*2 && up<body*0.5) return { type:'bullish', strength:0.6, confidence:0.7, source:'hammer' };
    if (up>body*2 && down<body*0.5) return { type:'bearish', strength:0.6, confidence:0.7, source:'shooting_star' };
    
    return null;
  }

  detectDivergence(priceData, rsiData, minStr=0.1) {
    // Simplified divergence detection
    if (priceData.length < 10 || rsiData.length < 10) return null;
    
    const priceTrend = priceData[priceData.length-1].close > priceData[priceData.length-5].close;
    const rsiTrend = rsiData[rsiData.length-1] > rsiData[rsiData.length-5];
    
    if (priceTrend && !rsiTrend) {
      return { type:'bearish', strength:0.6, confidence:0.7, source:'bearish_divergence' };
    }
    if (!priceTrend && rsiTrend) {
      return { type:'bullish', strength:0.6, confidence:0.7, source:'bullish_divergence' };
    }
    
    return null;
  }

  detectRSIExtremes(rsi, minStr=0.02) {
    // More relaxed RSI thresholds for more trading opportunities
    if (rsi > 60) {
      const str = Math.min((rsi-60)/40,1)*0.6;
      if (str>=minStr) return { type:'bearish', strength:str, confidence:0.5, source:'rsi_overbought' };
    }
    if (rsi < 40) {
      const str = Math.min((40-rsi)/40,1)*0.6;
      if (str>=minStr) return { type:'bullish', strength:str, confidence:0.5, source:'rsi_oversold' };
    }
    return null;
  }

  combineSignalsSimplified(...signals) {
    const s = signals.filter(x=>x);
    if (!s.length) return null;
    const bulls = s.filter(x=>x.type==='bullish');
    const bears = s.filter(x=>x.type==='bearish');
    
    if (bulls.length>=1) {
      const avgS = bulls.reduce((a,b)=>a+b.strength,0)/bulls.length;
      const avgC = bulls.reduce((a,b)=>a+b.confidence,0)/bulls.length;
      return { type:'bullish', strength:avgS, confidence:avgC, source:'combined', confirmations:bulls.length };
    }
    if (bears.length>=1) {
      const avgS = bears.reduce((a,b)=>a+b.strength,0)/bears.length;
      const avgC = bears.reduce((a,b)=>a+b.confidence,0)/bears.length;
      return { type:'bearish', strength:avgS, confidence:avgC, source:'combined', confirmations:bears.length };
    }
    return null;
  }

  findLocalExtrema(arr, type='minima', order=2) {
    const ext = [];
    for (let i = order; i < arr.length-order; i++) {
      let ok = true;
      for (let j = 1; j <= order; j++) {
        if (type==='minima' && (arr[i]>=arr[i-j]||arr[i]>=arr[i+j])) ok=false;
        if (type==='maxima' && (arr[i]<=arr[i-j]||arr[i]<=arr[i+j])) ok=false;
      }
      if (ok) ext.push(i);
    }
    return ext;
  }
}

module.exports = ManualTradingEngine;
