import { RxJsonSchema } from 'rxdb';

export interface DoorDocument {
  id: string;
  name: string;
  description?: string;
  max_persons: number;
  status: string; // 'online' | 'offline'
  client_created_at: string;
  client_updated_at: string;
  server_created_at?: string;
  server_updated_at?: string;
  deleted?: boolean;
}

export const DOOR_SCHEMA_LITERAL: RxJsonSchema<DoorDocument> = {
  title: 'Door',
  description: 'Door schema for room/door access management',
  version: 0,
  primaryKey: 'id',
  keyCompression: false,
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 100 },
    name: { type: 'string', maxLength: 200 },
    description: { type: 'string', maxLength: 500 },
    max_persons: { type: 'number' },
    status: { type: 'string', maxLength: 20 },
    client_created_at: { type: 'string', maxLength: 20 },
    client_updated_at: { type: 'string', maxLength: 20 },
    server_created_at: { type: 'string', maxLength: 20 },
    server_updated_at: { type: 'string', maxLength: 20 },
    deleted: { type: 'boolean' },
  },
  required: ['id', 'name', 'max_persons', 'status', 'client_created_at'],
};

export const DOOR_SCHEMA = DOOR_SCHEMA_LITERAL;
export type DoorDocumentType = DoorDocument;
