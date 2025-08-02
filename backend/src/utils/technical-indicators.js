const { RSI, SMA, EMA } = require('technicalindicators');
const Decimal = require('decimal.js');
const logger = require('./logger');

class TechnicalIndicators {
  constructor() {
    this.precision = 8; // Decimal precision for calculations
  }

  /**
   * Calculate RSI (Relative Strength Index) - TradingView compatible
   * @param {Array} prices - Array of closing prices
   * @param {number} period - RSI period (default: 14)
   * @returns {Array} RSI values
   */
  calculateRSI(prices, period = 14) {
    try {
      if (!prices || prices.length < period + 1) {
        logger.warn(`Insufficient data for RSI: ${prices?.length || 0} prices, need at least ${period + 1}`);
        return [];
      }

      // Convert to numbers and validate
      const validPrices = prices
        .map(price => parseFloat(price))
        .filter(price => !isNaN(price) && price > 0);

      if (validPrices.length < period + 1) {
        logger.warn(`Insufficient valid prices for RSI: ${validPrices.length}, need at least ${period + 1}`);
        return [];
      }

      logger.info(`Calculating RSI with ${validPrices.length} prices, period: ${period}`);
      logger.info(`Price range: ${validPrices[0].toFixed(2)} to ${validPrices[validPrices.length - 1].toFixed(2)}`);

      // Calculate price changes
      const changes = [];
      for (let i = 1; i < validPrices.length; i++) {
        changes.push(validPrices[i] - validPrices[i - 1]);
      }

      // Separate gains and losses
      const gains = changes.map(change => change > 0 ? change : 0);
      const losses = changes.map(change => change < 0 ? Math.abs(change) : 0);

      const rsiValues = [];

      // Calculate initial averages (SMA for first value)
      let avgGain = gains.slice(0, period).reduce((sum, gain) => sum + gain, 0) / period;
      let avgLoss = losses.slice(0, period).reduce((sum, loss) => sum + loss, 0) / period;

      logger.info(`Initial averages - avgGain: ${avgGain.toFixed(6)}, avgLoss: ${avgLoss.toFixed(6)}`);

      // Calculate first RSI value
      if (avgLoss === 0) {
        rsiValues.push(100);
      } else {
        const rs = avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));
        rsiValues.push(rsi);
        logger.info(`First RSI: ${rsi.toFixed(2)} (RS: ${rs.toFixed(6)})`);
      }

      // Calculate subsequent RSI values using Wilder's smoothing (EMA)
      for (let i = period; i < changes.length; i++) {
        const currentGain = gains[i];
        const currentLoss = losses[i];

        // Wilder's smoothing formula: ((previous * (period - 1)) + current) / period
        avgGain = ((avgGain * (period - 1)) + currentGain) / period;
        avgLoss = ((avgLoss * (period - 1)) + currentLoss) / period;

        if (avgLoss === 0) {
          rsiValues.push(100);
        } else {
          const rs = avgGain / avgLoss;
          const rsi = 100 - (100 / (1 + rs));
          rsiValues.push(rsi);
          
          // Log the last few calculations
          if (i >= changes.length - 3) {
            logger.info(`RSI[${i}]: ${rsi.toFixed(2)} (avgGain: ${avgGain.toFixed(6)}, avgLoss: ${avgLoss.toFixed(6)}, RS: ${rs.toFixed(6)})`);
          }
        }
      }

      const finalRSI = rsiValues[rsiValues.length - 1];
      logger.info(`Final RSI calculation complete: ${finalRSI?.toFixed(2)} (${rsiValues.length} values)`);

