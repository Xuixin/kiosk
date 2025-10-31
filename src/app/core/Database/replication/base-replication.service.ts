import { Injectable, inject } from '@angular/core';
import { RxCollection } from 'rxdb';
import { RxGraphQLReplicationState } from 'rxdb/plugins/replication-graphql';
import { NetworkStatusService } from '../network-status.service';
import { Subscription } from 'rxjs';
import { AdapterProviderService } from '../factory';
import {
  ReplicationAdapter,
  ReplicationState,
  ReplicationConfig,
} from '../adapter';

@Injectable()
export abstract class BaseReplicationService<T = any> {
  public replicationState?: RxGraphQLReplicationState<T, any>;
  protected adapterReplicationState?: ReplicationState;
  protected collection?: RxCollection;
  protected collectionName?: string;
  protected networkSubscription?: Subscription;
  protected replicationIdentifier?: string;
  protected adapterProvider = inject(AdapterProviderService);

  constructor(protected networkStatus: NetworkStatusService) {
    this.setupNetworkHandling();
  }

  private setupNetworkHandling() {
    this.networkSubscription = this.networkStatus.isOnline$.subscribe(
      (isOnline) => {
        if (isOnline) {
          this.handleOnline();
        } else {
          this.handleOffline();
        }
      },
    );
  }

  private async handleOnline() {
    console.log('🌐 Replication: Application is now online');

    if (
      this.collection &&
      !this.replicationState &&
      !this.adapterReplicationState
    ) {
      console.log('🔄 Restarting replication after coming online...');
      try {
        // Try using adapter first, fallback to direct setup
        if (this.collectionName && this.adapterProvider.isReady()) {
          await this.setupReplicationViaAdapter();
        } else if (this.collection) {
          await this.setupReplication(this.collection);
        }
        console.log('✅ Replication restarted successfully');
      } catch (error) {
        console.error('❌ Failed to restart replication:', error);
      }
    }
  }

  private async handleOffline() {
    console.log(
      '⚠️ Replication: Application is now offline - stopping replication',
    );

    // Stop replication (both adapter and direct)
    if (this.adapterReplicationState && this.replicationIdentifier) {
      const adapter = this.adapterProvider.getAdapter();
      const replicationAdapter = adapter.getReplication();
      await replicationAdapter.stop(this.replicationIdentifier);
      this.adapterReplicationState = undefined;
      console.log('✅ Adapter replication stopped due to offline status');
    }

    if (this.replicationState) {
      await this.replicationState.cancel();
      this.replicationState = undefined;
      console.log('✅ Direct replication stopped due to offline status');
    }
  }

  /**
   * Build replication configuration for adapter
   * Override in subclasses to provide collection-specific config
   */
  protected abstract buildReplicationConfig(): ReplicationConfig;

  /**
   * Setup replication via adapter (new method)
   */
  protected async setupReplicationViaAdapter(): Promise<
    ReplicationState | undefined
  > {
    if (!this.collectionName || !this.replicationIdentifier) {
      throw new Error('Collection name and replication identifier required');
    }

    const adapter = this.adapterProvider.getAdapter();
    const replicationAdapter = adapter.getReplication();

    const config = this.buildReplicationConfig();
    config.replicationId = this.replicationIdentifier;
    config.collectionName = this.collectionName;

    this.adapterReplicationState = await replicationAdapter.register(
      this.collectionName,
      config,
    );

    // Get underlying RxGraphQLReplicationState for backward compatibility
    const rxdbReplicationAdapter = replicationAdapter as any;
    if (typeof rxdbReplicationAdapter.getRxReplicationState === 'function') {
      this.replicationState = rxdbReplicationAdapter.getRxReplicationState(
        this.replicationIdentifier,
      );
    }

    return this.adapterReplicationState;
  }

  /**
   * Setup replication directly (legacy method, for backward compatibility)
   * Override in subclasses if not using adapter
   */
  protected async setupReplication(
    collection: RxCollection,
  ): Promise<RxGraphQLReplicationState<T, any> | undefined> {
    // Default implementation - try adapter first, then direct
    if (this.collectionName && this.adapterProvider.isReady()) {
      try {
        const state = await this.setupReplicationViaAdapter();
        return this.replicationState;
      } catch (error) {
        console.warn(
          'Failed to setup via adapter, falling back to direct:',
          error,
        );
      }
    }
    // Fallback to abstract method - subclasses should override
    return undefined;
  }

  /**
   * Register collection for replication without starting immediately
   * @param collection - The RxDB collection to replicate (for backward compatibility)
   * @param identifier - Unique identifier for this replication
   */
  async register_replication(
    collection: RxCollection,
    identifier: string,
  ): Promise<RxGraphQLReplicationState<T, any> | undefined> {
    console.log(`Registering replication: ${identifier}`);

    this.collection = collection;
    this.replicationIdentifier = identifier;
    // Collection name should be set by subclass constructor
    // If not set, try to extract from collection or use identifier prefix
    if (!this.collectionName) {
      // Try to infer from identifier (e.g., 'txn-graphql-replication' -> 'txn')
      const match = identifier.match(/^([^-]+)-/);
      if (match) {
        this.collectionName = match[1];
      }
    }

    // Check if app is online before starting replication
    if (!this.networkStatus.isOnline()) {
      console.log('⚠️ Application is offline - replication setup skipped');
      console.log(
        '📝 Replication will start automatically when connection is restored',
      );
      return undefined;
    }

    // Try adapter first, fallback to direct
    if (this.collectionName && this.adapterProvider.isReady()) {
      try {
        await this.setupReplicationViaAdapter();
        return this.replicationState;
      } catch (error) {
        console.warn('Adapter replication failed, using direct:', error);
      }
    }

    // Fallback to direct replication
    return await this.setupReplication(collection);
  }

  /**
   * Stop replication
   */
  async stopReplication() {
    // Stop adapter replication
    if (this.adapterReplicationState && this.replicationIdentifier) {
      try {
        const adapter = this.adapterProvider.getAdapter();
        const replicationAdapter = adapter.getReplication();
        await replicationAdapter.stop(this.replicationIdentifier);
        this.adapterReplicationState = undefined;
        console.log('Adapter replication stopped');
      } catch (error) {
        console.warn('Error stopping adapter replication:', error);
      }
    }

    // Stop direct replication
    if (this.replicationState) {
      await this.replicationState.cancel();
      this.replicationState = undefined;
      console.log('Direct replication stopped');
    }
  }

  /**
   * Clean up resources
   */
  ngOnDestroy() {
    if (this.networkSubscription) {
      this.networkSubscription.unsubscribe();
    }
    this.stopReplication();
  }

  /**
   * Check current online status
   */
  getOnlineStatus(): boolean {
    return this.networkStatus.isOnline();
  }
}
