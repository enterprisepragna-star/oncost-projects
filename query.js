const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://jyvmmypalshebqmnrdma.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp5dm1teXBhbHNoZWJxbW5yZG1hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwMzI0NzIsImV4cCI6MjA5NTYwODQ3Mn0.tyjjqqiZuaBguVe4yKO65ogzw_YrDQQtrDgSBz5KQTc');
async function run() {
  const { data, error } = await supabase.from('products').select('id, status').ilike('id', '%onc-012%');
  console.log('Results:', data, error);
}
run();
