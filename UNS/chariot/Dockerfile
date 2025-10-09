FROM ubuntu:22.04

# Avoid interactive prompts during installation
ENV DEBIAN_FRONTEND=noninteractive

# Install required dependencies for Chariot and systemd
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    gnupg \
    software-properties-common \
    systemd \
    systemd-sysv \
    dbus \
    init \
    ca-certificates \
    unzip \
    openjdk-11-jre-headless \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Configure systemd to work in container
RUN cd /lib/systemd/system/sysinit.target.wants/; \
    ls | grep -v systemd-tmpfiles-setup | xargs rm -f $1; \
    rm -f /lib/systemd/system/multi-user.target.wants/*; \
    rm -f /etc/systemd/system/*.wants/*; \
    rm -f /lib/systemd/system/local-fs.target.wants/*; \
    rm -f /lib/systemd/system/sockets.target.wants/*udev*; \
    rm -f /lib/systemd/system/sockets.target.wants/*initctl*; \
    rm -f /lib/systemd/system/basic.target.wants/*; \
    rm -f /lib/systemd/system/anaconda.target.wants/*;

# Create directories for Chariot
RUN mkdir -p /etc/chariot \
    && mkdir -p /var/lib/chariot/data \
    && mkdir -p /var/log/chariot \
    && mkdir -p /usr/local/chariot/bin

# Download and install Chariot from official ZIP release
RUN mkdir -p /tmp/chariot && \
    wget -O /tmp/chariot_linux_2.8.0.zip https://chariot-releases.s3.amazonaws.com/2.8.0/chariot_linux_2.8.0.zip && \
    cd /tmp && \
    unzip chariot_linux_2.8.0.zip && \
    ls -la && \
    mkdir -p /opt/chariot && \
    cp -r * /opt/chariot/ 2>/dev/null || true && \
    find /opt/chariot -name "chariot" -type f -exec chmod +x {} \; && \
    find /opt/chariot -name "chariot" -type f -exec ln -sf {} /usr/local/bin/chariot-broker \; && \
    rm -rf /tmp/chariot*

# Create Chariot systemd service
COPY chariot-broker.service /etc/systemd/system/chariot-broker.service
RUN systemctl enable chariot-broker.service

# Copy configuration files
COPY config/ /etc/chariot/
COPY start-chariot.sh /usr/local/bin/
COPY start-chariot-direct.sh /usr/local/bin/
COPY test-installation.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/start-chariot.sh && \
    chmod +x /usr/local/bin/start-chariot-direct.sh && \
    chmod +x /usr/local/bin/test-installation.sh

# Create chariot user
RUN useradd -r -s /bin/false chariot && \
    chown -R chariot:chariot /var/lib/chariot && \
    chown -R chariot:chariot /var/log/chariot && \
    chown -R chariot:chariot /etc/chariot

# Expose MQTT ports
EXPOSE 1883 8080 8883

# Volume mounts for persistence
VOLUME ["/var/lib/chariot/data", "/var/log/chariot", "/etc/chariot"]

# Set the stop signal for proper systemd shutdown
STOPSIGNAL SIGRTMIN+3

# Use direct startup script (no systemd)
ENTRYPOINT ["/usr/local/bin/start-chariot-direct.sh"]