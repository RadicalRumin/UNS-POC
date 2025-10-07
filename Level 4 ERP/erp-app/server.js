const express = require('express');
const mqtt = require('mqtt');
const redis = require('redis');
const { MongoClient } = require('mongodb');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
const axios = require('axios');
const cron = require('node-cron');

class ERPService {
    constructor() {
        this.app = express();
        this.port = process.env.PORT || 3002;
        
        // Connection strings
        this.mqttUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
        this.redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
        this.mongoUrl = process.env.MONGODB_URL || 'mongodb://localhost:27017/erp_data';
        this.mesApiUrl = process.env.MES_API_URL || 'http://localhost:3001';
        this.pgConfig = {
            host: process.env.POSTGRES_HOST || 'erp-postgres',
            database: process.env.POSTGRES_DB || 'erp_analytics',
            user: process.env.POSTGRES_USER || 'erp_user',
            password: process.env.POSTGRES_PASSWORD || 'erp_password',
            port: 5432
        };

        // Clients
        this.mqttClient = null;
        this.redisClient = null;
        this.mongoClient = null;
        this.pgPool = null;
        
        // ERP Data
        this.inventory = new Map();
        this.orders = new Map();
        this.financialData = {
            revenue: 0,
            costs: 0,
            profit: 0
        };
        this.suppliers = new Map();
        this.customers = new Map();
        
        this.init();
    }

    async init() {
        try {
            // Setup Express middleware
            this.app.use(cors());
            this.app.use(bodyParser.json());
            this.app.use(express.static('public'));
            
            // Initialize connections
            await this.initMQTT();
            await this.initRedis();
            await this.initMongoDB();
            await this.initPostgreSQL();
            
            // Setup routes
            this.setupRoutes();
            
            // Subscribe to UNS and MES data
            this.subscribeToData();
            
            // Initialize sample data
            await this.initializeSampleData();
            
            // Setup scheduled jobs
            this.setupScheduledJobs();
            
            // Start the server
            this.app.listen(this.port, () => {
                console.log(`ERP Service running on port ${this.port}`);
            });
            
        } catch (error) {
            console.error('ERP Service initialization error:', error);
            process.exit(1);
        }
    }

    async initMQTT() {
        return new Promise((resolve, reject) => {
            console.log(`Connecting to MQTT broker: ${this.mqttUrl}`);
            this.mqttClient = mqtt.connect(this.mqttUrl, {
                clientId: `erp-service-${uuidv4()}`,
                clean: true,
                reconnectPeriod: 5000
            });

            this.mqttClient.on('connect', () => {
                console.log('ERP: Connected to MQTT broker');
                resolve();
            });

            this.mqttClient.on('error', (error) => {
                console.error('ERP: MQTT connection error:', error);
                reject(error);
            });

            this.mqttClient.on('message', (topic, message) => {
                this.processMessage(topic, message);
            });
        });
    }

    async initRedis() {
        this.redisClient = redis.createClient({ url: this.redisUrl });
        await this.redisClient.connect();
        console.log('ERP: Connected to Redis');
    }

    async initMongoDB() {
        this.mongoClient = new MongoClient(this.mongoUrl);
        await this.mongoClient.connect();
        this.db = this.mongoClient.db('erp_data');
        console.log('ERP: Connected to MongoDB');
    }

    async initPostgreSQL() {
        this.pgPool = new Pool(this.pgConfig);
        
        // Test connection
        const client = await this.pgPool.connect();
        await client.query('SELECT NOW()');
        client.release();
        
        console.log('ERP: Connected to PostgreSQL');
    }

