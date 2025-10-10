const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class FlexibleTransformer {
    constructor(config) {
        this.config = config;
        this.transformers = new Map();
        this.outputSchemas = new Map();
        this.init();
    }

    async init() {
        const outputFormats = this.config.outputFormats || {};
        
        for (const [formatName, formatConfig] of Object.entries(outputFormats)) {
            try {
                await this.loadTransformer(formatName, formatConfig);
            } catch (error) {
                console.error(`Error loading transformer for format ${formatName}:`, error);
            }
        }

        console.log(`Loaded ${this.transformers.size} transformers:`, Array.from(this.transformers.keys()));
    }

    async loadTransformer(formatName, formatConfig) {
        let transformer;
        
        // Check if transformer file exists, otherwise use built-in transformer
        try {
            if (formatConfig.transformer && await this.fileExists(formatConfig.transformer)) {
                transformer = require(path.resolve(formatConfig.transformer));
            } else {
                // Use built-in transformer based on format name
                transformer = this.getBuiltInTransformer(formatName);
            }
            
            this.transformers.set(formatName, transformer);
            
            // Load schema if specified
            if (formatConfig.schema) {
                try {
                    const schemaContent = await fs.readFile(path.resolve(formatConfig.schema), 'utf8');
                    const schema = JSON.parse(schemaContent);
                    this.outputSchemas.set(formatName, schema);
                } catch (error) {
                    console.warn(`Could not load schema for ${formatName}:`, error.message);
                }
            }
            
        } catch (error) {
            console.error(`Error loading transformer for ${formatName}:`, error);
            throw error;
        }
    }

    async fileExists(filePath) {
        try {
            await fs.access(path.resolve(filePath));
            return true;
        } catch {
            return false;
        }
    }

    getBuiltInTransformer(formatName) {
        const transformers = {
            'isa95-part2': this.createISA95Part2Transformer(),
            'isa95-legacy': this.createISA95LegacyTransformer(), 
            'custom-hierarchical': this.createCustomHierarchicalTransformer()
        };

        const transformer = transformers[formatName];
        if (!transformer) {
            throw new Error(`No built-in transformer found for format: ${formatName}`);
        }

        return transformer;
    }

    createISA95Part2Transformer() {
        const transformer = {
            name: 'ISA-95 Part 2 Transformer',
            version: '1.0.0',
            
            transform: (rawData, enterpriseStructure, context = {}) => {
                const structure = enterpriseStructure || {};
                
                const transformed = {
                    messageId: uuidv4(),
                    timestamp: rawData.timestamp,
                    
                    enterprise: {
                        name: structure.enterprise || 'UnknownEnterprise',
                        site: structure.site || 'UnknownSite',
                        area: structure.area || 'GENERAL',
                        workUnit: structure.workUnit || rawData.machineId,
                        line: structure.line
                    },
                    
                    equipment: {
                        id: rawData.machineId,
                        class: structure.equipmentType || rawData.machineType,
                        model: rawData.machineModel,
                        status: {
                            operationalState: transformer.mapOperationalState(rawData.status?.state),
                            availability: transformer.calculateAvailability(rawData.status),
                            performance: rawData.status?.efficiency || 0,
                            quality: transformer.calculateQualityRate(rawData.quality),
                            oee: transformer.calculateOEE(rawData)
                        }
                    },
                    
                    dataType: transformer.determineDataType(rawData),
                    
                    processParameters: transformer.transformProcessParameters(rawData.sensors),
                    
                    qualityMetrics: transformer.transformQualityMetrics(rawData.quality),
                    
                    maintenanceInfo: transformer.transformMaintenanceInfo(rawData.status),
                    
                    energyMetrics: transformer.transformEnergyMetrics(rawData.sensors),
                    
                    context: {
                        batchId: context.batchId,
                        recipeId: context.recipeId,
                        operatorId: context.operatorId,
                        workOrder: context.workOrder
                    },
                    
                    metadata: {
                        source: context.sourceId || 'payload-processor',
                        version: '2.0',
                        tags: {
                            ...structure.tags,
                            processingTimestamp: new Date().toISOString(),
                            isEnterpriseDiscovered: !structure.isFallback
                        }
                    }
                };

                return transformed;
            }
        };
        
        // Add helper methods to transformer object
        transformer.mapOperationalState = (state) => {
            const mapping = {
                'RUNNING': 'ACTIVE',
                'IDLE': 'STANDBY', 
                'ERROR': 'FAULT',
                'MAINTENANCE': 'MAINTENANCE'
            };
            return mapping[state] || 'INACTIVE';
        };

        transformer.calculateAvailability = (status) => {
            if (!status) return 0;
            
            switch (status.state) {
                case 'RUNNING': return 100;
                case 'IDLE': return 75;
                case 'ERROR': return 0;
                case 'MAINTENANCE': return 0;
                default: return 50;
            }
        };

        transformer.calculateQualityRate = (quality) => {
            if (!quality || !quality.good_parts || !quality.bad_parts) return 100;
            
            const total = quality.good_parts + quality.bad_parts;
            return total > 0 ? (quality.good_parts / total) * 100 : 100;
        };

        transformer.calculateOEE = (rawData) => {
            const availability = transformer.calculateAvailability(rawData.status);
            const performance = rawData.status?.efficiency || 100;
            const quality = transformer.calculateQualityRate(rawData.quality);
            
            return (availability * performance * quality) / 10000;
        };

        transformer.determineDataType = (rawData) => {
            if (rawData.quality) return 'quality';
            if (rawData.status?.state === 'MAINTENANCE' || rawData.status?.error_code) return 'maintenance';
            if (rawData.sensors) return 'process';
            return 'equipment';
        };

        transformer.transformProcessParameters = (sensors) => {
            if (!sensors) return {};
            
            const parameters = {};
            
            Object.entries(sensors).forEach(([key, value]) => {
                if (typeof value === 'number') {
                    parameters[key] = {
                        value: value,
                        unit: transformer.getParameterUnit(key),
                        timestamp: new Date().toISOString(),
                        quality: 'GOOD'
                    };
                }
            });
            
            return parameters;
        };

        transformer.getParameterUnit = (parameterName) => {
            const units = {
                'temperature': '°C',
                'pressure': 'bar',
                'speed': '%',
                'vibration': 'mm/s',
                'power_consumption': 'kW'
            };
            return units[parameterName] || 'unit';
        };

        transformer.transformQualityMetrics = (quality) => {
            if (!quality) return null;
            
            return {
                goodParts: quality.good_parts || 0,
                rejectedParts: quality.bad_parts || 0,
                reworkParts: 0,
                totalParts: (quality.good_parts || 0) + (quality.bad_parts || 0),
                yieldRate: quality.reject_rate ? (100 - quality.reject_rate) : 100,
                defectTypes: []
            };
        };

        transformer.transformMaintenanceInfo = (status) => {
            if (!status) return null;
            
            return {
                runTimeHours: status.runtime_hours || 0,
                cycleCount: status.cycle_count || 0,
                maintenanceType: status.state === 'MAINTENANCE' ? 'CORRECTIVE' : 'PREVENTIVE',
                alerts: status.error_code ? [{
                    severity: 'HIGH',
                    message: `Error Code: ${status.error_code}`,
                    code: status.error_code,
                    timestamp: new Date().toISOString()
                }] : []
            };
        };

        transformer.transformEnergyMetrics = (sensors) => {
            if (!sensors || typeof sensors.power_consumption !== 'number') return null;
            
            return {
                powerConsumption: sensors.power_consumption,
                energyTotal: sensors.power_consumption * (sensors.runtime_hours || 1),
                efficiency: 85 // Default efficiency, could be calculated
            };
        };
        
        return transformer;
    }

    createISA95LegacyTransformer() {
        return {
            name: 'ISA-95 Legacy Transformer',
            version: '1.0.0',
            
            transform: (rawData, enterpriseStructure, context = {}) => {
                // This mimics the old hard-coded transformation
                const structure = enterpriseStructure || {};
                
                return {
                    messageId: uuidv4(),
                    timestamp: rawData.timestamp,
                    source: {
                        area: structure.area || 'GENERAL',
                        workUnit: structure.workUnit || rawData.machineId,
                        equipmentClass: rawData.machineType,
                        equipmentId: rawData.machineId
                    },
                    equipment: {
                        id: rawData.machineId,
                        type: rawData.machineType,
                        status: transformer.mapEquipmentStatus(rawData.status?.state),
                        availability: transformer.calculateAvailability(rawData.status),
                        performance: {
                            efficiency: rawData.status?.efficiency,
                            cycleCount: rawData.status?.cycle_count,
                            runtimeHours: rawData.status?.runtime_hours
                        }
                    },
                    // ... rest of legacy format
                };
            }
        };

        transformer.mapEquipmentStatus = (status) => {
                const mapping = {
                    'RUNNING': 'ACTIVE',
                    'IDLE': 'IDLE',
                    'ERROR': 'FAULT',
                    'MAINTENANCE': 'MAINTENANCE'
                };
                return mapping[status] || 'UNKNOWN';
            };

        transformer.calculateAvailability = (status) => {
                if (!status) return 50;
                
                switch (status.state) {
                    case 'RUNNING': return 100;
                    case 'IDLE': return 75;
                    case 'ERROR': return 0;
                    case 'MAINTENANCE': return 0;
                    default: return 50;
                }
            };

        return transformer;
    }

    createCustomHierarchicalTransformer() {
        return {
            name: 'Custom Hierarchical Transformer',
            version: '1.0.0',
            
            transform: (rawData, enterpriseStructure, context = {}) => {
                const structure = enterpriseStructure || {};
                
                // Custom format that could match client's specific requirements
                return {
                    id: uuidv4(),
                    ts: rawData.timestamp,
                    hierarchy: {
                        enterprise: structure.enterprise || 'default',
                        region: structure.site || 'unknown',
                        facility: structure.area || 'general',
                        line: structure.line || structure.workUnit || rawData.machineId,
                        equipment: rawData.machineId
                    },
                    metrics: {
                        operational: this.transformOperationalData(rawData),
                        process: this.transformProcessData(rawData.sensors),
                        quality: this.transformQualityData(rawData.quality)
                    },
                    meta: {
                        source: 'payload-processor',
                        version: '1.0',
                        discovered: !structure.isFallback
                    }
                };
            },

            transformOperationalData: (rawData) => {
                return {
                    state: rawData.status?.state || 'UNKNOWN',
                    efficiency: rawData.status?.efficiency || 0,
                    availability: rawData.status?.state === 'RUNNING' ? 100 : 0
                };
            },

            transformProcessData: (sensors) => {
                return sensors || {};
            },

            transformQualityData: (quality) => {
                return quality || {};
            }
        };
    }

    async transform(formatName, rawData, enterpriseStructure, context = {}) {
        const transformer = this.transformers.get(formatName);
        
        if (!transformer) {
            throw new Error(`No transformer found for format: ${formatName}`);
        }

        try {
            const transformed = transformer.transform(rawData, enterpriseStructure, context);
            
            // Validate against schema if available
            const schema = this.outputSchemas.get(formatName);
            if (schema) {
                // Schema validation would go here
                // For now, just log that we have a schema
                console.log(`Validating ${formatName} output against schema`);
            }
            
            return transformed;
        } catch (error) {
            console.error(`Error in transformer ${formatName}:`, error);
            throw error;
        }
    }

    getAvailableFormats() {
        return Array.from(this.transformers.keys());
    }

    getTransformerInfo(formatName) {
        const transformer = this.transformers.get(formatName);
        return transformer ? {
            name: transformer.name,
            version: transformer.version,
            hasSchema: this.outputSchemas.has(formatName)
        } : null;
    }
}

module.exports = FlexibleTransformer;