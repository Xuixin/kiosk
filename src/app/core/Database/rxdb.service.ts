import { Injector, Injectable, Signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';

import { environment } from '../../../environments/environment';
import { TXN_SCHEMA } from '../schema/txn.schema';

import { RxReactivityFactory, createRxDatabase } from 'rxdb/plugins/core';

import { RxTxnsCollections, RxTxnsDatabase } from './RxDB.D';
import { GraphQLReplicationService } from './graphql-replication.service';

environment.addRxDBPlugins();

const DATABASE_NAME = 'kiosk_db';

const collectionsSettings = {
  txn: {
    schema: TXN_SCHEMA as any,
  },
};

let GLOBAL_DB_SERVICE: DatabaseService | undefined;

async function _create(injector: Injector): Promise<RxTxnsDatabase> {
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

let initState: null | Promise<any> = null;
let DB_INSTANCE: RxTxnsDatabase;

export async function initDatabase(injector: Injector) {
  if (!injector) {
    throw new Error('initDatabase() injector missing');
  }

  if (!initState) {
    console.log('initDatabase()');
    initState = _create(injector).then((db) => {
      DB_INSTANCE = db;
      // สร้าง replication หลังจากสร้าง database แล้ว
      const replicationService = new GraphQLReplicationService();
      GLOBAL_DB_SERVICE?.setReplicationService(replicationService);
      replicationService.setupReplication(db.txn).then((replicationState) => {
        if (replicationState) {
          console.log('DatabaseService: replication started');
        } else {
          console.log(
            'DatabaseService: replication not started (offline or error)',
          );
        }
      });
    });
  }
  await initState;
}

@Injectable()
export class DatabaseService {
  private replicationService?: GraphQLReplicationService;

  constructor() {
    GLOBAL_DB_SERVICE = this;
  }

  setReplicationService(service: GraphQLReplicationService) {
    this.replicationService = service;
  }

  get db(): RxTxnsDatabase {
    return DB_INSTANCE;
  }

  /**
   * หยุด replication
   */
  async stopReplication() {
    if (this.replicationService) {
      await this.replicationService.stopReplication();
      console.log('GraphQL replication stopped');
    }
  }

  /**
   * เช็คสถานะการเชื่อมต่อ
   */
  getOnlineStatus(): boolean {
    return this.replicationService?.getOnlineStatus() ?? false;
  }
}
