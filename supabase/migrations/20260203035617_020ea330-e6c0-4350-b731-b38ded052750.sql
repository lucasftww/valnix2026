-- Força reload do schema cache do PostgREST
NOTIFY pgrst, 'reload schema';