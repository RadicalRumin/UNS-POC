# UNS POC - Unified Namespace Architecture

This POC demonstrates a complete UNS (Unified Namespace) architecture implementing ISA-95 levels with Docker containers, featuring real-time monitoring and verification capabilities.

## Architecture Overview

The architecture uses **MQTT with HiveMQ** as the primary message broker with a **payload processor service** for data standardization

### Key Components:

1. **UNS Core** (Message Broker & Processor)
   - MQTT Broker
   - Payload Processor Service (ISA-95 standardization)
   - MQTT Monitor (real-time topic explorer and message viewer)
   - Redis (caching)
   - MongoDB (equipment data)

2. **Level 0-1 (Production Line)**
   - PLC Simulators (Line 1, Packaging, Conveyor)
   - Realistic sensor data generation with state transitions
   - Raw MQTT data publication

3. **Level 2 (SCADA) WIP**
   - Ignition Gateway with MQTT bridge
   - Real-time data visualization
   - UNS integration layer

4. **Level 3 (MES)**
   - Manufacturing Execution System with web dashboard
   - Work order management and KPI tracking
   - Production monitoring and quality metrics
   - PostgreSQL database with real-time UNS data consumption

5. **Level 4 (ERP)**
   - Enterprise Resource Planning with analytics dashboard
   - Inventory management and financial tracking
   - Executive reporting and business intelligence
   - PostgreSQL database with aggregated UNS data

## Quick Start

### Prerequisites
- Docker and Docker Compose
- At least 8GB RAM available for containers
- Ports 1883, 8080, 8088, 3001, 3002, 5432, 5433, 6379, 27017 available

### Launch the Complete System

1. **Start UNS Core Infrastructure:**
   ```powershell
   cd "C:\Docker\UNS POC"
   docker-compose -f UNS/compose.yml up -d
   ```

2. **Start PLC Simulators:**
   ```powershell
   docker-compose -f "Level 0-1 LINE/compose.yml" up -d
   ```

3. **Start SCADA (Optional - persistance requires Ignition license):**
   ```powershell
   docker-compose -f "Level 2 SCADA/compose.yml" up -d
   ```

4. **Start MES System:**
   ```powershell
   docker-compose -f "Level 3 MES/compose.yml" up -d
   ```

5. **Start ERP System:**
   ```powershell
   docker-compose -f "Level 4 ERP/compose.yml" up -d
   ```

6. **Or Start Everything at Once:**
   ```powershell
   docker-compose up -d
   ```

## System Access Points

### Web Interfaces
- **HiveMQ Control Center**: http://localhost:8080 (MQTT broker monitoring)
- **MQTT Topic Explorer**: http://localhost:3003 (real-time message monitoring)
- **MES Dashboard**: http://localhost:3001 (manufacturing execution)
- **ERP Dashboard**: http://localhost:3002 (business analytics)
- **Ignition Gateway**: http://localhost:8088 (SCADA interface)

### Database Access
- **MES PostgreSQL**: localhost:5432 (mes_user/mes_password)
- **ERP PostgreSQL**: localhost:5433 (erp_user/erp_password)
- **MongoDB**: localhost:27017 (admin/password123)
- **Redis**: localhost:6379

### MQTT Topics Structure

#### Raw Data Topics (from PLCs):
```
raw/plc/line1/data
raw/plc/packaging/data
raw/plc/conveyor/data
```

#### Standardized UNS Topics:
```
uns/{AREA}/{WORK_UNIT}/equipment/status
uns/{AREA}/{WORK_UNIT}/process/parameters
uns/{AREA}/{WORK_UNIT}/quality/metrics
uns/{AREA}/{WORK_UNIT}/maintenance/status
uns/enterprise/equipment/{EQUIPMENT_ID}
```

## API Endpoints

### MQTT Monitor APIs (Port 3003)
- `GET /api/topics` - List all discovered MQTT topics
- `GET /api/messages` - Recent message history
- `GET /api/stats` - Real-time message statistics
- `GET /api/topic/{topicName}` - Specific topic details

### MES APIs (Port 3001)
- `GET /api/workorders` - View work orders
- `GET /api/production-schedule` - Production schedule
- `GET /api/quality-metrics` - Quality data
- `GET /api/equipment-status` - Equipment status
- `GET /api/kpis` - Manufacturing KPIs

### ERP APIs (Port 3002)
- `GET /api/inventory` - Inventory management
- `GET /api/orders` - Sales orders
- `GET /api/financial` - Financial overview
- `GET /api/suppliers` - Supplier management
- `GET /api/analytics` - Business analytics
- `GET /api/reports` - Executive reports

