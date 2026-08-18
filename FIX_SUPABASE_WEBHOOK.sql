-- ==============================================================================
-- FIX FOR: Update failed: schema "net" does not exist
-- ==============================================================================
-- Run this in your Supabase SQL Editor to permanently fix the error!
--
-- WHY IT HAPPENED: 
-- You set up a Database Webhook to send emails when an order's status changes.
-- However, Supabase Webhooks require a background extension called "pg_net" to 
-- actually send the internet request. Since "pg_net" is missing or turned off 
-- in your database, every time you try to change an order status, the database 
-- tries to send the webhook, crashes, and cancels your order update!
--
-- This script safely turns "pg_net" back on so your webhooks (and emails) work.
-- ==============================================================================

-- 1. Enable the pg_net extension
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;

-- If your webhook specifically looks for the "net" schema instead of "extensions",
-- we create it here just in case to guarantee the error disappears:
CREATE SCHEMA IF NOT EXISTS net;
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA net;
