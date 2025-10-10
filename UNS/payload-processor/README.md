# Flexible UNS Payload Processor

A configurable and adaptable payload processor for Unified Namespace (UNS) architectures that supports dynamic enterprise structure discovery and multiple output formats.

## Overview

The Flexible UNS Payload Processor transforms raw industrial data into standardized formats while automatically discovering the enterprise structure from publisher metadata. This eliminates the need for hard-coded enterprise knowledge and supports multiple output formats including ISA-95 Part 2, legacy formats, and custom structures.

## Key Features

### 🏭 **Enterprise Structure Discovery**
- Dynamic discovery of enterprise hierarchy from publisher metadata
- No hard-coded enterprise structure required
- Automatic fallback mechanisms when structure is unknown
- Support for equipment relationships and dependencies

### 🔄 **Flexible Output Formats**
- **ISA-95 Part 2**: Enhanced standard with full enterprise hierarchy
- **ISA-95 Legacy**: Compatible with existing ISA-95 implementations  
- **Custom Formats**: Configurable output structures for specific client needs
- **Runtime Format Switching**: Change output formats without restart

### 📡 **Configurable Input Sources**
- Support for PLC, SCADA, and sensor data
- Flexible schema validation with JSON Schema
- Dynamic topic subscription patterns
- Metadata extraction from various data sources

### 🎯 **Adaptive Topic Generation**
- Configurable topic templates based on enterprise structure
- Hierarchical topic organization
- Data type specific topic routing
- Enterprise-wide equipment visibility

## Quick Start

### 1. Installation

```bash
cd UNS/payload-processor
npm install
```

### 2. Configuration

Create or modify `config/processor-config.json`:

```json
{
  "globalSettings": {
    "outputFormat": "isa95-part2",
    "enterpriseDiscovery": {
      "enabled": true,
      "metadataTopics": ["enterprise/+/metadata"]
    }
  },
  "outputFormats": {
    "isa95-part2": {
      "topicTemplate": "uns/{enterprise}/{site}/{area}/{workUnit}/{equipment}/{dataType}"
    }
  }
}
```

### 3. Start the Processor

```bash
# Start with default configuration
npm start

# Start with custom configuration
npm run start:dev

# Start legacy processor (backwards compatibility)
npm run start:legacy
```

### 4. Publish Enterprise Metadata

Publishers should send metadata to inform the processor about enterprise structure:

```javascript
const metadata = {
  publisherId: "plc-line1-station1",
  timestamp: "2025-10-10T10:30:00.000Z",
  structureInfo: {
    equipmentId: "LINE1_STATION1_PLC",
    equipmentType: "PRODUCTION_LINE",
    location: {
      enterprise: "ACME_Manufacturing",
      site: "Detroit_Plant_01",
      area: "PRODUCTION", 
      workUnit: "Assembly_Line_1",
      line: "LINE1"
    },
    capabilities: ["temperature_monitoring", "pressure_control"],
    dataTypes: ["process", "quality", "equipment"]
  }
};

mqttClient.publish("enterprise/plc-line1-station1/metadata", JSON.stringify(metadata));
```

### 5. Send Equipment Data

Send raw equipment data as usual:

```javascript
const equipmentData = {
  timestamp: "2025-10-10T10:30:00.000Z",
  machineId: "LINE1_STATION1_PLC",
  machineType: "PRODUCTION_LINE",
  sensors: {
    temperature: 75.5,
    pressure: 3.2,
    speed: 85
  },
  status: {
    state: "RUNNING",
    efficiency: 92
  }
};

mqttClient.publish("raw/plc/LINE1_STATION1_PLC/data", JSON.stringify(equipmentData));
```

The processor will automatically:
1. Receive and validate the equipment metadata
2. Transform the raw data using the discovered enterprise structure  
3. Publish to hierarchical UNS topics like `uns/ACME_Manufacturing/Detroit_Plant_01/PRODUCTION/Assembly_Line_1/LINE1_STATION1_PLC/process`

## Configuration Guide

### Output Formats

Configure multiple output formats in `config/processor-config.json`:

```json
{
  "outputFormats": {
    "isa95-part2": {
      "name": "ISA-95 Part 2 Standard",
      "schema": "./schemas/output/isa95-part2-schema.json",
      "transformer": "./transformers/isa95-part2-transformer.js",
      "topicTemplate": "uns/{enterprise}/{site}/{area}/{workUnit}/{equipment}/{dataType}"
    },
    "custom-hierarchical": {
      "name": "Custom Client Format", 
      "topicTemplate": "{enterprise}/{region}/{facility}/{line}/{equipment}/{metric}"
    }
  }
}
```

### Input Sources

Configure input data sources and metadata extraction:

```json
{
  "inputSources": {
    "raw-plc": {
      "topics": ["raw/plc/+/data"],
      "schema": "./schemas/input/raw-plc-schema.json",
      "metadataExtraction": {
        "equipmentId": "machineId",
        "equipmentType": "machineType",
        "locationHint": "topic.parts[2]"
      }
    }
  }
}
```

### Enterprise Discovery

Configure how enterprise structure is discovered:

