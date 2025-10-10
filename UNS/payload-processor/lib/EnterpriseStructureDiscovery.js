const EventEmitter = require('events');
const Joi = require('joi');

class EnterpriseStructureDiscovery extends EventEmitter {
    constructor(config, mqttClient) {
        super();
        this.config = config;
        this.mqttClient = mqttClient;
        this.enterpriseMap = new Map(); // equipmentId -> enterprise structure
        this.metadataCache = new Map(); // publisherId -> metadata
        this.discoveryTimeout = config.enterpriseStructure.discoveryTimeout || 30000;
        this.isDiscoveryActive = false;
        
        this.metadataSchema = this.loadMetadataSchema();
        this.init();
    }

    loadMetadataSchema() {
        // For now, create the schema inline. In production, load from file
        return Joi.object({
            publisherId: Joi.string().required(),
            timestamp: Joi.string().isoDate().required(),
            structureInfo: Joi.object({
                equipmentId: Joi.string().required(),
                equipmentType: Joi.string(),
                location: Joi.object({
                    enterprise: Joi.string(),
                    site: Joi.string(),
                    area: Joi.string(),
                    workUnit: Joi.string(),
                    line: Joi.string()
                }).required(),
                capabilities: Joi.array().items(Joi.string()),
                dataTypes: Joi.array().items(Joi.string().valid('equipment', 'process', 'quality', 'maintenance', 'energy', 'safety')),
                tags: Joi.object().pattern(/./, Joi.alternatives(Joi.string(), Joi.number(), Joi.boolean()))
            }).required(),
            relationships: Joi.array().items(Joi.object({
                relatedEquipmentId: Joi.string(),
                relationshipType: Joi.string().valid('parent', 'child', 'upstream', 'downstream', 'sibling')
            }))
        });
    }

    async init() {
        if (!this.config.enterpriseStructure.discoveryMode || 
            this.config.enterpriseStructure.discoveryMode === 'static') {
            console.log('Enterprise discovery disabled - using static/fallback mappings');
            return;
        }

        console.log('Initializing enterprise structure discovery...');
        
        // Subscribe to metadata topics
        const metadataTopics = this.config.globalSettings.enterpriseDiscovery.metadataTopics || 
                              ['enterprise/+/metadata', 'structure/+/info'];
        
        metadataTopics.forEach(topic => {
            this.mqttClient.subscribe(topic, { qos: 1 }, (error) => {
                if (error) {
                    console.error(`Error subscribing to metadata topic ${topic}:`, error);
                } else {
                    console.log(`Subscribed to metadata topic: ${topic}`);
                }
            });
        });

        // Listen for metadata messages
        this.mqttClient.on('message', (topic, message) => {
            if (this.isMetadataTopic(topic)) {
                this.handleMetadataMessage(topic, message);
            }
        });

        this.isDiscoveryActive = true;
        this.emit('discoveryStarted');
    }

