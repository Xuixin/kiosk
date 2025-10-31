# RxDB Types Organization

This directory contains all RxDB type definitions organized in a scalable structure.

## Structure

```
types/
├── utils.ts                    # Utility type helpers
├── database.types.ts           # Main database types (collections union)
├── index.ts                    # Exports all types
└── collections/                # One file per collection
    ├── txn.types.ts
    ├── handshake.types.ts
    ├── door.types.ts
    ├── log.types.ts
    └── log-client.types.ts
```

## Adding a New Collection

When you need to add a new collection (e.g., `product`):

### Step 1: Create Collection Types File

Create `collections/product.types.ts`:

```typescript
import { ProductDocument } from "../../../../../schema";
import { CreateRxDocument, CreateRxCollection } from "../utils";

/**
 * ORM methods for Product collection
 */
export interface RxProductMethods {
  findAll: () => Promise<RxProductDocument[]>;
  findById: (id: string) => Promise<RxProductDocument | null>;
  create: (product: ProductDocument) => Promise<RxProductDocument>;
  update: (product: ProductDocument) => Promise<RxProductDocument>;
  // Add custom methods if needed
  findByCategory?: (category: string) => Promise<RxProductDocument[]>;
}

export type RxProductDocument = CreateRxDocument<ProductDocument, RxProductMethods>;
export type RxProductCollection = CreateRxCollection<ProductDocument, RxProductMethods>;
```

### Step 2: Add to Database Types

Update `database.types.ts`:

```typescript
import { RxProductCollection } from "./collections/product.types";

export interface RxTxnsCollections {
  // ... existing collections
  product: RxProductCollection; // Add this line
}
```

### Step 3: Export in Index

Update `types/index.ts`:

```typescript
export * from "./collections/product.types";
```

## Benefits

1. **Scalable**: Easy to add new collections without modifying existing files
2. **Maintainable**: Each collection is isolated in its own file
3. **Type-safe**: Utility helpers ensure consistent type definitions
4. **Clear structure**: Easy to find and modify specific collection types

## Utility Types

The `utils.ts` file provides helper types:

- `CreateRxDocument<DocType, Methods>` - Creates RxDocument type
- `CreateRxCollection<DocType, Methods>` - Creates RxCollection type
- `CreateRxDatabase<Collections>` - Creates RxDatabase type

Use these helpers to reduce boilerplate when adding new collections.
