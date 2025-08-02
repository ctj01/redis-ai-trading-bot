const axios = require('axios');

// Sample Bitcoin price data that includes divergence scenarios
const btcTestData = [
  // Initial price movement up
  { timestamp: 1722542100000, open: 65000, high: 65500, low: 64800, close: 65200, volume: 1500 },
  { timestamp: 1722542400000, open: 65200, high: 65800, low: 65100, close: 65600, volume: 1600 },
  { timestamp: 1722542700000, open: 65600, high: 66200, low: 65400, close: 66000, volume: 1700 },
  { timestamp: 1722543000000, open: 66000, high: 66500, low: 65800, close: 66300, volume: 1800 },
  { timestamp: 1722543300000, open: 66300, high: 66800, low: 66100, close: 66500, volume: 1900 },
  
  // Price decline while RSI stays higher (setting up for potential divergence)
  { timestamp: 1722543600000, open: 66500, high: 66700, low: 66000, close: 66100, volume: 2000 },
  { timestamp: 1722543900000, open: 66100, high: 66300, low: 65700, close: 65800, volume: 2100 },
  { timestamp: 1722544200000, open: 65800, high: 66000, low: 65400, close: 65500, volume: 1900 },
  { timestamp: 1722544500000, open: 65500, high: 65700, low: 65000, close: 65200, volume: 1800 },
  { timestamp: 1722544800000, open: 65200, high: 65400, low: 64800, close: 64900, volume: 1700 },
  
  // Further decline to create lower low in price
  { timestamp: 1722545100000, open: 64900, high: 65100, low: 64400, close: 64600, volume: 2200 },
  { timestamp: 1722545400000, open: 64600, high: 64800, low: 64200, close: 64300, volume: 2300 },
  { timestamp: 1722545700000, open: 64300, high: 64500, low: 63900, close: 64000, volume: 2400 }, // Lower low
  { timestamp: 1722546000000, open: 64000, high: 64300, low: 63800, close: 64100, volume: 2500 },
  { timestamp: 1722546300000, open: 64100, high: 64400, low: 63950, close: 64200, volume: 2400 },
  
  // RSI recovery (while price makes similar lows) - potential bullish divergence
  { timestamp: 1722546600000, open: 64200, high: 64500, low: 63900, close: 64300, volume: 2300 },
  { timestamp: 1722546900000, open: 64300, high: 64600, low: 64000, close: 64400, volume: 2200 },
  { timestamp: 1722547200000, open: 64400, high: 64700, low: 64100, close: 64500, volume: 2100 },
  { timestamp: 1722547500000, open: 64500, high: 64800, low: 64200, close: 64600, volume: 2000 },
  { timestamp: 1722547800000, open: 64600, high: 64900, low: 64300, close: 64700, volume: 1900 },

  // Price recovery
  { timestamp: 1722548100000, open: 64700, high: 65000, low: 64500, close: 64800, volume: 1800 },
  { timestamp: 1722548400000, open: 64800, high: 65200, low: 64600, close: 65000, volume: 1700 },
  { timestamp: 1722548700000, open: 65000, high: 65400, low: 64800, close: 65200, volume: 1600 },
  { timestamp: 1722549000000, open: 65200, high: 65600, low: 65000, close: 65400, volume: 1500 },
  { timestamp: 1722549300000, open: 65400, high: 65800, low: 65200, close: 65600, volume: 1400 }
];

