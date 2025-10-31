# Database Abstraction Layer

This directory contains the database abstraction layer that enables database-agnostic operations while maintaining backward compatibility with RxDB.

## Architecture

The database layer uses an **adapter pattern** to abstract database operations from specific implementations, allowing the application to work with different database backends (RxDB, PouchDB, WatermelonDB, etc.) through a unified interface.

### Directory Structure

```
Database/
├── adapter/              # Core interfaces and types
│   ├── db-adapter.interface.ts          # Main DBAdapter interface
│   ├── collection-adapter.interface.ts # Collection operations interface
│   ├── replication-adapter.interface.ts # Replication interface
│   ├── query.types.ts                   # Query-related types
│   └── index.ts                         # Exports all interfaces
│
├── adapters/             # Concrete implementations
│   └── rxdb/             # RxDB adapter implementation
│       ├── rxdb-adapter.ts              # Main RxDB adapter
│       ├── rxdb-collection-adapter.ts   # RxDB collection adapter
│       ├── rxdb-replication-adapter.ts  # RxDB replication adapter
│       └── index.ts                     # Exports
│
├── factory/              # Adapter creation and dependency injection
│   ├── adapter-factory.ts               # Factory for creating adapters
│   ├── adapter-provider.service.ts      # Angular service for adapter access
│   └── index.ts                         # Exports
│
├── facade/               # High-level service facades
│   ├── transaction.service.ts           # Transaction operations
│   ├── door.service.ts                  # Door operations
│   ├── handshake.service.ts             # Handshake operations
│   ├── log-client.service.ts           # Log client operations
│   └── index.ts                         # Exports
│
├── replication/          # Replication services
│   ├── base-replication.service.ts      # Base replication service
│   ├── transaction-replication.service.ts
│   ├── door-replication.service.ts
│   ├── handshake-replication.service.ts
│   ├── log-client-replication.service.ts
│   └── index.ts
│
├── query-builder/        # GraphQL query builders
│   ├── base-query-builder.ts
│   ├── txn-query-builder.ts
│   ├── door-query-builder.ts
│   ├── handshake-query-builder.ts
│   └── log-client-builder.ts
│
├── document/             # Documentation files
│
├── database.service.ts   # Main DatabaseService using adapter pattern
└── network-status.service.ts # Network status monitoring
```

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

- **Provided in:** `root` (singleton)
- **Initialization:** Automatically initialized during app bootstrap
- **Usage:** Inject `AdapterProviderService` to access the database adapter

```typescript
// Example usage
constructor(private adapterProvider: AdapterProviderService) {}

async getData() {
  await this.adapterProvider.waitUntilReady();
  const collection = this.adapterProvider.getAdapter().getCollection<T>('collectionName');
  return collection.find();
}
```

## Migration Guide

### For Service Developers

**Before (Direct RxDB):**

```typescript
constructor(private dbService: DatabaseService) {}

getDocuments() {
  return this.dbService.db.collection.find().exec();
}
```

**After (Adapter Pattern):**

```typescript
constructor(private adapterProvider: AdapterProviderService) {}

async getDocuments() {
  await this.adapterProvider.waitUntilReady();
  const collection = this.adapterProvider.getAdapter().getCollection('collectionName');
  return collection.find();
}
```

### Using Facade Services

For common operations, use the facade services which already use the adapter:

```typescript
// Transaction operations
constructor(private transactionService: TransactionService) {}

// Door operations
constructor(private doorService: DoorService) {}
```

## Configuration

The database adapter type is configured in `environment.ts`:

```typescript
export const environment = {
  adapterType: "rxdb" as const, // 'rxdb' | 'pouchdb' | 'watermelon' | etc.
  // ... other config
};
```

## Adding a New Database Backend

1. **Create adapter implementation** in `adapters/[backend-name]/`:
   - Implement `DBAdapter` interface
   - Implement `CollectionAdapter` interface
   - Implement `ReplicationAdapter` interface (if supported)

2. **Update factory** in `factory/adapter-factory.ts`:
   - Add case for new adapter type
   - Handle dynamic import

3. **Update environment** configuration

4. **Test** with all existing facade services

## Backward Compatibility

- All existing services continue to work
- `DatabaseService` still available but uses adapter internally
- RxDB-specific code preserved for gradual migration
- Public APIs remain unchanged

## Future Enhancements

- [ ] Add PouchDB adapter
- [ ] Add WatermelonDB adapter
- [ ] Add server-side adapter (REST/GraphQL direct sync)
- [ ] Performance monitoring and metrics
- [ ] Database migration utilities
