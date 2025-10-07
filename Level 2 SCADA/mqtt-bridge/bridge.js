const mqtt = require('mqtt');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

class IgnitionMQTTBridge {
    constructor() {
        this.mqttUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
        this.ignitionUrl = process.env.IGNITION_GATEWAY_URL || 'http://localhost:8088';
        this.gatewayUser = process.env.GATEWAY_USER || 'admin';
        this.gatewayPassword = process.env.GATEWAY_PASSWORD || 'password';
        
        this.mqttClient = null;
        this.ignitionTags = new Map();
        this.tagSubscriptions = new Map();
        
        // SCADA-specific data cache
        this.scadaData = {
            alarms: [],
            trends: new Map(),
            setpoints: new Map()
        };
        
        this.init();
    }

    async init() {
        try {
            console.log('Initializing Ignition MQTT Bridge...');
            
            // Initialize MQTT connection
            await this.initMQTT();
            
            // Wait for Ignition to be ready
            await this.waitForIgnition();
            
            // Setup tag structure in Ignition (simulated)
            await this.setupIgnitionTags();
            
            // Subscribe to UNS data
            this.subscribeToUNSData();
            
            // Start periodic sync
            this.startPeriodicSync();
            
            console.log('Ignition MQTT Bridge initialized successfully');
            
        } catch (error) {
            console.error('Bridge initialization error:', error);
            process.exit(1);
        }
    }

    async initMQTT() {
        return new Promise((resolve, reject) => {
            console.log(`Connecting to MQTT broker: ${this.mqttUrl}`);
            this.mqttClient = mqtt.connect(this.mqttUrl, {
                clientId: `ignition-bridge-${uuidv4()}`,
                clean: true,
                reconnectPeriod: 5000
            });

            this.mqttClient.on('connect', () => {
                console.log('Bridge: Connected to MQTT broker');
                resolve();
            });

            this.mqttClient.on('error', (error) => {
                console.error('Bridge: MQTT connection error:', error);
                reject(error);
            });

            this.mqttClient.on('message', (topic, message) => {
                this.processUNSMessage(topic, message);
            });
        });
    }

    async waitForIgnition() {
        console.log('Waiting for Ignition Gateway to be ready...');
        
        let attempts = 0;
        const maxAttempts = 30; // 5 minutes
        
        while (attempts < maxAttempts) {
            try {
                const response = await axios.get(`${this.ignitionUrl}/main/web/status`, {
                    timeout: 5000,
                    validateStatus: () => true // Accept any status code
                });
                
                if (response.status === 200 || response.status === 302) {
                    console.log('Ignition Gateway is ready');
                    return;
                }
            } catch (error) {
                // Gateway not ready yet
            }
            
            attempts++;
            console.log(`Ignition not ready, attempt ${attempts}/${maxAttempts}`);
            await this.sleep(10000); // Wait 10 seconds
        }
        
        throw new Error('Ignition Gateway failed to become ready within timeout');
    }

    async setupIgnitionTags() {
        console.log('Setting up Ignition tag structure...');
        
        // Define the tag structure that would be created in Ignition
        // In a real implementation, this would use Ignition's Web API or SDK
        const tagStructure = {
            'UNS': {
                'PRODUCTION': {
                    'LINE_01': this.createEquipmentTags('LINE_01'),
                    'PKG_01': this.createEquipmentTags('PKG_01'),
                    'CONV_01': this.createEquipmentTags('CONV_01')
                },
                'PACKAGING': {
                    'PKG_01': this.createEquipmentTags('PKG_01')
                },
                'MATERIAL_HANDLING': {
                    'CONV_01': this.createEquipmentTags('CONV_01')
                }
            }
        };
        
        // Store tag structure for reference
        this.ignitionTags = new Map(Object.entries(tagStructure));
        
        console.log('Ignition tag structure created (simulated)');
    }

