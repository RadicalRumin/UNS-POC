# Enterprise Structure Discovery for Publishers

This document explains how data publishers (PLCs, SCADA systems, sensors) should provide enterprise structure information to enable flexible payload processing.

## Overview

The flexible payload processor can automatically discover the enterprise structure (sites, areas, production lines, etc.) by receiving metadata from publishers. This eliminates the need for hard-coded enterprise knowledge in the processor.

## Metadata Topics

Publishers should send enterprise structure metadata to one of these topics:
- `enterprise/{publisherId}/metadata`
- `structure/{equipmentId}/info`

## Metadata Message Format

```json
{
  "publisherId": "plc-line1-station3",
  "timestamp": "2025-10-10T10:30:00.000Z",
  "structureInfo": {
    "equipmentId": "LINE1_STATION3_PLC",
    "equipmentType": "PRODUCTION_LINE",
    "location": {
      "enterprise": "ACME_Manufacturing",
      "site": "Detroit_Plant_01", 
      "area": "PRODUCTION",
      "workUnit": "Assembly_Line_1",
      "line": "LINE1"
    },
    "capabilities": [
      "temperature_monitoring",
      "pressure_control",
      "quality_inspection"
    ],
    "dataTypes": [
      "process",
      "quality",
      "equipment"
    ],
    "tags": {
      "criticality": "HIGH",
      "maintenance_group": "MECH_01",
      "safety_zone": "ZONE_A"
    }
  },
  "relationships": [
    {
      "relatedEquipmentId": "LINE1_CONVEYOR_01",
      "relationshipType": "upstream"
    },
    {
      "relatedEquipmentId": "LINE1_STATION4_PLC",
      "relationshipType": "downstream"
    }
  ]
}
```

## Required Fields

### structureInfo.equipmentId
Unique identifier for this piece of equipment across the entire enterprise.

### structureInfo.location
Hierarchical location information:
- **enterprise**: Company/organization name
- **site**: Physical location/plant name  
- **area**: Production area (e.g., PRODUCTION, PACKAGING, QUALITY_CONTROL)
- **workUnit**: Work cell/unit identifier
- **line**: Production line identifier (optional)

### Optional Fields

### structureInfo.equipmentType
Type/category of equipment (e.g., PRODUCTION_LINE, PACKAGING_UNIT, CONVEYOR_SYSTEM)

### structureInfo.capabilities
Array of capabilities this equipment provides

### structureInfo.dataTypes
Types of data this equipment publishes:
- `equipment` - Equipment status, availability, performance
- `process` - Process parameters like temperature, pressure
- `quality` - Quality metrics, defect counts
- `maintenance` - Maintenance schedules, alerts
- `energy` - Power consumption, efficiency
- `safety` - Safety alerts, compliance data

### structureInfo.tags
Custom key-value pairs for additional metadata

### relationships
Array of relationships to other equipment:
- `parent` - This equipment contains the related equipment
- `child` - This equipment is contained by the related equipment  
- `upstream` - Related equipment feeds into this equipment
- `downstream` - This equipment feeds into the related equipment
- `sibling` - Equipment at the same level in the process

## Publisher Implementation Examples

### PLC Simulator Example

```javascript
const mqtt = require('mqtt');

class PLCSimulator {
    constructor(config) {
        this.config = config;
        this.client = mqtt.connect('mqtt://localhost:1883');
        this.sendMetadata();
    }
    
    sendMetadata() {
        const metadata = {
            publisherId: this.config.publisherId,
            timestamp: new Date().toISOString(),
            structureInfo: {
                equipmentId: this.config.equipmentId,
                equipmentType: this.config.equipmentType,
                location: this.config.location,
                capabilities: this.config.capabilities,
                dataTypes: ['process', 'equipment'],
                tags: {
                    version: '1.2.3',
                    manufacturer: 'Siemens',
                    model: 'S7-1500'
                }
            }
        };
        
        const topic = `enterprise/${this.config.publisherId}/metadata`;
        this.client.publish(topic, JSON.stringify(metadata), { qos: 1 });
        
        console.log(`Published metadata to ${topic}`);
    }
}
```

### SCADA Bridge Example

```javascript
// In bridge.js - send metadata when bridge starts
function publishMetadata() {
    const devices = getConnectedDevices(); // Get list of connected devices
    
    devices.forEach(device => {
        const metadata = {
            publisherId: `scada-bridge-${device.id}`,
            timestamp: new Date().toISOString(),
            structureInfo: {
                equipmentId: device.equipmentId,
                equipmentType: device.type,
                location: device.location,
                capabilities: device.capabilities,
                dataTypes: device.dataTypes
            }
        };
        
        mqttClient.publish(`structure/${device.equipmentId}/info`, JSON.stringify(metadata));
    });
}
```

## Discovery Process Flow

1. **Publisher Startup**: When a publisher (PLC, SCADA, sensor) starts up, it sends its enterprise metadata
2. **Processor Discovery**: The payload processor receives and validates the metadata
3. **Structure Mapping**: The processor creates an internal mapping of equipmentId → enterprise structure
4. **Data Processing**: When data arrives from that equipment, the processor uses the discovered structure for transformation
5. **Flexible Output**: Data is transformed according to the configured output format using the actual enterprise structure

## Fallback Behavior

If enterprise structure is not discovered for an equipment:
- The processor will request metadata by publishing to `discovery/request/{equipmentId}`
- If no response within timeout, it uses fallback/default mappings
- Fallback data is marked with `isFallback: true` in metadata

## Benefits

1. **No Hard-coding**: No need to hard-code enterprise structure in the processor
2. **Dynamic Discovery**: New equipment is automatically discovered when it starts publishing
3. **Flexible Hierarchies**: Supports any enterprise hierarchy structure
4. **Self-Documenting**: Equipment provides its own metadata
5. **Relationship Aware**: Understanding of equipment relationships and dependencies

## Configuration

Publishers can be configured to send metadata:
- **On startup** (recommended)
- **Periodically** (for dynamic environments)  
- **On request** (respond to discovery requests)

Example publisher configuration:

```json
{
  "publisherId": "line1-plc-station3",
  "equipmentId": "LINE1_STATION3_PLC", 
  "equipmentType": "PRODUCTION_LINE",
  "location": {
    "enterprise": "ACME_Manufacturing",
    "site": "Detroit_Plant_01",
    "area": "PRODUCTION", 
    "workUnit": "Assembly_Line_1",
    "line": "LINE1"
  },
  "metadata": {
    "sendOnStartup": true,
    "sendPeriodically": true,
    "sendInterval": 3600000,
    "respondToDiscovery": true
  }
}
```