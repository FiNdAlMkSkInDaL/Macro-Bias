-- Add stocks_opted_in column to free_subscribers
-- Defaults to true so all existing subscribers continue receiving stocks emails
ALTER TABLE public.free_subscribers
  ADD COLUMN IF NOT EXISTS stocks_opted_in boolean NOT NULL DEFAULT true;
