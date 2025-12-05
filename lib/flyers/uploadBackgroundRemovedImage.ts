import { createAdminClient } from '@/lib/supabase/server';

/**
 * Upload a background-removed image to Supabase storage
 * 
 * @param file - The PNG file with transparent background
 * @returns Promise resolving to the public URL of the uploaded image
 */
export async function uploadBackgroundRemovedImage(
  file: File | Blob
): Promise<string> {
  const supabase = createAdminClient();

  // Validate file type
  if (file instanceof File && !file.type.startsWith('image/')) {
    throw new Error('File must be an image');
  }

  // Validate file size (max 10MB)
  const MAX_SIZE = 10 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    throw new Error('Image size must be less than 10MB');
  }

  // Generate unique filename
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 9);
  const fileName = `${timestamp}-${randomStr}.png`;
  const filePath = `background-removed/${fileName}`;

  // Upload to Supabase storage
  const { error: uploadError } = await supabase.storage
    .from('flyers')
    .upload(filePath, file, {
      contentType: 'image/png',
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

