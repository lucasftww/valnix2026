-- Add balance column to profiles table
ALTER TABLE public.profiles 
ADD COLUMN balance NUMERIC DEFAULT 0;

-- Update balance for the test user
UPDATE public.profiles 
SET balance = 100.00 
WHERE id = '3e5d9e40-1669-440a-99a2-bd5353b1a6d3';