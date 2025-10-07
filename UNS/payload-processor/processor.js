const mqtt = require('mqtt');
const Joi = require('joi');
const redis = require('redis');
const { MongoClient } = require('mongodb');
const { v4: uuidv4 } = require('uuid');

class PayloadProcessor {
    constructor() {
        this.brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
        this.redisUrl = process.env.REDIS_URL || 'redis://redis:6379';
        this.mongoUrl = process.env.MONGO_URL || 'mongodb://admin:password123@mongodb:27017/uns_data?authSource=admin';
        
        this.mqttClient = null;
        this.redisClient = null;
        this.mongoClient = null;
        this.db = null;
        
        this.init();
    }

    async init() {
        try {
            // Initialize MQTT
            await this.initMQTT();
            
            // Initialize Redis
            await this.initRedis();
            
            // Initialize MongoDB
            await this.initMongoDB();
            
            // Subscribe to raw data topics
            this.subscribeToRawData();
            
        } catch (error) {
            console.error('Initialization error:', error);
            process.exit(1);
        }
    }

    async initMQTT() {
        return new Promise((resolve, reject) => {
            console.log(`Connecting to MQTT broker: ${this.brokerUrl}`);
            this.mqttClient = mqtt.connect(this.brokerUrl, {
                clientId: `payload-processor-${uuidv4()}`,
                clean: true,
                reconnectPeriod: 5000
            });

            this.mqttClient.on('connect', () => {
                console.log('Connected to MQTT broker');
                resolve();
            });

            this.mqttClient.on('error', (error) => {
                console.error('MQTT connection error:', error);
                reject(error);
            });

            this.mqttClient.on('message', (topic, message) => {
                this.processMessage(topic, message);
            });
        });
    }

    async initRedis() {
        this.redisClient = redis.createClient({ url: this.redisUrl });
        
        this.redisClient.on('error', (error) => {
            console.error('Redis connection error:', error);
        });
        
        await this.redisClient.connect();
        console.log('Connected to Redis');
    }

    async initMongoDB() {
        this.mongoClient = new MongoClient(this.mongoUrl);
        await this.mongoClient.connect();
        this.db = this.mongoClient.db('uns_data');
        console.log('Connected to MongoDB');
    }

    subscribeToRawData() {
        // Subscribe to all raw PLC data
        const rawTopics = [
            'raw/plc/+/data',
            'raw/scada/+/data',
            'raw/sensor/+/data'
        ];

        rawTopics.forEach(topic => {
            this.mqttClient.subscribe(topic, { qos: 1 }, (error) => {
                if (error) {
                    console.error(`Error subscribing to ${topic}:`, error);
                } else {
                    console.log(`Subscribed to ${topic}`);
                }
            });
        });
    }

    async processMessage(topic, message) {
        try {
            const rawData = JSON.parse(message.toString());
            console.log(`Processing message from ${topic}`);
            
            // Validate incoming data
            const validationResult = this.validateRawData(rawData);
            if (validationResult.error) {
                console.error('Data validation failed:', validationResult.error.details);
                return;
            }

            // Transform to ISA-95 standard format
            const standardizedData = this.transformToISA95(rawData, topic);
            
            // Store in Redis for real-time access
            await this.cacheData(standardizedData);
            
            // Store in MongoDB for historical data
            await this.persistData(standardizedData);
            
            // Publish standardized data to UNS topics
            await this.publishStandardizedData(standardizedData);
            
        } catch (error) {
            console.error('Error processing message:', error);
        }
    }

    validateRawData(data) {
        const schema = Joi.object({
            timestamp: Joi.string().isoDate().required(),
            machineId: Joi.string().required(),
            machineType: Joi.string().required(),
            sensors: Joi.object({
                temperature: Joi.number(),
                pressure: Joi.number(),
                speed: Joi.number(),
                vibration: Joi.number(),
                power_consumption: Joi.number()
            }).required(),
            status: Joi.object({
                state: Joi.string().valid('RUNNING', 'IDLE', 'ERROR', 'MAINTENANCE').required(),
                cycle_count: Joi.number(),
                runtime_hours: Joi.number(),
                last_maintenance_hours: Joi.number(),
                error_code: Joi.string().allow(null),
                efficiency: Joi.number().min(0).max(100)
            }).required(),
            quality: Joi.object({
                good_parts: Joi.number(),
                bad_parts: Joi.number(),
                reject_rate: Joi.number()
            })
        });

        return schema.validate(data);
    }

