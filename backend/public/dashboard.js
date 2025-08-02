/**
 * Advanced Trading Dashboard - Real-time RSI Divergence Monitor
 * Features: Live data updates, WebSocket connection, interactive charts
 */

class AdvancedTradingDashboard {
    constructor() {
        this.ws = null;
        this.chart = null;
        this.equityChart = null;
        this.charts = {};
        this.currentPair = 'BTC-USDT';
        this.currentTimeframe = '1h';
        this.isConnected = false;
        this.reconnectInterval = null;
        this.activeSuggestion = null; // Store currently selected suggestion
        this.dataCache = {
            rsi: {},
            divergences: [],
            portfolio: {},
            stats: {},
            backtests: [],
            tradingSuggestions: [],
            manualTrades: []
        };
        
        this.init();
    }

    async init() {
        try {
            await this.setupWebSocket();
            this.setupEventHandlers();
            await this.loadInitialData();
            this.startPeriodicUpdates();
            this.initializeCharts();
            
            this.showNotification('Dashboard initialized successfully', 'success');
        } catch (error) {
            console.error('Dashboard initialization failed:', error);
            this.showNotification('Failed to initialize dashboard', 'error');
        }
    }

    setupWebSocket() {
        return new Promise((resolve, reject) => {
            try {
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                const wsUrl = `${protocol}//${window.location.host}`;
                
                this.ws = new WebSocket(wsUrl);
                
                this.ws.onopen = () => {
                    console.log('✅ WebSocket connected');
                    this.isConnected = true;
                    this.updateConnectionStatus('connected');
                    this.clearReconnectInterval();
                    resolve();
                };
                
                this.ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        this.handleRealtimeUpdate(data);
                    } catch (error) {
                        console.error('Error parsing WebSocket message:', error);
                    }
                };
                
                this.ws.onclose = (event) => {
                    console.log('❌ WebSocket disconnected:', event.code, event.reason);
                    this.isConnected = false;
                    this.updateConnectionStatus('disconnected');
                    this.scheduleReconnect();
                };
                
                this.ws.onerror = (error) => {
                    console.error('WebSocket error:', error);
                    this.updateConnectionStatus('error');
                    reject(error);
                };
                
                // Timeout for connection
                setTimeout(() => {
                    if (!this.isConnected) {
                        reject(new Error('WebSocket connection timeout'));
                    }
                }, 5000);
                
            } catch (error) {
                reject(error);
            }
        });
    }

    scheduleReconnect() {
        if (this.reconnectInterval) return;
        
        let attempts = 0;
        const maxAttempts = 10;
        
        this.reconnectInterval = setInterval(async () => {
            attempts++;
            console.log(`🔄 Reconnection attempt ${attempts}/${maxAttempts}`);
            
            try {
                await this.setupWebSocket();
                this.showNotification('Connection restored', 'success');
            } catch (error) {
                console.error(`Reconnection attempt ${attempts} failed:`, error);
                
                if (attempts >= maxAttempts) {
                    this.clearReconnectInterval();
                    this.showNotification('Failed to reconnect. Please refresh the page.', 'error');
                }
            }
        }, 5000);
    }

    clearReconnectInterval() {
        if (this.reconnectInterval) {
            clearInterval(this.reconnectInterval);
            this.reconnectInterval = null;
        }
    }

    setupEventHandlers() {
        // Trading pair selection
        document.querySelectorAll('.pair-button').forEach(button => {
            button.addEventListener('click', (e) => {
                const pair = e.target.dataset.pair;
                this.selectTradingPair(pair);
            });
        });

        // Timeframe selection
        document.querySelectorAll('.timeframe-button').forEach(button => {
            button.addEventListener('click', (e) => {
                const timeframe = e.target.dataset.timeframe;
                this.selectTimeframe(timeframe);
            });
        });

        // Refresh button
        const refreshBtn = document.createElement('button');
        refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh';
        refreshBtn.className = 'refresh-button';
        refreshBtn.onclick = () => this.refreshAllData();
        document.querySelector('.status-bar').appendChild(refreshBtn);

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'r') {
                e.preventDefault();
                this.refreshAllData();
            }
        });

        // Manual Trading functionality
        const refreshSuggestionsBtn = document.getElementById('refreshSuggestionsBtn');
        if (refreshSuggestionsBtn) {
            refreshSuggestionsBtn.addEventListener('click', () => this.loadTradingSuggestions());
        }

        const executeTradeBtn = document.getElementById('executeTradeBtn');
        if (executeTradeBtn) {
            executeTradeBtn.addEventListener('click', () => this.executeManualTrade());
        }

        const cancelTradeBtn = document.getElementById('cancelTradeBtn');
        if (cancelTradeBtn) {
            cancelTradeBtn.addEventListener('click', () => this.cancelManualTrade());
        }

        // Backtesting functionality (legacy - remove if not needed)
        const runBacktestBtn = document.getElementById('runBacktestBtn');
        if (runBacktestBtn) {
            runBacktestBtn.addEventListener('click', () => this.runBacktest());
        }

        // Set default dates for backtesting
        this.setDefaultBacktestDates();
    }

    async loadInitialData() {
        await Promise.allSettled([
            this.loadHealthStatus(),
            this.loadPortfolioData(),
            this.loadRSIData(),
            this.loadDivergenceHistory(),
            this.loadPerformanceStats(),
            this.loadTradingSuggestions(),
            this.loadManualTradingPerformance()
        ]);
    }

    async loadHealthStatus() {
        try {
            const response = await fetch('/health');
            const data = await response.json();
            
            this.updateServiceStatus('redis', data.services.redis === 'connected');
            this.updateServiceStatus('engine', data.services.divergenceEngine === 'running');
            
            // Update uptime display
            document.getElementById('uptime').textContent = 
                `Uptime: ${this.formatUptime(data.uptime)}`;
            
        } catch (error) {
            console.error('Failed to load health status:', error);
            this.updateServiceStatus('redis', false);
            this.updateServiceStatus('engine', false);
        }
    }

    async loadPortfolioData() {
        try {
            const [balanceRes, riskRes] = await Promise.all([
                fetch('/api/portfolio/balance'),
                fetch('/api/risk/status')
            ]);
            
            const [balanceData, riskData] = await Promise.all([
                balanceRes.json(),
                riskRes.json()
            ]);
            
            if (balanceData.success) {
                this.updatePortfolioDisplay(balanceData.data, riskData.success ? riskData.data : null);
                this.dataCache.portfolio = { balance: balanceData.data, risk: riskData.data };
            }
            
        } catch (error) {
            console.error('Failed to load portfolio data:', error);
            this.showNotification('Failed to load portfolio data', 'warning');
        }
    }

    async loadRSIData() {
        try {
            const endpoint = this.currentPair === 'all' ? '/api/rsi' : `/api/rsi/${this.currentPair}`;
            const url = `${endpoint}?timeframe=${this.currentTimeframe}`;
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.success) {
                this.updateRSIDisplay(data);
                this.dataCache.rsi = data;
            } else {
                throw new Error(data.error || 'Failed to fetch RSI data');
            }
            
        } catch (error) {
            console.error('Failed to load RSI data:', error);
            // Show user-friendly error message
            document.getElementById('rsiValues').innerHTML = 
                '<div class="alert warning">RSI data temporarily unavailable</div>';
            this.showNotification('Failed to load RSI data', 'warning');
        }
    }

    async loadDivergenceHistory() {
        try {
            const endpoint = this.currentPair === 'all' ? 
                '/api/divergences' : 
                `/api/divergences/${this.currentPair}`;
            
            const url = `${endpoint}?limit=20&timeframe=${this.currentTimeframe}`;
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.success && Array.isArray(data.data)) {
                this.updateDivergenceDisplay(data.data);
                this.dataCache.divergences = data.data;
            } else {
                console.warn('Invalid divergence data format:', data);
                this.updateDivergenceDisplay([]);
            }
            
        } catch (error) {
            console.error('Failed to load divergence history:', error);
            document.getElementById('divergencesList').innerHTML = 
                '<div class="alert warning">Divergence data temporarily unavailable</div>';
            this.showNotification('Failed to load divergence data', 'warning');
        }
    }

    async loadPerformanceStats() {
        try {
            const response = await fetch('/api/stats');
            const data = await response.json();
            
            if (data.success) {
                this.updateStatsDisplay(data.data);
                this.dataCache.stats = data.data;
            }
            
        } catch (error) {
            console.error('Failed to load performance stats:', error);
            this.showNotification('Failed to load statistics', 'warning');
        }
    }

    selectTradingPair(pair) {
        if (this.currentPair === pair) return;
        
        this.currentPair = pair;
        
        // Update UI
        document.querySelectorAll('.pair-button').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-pair="${pair}"]`).classList.add('active');
        
        const pairText = pair === 'all' ? 'All Pairs' : pair;
        document.getElementById('chartPair').textContent = `${pairText} (${this.currentTimeframe})`;
        
        // Reload data for new pair
        this.loadRSIData();
        this.loadDivergenceHistory();
        this.updateChart(pair);
    }

    selectTimeframe(timeframe) {
        if (this.currentTimeframe === timeframe) return;
        
        this.currentTimeframe = timeframe;
        
        // Update UI
        document.querySelectorAll('.timeframe-button').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-timeframe="${timeframe}"]`).classList.add('active');
        
        // Update chart title to show current timeframe
        const pairText = this.currentPair === 'all' ? 'All Pairs' : this.currentPair;
        document.getElementById('chartPair').textContent = `${pairText} (${timeframe})`;
        
        // Show loading state
        const divergenceList = document.getElementById('divergenceList');
        const rsiValues = document.getElementById('rsiValues');
        divergenceList.innerHTML = '<div class="loading">Loading divergences...</div>';
        rsiValues.innerHTML = '<div class="loading">Loading RSI data...</div>';
        
        // Reload data for new timeframe
        this.loadRSIData();
        this.loadDivergenceHistory();
        this.updateChart(this.currentPair);
        
        this.showNotification(`Switched to ${timeframe} timeframe`, 'success');
    }

    updatePortfolioDisplay(balanceData, riskData) {
        // Handle both number and object formats for balance data
        const balance = typeof balanceData === 'number' ? balanceData : 
                       (balanceData?.balance || balanceData?.data || 10000);
        
        document.getElementById('accountBalance').textContent = 
            `$${balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
        
        if (riskData) {
            const pnlElement = document.getElementById('dailyPnL');
            const dailyPnL = typeof riskData.dailyPnL === 'number' ? riskData.dailyPnL : 0;
            const riskExposure = typeof riskData.riskExposure === 'number' ? riskData.riskExposure : 0;
            const openPositions = typeof riskData.openPositions === 'number' ? riskData.openPositions : 0;
            
            pnlElement.textContent = 
                `$${dailyPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
            pnlElement.className = `metric-value ${dailyPnL >= 0 ? 'positive' : 'negative'}`;
            
            document.getElementById('openPositions').textContent = openPositions;
            document.getElementById('riskExposure').textContent = `${riskExposure.toFixed(1)}%`;
        }
    }

    updateRSIDisplay(data) {
        const container = document.getElementById('rsiValues');
        container.innerHTML = '';
        
        if (this.currentPair === 'all' && data.data) {
            // Display all pairs
            Object.entries(data.data).forEach(([pair, rsi]) => {
                if (rsi !== null && rsi !== undefined) {
                    this.addRSIMetric(container, pair, rsi);
                }
            });
        } else if (data.rsi !== null && data.rsi !== undefined) {
            // Display single pair
            this.addRSIMetric(container, this.currentPair, data.rsi);
            this.addRSICondition(container, data.rsi);
        } else {
            container.innerHTML = '<div class="alert warning">RSI data not available</div>';
        }
    }

    addRSIMetric(container, pair, rsi) {
        // Ensure RSI is a valid number
        const rsiValue = typeof rsi === 'number' && !isNaN(rsi) ? rsi : 0;
        const rsiLevel = this.getRSILevel(rsiValue);
        const metric = document.createElement('div');
        metric.className = 'metric';
        metric.innerHTML = `
            <span class="metric-label">${pair}</span>
            <span class="metric-value ${rsiLevel.class}">${rsiValue.toFixed(2)}</span>
        `;
        container.appendChild(metric);
    }

    addRSICondition(container, rsi) {
        // Ensure RSI is a valid number
        const rsiValue = typeof rsi === 'number' && !isNaN(rsi) ? rsi : 0;
        const rsiLevel = this.getRSILevel(rsiValue);
        const metric = document.createElement('div');
        metric.className = 'metric';
        metric.innerHTML = `
            <span class="metric-label">Market Condition</span>
            <span class="metric-value">${rsiLevel.condition}</span>
        `;
        container.appendChild(metric);
    }

    getRSILevel(rsi) {
        if (rsi >= 70) {
            return { class: 'negative', condition: 'Overbought' };
        } else if (rsi <= 30) {
            return { class: 'positive', condition: 'Oversold' };
        } else if (rsi >= 60) {
            return { class: 'warning', condition: 'Strong' };
        } else if (rsi <= 40) {
            return { class: 'warning', condition: 'Weak' };
        } else {
            return { class: '', condition: 'Neutral' };
        }
    }

    updateDivergenceDisplay(divergences) {
        const container = document.getElementById('divergenceList');
        
        if (!container) {
            console.error('Divergence container not found');
            return;
        }
        
        container.innerHTML = '';
        
        // Validate divergences array
        if (!Array.isArray(divergences)) {
            console.warn('Invalid divergences data:', divergences);
            divergences = [];
        }
        
        // Update cache and recalculate stats
        this.dataCache.divergences = divergences;
        this.updateStatsDisplay({}); // Pass empty object to force local calculation
        
        if (divergences && divergences.length > 0) {
            // Add a small header with count
            const header = document.createElement('div');
            header.className = 'divergence-list-header';
            header.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 0 4px 12px 4px; border-bottom: 1px solid rgba(255,255,255,0.1); margin-bottom: 16px;">
                    <span style="color: #a0a0a0; font-size: 0.9rem;">Latest Signals</span>
                    <span style="color: #00d4ff; font-size: 0.8rem; font-weight: 600;">${divergences.length} signal${divergences.length !== 1 ? 's' : ''}</span>
                </div>
            `;
            container.appendChild(header);
            
            // Add divergence items
            divergences.forEach((divergence, index) => {
                try {
                    const item = this.createDivergenceItem(divergence);
                    
                    // Add a subtle animation delay for each item
                    item.style.animation = `fadeInUp 0.3s ease forwards`;
                    item.style.animationDelay = `${index * 0.1}s`;
                    item.style.opacity = '0';
                    
                    container.appendChild(item);
                } catch (error) {
                    console.error('Error creating divergence item:', error, divergence);
                }
            });
        } else {
            // Better empty state
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📊</div>
                    <div class="empty-title">No Divergences Yet</div>
                    <div class="empty-message">
                        The system is monitoring market data.<br>
                        Divergence signals will appear here when detected.
                    </div>
                    <div class="empty-status">
                        <span class="status-dot"></span>
                        <span>Scanning ${this.currentPair === 'all' ? 'all pairs' : this.currentPair}...</span>
                    </div>
                </div>
            `;
        }
    }

    createDivergenceItem(divergence) {
        const item = document.createElement('div');
        item.className = `divergence-item ${(divergence && divergence.type) ? divergence.type : 'unknown'}`;
        
        const strengthPercent = (((divergence && divergence.strength) ? divergence.strength : 0) * 100).toFixed(1);
        let timeAgo, timestamp;
        try {
            timestamp = new Date((divergence && divergence.timestamp) ? divergence.timestamp : new Date());
            timeAgo = this.getTimeAgo(timestamp);
        } catch (error) {
            console.warn('Invalid timestamp:', (divergence && divergence.timestamp) ? divergence.timestamp : 'undefined');
            timeAgo = 'Unknown';
        }
        const timeFormatted = timestamp.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: true 
        });
        
        // Get signal icon and color
        const signalIcon = divergence.type === 'bullish' ? '�' : '�';
        const strengthColor = divergence.type === 'bullish' ? '#00ff88' : '#ff4757';
        
        // Format price properly
        const priceDisplay = divergence.price ? 
            `$${divergence.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}` : 
            'N/A';
        
        item.innerHTML = `
            <div class="div-row">
                <div class="div-left">
                    <div class="div-pair">${divergence.pair}</div>
                    <div class="div-type ${divergence.type}">${divergence.type.toUpperCase()}</div>
                </div>
                <div class="div-right">
                    <div class="div-strength">${strengthPercent}%</div>
                    <div class="div-time">${timeAgo}</div>
                </div>
            </div>
        `;
        
        return item;
    }

    updateStatsDisplay(stats) {
        // If we have cached divergences, calculate stats from them
        if (this.dataCache.divergences && Array.isArray(this.dataCache.divergences)) {
            const divergences = this.dataCache.divergences;
            const now = Date.now();
            
            // Filter divergences from last 24 hours for recent stats
            const recentDivergences = divergences.filter(d => {
                const divTime = d.timestamp || now;
                return (now - divTime) < (24 * 60 * 60 * 1000); // 24 hours
            });
            
            const bullishCount = recentDivergences.filter(d => d.type === 'bullish').length;
            const bearishCount = recentDivergences.filter(d => d.type === 'bearish').length;
            const totalCount = recentDivergences.length;
            
            const avgStrength = totalCount > 0 ? 
                recentDivergences.reduce((sum, d) => sum + (d.strength || 0), 0) / totalCount : 0;
            
            // Update values with animation
            this.updateStatElement('totalSignals', totalCount);
            this.updateStatElement('bullishSignals', bullishCount);
            this.updateStatElement('bearishSignals', bearishCount);
            this.updateStatElement('avgStrength', `${(avgStrength * 100).toFixed(1)}%`);
            
            // Update colors based on signal types
            const bullishElement = document.getElementById('bullishSignals');
            const bearishElement = document.getElementById('bearishSignals');
            
            if (bullishCount > 0) {
                bullishElement.classList.add('positive');
                bullishElement.classList.remove('negative');
            }
            
            if (bearishCount > 0) {
                bearishElement.classList.add('negative');
                bearishElement.classList.remove('positive');
            }
            
        } else {
            // Fallback to backend stats if available
            const divStats = stats?.divergenceEngine || {};
            
            this.updateStatElement('totalSignals', divStats.totalSignals || 0);
            this.updateStatElement('bullishSignals', divStats.bullishSignals || 0);
            this.updateStatElement('bearishSignals', divStats.bearishSignals || 0);
            this.updateStatElement('avgStrength', `${((divStats.averageStrength || 0) * 100).toFixed(1)}%`);
        }
    }

    updateStatElement(elementId, newValue) {
        const element = document.getElementById(elementId);
        if (element && element.textContent != newValue) {
            element.textContent = newValue;
            element.classList.add('updated');
            setTimeout(() => element.classList.remove('updated'), 600);
        }
    }

    handleRealtimeUpdate(data) {
        switch (data.type) {
            case 'divergence':
                this.handleNewDivergence(data.data);
                break;
            case 'rsi_update':
                this.handleRSIUpdate(data.data);
                break;
            case 'trade_executed':
                this.handleTradeUpdate(data.data);
                break;
            case 'portfolio_update':
                this.handlePortfolioUpdate(data.data);
                break;
            default:
                console.log('Unknown realtime update:', data);
        }
    }

    handleNewDivergence(divergence) {
        // Add to divergence list
        const container = document.getElementById('divergenceList');
        
        // If container is empty (showing empty state), reload divergences
        if (!container.firstChild || container.querySelector('.empty-state')) {
            this.loadDivergenceHistory();
            return;
        }
        
        const item = this.createDivergenceItem(divergence);
        container.insertBefore(item, container.firstChild);
        
        // Remove excess items
        if (container.children.length > 21) { // +1 for header
            container.removeChild(container.lastChild);
        }
        
        // Update cache
        if (!this.dataCache.divergences) {
            this.dataCache.divergences = [];
        }
        this.dataCache.divergences.unshift(divergence);
        if (this.dataCache.divergences.length > 20) {
            this.dataCache.divergences.pop();
        }
        
        // Update stats immediately
        this.updateStatsDisplay({});
        
        // Show notification
        this.showNotification(
            `New ${divergence.type} divergence detected on ${divergence.pair}`,
            divergence.type === 'bullish' ? 'success' : 'warning'
        );
        
        // Play sound or vibration for significant signals
        if (divergence.strength && divergence.strength > 0.5) {
            this.playNotificationSound();
        }
    }

    handleRSIUpdate(data) {
        // Update RSI cache
        this.dataCache.rsi[data.pair] = data.rsi;
        
        // Update display if relevant
        if (this.currentPair === data.pair || this.currentPair === 'all') {
            this.loadRSIData();
        }
        
        // Update chart
        if (this.currentPair === data.pair) {
            this.addChartDataPoint(data.pair, data.rsi, data.timestamp);
        }
    }

    handleTradeUpdate(trade) {
        this.showNotification(
            `Trade executed: ${trade.side} ${trade.pair} at $${trade.price}`,
            'info'
        );
        this.loadPortfolioData();
    }

    handlePortfolioUpdate(portfolio) {
        this.updatePortfolioDisplay(portfolio.balance, portfolio.risk);
    }

    initializeCharts() {
        // Initialize RSI Chart with Chart.js
        const ctx = document.getElementById('rsiChart');
        if (!ctx) {
            console.error('RSI chart canvas not found');
            return;
        }
        
        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'RSI',
                    data: [],
                    borderColor: '#00d4ff',
                    backgroundColor: 'rgba(0, 212, 255, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 2,
                    pointHoverRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: {
                            color: '#ffffff',
                            font: {
                                family: 'Inter'
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: {
                            color: '#a0a0a0',
                            font: {
                                family: 'Inter'
                            }
                        },
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        }
                    },
                    y: {
                        min: 0,
                        max: 100,
                        ticks: {
                            color: '#a0a0a0',
                            font: {
                                family: 'Inter'
                            },
                            callback: function(value) {
                                return value + '%';
                            }
                        },
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        }
                    }
                },
                elements: {
                    point: {
                        radius: 0,
                        hoverRadius: 5
                    }
                },
                plugins: {
                    annotation: {
                        annotations: {
                            overbought: {
                                type: 'line',
                                yMin: 70,
                                yMax: 70,
                                borderColor: 'rgba(255, 71, 87, 0.7)',
                                borderWidth: 2,
                                borderDash: [5, 5],
                                label: {
                                    content: 'Overbought (70)',
                                    enabled: true,
                                    position: 'end'
                                }
                            },
                            oversold: {
                                type: 'line',
                                yMin: 30,
                                yMax: 30,
                                borderColor: 'rgba(0, 255, 136, 0.7)',
                                borderWidth: 2,
                                borderDash: [5, 5],
                                label: {
                                    content: 'Oversold (30)',
                                    enabled: true,
                                    position: 'end'
                                }
                            }
                        }
                    }
                }
            }
        });
        
        // Load initial chart data
        this.loadChartData();
        
        console.log('✅ RSI Chart initialized successfully');
    }

    async loadChartData() {
        try {
            // Generate some sample RSI data for demonstration
            const now = new Date();
            const labels = [];
            const rsiData = [];
            
            // Generate 50 data points over the last 50 minutes
            for (let i = 49; i >= 0; i--) {
                const time = new Date(now.getTime() - i * 60000);
                labels.push(time.toLocaleTimeString('en-US', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                }));
                
                // Generate realistic RSI data with some trend
                let rsi;
                if (i > 40) {
                    rsi = 30 + Math.random() * 20; // Oversold region
                } else if (i > 20) {
                    rsi = 40 + Math.random() * 30; // Normal range
                } else {
                    rsi = 60 + Math.random() * 20; // Moving to overbought
                }
                
                rsiData.push(Number(rsi.toFixed(2)));
            }
            
            // Update chart with data
            this.chart.data.labels = labels;
            this.chart.data.datasets[0].data = rsiData;
            this.chart.update();
            
            console.log('✅ Chart data loaded');
            
        } catch (error) {
            console.error('Failed to load chart data:', error);
        }
    }

    updateChart(pair) {
        // Update chart title
        document.getElementById('chartPair').textContent = 
            pair === 'all' ? 'All Pairs' : pair;
        
        // Reload chart data for the selected pair
        this.loadChartData();
        
        console.log(`Chart updated for ${pair}`);
    }

    addChartDataPoint(pair, rsi, timestamp) {
        // Only update chart if it's for the current pair
        if (pair !== this.currentPair && this.currentPair !== 'all') {
            return;
        }
        
        if (!this.chart) {
            console.warn('Chart not initialized yet');
            return;
        }
        
        const time = new Date(timestamp).toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        // Add new data point
        this.chart.data.labels.push(time);
        this.chart.data.datasets[0].data.push(rsi);
        
        // Keep only last 50 data points
        if (this.chart.data.labels.length > 50) {
            this.chart.data.labels.shift();
            this.chart.data.datasets[0].data.shift();
        }
        
        // Update chart smoothly
        this.chart.update('none');
        
        console.log(`Added RSI data point: ${pair} = ${rsi} at ${time}`);
    }

    updateConnectionStatus(status) {
        const indicators = {
            'bingxStatus': status === 'connected',
            'engineStatus': status === 'connected'
        };
        
        Object.entries(indicators).forEach(([id, connected]) => {
            this.updateServiceStatus(id.replace('Status', ''), connected);
        });
    }

    updateServiceStatus(service, isHealthy) {
        const elementId = service === 'redis' ? 'redisStatus' : 
                         service === 'engine' ? 'engineStatus' : 
                         service === 'bingx' ? 'bingxStatus' : null;
        
        if (elementId) {
            const element = document.getElementById(elementId);
            element.className = 'status-indicator';
            
            if (isHealthy) {
                element.style.background = '#00ff88';
            } else {
                element.style.background = '#ff4757';
            }
        }
    }

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas fa-${this.getNotificationIcon(type)}"></i>
                <span>${message}</span>
            </div>
            <button class="notification-close">&times;</button>
        `;
        
        // Add to page
        let container = document.querySelector('.notification-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'notification-container';
            document.body.appendChild(container);
        }
        
        container.appendChild(notification);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 5000);
        
        // Close button
        notification.querySelector('.notification-close').onclick = () => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        };
    }

    getNotificationIcon(type) {
        switch (type) {
            case 'success': return 'check-circle';
            case 'warning': return 'exclamation-triangle';
            case 'error': return 'times-circle';
            default: return 'info-circle';
        }
    }

    startPeriodicUpdates() {
        // Refresh data every 30 seconds
        setInterval(() => {
            if (this.isConnected) {
                this.loadHealthStatus();
                this.loadRSIData();
            }
        }, 30000);
        
        // Update portfolio every minute
        setInterval(() => {
            if (this.isConnected) {
                this.loadPortfolioData();
            }
        }, 60000);
    }

    async refreshAllData() {
        const refreshBtn = document.querySelector('.refresh-button');
        if (refreshBtn) {
            refreshBtn.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i> Refreshing...';
            refreshBtn.disabled = true;
        }
        
        try {
            await this.loadInitialData();
            this.showNotification('Data refreshed successfully', 'success');
        } catch (error) {
            console.error('Failed to refresh data:', error);
            this.showNotification('Failed to refresh data', 'error');
        } finally {
            if (refreshBtn) {
                refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh';
                refreshBtn.disabled = false;
            }
        }
    }

    formatUptime(uptimeMs) {
        const seconds = Math.floor(uptimeMs / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }

    getTimeAgo(date) {
        const now = new Date();
        const diffMs = now - date;
        const diffSecs = Math.floor(diffMs / 1000);
        const diffMins = Math.floor(diffSecs / 60);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);
        
        if (diffDays > 0) return `${diffDays}d ago`;
        if (diffHours > 0) return `${diffHours}h ago`;
        if (diffMins > 0) return `${diffMins}m ago`;
        return `${diffSecs}s ago`;
    }

    playNotificationSound() {
        try {
            // Create a simple beep sound using Web Audio API
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.value = 800; // Frequency in Hz
            oscillator.type = 'sine';
            
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.3);
        } catch (error) {
            console.log('Audio notification not available:', error);
            // Fallback to browser notification if available
            if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('Trading Signal', {
                    body: 'New divergence signal detected',
                    icon: '/favicon.ico'
                });
            }
        }
    }

    setDefaultBacktestDates() {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 3); // 3 months ago
        
        const startDateInput = document.getElementById('backtestStartDate');
        const endDateInput = document.getElementById('backtestEndDate');
        
        if (startDateInput) {
            startDateInput.value = startDate.toISOString().split('T')[0];
        }
        if (endDateInput) {
            endDateInput.value = endDate.toISOString().split('T')[0];
        }
    }

    async runBacktest() {
        try {
            const startDate = document.getElementById('backtestStartDate').value;
            const endDate = document.getElementById('backtestEndDate').value;
            const initialBalance = parseFloat(document.getElementById('backtestBalance').value) || 10000;
            
            if (!startDate || !endDate) {
                this.showNotification('Please select start and end dates', 'warning');
                return;
            }
            
            if (new Date(startDate) >= new Date(endDate)) {
                this.showNotification('Start date must be before end date', 'warning');
                return;
            }
            
            const btn = document.getElementById('runBacktestBtn');
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Running...';
            btn.disabled = true;
            
            this.showNotification('Starting backtest...', 'info');
            
            const config = {
                initialBalance: initialBalance,
                riskPerTrade: 0.02,
                stopLoss: 0.05,
                takeProfit: 0.10,
                minStrength: 0.1,
                commission: 0.001
            };
            
            const response = await fetch('/api/backtest/run', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    pair: this.currentPair === 'all' ? 'BTC-USDT' : this.currentPair,
                    timeframe: this.currentTimeframe,
                    startDate: startDate,
                    endDate: endDate,
                    config: config
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.displayBacktestResults(result.data);
                this.showNotification('Backtest completed successfully!', 'success');
            } else {
                throw new Error(result.error || 'Backtest failed');
            }
            
        } catch (error) {
            console.error('Backtest error:', error);
            this.showNotification(`Backtest failed: ${error.message}`, 'error');
        } finally {
            const btn = document.getElementById('runBacktestBtn');
            btn.innerHTML = '<i class="fas fa-play"></i> Run Backtest';
            btn.disabled = false;
        }
    }

    displayBacktestResults(results) {
        // Show results section
        const resultsDiv = document.getElementById('backtestResults');
        resultsDiv.style.display = 'block';
        
        // Safe helper function to get numeric value with fallback
        const safeNumber = (value, fallback = 0) => {
            return (typeof value === 'number' && !isNaN(value)) ? value : fallback;
        };
        
        // Update metrics with safe values
        document.getElementById('backtestReturn').textContent = `${safeNumber(results.totalReturn).toFixed(2)}%`;
        document.getElementById('backtestTrades').textContent = safeNumber(results.totalTrades);
        document.getElementById('backtestWinRate').textContent = `${safeNumber(results.metrics?.winRate).toFixed(2)}%`;
        document.getElementById('backtestDrawdown').textContent = `${safeNumber(results.maxDrawdown).toFixed(2)}%`;
        document.getElementById('backtestSharpe').textContent = safeNumber(results.metrics?.sharpeRatio).toFixed(3);
        document.getElementById('backtestProfitFactor').textContent = safeNumber(results.metrics?.profitFactor).toFixed(2);
        
        // Update colors based on performance
        const returnElement = document.getElementById('backtestReturn');
        const drawdownElement = document.getElementById('backtestDrawdown');
        
        returnElement.classList.remove('positive', 'negative');
        const totalReturn = safeNumber(results.totalReturn);
        if (totalReturn > 0) {
            returnElement.classList.add('positive');
        } else if (totalReturn < 0) {
            returnElement.classList.add('negative');
        }
        
        drawdownElement.classList.add('negative');
        
        // Create equity curve chart
        this.createEquityCurve(results.equity || [], results.timestamps);
        
        // Store in cache
        this.dataCache.backtests.unshift(results);
        if (this.dataCache.backtests.length > 10) {
            this.dataCache.backtests.pop();
        }
    }

    createEquityCurve(equity, timestamps) {
        const ctx = document.getElementById('equityChart');
        if (!ctx) return;
        
        // Destroy existing chart
        if (this.equityChart) {
            this.equityChart.destroy();
        }
        
        // Safely handle equity data
        const safeEquity = Array.isArray(equity) ? equity : [];
        
        // Extract labels and data from equity array
        const labels = safeEquity.map((point, index) => {
            if (point && point.timestamp) {
                return new Date(point.timestamp).toLocaleDateString();
            }
            return `Point ${index + 1}`;
        });
        
        const equityData = safeEquity.map(point => {
            return (point && typeof point.value === 'number') ? point.value : 0;
        });
        
        this.equityChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Portfolio Equity',
                    data: equityData,
                    borderColor: '#00d4ff',
                    backgroundColor: 'rgba(0, 212, 255, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        titleColor: '#ffffff',
                        bodyColor: '#ffffff',
                        borderColor: '#00d4ff',
                        borderWidth: 1
                    }
                },
                scales: {
                    x: {
                        display: true,
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        },
                        ticks: {
                            color: '#a0a0a0',
                            maxTicksLimit: 8
                        }
                    },
                    y: {
                        display: true,
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        },
                        ticks: {
                            color: '#a0a0a0',
                            callback: function(value) {
                                return '$' + value.toLocaleString();
                            }
                        }
                    }
                }
            }
        });
    }

    // === MANUAL TRADING METHODS ===

    /**
     * Load trading suggestions from the server
     */
    async loadTradingSuggestions() {
        try {
            const response = await fetch('/api/trading/suggestions');
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                // Ensure data.data is always an array
                let suggestions = data.data || [];
                
                // If it's a single object, convert to array
                if (!Array.isArray(suggestions)) {
                    suggestions = suggestions ? [suggestions] : [];
                }
                
                this.dataCache.tradingSuggestions = suggestions;
                this.updateTradingSuggestionsDisplay(suggestions);
                
                if (suggestions.length > 0) {
                    this.showNotification(`${suggestions.length} trading suggestions loaded`, 'success');
                } else {
                    this.showNotification('No active trading suggestions found', 'info');
                }
            } else {
                console.warn('Failed to load trading suggestions:', data.error);
                this.updateTradingSuggestionsDisplay([]);
                this.showNotification('Failed to load trading suggestions: ' + (data.error || 'Unknown error'), 'warning');
            }
            
        } catch (error) {
            console.error('Failed to load trading suggestions:', error);
            this.showNotification('Failed to load trading suggestions: ' + error.message, 'warning');
            this.updateTradingSuggestionsDisplay([]);
        }
    }

    /**
     * Force generation of new trading suggestions for multiple pairs
     */
    async generateNewSuggestions() {
        try {
            this.showNotification('Generating new trading suggestions...', 'info');
            
            const pairs = ['BTC-USDT', 'ETH-USDT', 'BNB-USDT'];
            const timeframes = ['1h', '4h'];
            const suggestions = [];
            
            for (const pair of pairs) {
                for (const timeframe of timeframes) {
                    try {
                        const response = await fetch(`/api/trading/suggestions/${pair}?timeframe=${timeframe}`);
                        if (response.ok) {
                            const data = await response.json();
                            if (data.success && data.data) {
                                suggestions.push(data.data);
                            }
                        }
                    } catch (error) {
                        console.warn(`Failed to generate suggestion for ${pair} ${timeframe}:`, error);
                    }
                }
            }
            
            if (suggestions.length > 0) {
                this.dataCache.tradingSuggestions = suggestions;
                this.updateTradingSuggestionsDisplay(suggestions);
                this.showNotification(`Generated ${suggestions.length} new trading suggestions!`, 'success');
            } else {
                this.showNotification('No trading opportunities found at this time', 'warning');
                // Still load any existing active suggestions
                await this.loadTradingSuggestions();
            }
            
        } catch (error) {
            console.error('Failed to generate new suggestions:', error);
            this.showNotification('Failed to generate new suggestions: ' + error.message, 'error');
        }
    }

    /**
     * Update the trading suggestions display
     */
    updateTradingSuggestionsDisplay(suggestions) {
        const container = document.getElementById('tradingSuggestionsList');
        
        if (!container) {
            console.warn('Trading suggestions container not found');
            return;
        }
        
        // Ensure suggestions is an array
        if (!Array.isArray(suggestions)) {
            suggestions = suggestions ? [suggestions] : [];
        }
        
        if (suggestions.length === 0) {
            container.innerHTML = `
                <div class="loading">
                    <div class="no-suggestions">
                        <i class="icon">📊</i>
                        <h3>No Active Trading Suggestions</h3>
                        <p>Generating new suggestions... Please wait or click "Load Suggestions" to refresh.</p>
                        <button onclick="dashboard.generateNewSuggestions()" class="btn btn-primary">
                            🔄 Generate New Suggestions
                        </button>
                    </div>
                </div>
            `;
            return;
        }

        try {
            container.innerHTML = suggestions.map(suggestion => 
                this.createSuggestionItem(suggestion)
            ).join('');

            // Add click handlers for suggestions
            container.querySelectorAll('.suggestion-item').forEach((item, index) => {
                item.addEventListener('click', () => this.selectSuggestion(suggestions[index]));
            });
            
            // Auto-select and display technical analysis for the first suggestion
            if (suggestions.length > 0 && suggestions[0].technicalAnalysis) {
                this.updateTechnicalAnalysisDisplay(suggestions[0].technicalAnalysis);
                console.log('✅ Technical analysis auto-updated for first suggestion');
            }
            
            console.log(`✅ ${suggestions.length} trading suggestions displayed`);
            
        } catch (error) {
            console.error('Error updating suggestions display:', error);
            container.innerHTML = `
                <div class="loading error">
                    <i class="icon">⚠️</i>
                    <p>Error displaying suggestions: ${error.message}</p>
                    <button onclick="dashboard.generateNewSuggestions()" class="btn btn-primary">
                        🔄 Generate New Suggestions
                    </button>
                </div>
            `;
        }
    }

    /**
     * Create HTML for a trading suggestion item
     */
    createSuggestionItem(suggestion) {
        const strengthClass = suggestion.signal.strength > 0.7 ? 'high-strength' : 
                             suggestion.signal.strength > 0.4 ? 'medium-strength' : 'low-strength';
        
        const timeAgo = this.getTimeAgo(new Date(suggestion.timestamp));
        const expiresIn = this.getTimeUntilExpiry(suggestion.expiresAt);
        
        return `
            <div class="suggestion-item ${strengthClass}" data-suggestion-id="${suggestion.id}">
                <div class="suggestion-header">
                    <span class="suggestion-pair">${suggestion.pair}</span>
                    <span class="suggestion-action ${suggestion.action.toLowerCase()}">${suggestion.action}</span>
                </div>
                
                <div class="suggestion-details">
                    <div class="suggestion-detail">
                        <span class="suggestion-detail-label">Entry Price</span>
                        <span class="suggestion-detail-value">$${suggestion.entryPrice.toLocaleString()}</span>
                    </div>
                    <div class="suggestion-detail">
                        <span class="suggestion-detail-label">Stop Loss</span>
                        <span class="suggestion-detail-value">$${suggestion.stopLoss.toLocaleString()}</span>
                    </div>
                    <div class="suggestion-detail">
                        <span class="suggestion-detail-label">Take Profit</span>
                        <span class="suggestion-detail-value">$${suggestion.takeProfit.toLocaleString()}</span>
                    </div>
                    <div class="suggestion-detail">
                        <span class="suggestion-detail-label">R/R Ratio</span>
                        <span class="suggestion-detail-value">${suggestion.riskRewardRatio.toFixed(2)}:1</span>
                    </div>
                    <div class="suggestion-detail">
                        <span class="suggestion-detail-label">Strength</span>
                        <span class="suggestion-detail-value">${(suggestion.signal.strength * 100).toFixed(1)}%</span>
                    </div>
                    <div class="suggestion-detail">
                        <span class="suggestion-detail-label">Expires</span>
                        <span class="suggestion-detail-value">${expiresIn}</span>
                    </div>
                </div>
                
                <div style="margin-top: 10px; font-size: 0.8rem; color: #a0a0a0;">
                    Generated ${timeAgo} | RSI: ${suggestion.technicalAnalysis.rsi.toFixed(1)} | ${suggestion.signal.source}
                </div>
            </div>
        `;
    }

    /**
     * Select a trading suggestion for manual execution
     */
    selectSuggestion(suggestion) {
        console.log('🔍 Selected suggestion data:', suggestion);
        console.log('🔍 Technical analysis data:', suggestion.technicalAnalysis);
        
        this.activeSuggestion = suggestion;
        this.showManualTradePanel(suggestion);
        this.updateTechnicalAnalysisDisplay(suggestion.technicalAnalysis);
        
        // Highlight selected suggestion
        document.querySelectorAll('.suggestion-item').forEach(item => {
            item.style.background = 'rgba(255, 255, 255, 0.05)';
        });
        
        const selectedItem = document.querySelector(`[data-suggestion-id="${suggestion.id}"]`);
        if (selectedItem) {
            selectedItem.style.background = 'rgba(0, 212, 255, 0.15)';
        }
    }

    /**
     * Show the manual trade execution panel
     */
    showManualTradePanel(suggestion) {
        const panel = document.getElementById('manualTradePanel');
        panel.style.display = 'block';
        
        // Fill in trade details
        document.getElementById('tradePair').textContent = suggestion.pair;
        document.getElementById('tradeAction').textContent = suggestion.action;
        document.getElementById('tradeEntryPrice').textContent = `$${suggestion.entryPrice.toLocaleString()}`;
        document.getElementById('tradeStopLoss').textContent = `$${suggestion.stopLoss.toLocaleString()}`;
        document.getElementById('tradeTakeProfit').textContent = `$${suggestion.takeProfit.toLocaleString()}`;
        document.getElementById('tradeRiskReward').textContent = `${suggestion.riskRewardRatio.toFixed(2)}:1`;
        
        // Set suggested position size
        document.getElementById('customPositionSize').value = suggestion.suggestedPositionSize.toFixed(2);
        
        // Clear notes
        document.getElementById('tradeNotes').value = '';
        
        this.showNotification(`Selected ${suggestion.action} ${suggestion.pair} suggestion`, 'info');
    }

    /**
     * Execute the selected manual trade
     */
    async executeManualTrade() {
        if (!this.activeSuggestion) {
            this.showNotification('No suggestion selected', 'warning');
            return;
        }

        try {
            const executeBtn = document.getElementById('executeTradeBtn');
            executeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Executing...';
            executeBtn.disabled = true;

            const executionType = document.getElementById('executionType').value;
            const customSize = parseFloat(document.getElementById('customPositionSize').value);
            const notes = document.getElementById('tradeNotes').value;

            const customParams = {
                quantity: customSize || this.activeSuggestion.suggestedPositionSize,
                notes: notes
            };

            const response = await fetch('/api/trading/execute', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    suggestionId: this.activeSuggestion.id,
                    executionType: executionType,
                    customParams: customParams
                })
            });

            const result = await response.json();

            if (result.success) {
                this.showNotification(`Trade executed: ${result.data.action} ${result.data.pair}`, 'success');
                this.cancelManualTrade();
                this.loadManualTradingPerformance();
                this.loadTradingSuggestions(); // Refresh suggestions
            } else {
                throw new Error(result.error || 'Trade execution failed');
            }

        } catch (error) {
            console.error('Error executing manual trade:', error);
            this.showNotification(`Trade execution failed: ${error.message}`, 'error');
        } finally {
            const executeBtn = document.getElementById('executeTradeBtn');
            executeBtn.innerHTML = '<i class="fas fa-play"></i> Execute Trade';
            executeBtn.disabled = false;
        }
    }

    /**
     * Cancel manual trade selection
     */
    cancelManualTrade() {
        this.activeSuggestion = null;
        const panel = document.getElementById('manualTradePanel');
        panel.style.display = 'none';
        
        // Remove highlight from suggestions
        document.querySelectorAll('.suggestion-item').forEach(item => {
            item.style.background = 'rgba(255, 255, 255, 0.05)';
        });
        
        this.showNotification('Trade selection cancelled', 'info');
    }

    /**
     * Update technical analysis display
     */
    updateTechnicalAnalysisDisplay(technicalAnalysis) {
        try {
            if (!technicalAnalysis) {
                console.warn('No technical analysis data provided');
                return;
            }

            // Update RSI
            const rsiElement = document.getElementById('currentRSI');
            if (rsiElement && technicalAnalysis.rsi !== undefined) {
                rsiElement.textContent = technicalAnalysis.rsi.toFixed(1);
            } else if (rsiElement) {
                rsiElement.textContent = '--';
            }

            // Update ADX
            const adxElement = document.getElementById('currentADX');
            if (adxElement && technicalAnalysis.adx !== undefined) {
                adxElement.textContent = technicalAnalysis.adx.toFixed(1);
            } else if (adxElement) {
                adxElement.textContent = '--';
            }

            // Update Trend
            const trendElement = document.getElementById('currentTrend');
            if (trendElement && technicalAnalysis.trend !== undefined) {
                trendElement.textContent = technicalAnalysis.trend;
            } else if (trendElement) {
                trendElement.textContent = '--';
            }

            // Update Volatility
            const volatilityElement = document.getElementById('currentVolatility');
            if (volatilityElement) {
                // Try to get volatility from technicalAnalysis first, then from marketContext
                const volatility = technicalAnalysis.volatility || 
                                  (this.activeSuggestion?.marketContext?.volatility) || 0;
                volatilityElement.textContent = `${(volatility * 100).toFixed(2)}%`;
            }

            console.log('✅ Technical analysis updated:', {
                rsi: technicalAnalysis.rsi,
                adx: technicalAnalysis.adx,
                trend: technicalAnalysis.trend,
                volatility: technicalAnalysis.volatility,
                fullData: technicalAnalysis
            });

        } catch (error) {
            console.error('Error updating technical analysis display:', error);
        }
    }

    /**
     * Load manual trading performance
     */
    async loadManualTradingPerformance() {
        try {
            const [performanceRes, tradesRes] = await Promise.all([
                fetch('/api/trading/performance'),
                fetch('/api/trading/history?limit=10')
            ]);
            
            const [performanceData, tradesData] = await Promise.all([
                performanceRes.json(),
                tradesRes.json()
            ]);
            
            if (performanceData.success) {
                this.updatePerformanceDisplay(performanceData.data);
            }
            
            if (tradesData.success) {
                this.dataCache.manualTrades = tradesData.data || [];
                this.updateManualTradesDisplay(tradesData.data || []);
            }
            
        } catch (error) {
            console.error('Failed to load manual trading data:', error);
            this.showNotification('Failed to load trading performance', 'warning');
        }
    }

    /**
     * Update performance metrics display
     */
    updatePerformanceDisplay(performance) {
        document.getElementById('totalTrades').textContent = performance.totalTrades;
        document.getElementById('winRate').textContent = `${performance.winRate.toFixed(1)}%`;
        
        const totalPnLElement = document.getElementById('totalPnL');
        totalPnLElement.textContent = `$${performance.totalPnL.toFixed(2)}`;
        totalPnLElement.className = `metric-value ${performance.totalPnL >= 0 ? 'positive' : 'negative'}`;
        
        document.getElementById('currentBalance').textContent = `$${performance.currentBalance.toLocaleString()}`;
    }

    /**
     * Update manual trades list display
     */
    updateManualTradesDisplay(trades) {
        const container = document.getElementById('manualTradesList');
        
        if (!trades || trades.length === 0) {
            container.innerHTML = '<div class="no-trades">No manual trades yet</div>';
            return;
        }

        container.innerHTML = trades.map(trade => this.createTradeItem(trade)).join('');
    }

    /**
     * Create HTML for a manual trade item
     */
    createTradeItem(trade) {
        const timeAgo = this.getTimeAgo(new Date(trade.timestamp));
        const pnlClass = trade.pnl >= 0 ? 'positive' : 'negative';
        
        return `
            <div class="trade-item">
                <div class="trade-basic-info">
                    <div class="trade-pair-action">${trade.action} ${trade.pair}</div>
                    <div class="trade-time">${timeAgo} | ${trade.executionType}</div>
                </div>
                <div class="trade-pnl ${pnlClass}">
                    ${trade.pnl >= 0 ? '+' : ''}$${trade.pnl.toFixed(2)}
                </div>
            </div>
        `;
    }

    /**
     * Get time until expiry
     */
    getTimeUntilExpiry(expiresAt) {
        const now = Date.now();
        const expiry = new Date(expiresAt).getTime();
        const diff = expiry - now;
        
        if (diff <= 0) return 'Expired';
        
        const minutes = Math.floor(diff / 60000);
        if (minutes < 60) return `${minutes}m`;
        
        const hours = Math.floor(minutes / 60);
        return `${hours}h ${minutes % 60}m`;
    }

    /**
     * Refresh all manual trading data
     */
    async refreshManualTradingData() {
        await Promise.all([
            this.loadTradingSuggestions(),
            this.loadManualTradingPerformance()
        ]);
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AdvancedTradingDashboard;
}
