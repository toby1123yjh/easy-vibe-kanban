-- A VK session can adopt only one provider-native profile. The V1 schema
-- allowed one row per runtime profile, so older databases may already contain
-- multiple rows for a session. Retain one durable binding before adding the
-- stricter session-level index. A provider matching the immutable Session
-- executor wins, then native adoption provenance, then the most recent row.
DELETE FROM agent_provider_sessions
WHERE id IN (
    SELECT id
    FROM (
        SELECT aps.id,
               ROW_NUMBER() OVER (
                   PARTITION BY aps.session_id
                   ORDER BY
                       CASE
                           WHEN json_valid(aps.session_reference) = 1 THEN 0
                           ELSE 1
                       END,
                       CASE
                           WHEN aps.provider_id = (
                               SELECT lower(replace(s.executor, '-', '_'))
                               FROM sessions AS s
                               WHERE s.id = aps.session_id
                           ) THEN 0
                           ELSE 1
                       END,
                       CASE
                           WHEN json_valid(aps.session_reference) = 1
                               AND json_extract(
                                   aps.session_reference,
                                   '$.metadata.source'
                               ) = 'native_adopted' THEN 0
                           ELSE 1
                       END,
                       julianday(aps.updated_at) DESC,
                       julianday(aps.created_at) DESC,
                       aps.id DESC
               ) AS row_number
        FROM agent_provider_sessions AS aps
    )
    WHERE row_number > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_provider_sessions_session
    ON agent_provider_sessions(session_id);