## Data Flow

1. **PLC Simulators** generate realistic machine data
2. **Payload Processor** standardizes data to ISA-95 format
3. **MES** consumes production data for manufacturing execution
4. **ERP** consumes aggregated data for business planning
5. **Historical data** stored in MongoDB for analytics

## Monitoring & Verification

### Real-time Monitoring
- **HiveMQ Control Center**: MQTT broker statistics, client connections, and message throughput
- **MQTT Topic Explorer**: Live topic discovery, message inspection, and subscription management
- **MES Dashboard**: Production KPIs, work order status, and equipment monitoring
- **ERP Dashboard**: Business analytics, inventory levels, and financial metrics

### System Health Indicators
- Green status: All components receiving and processing messages correctly
- Message rates: Raw messages (every 2-5 seconds), UNS messages (4-5x raw count)
- Topic activity: Active topics for equipment status, process parameters, quality metrics
- Client connections: PLC simulators, MES, ERP, and monitoring services all connected

## Architecture Benefits

### Why MQTT-Only vs MQTT+Kafka:
- **Simplicity**: Single message broker reduces complexity
- **Real-time**: Direct MQTT pub/sub provides low latency
- **Resource efficient**: Lower memory and CPU footprint
- **POC appropriate**: Demonstrates UNS concepts effectively

### ISA-95 Compliance:
- Proper level separation (L0-L4)
- Standardized data models
- Hierarchical namespace structure
- Equipment and process data separation

## Development & Customization

### Adding New Equipment:
1. Add new simulator to `Level 0-1 LINE/compose.yml`
2. Update payload processor mapping
3. Configure MES work order routing

### Extending Data Models:
1. Modify payload processor schemas
2. Update database schemas in MES/ERP
3. Add new MQTT topic patterns

## Verification and Testing

### Verify System Operation
1. **Check HiveMQ Control Center** (http://localhost:8080)
   - Verify MQTT clients are connected
   - Monitor message rates and throughput
   - No authentication required

2. **Use MQTT Topic Explorer** (http://localhost:3003)
   - View all active UNS topics in real-time
   - Monitor message content and transformation
   - Filter topics by area (PRODUCTION, PACKAGING, MATERIAL_HANDLING)
   - Subscribe to custom topic patterns

3. **Test MES Integration** (http://localhost:3001)
   - Verify work orders are updating with real-time data
   - Check KPI calculations and equipment status
   - Monitor production metrics from UNS messages

4. **Test ERP Integration** (http://localhost:3002)
   - Verify business analytics are receiving aggregated data
   - Check inventory updates and financial calculations
   - Monitor executive dashboards

### Expected Message Flow
- Raw PLC messages: every 2-5 seconds per simulator
- UNS standardized messages: 4-5 topics per raw message
- Total message rate: approximately 15-20 messages/second
- Active topic count: 15+ topics across all ISA-95 categories

## Troubleshooting

### Common Issues:
1. **Port conflicts**: Ensure ports 1883, 8080, 3001, 3002, 3003, 5432, 5433, 6379, 27017 are available
2. **Memory issues**: Increase Docker memory limit to 8GB minimum
3. **Network issues**: Verify Docker network "uns-network" is created
4. **Database connections**: Check PostgreSQL and MongoDB container health
5. **MQTT connectivity**: Verify HiveMQ broker is accessible on port 1883

### Diagnostic Commands:
```powershell
# Check all container status
docker-compose ps

# View specific service logs
docker-compose logs [service-name] --tail 50

# Monitor real-time logs
docker-compose logs -f

# Check network connectivity
docker network ls
docker network inspect uns-network

# Verify message flow
curl http://localhost:3003/api/payload-processor/verify
```

### Reset Everything:
```powershell
docker-compose down -v
docker system prune -f
docker network create uns-network
docker-compose up -d
```

### Performance Tuning:
- Increase Docker memory allocation for production use
- Adjust message publication intervals in PLC simulators
- Configure HiveMQ persistence and retention policies
- Optimize database connections and query performance

## Architecture Benefits

This POC provides a complete UNS architecture that demonstrates:

- Industrial data flow from PLCs through SCADA, MES, and ERP systems
- ISA-95 compliant data modeling and hierarchical organization
- MQTT-based unified namespace with payload standardization
- Comprehensive monitoring and verification capabilities
- Scalable Docker-based deployment with proper service separation
- Integration patterns for existing manufacturing systems