const ethTestData = [
  // Similar pattern for ETH with different price levels
  { timestamp: 1722542100000, open: 3200, high: 3250, low: 3180, close: 3230, volume: 800 },
  { timestamp: 1722542400000, open: 3230, high: 3280, low: 3210, close: 3260, volume: 850 },
  { timestamp: 1722542700000, open: 3260, high: 3310, low: 3240, close: 3290, volume: 900 },
  { timestamp: 1722543000000, open: 3290, high: 3340, low: 3270, close: 3320, volume: 950 },
  { timestamp: 1722543300000, open: 3320, high: 3370, low: 3300, close: 3350, volume: 1000 },
  
  { timestamp: 1722543600000, open: 3350, high: 3380, low: 3320, close: 3330, volume: 1050 },
  { timestamp: 1722543900000, open: 3330, high: 3360, low: 3300, close: 3310, volume: 1100 },
  { timestamp: 1722544200000, open: 3310, high: 3340, low: 3280, close: 3290, volume: 1000 },
  { timestamp: 1722544500000, open: 3290, high: 3320, low: 3260, close: 3270, volume: 950 },
  { timestamp: 1722544800000, open: 3270, high: 3300, low: 3240, close: 3250, volume: 900 },
  
  { timestamp: 1722545100000, open: 3250, high: 3280, low: 3220, close: 3230, volume: 1150 },
  { timestamp: 1722545400000, open: 3230, high: 3260, low: 3200, close: 3210, volume: 1200 },
  { timestamp: 1722545700000, open: 3210, high: 3240, low: 3180, close: 3190, volume: 1250 }, // Lower low
  { timestamp: 1722546000000, open: 3190, high: 3220, low: 3170, close: 3200, volume: 1300 },
  { timestamp: 1722546300000, open: 3200, high: 3230, low: 3180, close: 3210, volume: 1250 },
  
  { timestamp: 1722546600000, open: 3210, high: 3240, low: 3190, close: 3220, volume: 1200 },
  { timestamp: 1722546900000, open: 3220, high: 3250, low: 3200, close: 3230, volume: 1150 },
  { timestamp: 1722547200000, open: 3230, high: 3260, low: 3210, close: 3240, volume: 1100 },
  { timestamp: 1722547500000, open: 3240, high: 3270, low: 3220, close: 3250, volume: 1050 },
  { timestamp: 1722547800000, open: 3250, high: 3280, low: 3230, close: 3260, volume: 1000 },

  { timestamp: 1722548100000, open: 3260, high: 3290, low: 3240, close: 3270, volume: 950 },
  { timestamp: 1722548400000, open: 3270, high: 3300, low: 3250, close: 3280, volume: 900 },
  { timestamp: 1722548700000, open: 3280, high: 3310, low: 3260, close: 3290, volume: 850 },
  { timestamp: 1722549000000, open: 3290, high: 3320, low: 3270, close: 3300, volume: 800 },
  { timestamp: 1722549300000, open: 3300, high: 3330, low: 3280, close: 3310, volume: 750 }
];

async function injectTestData() {
  console.log('🚀 Starting market data injection...');
  
  try {
    // Inject BTC data
    console.log('📈 Injecting BTC-USD data...');
    for (let i = 0; i < btcTestData.length; i++) {
      const candle = btcTestData[i];
      
      await axios.post('http://localhost:3000/api/market-data', {
        pair: 'BTC-USD',
        candle: candle
      });
      
      console.log(`BTC-USD: ${i + 1}/${btcTestData.length} - Price: $${candle.close} Volume: ${candle.volume}`);
      
      // Wait 500ms between injections to simulate real-time data
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Inject ETH data
    console.log('📈 Injecting ETH-USD data...');
    for (let i = 0; i < ethTestData.length; i++) {
      const candle = ethTestData[i];
      
      await axios.post('http://localhost:3000/api/market-data', {
        pair: 'ETH-USD',
        candle: candle
      });
      
      console.log(`ETH-USD: ${i + 1}/${ethTestData.length} - Price: $${candle.close} Volume: ${candle.volume}`);
      
      // Wait 500ms between injections
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log('✅ Market data injection completed!');
    
    // Wait a bit then check for divergences
    setTimeout(async () => {
      console.log('\n📊 Checking for detected divergences...');
      
      try {
        const btcDivergences = await axios.get('http://localhost:3000/api/divergences/BTC-USD');
        const ethDivergences = await axios.get('http://localhost:3000/api/divergences/ETH-USD');
        
        console.log(`\n🔍 BTC-USD Divergences: ${btcDivergences.data.count}`);
        if (btcDivergences.data.count > 0) {
          btcDivergences.data.data.forEach(div => {
            console.log(`  - ${div.type.toUpperCase()} divergence (strength: ${div.strength.toFixed(3)})`);
          });
        }
        
        console.log(`\n🔍 ETH-USD Divergences: ${ethDivergences.data.count}`);
        if (ethDivergences.data.count > 0) {
          ethDivergences.data.data.forEach(div => {
            console.log(`  - ${div.type.toUpperCase()} divergence (strength: ${div.strength.toFixed(3)})`);
          });
        }
        
        // Check RSI values
        const rsiData = await axios.get('http://localhost:3000/api/rsi');
        console.log('\n📈 Current RSI Values:');
        console.log(`BTC-USD: ${rsiData.data.data['BTC-USD']?.toFixed(2) || 'N/A'}`);
        console.log(`ETH-USD: ${rsiData.data.data['ETH-USD']?.toFixed(2) || 'N/A'}`);
        
        // Check system stats
        const stats = await axios.get('http://localhost:3000/api/stats');
        console.log('\n📊 System Statistics:');
        console.log(`Uptime: ${Math.floor(stats.data.data.uptime / 1000)} seconds`);
        console.log(`Divergences detected: ${stats.data.data.divergenceEngine.divergencesDetected}`);
        console.log(`BTC data points: ${stats.data.data.divergenceEngine.dataPoints['BTC-USD']?.pricePoints || 0}`);
        console.log(`ETH data points: ${stats.data.data.divergenceEngine.dataPoints['ETH-USD']?.pricePoints || 0}`);
        
      } catch (error) {
        console.error('Error checking results:', error.message);
      }
    }, 2000);
    
  } catch (error) {
    console.error('Error injecting data:', error.message);
  }
}

// Run the test
injectTestData();
