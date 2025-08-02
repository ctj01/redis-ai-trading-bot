const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');

// Import services and utilities
const config = require('./utils/config');
const logger = require('./utils/logger');
const redisClient = require('./utils/redis-client');
const RSIDivergenceEngine = require('./services/rsi-divergence-engine');
const RiskManager = require('./services/risk-manager');
const MarketDataService = require('./services/market-data-service');
const ManualTradingEngine = require('./services/manual-trading-engine');
const AIMarketScreener = require('./services/ai-market-screener');

class TradingBotApp {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocket.Server({ server: this.server });
    
    // Core services
    this.divergenceEngine = new RSIDivergenceEngine();
    this.riskManager = new RiskManager();
    this.marketDataService = new MarketDataService(this.divergenceEngine);
    // ManualTradingEngine and AIMarketScreener will be initialized after Redis connection
    
    // WebSocket clients
    this.wsClients = new Set();
    
    // Application state
    this.isRunning = false;
    this.startTime = Date.now();
  }

  /**
   * Initialize the trading bot application
   */
  async initialize() {
    try {
      logger.info('🚀 Initializing Redis AI Trading Bot...');
      
      // Setup middleware
      this.setupMiddleware();
      
      // Setup routes
      this.setupRoutes();
      
      // Setup WebSocket
      this.setupWebSocket();
      
      // Connect to Redis
      await redisClient.connect();
      
      // Initialize manual trading engine after Redis connection
      this.manualTradingEngine = new ManualTradingEngine(redisClient);
      
      // Initialize AI market screener
      this.aiMarketScreener = new AIMarketScreener(redisClient);
      
      // Initialize core services
      await this.divergenceEngine.initialize();
      await this.riskManager.initialize();
      
      // Initialize market data service with BingX
      await this.marketDataService.initialize();
      
      // Setup event handlers
      this.setupEventHandlers();
      
      logger.info('✅ Trading Bot initialized successfully');
      
    } catch (error) {
      logger.error('Failed to initialize trading bot:', error);
      throw error;
    }
  }

  /**
   * Setup Express middleware
   */
  setupMiddleware() {
    // Security middleware with custom CSP for dashboard
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            "'unsafe-inline'",
            "https://cdn.jsdelivr.net",
            "https://cdnjs.cloudflare.com"
          ],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            "https://fonts.googleapis.com",
            "https://cdnjs.cloudflare.com"
          ],
          fontSrc: [
            "'self'",
            "https://fonts.gstatic.com",
            "https://cdnjs.cloudflare.com"
          ],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "ws:", "wss:"]
        }
      }
    }));
    
    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
      message: 'Too many requests from this IP'
    });
    this.app.use('/api/', limiter);
    
    // CORS
    this.app.use(cors({
      origin: config.server.environment === 'production' ? 
        config.frontend.url : true,
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization']
    }));
    
    // Compression
    this.app.use(compression());
    
    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));
    
    // Logging
    if (config.server.environment !== 'test') {
      this.app.use(morgan('combined', {
        stream: { write: message => logger.info(message.trim()) }
      }));
    }

    // Serve static files from public directory
    this.app.use(express.static(path.join(__dirname, '../public')));
  }

  /**
   * Setup API routes
   */
  setupRoutes() {
    // Health check
    this.app.get('/health', async (req, res) => {
      try {
        const redisHealth = await redisClient.healthCheck();
        const status = {
          status: 'ok',
          timestamp: new Date().toISOString(),
          uptime: Date.now() - this.startTime,
          services: {
            redis: redisHealth ? 'connected' : 'disconnected',
            divergenceEngine: 'running',
            riskManager: 'running'
          },
          version: '1.0.0'
        };
        
        res.json(status);
      } catch (error) {
        logger.error('Health check failed:', error);
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // Get divergence signals
    this.app.get('/api/divergences/:pair?', async (req, res) => {
      try {
        const { pair } = req.params;
        const { limit = 10, timeframe = '1h' } = req.query;
        
        logger.info(`Getting divergences for pair: ${pair || 'all'}, timeframe: ${timeframe}, limit: ${limit}`);
        
        let divergences;
        if (pair) {
          divergences = await this.divergenceEngine.getRecentDivergences(pair, parseInt(limit), timeframe);
        } else {
          divergences = await redisClient.getDivergenceSignals(null, parseInt(limit));
        }
        
        res.json({
          success: true,
          data: divergences,
          count: divergences.length,
          timeframe: timeframe
        });
      } catch (error) {
        logger.error('Error getting divergences:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get current RSI values
    this.app.get('/api/rsi/:pair?', async (req, res) => {
      try {
        const { pair } = req.params;
        const { timeframe = '1h' } = req.query;
        
        logger.info(`Getting RSI for pair: ${pair || 'all'}, timeframe: ${timeframe}`);
        
        if (pair) {
          const rsi = await this.divergenceEngine.getCurrentRSI(pair, timeframe);
          res.json({ success: true, pair, rsi, timeframe });
        } else {
          const allRSI = {};
          for (const tradingPair of config.trading.tradingPairs) {
            allRSI[tradingPair] = await this.divergenceEngine.getCurrentRSI(tradingPair, timeframe);
          }
          res.json({ success: true, data: allRSI, timeframe });
        }
      } catch (error) {
        logger.error('Error getting RSI:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get risk status
    this.app.get('/api/risk/status', (req, res) => {
      try {
        const riskStatus = this.riskManager.getRiskStatus();
        res.json({ success: true, data: riskStatus });
      } catch (error) {
        logger.error('Error getting risk status:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get portfolio balance
    this.app.get('/api/portfolio/balance', async (req, res) => {
      try {
        const balance = await redisClient.getPortfolioBalance();
        res.json({ success: true, data: balance });
      } catch (error) {
        logger.error('Error getting portfolio balance:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get engine statistics
    this.app.get('/api/stats', (req, res) => {
      try {
        const stats = this.divergenceEngine.getStatistics();
        const riskStatus = this.riskManager.getRiskStatus();
        
        res.json({
          success: true,
          data: {
            divergenceEngine: stats,
            riskManager: {
              openPositions: riskStatus.openPositions,
              accountBalance: riskStatus.accountBalance,
              dailyPnL: riskStatus.dailyPnL
            },
            uptime: Date.now() - this.startTime,
            timestamp: new Date().toISOString()
          }
        });
      } catch (error) {
        logger.error('Error getting statistics:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Manual Trading endpoints
    
    // Get trading suggestions
    this.app.get('/api/trading/suggestions/:pair?', async (req, res) => {
      try {
        const { pair = 'BTC-USDT' } = req.params;
        const { timeframe = '1h' } = req.query;
        
        logger.info(`Getting trading suggestions for ${pair} on ${timeframe}`);
        
        const suggestion = await this.manualTradingEngine.getTradingSuggestions(pair, timeframe);
        
        res.json({
          success: true,
          data: suggestion
        });
        
      } catch (error) {
        logger.error('Error getting trading suggestions:', error);
        res.status(500).json({ 
          success: false, 
          error: error.message 
        });
      }
    });

    // Get all active suggestions
    this.app.get('/api/trading/suggestions', async (req, res) => {
      try {
        const suggestions = this.manualTradingEngine.getActiveSuggestions();
        
        res.json({
          success: true,
          data: suggestions,
          count: suggestions.length
        });
        
      } catch (error) {
        logger.error('Error getting active suggestions:', error);
        res.status(500).json({ 
          success: false, 
          error: error.message 
        });
      }
    });
    
    // Execute manual trade
    this.app.post('/api/trading/execute', async (req, res) => {
      try {
        const { 
          suggestionId,
          executionType = 'PAPER', // PAPER, LIVE, COPY
          customParams = {}
        } = req.body;
        
        if (!suggestionId) {
          return res.status(400).json({
            success: false,
            error: 'Suggestion ID is required'
          });
        }
        
        logger.info(`Executing manual trade for suggestion: ${suggestionId}`);
        
        const trade = await this.manualTradingEngine.executeManualTrade(
          suggestionId,
          executionType,
          customParams
        );
        
        res.json({
          success: true,
          data: trade
        });
        
      } catch (error) {
        logger.error('Error executing manual trade:', error);
        res.status(500).json({ 
          success: false, 
          error: error.message 
        });
      }
    });
    
    // Get manual trades history
    this.app.get('/api/trading/history', async (req, res) => {
      try {
        const { limit = 20 } = req.query;
        
        const trades = this.manualTradingEngine.getManualTradesHistory(parseInt(limit));
        
        res.json({
          success: true,
          data: trades,
          count: trades.length
        });
        
      } catch (error) {
        logger.error('Error getting manual trades history:', error);
        res.status(500).json({ 
          success: false, 
          error: error.message 
        });
      }
    });

    // Get manual trading performance
    this.app.get('/api/trading/performance', async (req, res) => {
      try {
        const performance = this.manualTradingEngine.calculateManualTradingPerformance();
        
        res.json({
          success: true,
          data: performance
        });
        
      } catch (error) {
        logger.error('Error getting trading performance:', error);
        res.status(500).json({ 
          success: false, 
          error: error.message 
        });
      }
    });

    // Manual emergency stop reset (admin only)
    this.app.post('/api/risk/reset-emergency', async (req, res) => {
      try {
        await this.riskManager.resetEmergencyStop();
        res.json({ success: true, message: 'Emergency stop reset' });
      } catch (error) {
        logger.error('Error resetting emergency stop:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Market data injection endpoint (for testing)
    this.app.post('/api/market-data', async (req, res) => {
      try {
        const { pair, candle } = req.body;
        
        if (!pair || !candle) {
          return res.status(400).json({ 
            success: false, 
            error: 'Missing pair or candle data' 
          });
        }
        
        await this.divergenceEngine.updateMarketData(pair, candle);
        
        res.json({ 
          success: true, 
          message: `Market data updated for ${pair}` 
        });
      } catch (error) {
        logger.error('Error injecting market data:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // AI Market Screener endpoints
    
    // Get full market scan
    this.app.get('/api/ai-screener/scan', async (req, res) => {
      try {
        logger.info('🔍 Starting AI market scan...');
        
        const marketScan = await this.aiMarketScreener.scanMarket();
        
        res.json({
          success: true,
          data: marketScan,
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        logger.error('Error performing AI market scan:', error);
        res.status(500).json({ 
          success: false, 
          error: error.message 
        });
      }
    });
    
    // Get top opportunities
    this.app.get('/api/ai-screener/opportunities', async (req, res) => {
      try {
        const { limit = 5 } = req.query;
        
        const opportunities = await this.aiMarketScreener.getTopOpportunities(parseInt(limit));
        
        res.json({
          success: true,
          data: opportunities,
          count: opportunities.length,
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        logger.error('Error getting top opportunities:', error);
        res.status(500).json({ 
          success: false, 
          error: error.message 
        });
      }
    });
    
    // Get market overview
    this.app.get('/api/ai-screener/overview', async (req, res) => {
      try {
        const overview = await this.aiMarketScreener.getMarketOverview();
        
        res.json({
          success: true,
          data: overview,
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        logger.error('Error getting market overview:', error);
        res.status(500).json({ 
          success: false, 
          error: error.message 
        });
      }
    });
    
    // Get specific pair analysis
    this.app.get('/api/ai-screener/analyze/:pair', async (req, res) => {
      try {
        const { pair } = req.params;
        const { timeframe = '1h' } = req.query;
        
        const analysis = await this.aiMarketScreener.analyzePairOpportunity(pair, timeframe);
        
        res.json({
          success: true,
          data: analysis,
          pair,
          timeframe,
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        logger.error(`Error analyzing pair ${req.params.pair}:`, error);
        res.status(500).json({ 
          success: false, 
          error: error.message 
        });
      }
    });

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({ 
        success: false, 
        error: 'Endpoint not found' 
      });
    });

    // Error handler
    this.app.use((error, req, res, next) => {
      logger.error('Express error:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Internal server error' 
      });
    });
  }

  /**
   * Setup WebSocket server
   */
  setupWebSocket() {
    this.wss.on('connection', (ws, req) => {
      logger.info(`WebSocket client connected from ${req.connection.remoteAddress}`);
      
      this.wsClients.add(ws);
      
      // Send initial data
      ws.send(JSON.stringify({
        type: 'connection',
        message: 'Connected to Redis AI Trading Bot',
        timestamp: Date.now()
      }));

      // Handle client messages
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          this.handleWebSocketMessage(ws, data);
        } catch (error) {
          logger.error('Invalid WebSocket message:', error);
        }
      });

      // Handle client disconnect
      ws.on('close', () => {
        this.wsClients.delete(ws);
        logger.info('WebSocket client disconnected');
      });

      // Handle WebSocket errors
      ws.on('error', (error) => {
        logger.error('WebSocket error:', error);
        this.wsClients.delete(ws);
      });
    });
  }

  /**
   * Handle WebSocket messages from clients
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} data - Message data
   */
  handleWebSocketMessage(ws, data) {
    try {
      switch (data.type) {
        case 'subscribe':
          // Handle subscription requests
          ws.subscriptions = ws.subscriptions || new Set();
          ws.subscriptions.add(data.channel);
          ws.send(JSON.stringify({
            type: 'subscribed',
            channel: data.channel,
            timestamp: Date.now()
          }));
          break;

        case 'unsubscribe':
          if (ws.subscriptions) {
            ws.subscriptions.delete(data.channel);
          }
          break;

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;

        default:
          ws.send(JSON.stringify({
            type: 'error',
            message: `Unknown message type: ${data.type}`
          }));
      }
    } catch (error) {
      logger.error('Error handling WebSocket message:', error);
    }
  }

  /**
   * Broadcast data to WebSocket clients
   * @param {string} channel - Channel name
   * @param {Object} data - Data to broadcast
   */
  broadcastToClients(channel, data) {
    try {
      const message = JSON.stringify({
        channel: channel,
        data: data,
        timestamp: Date.now()
      });

      this.wsClients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          if (!ws.subscriptions || ws.subscriptions.has(channel)) {
            ws.send(message);
          }
        }
      });
    } catch (error) {
      logger.error('Error broadcasting to clients:', error);
    }
  }

  /**
   * Setup event handlers for Redis messages
   */
  setupEventHandlers() {
    // Listen for divergence signals
    redisClient.subscribe('divergence-signals', (data) => {
      logger.info(`Divergence signal: ${data.data.type} for ${data.data.pair}`);
      this.broadcastToClients('divergences', data);
    });

    // Listen for trade executions
    redisClient.subscribe('trade-executed', (data) => {
      logger.info(`Trade executed: ${data.trade.side} ${data.trade.pair}`);
      this.broadcastToClients('trades', data);
    });

    // Listen for risk alerts
    redisClient.subscribe('risk-alerts', (data) => {
      logger.risk(`Risk alert: ${data.message}`, data);
      this.broadcastToClients('risk-alerts', data);
    });

    // Listen for emergency stops
    redisClient.subscribe('emergency-stop', (data) => {
      logger.risk(`Emergency stop: ${data.type}`, data);
      this.broadcastToClients('emergency-stop', data);
    });
  }

  /**
   * Start the trading bot server
   */
  async start() {
    try {
      await this.initialize();
      
      const port = config.server.port;
      
      this.server.listen(port, () => {
        this.isRunning = true;
        logger.info(`🚀 Trading Bot server running on port ${port}`);
        logger.info(`📊 Dashboard: http://localhost:${port}`);
        logger.info(`🔌 WebSocket: ws://localhost:${port}`);
        logger.info(`📈 Redis Insight: http://localhost:8001`);
      });

      // Graceful shutdown handlers
      process.on('SIGTERM', () => this.shutdown());
      process.on('SIGINT', () => this.shutdown());

    } catch (error) {
      logger.error('Failed to start trading bot:', error);
      process.exit(1);
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    try {
      logger.info('Shutting down trading bot...');
      
      this.isRunning = false;
      
      // Close WebSocket connections
      this.wsClients.forEach(ws => {
        ws.close();
      });
      
      // Close server
      this.server.close();
      
      // Disconnect from Redis
      await redisClient.disconnect();
      
      logger.info('✅ Trading bot shutdown complete');
      process.exit(0);
      
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  }
}

// Create and start the application
const tradingBot = new TradingBotApp();

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  tradingBot.shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', reason);
  tradingBot.shutdown();
});

// Start the bot if this file is run directly
if (require.main === module) {
  tradingBot.start().catch(error => {
    logger.error('Failed to start trading bot:', error);
    process.exit(1);
  });
}

module.exports = tradingBot;
