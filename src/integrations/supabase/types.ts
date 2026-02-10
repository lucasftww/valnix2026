export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      analytics_events: {
        Row: {
          browser: string | null
          city: string | null
          content_category: string | null
          content_name: string | null
          created_at: string
          currency: string | null
          device_type: string | null
          event_name: string
          event_time: string
          id: string
          order_id: string | null
          page_url: string | null
          state: string | null
          user_id: string | null
          value: number | null
        }
        Insert: {
          browser?: string | null
          city?: string | null
          content_category?: string | null
          content_name?: string | null
          created_at?: string
          currency?: string | null
          device_type?: string | null
          event_name: string
          event_time?: string
          id?: string
          order_id?: string | null
          page_url?: string | null
          state?: string | null
          user_id?: string | null
          value?: number | null
        }
        Update: {
          browser?: string | null
          city?: string | null
          content_category?: string | null
          content_name?: string | null
          created_at?: string
          currency?: string | null
          device_type?: string | null
          event_name?: string
          event_time?: string
          id?: string
          order_id?: string | null
          page_url?: string | null
          state?: string | null
          user_id?: string | null
          value?: number | null
        }
        Relationships: []
      }
      post_payment_pages: {
        Row: {
          addon_type: string
          badge_color: string | null
          badge_text: string | null
          benefits: Json | null
          button_accept_text: string | null
          button_skip_text: string | null
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          next_route: string
          original_price: number | null
          price: number
          subtitle: string | null
          title: string
          updated_at: string
        }
        Insert: {
          addon_type: string
          badge_color?: string | null
          badge_text?: string | null
          benefits?: Json | null
          button_accept_text?: string | null
          button_skip_text?: string | null
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          next_route: string
          original_price?: number | null
          price?: number
          subtitle?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          addon_type?: string
          badge_color?: string | null
          badge_text?: string | null
          benefits?: Json | null
          button_accept_text?: string | null
          button_skip_text?: string | null
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          next_route?: string
          original_price?: number | null
          price?: number
          subtitle?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      sale_addons: {
        Row: {
          addon_type: string
          amount: number
          created_at: string
          customer_email: string | null
          customer_name: string | null
          flowpay_charge_id: string | null
          id: string
          order_id: string
          paid_at: string | null
          pix_code: string | null
          pix_qr_code: string | null
          status: string
          updated_at: string
          user_id: string | null
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          addon_type: string
          amount?: number
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          flowpay_charge_id?: string | null
          id?: string
          order_id: string
          paid_at?: string | null
          pix_code?: string | null
          pix_qr_code?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          addon_type?: string
          amount?: number
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          flowpay_charge_id?: string | null
          id?: string
          order_id?: string
          paid_at?: string | null
          pix_code?: string | null
          pix_qr_code?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Relationships: []
      }
      support_conversations: {
        Row: {
          created_at: string
          id: string
          last_message_at: string
          status: string
          visitor_id: string
          visitor_name: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string
          status?: string
          visitor_id: string
          visitor_name?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string
          status?: string
          visitor_id?: string
          visitor_name?: string | null
        }
        Relationships: []
      }
      support_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          is_from_human: boolean
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          is_from_human?: boolean
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          is_from_human?: boolean
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "support_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      utmify_event_log: {
        Row: {
          created_at: string
          event_id: string
          event_type: string
          id: string
          order_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_id: string
          event_type: string
          id?: string
          order_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_id?: string
          event_type?: string
          id?: string
          order_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
