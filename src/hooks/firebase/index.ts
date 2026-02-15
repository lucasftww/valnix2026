// Re-export Firebase hooks as default implementation
export { useAutoVerifyPixPayments } from "./useAutoVerifyPixPayments";
export { useAutoVerifyCardPayments } from "./useAutoVerifyCardPayments";
export { useCategories, useCategoriesTree, useHomeCategories } from "./useFirebaseCategories";
export { useFeaturedProducts, useCategoryProducts, useProduct } from "./useFirebaseProducts";

export { 
  useProductsWithReviews, 
  useCategoryBySlug, 
  useProductById, 
  useProductReviews
} from "./useFirebaseProductsWithReviews";
export {
  useUserOrders,
  useRecentOrders,
  useOrderItems,
  useAllOrders,
  createOrder,
  createOrderItems,
  updateOrderStatus,
  generateFakeDeliveryCode
} from "./useFirebaseOrders";
export type { Order, OrderItem, CreateOrderData, CreateOrderItemData } from "./useFirebaseOrders";
export { useAdminUsers, useUserOrders as useAdminUserOrders, useIsUserAdmin, updateUserBalance } from "./useFirebaseUsers";
export type { FirebaseUser, FirebaseOrder } from "./useFirebaseUsers";
