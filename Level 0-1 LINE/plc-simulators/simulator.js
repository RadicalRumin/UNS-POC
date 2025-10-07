const mqtt = require('mqtt');
const { v4: uuidv4 } = require('uuid');

class PLCSimulator {
    constructor() {
        this.machineId = process.env.MACHINE_ID || 'UNKNOWN';
        this.machineType = process.env.MACHINE_TYPE || 'GENERIC';
        this.brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
        this.topicPrefix = process.env.MQTT_TOPIC_PREFIX || `raw/plc/${this.machineId.toLowerCase()}`;
        this.interval = parseInt(process.env.SIMULATION_INTERVAL) || 2000;
        
        this.client = null;
        this.isRunning = false;
        
        // Machine state variables
        this.machineState = 'RUNNING';
        this.lastMaintenanceHours = 0;
        this.totalRuntime = 0;
        this.cycleCount = 0;
        this.temperature = 65; // Base temperature
        this.pressure = 2.5;   // Base pressure in bar
        this.speed = 100;      // Base speed %
        
        this.init();
    }

    async init() {
        try {
            console.log(`[${this.machineId}] Connecting to MQTT broker: ${this.brokerUrl}`);
            this.client = mqtt.connect(this.brokerUrl, {
                clientId: `plc-simulator-${this.machineId}-${uuidv4()}`,
                clean: true,
                reconnectPeriod: 5000
            });

            this.client.on('connect', () => {
                console.log(`[${this.machineId}] Connected to MQTT broker`);
                this.startSimulation();
            });

            this.client.on('error', (error) => {
                console.error(`[${this.machineId}] MQTT connection error:`, error);
            });

            this.client.on('disconnect', () => {
                console.log(`[${this.machineId}] Disconnected from MQTT broker`);
                this.isRunning = false;
            });

        } catch (error) {
            console.error(`[${this.machineId}] Initialization error:`, error);
        }
    }

    generateSensorData() {
        // Simulate realistic variations and occasional anomalies
        const baseTemp = this.getBaseTemperature();
        const basePressure = this.getBasePressure();
        const baseSpeed = this.getBaseSpeed();
        
        // Add some randomness and trends
        this.temperature = baseTemp + (Math.random() - 0.5) * 10;
        this.pressure = basePressure + (Math.random() - 0.5) * 0.5;
        this.speed = Math.max(0, baseSpeed + (Math.random() - 0.5) * 20);
        
        // Simulate machine state changes
        this.updateMachineState();
        
        return {
            timestamp: new Date().toISOString(),
            machineId: this.machineId,
            machineType: this.machineType,
            sensors: {
                temperature: Math.round(this.temperature * 10) / 10,
                pressure: Math.round(this.pressure * 100) / 100,
                speed: Math.round(this.speed),
                vibration: Math.round((Math.random() * 5 + 1) * 100) / 100,
                power_consumption: Math.round((this.speed / 100 * 50 + Math.random() * 10) * 100) / 100
            },
            status: {
                state: this.machineState,
                cycle_count: this.cycleCount,
                runtime_hours: Math.round(this.totalRuntime * 100) / 100,
                last_maintenance_hours: this.lastMaintenanceHours,
                error_code: this.getErrorCode(),
                efficiency: this.calculateEfficiency()
            },
            quality: {
                good_parts: Math.floor(Math.random() * 100 + 950),
                bad_parts: Math.floor(Math.random() * 50),
                reject_rate: Math.round(Math.random() * 5 * 100) / 100
            }
        };
    }

    getBaseTemperature() {
        switch (this.machineType) {
            case 'PRODUCTION_LINE': return 70;
            case 'PACKAGING_UNIT': return 45;
            case 'CONVEYOR_SYSTEM': return 35;
            default: return 50;
        }
    }

    getBasePressure() {
        switch (this.machineType) {
            case 'PRODUCTION_LINE': return 3.0;
            case 'PACKAGING_UNIT': return 2.2;
            case 'CONVEYOR_SYSTEM': return 1.8;
            default: return 2.5;
        }
    }

    getBaseSpeed() {
        switch (this.machineType) {
            case 'PRODUCTION_LINE': return 85;
            case 'PACKAGING_UNIT': return 92;
            case 'CONVEYOR_SYSTEM': return 78;
            default: return 80;
        }
    }

    updateMachineState() {
        this.totalRuntime += this.interval / 3600000; // Convert ms to hours
        
        // Simulate occasional state changes
        const random = Math.random();
        if (random < 0.002) { // 0.2% chance of maintenance
            this.machineState = 'MAINTENANCE';
            this.lastMaintenanceHours = 0;
        } else if (random < 0.005) { // 0.3% chance of error
            this.machineState = 'ERROR';
        } else if (random < 0.01) { // 0.5% chance of idle
            this.machineState = 'IDLE';
        } else {
            this.machineState = 'RUNNING';
            this.cycleCount++;
            this.lastMaintenanceHours += this.interval / 3600000;
        }
    }

    getErrorCode() {
        if (this.machineState === 'ERROR') {
            const errors = ['E001', 'E002', 'E003', 'E004', 'E005'];
            return errors[Math.floor(Math.random() * errors.length)];
        }
        return null;
    }

    calculateEfficiency() {
        let baseEfficiency = 85;
        
        if (this.machineState === 'RUNNING') {
            baseEfficiency += Math.random() * 10;
        } else if (this.machineState === 'IDLE') {
            baseEfficiency = 0;
        } else if (this.machineState === 'ERROR') {
            baseEfficiency = 0;
        } else if (this.machineState === 'MAINTENANCE') {
            baseEfficiency = 0;
        }
        
        return Math.round(Math.max(0, Math.min(100, baseEfficiency)) * 100) / 100;
    }

    publishData() {
        if (!this.client || !this.client.connected) {
            console.log(`[${this.machineId}] MQTT client not connected, skipping publish`);
            return;
        }

        const data = this.generateSensorData();
        const topic = `${this.topicPrefix}/data`;
        
        this.client.publish(topic, JSON.stringify(data), { qos: 1 }, (error) => {
            if (error) {
                console.error(`[${this.machineId}] Error publishing data:`, error);
            } else {
                console.log(`[${this.machineId}] Published data to ${topic} - State: ${data.status.state}, Speed: ${data.sensors.speed}%`);
            }
        });
    }

    startSimulation() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        console.log(`[${this.machineId}] Starting simulation with ${this.interval}ms interval`);
        
        // Publish initial data immediately
        this.publishData();
        
        // Set up regular publishing
        this.simulationTimer = setInterval(() => {
            if (this.isRunning) {
                this.publishData();
            }
        }, this.interval);
    }

    stop() {
        this.isRunning = false;
        if (this.simulationTimer) {
            clearInterval(this.simulationTimer);
        }
        if (this.client) {
            this.client.end();
        }
        console.log(`[${this.machineId}] Simulation stopped`);
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('Received SIGINT, shutting down gracefully...');
    if (global.simulator) {
        global.simulator.stop();
    }
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    if (global.simulator) {
        global.simulator.stop();
    }
    process.exit(0);
});

// Start the simulator
global.simulator = new PLCSimulator();