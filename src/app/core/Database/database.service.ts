import { Injector, Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import {
  TransactionReplicationService,
  HandshakeReplicationService,
  DoorReplicationService,
  LogClientReplicationService,
} from './replication';
import { NetworkStatusService } from './network-status.service';
import { ClientIdentityService } from '../identity/client-identity.service';
import { AdapterProviderService } from './factory';
import {
  RxDBAdapter,
  getAdapterSchemas,
  setupDebugRxDB,
} from './adapters/rxdb';
import { RxTxnsDatabase } from './adapters/rxdb';

let GLOBAL_DB_SERVICE: DatabaseService | undefined;
let initState: null | Promise<any> = null;
let DB_INSTANCE: RxTxnsDatabase;

/**
 * Replication service configuration
 */
interface ReplicationServiceConfig {
  name: string;
  service: any;
  collectionKey: keyof RxTxnsDatabase['collections'];
  replicationId: string;
}

/**
 * Initialize replication services
 * Returns array of service configs for parallel registration
 */
function initializeReplicationServices(
  networkStatusService: NetworkStatusService,
  identityService: ClientIdentityService,
): ReplicationServiceConfig[] {
  return [
    {
      name: 'Transaction',
      service: new TransactionReplicationService(
        networkStatusService,
        identityService,
      ),
      collectionKey: 'txn',
      replicationId: 'txn-graphql-replication',
    },
    {
      name: 'Handshake',
      service: new HandshakeReplicationService(networkStatusService),
      collectionKey: 'handshake',
      replicationId: 'handshake-graphql-replication',
    },
    {
      name: 'Door',
      service: new DoorReplicationService(networkStatusService),
      collectionKey: 'door',
      replicationId: 'door-graphql-replication',
    },
    {
      name: 'LogClient',
      service: new LogClientReplicationService(
        networkStatusService,
        identityService,
      ),
      collectionKey: 'log_client',
      replicationId: 'log-client-graphql-replication',
    },
  ];
}

/**
 * Register replication service and return result
 */
async function registerReplication(
  config: ReplicationServiceConfig,
  dbInstance: RxTxnsDatabase,
): Promise<{ name: string; success: boolean }> {
  try {
    const collection = dbInstance.collections[config.collectionKey];
    const replication = await config.service.register_replication(
      collection as any,
      config.replicationId,
    );
    return { name: config.name, success: !!replication };
  } catch (error) {
    console.error(`Error registering ${config.name} replication:`, error);
    return { name: config.name, success: false };
  }
}

/**
 * Set replication services in DatabaseService
 * All services are set simultaneously (synchronous batch operation)
 */
function setReplicationServices(configs: ReplicationServiceConfig[]) {
  if (!GLOBAL_DB_SERVICE) return;

  // All setters execute immediately (synchronous, no awaiting needed)
  configs.forEach((config) => {
    const method = GLOBAL_DB_SERVICE![
      `set${config.name}ReplicationService` as keyof DatabaseService
    ] as any;
    method?.(config.service);
  });
}

/**
 * Initialize the database using the adapter pattern
 * This function sets up the database adapter and replication services
 */
export async function initDatabase(injector: Injector) {
  if (!injector) {
    throw new Error('initDatabase() injector missing');
  }

  const identityService = injector.get(ClientIdentityService);
  const adapterProvider = injector.get(
    AdapterProviderService,
  ) as AdapterProviderService;

  if (!initState) {
    console.log('initDatabase() - using adapter pattern');

    // Initialize adapter with schemas
    const schemas = getAdapterSchemas();
    const adapterConfig = {
      type: (environment.adapterType || 'rxdb') as any,
    };

    await adapterProvider.initialize(schemas, adapterConfig);

    // For backward compatibility, get the RxDB instance from RxDBAdapter
    const adapter = adapterProvider.getAdapter();
    if (adapter instanceof RxDBAdapter) {
      DB_INSTANCE = adapter.getRxDB();
    } else {
      throw new Error('Expected RxDBAdapter for backward compatibility');
    }

    // Setup debug helper
    setupDebugRxDB(DB_INSTANCE, GLOBAL_DB_SERVICE);

    // Initialize replication services (can be done in parallel)
    initState = Promise.resolve().then(async () => {
      const networkStatusService = new NetworkStatusService();
      const replicationConfigs = initializeReplicationServices(
        networkStatusService,
        identityService,
      );

      // Set replication services in database service
      setReplicationServices(replicationConfigs);

      // Register all replications in parallel
      const replicationResults = await Promise.all(
        replicationConfigs.map((config) =>
          registerReplication(config, DB_INSTANCE),
        ),
      );

      // Log results
      replicationResults.forEach((result) => {
        if (result.success) {
          console.log(`DatabaseService: ${result.name} replication started`);
        } else {
          console.log(
            `DatabaseService: ${result.name} replication not started (offline or error)`,
          );
        }
      });
    });
  }

  await initState;
}

/**
 * Database Service
 * Provides access to the database instance and manages replication services
 * Uses the adapter pattern internally but maintains backward compatibility with RxDB API
 */
@Injectable()
export class DatabaseService {
  private replicationServices: Map<
    string,
    | TransactionReplicationService
    | HandshakeReplicationService
    | DoorReplicationService
    | LogClientReplicationService
  > = new Map();

  constructor() {
    GLOBAL_DB_SERVICE = this;
  }

  setReplicationService(service: TransactionReplicationService) {
    this.replicationServices.set('transaction', service);
  }

  setHandshakeReplicationService(service: HandshakeReplicationService) {
    this.replicationServices.set('handshake', service);
  }

  setDoorReplicationService(service: DoorReplicationService) {
    this.replicationServices.set('door', service);
  }

  setLogClientReplicationService(service: LogClientReplicationService) {
    this.replicationServices.set('logClient', service);
  }

  /**
   * Get the RxDB database instance (for backward compatibility)
   * Note: This will only work when using RxDBAdapter
   */
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
    const stopPromises = Array.from(this.replicationServices.values()).map(
      async (service) => {
        if (service && typeof (service as any).stopReplication === 'function') {
          await (service as any).stopReplication();
          return true;
        }
        return false;
      },
    );

    await Promise.all(stopPromises);
    console.log('All GraphQL replications stopped');
  }

  /**
   * เช็คสถานะการเชื่อมต่อ
   */
  getOnlineStatus(): boolean {
    const statuses = Array.from(this.replicationServices.values())
      .map((service) => {
        if (service && typeof (service as any).getOnlineStatus === 'function') {
          return (service as any).getOnlineStatus();
        }
        return false;
      })
      .filter((status) => status === true);

    return statuses.length > 0;
  }
}
