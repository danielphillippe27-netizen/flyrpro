import { z } from 'zod';
const cleanupSchema = z.object({
  request_id: z.uuid(), storage_state: z.enum(['pending', 'done', 'error']),
  provider_state: z.enum(['pending', 'done', 'error', 'unavailable']),
  storage_not_before: z.string().datetime({ offset: true }), created_at: z.string().datetime({ offset: true }),
  completed_at: z.string().datetime({ offset: true }).nullable(),
}).strict();
export const deletionStatusSchema = z.object({
  recordingId: z.uuid(), deletionEnabled: z.boolean(), hidden: z.boolean(), captureStopped: z.boolean(), cleanup: cleanupSchema.nullable(),
}).strict().refine(value => !value.cleanup || value.hidden, 'Cleanup requires a hidden recording');
export const deletionReceiptSchema = z.object({
  recordingId: z.uuid(), requestId: z.uuid(), storageState: z.enum(['pending', 'done', 'error']),
  providerState: z.enum(['pending', 'done', 'error', 'unavailable']), replayed: z.boolean(), hidden: z.literal(true), fullyDeleted: z.literal(false),
}).strict();
export function checkedDeletionStatus(value: unknown, recordingId: string) {
  const status = deletionStatusSchema.parse(value);
  if (status.recordingId.toLowerCase() !== z.uuid().parse(recordingId).toLowerCase()) throw new Error('Deletion recording identity changed');
  return status;
}
export function checkedDeletionReceipt(value: unknown, recordingId: string, requestId: string) {
  const receipt = deletionReceiptSchema.parse(value);
  if (receipt.recordingId.toLowerCase() !== z.uuid().parse(recordingId).toLowerCase() || receipt.requestId.toLowerCase() !== z.uuid().parse(requestId).toLowerCase()) throw new Error('Deletion request identity changed');
  return receipt;
}
