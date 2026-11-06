-- GitHub release titles are no longer translated (version strings and project
-- names only get garbled). Clear the translations stored before that change so
-- these articles show their original title again. The body translation stays.
UPDATE articles SET title_translated = NULL
WHERE title_translated IS NOT NULL
  AND (url GLOB 'http*://github.com/*/*/releases/tag/?*'
    OR url GLOB 'http*://www.github.com/*/*/releases/tag/?*');
