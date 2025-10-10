class FlexibleTopicGenerator {
    constructor(config) {
        this.config = config;
        this.topicTemplates = new Map();
        this.init();
    }

    init() {
        const outputFormats = this.config.outputFormats || {};
        
        for (const [formatName, formatConfig] of Object.entries(outputFormats)) {
            if (formatConfig.topicTemplate) {
                this.topicTemplates.set(formatName, formatConfig.topicTemplate);
            }
        }

        console.log(`Loaded ${this.topicTemplates.size} topic templates:`, Array.from(this.topicTemplates.keys()));
    }

    generateTopics(formatName, transformedData, enterpriseStructure) {
        const template = this.topicTemplates.get(formatName);
        
        if (!template) {
            console.warn(`No topic template found for format: ${formatName}, using default`);
            return this.generateDefaultTopics(transformedData, enterpriseStructure);
        }

        return this.generateTopicsFromTemplate(template, transformedData, enterpriseStructure);
    }

    generateTopicsFromTemplate(template, transformedData, enterpriseStructure) {
        const topics = [];
        
        // Create variable substitution map
        const variables = this.extractVariables(transformedData, enterpriseStructure);
        
        // Base topic from template
        const baseTopic = this.substituteVariables(template, variables);
        
        // Generate specific topic variants based on data type
        const dataType = transformedData.dataType || 'equipment';
        
        topics.push({
            topic: baseTopic,
            data: transformedData,
            qos: 1
        });

        // Add data type specific topics if template supports it
        if (template.includes('{dataType}')) {
            topics.push({
                topic: this.substituteVariables(template.replace('{dataType}', dataType), variables),
                data: transformedData,
                qos: 1
            });
        } else {
            // Add data type as suffix if not in template
            topics.push({
                topic: `${baseTopic}/${dataType}`,
                data: transformedData,
                qos: 1
            });
        }

        // Add specific metric topics for different data types
        switch (dataType) {
            case 'process':
                if (transformedData.processParameters) {
                    topics.push({
                        topic: `${baseTopic}/process/parameters`,
                        data: transformedData.processParameters,
                        qos: 1
                    });
                }
                break;
                
            case 'quality':
                if (transformedData.qualityMetrics) {
                    topics.push({
                        topic: `${baseTopic}/quality/metrics`,
                        data: transformedData.qualityMetrics,
                        qos: 1
                    });
                }
                break;
                
            case 'maintenance':
                if (transformedData.maintenanceInfo) {
                    topics.push({
                        topic: `${baseTopic}/maintenance/status`,
                        data: transformedData.maintenanceInfo,
                        qos: 1
                    });
                }
                break;
                
            case 'energy':
                if (transformedData.energyMetrics) {
                    topics.push({
                        topic: `${baseTopic}/energy/metrics`,
                        data: transformedData.energyMetrics,
                        qos: 1
                    });
                }
                break;
        }

        // Add enterprise-wide equipment topic
        const equipmentId = this.getEquipmentId(transformedData);
        if (equipmentId) {
            const enterpriseTopic = this.generateEnterpriseEquipmentTopic(equipmentId, variables);
            topics.push({
                topic: enterpriseTopic,
                data: transformedData,
                qos: 1
            });
        }

        return topics;
    }

    generateDefaultTopics(transformedData, enterpriseStructure) {
        const structure = enterpriseStructure || {};
        const equipmentId = this.getEquipmentId(transformedData);
        
        const baseTopic = `uns/${structure.area || 'general'}/${structure.workUnit || equipmentId}`;
        
        return [
            {
                topic: `${baseTopic}/equipment/status`,
                data: transformedData,
                qos: 1
            },
            {
                topic: `uns/enterprise/equipment/${equipmentId}`,
                data: transformedData,
                qos: 1
            }
        ];
    }

    extractVariables(transformedData, enterpriseStructure) {
        const structure = enterpriseStructure || {};
        const equipmentId = this.getEquipmentId(transformedData);
        
        return {
            enterprise: structure.enterprise || 'unknown',
            site: structure.site || 'unknown',
            area: structure.area || 'general',
            workUnit: structure.workUnit || equipmentId || 'unknown',
            line: structure.line || structure.workUnit || 'unknown',
            equipment: equipmentId || 'unknown',
            equipmentId: equipmentId || 'unknown',
            dataType: transformedData.dataType || 'equipment',
            region: structure.site || 'unknown', // alias for site
            facility: structure.area || 'general', // alias for area
            metric: transformedData.dataType || 'status'
        };
    }

    substituteVariables(template, variables) {
        let result = template;
        
        // Replace all {variable} placeholders
        for (const [key, value] of Object.entries(variables)) {
            const placeholder = `{${key}}`;
            result = result.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
        }
        
        // Clean up any remaining empty segments
        result = result.replace(/\/+/g, '/'); // Remove double slashes
        result = result.replace(/\/$/, ''); // Remove trailing slash
        
        return result;
    }

    getEquipmentId(transformedData) {
        // Try different possible locations for equipment ID
        return transformedData.equipment?.id ||
               transformedData.source?.equipmentId ||
               transformedData.hierarchy?.equipment ||
               transformedData.equipmentId ||
               'unknown';
    }

    generateEnterpriseEquipmentTopic(equipmentId, variables) {
        const enterprise = variables.enterprise || 'unknown';
        return `uns/enterprise/${enterprise}/equipment/${equipmentId}`;
    }

    generateAlarmTopic(transformedData, enterpriseStructure, severity = 'medium') {
        const variables = this.extractVariables(transformedData, enterpriseStructure);
        
        return `alarms/${variables.enterprise}/${variables.site}/${variables.area}/${severity}`;
    }

    generateEventTopic(transformedData, enterpriseStructure, eventType = 'status') {
        const variables = this.extractVariables(transformedData, enterpriseStructure);
        
        return `events/${variables.enterprise}/${variables.area}/${variables.equipment}/${eventType}`;
    }

    generateAnalyticsTopic(transformedData, enterpriseStructure, metric = 'oee') {
        const variables = this.extractVariables(transformedData, enterpriseStructure);
        
        return `analytics/${variables.enterprise}/${variables.area}/${metric}`;
    }

    // Utility method to validate topic structure
    validateTopicStructure(topic) {
        // Basic validation rules
        const rules = {
            maxLength: 256,
            allowedChars: /^[a-zA-Z0-9/_-]+$/,
            noLeadingSlash: /^[^/]/,
            noTrailingSlash: /[^/]$/,
            noDoubleSlash: /^(?!.*\/\/).*$/
        };

        if (topic.length > rules.maxLength) {
            return { valid: false, error: 'Topic too long' };
        }
        
        if (!rules.allowedChars.test(topic)) {
            return { valid: false, error: 'Invalid characters in topic' };
        }
        
        if (!rules.noLeadingSlash.test(topic)) {
            return { valid: false, error: 'Topic cannot start with /' };
        }
        
        if (!rules.noTrailingSlash.test(topic)) {
            return { valid: false, error: 'Topic cannot end with /' };
        }
        
        if (!rules.noDoubleSlash.test(topic)) {
            return { valid: false, error: 'Topic cannot contain //' };
        }

        return { valid: true };
    }

    getTopicStatistics(topics) {
        const stats = {
            totalTopics: topics.length,
            uniqueTopics: new Set(topics.map(t => t.topic)).size,
            averageTopicLength: topics.reduce((sum, t) => sum + t.topic.length, 0) / topics.length,
            topicsByQoS: {},
            maxTopicLength: Math.max(...topics.map(t => t.topic.length)),
            minTopicLength: Math.min(...topics.map(t => t.topic.length))
        };

        // Count topics by QoS
        topics.forEach(t => {
            const qos = t.qos || 0;
            stats.topicsByQoS[qos] = (stats.topicsByQoS[qos] || 0) + 1;
        });

        return stats;
    }
}

module.exports = FlexibleTopicGenerator;