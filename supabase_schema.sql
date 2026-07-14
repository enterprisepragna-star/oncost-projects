-- Supabase SQL Schema for ONCOST Front-end Wiring

-- 1. Profiles Table (Extends Supabase Auth)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  name text NOT NULL,
  phone text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Turn on RLS for Profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" 
  ON public.profiles FOR SELECT 
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" 
  ON public.profiles FOR INSERT 
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" 
  ON public.profiles FOR UPDATE 
  USING (auth.uid() = id);

-- 2. Cart Items Table
CREATE TABLE IF NOT EXISTS public.cart_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  product_id text NOT NULL,
  qty integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Turn on RLS for Cart
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;

-- Cart Policies
DROP POLICY IF EXISTS "Users can manage their own cart" ON public.cart_items;
CREATE POLICY "Users can manage their own cart" 
  ON public.cart_items FOR ALL 
  USING (auth.uid() = user_id);

-- 3. Leads (Enquiries) Table
CREATE TABLE IF NOT EXISTS public.leads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users ON DELETE CASCADE,
  product_id text,
  summary text NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Turn on RLS for Leads
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- Leads Policies
DROP POLICY IF EXISTS "Users can insert their own leads" ON public.leads;
CREATE POLICY "Users can insert their own leads" 
  ON public.leads FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own leads" ON public.leads;
CREATE POLICY "Users can view their own leads" 
  ON public.leads FOR SELECT 
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all leads" ON public.leads;
CREATE POLICY "Admins can view all leads" 
  ON public.leads FOR SELECT 
  USING (auth.email() = 'enterprisepragna@gmail.com');

DROP POLICY IF EXISTS "Admins can manage leads" ON public.leads;
CREATE POLICY "Admins can manage leads" 
  ON public.leads FOR ALL 
  USING (auth.email() = 'enterprisepragna@gmail.com');

