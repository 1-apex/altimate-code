-- Known anti-patterns for sql_analyze sanity testing
-- SELECT * is a classic anti-pattern that should always be flagged
SELECT * FROM users WHERE id IN (1, 2, 3, 4, 5);

-- Implicit join (cartesian product risk)
SELECT u.name, o.total FROM users u, orders o WHERE u.id = o.user_id;
