// Configuration to get real data from BingX
// 1. Create an account on BingX (https://bingx.com)
// 2. Generate API keys (read-only for historical data)
// 3. Update the .env file with real credentials

module.exports = {
  // Steps to configure BingX:
  
  // 1. BINGX REGISTRATION
  //    - Go to https://bingx.com
  //    - Create an account
  //    - Complete verification
  
  // 2. GENERATE API KEYS
  //    - Go to API Management
  //    - Create new API keys
  //    - Permissions: Only "Read" (for historical data)
  //    - Save API Key and Secret Key
  
  // 3. UPDATE .ENV
  //    BINGX_API_KEY=your_real_api_key
  //    BINGX_SECRET_KEY=your_real_secret_key
  
  // 4. AVAILABLE ENDPOINTS
  endpoints: {
    klines: '/api/v3/klines',        // Historical data
    ticker: '/api/v3/ticker/24hr',   // 24h prices
    depth: '/api/v3/depth',          // Order book
    trades: '/api/v3/trades'         // Recent trades
  },
  
  // 5. PARAMETERS FOR HISTORICAL DATA
  klinesParams: {
    symbol: 'BTC-USDT',     // Trading pair
    interval: '4h',         // Timeframe: 1m, 5m, 15m, 1h, 4h, 1d
    startTime: 1730419200000, // Start timestamp
    endTime: 1738281600000,   // End timestamp
    limit: 1000             // Maximum 1000 candles per request
  },
  
  // 6. BINGX RESPONSE FORMAT
  responseFormat: [
    // [0] Open time
    // [1] Open price  
    // [2] High price
    // [3] Low price
    // [4] Close price
    // [5] Volume
    // [6] Close time
    // [7] Quote asset volume
    // [8] Number of trades
    // [9] Taker buy base asset volume
    // [10] Taker buy quote asset volume
    // [11] Ignore
  ]
};

// NOTE: For historical data you DON'T need funds in the account
// You only need API keys with read permissions