      return rsiValues.map(value => parseFloat(new Decimal(value).toFixed(this.precision)));
    } catch (error) {
      logger.error('Error calculating RSI:', error);
      return [];
    }
  }

  /**
   * Calculate Simple Moving Average
   * @param {Array} values - Array of values
   * @param {number} period - SMA period
   * @returns {Array} SMA values
   */
  calculateSMA(values, period) {
    try {
      if (!values || values.length < period) {
        return [];
      }

      const validValues = values
        .map(value => parseFloat(value))
        .filter(value => !isNaN(value));

      if (validValues.length < period) {
        return [];
      }

      const smaValues = SMA.calculate({
        values: validValues,
        period: period
      });

      return smaValues.map(value => parseFloat(new Decimal(value).toFixed(this.precision)));
    } catch (error) {
      logger.error('Error calculating SMA:', error);
      return [];
    }
  }

  /**
   * Calculate Exponential Moving Average
   * @param {Array} values - Array of values
   * @param {number} period - EMA period
   * @returns {Array} EMA values
   */
  calculateEMA(values, period) {
    try {
      if (!values || values.length < period) {
        return [];
      }

      const validValues = values
        .map(value => parseFloat(value))
        .filter(value => !isNaN(value));

      if (validValues.length < period) {
        return [];
      }

      const emaValues = EMA.calculate({
        values: validValues,
        period: period
      });

      return emaValues.map(value => parseFloat(new Decimal(value).toFixed(this.precision)));
    } catch (error) {
      logger.error('Error calculating EMA:', error);
      return [];
    }
  }

  /**
   * Find local extremes (peaks and troughs) in price data
   * @param {Array} prices - Array of price objects with timestamp and price
   * @param {number} lookback - Number of periods to look back for extremes
   * @returns {Object} Object containing peaks and troughs
   */
  findLocalExtremes(prices, lookback = 5) {
    try {
      if (!prices || prices.length < lookback * 2 + 1) {
        return { peaks: [], troughs: [] };
      }

      const peaks = [];
      const troughs = [];

      for (let i = lookback; i < prices.length - lookback; i++) {
        const currentPrice = parseFloat(prices[i].price);
        let isPeak = true;
        let isTrough = true;

        // Check if current point is a peak or trough
        for (let j = 1; j <= lookback; j++) {
          const leftPrice = parseFloat(prices[i - j].price);
          const rightPrice = parseFloat(prices[i + j].price);

          if (currentPrice <= leftPrice || currentPrice <= rightPrice) {
            isPeak = false;
          }
          if (currentPrice >= leftPrice || currentPrice >= rightPrice) {
            isTrough = false;
          }
        }

        if (isPeak) {
          peaks.push({
            index: i,
            timestamp: prices[i].timestamp,
            price: currentPrice
          });
        }

        if (isTrough) {
          troughs.push({
            index: i,
            timestamp: prices[i].timestamp,
            price: currentPrice
          });
        }
      }

      return { peaks, troughs };
    } catch (error) {
      logger.error('Error finding local extremes:', error);
      return { peaks: [], troughs: [] };
    }
  }

  /**
   * Find local extremes in RSI data
   * @param {Array} rsiData - Array of RSI objects with timestamp and rsi
   * @param {number} lookback - Number of periods to look back
   * @returns {Object} Object containing RSI peaks and troughs
   */
  findRSIExtremes(rsiData, lookback = 5) {
    try {
      if (!rsiData || rsiData.length < lookback * 2 + 1) {
        return { peaks: [], troughs: [] };
      }

      const peaks = [];
      const troughs = [];

      for (let i = lookback; i < rsiData.length - lookback; i++) {
        const currentRSI = parseFloat(rsiData[i].rsi);
        let isPeak = true;
        let isTrough = true;

        for (let j = 1; j <= lookback; j++) {
          const leftRSI = parseFloat(rsiData[i - j].rsi);
          const rightRSI = parseFloat(rsiData[i + j].rsi);

          if (currentRSI <= leftRSI || currentRSI <= rightRSI) {
            isPeak = false;
          }
          if (currentRSI >= leftRSI || currentRSI >= rightRSI) {
            isTrough = false;
          }
        }

        if (isPeak) {
          peaks.push({
            index: i,
            timestamp: rsiData[i].timestamp,
            rsi: currentRSI
          });
        }

        if (isTrough) {
          troughs.push({
            index: i,
            timestamp: rsiData[i].timestamp,
            rsi: currentRSI
          });
        }
      }

      return { peaks, troughs };
    } catch (error) {
      logger.error('Error finding RSI extremes:', error);
      return { peaks: [], troughs: [] };
    }
  }

  /**
   * Calculate volume moving average
   * @param {Array} volumeData - Array of volume data
   * @param {number} period - Moving average period
   * @returns {Array} Volume MA values
   */
  calculateVolumeMA(volumeData, period = 20) {
    try {
      if (!volumeData || volumeData.length < period) {
        return [];
      }

      const volumes = volumeData.map(data => parseFloat(data.volume));
      return this.calculateSMA(volumes, period);
    } catch (error) {
      logger.error('Error calculating volume MA:', error);
      return [];
    }
  }

  /**
   * Calculate volume ratio (current volume vs average)
   * @param {number} currentVolume - Current volume
   * @param {number} averageVolume - Average volume
   * @returns {number} Volume ratio
   */
  calculateVolumeRatio(currentVolume, averageVolume) {
    try {
      if (!currentVolume || !averageVolume || averageVolume === 0) {
        return 1;
      }

      const ratio = new Decimal(currentVolume).dividedBy(new Decimal(averageVolume));
      return parseFloat(ratio.toFixed(this.precision));
    } catch (error) {
      logger.error('Error calculating volume ratio:', error);
      return 1;
    }
  }

  /**
   * Calculate percentage change between two values
   * @param {number} oldValue - Previous value
   * @param {number} newValue - Current value
   * @returns {number} Percentage change
   */
  calculatePercentageChange(oldValue, newValue) {
    try {
      if (!oldValue || oldValue === 0) {
        return 0;
      }

      const change = new Decimal(newValue)
        .minus(new Decimal(oldValue))
        .dividedBy(new Decimal(oldValue))
        .times(100);

      return parseFloat(change.toFixed(4));
    } catch (error) {
      logger.error('Error calculating percentage change:', error);
      return 0;
    }
  }

  /**
   * Normalize value to 0-1 range
   * @param {number} value - Value to normalize
   * @param {number} min - Minimum value in range
   * @param {number} max - Maximum value in range
   * @returns {number} Normalized value
   */
  normalize(value, min, max) {
    try {
      if (max === min) {
        return 0.5;
      }

      const normalized = new Decimal(value)
        .minus(new Decimal(min))
        .dividedBy(new Decimal(max).minus(new Decimal(min)));

      return Math.max(0, Math.min(1, parseFloat(normalized.toFixed(this.precision))));
    } catch (error) {
      logger.error('Error normalizing value:', error);
      return 0.5;
    }
  }

  /**
   * Calculate correlation between two data series
   * @param {Array} series1 - First data series
   * @param {Array} series2 - Second data series
   * @returns {number} Correlation coefficient (-1 to 1)
   */
  calculateCorrelation(series1, series2) {
    try {
      if (!series1 || !series2 || series1.length !== series2.length || series1.length < 2) {
        return 0;
      }

      const n = series1.length;
      const sum1 = series1.reduce((sum, val) => sum + val, 0);
      const sum2 = series2.reduce((sum, val) => sum + val, 0);
      const sum1Sq = series1.reduce((sum, val) => sum + val * val, 0);
      const sum2Sq = series2.reduce((sum, val) => sum + val * val, 0);
      const sumProducts = series1.reduce((sum, val, i) => sum + val * series2[i], 0);

      const numerator = n * sumProducts - sum1 * sum2;
      const denominator = Math.sqrt((n * sum1Sq - sum1 * sum1) * (n * sum2Sq - sum2 * sum2));

      if (denominator === 0) {
        return 0;
      }

      const correlation = numerator / denominator;
      return Math.max(-1, Math.min(1, correlation));
    } catch (error) {
      logger.error('Error calculating correlation:', error);
      return 0;
    }
  }

  /**
   * Validate indicator input data
   * @param {Array} data - Input data array
   * @param {number} minLength - Minimum required length
   * @returns {boolean} Whether data is valid
   */
  validateData(data, minLength = 1) {
    if (!Array.isArray(data)) {
      return false;
    }

    if (data.length < minLength) {
      return false;
    }

    // Check if all values are valid numbers
    return data.every(value => {
      const num = parseFloat(value);
      return !isNaN(num) && isFinite(num);
    });
  }
}

// Export singleton instance
module.exports = new TechnicalIndicators();
