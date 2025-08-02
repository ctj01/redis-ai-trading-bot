# Redis AI Trading Bot 🚀

An advanced algorithmic trading bot built with Redis Stack, Node.js, and AI-driven technical analysis. Features RSI divergence detection, comprehensive backtesting engine, and real-time trading dashboard.

## 🌟 Features

### Core Trading Capabilities
- **RSI Divergence Detection**: Advanced algorithm to identify bullish and bearish divergences
- **Risk Management**: Sophisticated position sizing and stop-loss mechanisms
- **Real-time Market Data**: Integration with BingX API for live market feeds
- **Multi-timeframe Analysis**: Support for various timeframes (1m, 5m, 15m, 1h, 4h, 1d)

### Backtesting Engine
- **Historical Simulation**: Test strategies against historical market data
- **Performance Metrics**: Comprehensive analysis including win rate, drawdown, and returns
- **Equity Curve Visualization**: Interactive charts showing portfolio performance
- **Parameter Optimization**: Test different configurations to optimize strategy

### Technical Infrastructure
- **Redis Stack Integration**: High-performance data storage and time-series analysis
- **WebSocket Support**: Real-time updates and notifications
- **RESTful API**: Complete API for trading operations and backtesting
- **Modern Dashboard**: Responsive web interface for monitoring and control

## 🏗️ Architecture

```
redis-ai-trading-bot/
├── backend/
│   ├── src/
│   │   ├── services/
│   │   │   ├── rsi-divergence-engine.js    # Core trading algorithm
│   │   │   ├── backtesting-engine.js       # Backtesting system
│   │   │   ├── risk-manager.js             # Risk management
│   │   │   └── market-data-service.js      # Market data integration
│   │   ├── utils/
│   │   │   ├── redis-client.js             # Redis Stack client
│   │   │   ├── config.js                   # Configuration management
│   │   │   └── logger.js                   # Logging system
│   │   └── app.js                          # Main application server
│   ├── public/
│   │   ├── dashboard.html                  # Trading dashboard
│   │   ├── dashboard.js                    # Frontend logic
│   │   └── dashboard.css                   # Styling
│   └── package.json
├── config/
│   └── default.json                        # Configuration settings
└── README.md
```

## 🚀 Quick Start

### Prerequisites

1. **Node.js** (v18 or higher)
2. **Redis Stack** (with RedisTimeSeries module)
3. **BingX API Keys** (for live trading)

### Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd redis-ai-trading-bot
```

2. **Install dependencies**
```bash
cd backend
npm install
```

3. **Configure Redis Stack**
```bash
# Install Redis Stack (includes RedisTimeSeries)
# Windows: Download from https://redis.io/download
# macOS: brew install redis-stack
# Linux: Follow Redis Stack installation guide
```

4. **Environment Configuration**
```bash
# Copy and configure settings
cp config/default.json.example config/default.json
```

5. **Update configuration** in `config/default.json`:
```json
{
  "redis": {
    "url": "redis://localhost:6379",
    "database": 0
  },
  "bingx": {
    "apiKey": "your-bingx-api-key",
    "secretKey": "your-bingx-secret-key",
    "baseUrl": "https://open-api.bingx.com"
  },
  "trading": {
    "defaultPair": "BTC-USDT",
    "defaultTimeframe": "1h",
    "riskPerTrade": 0.02,
    "maxPositions": 3
  }
}
```

### Running the Application

1. **Start Redis Stack**
```bash
redis-stack-server
```

2. **Start the Trading Bot**

### Prerequisites
- Docker Desktop
- Node.js >= 18.0.0
- Python >= 3.9.0
- Git

### Installation
```bash
# Clone the repository
git clone <your-repo-url>
cd redis-ai-trading-bot

# Install root dependencies
npm install

# Setup all services
npm run setup:all

# Start Redis Stack
npm run start:redis

# Start all services
npm run start:all
```

### Configuration
1. Copy `.env.example` to `.env`
2. Configure your API keys (Binance, Coinbase)
3. Set your risk parameters
4. Configure trading pairs

## 📊 Architecture

### Backend Services
- **RSI Divergence Engine**: Core divergence detection algorithm
- **Volume Analyzer**: Volume confirmation system
- **Risk Manager**: Strict 2% risk enforcement
- **Trading Engine**: Order execution and management
- **Portfolio Tracker**: Real-time P&L tracking

### Smart Contracts
- **RSIDivergenceTradingBot.sol**: Main trading logic
- **RiskManager.sol**: On-chain risk enforcement
- **EmergencyStop.sol**: Multi-trigger safety system

### AI Models
- **RSI Divergence Predictor**: ML model for divergence strength
- **Volume Trend Analyzer**: Volume pattern recognition
- **Market Regime Detector**: Market condition classification

## 🔧 Development

### Start Development Environment
```bash
npm run start:all
```

### Run Tests
```bash
npm run test                    # All tests
npm run test:divergence        # Divergence detection tests
npm run test:risk-management   # Risk management tests
```

### Backtesting
```bash
npm run backtest:strategy      # Run strategy backtest
```

### Monitoring
```bash
npm run logs:trading          # Trading logs
npm run logs:redis            # Redis monitor
```

## 📈 Expected Performance

- **Win Rate**: 60-65%
- **Risk:Reward**: 1:2.5 minimum
- **Sharpe Ratio**: > 1.5
- **Maximum Drawdown**: < 8%
- **Average Trades**: 2-5 per day

## 🛡️ Safety Features

- **Strict 2% position sizing**
- **Automated stop losses**
- **Daily/weekly loss limits**
- **Emergency circuit breakers**
- **Multi-level risk validation**

## 📁 Project Structure

```
redis-ai-trading-bot/
├── backend/           # Node.js trading engine
├── contracts/         # Smart contracts
├── frontend/          # React dashboard
├── ai-models/         # Python ML models
└── scripts/           # Utility scripts
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new features
4. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details
