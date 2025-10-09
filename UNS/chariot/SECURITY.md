# Chariot Security Configuration Guide

This guide explains how to configure Chariot MQTT broker security settings using environment variables for different deployment environments.

## Quick Start

### Development Mode (Default)
For development and testing with anonymous access:
```bash
# No configuration needed - defaults to development mode
docker-compose up -d chariot-broker
```

### Production Mode
For production deployment with authentication required:
```bash
# Copy production environment file
cp .env.production .env

# Or set environment variables directly
export CHARIOT_ENVIRONMENT=production
export CHARIOT_ALLOW_ANONYMOUS=false

# Restart Chariot
docker-compose up -d chariot-broker
```

## Environment Variables

### `CHARIOT_ENVIRONMENT`
Controls the deployment environment and default security behavior.

- **`development`** (default): Optimized for development with relaxed security
- **`production`**: Enhanced security settings, authentication required
- **`staging`**: Configurable security based on other variables

### `CHARIOT_ALLOW_ANONYMOUS`
Controls whether MQTT clients can connect without authentication.

- **`true`**: Anonymous connections allowed (⚠️ **DEVELOPMENT ONLY**)
- **`false`**: Authentication required (✅ **PRODUCTION RECOMMENDED**)
- **Auto-detection**: If not set and `CHARIOT_ENVIRONMENT=development`, defaults to `true`

## Configuration Examples

### Example 1: Development Environment
```yaml
environment:
  - CHARIOT_ENVIRONMENT=development
  - CHARIOT_ALLOW_ANONYMOUS=true
```
**Result**: Anonymous access enabled, easy testing

### Example 2: Production Environment  
```yaml
environment:
  - CHARIOT_ENVIRONMENT=production
  - CHARIOT_ALLOW_ANONYMOUS=false
```
**Result**: Authentication required, enhanced security

### Example 3: Staging Environment (Custom)
```yaml
environment:
  - CHARIOT_ENVIRONMENT=staging
  - CHARIOT_ALLOW_ANONYMOUS=false
```
**Result**: Staging with authentication enabled

## Security Recommendations

### ⚠️ Development Security Warning
**Never use anonymous access in production!** Anonymous access allows any client to connect to your MQTT broker without credentials, which is a serious security risk.

### ✅ Production Security Best Practices

1. **Set `CHARIOT_ALLOW_ANONYMOUS=false`**
2. **Use `CHARIOT_ENVIRONMENT=production`** 
3. **Configure user accounts** in Chariot web interface
4. **Use strong passwords** for MQTT client authentication
5. **Enable SSL/TLS** for encrypted connections (port 8883)
6. **Implement topic-level ACLs** for fine-grained access control

## Deployment Workflows

### Development to Production Migration

1. **Test with development settings**:
   ```bash
   CHARIOT_ENVIRONMENT=development docker-compose up -d
   ```

2. **Switch to production**:
   ```bash
   # Update .env file or export variables
   export CHARIOT_ENVIRONMENT=production
   export CHARIOT_ALLOW_ANONYMOUS=false
   
   # Restart services
   docker-compose restart chariot-broker
   ```

3. **Configure authentication**:
   - Access Chariot Web UI at http://localhost:8081
   - Activate license
   - Create user accounts
   - Update client configurations

### Container Restart Behavior
- Settings persist across container restarts
- Environment variables are re-evaluated on startup
- Automatic configuration monitoring ensures settings stay applied
- Backup files are created for configuration changes

## Troubleshooting

### Anonymous Access Not Working
1. Check environment variables: `docker exec uns-chariot-broker printenv | grep CHARIOT`
2. Verify configuration: `docker logs uns-chariot-broker | grep "Configuration Settings"`
3. Check MQTT connectivity: `docker exec uns-chariot-broker bash -c 'timeout 2 bash -c "</dev/tcp/localhost/1883"'`

### Authentication Required Unexpectedly
1. Verify `CHARIOT_ALLOW_ANONYMOUS=true` is set
2. Check if environment changed: Look for "Production mode" in logs
3. Restart container to reapply settings

### Settings Not Persisting
1. Check if monitoring process is running: `docker exec uns-chariot-broker ps aux | grep monitor`
2. Verify startup hook exists: `docker exec uns-chariot-broker ls -la /var/lib/chariot/config/`
3. Check configuration marker: `docker exec uns-chariot-broker cat /var/lib/chariot/config/security.marker`

## Configuration Files Modified

The following Chariot configuration files are automatically updated based on environment variables:

- `/opt/chariot/conf/com.cirruslink.chariot.server.config` - Main server settings
- `/opt/chariot/conf/com.cirruslink.chariot.security.config` - Security settings
- `/var/lib/chariot/config/startup-hook.sh` - Startup configuration script
- `/var/lib/chariot/config/monitor.sh` - Runtime configuration monitor

## Advanced Configuration

### Custom Security Settings
For advanced security configurations, you can extend the configuration scripts or mount custom configuration files.

### Multi-Environment Support
Use Docker Compose profiles or multiple compose files for different environments:

```bash
# Development
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# Production  
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```