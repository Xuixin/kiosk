# Migration Guide: Database Adapter Pattern

This guide helps developers migrate from direct RxDB usage to the adapter pattern.

## Quick Reference

### Before (Direct RxDB)

```typescript
import { DatabaseService } from './core/Database/database.service';

constructor(private dbService: DatabaseService) {}

async getData() {
  const docs = await this.dbService.db.collection.find().exec();
  return docs;
}
```

### After (Adapter Pattern)

```typescript
import { AdapterProviderService } from './core/Database/factory';

constructor(private adapterProvider: AdapterProviderService) {}

async getData() {
  await this.adapterProvider.waitUntilReady();
  const collection = this.adapterProvider.getAdapter().getCollection('collectionName');
  return collection.find();
}
```

## Step-by-Step Migration

### 1. Replace DatabaseService Injection

**Before:**

```typescript
constructor(private dbService: DatabaseService) {}
```

**After:**

```typescript
import { AdapterProviderService } from './core/Database/factory';

constructor(private adapterProvider: AdapterProviderService) {}
```

### 2. Wait for Initialization

Always wait for the adapter to be ready before use:

```typescript
async getData() {
  await this.adapterProvider.waitUntilReady();
  // Now safe to use
}
```

### 3. Get Collection

**Before:**

```typescript
const collection = this.dbService.db.collectionName;
```

**After:**

```typescript
const adapter = this.adapterProvider.getAdapter();
const collection = adapter.getCollection<T>("collectionName");
```

### 4. Replace Operations

#### Find All

**Before:**

```typescript
const docs = await this.dbService.db.collection.find().exec();
```

**After:**

```typescript
const docs = await collection.find();
```

#### Find One

**Before:**

```typescript
const doc = await this.dbService.db.collection.findOne(id).exec();
```

**After:**

```typescript
const doc = await collection.findOne(id);
```

#### Insert

**Before:**

```typescript
await this.dbService.db.collection.insert(document);
```

**After:**

```typescript
await collection.insert(document);
```

#### Update

**Before:**

```typescript
const doc = await this.dbService.db.collection.findOne(id).exec();
await doc.update({ $set: { field: value } });
```

**After:**

```typescript
await collection.update(id, { field: value });
```

#### Delete

**Before:**

```typescript
const doc = await this.dbService.db.collection.findOne(id).exec();
await doc.remove();
```

**After:**

```typescript
await collection.delete(id); // soft delete
await collection.delete(id, true); // hard delete
```

### 5. Reactive Queries

#### Find Observable

**Before:**

```typescript
this.dbService.db.collection.find().$.subscribe((docs) => {
  // handle docs
});
```

**After:**

```typescript
collection.find$().subscribe((docs) => {
  // handle docs
});
```

#### FindOne Observable

**Before:**

```typescript
this.dbService.db.collection.findOne(id).$.subscribe((doc) => {
  // handle doc
});
```

**After:**

```typescript
collection.findOne$(id).subscribe((doc) => {
  // handle doc
});
```

## Common Patterns

### Service with Reactive Data

```typescript
@Injectable({ providedIn: "root" })
export class MyService implements OnDestroy {
  private readonly adapterProvider = inject(AdapterProviderService);
  private subscription?: Subscription;

  private _data = signal<MyDocument[]>([]);
  readonly data = this._data.asReadonly();

  constructor() {
    this.setupSubscription();
  }

  private async setupSubscription() {
    await this.adapterProvider.waitUntilReady();
    const collection = this.adapterProvider.getAdapter().getCollection<MyDocument>("collectionName");

    this.subscription = collection.find$().subscribe({
      next: (docs) => this._data.set(docs),
      error: (err) => console.error("Subscription error:", err),
    });
  }

  ngOnDestroy() {
    this.subscription?.unsubscribe();
  }
}
```

### Using Facade Services

For common operations, prefer using facade services:

```typescript
// Instead of adapter directly
constructor(private transactionService: TransactionService) {}

async getTransactions() {
  return this.transactionService.getAll$();
}
```

## Benefits

1. **Database-agnostic**: Easy to switch backends
2. **Type-safe**: Better TypeScript support
3. **Consistent API**: Same interface across backends
4. **Future-proof**: Ready for new database backends

## Troubleshooting

### "Database not initialized yet"

**Problem:** Trying to access database before initialization.

**Solution:**

```typescript
await this.adapterProvider.waitUntilReady();
```

### Type Errors

**Problem:** Collection type doesn't match.

**Solution:** Specify generic type:

```typescript
const collection = adapter.getCollection<MyDocumentType>("collectionName");
```

## Need Help?

- Check `Database/README.md` for architecture overview
- See `adapter/README.md` for interface details
- Review existing facade services for examples
