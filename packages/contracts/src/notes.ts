import { z } from 'zod'

export const noteIdSchema = z.string().uuid()
export const encryptedPayloadSchema = z.string().min(1).max(6_000_000)
export const encryptionIvSchema = z.string().min(1).max(128)
export const changeSequenceSchema = z.string().regex(/^(0|[1-9]\d*)$/)

export const encryptedNoteRecordSchema = z.object({
  id: noteIdSchema,
  version: z.number().int().positive(),
  change_seq: changeSequenceSchema,
  updated_at: z.number().int().nonnegative(),
  is_deleted: z.boolean(),
  encrypted_data: encryptedPayloadSchema,
  data_iv: encryptionIvSchema,
})

export type EncryptedNoteRecordDto = z.infer<typeof encryptedNoteRecordSchema>

export const saveNoteRequestSchema = z.object({
  base_version: z.number().int().nonnegative(),
  encrypted_data: encryptedPayloadSchema,
  data_iv: encryptionIvSchema,
  is_deleted: z.boolean().default(false),
}).strict()

export type SaveNoteRequest = z.infer<typeof saveNoteRequestSchema>

export const saveNoteResponseSchema = z.object({
  note: encryptedNoteRecordSchema,
})

export type SaveNoteResponse = z.infer<typeof saveNoteResponseSchema>

export const versionConflictResponseSchema = z.object({
  error: z.literal('VERSION_CONFLICT'),
  current: encryptedNoteRecordSchema.nullable(),
})

export type VersionConflictResponse = z.infer<typeof versionConflictResponseSchema>

export const noteChangesResponseSchema = z.object({
  notes: z.array(encryptedNoteRecordSchema),
  next_cursor: z.string().min(1),
  has_more: z.boolean(),
})

export type NoteChangesResponse = z.infer<typeof noteChangesResponseSchema>

export const batchSaveNoteItemSchema = saveNoteRequestSchema.extend({
  id: noteIdSchema,
})

export const batchSaveNotesRequestSchema = z.object({
  notes: z.array(batchSaveNoteItemSchema).min(1).max(50),
}).strict()

export const batchSaveNoteResultSchema = z.discriminatedUnion('status', [
  z.object({
    id: noteIdSchema,
    status: z.literal('saved'),
    note: encryptedNoteRecordSchema,
  }),
  z.object({
    id: noteIdSchema,
    status: z.literal('conflict'),
    current: encryptedNoteRecordSchema.nullable(),
  }),
])

export const batchSaveNotesResponseSchema = z.object({
  results: z.array(batchSaveNoteResultSchema),
})

export type BatchSaveNotesRequest = z.infer<typeof batchSaveNotesRequestSchema>
export type BatchSaveNotesResponse = z.infer<typeof batchSaveNotesResponseSchema>
