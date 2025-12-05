-- Add resource linking columns to editor_project table
ALTER TABLE editor_project
ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS flyer_id UUID REFERENCES flyers(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS landing_page_id UUID REFERENCES campaign_landing_pages(id) ON DELETE SET NULL;

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_editor_project_campaign_id ON editor_project(campaign_id);
CREATE INDEX IF NOT EXISTS idx_editor_project_flyer_id ON editor_project(flyer_id);
CREATE INDEX IF NOT EXISTS idx_editor_project_landing_page_id ON editor_project(landing_page_id);

