const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mqtt = require('mqtt');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MQTT client setup
const mqttClient = mqtt.connect('mqtt://chariot-broker:1883', {
    clientId: 'mqtt-monitor-' + Math.random().toString(16).substr(2, 8)
});

// Topic and message tracking
let topics = new Map();
let messageHistory = [];
let connectedClients = new Set();
let messageStats = {
    totalMessages: 0,
    messagesPerSecond: 0,
    lastMinuteMessages: []
};

// Subscribe to all UNS topics
mqttClient.on('connect', () => {
    console.log('MQTT Monitor connected to broker');
    mqttClient.subscribe('uns/#', (err) => {
        if (err) {
            console.error('Failed to subscribe to UNS topics:', err);
        } else {
            console.log('Subscribed to all UNS topics (uns/#)');
        }
    });
    
    // Also subscribe to system topics for broker stats
    mqttClient.subscribe('$SYS/#', (err) => {
        if (!err) {
            console.log('Subscribed to system topics ($SYS/#)');
        }
    });

    // Also subscribe to raw topics for PLC simulators
    mqttClient.subscribe('raw/#', (err) => {
        if (!err) {
            console.log('Subscribed to raw topics (raw/#)');
        }
    });
});

mqttClient.on('message', (topic, message) => {
    const timestamp = new Date();
    const messageStr = message.toString();
    let parsedMessage;
    
    try {
        parsedMessage = JSON.parse(messageStr);
    } catch (e) {
        parsedMessage = messageStr;
    }
    
    // Update topic statistics
    if (!topics.has(topic)) {
        topics.set(topic, {
            name: topic,
            messageCount: 0,
            lastMessage: null,
            lastSeen: timestamp,
            subscribers: 0,
            avgMessageSize: 0,
            totalBytes: 0
        });
    }
    
    const topicInfo = topics.get(topic);
    topicInfo.messageCount++;
    topicInfo.lastMessage = parsedMessage;
    topicInfo.lastSeen = timestamp;
    topicInfo.totalBytes += message.length;
    topicInfo.avgMessageSize = Math.round(topicInfo.totalBytes / topicInfo.messageCount);
    
    // Update message history (keep last 1000 messages)
    const messageRecord = {
        id: Date.now() + Math.random(),
        topic,
        message: parsedMessage,
        timestamp,
        size: message.length
    };
    
    messageHistory.unshift(messageRecord);
    if (messageHistory.length > 1000) {
        messageHistory = messageHistory.slice(0, 1000);
    }
    
    // Update stats
    messageStats.totalMessages++;
    messageStats.lastMinuteMessages.push(timestamp);
    
    // Clean up old messages from last minute counter
    const oneMinuteAgo = new Date(timestamp.getTime() - 60000);
    messageStats.lastMinuteMessages = messageStats.lastMinuteMessages.filter(
        time => time > oneMinuteAgo
    );
    messageStats.messagesPerSecond = Math.round(messageStats.lastMinuteMessages.length / 60);
    
    // Emit to all connected websocket clients
    io.emit('message', messageRecord);
    io.emit('topicUpdate', {
        topic,
        info: topicInfo
    });
    io.emit('statsUpdate', messageStats);
});

// WebSocket connection handling
io.on('connection', (socket) => {
    console.log('Client connected to MQTT monitor');
    connectedClients.add(socket.id);
    
    // Send current topics and recent messages
    socket.emit('topics', Array.from(topics.entries()).map(([name, info]) => ({name, ...info})));
    socket.emit('messages', messageHistory.slice(0, 100)); // Send last 100 messages
    socket.emit('stats', messageStats);
    
    socket.on('subscribe', (topic) => {
        console.log(`Client subscribing to topic: ${topic}`);
        mqttClient.subscribe(topic, (err) => {
            if (err) {
                socket.emit('error', `Failed to subscribe to ${topic}: ${err.message}`);
            } else {
                socket.emit('subscribed', topic);
            }
        });
    });
    
    socket.on('unsubscribe', (topic) => {
        console.log(`Client unsubscribing from topic: ${topic}`);
        mqttClient.unsubscribe(topic, (err) => {
            if (err) {
                socket.emit('error', `Failed to unsubscribe from ${topic}: ${err.message}`);
            } else {
                socket.emit('unsubscribed', topic);
            }
        });
    });
    
    socket.on('disconnect', () => {
        console.log('Client disconnected from MQTT monitor');
        connectedClients.delete(socket.id);
    });
});

// REST API endpoints
app.get('/api/topics', (req, res) => {
    const topicsArray = Array.from(topics.entries()).map(([name, info]) => ({
        name,
        ...info
    }));
    res.json(topicsArray);
});

app.get('/api/messages', (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    const topic = req.query.topic;
    
    let messages = messageHistory;
    if (topic) {
        messages = messages.filter(msg => msg.topic === topic);
    }
    
    res.json(messages.slice(0, limit));
});

app.get('/api/stats', (req, res) => {
    res.json({
        ...messageStats,
        topicCount: topics.size,
        connectedClients: connectedClients.size
    });
});

app.get('/api/topic/:topicName', (req, res) => {
    const topicName = req.params.topicName;
    const topicInfo = topics.get(topicName);
    
    if (!topicInfo) {
        return res.status(404).json({ error: 'Topic not found' });
    }
    
    const topicMessages = messageHistory.filter(msg => msg.topic === topicName);
    
    res.json({
        topic: topicName,
        info: topicInfo,
        recentMessages: topicMessages.slice(0, 50)
    });
});

// Serve the main dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3003;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`MQTT Monitor running on http://0.0.0.0:${PORT}`);
});

process.on('SIGINT', () => {
    console.log('Shutting down MQTT Monitor...');
    mqttClient.end();
    server.close();
    process.exit(0);
});