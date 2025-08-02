// Configuración para obtener datos reales de BingX
// 1. Crea una cuenta en BingX (https://bingx.com)
// 2. Genera API keys (solo lectura para datos históricos)
// 3. Actualiza el archivo .env con las credenciales reales

module.exports = {
  // Pasos para configurar BingX:
  
  // 1. REGISTRO EN BINGX
  //    - Ve a https://bingx.com
  //    - Crea una cuenta
  //    - Completa la verificación
  
  // 2. GENERAR API KEYS
  //    - Ve a API Management
  //    - Crea nuevas API keys
  //    - Permisos: Solo "Read" (para datos históricos)
  //    - Guarda API Key y Secret Key
  
  // 3. ACTUALIZAR .ENV
  //    BINGX_API_KEY=tu_api_key_real
  //    BINGX_SECRET_KEY=tu_secret_key_real
  
  // 4. ENDPOINTS DISPONIBLES
  endpoints: {
    klines: '/api/v3/klines',        // Datos históricos
    ticker: '/api/v3/ticker/24hr',   // Precios 24h
    depth: '/api/v3/depth',          // Order book
    trades: '/api/v3/trades'         // Trades recientes
  },
  
  // 5. PARÁMETROS PARA DATOS HISTÓRICOS
  klinesParams: {
    symbol: 'BTC-USDT',     // Par de trading
    interval: '4h',         // Timeframe: 1m, 5m, 15m, 1h, 4h, 1d
    startTime: 1730419200000, // Timestamp inicio
    endTime: 1738281600000,   // Timestamp fin
    limit: 1000             // Máximo 1000 velas por request
  },
  
  // 6. FORMATO DE RESPUESTA BINGX
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

// NOTA: Para datos históricos NO necesitas fondos en la cuenta
// Solo necesitas API keys con permisos de lectura
