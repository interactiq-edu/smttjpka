ALTER TABLE learning_resources ADD COLUMN assigned_class_name TEXT;

ALTER TABLE resource_live_states ADD COLUMN presentation_mode TEXT NOT NULL DEFAULT 'SLIDE';
ALTER TABLE resource_live_states ADD COLUMN allow_student_draw INTEGER NOT NULL DEFAULT 0;
ALTER TABLE resource_live_states ADD COLUMN show_current_slide INTEGER NOT NULL DEFAULT 1;
ALTER TABLE resource_live_states ADD COLUMN show_quiz INTEGER NOT NULL DEFAULT 1;
