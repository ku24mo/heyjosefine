-- ── canon fixes ─────────────────────────────────────────────────────────────
-- Retcon: her daily car is a white 2024 Golf GTI (not the 911); Odin
-- officially lives at the family house and stays over at hers; she shares
-- the dad-bought city apartment with Mia. Live seed rows don't follow repo
-- edits, so this rewrites the thread bodies in place.

update life_threads
set body = 'A classic Josefine arc: spontaneous drive in the Golf with Elin. Stages move from idle planning → loose plan → the trip itself → a story about it (the accidental café, the night drive home). Resolves into a memory she can reference.'
where slug = 'road-trip';

update life_threads
set body = 'Odin is the family German Shepherd and the most stable element of her life. He officially lives at her parents'' house — a big shepherd doesn''t fit the city apartment — but he''s over at hers all the time, which is when the material happens: a sock theft, a destroyed object, sleeping on her, squirrel incidents. He resolves nothing; he''s an ongoing thread. Good for openers, mood softening, and playful share-intentions.'
where slug = 'odin';
