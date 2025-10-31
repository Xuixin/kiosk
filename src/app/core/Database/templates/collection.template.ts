/**
 * Collection Template
 *
 * This template shows how to add a new collection to the system using the NEW structure.
 * With the new table-based organization, all files for a collection are in one folder.
 *
 * To add a new collection (e.g., "product"):
 * 1. Create folder: collections/product/
 * 2. Create all files in that folder
 * 3. Register in CollectionRegistry
 */

// ============================================================================
// STEP 1: Register Collection in CollectionRegistry
// ============================================================================
// File: src/app/core/Database/core/collection-registry.ts
//
// Add entry to collections Map:
/*
[
  'product',
  {
    collectionName: 'product',
    collectionKey: 'product',
    replicationId: 'product-graphql-replication',
    serviceName: 'Product',
    displayName: 'Product',
    description: 'Product collection for managing products',
  },
],
*/

// ============================================================================
// STEP 2: Create Collection Folder Structure
// ============================================================================
// Create: src/app/core/Database/collections/product/
// Then create these files in that folder:

// ============================================================================
// File 1: collections/product/schema.ts
// ============================================================================
/*
import {
  RxJsonSchema,
  toTypedRxJsonSchema,
  ExtractDocumentTypeFromTypedRxJsonSchema,
} from 'rxdb';
import { SchemaDefinition } from '../../core/adapter';
import { convertRxDBSchemaToAdapter } from '../../core/schema-converter';

export interface ProductDocument {
  id: string;
  name: string;
  price: number;
  description?: string;
  category?: string;
  client_created_at: string;
  client_updated_at: string;
  server_created_at?: string;
  server_updated_at?: string;
}

export const PRODUCT_SCHEMA_LITERAL: RxJsonSchema<ProductDocument> = {
  title: 'Product',
  description: 'Product schema',
  version: 0,
  primaryKey: 'id',
  keyCompression: false,
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 100 },
    name: { type: 'string', maxLength: 200 },
    price: { type: 'number' },
    description: { type: 'string', maxLength: 1000 },
    category: { type: 'string', maxLength: 50 },
    client_created_at: { type: 'string', maxLength: 20 },
    client_updated_at: { type: 'string', maxLength: 20 },
    server_created_at: { type: 'string', maxLength: 20 },
    server_updated_at: { type: 'string', maxLength: 20 },
  },
  required: ['id', 'name', 'price', 'client_created_at'],
};

export const productSchema = toTypedRxJsonSchema(PRODUCT_SCHEMA_LITERAL);
export type RxProductDocumentType = ExtractDocumentTypeFromTypedRxJsonSchema<
  typeof productSchema
>;
export const PRODUCT_SCHEMA: RxJsonSchema<RxProductDocumentType> = PRODUCT_SCHEMA_LITERAL;

// Export adapter-compatible schema
export const PRODUCT_SCHEMA_ADAPTER: SchemaDefinition = convertRxDBSchemaToAdapter(
  'product',
  PRODUCT_SCHEMA as any,
);
*/

// ============================================================================
// File 2: collections/product/types.ts
// ============================================================================
/*
import { ProductDocument } from './schema';
import { CreateRxDocument, CreateRxCollection } from '../../core/types/utils';

export interface RxProductMethods {
  findAll: () => Promise<RxProductDocument[]>;
  findById: (id: string) => Promise<RxProductDocument | null>;
  create: (product: ProductDocument) => Promise<RxProductDocument>;
  update: (product: ProductDocument) => Promise<RxProductDocument>;
}

export type RxProductDocument = CreateRxDocument<ProductDocument, RxProductMethods>;
export type RxProductCollection = CreateRxCollection<ProductDocument, RxProductMethods>;
*/

