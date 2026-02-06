import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.86.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verificar autenticação do usuário
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'No authorization header' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Cliente com token do usuário para verificar se é admin
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Obter usuário atual
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      console.error('Auth error:', userError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    // Cliente admin para verificar role e listar usuários
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Verificar se o usuário é admin
    const { data: roleData, error: roleError } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .single();

    if (roleError || !roleData) {
      console.error('Role check failed:', roleError);
      return new Response(
        JSON.stringify({ error: 'Forbidden - Admin access required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
      );
    }

    console.log('Admin verified, fetching users...');

    // Listar todos os usuários usando service_role_key
    const { data: authUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (listError) {
      console.error('Error listing users:', listError);
      throw listError;
    }

    // Buscar perfis e estatísticas de pedidos
    const usersWithData = await Promise.all(
      authUsers.users.map(async (authUser) => {
        // Buscar perfil
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("phone, full_name")
          .eq("id", authUser.id)
          .single();

        // Buscar estatísticas de pedidos
        const { data: orders } = await supabaseAdmin
          .from("orders")
          .select("total_amount, created_at")
          .eq("user_id", authUser.id)
          .eq("payment_status", "paid")
          .order("created_at", { ascending: false });

        const totalOrders = orders?.length || 0;
        const totalSpent = orders?.reduce((sum, order) => sum + Number(order.total_amount), 0) || 0;
        const lastOrderDate = orders?.[0]?.created_at;

        return {
          id: authUser.id,
          email: authUser.email || "",
          created_at: authUser.created_at,
          phone: profile?.phone,
          full_name: profile?.full_name,
          last_order_date: lastOrderDate,
          total_orders: totalOrders,
          total_spent: totalSpent,
        };
      })
    );

    // Ordenar por data de criação (mais recentes primeiro)
    usersWithData.sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    console.log(`Returning ${usersWithData.length} users`);

    return new Response(
      JSON.stringify({ users: usersWithData }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error: any) {
    console.error('Error in get-admin-users:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
