#!/bin/bash

set -e

echo "Starting Chariot MQTT Broker v2.8.0..."

# Set up environment
export JAVA_HOME=/usr/lib/jvm/java-11-openjdk-amd64
export CHARIOT_HOME=/opt/chariot
export PATH=$CHARIOT_HOME/bin:$PATH

# Create necessary directories
mkdir -p /var/lib/chariot/data
mkdir -p /var/log/chariot
mkdir -p /run/systemd/system

# Set up proper permissions
chown -R chariot:chariot /var/lib/chariot
chown -R chariot:chariot /var/log/chariot
chown -R chariot:chariot /etc/chariot
chown -R chariot:chariot /opt/chariot

# Create log file
touch /var/log/chariot/broker.log
chown chariot:chariot /var/log/chariot/broker.log

# Initialize systemd environment for container
echo 'container' > /run/systemd/container

echo "Chariot Home: $CHARIOT_HOME"
echo "Java Home: $JAVA_HOME"
echo "Config: /etc/chariot/chariot.conf"

# Start systemd as PID 1 with Chariot service
exec /lib/systemd/systemd --system --unit=chariot-broker.service