-- ====================================================================
-- Bali Tower Call - Employee Mock Data & Validation Schema
-- Database Target: jds3_db (schema: public)
-- ====================================================================

-- 1. Create table for registered company employees
CREATE TABLE IF NOT EXISTS public.balicall_employees (
    employee_id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    email VARCHAR(128) UNIQUE,
    department VARCHAR(64) NOT NULL,
    position VARCHAR(64) NOT NULL,
    status VARCHAR(32) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for speedy department and status lookups
CREATE INDEX IF NOT EXISTS idx_balicall_employees_dept ON public.balicall_employees(department);
CREATE INDEX IF NOT EXISTS idx_balicall_employees_status ON public.balicall_employees(status);

-- 2. Insert mock employee data for Bali Tower operations
INSERT INTO public.balicall_employees (employee_id, name, email, department, position, status)
VALUES
    ('BT-10492', 'Rafli Aditya', 'rafli.aditya@balitower.co.id', 'NOC & Core Network', 'Network Operations Engineer', 'active'),
    ('BT-10214', 'Budi Santoso', 'budi.santoso@balitower.co.id', 'Field Transmission', 'Transmission Field Specialist', 'active'),
    ('BT-10883', 'Siti Rahma', 'siti.rahma@balitower.co.id', 'Project Management', 'Project Coordinator', 'active'),
    ('BT-10550', 'Agus Pratama', 'agus.pratama@balitower.co.id', 'Fiber Infrastructure', 'Fiber Optic Splicing Lead', 'active'),
    ('BT-10101', 'Eko Prasetyo', 'eko.prasetyo@balitower.co.id', 'Tower Maintenance', 'Site Inspector', 'active'),
    ('BT-10332', 'Dewi Lestari', 'dewi.lestari@balitower.co.id', 'Radio Frequency', 'RF Planning & Optimization', 'active'),
    ('BT-10771', 'Hendra Wijaya', 'hendra.wijaya@balitower.co.id', 'Power & Electrical', 'Power & Genset Technician', 'active'),
    ('BT-10999', 'Linda Kusuma', 'linda.kusuma@balitower.co.id', 'IT Security & NOC', 'Security Operations Analyst', 'active')
ON CONFLICT (employee_id) DO UPDATE SET
    name = EXCLUDED.name,
    email = EXCLUDED.email,
    department = EXCLUDED.department,
    position = EXCLUDED.position,
    status = EXCLUDED.status;

-- 3. Verify inserted employees
SELECT employee_id, name, department, position, status, created_at 
FROM public.balicall_employees
ORDER BY employee_id ASC;

-- 4. Sample test: Check if a specific employee ID is valid and active (Used by call application)
SELECT employee_id, name, department, status
FROM public.balicall_employees
WHERE employee_id = 'BT-10492' AND status = 'active';
