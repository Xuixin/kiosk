import { Injectable, inject } from '@angular/core';
import { createRxDatabase, RxDatabase, RxCollection } from 'rxdb';
import { environment } from 'src/environments/environment';
import { ClientIdentityService } from '../../../services/client-identity.service';
import { TXN_SCHEMA } from '../collection/txn/schema';
import { DEVICE_MONITORING_SCHEMA } from '../collection/device-monitoring/schema';
import { DEVICE_MONITORING_HISTORY_SCHEMA } from '../collection/device-monitoring-history/schema';
import { ReplicationManagerService } from '../replication/services/replication-manager.service';
import { RxGraphQLReplicationState } from 'rxdb/plugins/replication-graphql';

interface DatabaseCollections {
  transaction: RxCollection;
  devicemonitoring: RxCollection;
  devicemonitoringhistory: RxCollection;
}

environment.addRxDBPlugins();

@Injectable({
  providedIn: 'root',
})
export class DatabaseService {
  private db: RxDatabase<DatabaseCollections> | null = null;
  private readonly identity = inject(ClientIdentityService);
  private readonly replicationManager = inject(ReplicationManagerService);
  private _initializing = false; // Prevent concurrent initialization
  private _initializationPromise: Promise<void> | null = null; // Track ongoing initialization

  // Event emitter for primary recovery
  private primaryRecoveryListeners: Set<() => void | Promise<void>> = new Set();

  /**
   * Set replication monitor service (called after initialization to avoid circular dependency)
   */
  setReplicationMonitorService(monitorService: any): void {
    this.replicationManager.setReplicationMonitorService(monitorService);
  }

  /**
   * Initialize database and collections
   * Will skip if clientId is not available yet (waits for device-selection-modal)
   * Prevents duplicate initialization on refresh
   */
  async initializeDatabase(): Promise<void> {
    // If already initialized, return immediately
    if (this.db) {
      console.log('✅ [NewDatabase] Database already initialized');
      return;
    }

    // If currently initializing, wait for existing initialization to complete
    if (this._initializing && this._initializationPromise) {
      console.log(
        '⏳ [NewDatabase] Database initialization in progress, waiting...',
      );
      await this._initializationPromise;
      return;
    }

    // Start initialization
    this._initializing = true;
    this._initializationPromise = this._doInitialize();

    try {
      await this._initializationPromise;
    } finally {
      this._initializing = false;
      this._initializationPromise = null;
    }
  }

  /**
   * Internal initialization logic
   */
  private async _doInitialize(): Promise<void> {
    // Double-check after waiting
    if (this.db) {
      console.log('✅ [NewDatabase] Database already initialized (after wait)');
      return;
    }

    // Get client ID for database name
    let clientId = await this.identity.getClientId();
    if (!clientId) {
      console.log(
        '⏸️ [NewDatabase] Client ID not available yet. Waiting for device selection...',
      );
      return; // Skip initialization - will be called again after device selection
    }

    const clientType = await this.identity.getClientTypeStored();
    const databaseName = `${clientType}-${clientId}`;
    console.log(`💾 [NewDatabase] Database name: ${databaseName}`);

    try {
      // Create RxDB database
      // RxDB will automatically handle existing databases - it won't overwrite
      this.db = await createRxDatabase<DatabaseCollections>({
        name: databaseName,
        storage: environment.getRxStorage(),
        multiInstance: environment.multiInstance || false,
      });

      // Check if collections already exist
      const existingCollections = Object.keys(this.db.collections);
      if (existingCollections.length > 0) {
        console.log(
          `✅ [NewDatabase] Database exists with collections: ${existingCollections.join(', ')}`,
        );
      } else {
        // Add collections only if they don't exist
        // RxDB will throw error if collection already exists, so we catch it
        try {
          await this.db.addCollections({
            transaction: {
              schema: TXN_SCHEMA as any,
            },
            devicemonitoring: {
              schema: DEVICE_MONITORING_SCHEMA as any,
            },
            devicemonitoringhistory: {
              schema: DEVICE_MONITORING_HISTORY_SCHEMA as any,
            },
          });
          console.log('✅ [NewDatabase] Collections added to database');
        } catch (colError: any) {
          // Collection might already exist (e.g., from previous initialization)
          // Check if collections were actually added
          const collectionsAfter = Object.keys(this.db.collections);
          if (collectionsAfter.length > 0) {
            console.log(
              `✅ [NewDatabase] Collections already exist: ${collectionsAfter.join(', ')}`,
            );
          } else {
            // Re-throw if collections were not added
            console.error(
              '❌ [NewDatabase] Failed to add collections:',
              colError.message,
            );
            throw colError;
          }
        }
      }

      console.log('✅ [NewDatabase] Database and collections initialized');

      // Initialize replications only if not already initialized
      if (this.replicationManager.getAllReplicationStates().size === 0) {
        await this.replicationManager.initializeReplications(this.db, () =>
          this.emitPrimaryRecoveryEvent(),
        );
      } else {
        console.log(
          `✅ [NewDatabase] Replications already initialized (${this.replicationManager.getAllReplicationStates().size} states)`,
        );
      }
    } catch (error: any) {
      console.error(
        '❌ [NewDatabase] Error during database initialization:',
        error,
      );
      // Reset state on error so it can be retried
      this.db = null;
      throw error;
    }
  }

