import { supabase as _supabase } from "@/integrations/supabase/client";

/**
 * Re-export supabase client as `any` to bypass TypeScript errors 
 * for tables not reflected in the auto-generated types.
 * This project primarily uses Firebase for data; Supabase is used
 * for edge functions and some legacy tables.
 */
export const supabase = _supabase as any;

export function supabaseFrom(table: string) {
  return (_supabase as any).from(table);
}
