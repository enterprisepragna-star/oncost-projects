-- Migration: Order Status Notifications Webhook

-- 1. Create a function to handle order status updates
CREATE OR REPLACE FUNCTION on_order_status_change()
RETURNS TRIGGER AS $$
DECLARE
  webhook_url TEXT := 'https://www.oncost.shop/api/webhooks/order-status'; 
  webhook_secret TEXT := 'YOUR_WEBHOOK_SECRET_HERE'; -- Set this in your Vercel env as ORDER_WEBHOOK_SECRET
  payload JSONB;
  request_id BIGINT;
BEGIN
  -- Only trigger if the status has changed
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    
    -- Construct the payload to match what Supabase webhooks normally send
    payload := jsonb_build_object(
      'type', 'UPDATE',
      'table', 'orders',
      'record', row_to_json(NEW),
      'old_record', row_to_json(OLD)
    );

    -- Make the HTTP POST request using pg_net extension
    -- Ensure pg_net is enabled: CREATE EXTENSION IF NOT EXISTS pg_net;
    SELECT net.http_post(
        url := webhook_url,
        body := payload,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-webhook-secret', webhook_secret
        )
    ) INTO request_id;

  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Create the trigger on the orders table
DROP TRIGGER IF EXISTS order_status_webhook ON orders;
CREATE TRIGGER order_status_webhook
  AFTER UPDATE OF status ON orders
  FOR EACH ROW
  EXECUTE FUNCTION on_order_status_change();
