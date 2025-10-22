import { Injector, Injectable, Signal, untracked, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';

import { environment } from '../../../environments/environment';
import { TXN_SCHEMA } from '../schema/txn.schema';
import { DOOR_SCHEMA } from '../schema/door.schema';

import { RxReactivityFactory, createRxDatabase } from 'rxdb/plugins/core';

import { RxTxnsCollections, RxTxnsDatabase } from './RxDB.D';
import { TransactionReplicationService } from './transaction-replication.service';
import { DoorReplicationService } from './door-replication.service';

environment.addRxDBPlugins();

const collectionsSettings = {
  txn: {
    schema: TXN_SCHEMA as any,
  },
  door: {
    schema: DOOR_SCHEMA as any,
  },
};

async function _create(
  injector: Injector,
  doorId: string,
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

  const databaseName = `door-${doorId}.db`;
  console.log('DatabaseService: creating database with name:', databaseName);

  const db = (await createRxDatabase<RxTxnsCollections>({
    name: databaseName,
    storage: environment.getRxStorage(),
    multiInstance: environment.multiInstance,
    reactivity: reactivityFactory,
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

  // เริ่ม replication อัตโนมัติ
  console.log('DatabaseService: starting replications...');

  // Get replication services from injector instead of creating them manually
  const transactionReplicationService = injector.get(
    TransactionReplicationService,
  );
  const doorReplicationService = injector.get(DoorReplicationService);

  await transactionReplicationService.setupReplication(db.txn);
  await doorReplicationService.setupReplication(db.door);
  console.log('DatabaseService: replications started');

  return db;
}

let initState: null | Promise<any> = null;
let DB_INSTANCE: RxTxnsDatabase | null = null;

export async function initDatabase(injector: Injector, doorId: string) {
  if (!injector) {
    throw new Error('initDatabase() injector missing');
  }

  if (!doorId) {
    throw new Error('initDatabase() doorId missing');
  }

  if (!initState) {
    console.log('initDatabase() with doorId:', doorId);
    initState = _create(injector, doorId).then((db) => {
      DB_INSTANCE = db;
      console.log('DatabaseService: Database instance set');
      return db;
    });
  }
  await initState;
}

@Injectable()
export class DatabaseService {
  constructor(
    private transactionReplicationService: TransactionReplicationService,
    private doorReplicationService: DoorReplicationService,
  ) {}

  get db(): RxTxnsDatabase {
    if (!DB_INSTANCE) {
      throw new Error('Database not initialized. Call initDatabase() first.');
    }
    return DB_INSTANCE;
  }

  /**
   * Check if database is ready
   */
  get isReady(): boolean {
    return DB_INSTANCE !== null;
  }

  /**
   * หยุด replication ทั้งหมด
   */
  async stopReplication() {
    await this.transactionReplicationService.stopReplication();
    console.log('Transaction replication stopped');

    await this.doorReplicationService.stopReplication();
    console.log('Door replication stopped');
  }
}
