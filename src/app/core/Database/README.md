# Database Abstraction Layer

This directory contains the database abstraction layer that enables database-agnostic operations while maintaining backward compatibility with RxDB.

## Architecture

The database layer uses an **adapter pattern** to abstract database operations from specific implementations, allowing the application to work with different database backends (RxDB, PouchDB, WatermelonDB, etc.) through a unified interface.

### Directory Structure (Table-Based Organization)

```
Database/
├── core/                      # Shared/base classes and utilities
│   ├── base-facade.service.ts         # Base class for facade services
│   ├── base-replication.service.ts    # Base class for replication services
│   ├── replication-config-builder.ts # Replication config builder utility
│   ├── collection-registry.ts         # Central collection registry
│   ├── base-schema.ts                 # Base schema utilities
│   ├── schema-converter.ts            # Schema converter utilities
│   ├── adapter/                       # Core adapter interfaces
│   │   ├── db-adapter.interface.ts
│   │   ├── collection-adapter.interface.ts
│   │   ├── replication-adapter.interface.ts
│   │   └── query.types.ts
│   ├── adapters/                      # Concrete adapter implementations
│   │   └── rxdb/                      # RxDB adapter
│   │       ├── rxdb-adapter.ts
│   │       ├── rxdb-collection-adapter.ts
│   │       ├── rxdb-replication-adapter.ts
│   │       └── rxdb-helpers.ts
│   ├── factory/                       # Adapter factory and provider
│   │   ├── adapter-factory.ts
│   │   └── adapter-provider.service.ts
│   └── types/                         # Shared types
│       ├── database.types.ts          # Main database type (RxTxnsDatabase)
│       ├── utils.ts                   # Type utility helpers
│       └── base-query-builder.ts      # Base query builder
│
├── collections/               # Table-based organization (NEW!)
│   ├── txn/                   # Transaction collection
│   │   ├── schema.ts
│   │   ├── types.ts
│   │   ├── facade.service.ts
│   │   ├── replication.service.ts
│   │   ├── query-builder.ts
│   │   └── index.ts
│   ├── door/                   # Door collection
│   │   ├── schema.ts
│   │   ├── types.ts
│   │   ├── facade.service.ts
│   │   ├── replication.service.ts
│   │   ├── query-builder.ts
│   │   └── index.ts
│   ├── handshake/             # Handshake collection
│   │   └── ... (same structure)
│   └── log_client/            # Log client collection
│       └── ... (same structure)
│
├── schema/                    # Legacy schemas (only log collection)
│   └── log-schema.ts          # TODO: Move to collections/log/
│
├── document/                   # Documentation
│   ├── ADD_NEW_TABLE.md        # Guide for adding new collections
│   ├── DEVELOPER_GUIDE.md
│   └── ...
│
├── templates/                  # Code templates
│   └── collection.template.ts  # Template for new collections
│
├── database.service.ts         # Main DatabaseService
└── network-status.service.ts   # Network status monitoring
```

## Key Benefits of New Structure

### ✅ Table-Based Organization

- **Self-contained**: All files for a table are in one folder
- **Easy to add**: Just create a new folder with all files
- **Easy to find**: Everything related to a table in one place
- **Team-friendly**: Each developer can work on different tables without conflicts

### ✅ Separation of Concerns

