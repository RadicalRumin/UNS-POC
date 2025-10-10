const mqtt = require('mqtt');
const Joi = require('joi');
const redis = require('redis');
const { MongoClient } = require('mongodb');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');

const EnterpriseStructureDiscovery = require('./lib/EnterpriseStructureDiscovery');
const FlexibleTransformer = require('./lib/FlexibleTransformer');
const FlexibleTopicGenerator = require('./lib/FlexibleTopicGenerator');

class FlexiblePayloadProcessor {
    constructor(configPath = './config/processor-config.json') {
        this.configPath = configPath;
        this.config = null;
        this.brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
        this.redisUrl = process.env.REDIS_URL || 'redis://redis:6379';
        this.mongoUrl = process.env.MONGO_URL || 'mongodb://admin:password123@mongodb:27017/uns_data?authSource=admin';
        
        this.mqttClient = null;
        this.redisClient = null;
        this.mongoClient = null;
        this.db = null;
        
        this.enterpriseDiscovery = null;
        this.transformer = null;
        this.topicGenerator = null;
        
        this.inputSchemas = new Map();
        this.processingStats = {
            messagesProcessed: 0,
            transformationErrors: 0,
            discoveryRequests: 0,
            lastProcessedTime: null
        };
        
        this.init();
    }

    async init() {
        try {
            // Load configuration
            await this.loadConfiguration();
            
            // Initialize connections
            await this.initMQTT();
            await this.initRedis();
            await this.initMongoDB();
            
            // Initialize processing components
            await this.initComponents();
            
            // Load input schemas
            await this.loadInputSchemas();
            
            // Subscribe to input data topics
            this.subscribeToInputData();
            
            console.log('Flexible Payload Processor initialized successfully');
            console.log(`Active output format: ${this.config.globalSettings.outputFormat}`);
            
        } catch (error) {
            console.error('Initialization error:', error);
            process.exit(1);
        }
    }

    async loadConfiguration() {
        try {
            const configContent = await fs.readFile(this.configPath, 'utf8');
            this.config = JSON.parse(configContent);
            console.log('Configuration loaded successfully');
        } catch (error) {
            console.error('Error loading configuration:', error);
            throw error;
        }
    }

