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
