-- Keep historical migrations immutable. The narrow Agent Runtime schema guard
-- runs from DBService after forward migrations so it can inspect legacy SQLite
-- schemas before issuing the one supported idempotent ALTER TABLE.
SELECT 1;