    isMetadataTopic(topic) {
        const metadataTopics = this.config.globalSettings.enterpriseDiscovery.metadataTopics || 
                              ['enterprise/+/metadata', 'structure/+/info'];
        
        return metadataTopics.some(pattern => {
            const regex = new RegExp(pattern.replace(/\+/g, '[^/]+').replace(/\#/g, '.*'));
            return regex.test(topic);
        });
    }

    async handleMetadataMessage(topic, message) {
        try {
            const metadata = JSON.parse(message.toString());
            
            // Validate metadata structure
            const validationResult = this.metadataSchema.validate(metadata);
            if (validationResult.error) {
                console.error('Invalid metadata received:', validationResult.error.details);
                return;
            }

            console.log(`Received metadata from ${metadata.publisherId} for equipment ${metadata.structureInfo.equipmentId}`);
            
            // Store metadata
            this.metadataCache.set(metadata.publisherId, metadata);
            
            // Update enterprise structure mapping
            this.updateEnterpriseStructure(metadata);
            
            // Emit discovery event
            this.emit('structureDiscovered', {
                equipmentId: metadata.structureInfo.equipmentId,
                structure: metadata.structureInfo.location,
                metadata: metadata
            });

        } catch (error) {
            console.error('Error processing metadata message:', error);
        }
    }

    updateEnterpriseStructure(metadata) {
        const equipmentId = metadata.structureInfo.equipmentId;
        const structure = {
            ...metadata.structureInfo.location,
            equipmentType: metadata.structureInfo.equipmentType,
            capabilities: metadata.structureInfo.capabilities || [],
            dataTypes: metadata.structureInfo.dataTypes || [],
            tags: metadata.structureInfo.tags || {},
            lastUpdated: new Date(),
            source: metadata.publisherId
        };

        this.enterpriseMap.set(equipmentId, structure);
        console.log(`Updated enterprise structure for equipment ${equipmentId}:`, structure);
    }

    getEnterpriseStructure(equipmentId) {
        const structure = this.enterpriseMap.get(equipmentId);
        
        if (structure) {
            return structure;
        }

        // Fallback to static mappings if available
        if (this.config.enterpriseStructure.fallbackMode === 'adaptive') {
            return this.getFallbackStructure(equipmentId);
        }

        return null;
    }

    getFallbackStructure(equipmentId) {
        // Try to extract information from equipment ID patterns
        // This is a simplified fallback - in reality, you might have more sophisticated logic
        
        const fallback = {
            enterprise: 'UnknownEnterprise',
            site: 'UnknownSite',
            area: 'GENERAL',
            workUnit: equipmentId,
            equipmentType: 'UNKNOWN',
            lastUpdated: new Date(),
            source: 'fallback',
            isFallback: true
        };

        // Try to guess area from equipment ID patterns
        if (equipmentId.toLowerCase().includes('prod')) {
            fallback.area = 'PRODUCTION';
        } else if (equipmentId.toLowerCase().includes('pack')) {
            fallback.area = 'PACKAGING';
        } else if (equipmentId.toLowerCase().includes('quality') || equipmentId.toLowerCase().includes('qc')) {
            fallback.area = 'QUALITY_CONTROL';
        }

        console.log(`Using fallback structure for equipment ${equipmentId}:`, fallback);
        return fallback;
    }

    getAllKnownEquipment() {
        return Array.from(this.enterpriseMap.keys());
    }

    getEnterpriseHierarchy() {
        const hierarchy = {};
        
        for (const [equipmentId, structure] of this.enterpriseMap) {
            const enterprise = structure.enterprise || 'Unknown';
            const site = structure.site || 'Unknown';
            const area = structure.area || 'Unknown';
            const workUnit = structure.workUnit || 'Unknown';

            if (!hierarchy[enterprise]) {
                hierarchy[enterprise] = {};
            }
            if (!hierarchy[enterprise][site]) {
                hierarchy[enterprise][site] = {};
            }
            if (!hierarchy[enterprise][site][area]) {
                hierarchy[enterprise][site][area] = {};
            }
            if (!hierarchy[enterprise][site][area][workUnit]) {
                hierarchy[enterprise][site][area][workUnit] = [];
            }

            hierarchy[enterprise][site][area][workUnit].push({
                equipmentId,
                equipmentType: structure.equipmentType,
                capabilities: structure.capabilities,
                dataTypes: structure.dataTypes
            });
        }

        return hierarchy;
    }

    async requestMetadata(equipmentId, timeout = 10000) {
        return new Promise((resolve, reject) => {
            // Check if we already have metadata for this equipment
            const existingStructure = this.getEnterpriseStructure(equipmentId);
            if (existingStructure && !existingStructure.isFallback) {
                resolve(existingStructure);
                return;
            }

            // Request metadata by publishing a discovery message
            const requestTopic = `discovery/request/${equipmentId}`;
            const requestMessage = {
                requestId: require('uuid').v4(),
                equipmentId: equipmentId,
                timestamp: new Date().toISOString(),
                requestedInfo: ['location', 'capabilities', 'relationships']
            };

            console.log(`Requesting metadata for equipment ${equipmentId}`);
            this.mqttClient.publish(requestTopic, JSON.stringify(requestMessage), { qos: 1 });

            // Set up timeout
            const timeoutHandle = setTimeout(() => {
                this.removeListener('structureDiscovered', discoveryHandler);
                const fallback = this.getFallbackStructure(equipmentId);
                resolve(fallback);
            }, timeout);

            // Listen for response
            const discoveryHandler = (event) => {
                if (event.equipmentId === equipmentId) {
                    clearTimeout(timeoutHandle);
                    this.removeListener('structureDiscovered', discoveryHandler);
                    resolve(event.structure);
                }
            };

            this.on('structureDiscovered', discoveryHandler);
        });
    }

    getStats() {
        return {
            knownEquipment: this.enterpriseMap.size,
            metadataProviders: this.metadataCache.size,
            isActive: this.isDiscoveryActive,
            lastUpdate: Math.max(...Array.from(this.enterpriseMap.values()).map(s => s.lastUpdated))
        };
    }
}

module.exports = EnterpriseStructureDiscovery;