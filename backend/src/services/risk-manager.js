const uuid = require('uuid');
const Decimal = require('decimal.js');
const positionCalculator = require('../utils/position-calculator');
const redisClient = require('../utils/redis-client');
const logger = require('../utils/logger');
const config = require('../utils/config');

class RiskManager {
  constructor() {
    this.positions = new Map(); // Active positions
    this.dailyPnL = 0;
    this.weeklyPnL = 0;
    this.accountBalance = 10000; // Default balance, should be updated from portfolio
    this.emergencyStopTriggered = false;
    this.dailyLossLimitReached = false;
    this.weeklyLossLimitReached = false;
  }

  /**
   * Initialize the risk manager
   */
  async initialize() {
    try {
      logger.info('Initializing Risk Manager...');
      
      // Load current portfolio balance
      await this.updateAccountBalance();
      
      // Load existing positions from Redis
      await this.loadExistingPositions();
      
      // Subscribe to portfolio updates
      await redisClient.subscribe('portfolio-updates', (data) => {
        this.handlePortfolioUpdate(data);
      });

      // Subscribe to trade executions
      await redisClient.subscribe('trade-executed', (data) => {
        this.handleTradeExecution(data);
      });

      logger.info('✅ Risk Manager initialized');
    } catch (error) {
      logger.error('Failed to initialize Risk Manager:', error);
      throw error;
    }
  }

  /**
   * Update account balance from portfolio service
   */
  async updateAccountBalance() {
    try {
      const portfolio = await redisClient.getPortfolioBalance();
      this.accountBalance = portfolio.balance || 10000;
      
      logger.info(`Account balance updated: $${this.accountBalance.toFixed(2)}`);
    } catch (error) {
      logger.error('Failed to update account balance:', error);
    }
  }

  /**
   * Load existing positions from storage
   */
  async loadExistingPositions() {
    try {
      // This would load from Redis or database in production
      // For now, starting with empty positions
      this.positions.clear();
      
      logger.info('Existing positions loaded');
    } catch (error) {
      logger.error('Failed to load existing positions:', error);
    }
  }

  /**
   * Validate if a new trade meets risk management criteria
   * @param {Object} tradeRequest - Trade request details
   * @returns {Object} Validation result
   */
  async validateTrade(tradeRequest) {
    try {
      const { pair, side, entryPrice, stopLoss, size } = tradeRequest;
      
      // Emergency stop check
      if (this.emergencyStopTriggered) {
        return {
          approved: false,
          reason: 'Emergency stop activated',
          riskLevel: 'CRITICAL'
        };
      }

      // Daily loss limit check
      if (this.dailyLossLimitReached) {
        return {
          approved: false,
          reason: 'Daily loss limit reached',
          riskLevel: 'HIGH'
        };
      }

      // Weekly loss limit check
      if (this.weeklyLossLimitReached) {
        return {
          approved: false,
          reason: 'Weekly loss limit reached',
          riskLevel: 'HIGH'
        };
      }

      // Check maximum open positions
      if (this.positions.size >= config.riskManagement.maxOpenPositions) {
        return {
          approved: false,
          reason: `Maximum ${config.riskManagement.maxOpenPositions} positions already open`,
          riskLevel: 'MEDIUM'
        };
      }

      // Calculate position size and risk
      const isLong = side === 'buy';
      const position = positionCalculator.calculatePositionSize(
        this.accountBalance,
        entryPrice,
        stopLoss,
        config.trading.maxAccountRisk
      );

      if (!position) {
        return {
          approved: false,
          reason: 'Position calculation failed',
          riskLevel: 'HIGH'
        };
      }

      // Validate position size
      const validation = positionCalculator.validatePosition(
        position,
        this.accountBalance,
        Array.from(this.positions.values())
      );

      if (!validation.isValid) {
        return {
          approved: false,
          reason: validation.errors.join(', '),
          riskLevel: 'HIGH',
          warnings: validation.warnings
        };
      }

      // Check daily loss limits
      const dailyLossOk = positionCalculator.checkDailyLossLimits(
        this.accountBalance,
        this.dailyPnL,
        position.riskAmount
      );

      if (!dailyLossOk) {
        return {
          approved: false,
          reason: 'Would exceed daily loss limit',
          riskLevel: 'HIGH'
        };
      }

      // Check for correlation risk
      const correlationRisk = this.checkCorrelationRisk(pair);
      if (correlationRisk.isHigh) {
        return {
          approved: false,
          reason: correlationRisk.reason,
          riskLevel: 'MEDIUM'
        };
      }

      // All checks passed
      return {
        approved: true,
        position: position,
        riskLevel: 'LOW',
        warnings: validation.warnings,
        correlationWarning: correlationRisk.warning
      };

    } catch (error) {
      logger.error('Error validating trade:', error);
      return {
        approved: false,
        reason: 'Risk validation failed',
        riskLevel: 'CRITICAL'
      };
    }
  }

