-- Per-feed automatic image archiving: feeds marked archive_images have the
-- images of every article downloaded at fetch time, instead of waiting for
-- the reader to open the article. For feeds kept as archives, the local copy
-- must exist before the source rots, not after someone happens to read it.
ALTER TABLE feeds ADD COLUMN archive_images INTEGER NOT NULL DEFAULT 0;