```json
{
  "enterpriseStructure": {
    "discoveryMode": "dynamic",
    "fallbackMode": "adaptive", 
    "metadataSchema": "./schemas/enterprise/metadata-schema.json",
    "hierarchyLevels": ["enterprise", "site", "area", "workUnit", "equipment"],
    "fallbackMappings": {
      "equipmentTypeToArea": {
        "PRODUCTION_LINE": "PRODUCTION",
        "PACKAGING_UNIT": "PACKAGING"
      }
    }
  }
}
```

## Testing

### Test Publishers

Use the included test publisher to simulate real equipment:

```bash
# Single test equipment
node test-publisher.js single

# Multiple test equipment for realistic testing  
node test-publisher.js multi
```

### Monitor Processing

The processor provides runtime statistics:

```bash
# Processing stats are logged and can be accessed via MQTT
# Subscribe to: system/processor/stats
```

## Docker Deployment

### Build and Run

```bash
# Build the container
docker build -t flexible-payload-processor .

# Run with flexible processor (default)
docker run -e PROCESSOR_MODE=flexible flexible-payload-processor

# Run with legacy processor
docker run -e PROCESSOR_MODE=legacy flexible-payload-processor

# Run with custom config
docker run -v $(pwd)/config:/app/config flexible-payload-processor
```

### Docker Compose

```yaml
services:
  payload-processor:
    build: .
    environment:
      - PROCESSOR_MODE=flexible
      - CONFIG_PATH=./config/processor-config.json
      - MQTT_BROKER_URL=mqtt://mqtt-broker:1883
    volumes:
      - ./config:/app/config
    depends_on:
      - mqtt-broker
      - redis
      - mongodb
```

## Architecture

### Components

1. **EnterpriseStructureDiscovery**: Discovers and manages enterprise hierarchy from publisher metadata
2. **FlexibleTransformer**: Transforms data between formats using configurable transformers
3. **FlexibleTopicGenerator**: Generates output topics based on configurable templates
4. **FlexiblePayloadProcessor**: Main orchestrator that coordinates all components

### Data Flow

```
Raw Data → Input Validation → Enterprise Discovery → Transformation → Topic Generation → Output Publishing
     ↓              ↓                   ↓               ↓               ↓                    ↓
 Schema        Joi Validation    Metadata Cache    Format-specific   Template-based    MQTT Topics
Validation                                         Transformers      Topic Structure
```

### Enterprise Discovery Process

1. **Publisher Startup**: Equipment publishers send metadata on startup
2. **Structure Discovery**: Processor receives and validates enterprise metadata  
3. **Structure Mapping**: Creates internal mapping of equipmentId → enterprise structure
4. **Data Processing**: Raw data is processed using discovered structure
5. **Fallback Handling**: Uses adaptive fallbacks for unknown equipment

## Migration from Legacy

### Backwards Compatibility

The flexible processor maintains backwards compatibility:

```bash
# Legacy mode - uses original hard-coded processor
npm run start:legacy

# Flexible mode - new configurable processor  
npm start
```

### Migration Steps

1. **Test in Development**: Use `dev-config.json` for testing
2. **Update Publishers**: Add enterprise metadata publishing
3. **Configure Output Format**: Choose ISA-95 Part 2 or custom format
4. **Switch Gradually**: Run both processors during transition
5. **Validate Output**: Ensure output topics and formats meet requirements

## Advanced Features

### Runtime Configuration Changes

```javascript
// Switch output format at runtime
processor.switchOutputFormat('custom-hierarchical');

// Reload configuration without restart
processor.reloadConfiguration();

// Get processing statistics
const stats = processor.getProcessingStats();
```

### Custom Transformers

Create custom transformation logic:

```javascript
// transformers/custom-transformer.js
module.exports = {
  name: 'Custom Transformer',
  version: '1.0.0',
  
  transform: (rawData, enterpriseStructure, context) => {
    // Custom transformation logic
    return {
      customField: rawData.sensors.temperature,
      hierarchy: enterpriseStructure.location,
      // ... custom format
    };
  }
};
```

### Monitoring and Alerting

The processor exposes metrics and health information:

- Processing statistics (messages/sec, errors, discovery requests)
- Enterprise discovery status (known equipment, metadata providers)  
- Transformation performance (by format, by equipment type)
- Topic generation statistics (topics/message, validation errors)

## Troubleshooting

### Common Issues

**Enterprise Structure Not Discovered**
- Verify publishers are sending metadata to correct topics
- Check metadata schema validation in logs
- Ensure discovery is enabled in configuration

**Transformation Errors**
- Verify input data matches expected schema
- Check transformer configuration and availability
- Review validation settings (strict vs. permissive mode)

**Topic Generation Issues** 
- Validate topic templates have required variables
- Check enterprise structure contains expected hierarchy levels
- Review topic validation rules and character restrictions

### Debug Mode

Enable detailed logging:

```json
{
  "logging": {
    "level": "debug",
    "logDiscovery": true,
    "logTransformations": true,
    "logTopicGeneration": true
  }
}
```

## Contributing

To extend the flexible payload processor:

1. **Add Output Formats**: Create new transformers and schemas
2. **Support Input Sources**: Add new input source configurations and schemas  
3. **Enhance Discovery**: Extend enterprise structure discovery capabilities
4. **Custom Logic**: Add business-specific transformation or validation logic

See the `docs/` directory for detailed developer documentation.

## License

MIT License - See LICENSE file for details.