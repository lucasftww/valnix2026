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
      console.error('[admin-update-product] No authorization header');
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
      console.error('[admin-update-product] Invalid user token:', userError?.message);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[admin-update-product] User ${user.id} attempting admin operation`);

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
      console.error(`[admin-update-product] User ${user.id} is NOT admin. Access denied.`);
      return new Response(
        JSON.stringify({ error: 'Forbidden - Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[admin-update-product] Admin verified: ${user.id}`);

    // Parse request body
    const body = await req.json();
    const { action, productId, data } = body;

    let result;

    switch (action) {
      case 'create':
        // Create new product
        result = await supabaseAdmin
          .from('products')
          .insert(data)
          .select()
          .single();
        break;

      case 'update':
        if (!productId) {
          return new Response(
            JSON.stringify({ error: 'Product ID required for update' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        // Update existing product
        result = await supabaseAdmin
          .from('products')
          .update({ ...data, updated_at: new Date().toISOString() })
          .eq('id', productId)
          .select()
          .single();
        break;

      case 'delete':
        if (!productId) {
          return new Response(
            JSON.stringify({ error: 'Product ID required for delete' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        // Delete product
        result = await supabaseAdmin
          .from('products')
          .delete()
          .eq('id', productId);
        break;

      case 'toggle_active':
        if (!productId) {
          return new Response(
            JSON.stringify({ error: 'Product ID required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        // Toggle product active status
        result = await supabaseAdmin
          .from('products')
          .update({ 
            is_active: data.is_active,
            updated_at: new Date().toISOString()
          })
          .eq('id', productId)
          .select()
          .single();
        break;

      case 'update_order':
        // Bulk update product display order
        if (!Array.isArray(data.updates)) {
          return new Response(
            JSON.stringify({ error: 'Updates array required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        // Update each product's display order
        for (const update of data.updates) {
          await supabaseAdmin
            .from('products')
            .update({ display_order: update.display_order })
            .eq('id', update.id);
        }
        result = { data: { success: true }, error: null };
        break;

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    if (result.error) {
      console.error(`[admin-update-product] Operation failed:`, result.error);
      return new Response(
        JSON.stringify({ error: result.error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[admin-update-product] Action '${action}' completed successfully`);

    return new Response(
      JSON.stringify({ success: true, data: result.data }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[admin-update-product] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