    async initMQTT() {
        return new Promise((resolve, reject) => {
            console.log(`Connecting to MQTT broker: ${this.brokerUrl}`);
            this.mqttClient = mqtt.connect(this.brokerUrl, {
                clientId: `flexible-payload-processor-${uuidv4()}`,
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

    async initComponents() {
        // Initialize enterprise structure discovery
        this.enterpriseDiscovery = new EnterpriseStructureDiscovery(this.config, this.mqttClient);
        
        // Initialize flexible transformer
        this.transformer = new FlexibleTransformer(this.config);
        
        // Initialize topic generator
        this.topicGenerator = new FlexibleTopicGenerator(this.config);
        
        // Set up event handlers
        this.enterpriseDiscovery.on('structureDiscovered', (event) => {
            console.log(`New equipment structure discovered: ${event.equipmentId}`);
            this.cacheEnterpriseStructure(event.equipmentId, event.structure);
        });
    }

    async loadInputSchemas() {
        const inputSources = this.config.inputSources || {};
        
        for (const [sourceName, sourceConfig] of Object.entries(inputSources)) {
            try {
                if (sourceConfig.schema) {
                    const schemaContent = await fs.readFile(path.resolve(sourceConfig.schema), 'utf8');
                    const schema = JSON.parse(schemaContent);
                    
                    // Convert JSON Schema to Joi schema (simplified conversion)
                    const joiSchema = this.convertJSONSchemaToJoi(schema);
                    this.inputSchemas.set(sourceName, joiSchema);
                    
                    console.log(`Loaded input schema for ${sourceName}`);
                }
            } catch (error) {
                console.warn(`Could not load schema for ${sourceName}:`, error.message);
            }
        }
    }

    convertJSONSchemaToJoi(jsonSchema) {
        // This is a simplified conversion - in a real implementation, 
        // you'd want a more comprehensive JSON Schema to Joi converter
        const properties = jsonSchema.properties || {};
        const required = jsonSchema.required || [];
        
        let joiObject = {};
        
        Object.entries(properties).forEach(([key, prop]) => {
            let joiField;
            
            switch (prop.type) {
                case 'string':
                    joiField = Joi.string();
                    if (prop.format === 'date-time') {
                        joiField = joiField.isoDate();
                    }
                    if (prop.enum) {
                        joiField = joiField.valid(...prop.enum);
                    }
                    break;
                case 'number':
                    joiField = Joi.number();
                    if (prop.minimum !== undefined) {
                        joiField = joiField.min(prop.minimum);
                    }
                    if (prop.maximum !== undefined) {
                        joiField = joiField.max(prop.maximum);
                    }
                    break;
                case 'integer':
                    joiField = Joi.number().integer();
                    if (prop.minimum !== undefined) {
                        joiField = joiField.min(prop.minimum);
                    }
                    break;
                case 'object':
                    joiField = Joi.object();
                    break;
                case 'array':
                    joiField = Joi.array();
                    break;
                default:
                    joiField = Joi.any();
            }
            
            if (required.includes(key)) {
                joiField = joiField.required();
            }
            
            joiObject[key] = joiField;
        });
        
        return Joi.object(joiObject);
    }

    subscribeToInputData() {
        const inputSources = this.config.inputSources || {};
        
        for (const [sourceName, sourceConfig] of Object.entries(inputSources)) {
            const topics = sourceConfig.topics || [];
            
            topics.forEach(topic => {
                this.mqttClient.subscribe(topic, { qos: 1 }, (error) => {
                    if (error) {
                        console.error(`Error subscribing to ${topic}:`, error);
                    } else {
                        console.log(`Subscribed to input topic: ${topic}`);
                    }
                });
            });
        }
    }

    async processMessage(topic, message) {
        try {
            this.processingStats.messagesProcessed++;
            this.processingStats.lastProcessedTime = new Date();
            
            const rawData = JSON.parse(message.toString());
            console.log(`Processing message from ${topic}`);
            
            // Determine input source type
            const sourceType = this.determineSourceType(topic);
            if (!sourceType) {
                console.warn(`Unknown source type for topic: ${topic}`);
                return;
            }
            
            // Validate incoming data
            const validationResult = this.validateInput(sourceType, rawData);
            if (!validationResult.isValid) {
                console.error(`Data validation failed for ${sourceType}:`, validationResult.errors);
                return;
            }

            // Extract equipment information
            const equipmentInfo = this.extractEquipmentInfo(sourceType, rawData, topic);
            
            // Get or discover enterprise structure
            const enterpriseStructure = await this.getEnterpriseStructure(equipmentInfo.equipmentId);
            
            // Transform data using configured format
            const outputFormat = this.config.globalSettings.outputFormat;
            const transformedData = await this.transformer.transform(
                outputFormat,
                rawData,
                enterpriseStructure,
                { sourceId: sourceType }
            );
            
            // Generate output topics
            const topics = this.topicGenerator.generateTopics(
                outputFormat,
                transformedData,
                enterpriseStructure
            );
            
            // Cache data
            await this.cacheData(transformedData, enterpriseStructure);
            
            // Persist data
            await this.persistData(transformedData, sourceType);
            
            // Publish to output topics
            await this.publishTransformedData(topics);
            
        } catch (error) {
            console.error('Error processing message:', error);
            this.processingStats.transformationErrors++;
        }
    }

    determineSourceType(topic) {
        const inputSources = this.config.inputSources || {};
        
        for (const [sourceName, sourceConfig] of Object.entries(inputSources)) {
            const topics = sourceConfig.topics || [];
            
            for (const topicPattern of topics) {
                // Convert MQTT topic pattern to regex
                const regex = new RegExp(topicPattern.replace(/\+/g, '[^/]+').replace(/\#/g, '.*'));
                if (regex.test(topic)) {
                    return sourceName;
                }
            }
        }
        
        return null;
    }

    validateInput(sourceType, data) {
        const schema = this.inputSchemas.get(sourceType);
        
        if (!schema) {
            // No schema available, assume valid
            return { isValid: true };
        }
        
        const validationResult = schema.validate(data);
        
        return {
            isValid: !validationResult.error,
            errors: validationResult.error?.details || []
        };
    }

    extractEquipmentInfo(sourceType, rawData, topic) {
        const sourceConfig = this.config.inputSources[sourceType];
        const extraction = sourceConfig.metadataExtraction || {};
        
        const equipmentId = this.extractField(rawData, extraction.equipmentId) || 
                           this.extractFromTopic(topic, extraction.locationHint);
        
        const equipmentType = this.extractField(rawData, extraction.equipmentType);
        
        return {
            equipmentId,
            equipmentType,
            sourceType
        };
    }

    extractField(data, fieldPath) {
        if (!fieldPath || !data) return null;
        
        // Simple dot notation extraction
        const parts = fieldPath.split('.');
        let value = data;
        
        for (const part of parts) {
            if (value && typeof value === 'object' && part in value) {
                value = value[part];
            } else {
                return null;
            }
        }
        
        return value;
    }

    extractFromTopic(topic, locationHint) {
        if (!locationHint) return null;
        
        // Handle topic.parts[index] syntax
        const match = locationHint.match(/topic\.parts\[(\d+)\]/);
        if (match) {
            const index = parseInt(match[1]);
            const parts = topic.split('/');
            return parts[index] || null;
        }
        
        return null;
    }

    async getEnterpriseStructure(equipmentId) {
        if (!equipmentId) return null;
        
        // First, try to get from enterprise discovery
        let structure = this.enterpriseDiscovery.getEnterpriseStructure(equipmentId);
        
        // If not found and discovery is enabled, request it
        if (!structure && this.config.globalSettings.enterpriseDiscovery.enabled) {
            console.log(`Requesting enterprise structure for equipment: ${equipmentId}`);
            this.processingStats.discoveryRequests++;
            
            try {
                structure = await this.enterpriseDiscovery.requestMetadata(equipmentId, 5000);
            } catch (error) {
                console.warn(`Could not discover structure for ${equipmentId}:`, error.message);
            }
        }
        
        return structure;
    }

    async cacheData(data, enterpriseStructure) {
        const equipmentId = this.topicGenerator.getEquipmentId(data);
        if (!equipmentId) return;
        
        const cacheConfig = this.config.dataProcessing.caching;
        const ttl = cacheConfig.ttl || 3600;
        
        // Cache latest data
        let key = cacheConfig.keyTemplate || 'equipment:{equipmentId}:latest';
        key = key.replace('{equipmentId}', equipmentId);
        
        await this.redisClient.setEx(key, ttl, JSON.stringify(data));
        
        // Cache enterprise structure if available
        if (enterpriseStructure && !enterpriseStructure.isFallback) {
            const structureKey = `structure:${equipmentId}`;
            await this.redisClient.setEx(structureKey, ttl * 2, JSON.stringify(enterpriseStructure));
        }
    }

    async cacheEnterpriseStructure(equipmentId, structure) {
        const key = `structure:${equipmentId}`;
        await this.redisClient.setEx(key, 7200, JSON.stringify(structure)); // 2 hour TTL
    }

    async persistData(data, sourceType) {
        const persistConfig = this.config.dataProcessing.persistence;
        const collection = this.db.collection(persistConfig.collection || 'equipment_data');
        
        const document = { ...data };
        
        if (persistConfig.addCreatedAt) {
            document.createdAt = new Date();
        }
        
        document.sourceType = sourceType;
        document.processingVersion = this.config.version;
        
        await collection.insertOne(document);
    }

    async publishTransformedData(topics) {
        const promises = topics.map(({ topic, data, qos = 1 }) => {
            return new Promise((resolve, reject) => {
                // Validate topic structure
                const validation = this.topicGenerator.validateTopicStructure(topic);
                if (!validation.valid) {
                    console.error(`Invalid topic structure: ${topic} - ${validation.error}`);
                    resolve();
                    return;
                }
                
                this.mqttClient.publish(topic, JSON.stringify(data), { qos }, (error) => {
                    if (error) {
                        console.error(`Error publishing to ${topic}:`, error);
                        reject(error);
                    } else {
                        console.log(`Published data to ${topic}`);
                        resolve();
                    }
                });
            });
        });

        await Promise.allSettled(promises);
    }

    // API methods for monitoring and configuration
    getProcessingStats() {
        return {
            ...this.processingStats,
            enterpriseStats: this.enterpriseDiscovery.getStats(),
            availableFormats: this.transformer.getAvailableFormats(),
            currentFormat: this.config.globalSettings.outputFormat
        };
    }

    async reloadConfiguration() {
        try {
            await this.loadConfiguration();
            
            // Reinitialize components with new config
            this.transformer = new FlexibleTransformer(this.config);
            this.topicGenerator = new FlexibleTopicGenerator(this.config);
            
            console.log('Configuration reloaded successfully');
            return true;
        } catch (error) {
            console.error('Error reloading configuration:', error);
            return false;
        }
    }

    async switchOutputFormat(formatName) {
        const availableFormats = this.transformer.getAvailableFormats();
        
        if (!availableFormats.includes(formatName)) {
            throw new Error(`Format ${formatName} not available. Available: ${availableFormats.join(', ')}`);
        }
        
        this.config.globalSettings.outputFormat = formatName;
        console.log(`Switched output format to: ${formatName}`);
        
        return true;
    }
}

// Handle graceful shutdown
async function cleanup() {
    if (global.processor) {
        console.log('Shutting down processor...');
        
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

// Start the processor
const configPath = process.argv[2] || './config/processor-config.json';
global.processor = new FlexiblePayloadProcessor(configPath);

module.exports = FlexiblePayloadProcessor;