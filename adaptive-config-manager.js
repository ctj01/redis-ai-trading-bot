// CONFIGURACIÓN ADAPTATIVA SEGÚN PERÍODO
// Se ajusta automáticamente para optimizar señales según la duración del backtest
const BacktestingEngine = require('./backend/src/services/backtesting-engine');

class AdaptiveConfigurationManager {
    constructor() {
        this.engine = new BacktestingEngine();
    }

    // Detecta automáticamente la configuración óptima según el período
    getOptimalConfig(startDate, endDate, initialBalance = 10000) {
        const periodMonths = this.calculatePeriodMonths(startDate, endDate);
        
        console.log(`📅 Período detectado: ${periodMonths.toFixed(1)} meses`);
        
        if (periodMonths <= 3) {
            return this.getShortPeriodConfig(startDate, endDate, initialBalance);
        } else if (periodMonths <= 6) {
            return this.getMediumPeriodConfig(startDate, endDate, initialBalance);
        } else {
            return this.getLongPeriodConfig(startDate, endDate, initialBalance);
        }
    }

    // Configuración para períodos cortos (1-3 meses) - Máxima calidad
    getShortPeriodConfig(startDate, endDate, initialBalance) {
        console.log('🎯 CONFIGURACIÓN PERÍODO CORTO (1-3 meses)');
        console.log('  📊 Estrategia: Máxima calidad, señales selectivas');
        console.log('  ⏰ Timeframe: 4h (balance perfecto)');
        
        const config = {
            pair: 'BTC-USDT',
            timeframe: '4h',
            startDate: new Date(startDate),
            endDate: new Date(endDate),
            initialBalance,
            riskPerTrade: 0.01,
            
            // CONFIGURACIÓN ULTRA-SELECTIVA
            stopLossMultiplier: 1.4,
            takeProfitMultiplier: 1.8,
            maxHoldCandles: 72,
            
            // FILTROS ESTRICTOS PARA CALIDAD
            entryMinStrength: 0.05,
            minAdx: 12,
            minVolumeRatio: 1.0,
            cooldownCandles: 8,
            commission: 0.001,
            
            // RSI EXTREMO PARA SEÑALES DE ALTA CALIDAD
            rsiLower: 22,
            rsiUpper: 78,
            
            wmTolerance: 20,
            requireStrongTrend: false,
            requireRsiExtreme: false,
            multiConfirmation: false
        };

        // Anti-manipulación estricto
        this.engine.checkAntiManipulation = function(signal) {
            return signal.strength <= 0.55; // Ultra-estricto
        };

        return config;
    }

    // Configuración para períodos medianos (3-6 meses) - Balance
    getMediumPeriodConfig(startDate, endDate, initialBalance) {
        console.log('🎯 CONFIGURACIÓN PERÍODO MEDIANO (3-6 meses)');
        console.log('  📊 Estrategia: Balance calidad/frecuencia');
        console.log('  ⏰ Timeframe: 2h (más oportunidades)');
        
        const config = {
            pair: 'BTC-USDT',
            timeframe: '2h',
            startDate: new Date(startDate),
            endDate: new Date(endDate),
            initialBalance,
            riskPerTrade: 0.015,
            
            // CONFIGURACIÓN BALANCEADA
            stopLossMultiplier: 1.3,
            takeProfitMultiplier: 1.7,
            maxHoldCandles: 84, // 7 días en 2h
            
            // FILTROS MODERADOS
            entryMinStrength: 0.05,
            minAdx: 11,
            minVolumeRatio: 0.9,
            cooldownCandles: 6,
            commission: 0.001,
            
            // RSI RELAJADO
            rsiLower: 25,
            rsiUpper: 75,
            
            wmTolerance: 22,
            requireStrongTrend: false,
            requireRsiExtreme: false,
            multiConfirmation: false
        };

        // Anti-manipulación moderado
        this.engine.checkAntiManipulation = function(signal) {
            return signal.strength <= 0.65; // Moderado
        };

        return config;
    }

    // Configuración para períodos largos (6+ meses) - Máxima frecuencia
    getLongPeriodConfig(startDate, endDate, initialBalance) {
        console.log('🎯 CONFIGURACIÓN PERÍODO LARGO (6+ meses)');
        console.log('  📊 Estrategia: Máxima frecuencia de señales');
        console.log('  ⏰ Timeframe: 1h (granularidad alta)');
        
        const config = {
            pair: 'BTC-USDT',
            timeframe: '1h',
            startDate: new Date(startDate),
            endDate: new Date(endDate),
            initialBalance,
            riskPerTrade: 0.02,
            
            // CONFIGURACIÓN PERMISIVA
            stopLossMultiplier: 1.2,
            takeProfitMultiplier: 1.6,
            maxHoldCandles: 72, // 3 días en 1h
            
            // FILTROS RELAJADOS PARA MÁS SEÑALES
            entryMinStrength: 0.05,
            minAdx: 10,
            minVolumeRatio: 0.8,
            cooldownCandles: 3,
            commission: 0.001,
            
            // RSI MÁS PERMISIVO
            rsiLower: 30,
            rsiUpper: 70,
            
            wmTolerance: 25,
            requireStrongTrend: false,
            requireRsiExtreme: false,
            multiConfirmation: false
        };

        // Anti-manipulación relajado
        this.engine.checkAntiManipulation = function(signal) {
            return signal.strength <= 0.70; // Más permisivo
        };

        return config;
    }

    // Calcula la duración del período en meses
    calculatePeriodMonths(startDate, endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const diffTime = Math.abs(end - start);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays / 30.44; // Promedio de días por mes
    }