- **core/**: Shared utilities, base classes, and adapter implementations
- **collections/**: Table-specific business logic (self-contained)
- Clear separation makes the codebase easier to understand and maintain

## Core Concepts

### 1. DBAdapter Interface

The `DBAdapter` interface defines the contract for all database backends:

```typescript
interface DBAdapter {
  initialize(schemas: SchemaDefinition[]): Promise<void>;
  getCollection<T>(collectionName: string): CollectionAdapter<T>;
  close(): Promise<void>;
  getInfo(): Promise<DatabaseInfo>;
  isReady(): boolean;
  getReplication(): ReplicationAdapter;
}
```

### 2. CollectionAdapter Interface

Provides collection-level operations:

```typescript
interface CollectionAdapter<T> {
  find(selector?: QuerySelector<T>): Promise<T[]>;
  findOne(idOrSelector: string | QuerySelector<T>): Promise<T | null>;
  insert(document: Partial<T>): Promise<T>;
  update(id: string, updates: Partial<T>): Promise<T>;
  delete(id: string, hard?: boolean): Promise<boolean>;
  find$(selector?: QuerySelector<T>): Observable<T[]>;
  findOne$(idOrSelector: string | QuerySelector<T>): Observable<T | null>;
  query(query: QueryRequest<T>): Promise<QueryResult<T>>;
}
```

### 3. AdapterProviderService

Angular service that manages the database adapter lifecycle:

```typescript
@Injectable({ providedIn: "root" })
export class AdapterProviderService {
  getAdapter(): DBAdapter;
  isReady(): boolean;
  waitUntilReady(): Promise<DBAdapter>;
}
```

### 4. Base Classes

- **BaseFacadeService**: Base class for facade services with automatic subscription management
- **BaseReplicationService**: Base class for replication services with network handling
- **ReplicationConfigBuilder**: Utility to build replication configurations

### 5. Collection Registry

Central registry for all collections:

```typescript
export class CollectionRegistry {
  static get(name: string): CollectionMetadata | undefined;
  static getAll(): CollectionMetadata[];
  // ...
}
```

## Adding a New Collection

See the detailed guide: [ADD_NEW_TABLE.md](./document/ADD_NEW_TABLE.md)

**Quick Steps:**

1. Register in `core/collection-registry.ts`
2. Create folder: `collections/{table-name}/`
3. Create files: `schema.ts`, `types.ts`, `facade.service.ts`, `replication.service.ts`, `query-builder.ts`, `index.ts`
4. Update `core/types/database.types.ts`
5. Update `core/adapters/rxdb/rxdb-helpers.ts`

## Usage Examples

### Using Facade Service

```typescript
import { TransactionService } from "./core/Database/collections/txn";

export class MyComponent {
  private transactionService = inject(TransactionService);

  async ngOnInit() {
    // Access reactive data via signals
    const transactions = this.transactionService.transactions();

    // Or use async methods
    const allTxns = await this.transactionService.findAll();
  }
}
```

### Direct Adapter Access

```typescript
import { AdapterProviderService } from "./core/Database/core/factory";

export class MyService {
  private adapterProvider = inject(AdapterProviderService);

  async getData() {
    await this.adapterProvider.waitUntilReady();
    const adapter = this.adapterProvider.getAdapter();
    const collection = adapter.getCollection<MyDocument>("my_collection");
    return await collection.find();
  }
}
```

## Migration Notes

### From Old Structure to New Structure

**Old (Function-Based):**

```
Database/
├── schema/txn.schema.ts
├── facade/transaction.service.ts
├── replication/transaction-replication.service.ts
└── adapters/rxdb/types/collections/txn.types.ts
```

**New (Table-Based):**

```
Database/
└── collections/txn/
    ├── schema.ts
    ├── types.ts
    ├── facade.service.ts
    ├── replication.service.ts
    └── query-builder.ts
```

All files for a collection are now in one folder!

## Documentation

- **[ADD_NEW_TABLE.md](./document/ADD_NEW_TABLE.md)**: Complete guide for adding new collections
- **[DEVELOPER_GUIDE.md](./document/DEVELOPER_GUIDE.md)**: General developer guide
- **[Collection Template](./templates/collection.template.ts)**: Code template for new collections

## Related Files

- `database.service.ts`: Main service for database operations
- `network-status.service.ts`: Network status monitoring for offline-first operations
- `core/collection-registry.ts`: Central collection registry

---

**Last Updated**: 2025-01-XX
**Version**: 3.0 (Table-Based Organization)