  /**
   * Get database instance
   */
  getDatabase(): RxDatabase<DatabaseCollections> | null {
    return this.db;
  }

  /**
   * Get collection by name
   */
  getCollection(name: keyof DatabaseCollections): RxCollection | null {
    return this.db?.collections[name] || null;
  }

  /**
   * Get replication state by identifier
   */
  getReplicationState(
    identifier: string,
  ): RxGraphQLReplicationState<any, any> | null {
    return this.replicationManager.getReplicationState(identifier);
  }

  /**
   * Get all replication states
   */
  getAllReplicationStates(): Map<string, RxGraphQLReplicationState<any, any>> {
    return this.replicationManager.getAllReplicationStates();
  }

  /**
   * Check if database is initialized
   */
  isInitialized(): boolean {
    return this.db !== null;
  }

  /**
   * Start secondary replications
   */
  async startSecondary(): Promise<void> {
    return this.replicationManager.startSecondary();
  }

  /**
   * Start primary replications
   */
  async startPrimary(): Promise<void> {
    return this.replicationManager.startPrimary();
  }

  /**
   * Switch all replications from primary to secondary
   */
  async switchToSecondary(): Promise<void> {
    return this.replicationManager.switchToSecondary();
  }

  /**
   * Switch all replications from secondary back to primary
   */
  async switchToPrimary(): Promise<void> {
    return this.replicationManager.switchToPrimary();
  }

  /**
   * Stop all replications (for cleanup on app destroy)
   */
  async stopReplication(): Promise<void> {
    return this.replicationManager.stopReplication();
  }

  /**
   * Reinitialize replications (public method for reconnecting after offline)
   * Checks server availability and starts appropriate replications
   */
  async reinitializeReplications(): Promise<void> {
    if (!this.db) {
      throw new Error('Database must be initialized first');
    }
    return this.replicationManager.reinitializeReplications(this.db, () =>
      this.emitPrimaryRecoveryEvent(),
    );
  }

  /**
   * Subscribe to primary recovery events
   * Called when primary server is detected as ONLINE while using secondary
   */
  onPrimaryRecovery(callback: () => void | Promise<void>): () => void {
    this.primaryRecoveryListeners.add(callback);
    // Return unsubscribe function
    return () => {
      this.primaryRecoveryListeners.delete(callback);
    };
  }

  /**
   * Emit primary recovery event
   * All registered listeners will be called
   */
  private async emitPrimaryRecoveryEvent(): Promise<void> {
    console.log(
      `📢 [DatabaseService] Emitting primary recovery event to ${this.primaryRecoveryListeners.size} listener(s)`,
    );

    const promises = Array.from(this.primaryRecoveryListeners).map((callback) =>
      Promise.resolve(callback()),
    );

    await Promise.all(promises);
    console.log('✅ [DatabaseService] Primary recovery event handled');
  }
}
