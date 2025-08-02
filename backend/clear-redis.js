const Redis = require('ioredis');

async function clearRedisData() {
  const client = new Redis({
    host: 'localhost',
    port: 6379
  });

  try {
    console.log('🧹 Clearing Redis data...');
    await client.flushall();
    console.log('✅ Redis data cleared successfully');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error clearing Redis:', error);
    process.exit(1);
  } finally {
    client.disconnect();
  }
}

clearRedisData();
