import {
  ExtractDocumentTypeFromTypedRxJsonSchema,
  RxJsonSchema,
  toTypedRxJsonSchema,
} from 'rxdb';

export interface LogDocument {
  id: string;
  client_id: string;
  client_type: string;
  code?: string;
  message?: string;
  service_name?: string;
  meta_data?: string;
  server_created_at?: string;
  server_updated_at?: string;
  client_created_at: string;
  client_updated_at: string;
  diff_time_create?: number;
  diff_time_update?: number;
}

export const LOG_SCHEMA_LITERAL = {
  title: 'Log',
  description: 'Log schema',
  version: 0,
  primaryKey: 'id',
  keyCompression: false,
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 100 },
    client_id: { type: 'string', maxLength: 100 },
    client_type: { type: 'string', maxLength: 100 },
    code: { type: 'string', maxLength: 100 },
    message: { type: 'string', maxLength: 100 },
    service_name: { type: 'string', maxLength: 100 },
    meta_data: { type: 'string', maxLength: 100 },
    server_created_at: { type: 'string', maxLength: 100 },
    server_updated_at: { type: 'string', maxLength: 100 },
    client_created_at: { type: 'string', maxLength: 100 },
    client_updated_at: { type: 'string', maxLength: 100 },
    diff_time_create: { type: 'number' },
    diff_time_update: { type: 'number' },
  },
  required: ['id', 'client_id', 'client_type', 'client_created_at'],
  indexes: ['client_created_at', 'client_id'],
};

export const logSchema = toTypedRxJsonSchema(LOG_SCHEMA_LITERAL);

export type RxLogDocumentType = ExtractDocumentTypeFromTypedRxJsonSchema<
  typeof logSchema
>;
export const LOG_SCHEMA: RxJsonSchema<RxLogDocumentType> = LOG_SCHEMA_LITERAL;

// Export adapter-compatible schema
import { SchemaDefinition } from '../Database/adapter';
import { convertRxDBSchemaToAdapter } from './schema-converter';

export const LOG_SCHEMA_ADAPTER: SchemaDefinition = convertRxDBSchemaToAdapter(
  'log',
  LOG_SCHEMA as any,
);
