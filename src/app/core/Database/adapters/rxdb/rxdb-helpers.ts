import { Injector, Signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RxReactivityFactory, createRxDatabase } from 'rxdb/plugins/core';
import { environment } from '../../../../../environments/environment';
import {
  TXN_SCHEMA,
  HANDSHAKE_SCHEMA,
  DOOR_SCHEMA,
  LOG_CLIENT_SCHEMA,
  LOG_SCHEMA,
  convertRxDBSchemaToAdapter,
} from '../../../schema';
import { SchemaDefinition } from '../../adapter';
import { RxTxnsCollections, RxTxnsDatabase } from './types';

export const DATABASE_NAME = 'kiosk_db';

/**
 * Get adapter-compatible schemas
 * Uses the shared schema converter utility for consistent conversion
 */
export function getAdapterSchemas(): SchemaDefinition[] {
  return [
    convertRxDBSchemaToAdapter('txn', TXN_SCHEMA as any),
    convertRxDBSchemaToAdapter('handshake', HANDSHAKE_SCHEMA as any),
    convertRxDBSchemaToAdapter('door', DOOR_SCHEMA as any),
    convertRxDBSchemaToAdapter('log_client', LOG_CLIENT_SCHEMA as any),
    convertRxDBSchemaToAdapter('log', LOG_SCHEMA as any),
  ];
}

/**
 * RxDB collection settings (used for backward compatibility)
 * Note: Collections are now managed by the adapter system
 */
export const collectionsSettings = {
  txn: {
    schema: TXN_SCHEMA as any,
  },
  handshake: {
    schema: HANDSHAKE_SCHEMA as any,
  },
  door: {
    schema: DOOR_SCHEMA as any,
  },
  log_client: {
    schema: LOG_CLIENT_SCHEMA as any,
  },
  log: {
    schema: LOG_SCHEMA as any,
  },
};

/**
 * Debug helper for RxDB (development only)
 * Usage: window.debugRxDB() in browser console
 * @deprecated Consider using AdapterProviderService for database access
 */
export function setupDebugRxDB(
  dbInstance: RxTxnsDatabase | undefined,
  globalDbService: any,
) {
  (window as any).debugRxDB = () => {
    console.log('DB_INSTANCE:', dbInstance);
    console.log('GLOBAL_DB_SERVICE:', globalDbService);
    if (dbInstance) {
      console.log('Collections:', Object.keys(dbInstance.collections));
      console.log('Door collection:', dbInstance.door);
      dbInstance.door
        .find()
        .exec()
        .then((docs: any[]) => {
          console.log('Doors found:', docs.length);
          docs.forEach((doc: any) => console.log('Door:', doc.toJSON()));
        });
    }
  };
}

/**
 * @deprecated This function is no longer used.
 * Database initialization is now handled by AdapterProviderService via the adapter pattern.
 * Kept for reference only - will be removed in a future version.
 */
export async function _createRxDBDatabase(
  injector: Injector,
): Promise<RxTxnsDatabase> {
  environment.addRxDBPlugins();

  console.log('DatabaseService: creating database..');

  const reactivityFactory: RxReactivityFactory<Signal<any>> = {
    fromObservable(obs, initialValue: any) {
      return untracked(() =>
        toSignal(obs, {
          initialValue,
          injector,
        }),
      );
    },
  };

  const db = (await createRxDatabase<RxTxnsCollections>({
    name: DATABASE_NAME,
    storage: environment.getRxStorage(),
    multiInstance: environment.multiInstance,
    reactivity: reactivityFactory,
    cleanupPolicy: {
      minimumDeletedTime: 1000 * 60 * 5, // 5 minutes
      runEach: 1000 * 60 * 5, // 5 minutes
      waitForLeadership: true,
      awaitReplicationsInSync: true,
    },
  })) as RxTxnsDatabase;

  console.log('DatabaseService: created database');

  if (environment.multiInstance) {
    db.waitForLeadership().then(() => {
      console.log('isLeader now');
      document.title = '♛ ' + document.title;
    });
  }

  console.log('DatabaseService: create collections');

  await db.addCollections(collectionsSettings);

  // เริ่ม replication อัตโนมัติ - จะถูกสร้างโดย DatabaseService
  console.log('DatabaseService: replication will be set up by DatabaseService');

  return db;
}
