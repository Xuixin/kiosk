// Core base classes
export * from './base-facade.service';
export * from './base-replication.service';
export * from './replication-config-builder';

// Registry
export * from './collection-registry';

// Adapters
export * from './adapter';
// Note: adapters exports types separately, avoid duplicate exports
export {
  RxDBAdapter,
  RxDBCollectionAdapter,
  RxDBReplicationAdapter,
  getAdapterSchemas,
  setupDebugRxDB,
} from './adapters/rxdb';

// Factory
export * from './factory';

// Types - export specific items to avoid conflicts
export type {
  CreateRxDocument,
  CreateRxCollection,
  CreateRxDatabase,
} from './types/utils';
export type { RxTxnsCollections, RxTxnsDatabase } from './types/database.types';
export {
  BaseQueryBuilder,
  type QueryBuilderConfig,
} from './types/base-query-builder';

// Schema utilities
export {
  BaseDocument,
  type SchemaConfig,
  createSchema,
  type ExtractDocumentType,
} from './base-schema';
export * from './schema-converter';