  /**
   * Check correlation risk with existing positions
   * @param {string} pair - Trading pair to check
   * @returns {Object} Correlation risk assessment
   */
  checkCorrelationRisk(pair) {
    try {
      const asset = pair.split('-')[0];
      const existingPositions = Array.from(this.positions.values());
      
      // Count positions in same asset
      const sameAssetPositions = existingPositions.filter(pos => 
        pos.pair.split('-')[0] === asset
      );

      if (sameAssetPositions.length >= 2) {
        return {
          isHigh: true,
          reason: `Already have ${sameAssetPositions.length} positions in ${asset}`,
          warning: null
        };
      }

      // Check for highly correlated assets (simplified)
      const correlatedAssets = {
        'BTC': ['ETH'],
        'ETH': ['BTC'],
        // Add more correlations as needed
      };

      const correlated = correlatedAssets[asset] || [];
      const correlatedPositions = existingPositions.filter(pos => 
        correlated.includes(pos.pair.split('-')[0])
      );

      if (correlatedPositions.length > 0) {
        return {
          isHigh: false,
          reason: null,
          warning: `Potentially correlated with existing ${correlatedPositions.map(p => p.pair).join(', ')} positions`
        };
      }

      return {
        isHigh: false,
        reason: null,
        warning: null
      };

    } catch (error) {
      logger.error('Error checking correlation risk:', error);
      return { isHigh: false, reason: null, warning: null };
    }
  }

  /**
   * Add a new position to tracking
   * @param {Object} position - Position details
   */
  async addPosition(position) {
    try {
      const positionData = {
        id: position.id || uuid.v4(),
        pair: position.pair,
        side: position.side,
        entryPrice: position.entryPrice,
        size: position.size,
        stopLoss: position.stopLoss,
        takeProfit: position.takeProfit,
        riskAmount: position.riskAmount,
        timestamp: Date.now(),
        status: 'open'
      };

      this.positions.set(positionData.id, positionData);
      
      // Store in Redis
      await redisClient.storeTradeData(positionData);

      logger.risk(`Position added: ${position.side} ${position.size} ${position.pair}`, {
        riskAmount: position.riskAmount,
        riskPercent: ((position.riskAmount / this.accountBalance) * 100).toFixed(2)
      });

      // Update portfolio risk metrics
      await this.updatePortfolioRisk();

    } catch (error) {
      logger.error('Error adding position:', error);
    }
  }

  /**
   * Update an existing position
   * @param {string} positionId - Position ID
   * @param {Object} updates - Updates to apply
   */
  async updatePosition(positionId, updates) {
    try {
      const position = this.positions.get(positionId);
      
      if (!position) {
        logger.warn(`Position ${positionId} not found for update`);
        return;
      }

      // Apply updates
      Object.assign(position, updates);
      
      // Update in storage
      await redisClient.storeTradeData(position);

      logger.info(`Position ${positionId} updated:`, updates);

      // Update portfolio risk metrics
      await this.updatePortfolioRisk();

    } catch (error) {
      logger.error('Error updating position:', error);
    }
  }

  /**
   * Remove a position (when closed)
   * @param {string} positionId - Position ID
   */
  async removePosition(positionId) {
    try {
      const position = this.positions.get(positionId);
      
      if (!position) {
        logger.warn(`Position ${positionId} not found for removal`);
        return;
      }

      this.positions.delete(positionId);
      
      logger.info(`Position ${positionId} removed`);

      // Update portfolio risk metrics
      await this.updatePortfolioRisk();

    } catch (error) {
      logger.error('Error removing position:', error);
    }
  }

  /**
   * Update portfolio risk metrics
   */
  async updatePortfolioRisk() {
    try {
      const openPositions = Array.from(this.positions.values());
      const riskMetrics = positionCalculator.calculatePortfolioRisk(openPositions, this.accountBalance);

      // Store in Redis
      await redisClient.client.hset('portfolio:risk', {
        totalRisk: riskMetrics.totalRisk,
        totalExposure: riskMetrics.totalExposure,
        riskPercent: riskMetrics.riskPercent,
        exposurePercent: riskMetrics.exposurePercent,
        concentrationRisk: riskMetrics.concentrationRisk,
        positionCount: riskMetrics.positionCount,
        lastUpdate: Date.now()
      });

      // Check if emergency stop should be triggered
      this.checkEmergencyStop(riskMetrics);

    } catch (error) {
      logger.error('Error updating portfolio risk:', error);
    }
  }

