-- Scratch keys and tagged JSON must move together. The old DRAFT_TASK was a
-- comment string; move it first to free the key for the former DRAFT_ISSUE.
-- Do not replace strings inside user-authored content or unrelated JSON fields.
UPDATE scratch
SET scratch_type = 'DRAFT_COMMENT',
    payload = json_set(payload, '$.type', 'DRAFT_COMMENT')
WHERE scratch_type = 'DRAFT_TASK'
  AND CASE WHEN json_valid(payload)
      THEN json_type(payload, '$.data') = 'text'
           AND json_extract(payload, '$.type') = 'DRAFT_TASK'
      ELSE 0 END;

UPDATE scratch
SET scratch_type = 'DRAFT_TASK',
    payload = json_set(payload, '$.type', 'DRAFT_TASK')
WHERE scratch_type = 'DRAFT_ISSUE'
  AND CASE WHEN json_valid(payload)
      THEN json_type(payload, '$.data') = 'object'
           AND json_extract(payload, '$.type') = 'DRAFT_ISSUE'
      ELSE 0 END;

UPDATE scratch
SET payload = json_remove(
    json_set(payload, '$.data.parent_task_id',
             json_extract(payload, '$.data.parent_issue_id')),
    '$.data.parent_issue_id')
WHERE scratch_type = 'DRAFT_TASK'
  AND CASE WHEN json_valid(payload)
      THEN json_type(payload, '$.data.parent_issue_id') IS NOT NULL
      ELSE 0 END;

UPDATE scratch
SET payload = json_remove(
    json_set(payload, '$.data.linked_task',
             json_extract(payload, '$.data.linked_issue')),
    '$.data.linked_issue')
WHERE scratch_type = 'DRAFT_WORKSPACE'
  AND CASE WHEN json_valid(payload)
      THEN json_type(payload, '$.data.linked_issue') IS NOT NULL
      ELSE 0 END;

UPDATE scratch
SET payload = json_remove(
    json_set(payload, '$.data.linked_task.task_id',
             json_extract(payload, '$.data.linked_task.issue_id')),
    '$.data.linked_task.issue_id')
WHERE scratch_type = 'DRAFT_WORKSPACE'
  AND CASE WHEN json_valid(payload)
      THEN json_type(payload, '$.data.linked_task.issue_id') IS NOT NULL
      ELSE 0 END;