    createEquipmentTags(equipmentId) {
        return {
            // Status tags
            'Status': {
                'State': { value: 'UNKNOWN', quality: 'Bad', timestamp: new Date() },
                'Availability': { value: 0, quality: 'Bad', timestamp: new Date() },
                'Efficiency': { value: 0, quality: 'Bad', timestamp: new Date() }
            },
            // Process parameters
            'Process': {
                'Temperature': { value: 0, quality: 'Bad', timestamp: new Date(), unit: '°C' },
                'Pressure': { value: 0, quality: 'Bad', timestamp: new Date(), unit: 'bar' },
                'Speed': { value: 0, quality: 'Bad', timestamp: new Date(), unit: '%' },
                'Vibration': { value: 0, quality: 'Bad', timestamp: new Date(), unit: 'mm/s' },
                'PowerConsumption': { value: 0, quality: 'Bad', timestamp: new Date(), unit: 'kW' }
            },
            // Quality metrics
            'Quality': {
                'GoodParts': { value: 0, quality: 'Bad', timestamp: new Date() },
                'BadParts': { value: 0, quality: 'Bad', timestamp: new Date() },
                'RejectRate': { value: 0, quality: 'Bad', timestamp: new Date(), unit: '%' }
            },
            // Maintenance
            'Maintenance': {
                'LastMaintenanceHours': { value: 0, quality: 'Bad', timestamp: new Date() },
                'NextMaintenanceDue': { value: 0, quality: 'Bad', timestamp: new Date() },
                'ErrorCode': { value: '', quality: 'Bad', timestamp: new Date() }
            },
            // Alarms
            'Alarms': {
                'HighTemperature': { active: false, priority: 'Medium', timestamp: new Date() },
                'LowEfficiency': { active: false, priority: 'Low', timestamp: new Date() },
                'MaintenanceDue': { active: false, priority: 'High', timestamp: new Date() }
            }
        };
    }

    subscribeToUNSData() {
        const topics = [
            'uns/+/+/equipment/status',
            'uns/+/+/process/parameters', 
            'uns/+/+/quality/metrics',
            'uns/+/+/maintenance/status'
        ];

        topics.forEach(topic => {
            this.mqttClient.subscribe(topic, { qos: 1 }, (error) => {
                if (error) {
                    console.error(`Bridge: Error subscribing to ${topic}:`, error);
                } else {
                    console.log(`Bridge: Subscribed to ${topic}`);
                }
            });
        });
    }

    async processUNSMessage(topic, message) {
        try {
            const data = JSON.parse(message.toString());
            console.log(`Bridge: Processing UNS message from ${topic}`);
            
            // Extract topic components
            const topicParts = topic.split('/');
            if (topicParts.length >= 4 && topicParts[0] === 'uns') {
                const area = topicParts[1];
                const workUnit = topicParts[2];
                const dataType = topicParts[3];
                
                // Update Ignition tags based on UNS data
                await this.updateIgnitionTags(area, workUnit, dataType, data);
                
                // Generate SCADA-specific alerts and trends
                await this.generateSCADAAlerts(data);
                
                // Update trend data
                this.updateTrendData(data);
                
                // Publish SCADA-processed data back to UNS
                await this.publishSCADAData(data);
            }
            
        } catch (error) {
            console.error('Bridge: Error processing UNS message:', error);
        }
    }

    async updateIgnitionTags(area, workUnit, dataType, data) {
        try {
            // In a real implementation, this would update actual Ignition tags
            // For now, we'll simulate the tag updates
            
            const equipmentId = data.source?.equipmentId || workUnit;
            
            if (dataType === 'equipment' && data.equipment) {
                // Update status tags
                this.updateTagValue(area, equipmentId, 'Status/State', data.equipment.status);
                this.updateTagValue(area, equipmentId, 'Status/Availability', data.equipment.availability);
                this.updateTagValue(area, equipmentId, 'Status/Efficiency', data.equipment.performance?.efficiency || 0);
            }
            
            if (dataType === 'process' && data.process?.parameters) {
                // Update process parameter tags
                const params = data.process.parameters;
                
                if (params.temperature) {
                    this.updateTagValue(area, equipmentId, 'Process/Temperature', params.temperature.value);
                }
                if (params.pressure) {
                    this.updateTagValue(area, equipmentId, 'Process/Pressure', params.pressure.value);
                }
                if (params.speed) {
                    this.updateTagValue(area, equipmentId, 'Process/Speed', params.speed.value);
                }
                if (params.vibration) {
                    this.updateTagValue(area, equipmentId, 'Process/Vibration', params.vibration.value);
                }
                if (params.powerConsumption) {
                    this.updateTagValue(area, equipmentId, 'Process/PowerConsumption', params.powerConsumption.value);
                }
            }
            
            if (dataType === 'quality' && data.quality) {
                // Update quality tags
                this.updateTagValue(area, equipmentId, 'Quality/GoodParts', data.quality.goodParts || 0);
                this.updateTagValue(area, equipmentId, 'Quality/BadParts', data.quality.badParts || 0);
                this.updateTagValue(area, equipmentId, 'Quality/RejectRate', data.quality.rejectRate || 0);
            }
            
            if (dataType === 'maintenance' && data.maintenance) {
                // Update maintenance tags
                this.updateTagValue(area, equipmentId, 'Maintenance/LastMaintenanceHours', data.maintenance.lastMaintenanceHours || 0);
                this.updateTagValue(area, equipmentId, 'Maintenance/NextMaintenanceDue', data.maintenance.nextMaintenanceDue || 0);
                this.updateTagValue(area, equipmentId, 'Maintenance/ErrorCode', data.maintenance.errorCode || '');
            }
            
        } catch (error) {
            console.error('Bridge: Error updating Ignition tags:', error);
        }
    }

