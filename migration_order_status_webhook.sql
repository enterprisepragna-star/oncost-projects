-- ============================================================
-- Order Status Email Notifications — Supabase Webhook Setup
-- ============================================================
-- Run this SQL first, then follow the manual steps below.
-- ============================================================

-- 1. Make sure orders table has the columns the webhook needs
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS user_email          text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS logistics_partner   text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS awb_number          text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tracking_url        text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_number      text;

-- ============================================================
-- MANUAL STEPS (do these in Supabase Dashboard)
-- ============================================================
--
-- Step 1: Add Vercel Environment Variables
--   Go to: Vercel → Your Project → Settings → Environment Variables
--   Add these:
--
--   RESEND_API_KEY          = re_xxxxxxxxxxxxxxx   (from resend.com)
--   RESEND_FROM_EMAIL       = enterprisepragna@oncost.shop
--   ADMIN_EMAIL             = enterprisepragna@oncost.shop
--   ORDER_WEBHOOK_SECRET    = (any random string, e.g. oncost_wh_2026)
--   SITE_URL                = https://www.oncost.shop
--
-- Step 2: Verify oncost.shop domain in Resend
--   Go to: resend.com → Domains → Add Domain → oncost.shop
--   Add the DNS TXT/MX records they give you in your domain registrar
--   Wait for verification (usually < 5 minutes)
--
-- Step 3: Create Database Webhook in Supabase
--   Go to: Supabase Dashboard → Database → Webhooks → Create a new webhook
--
--   Name:    order-status-email
--   Table:   orders
--   Events:  ✅ INSERT   ✅ UPDATE   (uncheck DELETE)
--   Method:  POST
--   URL:     https://www.oncost.shop/api/webhooks/order-status
--   Headers:
--     Content-Type      application/json
--     x-webhook-secret  <same value as ORDER_WEBHOOK_SECRET above>
--
-- Step 4: Redeploy on Vercel (so new env vars take effect)
--
-- ============================================================
-- WHAT EMAILS ARE SENT
-- ============================================================
--
--  Trigger              → Email to customer
--  ─────────────────────────────────────────────────────────
--  New order (INSERT)   → "✓ Order confirmed" with order summary
--  Status = Confirmed   → "Your order is being processed"
--  Status = Packed      → "Your order is packed, awaiting pickup"
--  Status = Shipped     → "📦 Your order is on the way" + tracking
--  Status = Out for Delivery → "Your order arrives today!"
--  Status = Delivered   → "Order delivered — leave a review"
--  Status = Cancelled   → "Your order has been cancelled"
--
--  + Admin (you) gets a "🛒 New order" email for every paid order.
--
-- ============================================================
