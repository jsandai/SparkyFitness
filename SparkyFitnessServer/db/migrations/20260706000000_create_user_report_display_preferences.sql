CREATE TABLE user_report_display_preferences (
    id SERIAL PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    view_group VARCHAR(255) NOT NULL,
    platform VARCHAR(50) NOT NULL,
    visible_items JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, view_group, platform)
);

CREATE TRIGGER set_user_report_display_preferences_updated_at
BEFORE UPDATE ON user_report_display_preferences
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();
