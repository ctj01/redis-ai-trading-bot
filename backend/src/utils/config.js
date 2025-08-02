const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

const config = {
  // Server Configuration
  server: {
    port: process.env.PORT || 3000,
    wsPort: process.env.WS_PORT || 3001,
    environment: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info'
  },

  // Redis Configuration
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3,
    lazyConnect: true
  },

  // Trading Configuration
  trading: {
    demoMode: process.env.DEMO_MODE === 'true',
    maxAccountRisk: parseFloat(process.env.MAX_ACCOUNT_RISK) || 0.02,
    positionSizePercent: parseFloat(process.env.POSITION_SIZE_PERCENT) || 0.02,
    stopLossPercent: parseFloat(process.env.STOP_LOSS_PERCENT) || 0.015,
    takeProfitPercent: parseFloat(process.env.TAKE_PROFIT_PERCENT) || 0.04,
    tradingPairs: (process.env.TRADING_PAIRS || 'BTC-USD,ETH-USD').split(',').map(pair => pair.trim())
  },

  // RSI Divergence Strategy Configuration
  strategy: {
    rsiPeriod: parseInt(process.env.RSI_PERIOD) || 14,
    rsiOverbought: parseFloat(process.env.RSI_OVERBOUGHT) || 70,
    rsiOversold: parseFloat(process.env.RSI_OVERSOLD) || 30,
    divergenceLookback: parseInt(process.env.DIVERGENCE_LOOKBACK) || 15,
    minDivergenceStrength: parseFloat(process.env.MIN_DIVERGENCE_STRENGTH) || 0.3,
    volumeConfirmation: false, // Disable volume confirmation for testing
    volumeMAPeriod: parseInt(process.env.VOLUME_MA_PERIOD) || 20,
    bullishDivergenceThreshold: 55, // RSI level for bullish divergence detection (relaxed)
    bearishDivergenceThreshold: 55  // RSI level for bearish divergence detection (relaxed)
  },

  // Advanced Risk Management
  riskManagement: {
    maxOpenPositions: parseInt(process.env.MAX_OPEN_POSITIONS) || 3,
    maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS) || 0.06,
    maxWeeklyLoss: parseFloat(process.env.MAX_WEEKLY_LOSS) || 0.10,
    emergencyStopLoss: parseFloat(process.env.EMERGENCY_STOP_LOSS) || 0.08,
    correlationLimit: 0.7, // Maximum correlation between positions
    maxConcentration: 0.5   // Maximum % in single asset
  },

  // Signal Generation
  signals: {
    multiTimeframeAnalysis: process.env.MULTI_TIMEFRAME_ANALYSIS === 'true',
    primaryTimeframe: process.env.PRIMARY_TIMEFRAME || '1h',
    confirmationTimeframes: (process.env.CONFIRMATION_TIMEFRAMES || '15m,4h').split(',').map(tf => tf.trim()),
    minSignalStrength: parseFloat(process.env.MIN_SIGNAL_STRENGTH) || 0.8,
    signalExpiryTime: 300000 // 5 minutes in milliseconds
  },

  // External APIs
  apis: {
    bingx: {
      apiKey: process.env.BINGX_API_KEY,
      secretKey: process.env.BINGX_SECRET_KEY,
      baseURL: 'https://open-api.bingx.com',
      testnet: process.env.DEMO_MODE === 'true'
    },
    binance: {
      apiKey: process.env.BINANCE_API_KEY,
      secretKey: process.env.BINANCE_SECRET_KEY,
      testnet: process.env.DEMO_MODE === 'true'
    },
    coinbase: {
      apiKey: process.env.COINBASE_API_KEY,
      secret: process.env.COINBASE_SECRET,
      sandbox: process.env.DEMO_MODE === 'true'
    }
  },

  // AI Models
  aiModels: {
    updateInterval: parseInt(process.env.MODEL_UPDATE_INTERVAL) || 300000,
    confidenceThreshold: parseFloat(process.env.PREDICTION_CONFIDENCE_THRESHOLD) || 0.75,
    rsiDivergenceModelPath: process.env.RSI_DIVERGENCE_MODEL_PATH || './ai-models/saved-models/rsi_divergence_detector.h5',
    volumeTrendModelPath: process.env.VOLUME_TREND_MODEL_PATH || './ai-models/saved-models/volume_trend_predictor.h5',
    marketRegimeModelPath: process.env.MARKET_REGIME_MODEL_PATH || './ai-models/saved-models/market_regime_classifier.h5'
  },

  // Blockchain
  blockchain: {
    rpcUrl: process.env.RPC_URL || 'http://localhost:8545',
    privateKey: process.env.PRIVATE_KEY,
    tradingContractAddress: process.env.TRADING_CONTRACT_ADDRESS,
    gasLimit: 500000,
    gasPrice: '20000000000' // 20 gwei
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    toFile: process.env.LOG_TO_FILE === 'true',
    filePath: process.env.LOG_FILE_PATH || './logs/trading-bot.log',
    maxFiles: 5,
    maxSize: '10MB'
  },

  // Performance
  performance: {
    dataRetentionDays: 30,
    maxCandlesInMemory: 1000,
    priceUpdateInterval: 1000,   // 1 second
    rsiUpdateInterval: 5000,     // 5 seconds
    volumeUpdateInterval: 3000   // 3 seconds
  }
};

// Validation function
function validateConfig() {
  const required = [
    'trading.maxAccountRisk',
    'strategy.rsiPeriod',
    'riskManagement.maxOpenPositions'
  ];

  for (const path of required) {
    const value = path.split('.').reduce((obj, key) => obj?.[key], config);
    if (value === undefined || value === null) {
      throw new Error(`Required configuration missing: ${path}`);
    }
  }

  // Validate risk percentages
  if (config.trading.maxAccountRisk > 0.05) {
    throw new Error('MAX_ACCOUNT_RISK cannot exceed 5% (0.05)');
  }

  if (config.trading.stopLossPercent >= config.trading.takeProfitPercent) {
    throw new Error('STOP_LOSS_PERCENT must be less than TAKE_PROFIT_PERCENT');
  }

  console.log('✅ Configuration validation passed');
}

// Run validation
validateConfig();

module.exports = config;
