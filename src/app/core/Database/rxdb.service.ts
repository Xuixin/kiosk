import { Injector, Injectable, Signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';

import { environment } from '../../../environments/environment';
import { TXN_SCHEMA, HANDSHAKE_SCHEMA, DOOR_SCHEMA } from '../schema';

import { RxReactivityFactory, createRxDatabase } from 'rxdb/plugins/core';

import { RxTxnsCollections, RxTxnsDatabase } from './RxDB.D';
import {
  TransactionReplicationService,
  HandshakeReplicationService,
  DoorReplicationService,
} from './replication';
import { NetworkStatusService } from './network-status.service';

environment.addRxDBPlugins();

const DATABASE_NAME = 'kiosk_db';

const collectionsSettings = {
  txn: {
    schema: TXN_SCHEMA as any,
  },
  handshake: {
    schema: HANDSHAKE_SCHEMA as any,
  },
  door: {
    schema: DOOR_SCHEMA as any,
  },
};

let GLOBAL_DB_SERVICE: DatabaseService | undefined;

// Export for debugging in console
(window as any).debugRxDB = () => {
  console.log('DB_INSTANCE:', DB_INSTANCE);
  console.log('GLOBAL_DB_SERVICE:', GLOBAL_DB_SERVICE);
  if (DB_INSTANCE) {
    console.log('Collections:', Object.keys(DB_INSTANCE.collections));
    console.log('Door collection:', DB_INSTANCE.door);
    DB_INSTANCE.door
      .find()
      .exec()
      .then((docs) => {
        console.log('Doors found:', docs.length);
        docs.forEach((doc) => console.log('Door:', doc.toJSON()));
      });
  }
};

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
    initState = _create(injector).then(async (db) => {
      DB_INSTANCE = db;
      // สร้าง replication หลังจากสร้าง database แล้ว
      const networkStatusService = new NetworkStatusService();

      // Initialize replication services for all collections
      const transactionReplicationService = new TransactionReplicationService(
        networkStatusService,
      );
      const handshakeReplicationService = new HandshakeReplicationService(
        networkStatusService,
      );
      const doorReplicationService = new DoorReplicationService(
        networkStatusService,
      );

      // Set replication services in database service
      GLOBAL_DB_SERVICE?.setReplicationService(transactionReplicationService);
      GLOBAL_DB_SERVICE?.setHandshakeReplicationService(
        handshakeReplicationService,
      );
      GLOBAL_DB_SERVICE?.setDoorReplicationService(doorReplicationService);

      // Register replications
      const txnReplication =
        await transactionReplicationService.register_replication(
          db.txn as any,
          'txn-graphql-replication',
        );

      const handshakeReplication =
        await handshakeReplicationService.register_replication(
          db.handshake as any,
          'handshake-graphql-replication',
        );

      const doorReplication = await doorReplicationService.register_replication(
        db.door as any,
        'door-graphql-replication',
      );

      if (txnReplication) {
        console.log('DatabaseService: Transaction replication started');
      } else {
        console.log(
          'DatabaseService: Transaction replication not started (offline or error)',
        );
      }

      if (handshakeReplication) {
        console.log('DatabaseService: Handshake replication started');
      } else {
        console.log(
          'DatabaseService: Handshake replication not started (offline or error)',
        );
      }

      if (doorReplication) {
        console.log('DatabaseService: Door replication started');
      } else {
        console.log(
          'DatabaseService: Door replication not started (offline or error)',
        );
      }
    });
  }
  await initState;
}

@Injectable()
export class DatabaseService {
  private transactionReplicationService?: TransactionReplicationService;
  private handshakeReplicationService?: HandshakeReplicationService;
  private doorReplicationService?: DoorReplicationService;

  constructor() {
    GLOBAL_DB_SERVICE = this;
  }

  setReplicationService(service: TransactionReplicationService) {
    this.transactionReplicationService = service;
  }

  setHandshakeReplicationService(service: HandshakeReplicationService) {
    this.handshakeReplicationService = service;
  }

  setDoorReplicationService(service: DoorReplicationService) {
    this.doorReplicationService = service;
  }

  get db(): RxTxnsDatabase {
    if (!DB_INSTANCE) {
      throw new Error(
        'Database not initialized yet. Make sure APP_INITIALIZER has completed.',
      );
    }
    return DB_INSTANCE;
  }

  /**
   * หยุด replication ทั้งหมด
   */
  async stopReplication() {
    if (this.transactionReplicationService) {
      await this.transactionReplicationService.stopReplication();
      console.log('Transaction replication stopped');
    }

    if (this.handshakeReplicationService) {
      await this.handshakeReplicationService.stopReplication();
      console.log('Handshake replication stopped');
    }

    if (this.doorReplicationService) {
      await this.doorReplicationService.stopReplication();
      console.log('Door replication stopped');
    }

    console.log('All GraphQL replications stopped');
  }

  /**
   * เช็คสถานะการเชื่อมต่อ
   */
  getOnlineStatus(): boolean {
    const txnStatus =
      this.transactionReplicationService?.getOnlineStatus() ?? false;
    const handshakeStatus =
      this.handshakeReplicationService?.getOnlineStatus() ?? false;
    const doorStatus = this.doorReplicationService?.getOnlineStatus() ?? false;
    return txnStatus || handshakeStatus || doorStatus;
  }
}
