const Decimal = require('decimal.js');
const logger = require('./logger');
const config = require('./config');

class PositionCalculator {
  constructor() {
    this.precision = 8;
  }

  /**
   * Calculate position size based on 2% risk rule
   * @param {number} accountBalance - Total account balance
   * @param {number} entryPrice - Entry price for the position
   * @param {number} stopLoss - Stop loss price
   * @param {number} riskPercent - Risk percentage (default: 2%)
   * @returns {Object} Position sizing information
   */
  calculatePositionSize(accountBalance, entryPrice, stopLoss, riskPercent = 0.02) {
    try {
      // Validate inputs
      if (!accountBalance || !entryPrice || !stopLoss || accountBalance <= 0 || entryPrice <= 0) {
        throw new Error('Invalid inputs for position size calculation');
      }

      // Ensure risk doesn't exceed maximum allowed
      const maxRisk = config.trading.maxAccountRisk;
      if (riskPercent > maxRisk) {
        logger.risk(`Risk ${riskPercent} exceeds maximum ${maxRisk}, using maximum`);
        riskPercent = maxRisk;
      }

      // Calculate risk amount in dollars
      const riskAmount = new Decimal(accountBalance).times(riskPercent);

      // Calculate price difference (risk per unit)
      const isLong = stopLoss < entryPrice;
      const priceRisk = isLong 
        ? new Decimal(entryPrice).minus(stopLoss)
        : new Decimal(stopLoss).minus(entryPrice);

      if (priceRisk.lte(0)) {
        throw new Error('Invalid stop loss: must be different from entry price');
      }

      // Calculate position size in units
      const positionSizeUnits = riskAmount.dividedBy(priceRisk);

      // Calculate position value
      const positionValue = positionSizeUnits.times(entryPrice);

      // Apply maximum position size constraints
      const maxPositionValue = new Decimal(accountBalance).times(config.riskManagement.maxConcentration);
      const finalPositionValue = Decimal.min(positionValue, maxPositionValue);
      const finalPositionSize = finalPositionValue.dividedBy(entryPrice);

      // Calculate actual risk percentage
      const actualRiskAmount = finalPositionSize.times(priceRisk);
      const actualRiskPercent = actualRiskAmount.dividedBy(accountBalance);

      // Calculate leverage if applicable
      const leverage = finalPositionValue.dividedBy(accountBalance);

      const result = {
        positionSizeUnits: parseFloat(finalPositionSize.toFixed(this.precision)),
        positionValue: parseFloat(finalPositionValue.toFixed(2)),
        riskAmount: parseFloat(actualRiskAmount.toFixed(2)),
        riskPercent: parseFloat(actualRiskPercent.times(100).toFixed(4)),
        leverage: parseFloat(leverage.toFixed(2)),
        priceRisk: parseFloat(priceRisk.toFixed(this.precision)),
        entryPrice: parseFloat(entryPrice),
        stopLoss: parseFloat(stopLoss),
        isLong: isLong
      };

      logger.info('Position size calculated:', result);
      return result;

    } catch (error) {
      logger.error('Error calculating position size:', error);
      return null;
    }
  }

