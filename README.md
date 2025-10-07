# UNS POC - Unified Namespace Architecture

This POC demonstrates a complete UNS (Unified Namespace) architecture implementing ISA-95 levels with Docker containers.

## Architecture Overview

The architecture uses **MQTT with HiveMQ** as the primary message broker with a **payload processor service** for data standardization, avoiding the complexity of a dual MQTT+Kafka setup while maintaining simplicity and effectiveness for the POC.

### Key Components:

1. **UNS Core** (Message Broker & Processor)
   - HiveMQ MQTT Broker
   - Payload Processor Service (ISA-95 standardization)
   - Redis (caching)
   - MongoDB (historical data)

2. **Level 0-1 (Production Line)**
   - PLC Simulators (Line 1, Packaging, Conveyor)
   - Realistic sensor data generation

3. **Level 2 (SCADA)**
   - Ignition Gateway
   - MQTT bridge for UNS integration

4. **Level 3 (MES)**
   - Manufacturing Execution System
   - Work order management
   - Production tracking
   - PostgreSQL database

5. **Level 4 (ERP)**
   - Enterprise Resource Planning
   - Inventory management
   - Financial analytics
   - Customer/Supplier management
   - PostgreSQL database

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

3. **Start SCADA (Optional - requires Ignition license):**
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
- **HiveMQ Control Center**: http://localhost:8080
- **MES Dashboard**: http://localhost:3001
- **ERP Dashboard**: http://localhost:3002
- **Ignition Gateway**: http://localhost:8088 (if SCADA is running)

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

## Monitoring & Observability

- Equipment status in real-time via MQTT topics
- Production KPIs via MES dashboard
- Business analytics via ERP dashboard
- Raw message monitoring via HiveMQ Control Center

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

## Troubleshooting

### Common Issues:
1. **Port conflicts**: Ensure all ports are available
2. **Memory issues**: Increase Docker memory limit
3. **Network issues**: Check Docker network creation
4. **Database connections**: Verify credentials and connectivity

### Logs:
```powershell
# View specific service logs
docker-compose logs [service-name]

# View all logs
docker-compose logs -f
```

### Reset Everything:
```powershell
docker-compose down -v
docker system prune -f
docker-compose up -d
```

This POC provides a complete, working UNS architecture that demonstrates real-world industrial data flow from PLCs through SCADA, MES, and ERP systems using standardized messaging and ISA-95 principles.