// ============================================================================
// File 3: collections/product/query-builder.ts (Optional, for GraphQL)
// ============================================================================
/*
// GraphQL Mutation สำหรับ Push Product
export const PUSH_PRODUCT_MUTATION = `
  mutation PushProduct($writeRows: [ProductInputPushRow!]!) {
    pushProduct(input: $writeRows) {
      id
      name
      price
      server_created_at
      server_updated_at
      client_created_at
      client_updated_at
    }
  }
`;

// GraphQL Query สำหรับ Pull Product
export const PULL_PRODUCT_QUERY = `
  query PullProduct($input: ProductPull!) {
    pullProduct(input: $input) {
      documents {
        id
        name
        price
        client_created_at
        client_updated_at
        server_created_at
        server_updated_at
        deleted
      }
      checkpoint {
        id
        server_updated_at
      }
    }
  }
`;

// GraphQL Subscription สำหรับ Stream Product (Real-time)
export const STREAM_PRODUCT_SUBSCRIPTION = `
  subscription StreamProduct {
    streamProduct {
      documents {
        id
        name
        price
        client_created_at
        client_updated_at
        server_created_at
        server_updated_at
      }
      checkpoint {
        id
        server_updated_at
      }
    }
  }
`;
*/

// ============================================================================
// File 4: collections/product/facade.service.ts (Optional)
// ============================================================================
/*
import { Injectable, computed, signal } from '@angular/core';
import { ProductDocument } from './schema';
import { BaseFacadeService } from '../../core/base-facade.service';
import { COLLECTION_NAMES } from '../../core/collection-registry';

@Injectable({
  providedIn: 'root',
})
export class ProductService extends BaseFacadeService<ProductDocument> {
  private _products = signal<ProductDocument[]>([]);
  public readonly products = this._products.asReadonly();

  constructor() {
    super();
    this.ensureInitialized();
  }

  protected getCollectionName(): string {
    return COLLECTION_NAMES.PRODUCT; // Add to COLLECTION_NAMES in collection-registry.ts
  }

  protected setupSubscriptions(): void {
    const collection = this.collection;
    if (!collection) {
      console.warn('Product collection not ready');
      return;
    }

    const subscription = collection.find$().subscribe({
      next: (products) => {
        this._products.set(products as ProductDocument[]);
      },
      error: (error) => {
        console.error('Error in product database subscription:', error);
      },
    });

    this.addSubscription(subscription);
  }

  async findAll(): Promise<ProductDocument[]> {
    const collection = this.collection;
    if (!collection) {
      throw new Error('Product collection not available');
    }
    return (await collection.find()) as ProductDocument[];
  }

  async findById(id: string): Promise<ProductDocument | null> {
    const collection = this.collection;
    if (!collection) {
      return null;
    }
    return (await collection.findOne(id)) as ProductDocument | null;
  }

  async create(product: ProductDocument): Promise<ProductDocument> {
    const collection = this.collection;
    if (!collection) {
      throw new Error('Product collection not available');
    }
    return (await collection.insert(product)) as ProductDocument;
  }

  async update(id: string, updates: Partial<ProductDocument>): Promise<ProductDocument> {
    const collection = this.collection;
    if (!collection) {
      throw new Error('Product collection not available');
    }
    return (await collection.update(id, updates)) as ProductDocument;
  }
}
*/

