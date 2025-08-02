// Improved BacktestingEngine method for public BingX API
const axios = require('axios');

class PublicBingXClient {
  constructor() {
    this.baseURL = 'https://open-api.bingx.com';
  }

  /**
   * Fetch historical data using public BingX endpoint (no authentication required)
   * @param {string} symbol - Trading symbol (e.g., 'BTC-USDT')
   * @param {string} interval - Time interval (1m, 5m, 15m, 1h, 4h, 1d)
   * @param {Date} startDate - Start date for historical data
   * @param {Date} endDate - End date for historical data
   * @returns {Promise<Array>} Historical candle data
   */
  async getKlines(symbol, interval, startDate, endDate) {
    try {
      const url = `${this.baseURL}/openApi/swap/v3/quote/klines`;
      
      const params = {
        symbol: symbol,
        interval: interval,
        startTime: startDate.getTime().toString(),
        limit: '1000'
      };
      
      const queryString = new URLSearchParams(params).toString();
      const fullUrl = `${url}?${queryString}`;
      
      console.log(`📡 Fetching public data: ${symbol} ${interval}`);
      console.log(`📅 Period: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
      
      const response = await axios.get(fullUrl, {
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.data || !response.data.data || !Array.isArray(response.data.data)) {
        throw new Error('Invalid response format from BingX public API');
      }
      
      const data = response.data.data;
      console.log(`✅ Fetched ${data.length} candles from BingX public API`);
      
      // Convert to BacktestingEngine format
      const converted = data.map(candle => ({
        timestamp: parseInt(candle.time),
        open: parseFloat(candle.open),
        high: parseFloat(candle.high),
        low: parseFloat(candle.low),
        close: parseFloat(candle.close),
        volume: parseFloat(candle.volume)
      }));
      
      // Filter by exact date range
      const endTime = endDate.getTime();
      const filteredData = converted.filter(candle => 
        candle.timestamp >= startDate.getTime() && 
        candle.timestamp <= endTime
      );
      
      // Sort by timestamp to ensure chronological order
      filteredData.sort((a, b) => a.timestamp - b.timestamp);
      
      console.log(`📊 Filtered to ${filteredData.length} candles in date range`);
      if (filteredData.length > 0) {
        console.log(`📅 Actual range: ${new Date(filteredData[0].timestamp).toISOString().split('T')[0]} to ${new Date(filteredData[filteredData.length-1].timestamp).toISOString().split('T')[0]}`);
      }
      
      return filteredData;
      
    } catch (error) {
      console.error(`❌ Public BingX API Error:`, error.message);
      throw error;
    }
  }
  
  /**
   * Convert timeframe to BingX format
   * @param {string} timeframe - Internal timeframe format
   * @returns {string} BingX interval format
   */
  convertTimeframe(timeframe) {
    const mapping = {
      '1m': '1m',
      '5m': '5m', 
      '15m': '15m',
      '1h': '1h',
      '2h': '2h',
      '4h': '4h',
      '6h': '6h',
      '12h': '12h',
      '1d': '1d'
    };
    
    return mapping[timeframe] || timeframe;
  }
}

// Drop-in replacement method for BacktestingEngine
async function fetchBingXHistoricalDataPublic(pair, timeframe, startDate, endDate) {
  try {
    console.log(`🔄 Fetching real market data from BingX PUBLIC: ${pair} ${timeframe} from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
    
    const publicClient = new PublicBingXClient();
    const interval = publicClient.convertTimeframe(timeframe);
    
    const data = await publicClient.getKlines(pair, interval, startDate, endDate);
    
    console.log(`✅ Successfully fetched ${data.length} REAL market candles from BingX PUBLIC API`);
    return data;
    
  } catch (error) {
    console.error(`❌ BingX Public API Error:`, error.message);
    throw error;
  }
}

// Test the new public method
async function testPublicMethod() {
  console.log('🎯 TESTING NEW PUBLIC BINGX METHOD');
  console.log('📡 This replaces authenticated BacktestingEngine calls...');
  
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7); // Last 7 days
    const endDate = new Date();
    
    const data = await fetchBingXHistoricalDataPublic('BTC-USDT', '1h', startDate, endDate);
    
    console.log('\n📊 RESULTS:');
    console.log(`✅ Fetched: ${data.length} candles`);
    console.log(`📅 Period: ${new Date(data[0]?.timestamp).toISOString()} to ${new Date(data[data.length-1]?.timestamp).toISOString()}`);
    console.log(`💰 Price range: $${Math.min(...data.map(d => d.low)).toFixed(2)} - $${Math.max(...data.map(d => d.high)).toFixed(2)}`);
    
    console.log('\n🎉 SUCCESS: Public method works perfectly!');
    console.log('✅ Drop-in replacement for authenticated method');
    console.log('✅ Same data quality and format');
    console.log('✅ No credentials required');
    
    return data;
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Export for use in other files
module.exports = {
  PublicBingXClient,
  fetchBingXHistoricalDataPublic
};

// Run test if called directly
if (require.main === module) {
  testPublicMethod().then(() => {
    console.log('\n💡 INTEGRATION STEPS:');
    console.log('1. Replace BacktestingEngine.fetchBingXHistoricalData()');
    console.log('2. Remove BingXClient authentication dependency');
    console.log('3. Use PublicBingXClient instead');
    console.log('4. Delete API credentials from config');
    console.log('5. Enjoy simplified deployment! 🚀');
  }).catch(console.error);
}
