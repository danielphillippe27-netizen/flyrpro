import { createClient } from '@/lib/supabase/client';
import type { FlyerInstance } from '@/lib/types/flyers';

/**
 * Flyer Service
 * 
 * Handles saving and loading flyer instances from Supabase.
 * 
 * TODO: Create flyer_instances table in Supabase with schema:
 * - id: uuid (primary key)
 * - user_id: uuid (foreign key to auth.users)
 * - template_id: text
 * - title: text
 * - data: jsonb (stores element overrides)
 * - created_at: timestamp
 * - updated_at: timestamp
 */

/**
 * Save a flyer instance to Supabase
 * 
 * @param instance - The flyer instance to save
 */
export async function saveFlyerInstance(
  instance: FlyerInstance
): Promise<void> {
  const supabase = createClient();
  
  // TODO: Implement Supabase insert/update
  // const { error } = await supabase
  //   .from('flyer_instances')
  //   .upsert({
  //     id: instance.id,
  //     template_id: instance.templateId,
  //     title: instance.title,
  //     data: instance.data,
  //     updated_at: new Date().toISOString(),
  //   });
  // 
  // if (error) {
  //   throw new Error(`Failed to save flyer: ${error.message}`);
  // }
  
  console.log('TODO: Save flyer instance to Supabase', instance);
}

/**
 * Load a flyer instance by ID
 * 
 * @param id - The flyer instance ID
 * @returns The flyer instance or null if not found
 */
export async function loadFlyerInstance(
  id: string
): Promise<FlyerInstance | null> {
  const supabase = createClient();
  
  // TODO: Implement Supabase select
  // const { data, error } = await supabase
  //   .from('flyer_instances')
  //   .select('*')
  //   .eq('id', id)
  //   .single();
  // 
  // if (error) {
  //   if (error.code === 'PGRST116') {
  //     return null; // Not found
  //   }
  //   throw new Error(`Failed to load flyer: ${error.message}`);
  // }
  // 
  // return {
  //   id: data.id,
  //   templateId: data.template_id,
  //   title: data.title,
  //   data: data.data,
  //   createdAt: data.created_at,
  //   updatedAt: data.updated_at,
  // };
  
  console.log('TODO: Load flyer instance from Supabase', id);
  return null;
}

/**
 * Load all flyer instances for the current user
 * 
 * @returns Array of flyer instances
 */
export async function loadFlyerInstances(): Promise<FlyerInstance[]> {
  const supabase = createClient();
  
  // TODO: Implement Supabase select with user filter
  // const { data: { user } } = await supabase.auth.getUser();
  // if (!user) return [];
  // 
  // const { data, error } = await supabase
  //   .from('flyer_instances')
  //   .select('*')
  //   .eq('user_id', user.id)
  //   .order('updated_at', { ascending: false });
  // 
  // if (error) {
  //   throw new Error(`Failed to load flyers: ${error.message}`);
  // }
  // 
  // return (data || []).map((row) => ({
  //   id: row.id,
  //   templateId: row.template_id,
  //   title: row.title,
  //   data: row.data,
  //   createdAt: row.created_at,
  //   updatedAt: row.updated_at,
  // }));
  
  console.log('TODO: Load all flyer instances from Supabase');
  return [];
}

