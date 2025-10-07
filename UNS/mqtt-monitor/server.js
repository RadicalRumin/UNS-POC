const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mqtt = require('mqtt');
const cors = require('cors');
const path = require('path');
const HistoryExplorer = require('./historyExplorer');

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
const mqttClient = mqtt.connect('mqtt://hivemq:1883', {
    clientId: 'mqtt-monitor-' + Math.random().toString(16).substr(2, 8)
});

// Topic and message tracking with memory limits
let topics = new Map();
let messageHistory = [];
let connectedClients = new Set();
let messageStats = {
    totalMessages: 0,
    messagesPerSecond: 0,
    lastMinuteMessages: []
};

// Memory management configuration
const MAX_MESSAGE_HISTORY = 500; // Reduced from 1000
const MAX_TOPICS = 100;
const MAX_LAST_MINUTE_MESSAGES = 1000;
const CLEANUP_INTERVAL = 30000; // 30 seconds
const TOPIC_CLEANUP_THRESHOLD = 300000; // 5 minutes inactive

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

// Periodic cleanup to prevent memory leaks
setInterval(() => {
    try {
        // Clean up inactive topics
        const now = new Date();
        const topicsToDelete = [];
        
        for (const [topicName, topicInfo] of topics.entries()) {
            if (now - new Date(topicInfo.lastSeen) > TOPIC_CLEANUP_THRESHOLD) {
                topicsToDelete.push(topicName);
            }
        }
        
        topicsToDelete.forEach(topic => topics.delete(topic));
        
        // Limit total number of topics
        if (topics.size > MAX_TOPICS) {
            const sortedTopics = Array.from(topics.entries())
                .sort((a, b) => new Date(b[1].lastSeen) - new Date(a[1].lastSeen));
            
            topics.clear();
            sortedTopics.slice(0, MAX_TOPICS).forEach(([name, info]) => {
                topics.set(name, info);
            });
        }
        
        // Cleanup old message history
        const tenMinutesAgo = new Date(now.getTime() - 600000);
        messageHistory = messageHistory.filter(msg => new Date(msg.timestamp) > tenMinutesAgo);
        
        // Force garbage collection hint
        if (global.gc) {
            global.gc();
        }
        
        console.log(`Cleanup complete: ${topics.size} topics, ${messageHistory.length} messages in history`);
    } catch (error) {
        console.error('Cleanup error:', error);
    }
}, CLEANUP_INTERVAL);

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
    
    // Update message history (keep limited messages)
    const messageRecord = {
        id: Date.now() + Math.random(),
        topic,
        message: parsedMessage,
        timestamp,
        size: message.length
    };
    
    messageHistory.unshift(messageRecord);
    if (messageHistory.length > MAX_MESSAGE_HISTORY) {
        messageHistory = messageHistory.slice(0, MAX_MESSAGE_HISTORY);
    }
    
    // Update stats with proper cleanup
    messageStats.totalMessages++;
    messageStats.lastMinuteMessages.push(timestamp);
    
    // Limit lastMinuteMessages array size to prevent memory leak
    if (messageStats.lastMinuteMessages.length > MAX_LAST_MINUTE_MESSAGES) {
        messageStats.lastMinuteMessages = messageStats.lastMinuteMessages.slice(-600); // Keep last 10 minutes
    }
    
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

// WebSocket connection handling with memory management
io.on('connection', (socket) => {
    console.log('Client connected to MQTT monitor');
    connectedClients.add(socket.id);
    
    // Send current topics and recent messages (limited to prevent memory issues)
    const topicsArray = Array.from(topics.entries()).map(([name, info]) => ({name, ...info}));
    socket.emit('topics', topicsArray.slice(0, 50)); // Limit topics sent
    socket.emit('messages', messageHistory.slice(0, 50)); // Limit messages sent
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

// Initialize History Explorer
const historyExplorer = new HistoryExplorer();
historyExplorer.init().catch(error => {
    console.error('Failed to initialize History Explorer:', error);
});

// History Explorer API routes
app.get('/api/history/topics', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const topics = await historyExplorer.getHistoricalTopics(limit);
        res.json(topics);
    } catch (error) {
        console.error('Error fetching historical topics:', error);
        res.status(500).json({ error: 'Failed to fetch historical topics' });
    }
});

app.get('/api/history/topic/:topicName', async (req, res) => {
    try {
        const topicName = req.params.topicName;
        const options = {
            limit: parseInt(req.query.limit) || 100,
            startDate: req.query.startDate || null,
            endDate: req.query.endDate || null,
            sortOrder: parseInt(req.query.sortOrder) || -1
        };
        
        const result = await historyExplorer.getTopicHistory(topicName, options);
        res.json(result);
    } catch (error) {
        console.error('Error fetching topic history:', error);
        res.status(500).json({ error: 'Failed to fetch topic history' });
    }
});

app.get('/api/history/timeseries/:topicName', async (req, res) => {
    try {
        const topicName = req.params.topicName;
        const options = {
            startDate: req.query.startDate || null,
            endDate: req.query.endDate || null,
            interval: req.query.interval || 'hour',
            dataPath: req.query.dataPath || null
        };
        
        const data = await historyExplorer.getTimeSeriesData(topicName, options);
        res.json(data);
    } catch (error) {
        console.error('Error fetching time series data:', error);
        res.status(500).json({ error: 'Failed to fetch time series data' });
    }
});

app.get('/api/history/search', async (req, res) => {
    try {
        const query = req.query.q || '';
        const options = {
            limit: parseInt(req.query.limit) || 50,
            startDate: req.query.startDate || null,
            endDate: req.query.endDate || null,
            topics: req.query.topics ? req.query.topics.split(',') : null
        };
        
        const messages = await historyExplorer.searchMessages(query, options);
        res.json(messages);
    } catch (error) {
        console.error('Error searching historical messages:', error);
        res.status(500).json({ error: 'Failed to search messages' });
    }
});

// Serve the main dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve the history explorer page
app.get('/history', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'history.html'));
});

// Memory monitoring
setInterval(() => {
    const memUsage = process.memoryUsage();
    const memUsageMB = {
        rss: Math.round(memUsage.rss / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024)
    };
    
    console.log(`Memory usage: RSS=${memUsageMB.rss}MB, Heap=${memUsageMB.heapUsed}/${memUsageMB.heapTotal}MB, Topics=${topics.size}, Messages=${messageHistory.length}`);
    
    // Emergency cleanup if memory usage is too high
    if (memUsageMB.heapUsed > 200) { // 200MB limit
        console.log('Emergency cleanup triggered due to high memory usage');
        messageHistory = messageHistory.slice(0, 100);
        
        // Keep only most recent topics
        if (topics.size > 20) {
            const sortedTopics = Array.from(topics.entries())
                .sort((a, b) => new Date(b[1].lastSeen) - new Date(a[1].lastSeen));
            
            topics.clear();
            sortedTopics.slice(0, 20).forEach(([name, info]) => {
                topics.set(name, info);
            });
        }
        
        if (global.gc) {
            global.gc();
        }
    }
}, 60000); // Check every minute

const PORT = process.env.PORT || 3003;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`MQTT Monitor running on http://0.0.0.0:${PORT} with memory management enabled`);
});

process.on('SIGINT', () => {
    console.log('Shutting down MQTT Monitor...');
    mqttClient.end();
    historyExplorer.close();
    server.close();
    process.exit(0);
});