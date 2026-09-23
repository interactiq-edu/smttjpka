-- New and existing live rooms start private until the teacher explicitly
-- enables the slide or quiz for students.
UPDATE resource_live_states SET allow_student_draw = 0, show_current_slide = 0, show_quiz = 0;
