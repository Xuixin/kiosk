import { CreateRxDatabase } from './utils';
import { RxTxnCollection } from '../../collections/txn/types';
import { RxHandshakeCollection } from '../../collections/handshake/types';
import { RxDoorCollection } from '../../collections/door/types';
import { RxLogClientCollection } from '../../collections/log_client/types';
// Note: log collection types are still in old location (TODO: Move to collections/log/)
import { RxLogCollection } from '../adapters/rxdb/types/collections/log.types';

/**
 * All collections in the database
 * To add a new collection:
 * 1. Create a folder in collections/{table-name}/
 * 2. Create types.ts in that folder
 * 3. Import the collection type here
 * 4. Add it to RxTxnsCollections interface
 */
export interface RxTxnsCollections {
  txn: RxTxnCollection;
  handshake: RxHandshakeCollection;
  door: RxDoorCollection;
  log: RxLogCollection;
  log_client: RxLogClientCollection;
  [key: string]: any; // Index signature for compatibility
}

/**
 * Main database type
 */
export type RxTxnsDatabase = CreateRxDatabase<RxTxnsCollections>;
