// BacktestingEngine.js
const logger = require('../utils/logger');
const { ATR, ADX, SMA } = require('technicalindicators');
const BingXClient = require('../utils/bingx-client');

class BacktestingEngine {
  constructor(redisClient) {
    this.redisClient = redisClient;
    this.bingxClient = new BingXClient();
  }

  async runBacktest(params) {
    console.log('⏳ Starting backtest with params:', params);

    // 1. Fetch or generate historical data
    const historicalData = await this.generateHistoricalData(
      params.pair || 'BTC-USDT',
      params.timeframe || '4h',
      new Date(params.startDate),
      new Date(params.endDate)
    );
    if (historicalData.length < 50) {
      throw new Error(`Insufficient data: only ${historicalData.length} candles. Need ≥50.`);
    }

    // 2. Extract OHLCV arrays
    const closes = historicalData.map(c => c.close);
    const highs  = historicalData.map(c => c.high);
    const lows   = historicalData.map(c => c.low);
    const vols   = historicalData.map(c => c.volume);

    // 3. Calculate indicators
    const rsiValues      = this.calculateRSI(closes, params.rsiPeriod || 14);
    const adxRaw         = ADX.calculate({ period: params.adxPeriod || 14, high: highs, low: lows, close: closes });
    const atrRaw         = ATR.calculate({ period: params.atrPeriod || 14, high: highs, low: lows, close: closes });
    const smaLongRaw     = SMA.calculate({ period: params.smaPeriod || 50, values: closes });

    // 4. Backtest state
    let balance         = params.initialBalance || 10000;
    const initialBal    = balance;
    let trades          = [];
    let signals         = [];
    let equity          = [{ timestamp: historicalData[0].timestamp, value: balance }];
    let position        = null;    // 'bullish' or 'bearish'
    let entryPrice      = 0;
    let positionSize    = 0;
    let lastExitIndex   = -Infinity;
    const cooldown      = params.cooldownCandles || 8;  // Aumentado de 3 a 8 para reducir overtrading

    // 5. Main loop
    for (let i = 50; i < historicalData.length; i++) {
      const candle     = historicalData[i];
      const price      = candle.close;
      const idxAdx     = i - (historicalData.length - adxRaw.length);
      const idxAtr     = i - (historicalData.length - atrRaw.length);
      const idxSmaLong = i - (historicalData.length - smaLongRaw.length);

      // 5.1 Trend filter via SMA long
      if (params.useLongSMA && smaLongRaw[idxSmaLong] !== undefined) {
        const smaLong = smaLongRaw[idxSmaLong];
        if (!position && params.onlyLongs && price < smaLong) continue;
        if (!position && params.onlyShorts && price > smaLong) continue;
      }

      // 5.2 ADX filter: only trade if trend strength ≥ threshold
      const adxVal = adxRaw[idxAdx]?.adx;
      
      // Debug ADX values periodically
      if (i % 50 === 0) {
        console.log(`📊 Debug @${i}: ADX=${adxVal?.toFixed(2)}, idxAdx=${idxAdx}, adxRaw.length=${adxRaw.length}`);
      }
      
      if (adxVal === undefined || adxVal < (params.minAdx || 25)) {
        // if we're in a trade, we still check exit conditions
      }

      // 5.3 Build recent slices for pattern functions
      const recentPrices = historicalData.slice(Math.max(0, i - 30), i + 1);
      const recentRSI    = rsiValues.slice(Math.max(0, i - 30), i + 1);

      // 5.4 Signal generation con RSI estricto
      const wmSignal        = this.detectWMPatterns(recentPrices, recentRSI, params.wmTolerance || 10, params.rsiLower || 30, params.rsiUpper || 70);
      const volumeSignal    = this.analyzeVolumePattern(recentPrices, recentPrices.length - 1);
      const candleSignal    = this.analyzeCandlestickPatterns(recentPrices, recentPrices.length - 1);
      const divSignal       = this.detectDivergence(recentPrices, recentRSI, params.minStrength || 0.05);
      const rsiExtreme      = this.detectRSIExtremes(rsiValues[i], params.minStrength || 0.02);
      const trendSignal     = this.detectTrendSignal(recentPrices, rsiValues[i], i);

      // 5.5 Combine signals with priority
      let finalSignal = null;
      if (trendSignal && trendSignal.strength > 0.3) {
        finalSignal = trendSignal;
      } else {
        finalSignal = this.combineSignalsSimplified(wmSignal, volumeSignal, candleSignal, divSignal, rsiExtreme);
      }

      // Debug first few signals and periodically show signal generation
      if ((i < 60 && finalSignal) || (i % 100 === 0 && finalSignal)) {
        console.log(`🔍 Signal @${i}:`, finalSignal);
      }
      
      // Debug when no signals are generated (every 100 candles)
      if (i % 100 === 0 && !finalSignal) {
        console.log(`❌ No signal @${i}: WM=${!!wmSignal}, Vol=${!!volumeSignal}, Candle=${!!candleSignal}, Div=${!!divSignal}, RSI=${!!rsiExtreme}, Trend=${!!trendSignal}, RSI=${rsiValues[i]?.toFixed(2)}`);
      }

      // 5.6 Exit logic using ATR stops
      if (position) {
        const atr = atrRaw[idxAtr];
        // Stop loss optimizado basado en análisis de 4 trades reales
        const stopMultiplier = params.stopLossMultiplier || 1.5;  // CONFIRMADO: 25% activación óptima
        const targetMultiplier = params.takeProfitMultiplier || 1.6;  // OPTIMIZADO FINAL: 2.0→1.8→1.6 para activación
        
        const stopPerc   = (atr * stopMultiplier) / entryPrice;
        const targetPerc = (atr * targetMultiplier) / entryPrice;
        const pnlPerc    = position === 'bullish'
                          ? (price - entryPrice) / entryPrice
                          : (entryPrice - price) / entryPrice;

        // Trailing stop menos agresivo para dar más espacio al trade
        let trailingStopPerc = -stopPerc;
        if (pnlPerc > targetPerc * 0.6) {  // Activar trailing solo al 60% del target
          trailingStopPerc = Math.max(trailingStopPerc, -targetPerc * 0.15); // Stop a 15% del target (menos agresivo)
        }

        // Time-based exit balanceado para forzar decisiones
        const maxHoldPeriod = params.maxHoldCandles || 36;  // Reducido para forzar más stops/targets
        const holdTime = i - lastExitIndex - cooldown;
        const timeExit = holdTime >= maxHoldPeriod;

        // Solo salir por target, stop ajustado, o tiempo límite
        if (pnlPerc >= targetPerc || pnlPerc <= trailingStopPerc || timeExit) {
          // perform exit
          const exitReason = pnlPerc >= targetPerc ? 'TARGET' : (pnlPerc <= trailingStopPerc ? 'STOP' : 'TIME');
          const pnl = this.calculatePnL(entryPrice, price, positionSize, position, params.commissionRate || 0.001);
          balance += pnl;
          trades.push({
            type: position,
            entryPrice,
            exitPrice: price,
            entryTime: historicalData[i - 1].timestamp,
            exitTime: candle.timestamp,
            pnl,
            positionSize,
            returnPct: (pnl / positionSize) * 100,
            commission: positionSize * (params.commissionRate || 0.001) * 2,
            exitReason
          });
          console.log(`💰 EXIT ${position} @${price.toFixed(2)} PnL=${pnl.toFixed(2)} [${exitReason}] Hold=${holdTime} candles`);
          position = null;
          lastExitIndex = i;
        }
      }

      // 5.7 Entry logic
      if (!position
          && finalSignal
          && finalSignal.strength >= (params.entryMinStrength || 0.05)  // Aumentado de 0.02 a 0.05 para mejor calidad
          && (i - lastExitIndex) >= cooldown
      ) {
        // Debug signal and filters
        const avgVol = vols.slice(i - 5, i).reduce((sum, v) => sum + v, 0) / 5;
        const volRatio = candle.volume / avgVol;
        const adxCheck = adxVal >= (params.minAdx || 20);  // Aumentado de 15 a 20 para mejor tendencia
        const volCheck = volRatio >= (params.minVolumeRatio || 1.5);  // Aumentado de 1.2 a 1.5 para mejor volumen
        
        // Filtro RSI con confirmación de debilidad del momentum Y SOLO señales débiles/moderadas
        let rsiConfirm = false;
        if (finalSignal.type === 'bullish' && rsiValues[i] < 30) {
          // Para compra: RSI bajo + momentum bajista débil + SOLO señales débiles (< 0.50)
          const recentChange = (price - historicalData[i-3].close) / historicalData[i-3].close;
          const momentumWeak = recentChange > -0.03; // No está cayendo más del 3% en 3 velas
          const signalWeak = finalSignal.strength < 0.50; // SOLO señales débiles para evitar manipulación
          rsiConfirm = momentumWeak && signalWeak;
        } else if (finalSignal.type === 'bearish' && rsiValues[i] > 70) {
          // Para venta: RSI alto + momentum alcista débil + SOLO señales débiles (< 0.50)
          const recentChange = (price - historicalData[i-3].close) / historicalData[i-3].close;
          const momentumWeak = recentChange < 0.03; // No está subiendo más del 3% en 3 velas
          const signalWeak = finalSignal.strength < 0.50; // SOLO señales débiles para evitar manipulación
          rsiConfirm = momentumWeak && signalWeak;
        }
        
        // Filtro de calidad: SOLO señales débiles para evitar manipulación
        const multiSignalConfirm = finalSignal.source === 'combined' && finalSignal.confirmations >= 2;
        const weakSignal = finalSignal.strength >= 0.3 && finalSignal.strength < 0.50; // SOLO señales débiles
        const signalQuality = multiSignalConfirm || weakSignal;
        
        // Debug output con información de momentum y fuerza de señal
        if (finalSignal && (i % 20 === 0 || !adxCheck || !volCheck || !rsiConfirm || !signalQuality)) {
          const recentChange = i >= 3 ? ((price - historicalData[i-3].close) / historicalData[i-3].close * 100).toFixed(1) : 'N/A';
          console.log(`🔍 Entry check @${i}: Signal=${finalSignal.type}(${finalSignal.strength.toFixed(2)}), ADX=${adxVal?.toFixed(2)}(${adxCheck}), Vol=${volRatio.toFixed(2)}(${volCheck}), RSI=${rsiValues[i]?.toFixed(1)}(${rsiConfirm}), Quality=${signalQuality}, Momentum=${recentChange}%, SignalStrength=${finalSignal.strength.toFixed(2)}`);
        }
        
        // Use multiple filters for better trade quality
        if (adxCheck && volCheck && rsiConfirm && signalQuality) {
          position      = finalSignal.type;
          entryPrice    = price;
          positionSize  = this.calculatePositionSize(balance, finalSignal, rsiValues[i]);
          signals.push({
            timestamp: candle.timestamp,  // Use current candle timestamp, not when signal was generated
            type: position === 'bullish' ? 'buy' : 'sell',
            price: entryPrice,
            source: finalSignal.source,
            strength: finalSignal.strength,
            rsi: rsiValues[i]
          });
          console.log(`🚀 ENTER ${position.toUpperCase()} @${price.toFixed(2)} size=${positionSize.toFixed(2)} [ADX:${adxVal?.toFixed(2)} Vol:${volRatio.toFixed(2)} RSI:${rsiValues[i]?.toFixed(1)} Quality:${signalQuality}]`);
        }
      }

      // 5.8 Update equity curve
      let unrealized = 0;
      if (position) {
        unrealized = this.calculatePnL(entryPrice, price, positionSize, position, 0);
      }
      equity.push({ timestamp: candle.timestamp, value: balance + unrealized });
    }

    // 6. Finalize: close open position at last candle
    if (position) {
      const last = historicalData[historicalData.length - 1];
      const pnl  = this.calculatePnL(entryPrice, last.close, positionSize, position, params.commissionRate || 0.001);
      balance += pnl;
      trades.push({
        type: position,
        entryPrice,
        exitPrice: last.close,
        entryTime: historicalData[historicalData.length - 2].timestamp,
        exitTime: last.timestamp,
        pnl,
        positionSize,
        returnPct: (pnl / positionSize) * 100,
        commission: positionSize * (params.commissionRate || 0.001) * 2
      });
      equity.push({ timestamp: last.timestamp, value: balance });
      position = null;
      console.log(`🔚 FINAL EXIT @${last.close.toFixed(2)} PnL=${pnl.toFixed(2)}`);
    }

    // 7. Metrics
    const totalReturn = ((balance - initialBal) / initialBal) * 100;
    const winTrades   = trades.filter(t => t.pnl > 0).length;
    const winRate     = trades.length ? (winTrades / trades.length) * 100 : 0;
    const maxDD       = this.calculateMaxDrawdown(equity);

    console.log(`✅ Backtest complete: ${trades.length} trades, ${totalReturn.toFixed(2)}% return, Win rate ${winRate.toFixed(1)}%, MaxDD ${maxDD.toFixed(1)}%`);

    const result = {
      params, startTime: historicalData[0].timestamp,
      endTime: historicalData.at(-1).timestamp,
      trades, signals, equity,
      metrics: { totalReturn, winRate, maxDrawdown: maxDD }
    };

    // 8. Persist to Redis
    if (this.redisClient?.set) {
      try {
        await this.redisClient.set('backtest:' + Date.now(), JSON.stringify(result));
      } catch (e) {
        console.warn('Redis save failed:', e.message);
      }
    }

    return result;
  }

