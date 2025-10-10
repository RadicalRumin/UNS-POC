const mqtt = require('mqtt');

class TestPublisher {
    constructor() {
        this.client = mqtt.connect('mqtt://localhost:1883');
        this.equipmentId = 'TEST_LINE1_STATION1';
        this.publisherId = 'test-publisher-001';
        
        this.client.on('connect', () => {
            console.log('Test publisher connected to MQTT broker');
            this.sendMetadata();
            
            // Send test data every 5 seconds
            setInterval(() => this.sendData(), 5000);
        });
    }
    
    sendMetadata() {
        const metadata = {
            publisherId: this.publisherId,
            timestamp: new Date().toISOString(),
            structureInfo: {
                equipmentId: this.equipmentId,
                equipmentType: 'PRODUCTION_LINE',
                location: {
                    enterprise: 'TestCorp_Manufacturing',
                    site: 'Test_Plant_Alpha',
                    area: 'PRODUCTION',
                    workUnit: 'Assembly_Line_1',
                    line: 'LINE1'
                },
                capabilities: [
                    'temperature_monitoring',
                    'pressure_control',
                    'quality_inspection',
                    'cycle_counting'
                ],
                dataTypes: [
                    'process',
                    'quality', 
                    'equipment',
                    'maintenance'
                ],
                tags: {
                    criticality: 'HIGH',
                    maintenance_group: 'MECH_A1',
                    safety_zone: 'ZONE_ALPHA',
                    manufacturer: 'TestEquip Inc',
                    model: 'TE-1000',
                    version: '2.1.0'
                }
            },
            relationships: [
                {
                    relatedEquipmentId: 'TEST_CONVEYOR_IN',
                    relationshipType: 'upstream'
                },
                {
                    relatedEquipmentId: 'TEST_LINE1_STATION2', 
                    relationshipType: 'downstream'
                }
            ]
        };
        
        const topic = `enterprise/${this.publisherId}/metadata`;
        this.client.publish(topic, JSON.stringify(metadata), { qos: 1 }, (error) => {
            if (error) {
                console.error('Error publishing metadata:', error);
            } else {
                console.log(`✅ Published enterprise metadata to ${topic}`);
            }
        });
    }
    
    sendData() {
        const data = {
            timestamp: new Date().toISOString(),
            machineId: this.equipmentId,
            machineType: 'PRODUCTION_LINE',
            sensors: {
                temperature: 65 + Math.random() * 20, // 65-85°C
                pressure: 2.5 + Math.random() * 1.5,  // 2.5-4.0 bar
                speed: 75 + Math.random() * 20,        // 75-95%
                vibration: Math.random() * 5,          // 0-5 mm/s
                power_consumption: 45 + Math.random() * 15 // 45-60 kW
            },
            status: {
                state: this.getRandomState(),
                cycle_count: Math.floor(Math.random() * 10000),
                runtime_hours: Math.random() * 8760,
                last_maintenance_hours: Math.random() * 168,
                error_code: Math.random() > 0.9 ? 'E001' : null,
                efficiency: 80 + Math.random() * 15
            },
            quality: Math.random() > 0.3 ? {
                good_parts: Math.floor(Math.random() * 100),
                bad_parts: Math.floor(Math.random() * 10),
                reject_rate: Math.random() * 5
            } : null
        };
        
        const topic = `raw/plc/${this.equipmentId}/data`;
        this.client.publish(topic, JSON.stringify(data), { qos: 1 }, (error) => {
            if (error) {
                console.error('Error publishing data:', error);
            } else {
                console.log(`📊 Published test data to ${topic} (state: ${data.status.state})`);
            }
        });
    }
    
    getRandomState() {
        const states = ['RUNNING', 'IDLE', 'ERROR', 'MAINTENANCE'];
        const weights = [0.7, 0.2, 0.05, 0.05]; // Mostly running
        
        const random = Math.random();
        let cumulative = 0;
        
        for (let i = 0; i < states.length; i++) {
            cumulative += weights[i];
            if (random <= cumulative) {
                return states[i];
            }
        }
        
        return 'RUNNING';
    }
}