  /**
   * Check if emergency stop should be triggered
   * @param {Object} riskMetrics - Current risk metrics
   */
  checkEmergencyStop(riskMetrics) {
    try {
      const totalLoss = this.dailyPnL < 0 ? Math.abs(this.dailyPnL) : 0;
      const totalLossPercent = totalLoss / this.accountBalance;

      // Trigger emergency stop if total loss exceeds limit
      if (totalLossPercent >= config.riskManagement.emergencyStopLoss) {
        this.triggerEmergencyStop('Total loss limit exceeded');
      }

      // Trigger if risk exposure is too high
      if (riskMetrics.riskPercent >= config.riskManagement.emergencyStopLoss * 100) {
        this.triggerEmergencyStop('Risk exposure too high');
      }

    } catch (error) {
      logger.error('Error checking emergency stop:', error);
    }
  }

  /**
   * Trigger emergency stop
   * @param {string} reason - Reason for emergency stop
   */
  async triggerEmergencyStop(reason) {
    try {
      if (this.emergencyStopTriggered) {
        return; // Already triggered
      }

      this.emergencyStopTriggered = true;
      
      logger.risk('🚨 EMERGENCY STOP TRIGGERED', { reason: reason });

      // Publish emergency stop signal
      await redisClient.publish('emergency-stop', {
        type: 'emergency-stop-triggered',
        reason: reason,
        timestamp: Date.now(),
        positions: Array.from(this.positions.values())
      });

      // Close all positions (would be handled by trading engine)
      await redisClient.publish('trading-commands', {
        type: 'close-all-positions',
        reason: 'Emergency stop'
      });

    } catch (error) {
      logger.error('Error triggering emergency stop:', error);
    }
  }

  /**
   * Update daily P&L
   * @param {number} pnl - P&L amount
   */
  updateDailyPnL(pnl) {
    try {
      this.dailyPnL += pnl;
      
      // Check daily loss limits
      const dailyLoss = this.dailyPnL < 0 ? Math.abs(this.dailyPnL) : 0;
      const dailyLossPercent = dailyLoss / this.accountBalance;

      if (dailyLossPercent >= config.riskManagement.maxDailyLoss) {
        this.dailyLossLimitReached = true;
        logger.risk('Daily loss limit reached', {
          dailyPnL: this.dailyPnL,
          lossPercent: (dailyLossPercent * 100).toFixed(2)
        });
      }

    } catch (error) {
      logger.error('Error updating daily P&L:', error);
    }
  }

  /**
   * Reset daily tracking (call at start of new day)
   */
  resetDailyTracking() {
    this.dailyPnL = 0;
    this.dailyLossLimitReached = false;
    logger.info('Daily tracking reset');
  }

  /**
   * Handle portfolio update events
   * @param {Object} data - Portfolio update data
   */
  handlePortfolioUpdate(data) {
    try {
      if (data.balance) {
        this.accountBalance = data.balance;
      }

      if (data.dailyPnL !== undefined) {
        this.updateDailyPnL(data.dailyPnL - this.dailyPnL);
      }

    } catch (error) {
      logger.error('Error handling portfolio update:', error);
    }
  }

  /**
   * Handle trade execution events
   * @param {Object} data - Trade execution data
   */
  async handleTradeExecution(data) {
    try {
      const { trade } = data;
      
      if (trade.type === 'open') {
        await this.addPosition(trade);
      } else if (trade.type === 'close') {
        await this.removePosition(trade.positionId);
      } else if (trade.type === 'update') {
        await this.updatePosition(trade.positionId, trade.updates);
      }

    } catch (error) {
      logger.error('Error handling trade execution:', error);
    }
  }

  /**
   * Get current risk status
   * @returns {Object} Risk status summary
   */
  getRiskStatus() {
    try {
      const openPositions = Array.from(this.positions.values());
      const riskMetrics = positionCalculator.calculatePortfolioRisk(openPositions, this.accountBalance);

      return {
        accountBalance: this.accountBalance,
        dailyPnL: this.dailyPnL,
        weeklyPnL: this.weeklyPnL,
        openPositions: openPositions.length,
        emergencyStopTriggered: this.emergencyStopTriggered,
        dailyLossLimitReached: this.dailyLossLimitReached,
        riskMetrics: riskMetrics,
        limits: {
          maxDailyLoss: config.riskManagement.maxDailyLoss * 100,
          maxWeeklyLoss: config.riskManagement.maxWeeklyLoss * 100,
          emergencyStopLoss: config.riskManagement.emergencyStopLoss * 100,
          maxOpenPositions: config.riskManagement.maxOpenPositions
        }
      };

    } catch (error) {
      logger.error('Error getting risk status:', error);
      return {};
    }
  }

  /**
   * Reset emergency stop (manual intervention required)
   */
  async resetEmergencyStop() {
    try {
      this.emergencyStopTriggered = false;
      logger.info('Emergency stop manually reset');
      
      await redisClient.publish('emergency-stop', {
        type: 'emergency-stop-reset',
        timestamp: Date.now()
      });

    } catch (error) {
      logger.error('Error resetting emergency stop:', error);
    }
  }
}

module.exports = RiskManager;
