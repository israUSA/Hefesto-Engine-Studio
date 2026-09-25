-- Hand-written migration: drizzle-kit cannot diff virtual tables, so the
-- FTS5 index over bible_verses and its sync triggers are maintained here by
-- hand. Every statement is idempotent (IF NOT EXISTS) so re-running this
-- migration on a DB that already has it is a no-op.
CREATE VIRTUAL TABLE IF NOT EXISTS `bible_verses_fts` USING fts5(
	`text`,
	`book`,
	content=`bible_verses`,
	content_rowid=`rowid`
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `bible_verses_ai` AFTER INSERT ON `bible_verses` BEGIN
  INSERT INTO `bible_verses_fts`(rowid, `text`, `book`) VALUES (new.rowid, new.`text`, new.`book`);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `bible_verses_ad` AFTER DELETE ON `bible_verses` BEGIN
  INSERT INTO `bible_verses_fts`(`bible_verses_fts`, rowid, `text`, `book`) VALUES('delete', old.rowid, old.`text`, old.`book`);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `bible_verses_au` AFTER UPDATE ON `bible_verses` BEGIN
  INSERT INTO `bible_verses_fts`(`bible_verses_fts`, rowid, `text`, `book`) VALUES('delete', old.rowid, old.`text`, old.`book`);
  INSERT INTO `bible_verses_fts`(rowid, `text`, `book`) VALUES (new.rowid, new.`text`, new.`book`);
END;
