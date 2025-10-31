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
import { CollectionRegistry } from './config/collection-registry';

let GLOBAL_DB_SERVICE: DatabaseService | undefined;
let initState: null | Promise<any> = null;
let DB_INSTANCE: RxTxnsDatabase;

/**
 * Replication service configuration
 */
interface ReplicationServiceConfig {
  collectionName: string;
  service: any;
  collectionKey: keyof RxTxnsDatabase['collections'];
  replicationId: string;
}

/**
 * Initialize replication services using collection registry
 * Returns array of service configs for parallel registration
 */
function initializeReplicationServices(
  networkStatusService: NetworkStatusService,
  identityService: ClientIdentityService,
): ReplicationServiceConfig[] {
  const configs: ReplicationServiceConfig[] = [];

  // Get all collections from registry
  const collections = CollectionRegistry.getAll();

  for (const metadata of collections) {
    let service: any;

    // Create appropriate replication service based on collection name
    switch (metadata.collectionName) {
      case 'txn':
        service = new TransactionReplicationService(
          networkStatusService,
          identityService,
        );
        break;
      case 'handshake':
        service = new HandshakeReplicationService(networkStatusService);
        break;
      case 'door':
        service = new DoorReplicationService(networkStatusService);
        break;
      case 'log_client':
        service = new LogClientReplicationService(
          networkStatusService,
          identityService,
        );
        break;
      default:
        console.warn(
          `No replication service factory for collection: ${metadata.collectionName}`,
        );
        continue;
    }

    configs.push({
      collectionName: metadata.collectionName,
      service,
      collectionKey: metadata.collectionKey,
      replicationId: metadata.replicationId,
    });
  }

  return configs;
}

/**
 * Register replication service and return result
 */
async function registerReplication(
  config: ReplicationServiceConfig,
  dbInstance: RxTxnsDatabase,
): Promise<{ collectionName: string; success: boolean }> {
  try {
    const collection = dbInstance.collections[config.collectionKey];
    const replication = await config.service.register_replication(
      collection as any,
      config.replicationId,
    );
    return { collectionName: config.collectionName, success: !!replication };
  } catch (error) {
    console.error(
      `Error registering ${config.collectionName} replication:`,
      error,
    );
    return { collectionName: config.collectionName, success: false };
  }
}

/**
 * Set replication services in DatabaseService
 * Uses collection registry to map services to collection names
 */
function setReplicationServices(configs: ReplicationServiceConfig[]) {
  if (!GLOBAL_DB_SERVICE) return;

  // Use registry to map collection names to setter methods
  configs.forEach((config) => {
    const metadata = CollectionRegistry.get(config.collectionName);
    if (!metadata) {
      console.warn(`Collection ${config.collectionName} not found in registry`);
      return;
    }

    // Use dynamic method resolution based on service name from registry
    const methodName =
      `set${metadata.serviceName}ReplicationService` as keyof DatabaseService;
    const method = GLOBAL_DB_SERVICE![methodName] as any;
    if (method && typeof method === 'function') {
      method(config.service);
    } else {
      console.warn(
        `Setter method ${methodName} not found for collection ${config.collectionName}`,
      );
    }
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
        const metadata = CollectionRegistry.get(result.collectionName);
        const displayName = metadata?.displayName || result.collectionName;
        if (result.success) {
          console.log(`DatabaseService: ${displayName} replication started`);
        } else {
          console.log(
            `DatabaseService: ${displayName} replication not started (offline or error)`,
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

  /**
   * Set replication service by collection name
   * Uses collection registry for type-safe access
   */
  setReplicationServiceByCollection(
    collectionName: string,
    service: any,
  ): void {
    const metadata = CollectionRegistry.get(collectionName);
    if (!metadata) {
      console.warn(
        `Collection ${collectionName} not found in registry, using collection name as key`,
      );
      this.replicationServices.set(collectionName, service);
      return;
    }
    // Use collection name from registry (not service name) for consistency
    this.replicationServices.set(metadata.collectionName, service);
  }

  /**
   * Backward compatibility setters
   * These use collection registry internally
   */
  setReplicationService(service: TransactionReplicationService) {
    this.setReplicationServiceByCollection('txn', service);
  }

  setHandshakeReplicationService(service: HandshakeReplicationService) {
    this.setReplicationServiceByCollection('handshake', service);
  }

  setDoorReplicationService(service: DoorReplicationService) {
    this.setReplicationServiceByCollection('door', service);
  }

  setLogClientReplicationService(service: LogClientReplicationService) {
    this.setReplicationServiceByCollection('log_client', service);
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
