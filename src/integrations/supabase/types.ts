// ============================================================================
// VALNIX — Supabase Database types
// Hand-written from supabase/migrations/20260516000000_initial_schema.sql
// Regenerate with `supabase gen types typescript --project-id <id>` after
// any future schema change.
// ============================================================================

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type OrderStatusEnum = 'pending' | 'processing' | 'completed' | 'cancelled';
export type PaymentStatusEnum = 'pending' | 'paid' | 'failed' | 'expired' | 'refunded';

export type Database = {
  __InternalSupabase: { PostgrestVersion: '14.1' };
  public: {
    Tables: {
      categories: {
        Row: {
          id: string;
          name: string;
          slug: string;
          description: string | null;
          image_url: string | null;
          icon_url: string | null;
          parent_id: string | null;
          is_active: boolean;
          display_order: number;
          show_on_homepage: boolean | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['categories']['Row'], 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['categories']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'categories_parent_id_fkey';
            columns: ['parent_id'];
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
        ];
      };
      products: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          rich_description: string | null;
          price: number;
          old_price: number | null;
          discount: number | null;
          image_url: string | null;
          icon_url: string | null;
          category: string;
          is_active: boolean;
          featured: boolean;
          is_featured_in_category: boolean;
          display_order: number;
          stock: number | null;
          sold: number | null;
          delivery_type: string | null;
          delivery_info: string | null;
          auto_delivery_codes: string[] | null;
          instructions: string | null;
          terms_conditions: string | null;
          video_url: string | null;
          product_type: string | null;
          offer_hash: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['products']['Row'], 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['products']['Insert']>;
        Relationships: [];
      };
      orders: {
        Row: {
          id: string;
          user_id: string | null;
          guest_hash: string | null;
          customer_name: string;
          customer_email: string | null;
          customer_phone: string | null;
          customer_document: string | null;
          total_amount: number;
          status: OrderStatusEnum;
          payment_status: PaymentStatusEnum;
          payment_method: string | null;
          notes: string | null;
          flowpay_charge_id: string | null;
          pix_code: string | null;
          pix_expires_at: string | null;
          fbc: string | null;
          fbp: string | null;
          event_source_url: string | null;
          utm_source: string | null;
          utm_medium: string | null;
          utm_campaign: string | null;
          utm_content: string | null;
          utm_term: string | null;
          paid_at: string | null;
          coupon_code: string | null;
          discount_amount: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['orders']['Row'], 'id' | 'created_at' | 'updated_at' | 'discount_amount'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
          discount_amount?: number;
        };
        Update: Partial<Database['public']['Tables']['orders']['Insert']>;
        Relationships: [];
      };
      order_items: {
        Row: {
          id: string;
          order_id: string;
          product_id: string | null;
          product_name: string;
          product_image: string | null;
          quantity: number;
          unit_price: number;
          total_price: number;
          delivery_type: string | null;
          delivery_code: string | null;
          delivered_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['order_items']['Row'], 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['order_items']['Insert']>;
        Relationships: [
          { foreignKeyName: 'order_items_order_id_fkey'; columns: ['order_id']; referencedRelation: 'orders'; referencedColumns: ['id'] },
          { foreignKeyName: 'order_items_product_id_fkey'; columns: ['product_id']; referencedRelation: 'products'; referencedColumns: ['id'] },
        ];
      };
      product_reviews: {
        Row: {
          id: string;
          product_id: string | null;
          category: string | null;
          customer_name: string;
          rating: number;
          comment: string;
          display_order: number;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['product_reviews']['Row'], 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['product_reviews']['Insert']>;
        Relationships: [];
      };
      post_payment_pages: {
        Row: {
          id: string;
          addon_type: string;
          title: string;
          subtitle: string | null;
          badge_text: string | null;
          badge_color: string;
          benefits: Json;
          price: number;
          original_price: number | null;
          button_accept_text: string;
          button_skip_text: string;
          next_route: string;
          is_active: boolean;
          display_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['post_payment_pages']['Row'], 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['post_payment_pages']['Insert']>;
        Relationships: [];
      };
      sale_addons: {
        Row: {
          id: string;
          order_id: string | null;
          user_id: string | null;
          addon_type: string;
          status: string;
          amount: number | null;
          pix_code: string | null;
          flowpay_charge_id: string | null;
          customer_email: string | null;
          customer_name: string | null;
          utm_source: string | null;
          utm_medium: string | null;
          utm_campaign: string | null;
          paid_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['sale_addons']['Row'], 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['sale_addons']['Insert']>;
        Relationships: [];
      };
      post_payment_events: {
        Row: {
          id: string;
          order_id: string | null;
          addon_type: string;
          event_type: string;
          utm_source: string | null;
          utm_medium: string | null;
          utm_campaign: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['post_payment_events']['Row'], 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['post_payment_events']['Insert']>;
        Relationships: [];
      };
      analytics_events: {
        Row: {
          id: string;
          event_id: string | null;
          event_name: string;
          url: string | null;
          user_data: Json | null;
          custom_data: Json | null;
          source: string | null;
          status: string;
          status_code: number | null;
          error: string | null;
          meta_response: Json | null;
          timestamp: string;
          updated_at: string | null;
        };
        Insert: Omit<Database['public']['Tables']['analytics_events']['Row'], 'id' | 'timestamp'> & {
          id?: string;
          timestamp?: string;
        };
        Update: Partial<Database['public']['Tables']['analytics_events']['Insert']>;
        Relationships: [];
      };
      newsletter_subscribers: {
        Row: {
          id: string;
          email: string;
          user_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          user_id?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['newsletter_subscribers']['Insert']>;
        Relationships: [];
      };
      store_metrics: {
        Row: {
          id: string;
          event_name: string;
          user_id: string | null;
          page_url: string | null;
          device_type: string | null;
          browser: string | null;
          value: number | null;
          currency: string | null;
          order_id: string | null;
          content_name: string | null;
          timestamp: string;
        };
        Insert: Omit<Database['public']['Tables']['store_metrics']['Row'], 'id' | 'timestamp'> & {
          id?: string;
          timestamp?: string;
        };
        Update: Partial<Database['public']['Tables']['store_metrics']['Insert']>;
        Relationships: [];
      };
      system_credentials: {
        Row: {
          key: string;
          data: Json;
          updated_at: string;
        };
        Insert: Database['public']['Tables']['system_credentials']['Row'];
        Update: Partial<Database['public']['Tables']['system_credentials']['Insert']>;
        Relationships: [];
      };
      coupons: {
        Row: {
          id: string;
          code: string;
          description: string | null;
          type: 'percent' | 'fixed';
          value: number;
          min_order: number;
          max_discount: number | null;
          max_uses: number | null;
          uses_count: number;
          max_uses_per_user: number | null;
          first_purchase_only: boolean;
          expires_at: string | null;
          starts_at: string | null;
          is_active: boolean;
          applies_to_category: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['coupons']['Row']> & {
          code: string;
          type: 'percent' | 'fixed';
          value: number;
        };
        Update: Partial<Database['public']['Tables']['coupons']['Insert']>;
        Relationships: [];
      };
      coupon_redemptions: {
        Row: {
          id: string;
          coupon_id: string | null;
          coupon_code: string;
          order_id: string | null;
          user_id: string | null;
          discount_value: number;
          redeemed_at: string;
        };
        Insert: Partial<Database['public']['Tables']['coupon_redemptions']['Row']> & {
          coupon_code: string;
          discount_value: number;
        };
        Update: Partial<Database['public']['Tables']['coupon_redemptions']['Insert']>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: {
      order_status: OrderStatusEnum;
      payment_status: PaymentStatusEnum;
    };
    CompositeTypes: { [_ in never]: never };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;
type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  TableName extends keyof DefaultSchema['Tables'],
> = DefaultSchema['Tables'][TableName]['Row'];

export type TablesInsert<
  TableName extends keyof DefaultSchema['Tables'],
> = DefaultSchema['Tables'][TableName]['Insert'];

export type TablesUpdate<
  TableName extends keyof DefaultSchema['Tables'],
> = DefaultSchema['Tables'][TableName]['Update'];

export type Enums<EnumName extends keyof DefaultSchema['Enums']> = DefaultSchema['Enums'][EnumName];

export const Constants = {
  public: {
    Enums: {
      order_status: ['pending', 'processing', 'completed', 'cancelled'] as const,
      payment_status: ['pending', 'paid', 'failed', 'expired', 'refunded'] as const,
    },
  },
} as const;
