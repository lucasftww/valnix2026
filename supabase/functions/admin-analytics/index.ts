 import "jsr:@supabase/functions-js/edge-runtime.d.ts";
 import { createClient } from "jsr:@supabase/supabase-js@2";
 
 const corsHeaders = {
   "Access-Control-Allow-Origin": "*",
   "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-firebase-token",
   "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
 };
 
const FIREBASE_PROJECT_ID = "valnix";
 
 async function verifyFirebaseToken(token: string): Promise<{ uid: string; email: string } | null> {
   try {
     const parts = token.split('.');
     if (parts.length !== 3) return null;
     
     const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
     
     if (payload.exp && payload.exp < Date.now() / 1000) return null;
     if (payload.aud !== FIREBASE_PROJECT_ID) return null;
     if (!payload.iss?.includes(FIREBASE_PROJECT_ID)) return null;
     
     return { uid: payload.user_id || payload.sub, email: payload.email };
   } catch {
     return null;
   }
 }
 
  async function isUserAdmin(uid: string): Promise<boolean> {
    try {
      const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${uid}`;
      const response = await fetch(url);
      
      if (!response.ok) return false;
      
      const doc = await response.json();
      const role = doc.fields?.role?.stringValue;
      return role === 'admin';
    } catch {
      return false;
    }
  }
 
 Deno.serve(async (req) => {
   if (req.method === "OPTIONS") {
     return new Response(null, { headers: corsHeaders });
   }
 
   try {
     // Verify Firebase auth
     const firebaseToken = req.headers.get("x-firebase-token");
     if (!firebaseToken) {
       return new Response(
         JSON.stringify({ error: "Firebase token required" }),
         { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     }
 
     const userData = await verifyFirebaseToken(firebaseToken);
     if (!userData) {
       return new Response(
         JSON.stringify({ error: "Invalid Firebase token" }),
         { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     }
 
     // Verify admin role
     const isAdmin = await isUserAdmin(userData.uid);
     if (!isAdmin) {
       return new Response(
         JSON.stringify({ error: "Admin access required" }),
         { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     }
 
     // Parse date range from query params
     const url = new URL(req.url);
     const dateRange = url.searchParams.get("dateRange") || "7d";
 
     // Use service role to bypass RLS
     const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
     const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
     
     const supabase = createClient(supabaseUrl, serviceRoleKey);
 
     // Calculate date filter
      let dateFilter = new Date();
      if (dateRange === "today") {
        dateFilter.setHours(0, 0, 0, 0);
      } else if (dateRange === "7d") {
        dateFilter.setDate(dateFilter.getDate() - 7);
      } else if (dateRange === "30d") {
        dateFilter.setDate(dateFilter.getDate() - 30);
      } else {
        dateFilter = new Date(0); // All time
      }
 
     const { data: events, error } = await supabase
       .from("analytics_events")
       .select("*")
       .gte("event_time", dateFilter.toISOString())
       .order("event_time", { ascending: false })
       .limit(10000);
 
     if (error) {
       console.error("Database error:", error);
       return new Response(
         JSON.stringify({ error: "Failed to fetch analytics" }),
         { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     }
 
     return new Response(
       JSON.stringify({ events: events || [] }),
       { headers: { ...corsHeaders, "Content-Type": "application/json" } }
     );
   } catch (error) {
     console.error("Error:", error);
     return new Response(
       JSON.stringify({ error: "Internal server error" }),
       { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
     );
   }
 });