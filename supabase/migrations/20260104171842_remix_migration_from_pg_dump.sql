CREATE EXTENSION IF NOT EXISTS "pg_graphql";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "plpgsql";
CREATE EXTENSION IF NOT EXISTS "supabase_vault";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";
BEGIN;

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'admin',
    'user'
);


--
-- Name: check_newsletter_rate_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_newsletter_rate_limit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  recent_email_count INTEGER;
  recent_domain_count INTEGER;
  email_domain TEXT;
BEGIN
  -- Extract domain from email
  email_domain := split_part(NEW.email, '@', 2);
  
  -- Check global rate limit (max 10 subscriptions per minute)
  SELECT COUNT(*) INTO recent_email_count
  FROM newsletter_subscribers 
  WHERE created_at > NOW() - INTERVAL '1 minute';
  
  IF recent_email_count >= 10 THEN
    RAISE EXCEPTION 'Too many subscription attempts. Please try again later.';
  END IF;
  
  -- Check per-domain rate limit (max 3 from same domain per hour to prevent email bombing)
  SELECT COUNT(*) INTO recent_domain_count
  FROM newsletter_subscribers 
  WHERE email LIKE '%@' || email_domain
    AND created_at > NOW() - INTERVAL '1 hour';
  
  IF recent_domain_count >= 3 THEN
    RAISE EXCEPTION 'Too many subscriptions from this email provider. Please try again later.';
  END IF;
  
  -- Check for duplicate email (case-insensitive)
  IF EXISTS (
    SELECT 1 FROM newsletter_subscribers 
    WHERE LOWER(email) = LOWER(NEW.email)
  ) THEN
    RAISE EXCEPTION 'This email is already subscribed.';
  END IF;
  
  RETURN NEW;
END;
$$;


