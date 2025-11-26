import { createClient } from '@/lib/supabase/client';

/**
 * Upload an image file to Supabase storage
 * 
 * @param file - The image file to upload
 * @param campaignId - The campaign ID
 * @param flyerId - The flyer ID
 * @returns Promise resolving to the public URL of the uploaded image
 */
export async function uploadFlyerImage(
  file: File,
  campaignId: string,
  flyerId: string
): Promise<string> {
  const supabase = createClient();

  // Validate file type
  if (!file.type.startsWith('image/')) {
    throw new Error('File must be an image');
  }

  // Validate file size (max 10MB)
  const MAX_SIZE = 10 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    throw new Error('Image size must be less than 10MB');
  }

  // Generate unique filename
  const timestamp = Date.now();
  const extension = file.name.split('.').pop() || 'png';
  const fileName = `${timestamp}-${Math.random().toString(36).substr(2, 9)}.${extension}`;
  const filePath = `flyers/${campaignId}/${flyerId}/${fileName}`;

  // Upload to Supabase storage
  const { error: uploadError } = await supabase.storage
    .from('flyers')
    .upload(filePath, file, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Failed to upload image: ${uploadError.message}`);
  }

  // Get public URL
  const { data: { publicUrl } } = supabase.storage
    .from('flyers')
    .getPublicUrl(filePath);

  return publicUrl;
}

