import { z } from 'zod';
import { writingSchema } from './writing';

// Approval/application is a separate atomic operation. Saving a draft must
// never silently create a CRM task or mark a contact do-not-contact.
export const reviewDraftSchema = z.object({
  version: z.number().int().positive(),
  operation: z.enum(['save_draft', 'reject']),
  writing: writingSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.operation === 'save_draft' && !value.writing) context.addIssue({ code: 'custom', message: 'Draft content required', path: ['writing'] });
  if (value.operation === 'reject' && value.writing) context.addIssue({ code: 'custom', message: 'Rejection cannot replace draft content', path: ['writing'] });
});

export const assignmentSchema = z.object({
  version: z.number().int().positive(), operation: z.literal('confirm_assignment'),
  targetId: z.uuid().nullable(), consent: z.enum(['granted', 'declined', 'unknown']),
  permissionConfirmed: z.boolean(),
}).strict().refine(value => value.consent !== 'granted' || value.permissionConfirmed, 'Explicit recording permission required');
export const conversationReviewSchema = z.union([reviewDraftSchema, assignmentSchema]);

export { applicationSchema } from './application-request';
