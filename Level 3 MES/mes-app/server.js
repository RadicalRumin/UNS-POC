const express = require('express');
const mqtt = require('mqtt');
const redis = require('redis');
const { MongoClient } = require('mongodb');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');

class MESService {
    constructor() {
        this.app = express();
        this.port = process.env.PORT || 3001;
        
        // Connection strings
        this.mqttUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
        this.redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
        this.mongoUrl = process.env.MONGODB_URL || 'mongodb://localhost:27017/mes_data';
        this.pgConfig = {
            host: process.env.POSTGRES_HOST || 'mes-postgres',
            database: process.env.POSTGRES_DB || 'mes_workorders',
            user: process.env.POSTGRES_USER || 'mes_user',
            password: process.env.POSTGRES_PASSWORD || 'mes_password',
            port: 5432
        };

        // Clients
        this.mqttClient = null;
        this.redisClient = null;
        this.mongoClient = null;
        this.pgPool = null;
        
        // MES Data
        this.workOrders = new Map();
        this.productionSchedule = [];
        this.qualityData = [];
        this.equipmentStatus = new Map();
        
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
            
            // Subscribe to UNS data
            this.subscribeToUNSData();
            
            // Initialize sample work orders
            await this.initializeSampleData();
            
            // Start the server
            this.app.listen(this.port, () => {
                console.log(`MES Service running on port ${this.port}`);
            });
            
        } catch (error) {
            console.error('MES Service initialization error:', error);
            process.exit(1);
        }
    }

    async initMQTT() {
        return new Promise((resolve, reject) => {
            console.log(`Connecting to MQTT broker: ${this.mqttUrl}`);
            this.mqttClient = mqtt.connect(this.mqttUrl, {
                clientId: `mes-service-${uuidv4()}`,
                clean: true,
                reconnectPeriod: 5000
            });

            this.mqttClient.on('connect', () => {
                console.log('MES: Connected to MQTT broker');
                resolve();
            });

            this.mqttClient.on('error', (error) => {
                console.error('MES: MQTT connection error:', error);
                reject(error);
            });

            this.mqttClient.on('message', (topic, message) => {
                this.processUNSMessage(topic, message);
            });
        });
    }

    async initRedis() {
        this.redisClient = redis.createClient({ url: this.redisUrl });
        await this.redisClient.connect();
        console.log('MES: Connected to Redis');
    }

    async initMongoDB() {
        this.mongoClient = new MongoClient(this.mongoUrl);
        await this.mongoClient.connect();
        this.db = this.mongoClient.db('mes_data');
        console.log('MES: Connected to MongoDB');
    }

    async initPostgreSQL() {
        this.pgPool = new Pool(this.pgConfig);
        
        // Test connection
        const client = await this.pgPool.connect();
        await client.query('SELECT NOW()');
        client.release();
        
        console.log('MES: Connected to PostgreSQL');
    }

    setupRoutes() {
        // Dashboard endpoint
        this.app.get('/', (req, res) => {
            res.send(`
                <html>
                <head><title>MES Dashboard</title></head>
                <body>
                    <h1>Manufacturing Execution System</h1>
                    <h2>Available Endpoints:</h2>
                    <ul>
                        <li><a href="/api/workorders">Work Orders</a></li>
                        <li><a href="/api/production-schedule">Production Schedule</a></li>
                        <li><a href="/api/quality-metrics">Quality Metrics</a></li>
                        <li><a href="/api/equipment-status">Equipment Status</a></li>
                        <li><a href="/api/kpis">Key Performance Indicators</a></li>
                    </ul>
                </body>
                </html>
            `);
        });

        // Work Orders API
        this.app.get('/api/workorders', async (req, res) => {
            try {
                const client = await this.pgPool.connect();
                const result = await client.query(`
                    SELECT * FROM work_orders 
                    ORDER BY created_at DESC 
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

        this.app.post('/api/workorders', async (req, res) => {
            try {
                const { product_code, quantity, priority, equipment_id } = req.body;
                const workOrderId = uuidv4();
                
                const client = await this.pgPool.connect();
                await client.query(`
                    INSERT INTO work_orders (id, product_code, quantity, priority, equipment_id, status, created_at)
                    VALUES ($1, $2, $3, $4, $5, 'PENDING', NOW())
                `, [workOrderId, product_code, quantity, priority, equipment_id]);
                client.release();
                
                res.json({
                    success: true,
                    workOrderId: workOrderId,
                    message: 'Work order created successfully'
                });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Production Schedule API
        this.app.get('/api/production-schedule', (req, res) => {
            res.json({
                success: true,
                data: this.productionSchedule,
                timestamp: new Date().toISOString()
            });
        });

        // Quality Metrics API
        this.app.get('/api/quality-metrics', async (req, res) => {
            try {
                const collection = this.db.collection('quality_data');
                const qualityData = await collection.find({})
                    .sort({ timestamp: -1 })
                    .limit(100)
                    .toArray();
                
                res.json({
                    success: true,
                    data: qualityData,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Equipment Status API
        this.app.get('/api/equipment-status', (req, res) => {
            const statusArray = Array.from(this.equipmentStatus.entries()).map(([id, status]) => ({
                equipmentId: id,
                ...status
            }));
            
            res.json({
                success: true,
                data: statusArray,
                timestamp: new Date().toISOString()
            });
        });

        // KPIs API
        this.app.get('/api/kpis', async (req, res) => {
            try {
                const kpis = await this.calculateKPIs();
                res.json({
                    success: true,
                    data: kpis,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });
    }

    subscribeToUNSData() {
        // Subscribe to standardized UNS topics
        const topics = [
            'uns/+/+/equipment/status',
            'uns/+/+/process/parameters',
            'uns/+/+/quality/metrics',
            'uns/+/+/maintenance/status'
        ];

        topics.forEach(topic => {
            this.mqttClient.subscribe(topic, { qos: 1 }, (error) => {
                if (error) {
                    console.error(`MES: Error subscribing to ${topic}:`, error);
                } else {
                    console.log(`MES: Subscribed to ${topic}`);
                }
            });
        });
    }

    async processUNSMessage(topic, message) {
        try {
            const data = JSON.parse(message.toString());
            console.log(`MES: Processing UNS message from ${topic}`);
            
            // Update equipment status
            this.updateEquipmentStatus(data);
            
            // Process quality data
            if (data.quality) {
                await this.processQualityData(data);
            }
            
            // Check work order progress
            await this.updateWorkOrderProgress(data);
            
            // Store production data
            await this.storeProductionData(data);
            
        } catch (error) {
            console.error('MES: Error processing UNS message:', error);
        }
    }

    updateEquipmentStatus(data) {
        if (data.equipment && data.source) {
            this.equipmentStatus.set(data.source.equipmentId, {
                status: data.equipment.status,
                availability: data.equipment.availability,
                efficiency: data.equipment.performance.efficiency,
                lastUpdate: new Date().toISOString(),
                area: data.source.area,
                equipmentType: data.source.equipmentClass
            });
        }
    }

    async processQualityData(data) {
        if (data.quality) {
            const qualityRecord = {
                equipmentId: data.source.equipmentId,
                timestamp: data.timestamp,
                goodParts: data.quality.goodParts,
                badParts: data.quality.badParts,
                rejectRate: data.quality.rejectRate,
                totalParts: data.quality.totalParts,
                area: data.source.area
            };
            
            const collection = this.db.collection('quality_data');
            await collection.insertOne(qualityRecord);
            
            this.qualityData.push(qualityRecord);
            
            // Keep only last 1000 records in memory
            if (this.qualityData.length > 1000) {
                this.qualityData = this.qualityData.slice(-1000);
            }
        }
    }

    async updateWorkOrderProgress(data) {
        try {
            if (data.equipment && data.equipment.performance.cycleCount) {
                const client = await this.pgPool.connect();
                
                // Find active work orders for this equipment
                const result = await client.query(`
                    SELECT * FROM work_orders 
                    WHERE equipment_id = $1 AND status IN ('IN_PROGRESS', 'STARTED')
                    ORDER BY created_at ASC
                    LIMIT 1
                `, [data.source.equipmentId]);
                
                if (result.rows.length > 0) {
                    const workOrder = result.rows[0];
                    const newProgress = Math.min(100, (data.equipment.performance.cycleCount / workOrder.quantity) * 100);
                    
                    await client.query(`
                        UPDATE work_orders 
                        SET progress = $1, updated_at = NOW()
                        WHERE id = $2
                    `, [Math.round(newProgress), workOrder.id]);
                    
                    // Mark as completed if progress reaches 100%
                    if (newProgress >= 100) {
                        await client.query(`
                            UPDATE work_orders 
                            SET status = 'COMPLETED', completed_at = NOW()
                            WHERE id = $1
                        `, [workOrder.id]);
                    }
                }
                
                client.release();
            }
        } catch (error) {
            console.error('MES: Error updating work order progress:', error);
        }
    }

    async storeProductionData(data) {
        const collection = this.db.collection('production_data');
        await collection.insertOne({
            ...data,
            processedAt: new Date(),
            source: 'MES'
        });
    }

    async calculateKPIs() {
        const now = moment();
        const last24h = now.clone().subtract(24, 'hours').toDate();
        
        // Overall Equipment Effectiveness (OEE)
        const equipmentArray = Array.from(this.equipmentStatus.values());
        const avgAvailability = equipmentArray.reduce((sum, eq) => sum + eq.availability, 0) / equipmentArray.length || 0;
        const avgEfficiency = equipmentArray.reduce((sum, eq) => sum + eq.efficiency, 0) / equipmentArray.length || 0;
        
        // Quality metrics from last 24 hours
        const recentQuality = this.qualityData.filter(q => new Date(q.timestamp) > last24h);
        const totalParts = recentQuality.reduce((sum, q) => sum + q.totalParts, 0);
        const goodParts = recentQuality.reduce((sum, q) => sum + q.goodParts, 0);
        const qualityRate = totalParts > 0 ? (goodParts / totalParts) * 100 : 100;
        
        // OEE calculation (Availability × Performance × Quality)
        const oee = (avgAvailability / 100) * (avgEfficiency / 100) * (qualityRate / 100) * 100;
        
        // Work order metrics
        const client = await this.pgPool.connect();
        const workOrderStats = await client.query(`
            SELECT 
                status,
                COUNT(*) as count,
                AVG(progress) as avg_progress
            FROM work_orders 
            WHERE created_at > $1
            GROUP BY status
        `, [last24h]);
        client.release();
        
        return {
            oee: Math.round(oee * 100) / 100,
            availability: Math.round(avgAvailability * 100) / 100,
            performance: Math.round(avgEfficiency * 100) / 100,
            quality: Math.round(qualityRate * 100) / 100,
            totalPartsProduced: totalParts,
            qualityRate: Math.round(qualityRate * 100) / 100,
            activeEquipment: equipmentArray.length,
            workOrders: workOrderStats.rows,
            calculatedAt: new Date().toISOString()
        };
    }

    async initializeSampleData() {
        try {
            const client = await this.pgPool.connect();
            
            // Create sample work orders
            const sampleOrders = [
                { product_code: 'PROD_001', quantity: 1000, priority: 'HIGH', equipment_id: 'LINE_01' },
                { product_code: 'PROD_002', quantity: 500, priority: 'MEDIUM', equipment_id: 'PKG_01' },
                { product_code: 'PROD_003', quantity: 750, priority: 'LOW', equipment_id: 'CONV_01' }
            ];
            
            for (const order of sampleOrders) {
                await client.query(`
                    INSERT INTO work_orders (id, product_code, quantity, priority, equipment_id, status, created_at)
                    VALUES ($1, $2, $3, $4, $5, 'IN_PROGRESS', NOW())
                    ON CONFLICT (id) DO NOTHING
                `, [uuidv4(), order.product_code, order.quantity, order.priority, order.equipment_id]);
            }
            
            client.release();
            console.log('MES: Sample work orders initialized');
            
        } catch (error) {
            console.error('MES: Error initializing sample data:', error);
        }
    }
}

// Start the MES service
new MESService();