-- 4. Products Table
CREATE TABLE IF NOT EXISTS public.products (
  id text PRIMARY KEY,
  name text NOT NULL,
  price numeric NOT NULL,
  badge text,
  category text,
  description text,
  image_url text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Turn on RLS for Products
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Products Policies
DROP POLICY IF EXISTS "Anyone can view products" ON public.products;
CREATE POLICY "Anyone can view products" 
  ON public.products FOR SELECT 
  USING (true);

DROP POLICY IF EXISTS "Admins can manage products" ON public.products;
CREATE POLICY "Admins can manage products" 
  ON public.products FOR ALL 
  USING (auth.email() = 'enterprisepragna@gmail.com');

-- Insert Dummy Products
INSERT INTO public.products (id, name, price, badge, category, description, image_url) VALUES
('brass-diya-set', 'Brass Diya Set', 149, 'Best Seller', 'Brass Collection', 'A warm traditional diya set for pooja return gifts and festive gifting.', 'https://images.unsplash.com/photo-1605806616949-1e87b487cb2a?q=80&w=800&auto=format&fit=crop'),
('decorative-tin-box', 'Decorative Tin Box', 99, 'New', 'Tin Boxes', 'Reusable decorative tin packaging for sweets, dry fruits, and party favors.', 'https://images.unsplash.com/photo-1513885535751-8b9238bf345a?q=80&w=800&auto=format&fit=crop'),
('german-silver-bowl', 'German Silver Bowl', 199, 'Premium', 'German Silver', 'A polished bowl option for elegant pooja and wedding gifting.', 'https://images.unsplash.com/photo-1610992015732-28079237cc91?q=80&w=800&auto=format&fit=crop'),
('thambulam-gift-set', 'Thambulam Gift Set', 249, 'Bulk Ready', 'Thambulam Sets', 'A complete celebration gift set ready for guest distribution.', 'https://images.unsplash.com/photo-1511285560929-80b456fea0bc?q=80&w=800&auto=format&fit=crop'),
('birthday-favor-box', 'Birthday Favor Box', 129, 'Party Pick', 'Birthday Collection', 'A cheerful birthday return gift box for kids and family parties.', 'https://images.unsplash.com/photo-1549465220-1a8b9238cd48?q=80&w=800&auto=format&fit=crop')
ON CONFLICT (id) DO NOTHING;

-- 5. Orders Table
CREATE TABLE IF NOT EXISTS public.orders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  items jsonb NOT NULL,
  total_amount numeric NOT NULL,
  status text NOT NULL DEFAULT 'Processing',
  shipping_address jsonb,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own orders" ON public.orders;
CREATE POLICY "Users can view own orders" ON public.orders FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own orders" ON public.orders;
CREATE POLICY "Users can insert own orders" ON public.orders FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Admins can manage orders" ON public.orders;
CREATE POLICY "Admins can manage orders" ON public.orders FOR ALL USING (auth.email() = 'enterprisepragna@gmail.com');

-- 6. Coupons Table
CREATE TABLE IF NOT EXISTS public.coupons (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  code text UNIQUE NOT NULL,
  discount_type text NOT NULL, -- 'percent' or 'flat'
  discount_value numeric NOT NULL,
  min_order_amount numeric DEFAULT 0,
  usage_limit integer,
  used_count integer DEFAULT 0,
  expires_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view coupons" ON public.coupons;
CREATE POLICY "Anyone can view coupons" ON public.coupons FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admins can manage coupons" ON public.coupons;
CREATE POLICY "Admins can manage coupons" ON public.coupons FOR ALL USING (auth.email() = 'enterprisepragna@gmail.com');

-- 7. Wishlists Table
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

-- 7. Sale Events Table
CREATE TABLE IF NOT EXISTS public.sale_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  banner_text text NOT NULL,
  discount_percent numeric NOT NULL,
  start_date timestamp with time zone NOT NULL,
  end_date timestamp with time zone NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);
ALTER TABLE public.sale_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view sale events" ON public.sale_events;
CREATE POLICY "Anyone can view sale events" ON public.sale_events FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admins can manage sale events" ON public.sale_events;
CREATE POLICY "Admins can manage sale events" ON public.sale_events FOR ALL USING (auth.email() = 'enterprisepragna@gmail.com');

-- 8. Testimonials Table
CREATE TABLE IF NOT EXISTS public.testimonials (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users ON DELETE CASCADE,
  customer_name text NOT NULL,
  rating integer NOT NULL,
  review_text text NOT NULL,
  status text NOT NULL DEFAULT 'Pending', -- 'Pending', 'Approved', 'Rejected'
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);
ALTER TABLE public.testimonials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view approved testimonials" ON public.testimonials;
CREATE POLICY "Anyone can view approved testimonials" ON public.testimonials FOR SELECT USING (status = 'Approved');
DROP POLICY IF EXISTS "Users can insert own testimonials" ON public.testimonials;
CREATE POLICY "Users can insert own testimonials" ON public.testimonials FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Admins can manage testimonials" ON public.testimonials;
CREATE POLICY "Admins can manage testimonials" ON public.testimonials FOR ALL USING (auth.email() = 'enterprisepragna@gmail.com');

-- 9. Categories Table
CREATE TABLE IF NOT EXISTS public.categories (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text UNIQUE NOT NULL,
  description text,
  image_url text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view categories" ON public.categories;
CREATE POLICY "Anyone can view categories" ON public.categories FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admins can manage categories" ON public.categories;
CREATE POLICY "Admins can manage categories" ON public.categories FOR ALL USING (auth.email() = 'enterprisepragna@gmail.com');

-- 10. Site Settings Table
CREATE TABLE IF NOT EXISTS public.site_settings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  site_title text,
  meta_description text,
  keywords text,
  og_image text,
  canonical_url text,
  ga_id text,
  gsc_verification text,
  robots_txt text,
  whatsapp_number text,
  whatsapp_text text,
  instagram_url text,
  facebook_url text,
  youtube_url text,
  pinterest_url text,
  twitter_url text,
  hero_images jsonb DEFAULT '[]'::jsonb,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view site settings" ON public.site_settings;
CREATE POLICY "Anyone can view site settings" ON public.site_settings FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admins can manage site settings" ON public.site_settings;
CREATE POLICY "Admins can manage site settings" ON public.site_settings FOR ALL USING (auth.email() = 'enterprisepragna@gmail.com');

-- ALTER Products Table (Add new columns)
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS offer_price numeric;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stock integer DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS status text DEFAULT 'Active';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS sku text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS seo_title text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS seo_description text;
ALTER TABLE public.testimonials ADD COLUMN IF NOT EXISTS is_verified boolean DEFAULT false;
ALTER TABLE public.testimonials ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE public.orders ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS guest_email text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS guest_phone text;

-- Webhook Trigger for Emails
-- You must deploy the edge function first, then create a webhook in the Supabase Dashboard,
-- or use the pg_net extension to call the edge function directly.
-- For simplicity, we will create a placeholder trigger that requires the pg_net extension or 
-- the Supabase Dashboard Webhooks feature to be enabled.
