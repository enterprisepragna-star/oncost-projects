-- ==========================================
-- FIX FOR: row-level security policy for table "coupons"
-- ==========================================
-- Run this in your Supabase SQL Editor

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view coupons" ON public.coupons;
CREATE POLICY "Anyone can view coupons" ON public.coupons FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can manage coupons" ON public.coupons;
CREATE POLICY "Admins can manage coupons" 
ON public.coupons 
FOR ALL 
USING ( (auth.jwt() ->> 'email') = 'enterprisepragna@gmail.com' )
WITH CHECK ( (auth.jwt() ->> 'email') = 'enterprisepragna@gmail.com' );
