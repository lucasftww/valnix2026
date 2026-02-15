
-- Desativar "Turbine seu Gift Card" (premium_benefits)
UPDATE post_payment_pages SET is_active = false WHERE addon_type = 'premium_benefits';

-- Entrega Prioritária = 1º upsell, próximo vai para Proteção Total
UPDATE post_payment_pages SET display_order = 0, next_route = '/painel-pagar-trocadados' WHERE addon_type = 'delivery_priority';

-- Proteção Total = 2º upsell, próximo vai para página de entrega (dinâmico via hash)
UPDATE post_payment_pages SET display_order = 1, next_route = '/order' WHERE addon_type = 'data_swap_warranty';
