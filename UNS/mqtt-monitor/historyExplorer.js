const { MongoClient } = require('mongodb');

class HistoryExplorer {
    constructor() {
        this.mongoUrl = process.env.MONGO_URL || 'mongodb://admin:password123@mongodb:27017/uns_data?authSource=admin';
        this.mongoClient = null;
        this.db = null;
        this.isConnected = false;
    }

    async init() {
        try {
            this.mongoClient = new MongoClient(this.mongoUrl);
            await this.mongoClient.connect();
            this.db = this.mongoClient.db('uns_data');
            this.isConnected = true;
            console.log('History Explorer connected to MongoDB');
        } catch (error) {
            console.error('History Explorer MongoDB connection error:', error);
            this.isConnected = false;
        }
    }

    async getHistoricalTopics(limit = 100) {
        if (!this.isConnected) return [];
        
        try {
            const collection = this.db.collection('processed_messages');
            const pipeline = [
                {
                    $group: {
                        _id: '$topic',
                        messageCount: { $sum: 1 },
                        firstSeen: { $min: '$timestamp' },
                        lastSeen: { $max: '$timestamp' },
                        avgMessageSize: { $avg: { $strLenCP: { $toString: '$data' } } },
                        areas: { $addToSet: '$source.area' },
                        equipmentIds: { $addToSet: '$source.equipmentId' }
                    }
                },
                {
                    $sort: { messageCount: -1 }
                },
                {
                    $limit: limit
                }
            ];

            const topics = await collection.aggregate(pipeline).toArray();
            
            return topics.map(topic => ({
                name: topic._id,
                messageCount: topic.messageCount,
                firstSeen: topic.firstSeen,
                lastSeen: topic.lastSeen,
                avgMessageSize: Math.round(topic.avgMessageSize || 0),
                areas: topic.areas.filter(Boolean),
                equipmentIds: topic.equipmentIds.filter(Boolean),
                timespan: this.calculateTimespan(topic.firstSeen, topic.lastSeen)
            }));
        } catch (error) {
            console.error('Error fetching historical topics:', error);
            return [];
        }
    }

    async getTopicHistory(topicName, options = {}) {
        if (!this.isConnected) return { messages: [], stats: null };

        const {
            limit = 100,
            startDate = null,
            endDate = null,
            sortOrder = -1 // -1 for newest first, 1 for oldest first
        } = options;

        try {
            const collection = this.db.collection('processed_messages');
            const query = { topic: topicName };

            // Add date range filter if provided
            if (startDate || endDate) {
                query.timestamp = {};
                if (startDate) query.timestamp.$gte = new Date(startDate);
                if (endDate) query.timestamp.$lte = new Date(endDate);
            }

            // Get messages
            const messages = await collection
                .find(query)
                .sort({ timestamp: sortOrder })
                .limit(limit)
                .toArray();

            // Get topic statistics
            const stats = await this.getTopicStats(topicName, startDate, endDate);

            return {
                messages: messages.map(msg => ({
                    id: msg._id,
                    timestamp: msg.timestamp,
                    topic: msg.topic,
                    data: msg.data,
                    source: msg.source,
                    size: JSON.stringify(msg.data).length
                })),
                stats
            };
        } catch (error) {
            console.error('Error fetching topic history:', error);
            return { messages: [], stats: null };
        }
    }

    async getTopicStats(topicName, startDate = null, endDate = null) {
        if (!this.isConnected) return null;

        try {
            const collection = this.db.collection('processed_messages');
            const matchQuery = { topic: topicName };

            if (startDate || endDate) {
                matchQuery.timestamp = {};
                if (startDate) matchQuery.timestamp.$gte = new Date(startDate);
                if (endDate) matchQuery.timestamp.$lte = new Date(endDate);
            }

            const pipeline = [
                { $match: matchQuery },
                {
                    $group: {
                        _id: null,
                        totalMessages: { $sum: 1 },
                        firstMessage: { $min: '$timestamp' },
                        lastMessage: { $max: '$timestamp' },
                        avgSize: { $avg: { $strLenCP: { $toString: '$data' } } },
                        areas: { $addToSet: '$source.area' },
                        equipmentIds: { $addToSet: '$source.equipmentId' }
                    }
                }
            ];

            const result = await collection.aggregate(pipeline).toArray();
            if (result.length === 0) return null;

            const stats = result[0];
            const timespan = this.calculateTimespan(stats.firstMessage, stats.lastMessage);

            return {
                totalMessages: stats.totalMessages,
                firstMessage: stats.firstMessage,
                lastMessage: stats.lastMessage,
                avgMessageSize: Math.round(stats.avgSize || 0),
                timespan,
                messagesPerHour: timespan.hours > 0 ? Math.round(stats.totalMessages / timespan.hours) : 0,
                areas: stats.areas.filter(Boolean),
                equipmentIds: stats.equipmentIds.filter(Boolean)
            };
        } catch (error) {
            console.error('Error calculating topic stats:', error);
            return null;
        }
    }

