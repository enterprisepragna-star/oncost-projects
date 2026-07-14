-- =====================================================================
-- ONCOST · Automated Best Seller Promotion
-- Run this in Supabase SQL Editor
-- This trigger automatically assigns the "Best Seller" badge to a product
-- if a customer leaves a 5-star review.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.promote_bestseller()
RETURNS TRIGGER AS $$
BEGIN
  -- If the review is 5 stars and is linked to a product
  IF NEW.rating = 5 AND NEW.product_id IS NOT NULL THEN
    UPDATE public.products 
    SET badge = 'Best Seller'
    WHERE id = NEW.product_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists to allow safe re-runs
DROP TRIGGER IF EXISTS trg_promote_bestseller ON public.testimonials;

-- Create the trigger
CREATE TRIGGER trg_promote_bestseller
AFTER INSERT OR UPDATE ON public.testimonials
FOR EACH ROW
EXECUTE FUNCTION public.promote_bestseller();