    updateTagValue(area, equipmentId, tagPath, value) {
        // Simulate updating Ignition tag
        // In real implementation, this would use Ignition Gateway API
        const fullTagPath = `UNS/${area}/${equipmentId}/${tagPath}`;
        
        console.log(`Bridge: Updating tag ${fullTagPath} = ${value}`);
        
        // Store locally for trend tracking
        if (!this.scadaData.trends.has(fullTagPath)) {
            this.scadaData.trends.set(fullTagPath, []);
        }
        
        const trends = this.scadaData.trends.get(fullTagPath);
        trends.push({
            timestamp: new Date(),
            value: value,
            quality: 'Good'
        });
        
        // Keep only last 1000 trend points
        if (trends.length > 1000) {
            trends.splice(0, trends.length - 1000);
        }
    }

    async generateSCADAAlerts(data) {
        try {
            const equipmentId = data.source?.equipmentId;
            if (!equipmentId) return;
            
            const alerts = [];
            
            // Temperature alert
            if (data.process?.parameters?.temperature?.value > 80) {
                alerts.push({
                    equipmentId: equipmentId,
                    alertType: 'HighTemperature',
                    message: `High temperature detected: ${data.process.parameters.temperature.value}°C`,
                    priority: 'Medium',
                    timestamp: new Date(),
                    acknowledged: false
                });
            }
            
            // Low efficiency alert
            if (data.equipment?.performance?.efficiency < 70) {
                alerts.push({
                    equipmentId: equipmentId,
                    alertType: 'LowEfficiency',
                    message: `Low efficiency detected: ${data.equipment.performance.efficiency}%`,
                    priority: 'Low',
                    timestamp: new Date(),
                    acknowledged: false
                });
            }
            
            // Maintenance due alert
            if (data.maintenance?.nextMaintenanceDue < 24) {
                alerts.push({
                    equipmentId: equipmentId,
                    alertType: 'MaintenanceDue',
                    message: `Maintenance due in ${data.maintenance.nextMaintenanceDue} hours`,
                    priority: 'High',
                    timestamp: new Date(),
                    acknowledged: false
                });
            }
            
            // Equipment fault alert
            if (data.equipment?.status === 'FAULT') {
                alerts.push({
                    equipmentId: equipmentId,
                    alertType: 'EquipmentFault',
                    message: `Equipment fault detected: ${data.maintenance?.errorCode || 'Unknown error'}`,
                    priority: 'Critical',
                    timestamp: new Date(),
                    acknowledged: false
                });
            }
            
            // Store and publish alerts
            for (const alert of alerts) {
                this.scadaData.alarms.push(alert);
                
                // Publish alert to UNS
                const alertTopic = `uns/scada/alerts/${equipmentId}`;
                this.mqttClient.publish(alertTopic, JSON.stringify(alert), { qos: 1 });
                
                console.log(`Bridge: Generated alert for ${equipmentId}: ${alert.message}`);
            }
            
            // Keep only last 100 alarms
            if (this.scadaData.alarms.length > 100) {
                this.scadaData.alarms = this.scadaData.alarms.slice(-100);
            }
            
        } catch (error) {
            console.error('Bridge: Error generating SCADA alerts:', error);
        }
    }

