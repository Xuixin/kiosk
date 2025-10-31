import { CreateRxDatabase } from './utils';
import { RxTxnCollection } from './collections/txn.types';
import { RxHandshakeCollection } from './collections/handshake.types';
import { RxDoorCollection } from './collections/door.types';
import { RxLogCollection } from './collections/log.types';
import { RxLogClientCollection } from './collections/log-client.types';

/**
 * All collections in the database
 * To add a new collection:
 * 1. Create a new file in collections/ folder
 * 2. Import the collection type here
 * 3. Add it to RxTxnsCollections interface
 */
export interface RxTxnsCollections {
  txn: RxTxnCollection;
  handshake: RxHandshakeCollection;
  door: RxDoorCollection;
  log: RxLogCollection;
  log_client: RxLogClientCollection;
}

/**
 * Main database type
 */
export type RxTxnsDatabase = CreateRxDatabase<RxTxnsCollections>;