  /**
   * Calculate stop loss and take profit levels
   * @param {number} entryPrice - Entry price
   * @param {boolean} isLong - Whether position is long
   * @param {number} stopLossPercent - Stop loss percentage (default: 1.5%)
   * @param {number} takeProfitPercent - Take profit percentage (default: 4%)
   * @returns {Object} Stop loss and take profit levels
   */
  calculateStopLossAndTakeProfit(entryPrice, isLong, stopLossPercent = 0.015, takeProfitPercent = 0.04) {
    try {
      const entry = new Decimal(entryPrice);
      
      let stopLoss, takeProfit;

      if (isLong) {
        // Long position: SL below entry, TP above entry
        stopLoss = entry.times(new Decimal(1).minus(stopLossPercent));
        takeProfit = entry.times(new Decimal(1).plus(takeProfitPercent));
      } else {
        // Short position: SL above entry, TP below entry
        stopLoss = entry.times(new Decimal(1).plus(stopLossPercent));
        takeProfit = entry.times(new Decimal(1).minus(takeProfitPercent));
      }

      // Calculate risk-reward ratio
      const riskDistance = isLong 
        ? entry.minus(stopLoss) 
        : stopLoss.minus(entry);
      const rewardDistance = isLong 
        ? takeProfit.minus(entry) 
        : entry.minus(takeProfit);
      
      const riskRewardRatio = rewardDistance.dividedBy(riskDistance);

      return {
        stopLoss: parseFloat(stopLoss.toFixed(this.precision)),
        takeProfit: parseFloat(takeProfit.toFixed(this.precision)),
        riskRewardRatio: parseFloat(riskRewardRatio.toFixed(2)),
        riskDistance: parseFloat(riskDistance.toFixed(this.precision)),
        rewardDistance: parseFloat(rewardDistance.toFixed(this.precision))
      };

    } catch (error) {
      logger.error('Error calculating stop loss and take profit:', error);
      return null;
    }
  }

  /**
   * Validate if position meets risk management criteria
   * @param {Object} position - Position details
   * @param {number} accountBalance - Account balance
   * @param {Array} currentPositions - Array of current open positions
   * @returns {Object} Validation result
   */
  validatePosition(position, accountBalance, currentPositions = []) {
    try {
      const validations = {
        isValid: true,
        errors: [],
        warnings: []
      };

      // Check risk percentage
      if (position.riskPercent > config.trading.maxAccountRisk * 100) {
        validations.errors.push(`Risk ${position.riskPercent}% exceeds maximum ${config.trading.maxAccountRisk * 100}%`);
        validations.isValid = false;
      }

      // Check maximum number of positions
      if (currentPositions.length >= config.riskManagement.maxOpenPositions) {
        validations.errors.push(`Maximum ${config.riskManagement.maxOpenPositions} positions already open`);
        validations.isValid = false;
      }

      // Check position concentration
      const currentValue = currentPositions.reduce((sum, pos) => sum + (pos.positionValue || 0), 0);
      const newTotalValue = currentValue + position.positionValue;
      const concentrationPercent = newTotalValue / accountBalance;

      if (concentrationPercent > config.riskManagement.maxConcentration) {
        validations.errors.push(`Total position concentration ${(concentrationPercent * 100).toFixed(2)}% exceeds maximum ${(config.riskManagement.maxConcentration * 100)}%`);
        validations.isValid = false;
      }

      // Check minimum position size
      const minPositionValue = accountBalance * 0.001; // 0.1% minimum
      if (position.positionValue < minPositionValue) {
        validations.warnings.push(`Position value $${position.positionValue} is very small (< 0.1% of account)`);
      }

      // Check risk-reward ratio
      const levels = this.calculateStopLossAndTakeProfit(position.entryPrice, position.isLong);
      if (levels && levels.riskRewardRatio < 2) {
        validations.warnings.push(`Risk-reward ratio ${levels.riskRewardRatio} is below recommended minimum of 2`);
      }

      // Check for correlated positions (if data available)
      const sameAssetPositions = currentPositions.filter(pos => 
        pos.pair && position.pair && pos.pair.split('-')[0] === position.pair.split('-')[0]
      );

      if (sameAssetPositions.length > 0) {
        validations.warnings.push(`Already have ${sameAssetPositions.length} position(s) in same asset`);
      }

      return validations;

    } catch (error) {
      logger.error('Error validating position:', error);
      return {
        isValid: false,
        errors: ['Position validation failed'],
        warnings: []
      };
    }
  }