    async getTimeSeriesData(topicName, options = {}) {
        if (!this.isConnected) return [];

        const {
            startDate = null,
            endDate = null,
            interval = 'hour', // 'minute', 'hour', 'day'
            dataPath = null // e.g., 'equipment.performance.efficiency'
        } = options;

        try {
            const collection = this.db.collection('processed_messages');
            const matchQuery = { topic: topicName };

            if (startDate || endDate) {
                matchQuery.timestamp = {};
                if (startDate) matchQuery.timestamp.$gte = new Date(startDate);
                if (endDate) matchQuery.timestamp.$lte = new Date(endDate);
            }

            // Create time grouping based on interval
            let dateGroup;
            switch (interval) {
                case 'minute':
                    dateGroup = {
                        year: { $year: '$timestamp' },
                        month: { $month: '$timestamp' },
                        day: { $dayOfMonth: '$timestamp' },
                        hour: { $hour: '$timestamp' },
                        minute: { $minute: '$timestamp' }
                    };
                    break;
                case 'day':
                    dateGroup = {
                        year: { $year: '$timestamp' },
                        month: { $month: '$timestamp' },
                        day: { $dayOfMonth: '$timestamp' }
                    };
                    break;
                default: // hour
                    dateGroup = {
                        year: { $year: '$timestamp' },
                        month: { $month: '$timestamp' },
                        day: { $dayOfMonth: '$timestamp' },
                        hour: { $hour: '$timestamp' }
                    };
            }

            const pipeline = [
                { $match: matchQuery },
                {
                    $group: {
                        _id: dateGroup,
                        messageCount: { $sum: 1 },
                        avgValue: dataPath ? { $avg: `$data.${dataPath}` } : null,
                        minValue: dataPath ? { $min: `$data.${dataPath}` } : null,
                        maxValue: dataPath ? { $max: `$data.${dataPath}` } : null,
                        timestamps: { $push: '$timestamp' }
                    }
                },
                {
                    $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.hour': 1, '_id.minute': 1 }
                }
            ];

            const results = await collection.aggregate(pipeline).toArray();

            return results.map(item => {
                // Reconstruct timestamp from grouped date parts
                const date = new Date(
                    item._id.year,
                    (item._id.month || 1) - 1,
                    item._id.day || 1,
                    item._id.hour || 0,
                    item._id.minute || 0
                );

                return {
                    timestamp: date,
                    messageCount: item.messageCount,
                    avgValue: item.avgValue,
                    minValue: item.minValue,
                    maxValue: item.maxValue,
                    period: this.formatPeriod(item._id, interval)
                };
            });
        } catch (error) {
            console.error('Error fetching time series data:', error);
            return [];
        }
    }

    async searchMessages(query, options = {}) {
        if (!this.isConnected) return [];

        const {
            limit = 50,
            startDate = null,
            endDate = null,
            topics = null
        } = options;

        try {
            const collection = this.db.collection('processed_messages');
            const searchQuery = {};

            // Add date range
            if (startDate || endDate) {
                searchQuery.timestamp = {};
                if (startDate) searchQuery.timestamp.$gte = new Date(startDate);
                if (endDate) searchQuery.timestamp.$lte = new Date(endDate);
            }

            // Add topic filter
            if (topics && topics.length > 0) {
                searchQuery.topic = { $in: topics };
            }

            // Add text search if query provided
            if (query && query.trim()) {
                // Search in topic name and data
                searchQuery.$or = [
                    { topic: { $regex: query, $options: 'i' } },
                    { 'data.equipment.id': { $regex: query, $options: 'i' } },
                    { 'source.equipmentId': { $regex: query, $options: 'i' } },
                    { 'source.area': { $regex: query, $options: 'i' } }
                ];
            }

            const messages = await collection
                .find(searchQuery)
                .sort({ timestamp: -1 })
                .limit(limit)
                .toArray();

            return messages.map(msg => ({
                id: msg._id,
                timestamp: msg.timestamp,
                topic: msg.topic,
                data: msg.data,
                source: msg.source,
                size: JSON.stringify(msg.data).length
            }));
        } catch (error) {
            console.error('Error searching messages:', error);
            return [];
        }
    }

    calculateTimespan(startDate, endDate) {
        if (!startDate || !endDate) return { hours: 0, days: 0, description: 'Unknown' };

        const diffMs = new Date(endDate) - new Date(startDate);
        const hours = Math.round(diffMs / (1000 * 60 * 60));
        const days = Math.round(hours / 24);

        let description;
        if (days > 1) {
            description = `${days} days`;
        } else if (hours > 1) {
            description = `${hours} hours`;
        } else {
            const minutes = Math.round(diffMs / (1000 * 60));
            description = `${minutes} minutes`;
        }

        return { hours, days, description };
    }

    formatPeriod(dateParts, interval) {
        const { year, month, day, hour, minute } = dateParts;
        
        switch (interval) {
            case 'minute':
                return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
            case 'day':
                return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            default: // hour
                return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:00`;
        }
    }

    async close() {
        if (this.mongoClient) {
            await this.mongoClient.close();
            this.isConnected = false;
            console.log('History Explorer disconnected from MongoDB');
        }
    }
}

module.exports = HistoryExplorer;