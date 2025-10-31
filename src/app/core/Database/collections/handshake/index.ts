/**
 * Handshake Collection
 *
 * This module exports all components of the handshake collection:
 * - Schema definitions
 * - RxDB types
 * - Facade service (HandshakeService)
 * - Replication service
 * - Query builders (GraphQL)
 */

// Schema
export * from './schema';

// Types
export * from './types';

// Services
export { HandshakeService } from './facade.service';
export { HandshakeReplicationService } from './replication.service';

// Query builders
export * from './query-builder';
