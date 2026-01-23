-- Migration: Add pending_receiver_user_id to sales table for Transit State handover
-- This column tracks which user the pending sales are assigned to when shift_id is NULL

ALTER TABLE sales
ADD COLUMN pending_receiver_user_id VARCHAR(36) DEFAULT NULL
AFTER shift_id;

-- Add foreign key reference (optional, for data integrity)
ALTER TABLE sales
ADD CONSTRAINT fk_pending_receiver_user
FOREIGN KEY (pending_receiver_user_id) REFERENCES users(id)
ON DELETE SET NULL ON UPDATE CASCADE;

-- Add index for efficient lookup during shift creation
CREATE INDEX idx_sales_pending_receiver ON sales (pending_receiver_user_id, shift_id, status);