    // Ejecuta backtest con configuración adaptativa
    async runAdaptiveBacktest(startDate, endDate, initialBalance = 10000) {
        console.log('\n🚀 EJECUTANDO BACKTEST ADAPTATIVO');
        console.log('==================================================');
        
        const config = this.getOptimalConfig(startDate, endDate, initialBalance);
        
        console.log('\n🔧 PARÁMETROS SELECCIONADOS:');
        console.log(`  ⏰ Timeframe: ${config.timeframe}`);
        console.log(`  🎯 Signal Strength: ≤${this.getSignalStrengthThreshold()}`);
        console.log(`  📈 Take Profit: ${config.takeProfitMultiplier}x ATR`);
        console.log(`  🛑 Stop Loss: ${config.stopLossMultiplier}x ATR`);
        console.log(`  ⏳ Max Hold: ${config.maxHoldCandles} candles`);
        console.log(`  📊 RSI: ${config.rsiLower}/${config.rsiUpper}`);
        console.log(`  🔧 ADX: ≥${config.minAdx}`);
        
        try {
            const result = await this.engine.runBacktest(config);
            
            console.log('\n📊 RESULTADOS ADAPTATIVOS:');
            console.log('==================================================');
            console.log(`📈 Total Trades: ${result.trades.length}`);
            console.log(`🎯 Señales Generadas: ${result.signals.length}`);
            console.log(`✅ Win Rate: ${(result.metrics.winRate * 100).toFixed(1)}%`);
            console.log(`💰 Total Return: ${(result.metrics.totalReturn * 100).toFixed(2)}%`);
            console.log(`📉 Max Drawdown: ${(result.metrics.maxDrawdown * 100).toFixed(2)}%`);
            console.log(`📊 Profit Factor: ${result.metrics.profitFactor || 0}`);
            
            // Análisis de efectividad
            this.analyzeEffectiveness(result, config);
            
            return result;
            
        } catch (error) {
            console.error('❌ Error en backtest adaptativo:', error.message);
            return null;
        }
    }

    // Analiza la efectividad de la configuración adaptativa
    analyzeEffectiveness(result, config) {
        const periodMonths = this.calculatePeriodMonths(config.startDate, config.endDate);
        const tradesPerMonth = result.trades.length / periodMonths;
        
        console.log('\n🔍 ANÁLISIS DE EFECTIVIDAD:');
        console.log(`  📅 Período: ${periodMonths.toFixed(1)} meses`);
        console.log(`  📊 Trades por mes: ${tradesPerMonth.toFixed(1)}`);
        
        if (tradesPerMonth >= 2) {
            console.log('  ✅ FRECUENCIA ÓPTIMA: Configuración balanceada');
        } else if (tradesPerMonth >= 1) {
            console.log('  ⚠️ FRECUENCIA MODERADA: Considerar relajar filtros');
        } else {
            console.log('  ❌ FRECUENCIA BAJA: Configuración muy estricta');
            console.log('  💡 SUGERENCIA: Aumentar signal strength threshold');
        }
        
        if (result.metrics.winRate > 0.4) {
            console.log('  ✅ CALIDAD ALTA: Win rate satisfactorio');
        } else if (result.metrics.winRate > 0.2) {
            console.log('  ⚠️ CALIDAD MODERADA: Revisar exit strategy');
        } else {
            console.log('  ❌ CALIDAD BAJA: Filtros insuficientes');
        }
    }

    // Obtiene el threshold actual de signal strength
    getSignalStrengthThreshold() {
        // Extraer del método actual (esto es una aproximación)
        return '0.55-0.70'; // Rango dependiente del período
    }
}

// Función de prueba con diferentes períodos
async function testAdaptiveConfiguration() {
    console.log('🎯 PRUEBA DE CONFIGURACIÓN ADAPTATIVA');
    console.log('📊 Probando diferentes períodos automáticamente');
    
    const manager = new AdaptiveConfigurationManager();
    
    const testPeriods = [
        {
            name: 'PERÍODO CORTO',
            startDate: '2024-12-01',
            endDate: '2025-01-31'
        },
        {
            name: 'PERÍODO MEDIANO',
            startDate: '2024-10-01',
            endDate: '2025-01-31'
        },
        {
            name: 'PERÍODO LARGO',
            startDate: '2024-06-01',
            endDate: '2025-01-31'
        }
    ];
    
    const results = [];
    
    for (const period of testPeriods) {
        console.log(`\n🔍 PROBANDO ${period.name}:`);
        console.log(`📅 ${period.startDate} → ${period.endDate}`);
        
        const result = await manager.runAdaptiveBacktest(
            period.startDate,
            period.endDate,
            10000
        );
        
        if (result) {
            results.push({
                period: period.name,
                trades: result.trades.length,
                signals: result.signals.length,
                winRate: result.metrics.winRate,
                totalReturn: result.metrics.totalReturn
            });
        }
    }
    
    // Comparación final
    console.log('\n🏆 COMPARACIÓN FINAL:');
    console.log('==================================================');
    results.forEach(r => {
        console.log(`${r.period}:`);
        console.log(`  📊 ${r.trades} trades, ${(r.winRate * 100).toFixed(1)}% WR, ${(r.totalReturn * 100).toFixed(2)}% return`);
    });
    
    return results;
}

// Exportar para uso
module.exports = {
    AdaptiveConfigurationManager,
    testAdaptiveConfiguration
};

// Ejecutar prueba si se ejecuta directamente
if (require.main === module) {
    testAdaptiveConfiguration().then(() => {
        console.log('\n✅ Prueba de configuración adaptativa completada!');
    }).catch(console.error);
}
