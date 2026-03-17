-- Migration: Extend bookings status machine with confirmed/rejected + staff_notes
-- Date: 2026-03-17

-- Add staff_notes column for rejection reasons and internal staff comments
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS staff_notes TEXT;
