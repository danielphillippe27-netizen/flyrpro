-- Public card artwork only. Writes go through the authorized, workspace-scoped cards API.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('business-card-images','business-card-images',true,4194304,array['image/webp'])
on conflict(id) do nothing;
