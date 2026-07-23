-- ============================================================================
-- ONCOST · Phase 4 migration — Multi-image products, Loyalty program,
-- Cart RLS hardening, Support contact settings.
-- Idempotent: safe to run multiple times in Supabase SQL Editor.
-- ============================================================================

-- 1) MULTI-IMAGE PRODUCTS ----------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS image_urls jsonb DEFAULT '[]'::jsonb;

-- 2) SUPPORT CONTACT INFO (shown on complaint page) --------------------------
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS support_phone text,
  ADD COLUMN IF NOT EXISTS support_email text;

-- 3) PROFILES — loyalty balance + email (for admin customer search) ----------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS loyalty_points integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_points_earned integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_points_redeemed integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS welcome_coupon_sent_at timestamp with time zone;

-- Backfill emails from auth.users
UPDATE public.profiles p SET email = u.email
FROM auth.users u WHERE u.id = p.id AND (p.email IS NULL OR p.email = '');

-- Keep profile email in sync for new signups (email, Google OAuth, etc.)
CREATE OR REPLACE FUNCTION public.sync_profile_email()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1), 'Customer'),
    NEW.email
  )
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
DROP TRIGGER IF EXISTS trg_sync_profile_email ON auth.users;
CREATE TRIGGER trg_sync_profile_email
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_email();

-- Admin can read every profile (loyalty admin panel)
DROP POLICY IF EXISTS "Admin reads all profiles" ON public.profiles;
CREATE POLICY "Admin reads all profiles" ON public.profiles
  FOR SELECT USING (auth.email() = 'enterprisepragna@gmail.com');

-- 4) ORDERS — loyalty columns ------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS loyalty_points_redeemed integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loyalty_discount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loyalty_credited_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS loyalty_refunded_at timestamp with time zone;

-- Customers can see their own orders (by user_id OR the email they used at checkout)
DROP POLICY IF EXISTS "Users view own orders" ON public.orders;
CREATE POLICY "Users view own orders" ON public.orders
  FOR SELECT USING (auth.uid() = user_id OR lower(guest_email) = lower(auth.email()));

-- 5) LOYALTY TRANSACTIONS LEDGER ----------------------------------------------
CREATE TABLE IF NOT EXISTS public.loyalty_transactions (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id    uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  type        text NOT NULL CHECK (type IN ('earn','redeem','refund','adjust')),
  points      integer NOT NULL,          -- positive = credit, negative = debit
  note        text,
  created_by  text DEFAULT 'system',
  created_at  timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_loyalty_user    ON public.loyalty_transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_order   ON public.loyalty_transactions (order_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_created ON public.loyalty_transactions (created_at DESC);

ALTER TABLE public.loyalty_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users view own loyalty history" ON public.loyalty_transactions;
CREATE POLICY "Users view own loyalty history" ON public.loyalty_transactions
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Admin manages loyalty" ON public.loyalty_transactions;
CREATE POLICY "Admin manages loyalty" ON public.loyalty_transactions
  FOR ALL USING (auth.email() = 'enterprisepragna@gmail.com')
  WITH CHECK (auth.email() = 'enterprisepragna@gmail.com');

-- Balance maintenance trigger: every ledger insert updates the profile counters
CREATE OR REPLACE FUNCTION public.apply_loyalty_txn()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, name, loyalty_points, lifetime_points_earned, lifetime_points_redeemed)
  VALUES (
    NEW.user_id,
    COALESCE((SELECT split_part(email,'@',1) FROM auth.users WHERE id = NEW.user_id), 'Customer'),
    NEW.points,
    CASE WHEN NEW.type = 'earn' THEN NEW.points ELSE 0 END,
    CASE WHEN NEW.type = 'redeem' THEN -NEW.points ELSE 0 END
  )
  ON CONFLICT (id) DO UPDATE SET
    loyalty_points           = COALESCE(public.profiles.loyalty_points,0) + NEW.points,
    lifetime_points_earned   = COALESCE(public.profiles.lifetime_points_earned,0) +
                               CASE WHEN NEW.type = 'earn' THEN NEW.points ELSE 0 END,
    lifetime_points_redeemed = COALESCE(public.profiles.lifetime_points_redeemed,0) +
                               CASE WHEN NEW.type = 'redeem' THEN -NEW.points
                                    WHEN NEW.type = 'refund' THEN -NEW.points
                                    ELSE 0 END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
DROP TRIGGER IF EXISTS trg_apply_loyalty_txn ON public.loyalty_transactions;
CREATE TRIGGER trg_apply_loyalty_txn
  AFTER INSERT ON public.loyalty_transactions
  FOR EACH ROW EXECUTE FUNCTION public.apply_loyalty_txn();

-- 6) AUTO-EARN ON DELIVERY: ₹10 spent = 1 point --------------------------------
CREATE OR REPLACE FUNCTION public.credit_loyalty_on_delivery()
RETURNS trigger AS $$
DECLARE
  target_user uuid;
  pts integer;
BEGIN
  IF NEW.status = 'Delivered'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'Delivered')
     AND NEW.loyalty_credited_at IS NULL THEN
    target_user := NEW.user_id;
    IF target_user IS NULL AND NEW.guest_email IS NOT NULL THEN
      SELECT id INTO target_user FROM auth.users WHERE lower(email) = lower(NEW.guest_email) LIMIT 1;
    END IF;
    IF target_user IS NOT NULL THEN
      pts := floor(COALESCE(NEW.total_amount, 0) / 10);
      IF pts > 0 THEN
        INSERT INTO public.loyalty_transactions (user_id, order_id, type, points, note, created_by)
        VALUES (target_user, NEW.id, 'earn', pts,
                'Earned on order ' || COALESCE(NEW.ccavenue_order_id, NEW.id::text), 'system');
        NEW.loyalty_credited_at := now();
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
DROP TRIGGER IF EXISTS trg_credit_loyalty ON public.orders;
CREATE TRIGGER trg_credit_loyalty
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.credit_loyalty_on_delivery();

-- 7) CART RLS HARDENING (delete/update own rows must always work) --------------
DROP POLICY IF EXISTS "Users manage own cart" ON public.cart_items;
CREATE POLICY "Users manage own cart" ON public.cart_items
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 8) SAVED ADDRESSES (address book + checkout autofill) -------------------------
CREATE TABLE IF NOT EXISTS public.addresses (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  email       text,
  phone       text NOT NULL,
  address     text NOT NULL,
  city        text NOT NULL,
  state       text NOT NULL,
  zip         text NOT NULL,
  country     text DEFAULT 'India',
  is_default  boolean DEFAULT false,
  created_at  timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_addresses_user ON public.addresses (user_id);
ALTER TABLE public.addresses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own addresses" ON public.addresses;
CREATE POLICY "Users manage own addresses" ON public.addresses
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 9) GIFT WRAP (premium packaging, +₹50 at checkout) ----------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS gift_wrap boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS gift_wrap_charge numeric DEFAULT 0;

-- ============================================================================
-- Done. Summary:
--  • products.image_urls jsonb — up to 8 gallery images per product
--  • Loyalty: ledger table + profile balances + auto-earn trigger on Delivered
--  • Orders readable by the email used at checkout (guest → account continuity)
--  • cart_items policies fixed so customers can always update/remove items
--  • site_settings.support_phone / support_email for the complaint page
-- ============================================================================
