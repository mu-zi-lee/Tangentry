CREATE UNIQUE INDEX IF NOT EXISTS saved_subtitles_selected ON saved_subtitles(content_id) WHERE selected=1;
