-- Initialize MES database schema

-- Work Orders table
CREATE TABLE IF NOT EXISTS work_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_code VARCHAR(50) NOT NULL,
    quantity INTEGER NOT NULL,
    priority VARCHAR(20) DEFAULT 'MEDIUM',
    equipment_id VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING',
    progress DECIMAL(5,2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP
);

-- Production Batches table
CREATE TABLE IF NOT EXISTS production_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID REFERENCES work_orders(id),
    batch_number VARCHAR(50) NOT NULL,
    planned_quantity INTEGER NOT NULL,
    actual_quantity INTEGER DEFAULT 0,
    quality_passed INTEGER DEFAULT 0,
    quality_failed INTEGER DEFAULT 0,
    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP,
    status VARCHAR(20) DEFAULT 'ACTIVE'
);

-- Equipment downtime tracking
CREATE TABLE IF NOT EXISTS equipment_downtime (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    equipment_id VARCHAR(50) NOT NULL,
    downtime_start TIMESTAMP NOT NULL,
    downtime_end TIMESTAMP,
    reason VARCHAR(100),
    category VARCHAR(50), -- MAINTENANCE, BREAKDOWN, CHANGEOVER, etc.
    duration_minutes INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_work_orders_equipment ON work_orders(equipment_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_work_orders_created ON work_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_production_batches_work_order ON production_batches(work_order_id);
CREATE INDEX IF NOT EXISTS idx_equipment_downtime_equipment ON equipment_downtime(equipment_id);
CREATE INDEX IF NOT EXISTS idx_equipment_downtime_start ON equipment_downtime(downtime_start);