ALTER TABLE sales ADD COLUMN customer_id CHAR(36) NULL, ADD CONSTRAINT fk_sales_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
