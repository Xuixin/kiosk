import { Injectable, inject } from '@angular/core';
import { RxCollection } from 'rxdb';
import { RxGraphQLReplicationState } from 'rxdb/plugins/replication-graphql';
import { NetworkStatusService } from '../network-status.service';
import { Subscription } from 'rxjs';
import { AdapterProviderService } from './factory';
import { ReplicationState, ReplicationConfig } from './adapter';
import { environment } from 'src/environments/environment';

@Injectable()
export abstract class BaseReplicationService<T = any> {
  public replicationState?: RxGraphQLReplicationState<T, any>;
  protected adapterReplicationState?: ReplicationState;
  protected collection?: RxCollection;
  protected collectionName?: string;
  protected networkSubscription?: Subscription;
  protected replicationIdentifier?: string;
  protected adapterProvider: AdapterProviderService;
  private _isRegistering = false;

  constructor(
    protected networkStatus: NetworkStatusService,
    adapterProvider?: AdapterProviderService,
  ) {
    this.adapterProvider = adapterProvider ?? inject(AdapterProviderService);
    this.setupNetworkHandling();
    this.setupHealthCheckSubscription();
  }

  private setupHealthCheckSubscription(): void {
    // Reserved for future health check subscription implementation
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
    if (
      this.collection &&
      !this.replicationState &&
      !this.adapterReplicationState
    ) {
      try {
        if (this.collectionName && this.adapterProvider.isReady()) {
          await this.setupReplicationViaAdapter();
        } else if (this.collection) {
          await this.setupReplicationDirect(this.collection);
        }
      } catch (error) {
        console.error('Failed to restart replication:', error);
      }
    }
  }

  private async handleOffline() {
    if (this.adapterReplicationState && this.replicationIdentifier) {
      try {
        const adapter = this.adapterProvider.getAdapter();
        const replicationAdapter = adapter.getReplication();
        await replicationAdapter.stop(this.replicationIdentifier);
      } catch (error: any) {
        const isStorageClosed =
          error?.message?.includes('is closed') ||
          error?.message?.includes('closed') ||
          error?.stack?.includes('isClosed');

        if (!isStorageClosed) {
          console.warn(
            'Error stopping adapter replication:',
            error?.message || error,
          );
        }
      } finally {
        this.adapterReplicationState = undefined;
      }
    }

    if (this.replicationState) {
      try {
        const isActive =
          (this.replicationState as any).active$?.getValue?.() ?? true;

        if (isActive) {
          await this.replicationState.cancel();
        }
      } catch (error: any) {
        const isStorageClosed =
          error?.message?.includes('is closed') ||
          error?.message?.includes('closed') ||
          error?.stack?.includes('isClosed') ||
          error?.name === 'RxStorageInstanceClosedError';

        if (!isStorageClosed) {
          console.warn('Error stopping replication:', error?.message || error);
        }
      } finally {
        this.replicationState = undefined;
      }
    }
  }

  /**
   * Build replication configuration for adapter
   * Override in subclasses to provide collection-specific config
   */
  protected abstract buildReplicationConfig(): ReplicationConfig;

  protected applyWebSocketMonitoring(
    config: ReplicationConfig & Record<string, any>,
  ): ReplicationConfig & Record<string, any> {
    if (config.pull) {
      const pullConfig = config.pull as any;
      if (!pullConfig.wsOptions) {
        pullConfig.wsOptions = {};
      }

      if (!pullConfig.wsOptions.keepAlive) {
        pullConfig.wsOptions.keepAlive = 30000;
      }

      if (!pullConfig.wsOptions.on) {
        pullConfig.wsOptions.on = this.createWebSocketEventListeners();
      }
    }

    return config;
  }

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

    const rxdbReplicationAdapter = replicationAdapter as any;
    if (typeof rxdbReplicationAdapter.getRxReplicationState === 'function') {
      this.replicationState = rxdbReplicationAdapter.getRxReplicationState(
        this.replicationIdentifier,
      );
    }

