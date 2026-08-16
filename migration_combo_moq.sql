-- Migration: add MOQ, combo, and combo_moq fields to products table
-- Run once in your Supabase SQL editor

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS moq          integer DEFAULT 1;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_combo     boolean DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS combo_moq    integer;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS combo_label  text;
