/**
 * Door Collection
 *
 * This module exports all components of the door collection:
 * - Schema definitions
 * - RxDB types
 * - Facade service (DoorFacade)
 * - Replication service
 * - Query builders (GraphQL)
 */

// Schema
export * from './schema';

// Types
export * from './types';

// Services
export { DoorFacade } from './facade.service';
export { DoorReplicationService } from './replication.service';

// Query builders
export * from './query-builder';