    return this.adapterReplicationState;
  }

  protected async setupReplicationDirect(
    collection: RxCollection,
  ): Promise<RxGraphQLReplicationState<T, any> | undefined> {
    return await this.setupReplicationDirectWithUrl(collection);
  }

  protected async setupReplicationDirectWithUrl(
    collection: RxCollection,
  ): Promise<RxGraphQLReplicationState<T, any> | undefined> {
    return undefined;
  }

  protected setupReplicationErrorHandler(
    replicationState: RxGraphQLReplicationState<T, any>,
  ): void {
    replicationState.error$.subscribe(async (err: any) => {
      const isConnectionError = this.isConnectionError(err);
      if (isConnectionError) {
        console.warn('Replication connection error:', err);
      }
    });
  }

  protected createWebSocketEventListeners(): {
    closed?: (event: unknown) => void;
    error?: (error: unknown) => void;
    connected?: (socket: unknown, payload: any, wasRetry: boolean) => void;
    ping?: (received: boolean, payload?: any) => void;
    pong?: (received: boolean, payload?: any) => void;
  } {
    return {
      closed: (event: unknown) => {
        const collName =
          this.collectionName || this.replicationIdentifier || 'unknown';
        const closeEvent = event as any;
        const closeCode = closeEvent?.code;

        if (this.isFatalCloseCode(closeCode)) {
          console.error(
            `[${collName}] WebSocket closed with fatal code ${closeCode}`,
            closeEvent,
          );
        } else {
          console.warn(`[${collName}] WebSocket closed:`, closeCode);
        }

        this.notifyMonitorService('closed', 'primary', closeEvent);
      },
      error: (error: unknown) => {
        const collName =
          this.collectionName || this.replicationIdentifier || 'unknown';
        console.error(`[${collName}] WebSocket error:`, error);
        this.notifyMonitorService('error', 'primary', error);
      },
      connected: (socket: unknown, payload: any, wasRetry: boolean) => {
        this.notifyMonitorService('connected', 'primary', socket);
      },
      pong: (received: boolean, payload?: any) => {
        if (received) {
          if ((this as any)._pingTimeout) {
            clearTimeout((this as any)._pingTimeout);
            (this as any)._pingTimeout = null;
          }
          this.notifyMonitorService('connected', 'primary', { type: 'pong' });
        }
      },
      ping: (received: boolean, payload?: any) => {
        if (!received) {
          if ((this as any)._pingTimeout) {
            clearTimeout((this as any)._pingTimeout);
          }

          const activeSocket = (this as any)._activeSocket as any;
          (this as any)._pingTimeout = setTimeout(() => {
            if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
              console.error('Ping timeout: No pong received within 5s');
              activeSocket.close(4408, 'Request Timeout - No pong received');
            }
          }, 5000);
        }
      },
    };
  }

  private isFatalCloseCode(code: number): boolean {
    const fatalCodes = [4500, 4005, 4400, 4004, 4401, 4406, 4409, 4429];

    return fatalCodes.includes(code);
  }

  protected isConnectionError(error: any): boolean {
    if (!error) return false;

    const errorString = JSON.stringify(error).toLowerCase();
    const errorMessage =
      error?.message?.toLowerCase() || error?.toString?.()?.toLowerCase() || '';

    const connectionErrorPatterns = [
      'connection',
      'network',
      'timeout',
      'refused',
      'econnrefused',
      'enotfound',
      'eai_again',
      'failed to fetch',
      'websocket',
      'socket',
      'server',
      '503',
      '502',
      '500',
      'gateway',
    ];

    return (
      connectionErrorPatterns.some(
        (pattern) =>
          errorString.includes(pattern) || errorMessage.includes(pattern),
      ) ||
      error?.code === 'ECONNREFUSED' ||
      error?.code === 'ENOTFOUND'
    );
  }

  async register_replication(
    collection: RxCollection,
    identifier: string,
  ): Promise<RxGraphQLReplicationState<T, any> | undefined> {
    const isAlreadyRegistered =
      this.replicationIdentifier === identifier &&
      (this.replicationState || this.adapterReplicationState);

    if (isAlreadyRegistered) {
      console.warn(`Replication ${identifier} already registered`);
      return this.replicationState;
    }

    if (this._isRegistering && this.replicationIdentifier === identifier) {
      let attempts = 0;
      const maxAttempts = 20;

      while (this._isRegistering && attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        attempts++;
      }

      if (this.replicationState || this.adapterReplicationState) {
        return this.replicationState;
      }

      if (this._isRegistering) {
        console.warn(`Replication ${identifier} registration timeout`);
      }
    }

    this.collection = collection;
    this.replicationIdentifier = identifier;
    this._isRegistering = true;

    try {
      if (!this.collectionName) {
        const match = identifier.match(/^([^-]+)-/);
        if (match) {
          this.collectionName = match[1];
        }
      }

      if (!this.networkStatus.isOnline()) {
        return undefined;
      }

      if (this.collectionName && this.adapterProvider.isReady()) {
        try {
          await this.setupReplicationViaAdapter();
          return this.replicationState;
        } catch (error: any) {
          console.warn(
            `Adapter replication failed for ${this.collectionName}:`,
            error?.message || error,
          );
          const result = await this.setupReplicationDirect(collection);
          this._isRegistering = false;
          return result;
        }
      }

      const result = await this.setupReplicationDirect(collection);
      this._isRegistering = false;
      return result;
    } catch (error) {
      this._isRegistering = false;
      throw error;
    }
  }

  async stopReplication() {
    if (this.adapterReplicationState && this.replicationIdentifier) {
      try {
        const adapter = this.adapterProvider.getAdapter();
        const replicationAdapter = adapter.getReplication();
        await replicationAdapter.stop(this.replicationIdentifier);
      } catch (error: any) {
        const isStorageClosed =
          error?.message?.includes('is closed') ||
          error?.message?.includes('closed') ||
          error?.stack?.includes('isClosed');

        if (!isStorageClosed) {
          console.warn(
            'Error stopping adapter replication:',
            error?.message || error,
          );
        }
      } finally {
        this.adapterReplicationState = undefined;
      }
    }

    if (this.replicationState) {
      try {
        const isActive =
          (this.replicationState as any).active$?.getValue?.() ?? true;

        if (isActive) {
          await this.replicationState.cancel();
        }
      } catch (error: any) {
        const isStorageClosed =
          error?.message?.includes('is closed') ||
          error?.message?.includes('closed') ||
          error?.stack?.includes('isClosed') ||
          error?.name === 'RxStorageInstanceClosedError';

        if (!isStorageClosed) {
          console.warn(
            'Error stopping direct replication:',
            error?.message || error,
          );
        }
      } finally {
        this.replicationState = undefined;
      }
    }
  }

  ngOnDestroy() {
    if (this.networkSubscription) {
      this.networkSubscription.unsubscribe();
    }
    this.stopReplication();
  }

  getOnlineStatus(): boolean {
    return this.networkStatus.isOnline();
  }

  getStatus(): { isActive: boolean } {
    const isActive =
      (this.replicationState as any)?.active$?.getValue?.() ??
      (!!this.replicationState || !!this.adapterReplicationState);

    return { isActive };
  }

  getLastSyncAt(): Date | undefined {
    return undefined;
  }

  private notifyMonitorService(
    eventType: 'closed' | 'error' | 'connected',
    urlType: 'primary',
    data: any,
  ): void {
    try {
      if (
        typeof window !== 'undefined' &&
        (window as any).__MONITOR_SERVICE__
      ) {
        const monitorService = (window as any).__MONITOR_SERVICE__;
        if (
          monitorService &&
          typeof monitorService.handleWebSocketEvent === 'function'
        ) {
          monitorService.handleWebSocketEvent(eventType, urlType, data);
        }
      }
    } catch (error) {
      // Ignore if monitor service is not available
    }
  }
}
