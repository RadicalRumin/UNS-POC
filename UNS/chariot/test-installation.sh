#!/bin/bash

echo "Testing Chariot MQTT Broker Installation..."

# Test 1: Check if Chariot binary exists and is executable
echo "1. Checking Chariot binary..."
if [ -x "/opt/chariot/bin/chariot" ]; then
    echo "   ✅ Chariot binary found and executable"
    /opt/chariot/bin/chariot --version || echo "   ⚠️  Version check failed (normal for some Chariot versions)"
else
    echo "   ❌ Chariot binary not found or not executable"
    exit 1
fi

# Test 2: Check Java installation
echo "2. Checking Java installation..."
if java -version 2>&1 | grep -q "openjdk"; then
    echo "   ✅ Java runtime available"
    java -version 2>&1 | head -1
else
    echo "   ❌ Java runtime not found"
    exit 1
fi

# Test 3: Check configuration file
echo "3. Checking configuration..."
if [ -f "/etc/chariot/chariot.conf" ]; then
    echo "   ✅ Chariot configuration found"
    echo "   Config: $(wc -l < /etc/chariot/chariot.conf) lines"
else
    echo "   ❌ Chariot configuration not found"
    exit 1
fi

# Test 4: Check directories
echo "4. Checking directories..."
for dir in "/var/lib/chariot/data" "/var/log/chariot" "/opt/chariot"; do
    if [ -d "$dir" ]; then
        echo "   ✅ Directory exists: $dir"
    else
        echo "   ❌ Directory missing: $dir"
        exit 1
    fi
done

# Test 5: Check systemd service
echo "5. Checking systemd service..."
if [ -f "/etc/systemd/system/chariot-broker.service" ]; then
    echo "   ✅ Systemd service file found"
    systemctl status chariot-broker.service --no-pager || echo "   ℹ️  Service not running (expected)"
else
    echo "   ❌ Systemd service file not found"
    exit 1
fi

echo ""
echo "✅ All tests passed! Chariot installation appears ready."
echo ""
echo "To start Chariot:"
echo "   systemctl start chariot-broker"
echo ""
echo "To check logs:"
echo "   journalctl -u chariot-broker -f"
echo "   tail -f /var/log/chariot/broker.log"
echo ""
echo "MQTT will be available on:"
echo "   - TCP: localhost:1883"
echo "   - WebSocket: localhost:8080"