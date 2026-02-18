// Tipos centralizados do projeto

export interface Category {
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
  children?: Category[];
}

export interface Product {
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
  display_order: number;
  stock: number | null;
  sold: number | null;
  delivery_type: string | null;
  delivery_info: string | null;
  instructions: string | null;
  terms_conditions: string | null;
  video_url: string | null;
  product_type: string | null;
}

export interface ProductWithReviews extends Product {
  reviewCount: number;
}

export interface ProductCardData {
  id: string;
  name: string;
  image_url: string | null;
  icon_url: string | null;
  price: number;
  old_price: number | null;
  discount: number | null;
  category: string;
  sold?: number;
  reviewCount?: number;
}

export interface Order {
  id: string;
  user_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  total_amount: number;
  status: OrderStatus;
  payment_status: PaymentStatus;
  payment_method: string | null;
  notes: string | null;
  shipping_address: string | null;
  shipping_method: string | null;
  tracking_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  product_image: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  delivery_code: string | null;
}

export interface Review {
  id: string;
  product_id: string | null;
  category: string | null;
  customer_name: string;
  rating: number;
  comment: string;
  display_order: number;
  created_at: string;
}

// Enums tipados
export type OrderStatus = 'pending' | 'processing' | 'completed' | 'cancelled';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';
export type DeliveryType = 'manual' | 'automatic';

// Cart types
export interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image_url: string | null;
}