  // --- Utility & signal methods below ---

  async generateHistoricalData(pair, timeframe, startDate, endDate) {
    console.log(`🔄 Fetching real market data from BingX: ${pair} ${timeframe} from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
    
    try {
      // Try to get real data from BingX first
      const realData = await this.fetchBingXHistoricalData(pair, timeframe, startDate, endDate);
      if (realData && realData.length > 100) {
        console.log(`✅ Using ${realData.length} real market candles from BingX`);
        return realData;
      }
    } catch (error) {
      console.warn(`⚠️ Failed to fetch BingX data: ${error.message}`);
      console.log(`🔄 Falling back to enhanced synthetic data...`);
    }

    // Fallback to enhanced synthetic data with realistic patterns
    return this.generateEnhancedSyntheticData(pair, timeframe, startDate, endDate);
  }

  async fetchBingXHistoricalData(pair, timeframe, startDate, endDate) {
    try {
      // Convert pair format: BTC-USDT -> BTC-USDT (BingX format)
      const symbol = pair.replace('-', '-');
      
      // Convert timeframe to BingX format
      const interval = this.convertTimeframeToBingX(timeframe);
      
      // Calculate start and end timestamps
      const startTime = startDate.getTime();
      const endTime = endDate.getTime();
      
      // BingX Futures klines endpoint parameters (correct endpoint)
      const params = {
        symbol: symbol,
        interval: interval,
        startTime: startTime.toString(),
        limit: '1000'  // Maximum allowed by BingX as string
      };

      console.log(`📡 Requesting BingX real data:`, params);
      
      // Use correct BingX Futures endpoint
      const response = await this.bingxClient.makeRequest('/openApi/swap/v3/quote/klines', 'GET', params);
      
      if (!response || !response.data || !Array.isArray(response.data)) {
        throw new Error('Invalid response format from BingX API');
      }

      // Convert BingX object format to our format
      const data = response.data.map(candle => ({
        timestamp: parseInt(candle.time),    // BingX uses 'time' field
        open: parseFloat(candle.open),       // Open price
        high: parseFloat(candle.high),       // High price
        low: parseFloat(candle.low),         // Low price
        close: parseFloat(candle.close),     // Close price
        volume: parseFloat(candle.volume)    // Volume
      }));

      // Filter by date range (double check)
      const filteredData = data.filter(candle => 
        candle.timestamp >= startTime && candle.timestamp <= endTime
      );

      console.log(`✅ Successfully fetched ${filteredData.length} REAL market candles from BingX`);
      console.log(`📅 Date range: ${new Date(filteredData[0]?.timestamp).toISOString().split('T')[0]} to ${new Date(filteredData[filteredData.length-1]?.timestamp).toISOString().split('T')[0]}`);
      return filteredData;

    } catch (error) {
      console.error(`❌ BingX API Error:`, error.message);
      console.error(`Error details:`, error.response?.data || error.message);
      throw error;
    }
  }

  convertTimeframeToBingX(timeframe) {
    const mapping = {
      '1m': '1m',
      '5m': '5m', 
      '15m': '15m',
      '1h': '1h',
      '4h': '4h',
      '1d': '1d'
    };
    return mapping[timeframe] || '4h';
  }

  generateEnhancedSyntheticData(pair, timeframe, startDate, endDate) {
    console.log(`🎲 Generating enhanced synthetic data with realistic market patterns...`);
    
    const data = [];
    let currentTime = new Date(startDate);
    let price = 30000; 
    const intervalMs = this.getIntervalMs(timeframe);

    // Enhanced market simulation with realistic patterns
    let trendDir = 1, trendDur = 0, maxTrend = 50 + Math.random() * 100;
    let volatility = 0.01; // Base volatility
    let manipulationPhase = false;
    let manipulationCounter = 0;
    
    while (currentTime <= endDate) {
      // Trend changes
      if (trendDur > maxTrend) {
        trendDir *= -1;
        trendDur = 0;
        maxTrend = 30 + Math.random() * 80;
        volatility = 0.005 + Math.random() * 0.015; // Reset volatility
      }

      // Simulate market manipulation periods (10% chance)
      if (Math.random() < 0.001 && !manipulationPhase) {
        manipulationPhase = true;
        manipulationCounter = 5 + Math.random() * 15; // 5-20 candles
        volatility *= 3; // High volatility during manipulation
        console.log(`🚨 Simulating market manipulation phase for ${manipulationCounter} candles`);
      }

      if (manipulationPhase) {
        manipulationCounter--;
        if (manipulationCounter <= 0) {
          manipulationPhase = false;
          volatility /= 3; // Return to normal volatility
          console.log(`✅ Manipulation phase ended, returning to normal volatility`);
        }
      }

      // Price components
      const trendComp = trendDir * (0.3 + Math.random() * 0.7) * 0.001;
      const noiseComp = (Math.random() - 0.5) * volatility;
      
      // Manipulation spikes (high strength signals)
      const manipulationSpike = manipulationPhase ? 
        (Math.random() - 0.5) * 0.03 * (Math.random() > 0.7 ? 1 : 0) : 0;
      
      // Regular market spikes (lower probability and strength)
      const regularSpike = !manipulationPhase && Math.random() < 0.02 ? 
        (Math.random() - 0.5) * 0.015 : 0;

      price = Math.min(200000, Math.max(1000, 
        price * (1 + trendComp + noiseComp + manipulationSpike + regularSpike)
      ));

      // Create realistic OHLCV
      const open = data.at(-1)?.close ?? price;
      const volatilityRange = price * volatility * 0.5;
      const high = price + Math.random() * volatilityRange;
      const low = price - Math.random() * volatilityRange;
      const close = price;
      
      // Volume spikes during manipulation
      const baseVolume = 1e6 + Math.random() * 3e6;
      const volume = manipulationPhase ? 
        baseVolume * (2 + Math.random() * 3) : // High volume during manipulation
        baseVolume;

      data.push({ 
        timestamp: currentTime.getTime(), 
        open, high, low, close, volume 
      });
      
      currentTime = new Date(currentTime.getTime() + intervalMs);
      trendDur++;
    }
    
    console.log(`🎲 Generated ${data.length} enhanced synthetic candles with realistic manipulation patterns`);
    return data;
  }

  getIntervalMs(tf) {
    return {
      '1m': 60e3, '5m': 5*60e3, '15m':15*60e3,
      '1h': 60*60e3, '4h':4*60*60e3, '1d':24*60*60e3
    }[tf] || 60*60e3;
  }

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

  // W/M pattern detection con umbrales más permisivos
  detectWMPatterns(prices, rsi, tol=10, low=30, high=70) {
    if (rsi.length < 5) return null;
    const order = 2;
    const minima = this.findLocalExtrema(rsi,'minima',order);
    const maxima = this.findLocalExtrema(rsi,'maxima',order);
    const i = rsi.length-1;
    if (minima.includes(i-1)||minima.includes(i-2)) {
      const idx = minima.includes(i-1)?i-1:i-2;
      if (rsi[idx] < low + tol) {
        return { type:'bullish', strength:Math.min(1,(low+tol-rsi[idx])/20), confidence:0.8, source:'W', pattern:'W', rsi:rsi[idx] };
      }
    }
    if (maxima.includes(i-1)||maxima.includes(i-2)) {
      const idx = maxima.includes(i-1)?i-1:i-2;
      if (rsi[idx] > high - tol) {
        return { type:'bearish', strength:Math.min(1,(rsi[idx]-(high-tol))/20), confidence:0.8, source:'M', pattern:'M', rsi:rsi[idx] };
      }
    }
    return null;
  }

  // Volume analysis con validación de momentum
  analyzeVolumePattern(data, idx) {
    if (data.length<5||idx<4) return null;
    const curr = data[idx], prev = data.slice(idx-4,idx);
    const avg = prev.reduce((sum,c)=>sum+c.volume,0)/4;
    const ratio = curr.volume/avg;
    const change= (curr.close-curr.open)/curr.open;
    
    // Calcular momentum reciente
    const recentMomentum = (curr.close - data[idx-2].close) / data[idx-2].close;
    
    if (ratio>1.3) {  // Volumen elevado
      // Para señal alcista: volumen alto + momentum positivo pero no excesivo
      if (change>0.005 && recentMomentum < 0.03) { // No más del 3% en 2 velas
        return { type:'bullish', strength:Math.min(ratio/2.5,0.8), confidence:0.7, source:'vol+', volumeRatio:ratio };
      }
      // Para señal bajista: volumen alto + momentum negativo pero no excesivo
      if (change< -0.005 && recentMomentum > -0.03) { // No menos del -3% en 2 velas
        return { type:'bearish', strength:Math.min(ratio/2.5,0.8), confidence:0.7, source:'vol-', volumeRatio:ratio };
      }
    }
    return null;
  }

  // Candlestick patterns
  analyzeCandlestickPatterns(data, idx) {
    if (data.length<3||idx<2) return null;
    const c = data[idx], p = data[idx-1];
    const body = Math.abs(c.close-c.open);
    const total= c.high-c.low;
    const up   = c.high - Math.max(c.close,c.open);
    const down = Math.min(c.close,c.open) - c.low;
    if (body< total*0.1 && up>body*2 && down>body*2) return { type:'neutral', strength:0.3, confidence:0.6, source:'doji' };
    if (down>body*2 && up<body*0.5) return { type:'bullish', strength:0.6, confidence:0.7, source:'hammer' };
    if (up>body*2 && down<body*0.5) return { type:'bearish', strength:0.6, confidence:0.7, source:'shooting_star' };
    // engulfing
    const prevBody = Math.abs(p.close-p.open);
    if (p.close<p.open && c.close>c.open && body>prevBody*1.2 && c.close>p.open && c.open<p.close) {
      return { type:'bullish', strength:0.8, confidence:0.8, source:'bullish_engulfing' };
    }
    if (p.close>p.open && c.close<c.open && body>prevBody*1.2 && c.close<p.open && c.open>p.close) {
      return { type:'bearish', strength:0.8, confidence:0.8, source:'bearish_engulfing' };
    }
    return null;
  }

  // Trend-following con RSI y momentum: evitar entrar contra momentum fuerte
  detectTrendSignal(data, currentRsi, idx) {
    if (data.length<10) return null;
    const prices = data.map(c=>c.close);
    const sma5 = prices.slice(-5).reduce((a,b)=>a+b)/5;
    const sma10= prices.slice(-10,-5).reduce((a,b)=>a+b)/5;
    const price= prices.at(-1);
    const str  = Math.abs((sma5 - sma10)/sma10);
    
    // Calcular momentum reciente (cambio en 3 períodos)
    const recentMomentum = data.length >= 4 ? (price - data[data.length-4].close) / data[data.length-4].close : 0;
    
    // Solo señal bullish si RSI < 30 Y momentum bajista se está debilitando
    if (sma5>sma10 && price> sma5 && currentRsi < 30 && recentMomentum > -0.03) {
      return { type:'bullish', strength:Math.min(str*5,0.8), confidence:0.75, source:'trend' };
    }
    // Solo señal bearish si RSI > 70 Y momentum alcista se está debilitando
    if (sma5<sma10 && price< sma5 && currentRsi > 70 && recentMomentum < 0.03) {
      return { type:'bearish', strength:Math.min(str*5,0.8), confidence:0.75, source:'trend' };
    }
    return null;
  }

  // Simplified combination
  combineSignalsSimplified(...signals) {
    const s = signals.filter(x=>x);
    if (!s.length) return null;
    const bulls = s.filter(x=>x.type==='bullish');
    const bears = s.filter(x=>x.type==='bearish');
    if (bulls.length>=1) {
      const strong = bulls.find(x=>x.strength>0.4);
      if (strong||bulls.length>=2) {
        const avgS = bulls.reduce((a,b)=>a+b.strength,0)/bulls.length;
        const avgC = bulls.reduce((a,b)=>a+b.confidence,0)/bulls.length;
        return { type:'bullish', strength:avgS, confidence:avgC, source:'combined', confirmations:bulls.length };
      }
    }
    if (bears.length>=1) {
      const strong = bears.find(x=>x.strength>0.4);
      if (strong||bears.length>=2) {
        const avgS = bears.reduce((a,b)=>a+b.strength,0)/bears.length;
        const avgC = bears.reduce((a,b)=>a+b.confidence,0)/bears.length;
        return { type:'bearish', strength:avgS, confidence:avgC, source:'combined', confirmations:bears.length };
      }
    }
    return null;
  }

  // Local extrema helper
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

  // Divergence detection
  detectDivergence(priceData, rsiData, minStr=0.1) {
    const piv = this.findPivots(priceData.map(c=>c.close));
    const rPiv= this.findPivots(rsiData);
    const bull= this.checkBullishDivergence(piv, rPiv, minStr);
    if (bull) return bull;
    const bear= this.checkBearishDivergence(piv, rPiv, minStr);
    if (bear) return bear;
    return null;
  }
  findPivots(arr, look=2) {
    const piv = { highs:[], lows:[] };
    for (let i=look; i< arr.length-look; i++) {
      let isH=true, isL=true;
      for (let j=1; j<=look; j++) {
        if (arr[i]<=arr[i-j]||arr[i]<=arr[i+j]) isH=false;
        if (arr[i]>=arr[i-j]||arr[i]>=arr[i+j]) isL=false;
      }
      if (isH) piv.highs.push({ index:i, value:arr[i] });
      if (isL) piv.lows.push({ index:i, value:arr[i] });
    }
    return piv;
  }
  checkBullishDivergence(pp, rp, minStr) {
    const pl=pp.lows.slice(-2), rl=rp.lows.slice(-2);
    if (pl.length<2||rl.length<2) return null;
    if (pl[1].value<pl[0].value && rl[1].value>rl[0].value) {
      const str = Math.abs((pl[0].value-pl[1].value)/pl[0].value);
      if (str>=minStr) return { type:'bullish', strength:Math.min(str,1), confidence:0.7, source:'divergence' };
    }
    return null;
  }
  checkBearishDivergence(pp, rp, minStr) {
    const ph=pp.highs.slice(-2), rh=rp.highs.slice(-2);
    if (ph.length<2||rh.length<2) return null;
    if (ph[1].value>ph[0].value && rh[1].value<rh[0].value) {
      const str = Math.abs((ph[1].value-ph[0].value)/ph[0].value);
      if (str>=minStr) return { type:'bearish', strength:Math.min(str,1), confidence:0.7, source:'divergence' };
    }
    return null;
  }

  // RSI extremos con validación de momentum
  detectRSIExtremes(rsi, minStr=0.02) {
    if (rsi > 70) {  // Sobrecompra moderada
      const str = Math.min((rsi-70)/30,1)*0.8;  // Fuerza aumentada para extremos
      if (str>=minStr) return { type:'bearish', strength:str, confidence:str*0.8, source:'rsi_overbought' }; // Reducir confianza hasta validar momentum
    }
    if (rsi < 30) {  // Sobreventa moderada
      const str = Math.min((30-rsi)/30,1)*0.8;  // Fuerza aumentada para extremos
      if (str>=minStr) return { type:'bullish', strength:str, confidence:str*0.8, source:'rsi_oversold' }; // Reducir confianza hasta validar momentum
    }
    return null;
  }

  // PnL calc
  calculatePnL(entry, exit, size, type, comm=0.001) {
    const raw = type==='bullish'
      ? ((exit-entry)/entry)*size
      : ((entry-exit)/entry)*size;
    return raw - (size * comm * 2);
  }

  // Position sizing
  calculatePositionSize(balance, signal, rsi=50) {
    const risk = balance * 0.003;  // Aún más conservador para compensar stops amplios
    let lev = 8;  // Leverage reducido debido a stops más amplios
    
    // Adjust leverage based on signal quality
    if (signal.strength < 0.4) lev = 6;  // Muy conservador para señales débiles
    if (signal.strength > 0.8) lev = 10; // Moderado para señales muy fuertes
    
    // Bonus for high-quality signals but más conservador
    if (signal.source === 'trend' && signal.strength > 0.6) lev = Math.min(12, lev * 1.2);
    if (signal.source === 'combined' && signal.confirmations >= 3) lev = Math.min(11, lev * 1.1);
    
    // Penalty for extreme RSI (reduce size when overbought/oversold)
    if ((signal.type === 'bullish' && rsi > 65) || (signal.type === 'bearish' && rsi < 35)) {
      lev = Math.max(5, lev * 0.7);
    }
    
    console.log(`📊 Sizing: risk=${risk.toFixed(2)}, lev=${lev}x, strength=${signal.strength.toFixed(2)}`);
    return risk * lev;
  }

  // Max drawdown
  calculateMaxDrawdown(equity) {
    let peak = equity[0].value, maxDD = 0;
    for (let e of equity) {
      if (e.value > peak) peak = e.value;
      else {
        const dd = (peak - e.value) / peak;
        if (dd > maxDD) maxDD = dd;
      }
    }
    return maxDD * 100;
  }

  // Redis retrieval helpers
  async getBacktestHistory() {
    if (!this.redisClient?.keys) return [];
    const keys = await this.redisClient.keys('backtest:*');
    const res = [];
    for (let k of keys) {
      const j = await this.redisClient.get(k);
      if (j) res.push(JSON.parse(j));
    }
    return res.sort((a,b)=>new Date(b.completedAt) - new Date(a.completedAt));
  }

  async getBacktestById(id) {
    if (!this.redisClient?.get) return null;
    const j = await this.redisClient.get('backtest:' + id);
    return j ? JSON.parse(j) : null;
  }
}

module.exports = BacktestingEngine;
