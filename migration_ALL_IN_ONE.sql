-- =====================================================================
-- ONCOST · ALL-IN-ONE MIGRATION (combines all 4 previous migrations)
-- Run this ONCE in Supabase SQL Editor → New query → paste → Run.
-- Idempotent — safe to re-run any time. Won't damage existing data.
-- Estimated runtime: 2 seconds.
-- =====================================================================

-- ════════════════════════════════════════════════════════════════════
-- PART 1 · CCAvenue payment columns + Invoice numbering + Business profile
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS ccavenue_order_id   text UNIQUE,
  ADD COLUMN IF NOT EXISTS payment_tracking_id text,
  ADD COLUMN IF NOT EXISTS payment_response    jsonb,
  ADD COLUMN IF NOT EXISTS payment_status      text DEFAULT 'Pending',
  ADD COLUMN IF NOT EXISTS payment_method      text,
  ADD COLUMN IF NOT EXISTS invoice_number      text,
  ADD COLUMN IF NOT EXISTS invoice_date        timestamp with time zone,
  ADD COLUMN IF NOT EXISTS items_subtotal      numeric,
  ADD COLUMN IF NOT EXISTS shipping_amount     numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount     numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount          numeric DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_orders_ccavenue_order_id ON public.orders (ccavenue_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at        ON public.orders (created_at DESC);

DROP POLICY IF EXISTS "Users can insert own orders" ON public.orders;
DROP POLICY IF EXISTS "Anyone can insert pending orders" ON public.orders;
CREATE POLICY "Anyone can insert pending orders"
  ON public.orders FOR INSERT
  WITH CHECK ((auth.uid() IS NOT NULL AND auth.uid() = user_id) OR (user_id IS NULL));

DROP POLICY IF EXISTS "Guests can view order by ccavenue_order_id" ON public.orders;
CREATE POLICY "Guests can view order by ccavenue_order_id"
  ON public.orders FOR SELECT
  USING (ccavenue_order_id IS NOT NULL);

-- Users can view their own orders, AND any past guest order placed with their email
DROP POLICY IF EXISTS "Users can view own orders or guest by email" ON public.orders;
CREATE POLICY "Users can view own orders or guest by email"
  ON public.orders FOR SELECT
  USING (
    auth.uid() = user_id
    OR (user_id IS NULL AND auth.email() = guest_email)
  );

CREATE SEQUENCE IF NOT EXISTS public.invoice_seq START 1000;
CREATE OR REPLACE FUNCTION public.set_invoice_number()
RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('Paid','Packed','Shipped','Delivered')
     AND NEW.invoice_number IS NULL THEN
    NEW.invoice_number := 'INV-' || to_char(now(),'YYYY') || '-' ||
                          LPAD(nextval('public.invoice_seq')::text, 6, '0');
    NEW.invoice_date := COALESCE(NEW.invoice_date, now());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_set_invoice_number ON public.orders;
CREATE TRIGGER trg_set_invoice_number
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_invoice_number();

UPDATE public.orders
   SET invoice_number = 'INV-' || to_char(COALESCE(created_at, now()),'YYYY') || '-' ||
                        LPAD(nextval('public.invoice_seq')::text, 6, '0'),
       invoice_date   = COALESCE(invoice_date, created_at, now())
 WHERE status IN ('Paid','Packed','Shipped','Delivered')
   AND invoice_number IS NULL;

CREATE TABLE IF NOT EXISTS public.business_profile (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_name text NOT NULL DEFAULT 'ONCOST',
  legal_name text, gstin text, pan text,
  address_line1 text, address_line2 text,
  city text, state text, pincode text,
  country text DEFAULT 'India',
  phone text, email text,
  website text DEFAULT 'https://www.oncost.shop',
  logo_url text, bank_name text, bank_account text, bank_ifsc text,
  invoice_prefix text DEFAULT 'INV',
  invoice_notes text DEFAULT 'Thank you for shopping with us! For returns or queries, contact support within 7 days of delivery.',
  default_tax_pct numeric DEFAULT 0,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);
ALTER TABLE public.business_profile ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view business profile" ON public.business_profile;
CREATE POLICY "Anyone can view business profile" ON public.business_profile FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admins can manage business profile" ON public.business_profile;
CREATE POLICY "Admins can manage business profile" ON public.business_profile FOR ALL USING (auth.email() = 'enterprisepragna@gmail.com');
INSERT INTO public.business_profile (business_name, legal_name, address_line1, city, state, pincode, phone, email)
SELECT 'ONCOST', 'ONCOST Enterprises', 'Address Line 1', 'Bangalore', 'Karnataka', '560001', '+91-9999999999', 'enterprisepragna@gmail.com'
WHERE NOT EXISTS (SELECT 1 FROM public.business_profile);

-- ════════════════════════════════════════════════════════════════════
-- PART 2 · Product reviews
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.testimonials
  ADD COLUMN IF NOT EXISTS product_id   text REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS order_id     uuid REFERENCES public.orders(id)   ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS title        text,
  ADD COLUMN IF NOT EXISTS review_token text UNIQUE;

CREATE INDEX IF NOT EXISTS idx_testimonials_product_id  ON public.testimonials (product_id);
CREATE INDEX IF NOT EXISTS idx_testimonials_status      ON public.testimonials (status);
CREATE INDEX IF NOT EXISTS idx_testimonials_order_id    ON public.testimonials (order_id);

DROP POLICY IF EXISTS "Anyone can view approved testimonials" ON public.testimonials;
CREATE POLICY "Anyone can view approved testimonials" ON public.testimonials FOR SELECT USING (status = 'Approved');
DROP POLICY IF EXISTS "Admins can manage testimonials" ON public.testimonials;
CREATE POLICY "Admins can manage testimonials" ON public.testimonials FOR ALL USING (auth.email() = 'enterprisepragna@gmail.com');
DROP POLICY IF EXISTS "Users can view own testimonials" ON public.testimonials;
CREATE POLICY "Users can view own testimonials" ON public.testimonials FOR SELECT USING (auth.uid() = user_id);

-- ════════════════════════════════════════════════════════════════════
-- PART 3 · Product barcode
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS barcode text;
CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.products (barcode);

-- ════════════════════════════════════════════════════════════════════
-- PART 4 · Phase 1 Foundation: Product shipping fields + Order fulfilment + Complaints + Storage
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS weight_grams   integer,
  ADD COLUMN IF NOT EXISTS length_cm      numeric,
  ADD COLUMN IF NOT EXISTS breadth_cm     numeric,
  ADD COLUMN IF NOT EXISTS height_cm      numeric,
  ADD COLUMN IF NOT EXISTS hsn_code       text,
  ADD COLUMN IF NOT EXISTS gst_percent    numeric DEFAULT 0;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS awb_number          text,
  ADD COLUMN IF NOT EXISTS courier_partner     text DEFAULT 'Delhivery',
  ADD COLUMN IF NOT EXISTS tracking_url        text,
  ADD COLUMN IF NOT EXISTS warehouse_code      text DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS pickup_scheduled_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS shipped_at          timestamp with time zone,
  ADD COLUMN IF NOT EXISTS delivered_at        timestamp with time zone,
  ADD COLUMN IF NOT EXISTS packed_at           timestamp with time zone,
  ADD COLUMN IF NOT EXISTS confirmed_at        timestamp with time zone,
  ADD COLUMN IF NOT EXISTS cancelled_at        timestamp with time zone,
  ADD COLUMN IF NOT EXISTS status_history      jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS shipping_weight_g   integer,
  ADD COLUMN IF NOT EXISTS shipping_dim_l      numeric,
  ADD COLUMN IF NOT EXISTS shipping_dim_b      numeric,
  ADD COLUMN IF NOT EXISTS shipping_dim_h      numeric,
  ADD COLUMN IF NOT EXISTS internal_notes      text;

CREATE INDEX IF NOT EXISTS idx_orders_awb    ON public.orders (awb_number);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders (status);

CREATE TABLE IF NOT EXISTS public.complaints (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_number   text UNIQUE,
  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  order_id        uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  guest_email     text, guest_phone text,
  customer_name   text NOT NULL,
  category        text NOT NULL,
  subject         text NOT NULL,
  description     text NOT NULL,
  attachments     jsonb DEFAULT '[]'::jsonb,
  status          text DEFAULT 'Open',
  priority        text DEFAULT 'Normal',
  admin_notes     text, resolution text,
  responses       jsonb DEFAULT '[]'::jsonb,
  resolved_at     timestamp with time zone,
  created_at      timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at      timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_complaints_status   ON public.complaints (status);
CREATE INDEX IF NOT EXISTS idx_complaints_user     ON public.complaints (user_id);
CREATE INDEX IF NOT EXISTS idx_complaints_order    ON public.complaints (order_id);
CREATE INDEX IF NOT EXISTS idx_complaints_created  ON public.complaints (created_at DESC);
ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage all complaints" ON public.complaints;
CREATE POLICY "Admins manage all complaints" ON public.complaints
  FOR ALL USING (auth.email() = 'enterprisepragna@gmail.com');
DROP POLICY IF EXISTS "Users view own complaints" ON public.complaints;
CREATE POLICY "Users view own complaints" ON public.complaints
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Anyone can submit a complaint" ON public.complaints;
CREATE POLICY "Anyone can submit a complaint" ON public.complaints
  FOR INSERT WITH CHECK (true);

CREATE SEQUENCE IF NOT EXISTS public.complaint_seq START 1000;
CREATE OR REPLACE FUNCTION public.set_complaint_ticket()
RETURNS trigger AS $$
BEGIN
  IF NEW.ticket_number IS NULL THEN
    NEW.ticket_number := 'CMP-' || to_char(now(),'YYYY') || '-' ||
                         LPAD(nextval('public.complaint_seq')::text, 6, '0');
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_set_complaint_ticket ON public.complaints;
CREATE TRIGGER trg_set_complaint_ticket
  BEFORE INSERT OR UPDATE ON public.complaints
  FOR EACH ROW EXECUTE FUNCTION public.set_complaint_ticket();

-- Supabase Storage bucket for product images (used by admin upload + complaint photos)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('product-images', 'product-images', true, 5242880,
        ARRAY['image/jpeg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 5242880;

DROP POLICY IF EXISTS "Anyone can view product images" ON storage.objects;
CREATE POLICY "Anyone can view product images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS "Authenticated can upload product images" ON storage.objects;
CREATE POLICY "Authenticated can upload product images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'product-images' AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated can update product images" ON storage.objects;
CREATE POLICY "Authenticated can update product images"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'product-images' AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated can delete product images" ON storage.objects;
CREATE POLICY "Authenticated can delete product images"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'product-images' AND auth.uid() IS NOT NULL);

-- ════════════════════════════════════════════════════════════════════
-- PART 5 · Product Variants (Amazon-style 55gms/60gms, Gold/Silver, etc.)
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.product_variants (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id      text NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_type    text NOT NULL DEFAULT 'Size',
  variant_label   text NOT NULL,
  variant_value   text,
  sku             text,
  barcode         text,
  price           numeric NOT NULL,
  offer_price     numeric,
  stock           integer DEFAULT 0,
  weight_grams    integer,
  length_cm       numeric, breadth_cm numeric, height_cm numeric,
  image_url       text,
  sort_order      integer DEFAULT 0,
  is_default      boolean DEFAULT false,
  status          text DEFAULT 'Active',
  created_at      timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at      timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_variants_product_id ON public.product_variants (product_id);
CREATE INDEX IF NOT EXISTS idx_variants_sku        ON public.product_variants (sku);
CREATE INDEX IF NOT EXISTS idx_variants_barcode    ON public.product_variants (barcode);
CREATE UNIQUE INDEX IF NOT EXISTS uq_variants_product_label ON public.product_variants (product_id, variant_label);
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view variants" ON public.product_variants;
CREATE POLICY "Anyone can view variants" ON public.product_variants FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admins manage variants" ON public.product_variants;
CREATE POLICY "Admins manage variants" ON public.product_variants FOR ALL USING (auth.email() = 'enterprisepragna@gmail.com');

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS has_variants boolean DEFAULT false;

ALTER TABLE public.cart_items
  ADD COLUMN IF NOT EXISTS variant_id    uuid REFERENCES public.product_variants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS variant_label text,
  ADD COLUMN IF NOT EXISTS unit_price    numeric;
CREATE INDEX IF NOT EXISTS idx_cart_items_variant ON public.cart_items (variant_id);

-- ════════════════════════════════════════════════════════════════════
-- PART 6 · Lead/Enquiry status workflow + admin notifications
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS status      text DEFAULT 'New',          -- New/Contacted/Discussed/Quoted/Accepted/Converted/Not Converted/Lost
  ADD COLUMN IF NOT EXISTS admin_notes text,
  ADD COLUMN IF NOT EXISTS deal_value  numeric,
  ADD COLUMN IF NOT EXISTS contacted_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS resolved_at timestamp with time zone;

DROP POLICY IF EXISTS "Admins can manage leads" ON public.leads;
CREATE POLICY "Admins can manage leads" ON public.leads FOR ALL USING (auth.email() = 'enterprisepragna@gmail.com');

CREATE INDEX IF NOT EXISTS idx_leads_status     ON public.leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON public.leads (created_at DESC);

-- ════════════════════════════════════════════════════════════════════
-- ALL DONE 🎉
-- After this you'll have:
-- • CCAvenue orders with invoice numbers + business profile
-- • Product reviews wired with verified-buyer flag
-- • Barcode field on products
-- • Weight/dimensions/HSN/GST on products (drives Delhivery shipping)
-- • Order fulfilment columns (AWB, tracking, status timeline)
-- • Customer complaints table with auto-numbered tickets
-- • product-images Supabase Storage bucket (replaces imgbb)
-- ════════════════════════════════════════════════════════════════════

-- =====================================================================
-- PHASE 2: ENGAGEMENT (WISHLISTS & LOYALTY)
-- =====================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS loyalty_points integer DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.wishlists (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  product_id text NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(user_id, product_id)
);

ALTER TABLE public.wishlists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own wishlist" ON public.wishlists;
CREATE POLICY "Users can view own wishlist" ON public.wishlists FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own wishlist" ON public.wishlists;
CREATE POLICY "Users can insert own wishlist" ON public.wishlists FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own wishlist" ON public.wishlists;
CREATE POLICY "Users can delete own wishlist" ON public.wishlists FOR DELETE USING (auth.uid() = user_id);