    transformToISA95(rawData, topic) {
        // Extract area and machine info from topic
        const topicParts = topic.split('/');
        const area = this.determineArea(rawData.machineType);
        const workUnit = rawData.machineId;

        // Create ISA-95 compliant structure
        const standardizedData = {
            messageId: uuidv4(),
            timestamp: rawData.timestamp,
            source: {
                area: area,
                workUnit: workUnit,
                equipmentClass: rawData.machineType,
                equipmentId: rawData.machineId
            },
            equipment: {
                id: rawData.machineId,
                type: rawData.machineType,
                status: this.mapEquipmentStatus(rawData.status.state),
                availability: this.calculateAvailability(rawData.status),
                performance: {
                    efficiency: rawData.status.efficiency,
                    cycleCount: rawData.status.cycle_count,
                    runtimeHours: rawData.status.runtime_hours
                }
            },
            process: {
                parameters: {
                    temperature: {
                        value: rawData.sensors.temperature,
                        unit: 'celsius',
                        timestamp: rawData.timestamp
                    },
                    pressure: {
                        value: rawData.sensors.pressure,
                        unit: 'bar',
                        timestamp: rawData.timestamp
                    },
                    speed: {
                        value: rawData.sensors.speed,
                        unit: 'percent',
                        timestamp: rawData.timestamp
                    },
                    vibration: {
                        value: rawData.sensors.vibration,
                        unit: 'mm/s',
                        timestamp: rawData.timestamp
                    },
                    powerConsumption: {
                        value: rawData.sensors.power_consumption,
                        unit: 'kW',
                        timestamp: rawData.timestamp
                    }
                }
            },
            quality: rawData.quality ? {
                goodParts: rawData.quality.good_parts,
                badParts: rawData.quality.bad_parts,
                rejectRate: rawData.quality.reject_rate,
                totalParts: rawData.quality.good_parts + rawData.quality.bad_parts
            } : null,
            maintenance: {
                lastMaintenanceHours: rawData.status.last_maintenance_hours,
                currentState: rawData.status.state,
                errorCode: rawData.status.error_code,
                nextMaintenanceDue: this.calculateNextMaintenance(rawData.status.last_maintenance_hours)
            },
            tags: {
                level: 'L0-L1',
                dataType: 'equipment',
                processArea: area,
                criticality: this.assessCriticality(rawData)
            }
        };

        return standardizedData;
    }

    determineArea(machineType) {
        const areaMapping = {
            'PRODUCTION_LINE': 'PRODUCTION',
            'PACKAGING_UNIT': 'PACKAGING',
            'CONVEYOR_SYSTEM': 'MATERIAL_HANDLING',
            'QUALITY_STATION': 'QUALITY_CONTROL'
        };
        return areaMapping[machineType] || 'GENERAL';
    }

    mapEquipmentStatus(status) {
        const statusMapping = {
            'RUNNING': 'ACTIVE',
            'IDLE': 'IDLE',
            'ERROR': 'FAULT',
            'MAINTENANCE': 'MAINTENANCE'
        };
        return statusMapping[status] || 'UNKNOWN';
    }

    calculateAvailability(status) {
        // Simple availability calculation based on state
        switch (status.state) {
            case 'RUNNING': return 100;
            case 'IDLE': return 75;
            case 'ERROR': return 0;
            case 'MAINTENANCE': return 0;
            default: return 50;
        }
    }

    calculateNextMaintenance(lastMaintenanceHours) {
        const maintenanceInterval = 168; // 1 week in hours
        const nextDue = maintenanceInterval - lastMaintenanceHours;
        return Math.max(0, nextDue);
    }

    assessCriticality(rawData) {
        let criticality = 'LOW';
        
        if (rawData.status.state === 'ERROR') {
            criticality = 'HIGH';
        } else if (rawData.status.efficiency < 70) {
            criticality = 'MEDIUM';
        } else if (rawData.sensors.temperature > 85) {
            criticality = 'MEDIUM';
        }
        
        return criticality;
    }

    async cacheData(data) {
        const key = `equipment:${data.source.equipmentId}:latest`;
        await this.redisClient.setEx(key, 3600, JSON.stringify(data)); // Cache for 1 hour
        
        // Also cache by area for quick lookups
        const areaKey = `area:${data.source.area}:equipment`;
        await this.redisClient.sAdd(areaKey, data.source.equipmentId);
    }

    async persistData(data) {
        const collection = this.db.collection('equipment_data');
        await collection.insertOne({
            ...data,
            createdAt: new Date()
        });
    }

    async publishStandardizedData(data) {
        // Publish to hierarchical UNS topics
        const baseTopic = `uns/${data.source.area}/${data.source.workUnit}`;
        
        const topics = [
            `${baseTopic}/equipment/status`,
            `${baseTopic}/process/parameters`,
            `${baseTopic}/quality/metrics`,
            `${baseTopic}/maintenance/status`,
            `uns/enterprise/equipment/${data.source.equipmentId}` // Enterprise-wide topic
        ];

        topics.forEach(topic => {
            this.mqttClient.publish(topic, JSON.stringify(data), { qos: 1 }, (error) => {
                if (error) {
                    console.error(`Error publishing to ${topic}:`, error);
                } else {
                    console.log(`Published standardized data to ${topic}`);
                }
            });
        });
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down gracefully...');
    await cleanup();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    await cleanup();
    process.exit(0);
});

async function cleanup() {
    if (global.processor) {
        if (global.processor.mqttClient) {
            global.processor.mqttClient.end();
        }
        if (global.processor.redisClient) {
            await global.processor.redisClient.quit();
        }
        if (global.processor.mongoClient) {
            await global.processor.mongoClient.close();
        }
    }
}

// Start the processor
global.processor = new PayloadProcessor();