// Create multiple test publishers for different equipment
class MultipleTestPublishers {
    constructor() {
        this.publishers = [];
        this.createPublishers();
    }
    
    createPublishers() {
        const equipmentConfigs = [
            {
                equipmentId: 'PROD_LINE1_STATION1',
                publisherId: 'plc-line1-station1',
                area: 'PRODUCTION',
                workUnit: 'Assembly_Line_1',
                line: 'LINE1'
            },
            {
                equipmentId: 'PACK_UNIT_A1',
                publisherId: 'plc-packaging-a1', 
                area: 'PACKAGING',
                workUnit: 'Packaging_Cell_A',
                line: 'PACK_A'
            },
            {
                equipmentId: 'QC_STATION_01',
                publisherId: 'qc-inspection-01',
                area: 'QUALITY_CONTROL',
                workUnit: 'QC_Cell_1',
                line: null
            }
        ];
        
        equipmentConfigs.forEach(config => {
            setTimeout(() => {
                this.createPublisher(config);
            }, Math.random() * 3000); // Stagger startup
        });
    }
    
    createPublisher(config) {
        const publisher = new CustomTestPublisher(config);
        this.publishers.push(publisher);
        console.log(`🏭 Created test publisher for ${config.equipmentId}`);
    }
}

class CustomTestPublisher {
    constructor(config) {
        this.config = config;
        this.client = mqtt.connect('mqtt://localhost:1883');
        
        this.client.on('connect', () => {
            console.log(`📡 ${this.config.publisherId} connected`);
            this.sendMetadata();
            
            // Send data with varying intervals
            const interval = 3000 + Math.random() * 4000; // 3-7 seconds
            setInterval(() => this.sendData(), interval);
        });
    }
    
    sendMetadata() {
        const metadata = {
            publisherId: this.config.publisherId,
            timestamp: new Date().toISOString(),
            structureInfo: {
                equipmentId: this.config.equipmentId,
                equipmentType: this.getEquipmentType(),
                location: {
                    enterprise: 'TestCorp_Manufacturing',
                    site: 'Test_Plant_Alpha',
                    area: this.config.area,
                    workUnit: this.config.workUnit,
                    line: this.config.line
                },
                capabilities: this.getCapabilities(),
                dataTypes: this.getDataTypes(),
                tags: {
                    criticality: this.getCriticality(),
                    maintenance_group: `MAINT_${this.config.area.substring(0, 4)}`,
                    safety_zone: 'ZONE_ALPHA'
                }
            }
        };
        
        const topic = `enterprise/${this.config.publisherId}/metadata`;
        this.client.publish(topic, JSON.stringify(metadata), { qos: 1 });
        console.log(`✅ ${this.config.publisherId} sent metadata`);
    }
    
    sendData() {
        const data = {
            timestamp: new Date().toISOString(),
            machineId: this.config.equipmentId,
            machineType: this.getEquipmentType(),
            sensors: this.generateSensorData(),
            status: this.generateStatusData(),
            quality: this.shouldIncludeQuality() ? this.generateQualityData() : null
        };
        
        const topic = `raw/plc/${this.config.equipmentId}/data`;
        this.client.publish(topic, JSON.stringify(data), { qos: 1 });
        
        const statusIcon = this.getStatusIcon(data.status.state);
        console.log(`${statusIcon} ${this.config.publisherId} sent data (${data.status.state})`);
    }
    
    getEquipmentType() {
        const mapping = {
            'PRODUCTION': 'PRODUCTION_LINE',
            'PACKAGING': 'PACKAGING_UNIT',
            'QUALITY_CONTROL': 'QUALITY_STATION'
        };
        return mapping[this.config.area] || 'PRODUCTION_LINE';
    }
    
