
-- Allow updates to post_payment_pages (admin manages via anon key + client-side Firebase auth check)
CREATE POLICY "Anyone can update post_payment_pages"
  ON public.post_payment_pages FOR UPDATE
  USING (true);

CREATE POLICY "Anyone can insert post_payment_pages"
  ON public.post_payment_pages FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can delete post_payment_pages"
  ON public.post_payment_pages FOR DELETE
  USING (true);
