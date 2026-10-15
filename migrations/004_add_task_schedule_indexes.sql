CREATE INDEX tasks_user_scheduled_at_idx
    ON tasks (user_id, scheduled_at)
    WHERE scheduled_at IS NOT NULL;

CREATE INDEX tasks_user_scheduled_date_idx
    ON tasks (user_id, scheduled_date)
    WHERE scheduled_date IS NOT NULL;

---- create above / drop below ----

DROP INDEX tasks_user_scheduled_date_idx;
DROP INDEX tasks_user_scheduled_at_idx;
