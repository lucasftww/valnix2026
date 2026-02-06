import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('[admin-update-order] No authorization header');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create user client to verify the caller
    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    // Get the user from the token
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      console.error('[admin-update-order] Invalid user token:', userError?.message);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[admin-update-order] User ${user.id} attempting admin operation`);

    // Create admin client with service role for privileged operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // SERVER-SIDE ADMIN VERIFICATION - Check user_roles table
    const { data: roleData, error: roleError } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .single();

    if (roleError || !roleData) {
      console.error(`[admin-update-order] User ${user.id} is NOT admin. Access denied.`);
      return new Response(
        JSON.stringify({ error: 'Forbidden - Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[admin-update-order] Admin verified: ${user.id}`);

    // Parse request body
    const body = await req.json();
    const { action, orderId, data } = body;

    if (!orderId) {
      return new Response(
        JSON.stringify({ error: 'Order ID required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let result;

    switch (action) {
      case 'update_status':
        // Update order status
        result = await supabaseAdmin
          .from('orders')
          .update({ 
            status: data.status,
            updated_at: new Date().toISOString()
          })
          .eq('id', orderId)
          .select()
          .single();
        break;

      case 'update_payment_status':
        // Update payment status
        result = await supabaseAdmin
          .from('orders')
          .update({ 
            payment_status: data.payment_status,
            updated_at: new Date().toISOString()
          })
          .eq('id', orderId)
          .select()
          .single();
        break;

      case 'add_tracking':
        // Add tracking code
        result = await supabaseAdmin
          .from('orders')
          .update({ 
            tracking_code: data.tracking_code,
            updated_at: new Date().toISOString()
          })
          .eq('id', orderId)
          .select()
          .single();
        break;

      case 'update_delivery_code':
        // Update delivery code for order item
        if (!data.orderItemId || !data.delivery_code) {
          return new Response(
            JSON.stringify({ error: 'Order item ID and delivery code required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        result = await supabaseAdmin
          .from('order_items')
          .update({ delivery_code: data.delivery_code })
          .eq('id', data.orderItemId)
          .select()
          .single();
        break;

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    if (result.error) {
      console.error(`[admin-update-order] Operation failed:`, result.error);
      return new Response(
        JSON.stringify({ error: result.error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[admin-update-order] Action '${action}' completed for order ${orderId}`);

    return new Response(
      JSON.stringify({ success: true, data: result.data }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[admin-update-order] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