    updateTrendData(data) {
        try {
            const equipmentId = data.source?.equipmentId;
            if (!equipmentId) return;
            
            // Create trend data structure for SCADA visualization
            const trendData = {
                equipmentId: equipmentId,
                timestamp: data.timestamp,
                values: {}
            };
            
            // Add all numeric values for trending
            if (data.process?.parameters) {
                const params = data.process.parameters;
                Object.keys(params).forEach(param => {
                    if (typeof params[param].value === 'number') {
                        trendData.values[param] = params[param].value;
                    }
                });
            }
            
            if (data.equipment?.performance) {
                trendData.values.efficiency = data.equipment.performance.efficiency;
            }
            
            if (data.equipment) {
                trendData.values.availability = data.equipment.availability;
            }
            
            // Store trend data
            const trendKey = `trends_${equipmentId}`;
            if (!this.scadaData.trends.has(trendKey)) {
                this.scadaData.trends.set(trendKey, []);
            }
            
            const trends = this.scadaData.trends.get(trendKey);
            trends.push(trendData);
            
            // Keep only last 500 trend points per equipment
            if (trends.length > 500) {
                trends.splice(0, trends.length - 500);
            }
            
        } catch (error) {
            console.error('Bridge: Error updating trend data:', error);
        }
    }

    async publishSCADAData(originalData) {
        try {
            const equipmentId = originalData.source?.equipmentId;
            if (!equipmentId) return;
            
            // Create SCADA-enhanced data
            const scadaData = {
                ...originalData,
                scada: {
                    processedBy: 'ignition-bridge',
                    processedAt: new Date().toISOString(),
                    alarmCount: this.scadaData.alarms.filter(a => a.equipmentId === equipmentId && !a.acknowledged).length,
                    trendPoints: this.scadaData.trends.get(`trends_${equipmentId}`)?.length || 0,
                    visualization: {
                        displayName: this.getDisplayName(equipmentId),
                        dashboardUrl: `${this.ignitionUrl}/main/web/config/perspective.dashboard?id=${equipmentId}`,
                        trendUrl: `${this.ignitionUrl}/main/web/config/perspective.trend?equipment=${equipmentId}`
                    }
                }
            };
            
            // Publish enhanced data back to UNS
            const scadaTopic = `uns/scada/processed/${originalData.source.area}/${equipmentId}`;
            this.mqttClient.publish(scadaTopic, JSON.stringify(scadaData), { qos: 1 });
            
            console.log(`Bridge: Published SCADA-enhanced data for ${equipmentId}`);
            
        } catch (error) {
            console.error('Bridge: Error publishing SCADA data:', error);
        }
    }

    getDisplayName(equipmentId) {
        const displayNames = {
            'LINE_01': 'Production Line 1',
            'PKG_01': 'Packaging Unit 1',
            'CONV_01': 'Conveyor System 1'
        };
        return displayNames[equipmentId] || equipmentId;
    }

    startPeriodicSync() {
        // Sync data every 30 seconds
        setInterval(async () => {
            try {
                // Publish current alarm summary
                const alarmSummary = {
                    timestamp: new Date().toISOString(),
                    totalAlarms: this.scadaData.alarms.length,
                    activeAlarms: this.scadaData.alarms.filter(a => !a.acknowledged).length,
                    criticalAlarms: this.scadaData.alarms.filter(a => a.priority === 'Critical' && !a.acknowledged).length,
                    alarmsByEquipment: {}
                };
                
                // Group alarms by equipment
                this.scadaData.alarms.forEach(alarm => {
                    if (!alarmSummary.alarmsByEquipment[alarm.equipmentId]) {
                        alarmSummary.alarmsByEquipment[alarm.equipmentId] = 0;
                    }
                    if (!alarm.acknowledged) {
                        alarmSummary.alarmsByEquipment[alarm.equipmentId]++;
                    }
                });
                
                this.mqttClient.publish('uns/scada/alarm-summary', JSON.stringify(alarmSummary), { qos: 1 });
                
            } catch (error) {
                console.error('Bridge: Error in periodic sync:', error);
            }
        }, 30000);
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('Received SIGINT, shutting down bridge gracefully...');
    if (global.bridge && global.bridge.mqttClient) {
        global.bridge.mqttClient.end();
    }
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down bridge gracefully...');
    if (global.bridge && global.bridge.mqttClient) {
        global.bridge.mqttClient.end();
    }
    process.exit(0);
});

// Start the bridge
global.bridge = new IgnitionMQTTBridge();