  /**
   * Calculate trailing stop loss
   * @param {number} entryPrice - Original entry price
   * @param {number} currentPrice - Current market price
   * @param {number} currentStopLoss - Current stop loss level
   * @param {number} trailingPercent - Trailing percentage (default: 1%)
   * @param {boolean} isLong - Whether position is long
   * @returns {Object} New trailing stop loss information
   */
  calculateTrailingStopLoss(entryPrice, currentPrice, currentStopLoss, trailingPercent = 0.01, isLong = true) {
    try {
      const current = new Decimal(currentPrice);
      const currentSL = new Decimal(currentStopLoss);
      const trailing = new Decimal(trailingPercent);

      let newStopLoss;
      let shouldUpdate = false;

      if (isLong) {
        // For long positions, trail up only
        newStopLoss = current.times(new Decimal(1).minus(trailing));
        shouldUpdate = newStopLoss.gt(currentSL);
      } else {
        // For short positions, trail down only
        newStopLoss = current.times(new Decimal(1).plus(trailing));
        shouldUpdate = newStopLoss.lt(currentSL);
      }

      // Calculate profit at current price
      const entry = new Decimal(entryPrice);
      const unrealizedPnL = isLong 
        ? current.minus(entry).dividedBy(entry).times(100)
        : entry.minus(current).dividedBy(entry).times(100);

      return {
        newStopLoss: parseFloat(newStopLoss.toFixed(this.precision)),
        shouldUpdate: shouldUpdate,
        currentStopLoss: parseFloat(currentSL.toFixed(this.precision)),
        unrealizedPnLPercent: parseFloat(unrealizedPnL.toFixed(2)),
        trailingDistance: parseFloat(current.minus(newStopLoss).toFixed(this.precision))
      };

    } catch (error) {
      logger.error('Error calculating trailing stop loss:', error);
      return null;
    }
  }

  /**
   * Calculate portfolio risk metrics
   * @param {Array} positions - Array of open positions
   * @param {number} accountBalance - Total account balance
   * @returns {Object} Portfolio risk metrics
   */
  calculatePortfolioRisk(positions, accountBalance) {
    try {
      if (!positions || positions.length === 0) {
        return {
          totalRisk: 0,
          totalExposure: 0,
          riskPercent: 0,
          exposurePercent: 0,
          concentrationRisk: 0,
          correlationRisk: 0
        };
      }

      // Calculate total risk and exposure
      const totalRisk = positions.reduce((sum, pos) => sum + (pos.riskAmount || 0), 0);
      const totalExposure = positions.reduce((sum, pos) => sum + (pos.positionValue || 0), 0);

      // Calculate concentration by asset
      const assetExposure = {};
      positions.forEach(pos => {
        if (pos.pair) {
          const asset = pos.pair.split('-')[0];
          assetExposure[asset] = (assetExposure[asset] || 0) + pos.positionValue;
        }
      });

      const maxConcentration = Math.max(...Object.values(assetExposure)) / accountBalance;

      return {
        totalRisk: parseFloat(totalRisk.toFixed(2)),
        totalExposure: parseFloat(totalExposure.toFixed(2)),
        riskPercent: parseFloat((totalRisk / accountBalance * 100).toFixed(2)),
        exposurePercent: parseFloat((totalExposure / accountBalance * 100).toFixed(2)),
        concentrationRisk: parseFloat((maxConcentration * 100).toFixed(2)),
        positionCount: positions.length,
        assetExposure: assetExposure
      };

    } catch (error) {
      logger.error('Error calculating portfolio risk:', error);
      return null;
    }
  }

  /**
   * Check if new position would violate daily loss limits
   * @param {number} accountBalance - Current account balance
   * @param {number} dailyPnL - Today's P&L
   * @param {number} newPositionRisk - Risk amount of new position
   * @returns {boolean} Whether position is allowed
   */
  checkDailyLossLimits(accountBalance, dailyPnL, newPositionRisk) {
    try {
      const maxDailyLoss = accountBalance * config.riskManagement.maxDailyLoss;
      const potentialDailyLoss = Math.abs(Math.min(dailyPnL, 0)) + newPositionRisk;

      if (potentialDailyLoss > maxDailyLoss) {
        logger.risk('Daily loss limit would be exceeded', {
          currentDailyPnL: dailyPnL,
          newPositionRisk: newPositionRisk,
          potentialLoss: potentialDailyLoss,
          maxAllowed: maxDailyLoss
        });
        return false;
      }

      return true;
    } catch (error) {
      logger.error('Error checking daily loss limits:', error);
      return false;
    }
  }
}

// Export singleton instance
module.exports = new PositionCalculator();
