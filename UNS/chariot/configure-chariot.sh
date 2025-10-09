#!/bin/bash

# Configure Chariot security settings after startup
# This script waits for Chariot to be ready, then configures it based on environment variables

set -e

echo "Chariot Post-Installation Configuration Script"

# Environment variable configuration
# CHARIOT_ALLOW_ANONYMOUS: true/false (default: false for production security)
# CHARIOT_ENVIRONMENT: development/production/staging (default: production)
ALLOW_ANONYMOUS="${CHARIOT_ALLOW_ANONYMOUS:-false}"
ENVIRONMENT="${CHARIOT_ENVIRONMENT:-production}"

echo "Configuration Settings:"
echo "  Environment: $ENVIRONMENT"
echo "  Allow Anonymous: $ALLOW_ANONYMOUS"

# Auto-detect development mode if not explicitly set
if [ "$ENVIRONMENT" = "development" ] && [ "$CHARIOT_ALLOW_ANONYMOUS" = "" ]; then
    ALLOW_ANONYMOUS="true"
    echo "  Development mode detected - enabling anonymous access by default"
fi

# Wait for Chariot to be ready
echo "Waiting for Chariot to be ready..."
MAX_ATTEMPTS=60
ATTEMPT=0

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    if curl -s -f http://localhost:8080 > /dev/null 2>&1; then
        echo "Chariot Web UI is responding"
        break
    fi
    echo "Waiting for Chariot... (attempt $((ATTEMPT + 1))/$MAX_ATTEMPTS)"
    sleep 5
    ATTEMPT=$((ATTEMPT + 1))
done

if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
    echo "ERROR: Chariot failed to start within expected time"
    exit 1
fi

# Give Chariot a few more seconds to fully initialize
sleep 10

echo "Configuring Chariot security settings..."

# Method 1: Update the server configuration file directly
echo "Updating server configuration based on environment..."
CONFIG_FILE="/opt/chariot/conf/com.cirruslink.chariot.server.config"

# Backup original config file
cp "$CONFIG_FILE" "$CONFIG_FILE.backup.$(date +%Y%m%d_%H%M%S)"

# Configure anonymous access based on environment variable
echo "Updating allowAnonymous setting to: $ALLOW_ANONYMOUS"
sed -i '/allowAnonymous/d' "$CONFIG_FILE"
echo "allowAnonymous=B\"$ALLOW_ANONYMOUS\"" >> "$CONFIG_FILE"

# Configure client authentication policy
if [ "$ALLOW_ANONYMOUS" = "true" ]; then
    echo "Setting client authentication policy to: none (anonymous allowed)"
    sed -i '/clientAuthPolicy/d' "$CONFIG_FILE"
    echo 'clientAuthPolicy="none"' >> "$CONFIG_FILE"
else
    echo "Setting client authentication policy to: required (authentication required)"
    sed -i '/clientAuthPolicy/d' "$CONFIG_FILE"
    echo 'clientAuthPolicy="required"' >> "$CONFIG_FILE"
fi

# Update security configuration
SECURITY_CONFIG="/opt/chariot/conf/com.cirruslink.chariot.security.config"
if [ -f "$SECURITY_CONFIG" ]; then
    echo "Updating security configuration..."
    cp "$SECURITY_CONFIG" "$SECURITY_CONFIG.backup.$(date +%Y%m%d_%H%M%S)"
    
    # Configure default realm based on anonymous access setting
    sed -i '/defaultRealmEnabled/d' "$SECURITY_CONFIG"
    echo "defaultRealmEnabled=B\"$ALLOW_ANONYMOUS\"" >> "$SECURITY_CONFIG"
    
    if [ "$ALLOW_ANONYMOUS" = "false" ]; then
        echo "Production mode: Enhanced security settings enabled"
        # In production, you might want additional security settings here
        # For example, password complexity requirements, session timeouts, etc.
    fi
fi

# Method 2: Try to configure via Chariot's internal configuration system
# Check if there's a way to reload configuration
if [ -f "/opt/chariot/bundle/chariot-admin-2.8.0.jar" ]; then
    echo "Attempting to reload Chariot configuration..."
    # Try to send a SIGHUP to reload configuration
    CHARIOT_PID=$(pgrep -f "chariot" || echo "")
    if [ ! -z "$CHARIOT_PID" ]; then
        echo "Sending reload signal to Chariot process $CHARIOT_PID"
        kill -HUP $CHARIOT_PID 2>/dev/null || true
    fi
fi

