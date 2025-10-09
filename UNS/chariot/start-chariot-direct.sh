#!/bin/bash

set -e

echo "Starting Chariot MQTT Broker v2.8.0..."

# Navigate to Chariot directory
cd /opt/chariot

# Set up environment
export CHARIOT_HOME=/opt/chariot

echo "Environment Setup:"
echo "  CHARIOT_HOME: $CHARIOT_HOME" 
echo "  Current Directory: $(pwd)"

# Make scripts executable
chmod +x *.sh 2>/dev/null || true
chmod +x yajsw/bin/*.sh 2>/dev/null || true

# Run Chariot's installation process (this extracts Java and sets up everything)
echo "Running Chariot installation..."
./install.sh || echo "Installation completed or failed"

# Check installation status after install
echo "Checking Chariot installation status..."
./status.sh

# Run startup configuration hook if it exists
if [ -f "/var/lib/chariot/config/startup-hook.sh" ]; then
    echo "Running startup configuration hook..."
    /var/lib/chariot/config/startup-hook.sh
fi

# Start configuration script in background
echo "Starting post-configuration script in background..."
/usr/local/bin/configure-chariot.sh &

# For containers, run in console mode instead of daemon mode
echo "Starting Chariot in console mode (better for containers)..."
exec ./yajsw/bin/runConsole.sh