    getCapabilities() {
        const baseCapabilities = ['temperature_monitoring', 'status_reporting'];
        const areaCapabilities = {
            'PRODUCTION': ['pressure_control', 'speed_control', 'cycle_counting'],
            'PACKAGING': ['weight_measurement', 'seal_integrity', 'label_verification'],
            'QUALITY_CONTROL': ['dimensional_inspection', 'defect_detection', 'compliance_check']
        };
        
        return [...baseCapabilities, ...(areaCapabilities[this.config.area] || [])];
    }
    
    getDataTypes() {
        const baseTypes = ['equipment', 'process'];
        const areaTypes = {
            'PRODUCTION': ['quality'],
            'PACKAGING': ['quality'],
            'QUALITY_CONTROL': ['quality', 'maintenance']
        };
        
        return [...baseTypes, ...(areaTypes[this.config.area] || [])];
    }
    
    getCriticality() {
        const criticalityMap = {
            'PRODUCTION': 'HIGH',
            'PACKAGING': 'MEDIUM', 
            'QUALITY_CONTROL': 'HIGH'
        };
        return criticalityMap[this.config.area] || 'MEDIUM';
    }
    
    generateSensorData() {
        const base = {
            temperature: 40 + Math.random() * 40,
            pressure: 1 + Math.random() * 3,
            speed: 60 + Math.random() * 30,
            power_consumption: 20 + Math.random() * 20
        };
        
        if (this.config.area === 'PRODUCTION') {
            base.vibration = Math.random() * 8;
        } else if (this.config.area === 'PACKAGING') {
            base.weight_sensor = 500 + Math.random() * 100;
        }
        
        return base;
    }
    
    generateStatusData() {
        return {
            state: this.getRandomState(),
            cycle_count: Math.floor(Math.random() * 5000),
            runtime_hours: Math.random() * 2000,
            last_maintenance_hours: Math.random() * 200,
            error_code: Math.random() > 0.95 ? 'E' + Math.floor(Math.random() * 100).toString().padStart(3, '0') : null,
            efficiency: 70 + Math.random() * 25
        };
    }
    
    generateQualityData() {
        const good = Math.floor(Math.random() * 200);
        const bad = Math.floor(Math.random() * 20);
        
        return {
            good_parts: good,
            bad_parts: bad,
            reject_rate: bad > 0 ? (bad / (good + bad)) * 100 : 0
        };
    }
    
    shouldIncludeQuality() {
        return ['PRODUCTION', 'PACKAGING', 'QUALITY_CONTROL'].includes(this.config.area) && Math.random() > 0.4;
    }
    
    getRandomState() {
        const states = ['RUNNING', 'IDLE', 'ERROR', 'MAINTENANCE'];
        const areaWeights = {
            'PRODUCTION': [0.8, 0.15, 0.03, 0.02],
            'PACKAGING': [0.75, 0.2, 0.03, 0.02],
            'QUALITY_CONTROL': [0.7, 0.25, 0.03, 0.02]
        };
        
        const weights = areaWeights[this.config.area] || [0.7, 0.2, 0.05, 0.05];
        const random = Math.random();
        let cumulative = 0;
        
        for (let i = 0; i < states.length; i++) {
            cumulative += weights[i];
            if (random <= cumulative) {
                return states[i];
            }
        }
        
        return 'RUNNING';
    }
    
    getStatusIcon(state) {
        const icons = {
            'RUNNING': '🟢',
            'IDLE': '🟡', 
            'ERROR': '🔴',
            'MAINTENANCE': '🔧'
        };
        return icons[state] || '⚪';
    }
}

// Command line interface
const args = process.argv.slice(2);
const command = args[0] || 'single';

console.log('🚀 Starting UNS Payload Processor Test Publisher');
console.log('================================================');

switch (command) {
    case 'single':
        console.log('Mode: Single test publisher');
        new TestPublisher();
        break;
        
    case 'multi':
        console.log('Mode: Multiple test publishers (realistic scenario)');
        new MultipleTestPublishers();
        break;
        
    default:
        console.log('Usage: node test-publisher.js [single|multi]');
        console.log('  single - Single test equipment (default)');
        console.log('  multi  - Multiple test equipment for realistic testing');
        process.exit(1);
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down test publishers...');
    process.exit(0);
});