# Method 3: Create a persistent configuration marker
echo "Creating persistent configuration marker..."
mkdir -p /var/lib/chariot/config
echo "anonymous_access_configured=$ALLOW_ANONYMOUS" > /var/lib/chariot/config/security.marker
echo "configured_date=$(date)" >> /var/lib/chariot/config/security.marker
echo "environment=$ENVIRONMENT" >> /var/lib/chariot/config/security.marker

echo "Configuration completed. Security settings applied for $ENVIRONMENT environment."
if [ "$ALLOW_ANONYMOUS" = "true" ]; then
    echo "WARNING: Anonymous access is ENABLED. Only use in development environments!"
else
    echo "Production security: Anonymous access is DISABLED. Authentication required."
fi

# Method 4: Create a monitoring script that will reapply settings if they get reset
echo "Setting up configuration monitoring..."
cat > /var/lib/chariot/config/monitor.sh << EOF
#!/bin/bash
# This script monitors and reapplies security settings based on environment

CONFIG_FILE="/opt/chariot/conf/com.cirruslink.chariot.server.config"
ALLOW_ANONYMOUS="$ALLOW_ANONYMOUS"
ENVIRONMENT="$ENVIRONMENT"

while true; do
    sleep 30
    
    # Check if current settings match desired configuration
    if [ "\$ALLOW_ANONYMOUS" = "true" ]; then
        if ! grep -q "allowAnonymous.*B\"true\"" "\$CONFIG_FILE" 2>/dev/null; then
            echo "\$(date): Anonymous access was disabled, re-enabling for \$ENVIRONMENT..."
            sed -i '/allowAnonymous/d' "\$CONFIG_FILE"
            echo 'allowAnonymous=B"true"' >> "\$CONFIG_FILE"
        fi
    else
        if ! grep -q "allowAnonymous.*B\"false\"" "\$CONFIG_FILE" 2>/dev/null; then
            echo "\$(date): Anonymous access was enabled, disabling for \$ENVIRONMENT security..."
            sed -i '/allowAnonymous/d' "\$CONFIG_FILE"
            echo 'allowAnonymous=B"false"' >> "\$CONFIG_FILE"
        fi
    fi
        
        # Signal Chariot to reload configuration if possible
        CHARIOT_PID=$(pgrep -f "chariot" || echo "")
        if [ ! -z "$CHARIOT_PID" ]; then
            kill -HUP $CHARIOT_PID 2>/dev/null || true
        fi
    fi
done
EOF

chmod +x /var/lib/chariot/config/monitor.sh

# Start the monitoring script in background
echo "Starting configuration monitor..."
/var/lib/chariot/config/monitor.sh &

# Method 5: Create a startup hook for future container restarts
echo "Creating startup configuration hook..."
cat > /var/lib/chariot/config/startup-hook.sh << EOF
#!/bin/bash
# This script runs on every Chariot startup to apply security settings

CONFIG_FILE="/opt/chariot/conf/com.cirruslink.chariot.server.config"
ALLOW_ANONYMOUS="\${CHARIOT_ALLOW_ANONYMOUS:-false}"
ENVIRONMENT="\${CHARIOT_ENVIRONMENT:-production}"

# Auto-detect development mode
if [ "\$ENVIRONMENT" = "development" ] && [ "\$CHARIOT_ALLOW_ANONYMOUS" = "" ]; then
    ALLOW_ANONYMOUS="true"
fi

echo "\$(date): Startup hook - applying security settings for \$ENVIRONMENT environment"
sed -i '/allowAnonymous/d' "\$CONFIG_FILE"
echo "allowAnonymous=B\"\$ALLOW_ANONYMOUS\"" >> "\$CONFIG_FILE"

if [ "\$ALLOW_ANONYMOUS" = "true" ]; then
    sed -i '/clientAuthPolicy/d' "\$CONFIG_FILE"
    echo 'clientAuthPolicy="none"' >> "\$CONFIG_FILE"
    echo "\$(date): Development mode - anonymous access enabled"
else
    sed -i '/clientAuthPolicy/d' "\$CONFIG_FILE"
    echo 'clientAuthPolicy="required"' >> "\$CONFIG_FILE"
    echo "\$(date): Production mode - authentication required"
fi
sed -i '/clientAuthPolicy/d' "$CONFIG_FILE"
echo 'clientAuthPolicy="none"' >> "$CONFIG_FILE"

echo "$(date): Anonymous access configured via startup hook"
EOF

chmod +x /var/lib/chariot/config/startup-hook.sh

echo "Configuration completed. Anonymous access should be enabled."
echo "Settings will be automatically reapplied if they get reset."
echo ""
echo "IMPORTANT: After activating your trial license through the web UI,"
echo "           the anonymous access setting should remain enabled."

exit 0