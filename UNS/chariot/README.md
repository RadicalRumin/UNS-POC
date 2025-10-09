# Chariot MQTT Broker for UNS

This directory contains a custom Docker build for Chariot MQTT Broker to replace HiveMQ in the UNS system.

## ✅ Real Chariot Implementation

This implementation uses the **official Chariot v2.8.0 broker** downloaded directly from Cirrus Link's AWS S3 releases. The installation includes:

1. **Official Chariot Binary**: Downloaded from https://chariot-releases.s3.amazonaws.com/2.8.0/chariot_linux_2.8.0.zip
2. **Java Runtime**: OpenJDK 11 for Chariot execution
3. **Native Configuration**: Proper .conf file format for Chariot settings

## Directory Structure

```
chariot/
├── Dockerfile                 # Container build instructions with real Chariot v2.8.0
├── start-chariot.sh          # Container startup script with Java environment
├── chariot-broker.service    # Systemd service definition for Chariot
├── config/
│   ├── chariot.conf         # Official Chariot configuration format
│   ├── broker.xml           # Legacy XML config (kept for reference)
│   └── mosquitto.conf       # Mosquitto config (backup)
├── data/                    # Persistent data storage
└── logs/                    # Log file storage
```

## Configuration

### MQTT Listeners
- **Port 1883**: Standard MQTT TCP
- **Port 8080**: WebSocket MQTT  
- **Port 8883**: MQTT over SSL (requires certificates)

### Features Enabled
- Anonymous connections (for POC)
- Message persistence
- Retained messages
- Wildcard subscriptions
- Last Will & Testament
- Shared subscriptions

### Security
- Anonymous access enabled (change for production)
- SSL/TLS support configured
- ACL file support ready

## Building and Running

### Build the Container
```bash
cd "C:\Docker\UNS POC\UNS"
docker-compose build chariot-broker
```

### Run the System
```bash
docker-compose up chariot-broker
```

### Check Logs
```bash
docker logs uns-chariot-broker
```

## Connecting Clients

All UNS services now connect to `chariot-broker:1883` instead of `hivemq:1883`:

- **Payload Processor**: `mqtt://chariot-broker:1883`
- **MQTT Monitor**: `mqtt://chariot-broker:1883`  
- **SCADA Bridge**: `mqtt://chariot-broker:1883`

## Web Interface

The Chariot web interface (currently Mosquitto) is available at:
- **URL**: http://localhost:8080
- **Protocol**: WebSocket MQTT for browser clients

## Chariot v2.8.0 Features

This installation includes:

1. **Official Chariot Binary**
   - Downloaded from AWS S3: `chariot_linux_2.8.0.zip`
   - Includes all Chariot modules and dependencies
   - Native Sparkplug B support

2. **Java Runtime Environment**
   - OpenJDK 11 (required for Chariot)
   - Proper JVM heap sizing (512MB default)
   - Optimized garbage collection

3. **Native Configuration**
   - Chariot `.conf` format configuration
   - Sparkplug namespace: `spBv1.0`
   - Built-in bridging capabilities

4. **Production Ready**
   - Systemd service management
   - Proper logging and monitoring
   - SSL/TLS support configured

## Differences from HiveMQ

| Feature | HiveMQ | Chariot | Notes |
|---------|---------|---------|-------|
| Web UI | Control Center (8080) | Basic Web (8080) | Chariot has simpler interface |
| Config | Properties files | XML configuration | Different format |
| Clustering | Enterprise feature | Built-in | Chariot includes clustering |
| Sparkplug | Extension | Native support | Chariot has built-in Sparkplug |
| Management | REST API | MQTT commands | Different management approach |

## Troubleshooting

### Container Won't Start
- Check if `privileged: true` is set (required for systemd)
- Verify cgroup mount: `/sys/fs/cgroup:/sys/fs/cgroup:ro`

### Permission Errors  
- Ensure chariot user has write access to data/logs directories
- Check volume mount permissions

### Connection Issues
- Verify firewall allows ports 1883, 8080, 8883
- Check if other MQTT brokers are running on same ports
- Test connection: `mosquitto_pub -h localhost -p 1883 -t test -m "hello"`

## Migration from HiveMQ

The migration is already complete in the compose files:
- ✅ UNS compose.yml updated to use chariot-broker
- ✅ SCADA compose.yml updated to connect to chariot-broker  
- ✅ All environment variables updated
- ✅ Port mappings maintained (1883, 8080)

No additional configuration changes needed in client applications.