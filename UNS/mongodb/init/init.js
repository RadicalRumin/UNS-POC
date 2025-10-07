// Initialize UNS MongoDB database
db = db.getSiblingDB('uns_data');

// Create collections
db.createCollection('equipment_data');
db.createCollection('production_data');
db.createCollection('quality_data');
db.createCollection('maintenance_data');

// Create indexes for better performance
db.equipment_data.createIndex({ "timestamp": 1 });
db.equipment_data.createIndex({ "source.equipmentId": 1 });
db.equipment_data.createIndex({ "source.area": 1 });
db.equipment_data.createIndex({ "equipment.status": 1 });

db.production_data.createIndex({ "timestamp": 1 });
db.production_data.createIndex({ "source.equipmentId": 1 });

db.quality_data.createIndex({ "timestamp": 1 });
db.quality_data.createIndex({ "equipmentId": 1 });

db.maintenance_data.createIndex({ "timestamp": 1 });
db.maintenance_data.createIndex({ "equipmentId": 1 });

print('UNS MongoDB database initialized successfully');