ALTER TABLE saved_subtitles ADD COLUMN selected INTEGER NOT NULL DEFAULT 0 CHECK(selected IN (0,1));
