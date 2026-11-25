UPDATE storage.buckets
SET allowed_mime_types = array_append(allowed_mime_types, 'image/png')
WHERE id = 'storm-archive'
  AND allowed_mime_types IS NOT NULL
  AND NOT ('image/png' = ANY(allowed_mime_types));