--
-- Name: check_system_health(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_system_health() RETURNS TABLE(total_orders bigint, pending_orders bigint, completed_orders bigint, failed_orders bigint, total_products bigint, active_products bigint, total_users bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM orders),
    (SELECT COUNT(*) FROM orders WHERE status = 'pending'),
    (SELECT COUNT(*) FROM orders WHERE status = 'processing' OR status = 'completed'),
    (SELECT COUNT(*) FROM orders WHERE status = 'cancelled' OR payment_status = 'failed'),
    (SELECT COUNT(*) FROM products),
    (SELECT COUNT(*) FROM products WHERE is_active = true),
    (SELECT COUNT(*) FROM profiles);
END;
$$;


--
-- Name: cleanup_expired_reset_tokens(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_expired_reset_tokens() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  DELETE FROM public.password_reset_tokens
  WHERE expires_at < now() OR used = true;
END;
$$;


--
-- Name: cleanup_old_rate_limits(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_old_rate_limits() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  DELETE FROM api_rate_limit 
  WHERE window_start < NOW() - INTERVAL '1 hour';
END;
$$;


--
-- Name: generate_fake_delivery_code(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_fake_delivery_code() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  chars text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  result text := '';
  i integer;
BEGIN
  FOR i IN 1..16 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    IF i % 4 = 0 AND i < 16 THEN
      result := result || '-';
    END IF;
  END LOOP;
  RETURN result;
END;
$$;


--
-- Name: get_categories_tree(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_categories_tree() RETURNS TABLE(id uuid, name text, slug text, description text, display_order integer, is_active boolean, icon_url text, image_url text, parent_id uuid, level integer, path text[])
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH RECURSIVE category_tree AS (
    -- Categorias raiz (sem parent)
    SELECT 
      c.id,
      c.name,
      c.slug,
      c.description,
      c.display_order,
      c.is_active,
      c.icon_url,
      c.image_url,
      c.parent_id,
      0 as level,
      ARRAY[c.name] as path
    FROM categories c
    WHERE c.parent_id IS NULL
    
    UNION ALL
    
    -- Subcategorias recursivamente
    SELECT 
      c.id,
      c.name,
      c.slug,
      c.description,
      c.display_order,
      c.is_active,
      c.icon_url,
      c.image_url,
      c.parent_id,
      ct.level + 1,
      ct.path || c.name
    FROM categories c
    INNER JOIN category_tree ct ON c.parent_id = ct.id
  )
  SELECT * FROM category_tree
  ORDER BY level, display_order, name;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  request_id bigint;
  supabase_url text;
  service_key text;
BEGIN
  -- Insert into profiles table
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name');
  
  -- Assign default 'user' role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');
  
  -- Get Supabase URL and service key from environment
  supabase_url := 'https://hswmwkjijpywnazorusc.supabase.co';
  service_key := current_setting('supabase.service_role_key', true);
  
  -- Send welcome email asynchronously via edge function
  -- Using pg_net extension to make HTTP request
  SELECT net.http_post(
    url := supabase_url || '/functions/v1/send-welcome-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := jsonb_build_object(
      'email', NEW.email,
      'name', NEW.raw_user_meta_data->>'full_name'
    )
  ) INTO request_id;
  
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't block user creation
    RAISE WARNING 'Failed to send welcome email: %', SQLERRM;
    RETURN NEW;
END;
$$;


--
-- Name: has_role(uuid, public.app_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;


--
-- Name: is_valid_email(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_valid_email(email text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
BEGIN
  RETURN email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$';
END;
$_$;


--
-- Name: log_order_changes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_order_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF (OLD.status IS DISTINCT FROM NEW.status) OR 
     (OLD.payment_status IS DISTINCT FROM NEW.payment_status) THEN
    INSERT INTO order_audit_log (
      order_id,
      changed_by,
      old_status,
      new_status,
      old_payment_status,
      new_payment_status
    ) VALUES (
      NEW.id,
      auth.uid(),
      OLD.status,
      NEW.status,
      OLD.payment_status,
      NEW.payment_status
    );
  END IF;
  
  RETURN NEW;
END;
$$;


--
-- Name: sanitize_order_data(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sanitize_order_data() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- Sanitizar campos de texto
  NEW.customer_name := sanitize_text(NEW.customer_name);
  NEW.customer_email := LOWER(TRIM(NEW.customer_email));
  
  IF NEW.notes IS NOT NULL THEN
    NEW.notes := sanitize_text(NEW.notes);
  END IF;
  
  IF NEW.shipping_address IS NOT NULL THEN
    NEW.shipping_address := sanitize_text(NEW.shipping_address);
  END IF;
  
  RETURN NEW;
END;
$$;


--
-- Name: sanitize_profile_data(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sanitize_profile_data() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.full_name IS NOT NULL THEN
    NEW.full_name := sanitize_text(NEW.full_name);
  END IF;
  
  IF NEW.phone IS NOT NULL THEN
    -- Remove tudo exceto números, parênteses, hífens e espaços
    NEW.phone := regexp_replace(NEW.phone, '[^0-9()\-\s+]', '', 'g');
  END IF;
  
  RETURN NEW;
END;
$$;


--
-- Name: sanitize_text(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sanitize_text(input_text text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- Remove caracteres potencialmente perigosos
  RETURN regexp_replace(
    regexp_replace(input_text, '[<>]', '', 'g'),
    E'[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]',
    '',
    'g'
  );
END;
$$;


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: validate_order_email(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_order_email() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT is_valid_email(NEW.customer_email) THEN
    RAISE EXCEPTION 'Invalid email format';
  END IF;
  
  IF LENGTH(NEW.customer_name) > 255 THEN
    RAISE EXCEPTION 'Customer name too long';
  END IF;
  
  IF NEW.customer_phone IS NOT NULL AND LENGTH(NEW.customer_phone) > 20 THEN
    RAISE EXCEPTION 'Phone number too long';
  END IF;
  
  RETURN NEW;
END;
$$;


SET default_table_access_method = heap;

--
-- Name: activation_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activation_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category text NOT NULL,
    step_number integer NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: api_rate_limit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_rate_limit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    ip_address inet,
    endpoint text NOT NULL,
    request_count integer DEFAULT 1 NOT NULL,
    window_start timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    display_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    parent_id uuid,
    icon_url text,
    image_url text,
    show_on_homepage boolean DEFAULT true
);


--
-- Name: coupon_uses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coupon_uses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    coupon_id uuid NOT NULL,
    user_id uuid NOT NULL,
    order_id uuid,
    used_at timestamp with time zone DEFAULT now()
);


--
-- Name: coupons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coupons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    description text,
    discount_type text NOT NULL,
    discount_value numeric NOT NULL,
    min_purchase_amount numeric DEFAULT 0,
    max_uses integer,
    current_uses integer DEFAULT 0,
    expires_at timestamp with time zone,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT coupons_discount_type_check CHECK ((discount_type = ANY (ARRAY['percentage'::text, 'fixed'::text]))),
    CONSTRAINT coupons_discount_value_check CHECK ((discount_value > (0)::numeric))
);


--
-- Name: newsletter_subscribers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.newsletter_subscribers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    subscribed_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: order_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    changed_by uuid,
    old_status text,
    new_status text,
    old_payment_status text,
    new_payment_status text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    ip_address inet,
    user_agent text
);


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid,
    product_name text NOT NULL,
    product_image text,
    quantity integer DEFAULT 1 NOT NULL,
    unit_price numeric(10,2) NOT NULL,
    total_price numeric(10,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    delivery_code text
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    customer_name text NOT NULL,
    customer_email text NOT NULL,
    customer_phone text,
    total_amount numeric(10,2) NOT NULL,
    status text DEFAULT 'pending'::text,
    payment_method text,
    payment_status text DEFAULT 'pending'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    shipping_address text,
    shipping_method text,
    tracking_code text,
    CONSTRAINT orders_email_valid CHECK (public.is_valid_email(customer_email))
);

ALTER TABLE ONLY public.orders REPLICA IDENTITY FULL;


--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_reset_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid,
    customer_name text NOT NULL,
    rating integer NOT NULL,
    comment text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    category text,
    CONSTRAINT product_reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    price numeric(10,2) NOT NULL,
    old_price numeric(10,2),
    discount integer,
    category text NOT NULL,
    image_url text,
    icon_url text,
    stock integer DEFAULT 0,
    sold integer DEFAULT 0,
    is_active boolean DEFAULT true,
    product_type text DEFAULT 'digital'::text,
    delivery_info text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    featured boolean DEFAULT false,
    video_url text,
    rich_description text,
    display_order integer DEFAULT 0 NOT NULL,
    is_featured_in_category boolean DEFAULT false NOT NULL,
    delivery_type text DEFAULT 'manual'::text,
    auto_delivery_codes text[] DEFAULT '{}'::text[],
    offer_hash text,
    CONSTRAINT products_delivery_type_check CHECK ((delivery_type = ANY (ARRAY['manual'::text, 'auto_fake'::text, 'auto_real'::text])))
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    full_name text,
    phone text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    endpoint text NOT NULL,
    keys jsonb NOT NULL,
    user_agent text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: site_banners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_banners (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    image_url text NOT NULL,
    alt_text text DEFAULT 'Banner promocional'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: activation_steps activation_steps_category_step_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activation_steps
    ADD CONSTRAINT activation_steps_category_step_number_key UNIQUE (category, step_number);


--
-- Name: activation_steps activation_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activation_steps
    ADD CONSTRAINT activation_steps_pkey PRIMARY KEY (id);


--
-- Name: api_rate_limit api_rate_limit_ip_address_endpoint_window_start_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_rate_limit
    ADD CONSTRAINT api_rate_limit_ip_address_endpoint_window_start_key UNIQUE (ip_address, endpoint, window_start);


--
-- Name: api_rate_limit api_rate_limit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_rate_limit
    ADD CONSTRAINT api_rate_limit_pkey PRIMARY KEY (id);


--
-- Name: api_rate_limit api_rate_limit_user_id_endpoint_window_start_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_rate_limit
    ADD CONSTRAINT api_rate_limit_user_id_endpoint_window_start_key UNIQUE (user_id, endpoint, window_start);


--
-- Name: categories categories_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_name_key UNIQUE (name);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: categories categories_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_slug_key UNIQUE (slug);


--
-- Name: coupon_uses coupon_uses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_uses
    ADD CONSTRAINT coupon_uses_pkey PRIMARY KEY (id);


--
-- Name: coupons coupons_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_code_key UNIQUE (code);


--
-- Name: coupons coupons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_pkey PRIMARY KEY (id);


--
-- Name: newsletter_subscribers newsletter_subscribers_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletter_subscribers
    ADD CONSTRAINT newsletter_subscribers_email_key UNIQUE (email);


--
-- Name: newsletter_subscribers newsletter_subscribers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletter_subscribers
    ADD CONSTRAINT newsletter_subscribers_pkey PRIMARY KEY (id);


--
-- Name: order_audit_log order_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_audit_log
    ADD CONSTRAINT order_audit_log_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_token_key UNIQUE (token);


--
-- Name: product_reviews product_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_reviews
    ADD CONSTRAINT product_reviews_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: site_banners site_banners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_banners
    ADD CONSTRAINT site_banners_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);


--
-- Name: idx_api_rate_limit_ip; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_rate_limit_ip ON public.api_rate_limit USING btree (ip_address, endpoint, window_start);


--
-- Name: idx_api_rate_limit_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_rate_limit_user ON public.api_rate_limit USING btree (user_id, endpoint, window_start);


--
-- Name: idx_categories_display_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_categories_display_order ON public.categories USING btree (display_order);


--
-- Name: idx_categories_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_categories_is_active ON public.categories USING btree (is_active);


--
-- Name: idx_categories_parent_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_categories_parent_id ON public.categories USING btree (parent_id);


--
-- Name: idx_categories_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_categories_slug ON public.categories USING btree (slug);


--
-- Name: idx_coupon_uses_coupon_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coupon_uses_coupon_id ON public.coupon_uses USING btree (coupon_id);


--
-- Name: idx_coupon_uses_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coupon_uses_user_id ON public.coupon_uses USING btree (user_id);


--
-- Name: idx_coupons_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coupons_code ON public.coupons USING btree (code) WHERE (is_active = true);


--
-- Name: idx_newsletter_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_newsletter_email ON public.newsletter_subscribers USING btree (email);


--
-- Name: idx_newsletter_email_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_newsletter_email_unique ON public.newsletter_subscribers USING btree (lower(email));


--
-- Name: idx_order_audit_log_changed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_audit_log_changed_at ON public.order_audit_log USING btree (changed_at DESC);


--
-- Name: idx_order_audit_log_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_audit_log_order_id ON public.order_audit_log USING btree (order_id, changed_at DESC);


--
-- Name: idx_order_items_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_order_id ON public.order_items USING btree (order_id);


--
-- Name: idx_order_items_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_product_id ON public.order_items USING btree (product_id) WHERE (product_id IS NOT NULL);


--
-- Name: idx_orders_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_created_at ON public.orders USING btree (created_at DESC);


--
-- Name: idx_orders_customer_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_customer_email ON public.orders USING btree (customer_email);


--
-- Name: idx_orders_payment_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_payment_status ON public.orders USING btree (payment_status);


--
-- Name: idx_orders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_status ON public.orders USING btree (status, created_at DESC);


--
-- Name: idx_orders_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_user_id ON public.orders USING btree (user_id);


--
-- Name: idx_password_reset_tokens_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_password_reset_tokens_expires_at ON public.password_reset_tokens USING btree (expires_at);


--
-- Name: idx_password_reset_tokens_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_password_reset_tokens_token ON public.password_reset_tokens USING btree (token);


--
-- Name: idx_password_reset_tokens_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_password_reset_tokens_user_id ON public.password_reset_tokens USING btree (user_id);


--
-- Name: idx_product_reviews_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_reviews_category ON public.product_reviews USING btree (category);


--
-- Name: idx_product_reviews_display_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_reviews_display_order ON public.product_reviews USING btree (display_order);


--
-- Name: idx_product_reviews_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_reviews_product_id ON public.product_reviews USING btree (product_id);


--
-- Name: idx_products_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_category ON public.products USING btree (category);


--
-- Name: idx_products_display_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_display_order ON public.products USING btree (display_order);


--
-- Name: idx_products_featured; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_featured ON public.products USING btree (featured) WHERE (featured = true);


--
-- Name: idx_products_featured_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_featured_category ON public.products USING btree (is_featured_in_category);


--
-- Name: idx_products_price; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_price ON public.products USING btree (price) WHERE (is_active = true);


--
-- Name: idx_profiles_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_id ON public.profiles USING btree (id);


--
-- Name: idx_push_subscriptions_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_push_subscriptions_is_active ON public.push_subscriptions USING btree (is_active);


--
-- Name: idx_push_subscriptions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_push_subscriptions_user_id ON public.push_subscriptions USING btree (user_id);


--
-- Name: newsletter_subscribers check_newsletter_rate_limit_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER check_newsletter_rate_limit_trigger BEFORE INSERT ON public.newsletter_subscribers FOR EACH ROW EXECUTE FUNCTION public.check_newsletter_rate_limit();


--
-- Name: orders trigger_log_order_changes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_log_order_changes AFTER UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.log_order_changes();


--
-- Name: orders trigger_sanitize_order_data; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_sanitize_order_data BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.sanitize_order_data();


--
-- Name: profiles trigger_sanitize_profile_data; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_sanitize_profile_data BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.sanitize_profile_data();


--
-- Name: activation_steps update_activation_steps_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_activation_steps_updated_at BEFORE UPDATE ON public.activation_steps FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: categories update_categories_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_categories_updated_at BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: coupons update_coupons_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_coupons_updated_at BEFORE UPDATE ON public.coupons FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: orders update_orders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: products update_products_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: profiles update_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: push_subscriptions update_push_subscriptions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_push_subscriptions_updated_at BEFORE UPDATE ON public.push_subscriptions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: site_banners update_site_banners_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_site_banners_updated_at BEFORE UPDATE ON public.site_banners FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: orders validate_order_email_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER validate_order_email_trigger BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.validate_order_email();


--
-- Name: categories categories_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.categories(id) ON DELETE CASCADE;


--
-- Name: coupon_uses coupon_uses_coupon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_uses
    ADD CONSTRAINT coupon_uses_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES public.coupons(id) ON DELETE CASCADE;


--
-- Name: coupon_uses coupon_uses_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_uses
    ADD CONSTRAINT coupon_uses_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: order_audit_log order_audit_log_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_audit_log
    ADD CONSTRAINT order_audit_log_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES auth.users(id);


--
-- Name: order_audit_log order_audit_log_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_audit_log
    ADD CONSTRAINT order_audit_log_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: orders orders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: product_reviews product_reviews_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_reviews
    ADD CONSTRAINT product_reviews_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: products Admins can delete products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete products" ON public.products FOR DELETE USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: products Admins can insert products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can insert products" ON public.products FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: categories Admins can manage categories; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage categories" ON public.categories USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: coupons Admins can manage coupons; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage coupons" ON public.coupons USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: product_reviews Admins can manage reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage reviews" ON public.product_reviews USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: order_items Admins can update order items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update order items" ON public.order_items FOR UPDATE USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: orders Admins can update orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update orders" ON public.orders FOR UPDATE USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: products Admins can update products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update products" ON public.products FOR UPDATE USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: coupon_uses Admins can view all coupon uses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all coupon uses" ON public.coupon_uses FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: order_items Admins can view all order items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all order items" ON public.order_items FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: orders Admins can view all orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all orders" ON public.orders FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: profiles Admins can view all profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: order_audit_log Admins can view audit logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view audit logs" ON public.order_audit_log FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: api_rate_limit Admins can view rate limits; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view rate limits" ON public.api_rate_limit FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: site_banners Admins podem gerenciar banners; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins podem gerenciar banners" ON public.site_banners USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: activation_steps Admins podem gerenciar passos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins podem gerenciar passos" ON public.activation_steps USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: push_subscriptions Admins podem ver todas as subscrições; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins podem ver todas as subscrições" ON public.push_subscriptions FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: categories Anyone can use category tree function; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can use category tree function" ON public.categories FOR SELECT USING (true);


--
-- Name: categories Anyone can view active categories; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view active categories" ON public.categories FOR SELECT USING ((is_active = true));


--
-- Name: coupons Anyone can view active coupons; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view active coupons" ON public.coupons FOR SELECT USING (((is_active = true) AND ((expires_at IS NULL) OR (expires_at > now()))));


--
-- Name: products Anyone can view active products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view active products" ON public.products FOR SELECT USING ((is_active = true));


--
-- Name: product_reviews Anyone can view reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view reviews" ON public.product_reviews FOR SELECT USING (true);


--
-- Name: orders Authenticated users can create own orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can create own orders" ON public.orders FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));


--
-- Name: push_subscriptions Authenticated users can create own subscriptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can create own subscriptions" ON public.push_subscriptions FOR INSERT WITH CHECK (((auth.uid() IS NOT NULL) AND (auth.uid() = user_id)));


--
-- Name: push_subscriptions Authenticated users can delete own subscriptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can delete own subscriptions" ON public.push_subscriptions FOR DELETE USING (((auth.uid() IS NOT NULL) AND (auth.uid() = user_id)));


--
-- Name: newsletter_subscribers Authenticated users can subscribe to newsletter; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can subscribe to newsletter" ON public.newsletter_subscribers FOR INSERT WITH CHECK (((auth.uid() IS NOT NULL) AND public.is_valid_email(email) AND (length(email) <= 255)));


--
-- Name: push_subscriptions Authenticated users can update own subscriptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can update own subscriptions" ON public.push_subscriptions FOR UPDATE USING (((auth.uid() IS NOT NULL) AND (auth.uid() = user_id)));


--
-- Name: push_subscriptions Authenticated users can view own subscriptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view own subscriptions" ON public.push_subscriptions FOR SELECT USING (((auth.uid() IS NOT NULL) AND (auth.uid() = user_id)));


--
-- Name: api_rate_limit Authorized functions can manage rate limits; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authorized functions can manage rate limits" ON public.api_rate_limit USING (((auth.uid() IS NULL) AND (((current_setting('request.jwt.claims'::text, true))::json ->> 'role'::text) = 'service_role'::text)));


--
-- Name: orders Block access to orders without user_id; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Block access to orders without user_id" ON public.orders USING ((user_id IS NOT NULL));


--
-- Name: order_audit_log Block audit log deletes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Block audit log deletes" ON public.order_audit_log FOR DELETE USING (false);


--
-- Name: order_audit_log Block audit log updates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Block audit log updates" ON public.order_audit_log FOR UPDATE USING (false);


--
-- Name: newsletter_subscribers Only admins can view newsletter subscribers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Only admins can view newsletter subscribers" ON public.newsletter_subscribers FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: order_audit_log Only system can insert audit logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Only system can insert audit logs" ON public.order_audit_log FOR INSERT WITH CHECK (((auth.uid() IS NULL) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: activation_steps Qualquer pessoa pode ver passos ativos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Qualquer pessoa pode ver passos ativos" ON public.activation_steps FOR SELECT USING ((is_active = true));


--
-- Name: orders Require authentication for orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Require authentication for orders" ON public.orders AS RESTRICTIVE USING ((auth.uid() IS NOT NULL));


--
-- Name: order_items Service role can update order items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can update order items" ON public.order_items FOR UPDATE USING ((((current_setting('request.jwt.claims'::text, true))::json ->> 'role'::text) = 'service_role'::text));


--
-- Name: password_reset_tokens Sistema pode criar tokens de reset; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Sistema pode criar tokens de reset" ON public.password_reset_tokens FOR INSERT WITH CHECK (true);


--
-- Name: coupon_uses System can insert coupon uses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "System can insert coupon uses" ON public.coupon_uses FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: site_banners Todos podem ver banners ativos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Todos podem ver banners ativos" ON public.site_banners FOR SELECT USING ((is_active = true));


--
-- Name: password_reset_tokens Tokens não são públicos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tokens não são públicos" ON public.password_reset_tokens FOR SELECT USING (false);


--
-- Name: orders Users and admins can view orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users and admins can view orders" ON public.orders FOR SELECT USING (((auth.uid() = user_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: order_items Users can create order items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create order items" ON public.order_items FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.orders
  WHERE ((orders.id = order_items.order_id) AND (orders.user_id = auth.uid())))));


--
-- Name: profiles Users can insert own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK ((auth.uid() = id));


--
-- Name: profiles Users can update own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING ((auth.uid() = id));


--
-- Name: coupon_uses Users can view own coupon uses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own coupon uses" ON public.coupon_uses FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: order_items Users can view own order items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own order items" ON public.order_items FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.orders
  WHERE ((orders.id = order_items.order_id) AND (orders.user_id = auth.uid()) AND (orders.payment_status = 'paid'::text)))));


--
-- Name: orders Users can view own orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own orders" ON public.orders FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: profiles Users can view own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING ((auth.uid() = id));


--
-- Name: user_roles Users can view own roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: activation_steps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activation_steps ENABLE ROW LEVEL SECURITY;

--
-- Name: api_rate_limit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.api_rate_limit ENABLE ROW LEVEL SECURITY;

--
-- Name: categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

--
-- Name: coupon_uses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.coupon_uses ENABLE ROW LEVEL SECURITY;

--
-- Name: coupons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

--
-- Name: newsletter_subscribers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;

--
-- Name: order_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: order_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

--
-- Name: orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

--
-- Name: password_reset_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: product_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: push_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: site_banners; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.site_banners ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--




COMMIT;