// ============================================================================
// File 5: collections/product/replication.service.ts (Optional)
// ============================================================================
/*
import { Injectable } from '@angular/core';
import { replicateGraphQL } from 'rxdb/plugins/replication-graphql';
import { RxGraphQLReplicationState } from 'rxdb/plugins/replication-graphql';
import { RxCollection } from 'rxdb';
import { NetworkStatusService } from '../../network-status.service';
import { BaseReplicationService } from '../../core/base-replication.service';
import { ProductDocument } from './schema';
import {
  PUSH_PRODUCT_MUTATION,
  PULL_PRODUCT_QUERY,
  STREAM_PRODUCT_SUBSCRIPTION,
} from './query-builder';
import { ReplicationConfig } from '../../core/adapter';
import {
  ReplicationConfigBuilder,
  ReplicationConfigOptions,
} from '../../core/replication-config-builder';

@Injectable({
  providedIn: 'root',
})
export class ProductReplicationService extends BaseReplicationService<ProductDocument> {
  constructor(networkStatus: NetworkStatusService) {
    super(networkStatus);
    this.collectionName = 'product';
  }

  protected buildReplicationConfig(): ReplicationConfig & Record<string, any> {
    const options: ReplicationConfigOptions = {
      collectionName: 'product',
      replicationId: this.replicationIdentifier,
      batchSize: 10,
      pullQueryBuilder: (checkpoint, limit) => {
        return {
          query: PULL_PRODUCT_QUERY,
          variables: {
            input: {
              checkpoint: ReplicationConfigBuilder.buildCheckpointInput(checkpoint),
              limit: limit || 10,
            },
          },
        };
      },
      streamQueryBuilder: (headers) => {
        return {
          query: STREAM_PRODUCT_SUBSCRIPTION,
          variables: {},
        };
      },
      responseModifier: ReplicationConfigBuilder.createResponseModifier([
        'pullProduct',
        'streamProduct',
      ]),
      pullModifier: (doc) => doc,
      pushQueryBuilder: (docs) => {
        const writeRows = docs.map((docRow) => {
          const doc = docRow.newDocumentState;
          return {
            newDocumentState: {
              id: doc.id,
              name: doc.name,
              price: doc.price,
              client_created_at: doc.client_created_at || Date.now().toString(),
              client_updated_at: doc.client_updated_at || Date.now().toString(),
              server_created_at: doc.server_created_at,
              server_updated_at: doc.server_updated_at,
              deleted: docRow.assumedMasterState === null,
            },
          };
        });
        return {
          query: PUSH_PRODUCT_MUTATION,
          variables: {
            writeRows,
          },
        };
      },
      pushDataPath: 'data.pushProduct',
      pushModifier: (doc) => doc,
    };

    return ReplicationConfigBuilder.buildBaseConfig(options);
  }

  protected async setupReplication(
    collection: RxCollection,
  ): Promise<RxGraphQLReplicationState<ProductDocument, any> | undefined> {
    console.log('Setting up Product GraphQL replication...');
    if (!this.networkStatus.isOnline()) {
      console.log('⚠️ Application is offline - replication setup skipped');
      return undefined;
    }

    const config = this.buildReplicationConfig() as any;
    this.replicationState = replicateGraphQL<ProductDocument, any>({
      collection: collection as any,
      ...config,
    });

    if (this.replicationState) {
      this.replicationState.error$.subscribe((error) => {
        console.warn('⚠️ Product Replication error:', error);
      });

      this.replicationState.received$.subscribe((received) => {
        console.log('✅ Product Replication received:', received);
      });
    }

    return this.replicationState;
  }
}
*/

// ============================================================================
// File 6: collections/product/index.ts
// ============================================================================
/*
// Product Collection Index File
//
// This module exports all components of the product collection:
// - Schema definitions
// - RxDB types
// - Facade service (ProductService)
// - Replication service
// - Query builders (GraphQL)

// Schema
export * from './schema';

// Types
export * from './types';

// Services
export { ProductService } from './facade.service';
export { ProductReplicationService } from './replication.service';

// Query builders
export * from './query-builder';
*/

// ============================================================================
// STEP 3: Update Database Types
// ============================================================================
// File: src/app/core/Database/core/types/database.types.ts
//
// Add import and update interface:
/*
import { RxProductCollection } from '../../collections/product/types';

export interface RxTxnsCollections {
  // ... existing collections
  product: RxProductCollection;
}
*/

// ============================================================================
// STEP 4: Update getAdapterSchemas (for database initialization)
// ============================================================================
// File: src/app/core/Database/core/adapters/rxdb/rxdb-helpers.ts
//
// Add import and add to return array:
/*
import { PRODUCT_SCHEMA_ADAPTER } from '../../../collections/product/schema';

export function getAdapterSchemas(): SchemaDefinition[] {
  return [
    // ... existing schemas
    PRODUCT_SCHEMA_ADAPTER,
  ];
}
*/

// ============================================================================
// STEP 5: Update Database Service (if using replication)
// ============================================================================
// File: src/app/core/Database/database.service.ts
//
// Add import and case in switch:
/*
import { ProductReplicationService } from './collections/product';

// In initializeReplicationServices function:
case 'product':
  service = new ProductReplicationService(networkStatusService);
  break;
*/

// ============================================================================
// SUMMARY
// ============================================================================
// New structure benefits:
// ✅ All collection files in one folder (self-contained)
// ✅ Easy to add new table: just create folder + files
// ✅ Clear organization: find everything related to a table in one place
// ✅ Team-friendly: each dev can work on different tables without conflicts
//
// Example structure:
// collections/
//   product/
//     ├── schema.ts
//     ├── types.ts
//     ├── facade.service.ts
//     ├── replication.service.ts
//     ├── query-builder.ts
//     └── index.ts
//