    setupRoutes() {
        // Dashboard endpoint
        this.app.get('/', (req, res) => {
            res.send(`
                <html>
                <head><title>ERP Dashboard</title></head>
                <body>
                    <h1>Enterprise Resource Planning System</h1>
                    <h2>Available Endpoints:</h2>
                    <ul>
                        <li><a href="/api/inventory">Inventory Management</a></li>
                        <li><a href="/api/orders">Sales Orders</a></li>
                        <li><a href="/api/financial">Financial Overview</a></li>
                        <li><a href="/api/suppliers">Supplier Management</a></li>
                        <li><a href="/api/analytics">Business Analytics</a></li>
                        <li><a href="/api/reports">Executive Reports</a></li>
                    </ul>
                </body>
                </html>
            `);
        });

        // Inventory Management API
        this.app.get('/api/inventory', async (req, res) => {
            try {
                const client = await this.pgPool.connect();
                const result = await client.query(`
                    SELECT * FROM inventory 
                    ORDER BY product_code
                `);
                client.release();
                
                res.json({
                    success: true,
                    data: result.rows,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        this.app.post('/api/inventory/adjust', async (req, res) => {
            try {
                const { product_code, adjustment, reason } = req.body;
                
                const client = await this.pgPool.connect();
                await client.query(`
                    UPDATE inventory 
                    SET quantity = quantity + $1, last_updated = NOW()
                    WHERE product_code = $2
                `, [adjustment, product_code]);
                
                // Log inventory transaction
                await client.query(`
                    INSERT INTO inventory_transactions (product_code, transaction_type, quantity, reason, created_at)
                    VALUES ($1, 'ADJUSTMENT', $2, $3, NOW())
                `, [product_code, adjustment, reason]);
                
                client.release();
                
                res.json({
                    success: true,
                    message: 'Inventory adjusted successfully'
                });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Sales Orders API
        this.app.get('/api/orders', async (req, res) => {
            try {
                const client = await this.pgPool.connect();
                const result = await client.query(`
                    SELECT o.*, c.name as customer_name 
                    FROM sales_orders o
                    LEFT JOIN customers c ON o.customer_id = c.id
                    ORDER BY o.created_at DESC 
                    LIMIT 50
                `);
                client.release();
                
                res.json({
                    success: true,
                    data: result.rows,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        this.app.post('/api/orders', async (req, res) => {
            try {
                const { customer_id, product_code, quantity, unit_price } = req.body;
                const orderId = uuidv4();
                const totalAmount = quantity * unit_price;
                
                const client = await this.pgPool.connect();
                await client.query(`
                    INSERT INTO sales_orders (id, customer_id, product_code, quantity, unit_price, total_amount, status, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', NOW())
                `, [orderId, customer_id, product_code, quantity, unit_price, totalAmount]);
                client.release();
                
                res.json({
                    success: true,
                    orderId: orderId,
                    message: 'Sales order created successfully'
                });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Financial Overview API
        this.app.get('/api/financial', async (req, res) => {
            try {
                const financials = await this.calculateFinancials();
                res.json({
                    success: true,
                    data: financials,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Suppliers API
        this.app.get('/api/suppliers', async (req, res) => {
            try {
                const client = await this.pgPool.connect();
                const result = await client.query(`
                    SELECT s.*, 
                           COUNT(po.id) as purchase_orders_count,
                           COALESCE(SUM(po.total_amount), 0) as total_spent
                    FROM suppliers s
                    LEFT JOIN purchase_orders po ON s.id = po.supplier_id
                    GROUP BY s.id
                    ORDER BY s.name
                `);
                client.release();
                
                res.json({
                    success: true,
                    data: result.rows,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Business Analytics API
        this.app.get('/api/analytics', async (req, res) => {
            try {
                const analytics = await this.generateAnalytics();
                res.json({
                    success: true,
                    data: analytics,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Executive Reports API
        this.app.get('/api/reports', async (req, res) => {
            try {
                const reports = await this.generateExecutiveReports();
                res.json({
                    success: true,
                    data: reports,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });
    }

    subscribeToData() {
        // Subscribe to aggregated UNS data
        const topics = [
            'uns/enterprise/+/+',
            'uns/+/+/quality/metrics',
            'uns/+/+/maintenance/status'
        ];

        topics.forEach(topic => {
            this.mqttClient.subscribe(topic, { qos: 1 }, (error) => {
                if (error) {
                    console.error(`ERP: Error subscribing to ${topic}:`, error);
                } else {
                    console.log(`ERP: Subscribed to ${topic}`);
                }
            });
        });
    }

    async processMessage(topic, message) {
        try {
            const data = JSON.parse(message.toString());
            console.log(`ERP: Processing message from ${topic}`);
            
            // Update inventory based on production data
            if (data.quality && data.quality.goodParts) {
                await this.updateInventoryFromProduction(data);
            }
            
            // Track equipment costs and depreciation
            if (data.equipment) {
                await this.trackEquipmentCosts(data);
            }
            
            // Update financial metrics
            await this.updateFinancialMetrics(data);
            
            // Store enterprise data
            await this.storeEnterpriseData(data);
            
        } catch (error) {
            console.error('ERP: Error processing message:', error);
        }
    }

    async updateInventoryFromProduction(data) {
        try {
            if (data.quality && data.quality.goodParts > 0) {
                const client = await this.pgPool.connect();
                
                // Map equipment to product codes
                const productMapping = {
                    'LINE_01': 'PROD_001',
                    'PKG_01': 'PROD_002',
                    'CONV_01': 'PROD_003'
                };
                
                const productCode = productMapping[data.source.equipmentId];
                if (productCode) {
                    await client.query(`
                        UPDATE inventory 
                        SET quantity = quantity + $1, last_updated = NOW()
                        WHERE product_code = $2
                    `, [data.quality.goodParts, productCode]);
                    
                    // Log inventory transaction
                    await client.query(`
                        INSERT INTO inventory_transactions (product_code, transaction_type, quantity, reason, created_at)
                        VALUES ($1, 'PRODUCTION', $2, $3, NOW())
                    `, [productCode, data.quality.goodParts, `Production from ${data.source.equipmentId}`]);
                }
                
                client.release();
            }
        } catch (error) {
            console.error('ERP: Error updating inventory from production:', error);
        }
    }

    async trackEquipmentCosts(data) {
        try {
            const collection = this.db.collection('equipment_costs');
            
            // Calculate hourly operating cost based on power consumption and efficiency
            const powerCost = data.process?.parameters?.powerConsumption?.value * 0.12 || 0; // $0.12/kWh
            const maintenanceCost = data.equipment.availability < 90 ? 50 : 10; // Higher cost for low availability
            const totalCost = powerCost + maintenanceCost;
            
            await collection.insertOne({
                equipmentId: data.source.equipmentId,
                timestamp: data.timestamp,
                powerCost: powerCost,
                maintenanceCost: maintenanceCost,
                totalHourlyCost: totalCost,
                availability: data.equipment.availability,
                efficiency: data.equipment.performance.efficiency
            });
            
        } catch (error) {
            console.error('ERP: Error tracking equipment costs:', error);
        }
    }

    async updateFinancialMetrics(data) {
        // Update financial metrics based on production and quality data
        if (data.quality) {
            const productValue = data.quality.goodParts * 25; // $25 per good part
            const wasteValue = data.quality.badParts * 15; // $15 lost per bad part
            
            this.financialData.revenue += productValue;
            this.financialData.costs += wasteValue;
            this.financialData.profit = this.financialData.revenue - this.financialData.costs;
        }
    }

    async storeEnterpriseData(data) {
        const collection = this.db.collection('enterprise_data');
        await collection.insertOne({
            ...data,
            processedAt: new Date(),
            source: 'ERP'
        });
    }

    async calculateFinancials() {
        const client = await this.pgPool.connect();
        
        // Calculate revenue from sales orders
        const revenueResult = await client.query(`
            SELECT 
                SUM(total_amount) as total_revenue,
                COUNT(*) as total_orders
            FROM sales_orders 
            WHERE status IN ('COMPLETED', 'SHIPPED')
            AND created_at >= CURRENT_DATE - INTERVAL '30 days'
        `);
        
        // Calculate costs from purchase orders
        const costsResult = await client.query(`
            SELECT 
                SUM(total_amount) as total_costs
            FROM purchase_orders 
            WHERE status = 'COMPLETED'
            AND created_at >= CURRENT_DATE - INTERVAL '30 days'
        `);
        
        // Calculate inventory value
        const inventoryResult = await client.query(`
            SELECT 
                SUM(quantity * unit_cost) as inventory_value
            FROM inventory
        `);
        
        client.release();
        
        const revenue = parseFloat(revenueResult.rows[0].total_revenue) || 0;
        const costs = parseFloat(costsResult.rows[0].total_costs) || 0;
        const inventoryValue = parseFloat(inventoryResult.rows[0].inventory_value) || 0;
        
        return {
            revenue: revenue,
            costs: costs,
            profit: revenue - costs,
            profitMargin: revenue > 0 ? ((revenue - costs) / revenue) * 100 : 0,
            inventoryValue: inventoryValue,
            totalOrders: parseInt(revenueResult.rows[0].total_orders) || 0
        };
    }

    async generateAnalytics() {
        try {
            // Get MES KPIs
            let mesKPIs = {};
            try {
                const response = await axios.get(`${this.mesApiUrl}/api/kpis`);
                mesKPIs = response.data.data;
            } catch (error) {
                console.warn('ERP: Could not fetch MES KPIs:', error.message);
            }
            
            // Calculate ERP-specific analytics
            const financials = await this.calculateFinancials();
            
            const client = await this.pgPool.connect();
            
            // Customer analytics
            const customerMetrics = await client.query(`
                SELECT 
                    COUNT(DISTINCT c.id) as total_customers,
                    AVG(order_stats.avg_order_value) as avg_order_value,
                    SUM(order_stats.total_orders) as total_orders
                FROM customers c
                LEFT JOIN (
                    SELECT 
                        customer_id,
                        AVG(total_amount) as avg_order_value,
                        COUNT(*) as total_orders
                    FROM sales_orders
                    WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
                    GROUP BY customer_id
                ) order_stats ON c.id = order_stats.customer_id
            `);
            
            // Supplier performance
            const supplierMetrics = await client.query(`
                SELECT 
                    COUNT(*) as total_suppliers,
                    AVG(delivery_rating) as avg_delivery_rating,
                    AVG(quality_rating) as avg_quality_rating
                FROM suppliers
            `);
            
            client.release();
            
            return {
                financials: financials,
                manufacturing: {
                    oee: mesKPIs.oee || 0,
                    availability: mesKPIs.availability || 0,
                    performance: mesKPIs.performance || 0,
                    quality: mesKPIs.quality || 0
                },
                customers: {
                    totalCustomers: parseInt(customerMetrics.rows[0].total_customers) || 0,
                    avgOrderValue: parseFloat(customerMetrics.rows[0].avg_order_value) || 0,
                    totalOrders: parseInt(customerMetrics.rows[0].total_orders) || 0
                },
                suppliers: {
                    totalSuppliers: parseInt(supplierMetrics.rows[0].total_suppliers) || 0,
                    avgDeliveryRating: parseFloat(supplierMetrics.rows[0].avg_delivery_rating) || 0,
                    avgQualityRating: parseFloat(supplierMetrics.rows[0].avg_quality_rating) || 0
                },
                calculatedAt: new Date().toISOString()
            };
            
        } catch (error) {
            console.error('ERP: Error generating analytics:', error);
            throw error;
        }
    }

    async generateExecutiveReports() {
        const analytics = await this.generateAnalytics();
        const financials = analytics.financials;
        
        return {
            summary: {
                totalRevenue: financials.revenue,
                totalProfit: financials.profit,
                profitMargin: financials.profitMargin,
                inventoryValue: financials.inventoryValue,
                customerCount: analytics.customers.totalCustomers,
                supplierCount: analytics.suppliers.totalSuppliers
            },
            kpis: {
                manufacturingOEE: analytics.manufacturing.oee,
                customerSatisfaction: 87.5, // Mock data
                supplierPerformance: analytics.suppliers.avgDeliveryRating,
                inventoryTurnover: 4.2, // Mock data
                cashFlow: financials.profit * 0.85 // Mock calculation
            },
            trends: {
                revenueGrowth: 12.5, // Mock percentage
                profitGrowth: 8.3,   // Mock percentage
                customerGrowth: 15.2, // Mock percentage
                qualityImprovement: analytics.manufacturing.quality - 85 // Improvement over baseline
            },
            alerts: this.generateAlerts(analytics),
            generatedAt: new Date().toISOString()
        };
    }

    generateAlerts(analytics) {
        const alerts = [];
        
        if (analytics.manufacturing.oee < 70) {
            alerts.push({
                type: 'WARNING',
                category: 'MANUFACTURING',
                message: `OEE is below target at ${analytics.manufacturing.oee}%`,
                action: 'Review equipment performance and maintenance schedules'
            });
        }
        
        if (analytics.financials.profitMargin < 10) {
            alerts.push({
                type: 'CRITICAL',
                category: 'FINANCIAL',
                message: `Profit margin is low at ${analytics.financials.profitMargin.toFixed(1)}%`,
                action: 'Review pricing strategy and cost optimization'
            });
        }
        
        if (analytics.manufacturing.quality < 95) {
            alerts.push({
                type: 'WARNING',
                category: 'QUALITY',
                message: `Quality rate is below target at ${analytics.manufacturing.quality}%`,
                action: 'Investigate quality control processes'
            });
        }
        
        return alerts;
    }

    setupScheduledJobs() {
        // Run financial calculations every hour
        cron.schedule('0 * * * *', async () => {
            try {
                console.log('ERP: Running scheduled financial calculations...');
                await this.calculateFinancials();
            } catch (error) {
                console.error('ERP: Error in scheduled financial calculations:', error);
            }
        });
        
        // Generate daily reports at midnight
        cron.schedule('0 0 * * *', async () => {
            try {
                console.log('ERP: Generating daily executive reports...');
                const reports = await this.generateExecutiveReports();
                
                // Store daily report
                const collection = this.db.collection('daily_reports');
                await collection.insertOne({
                    ...reports,
                    reportDate: moment().format('YYYY-MM-DD')
                });
            } catch (error) {
                console.error('ERP: Error generating daily reports:', error);
            }
        });
    }

    async initializeSampleData() {
        try {
            const client = await this.pgPool.connect();
            
            // Initialize sample customers
            const customers = [
                { name: 'ACME Corporation', email: 'orders@acme.com', phone: '555-0001' },
                { name: 'Global Industries', email: 'procurement@global.com', phone: '555-0002' },
                { name: 'Tech Solutions Ltd', email: 'purchasing@techsol.com', phone: '555-0003' }
            ];
            
            for (const customer of customers) {
                await client.query(`
                    INSERT INTO customers (id, name, email, phone, created_at)
                    VALUES ($1, $2, $3, $4, NOW())
                    ON CONFLICT (email) DO NOTHING
                `, [uuidv4(), customer.name, customer.email, customer.phone]);
            }
            
            // Initialize sample suppliers
            const suppliers = [
                { name: 'Steel Supply Co', email: 'sales@steelsupply.com', delivery_rating: 4.2, quality_rating: 4.5 },
                { name: 'Electronics Depot', email: 'orders@elecdepot.com', delivery_rating: 4.7, quality_rating: 4.3 },
                { name: 'Packaging Materials Inc', email: 'sales@packmat.com', delivery_rating: 4.1, quality_rating: 4.8 }
            ];
            
            for (const supplier of suppliers) {
                await client.query(`
                    INSERT INTO suppliers (id, name, email, delivery_rating, quality_rating, created_at)
                    VALUES ($1, $2, $3, $4, $5, NOW())
                    ON CONFLICT (email) DO NOTHING
                `, [uuidv4(), supplier.name, supplier.email, supplier.delivery_rating, supplier.quality_rating]);
            }
            
            // Initialize sample inventory
            const inventory = [
                { product_code: 'PROD_001', name: 'Industrial Widget A', quantity: 500, unit_cost: 25.00 },
                { product_code: 'PROD_002', name: 'Industrial Widget B', quantity: 300, unit_cost: 32.50 },
                { product_code: 'PROD_003', name: 'Industrial Widget C', quantity: 750, unit_cost: 18.75 }
            ];
            
            for (const item of inventory) {
                await client.query(`
                    INSERT INTO inventory (product_code, name, quantity, unit_cost, last_updated)
                    VALUES ($1, $2, $3, $4, NOW())
                    ON CONFLICT (product_code) DO NOTHING
                `, [item.product_code, item.name, item.quantity, item.unit_cost]);
            }
            
            client.release();
            console.log('ERP: Sample data initialized');
            
        } catch (error) {
            console.error('ERP: Error initializing sample data:', error);
        }
    }
}

// Start the ERP service
new ERPService();