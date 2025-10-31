import { Injectable, inject } from '@angular/core';
import { RxCollection } from 'rxdb';
import { RxGraphQLReplicationState } from 'rxdb/plugins/replication-graphql';
import { NetworkStatusService } from '../network-status.service';
import { Subscription } from 'rxjs';
import { AdapterProviderService } from './factory';
import {
  ReplicationAdapter,
  ReplicationState,
  ReplicationConfig,
} from './adapter';
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
  protected useFallbackUrl = false; // Track if using fallback URL
  protected errorRetryCount = 0; // Track consecutive errors for fallback switching
  protected readonly MAX_ERRORS_BEFORE_FALLBACK = 3; // Switch to fallback after 3 consecutive errors
  private _isRegistering = false; // Track if registration is in progress (prevent race conditions)
  private healthCheckSubscription?: Subscription; // Subscription to health check from monitor service

  constructor(
    protected networkStatus: NetworkStatusService,
    adapterProvider?: AdapterProviderService,
  ) {
    // Accept AdapterProviderService as constructor parameter
    // If not provided, try to inject (for backward compatibility)
    // But prefer constructor injection to avoid injection context issues
    this.adapterProvider = adapterProvider ?? inject(AdapterProviderService);
    this.setupNetworkHandling();
    this.setupHealthCheckSubscription();
  }

  /**
   * Setup subscription to health check from ReplicationMonitorService
   * This allows replication services to react to backend server health changes
   */
  private setupHealthCheckSubscription(): void {
    // Use lazy injection to avoid circular dependency
    // ReplicationMonitorService will be injected when needed
    // For now, we'll subscribe via a different mechanism
    // This will be implemented in Phase 3 when monitor service is available
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
      try {
        const adapter = this.adapterProvider.getAdapter();
        const replicationAdapter = adapter.getReplication();
        await replicationAdapter.stop(this.replicationIdentifier);
        console.log('✅ Adapter replication stopped due to offline status');
      } catch (error: any) {
        const isStorageClosed =
          error?.message?.includes('is closed') ||
          error?.message?.includes('closed') ||
          error?.stack?.includes('isClosed');

        if (isStorageClosed) {
          console.log(
            'ℹ️ Storage closed, adapter replication offline cleanup skipped',
          );
        } else {
          console.warn(
            '⚠️ Error stopping adapter replication on offline:',
            error?.message || error,
          );
        }
      } finally {
        this.adapterReplicationState = undefined;
      }
    }

    if (this.replicationState) {
      try {
        // Check if replication is still active before canceling
        const isActive =
          (this.replicationState as any).active$?.getValue?.() ?? true;

        if (isActive) {
          await this.replicationState.cancel();
          console.log('✅ Direct replication stopped due to offline status');
        } else {
          console.log(
            'ℹ️ Replication already inactive, skipping offline cleanup',
          );
        }
      } catch (error: any) {
        // Handle storage closed error gracefully
        const isStorageClosed =
          error?.message?.includes('is closed') ||
          error?.message?.includes('closed') ||
          error?.stack?.includes('isClosed');

        if (isStorageClosed) {
          console.log('ℹ️ Storage already closed, offline cleanup skipped');
        } else {
          console.warn(
            '⚠️ Error stopping replication on offline:',
            error?.message || error,
          );
        }
      } finally {
        // Always clear state even if cancel failed
        this.replicationState = undefined;
      }
    }
  }

  /**
   * Build replication configuration for adapter
   * Override in subclasses to provide collection-specific config
   */
  protected abstract buildReplicationConfig(): ReplicationConfig;

  /**
   * Build replication config with fallback URL if needed
   * This method wraps buildReplicationConfig() and applies fallback URLs
   * Also adds proactive WebSocket monitoring (keepAlive + event listeners)
   * Based on: https://the-guild.dev/graphql/ws/docs/client/interfaces/ClientOptions
   */
  protected buildReplicationConfigWithFallback(): ReplicationConfig &
    Record<string, any> {
    const config = this.buildReplicationConfig() as any;

    // If using fallback URL, replace primary URLs with fallback URLs
    if (this.useFallbackUrl && config.url) {
      config.url = {
        http: environment.apiUrlFallback || config.url.http,
        ws: environment.wsUrlFallback || config.url.ws,
      };
      console.log('🔄 Using fallback URLs:', config.url);
    }

    // Add proactive WebSocket monitoring for early server down detection
    // This detects server issues via WebSocket events, NOT just pull/push/stream errors
    // Based on GraphQL WebSocket Client Options: keepAlive + on events
    if (config.pull) {
      if (!config.pull.wsOptions) {
        config.pull.wsOptions = {};
      }

      // Enable keepAlive for ping/pong health checks (every 30 seconds)
      // https://the-guild.dev/graphql/ws/docs/client/interfaces/ClientOptions#keepalive
      if (!config.pull.wsOptions.keepAlive) {
        config.pull.wsOptions.keepAlive = 30000; // 30 seconds
      }

      // Add event listeners for immediate connection drop detection
      // https://the-guild.dev/graphql/ws/docs/client/interfaces/ClientOptions#on
      if (!config.pull.wsOptions.on) {
        config.pull.wsOptions.on = this.createWebSocketEventListeners();
      }
    }

    return config;
  }

  /**
   * Apply WebSocket monitoring (keepAlive + event listeners) to replication config
   * This enables proactive server down detection without waiting for pull/push/stream
   */
  protected applyWebSocketMonitoring(
    config: ReplicationConfig & Record<string, any>,
  ): ReplicationConfig & Record<string, any> {
    // Add proactive WebSocket monitoring for early server down detection
    // This detects server issues via WebSocket events, NOT just pull/push/stream errors
    // Based on GraphQL WebSocket Client Options: keepAlive + on events
    if (config.pull) {
      const pullConfig = config.pull as any;
      if (!pullConfig.wsOptions) {
        pullConfig.wsOptions = {};
      }

      // Enable keepAlive for ping/pong health checks (every 30 seconds)
      // https://the-guild.dev/graphql/ws/docs/client/interfaces/ClientOptions#keepalive
      if (!pullConfig.wsOptions.keepAlive) {
        pullConfig.wsOptions.keepAlive = 30000; // 30 seconds
      }

      // Add event listeners for immediate connection drop detection
      // https://the-guild.dev/graphql/ws/docs/client/interfaces/ClientOptions#on
      if (!pullConfig.wsOptions.on) {
        pullConfig.wsOptions.on = this.createWebSocketEventListeners();
      }
    }

    return config;
  }

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
   * This method should NOT try adapter again - adapter is already attempted in register_replication
   *
   * If useFallbackUrl is true (adapter failed), it will use fallback URLs from environment
   * Otherwise, it will try primary URL first, then fallback if that fails
   */
  protected async setupReplicationDirect(
    collection: RxCollection,
  ): Promise<RxGraphQLReplicationState<T, any> | undefined> {
    // If adapter already failed, use fallback URL directly
    if (this.useFallbackUrl) {
      return await this.setupReplicationDirectWithUrl(collection, true);
    }

    // Otherwise, try primary URL first, then fallback if it fails
    try {
      return await this.setupReplicationDirectWithUrl(collection, false);
    } catch (error) {
      console.warn(
        '⚠️ Primary URL replication failed, trying fallback URL:',
        error,
      );
      this.useFallbackUrl = true;
      return await this.setupReplicationDirectWithUrl(collection, true);
    }
  }

  /**
   * Internal method to setup direct replication with specific URL
   * Subclasses should override setupReplicationDirectWithUrl to implement actual replication
   */
  protected async setupReplicationDirectWithUrl(
    collection: RxCollection,
    useFallback: boolean,
  ): Promise<RxGraphQLReplicationState<T, any> | undefined> {
    // This method is for direct replication setup only
    // Adapter attempt already happened in register_replication
    // Subclasses should override this to implement direct replication
    return undefined;
  }

  /**
   * Setup error handler for replication state
   * This will detect server crashes and switch to fallback URL if needed
   *
   * Note: This is reactive - only triggers when pull/push/stream fails.
   * For proactive monitoring, use WebSocket keepAlive + event listeners.
   */
  protected setupReplicationErrorHandler(
    replicationState: RxGraphQLReplicationState<T, any>,
  ): void {
    replicationState.error$.subscribe(async (err: any) => {
      // Check if error is a connection/server error
      const isConnectionError = this.isConnectionError(err);

      if (isConnectionError && !this.useFallbackUrl) {
        this.errorRetryCount++;
        console.warn(
          `⚠️ Replication connection error (${this.errorRetryCount}/${this.MAX_ERRORS_BEFORE_FALLBACK}):`,
          err,
        );

        // Switch to fallback URL after multiple consecutive errors
        if (
          this.errorRetryCount >= this.MAX_ERRORS_BEFORE_FALLBACK &&
          this.collection
        ) {
          console.log(
            '🔄 Server appears to be down, switching to fallback URL...',
          );
          await this.switchToFallbackUrl(this.collection);
        }
      } else if (!isConnectionError) {
        // Reset error count for non-connection errors
        this.errorRetryCount = 0;
      }
    });
  }

  /**
   * Create WebSocket event listeners for proactive connection monitoring
   * This detects server down IMMEDIATELY via WebSocket events, without waiting for pull/push/stream
   *
   * Based on: https://the-guild.dev/graphql/ws/docs/client/interfaces/ClientOptions#on
   */
  protected createWebSocketEventListeners(): {
    closed?: (event: any) => void;
    error?: (error: any) => void;
    connected?: (socket: any) => void;
    ping?: (received: boolean) => void;
    pong?: (received: boolean) => void;
  } {
    return {
      closed: (event: any) => {
        console.warn('⚠️ WebSocket connection closed:', {
          code: event?.code,
          reason: event?.reason,
          wasClean: event?.wasClean,
        });

        // If not using fallback and this looks like a server issue
        if (!this.useFallbackUrl && this.collection) {
          const isServerError = this.isServerCloseEvent(event);
          if (isServerError) {
            this.errorRetryCount++;
            console.warn(
              `⚠️ WebSocket closed (${this.errorRetryCount}/${this.MAX_ERRORS_BEFORE_FALLBACK})`,
            );

            if (
              this.errorRetryCount >= this.MAX_ERRORS_BEFORE_FALLBACK &&
              this.collection
            ) {
              console.log(
                '🔄 Server connection closed, switching to fallback URL...',
              );
              this.switchToFallbackUrl(this.collection);
            }
          }
        }
      },
      error: (error: any) => {
        console.warn('⚠️ WebSocket error:', error);

        if (!this.useFallbackUrl && this.collection) {
          const isConnectionError = this.isConnectionError(error);
          if (isConnectionError) {
            this.errorRetryCount++;
            console.warn(
              `⚠️ WebSocket error (${this.errorRetryCount}/${this.MAX_ERRORS_BEFORE_FALLBACK})`,
            );

            if (
              this.errorRetryCount >= this.MAX_ERRORS_BEFORE_FALLBACK &&
              this.collection
            ) {
              console.log(
                '🔄 WebSocket error detected, switching to fallback URL...',
              );
              this.switchToFallbackUrl(this.collection);
            }
          }
        }
      },
      connected: (socket: any) => {
        console.log('✅ WebSocket connected successfully');
        // Reset error count on successful connection
        this.errorRetryCount = 0;
      },
      pong: (received: boolean) => {
        if (received) {
          // Server responded to ping - connection is healthy
          this.errorRetryCount = 0;
        }
      },
    };
  }

  /**
   * Check if WebSocket close event indicates server problem
   */
  protected isServerCloseEvent(event: any): boolean {
    if (!event) return false;

    // Fatal close codes that indicate server issues
    // Based on GraphQL WebSocket protocol
    const serverErrorCodes = [
      4500, // Internal server error
      4400, // Bad request
      4401, // Unauthorized
      4406, // Subprotocol not acceptable
      4408, // Request Timeout
      4418, // Connection acknowledgement timeout
    ];

    // Also check for connection refused or unexpected closure
    return (
      serverErrorCodes.includes(event.code) ||
      event.code === 1006 || // Abnormal closure
      (!event.wasClean && event.code !== 1000) // Unexpected closure
    );
  }

  /**
   * Check if error is a connection/server error that might benefit from fallback
   */
  protected isConnectionError(error: any): boolean {
    if (!error) return false;

    const errorString = JSON.stringify(error).toLowerCase();
    const errorMessage =
      error?.message?.toLowerCase() || error?.toString?.()?.toLowerCase() || '';

    // Check for common connection/server error indicators
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

  /**
   * Switch replication to fallback URL
   */
  protected async switchToFallbackUrl(collection: RxCollection): Promise<void> {
    const collectionName =
      this.collectionName || this.replicationIdentifier || 'unknown';

    if (this.useFallbackUrl) {
      console.log(
        `⚠️ [REPLICATION] ${collectionName}: Already using fallback URL, cannot switch again`,
      );
      return;
    }

    console.log(
      `\n🔄 [REPLICATION] ${collectionName}: Starting fallback switch process...`,
    );
    console.log(`   Current URL: Primary (${environment.apiUrl})`);
    console.log(`   Target URL: Fallback (${environment.apiUrlFallback})`);

    // Stop current replication safely
    console.log(`   Step 1: Stopping current replication...`);
    if (this.replicationState) {
      try {
        // Check if replication is still active before canceling
        // Note: RxDB replication may have internal storage that could be closed
        const isActive =
          (this.replicationState as any).active$?.getValue?.() ?? true;

        if (isActive) {
          await this.replicationState.cancel();
          console.log(`   ✅ ${collectionName}: Stopped current replication`);
        } else {
          console.log(
            `   ℹ️ ${collectionName}: Replication already inactive, skipping cancel`,
          );
        }
      } catch (error: any) {
        // Handle storage closed error gracefully
        const isStorageClosed =
          error?.message?.includes('is closed') ||
          error?.message?.includes('closed') ||
          error?.stack?.includes('isClosed') ||
          error?.name === 'RxStorageInstanceClosedError';

        if (isStorageClosed) {
          console.log(
            `   ℹ️ ${collectionName}: Storage already closed, replication cleanup skipped`,
          );
        } else {
          console.warn(
            `   ⚠️ ${collectionName}: Warning: Error stopping replication:`,
            error?.message || error,
          );
        }
      } finally {
        // Always clear state even if cancel failed
        this.replicationState = undefined;
      }
    } else {
      console.log(`   ℹ️ ${collectionName}: No active replication to stop`);
    }

    // Mark as using fallback
    this.useFallbackUrl = true;
    this.errorRetryCount = 0; // Reset error count
    console.log(`   Step 2: Marked as using fallback URL`);

    // Restart replication with fallback URL
    console.log(`   Step 3: Setting up replication with fallback URL...`);
    try {
      await this.setupReplicationDirectWithUrl(collection, true);
      console.log(
        `   ✅ ${collectionName}: Successfully switched to fallback URL`,
      );
      console.log(
        `   📍 ${collectionName}: Now using ${environment.apiUrlFallback}`,
      );
    } catch (error: any) {
      console.error(
        `   ❌ ${collectionName}: Failed to switch to fallback URL:`,
        error?.message || error,
      );
      // Reset flag if switch failed
      this.useFallbackUrl = false;
    }
  }

  /**
   * @deprecated Use setupReplicationDirect instead. This method is kept for backward compatibility
   * but now just calls setupReplicationDirect to avoid duplicate adapter attempts.
   */
  protected async setupReplication(
    collection: RxCollection,
  ): Promise<RxGraphQLReplicationState<T, any> | undefined> {
    // Don't try adapter here - it's already attempted in register_replication
    return await this.setupReplicationDirect(collection);
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
    // Prevent duplicate registration - check by identifier and registration state
    // IMPORTANT: Check BEFORE setting this.replicationIdentifier to catch duplicates
    // Also check if we're already in the process of registering (to prevent race conditions)
    const isAlreadyRegistered =
      this.replicationIdentifier === identifier &&
      (this.replicationState || this.adapterReplicationState);

    if (isAlreadyRegistered) {
      console.warn(
        `⚠️ Replication ${identifier} already registered (state: ${
          this.replicationState ? 'direct' : 'none'
        }, adapter: ${
          this.adapterReplicationState ? 'active' : 'none'
        }), skipping duplicate registration`,
      );
      return this.replicationState;
    }

    // Prevent concurrent registration of the same identifier
    if (this._isRegistering && this.replicationIdentifier === identifier) {
      // Wait for the ongoing registration to complete (with timeout)
      let attempts = 0;
      const maxAttempts = 20; // 2 seconds max wait (100ms * 20)

      while (this._isRegistering && attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        attempts++;
      }

      // Check if registration completed successfully
      if (this.replicationState || this.adapterReplicationState) {
        return this.replicationState;
      }

      // If still registering after timeout, log warning but proceed
      if (this._isRegistering) {
        console.warn(
          `⚠️ Replication ${identifier} registration timeout, proceeding anyway...`,
        );
      }
    }

    // Set collection and identifier EARLY (before async operations)
    // This allows guard condition to catch duplicates if called again before first call completes
    const previousIdentifier = this.replicationIdentifier;
    this.collection = collection;
    this.replicationIdentifier = identifier;
    this._isRegistering = true; // Mark as registering to prevent concurrent calls

    try {
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

      // Try adapter first, fallback to direct replication
      if (this.collectionName && this.adapterProvider.isReady()) {
        try {
          await this.setupReplicationViaAdapter();

          return this.replicationState;
        } catch (error: any) {
          // Adapter replication failed - this is OK, we'll use direct replication
          // Common causes:
          // - WebSocket connection not established yet (missing value from map)
          // - Replication already exists and cancel() failed
          // - Configuration issue
          console.warn(
            `⚠️ Adapter replication failed for ${this.collectionName}, falling back to direct replication:`,
            error?.message || error,
          );
          // Don't use fallback URL immediately - try primary URL first
          // Fallback URL will be used only if primary fails during runtime
          // Fallback to direct replication (don't try adapter again)
          const result = await this.setupReplicationDirect(collection);
          this._isRegistering = false; // Clear registration flag
          return result;
        }
      }

      // No adapter available, use direct replication (will check for fallback if primary fails)
      const result = await this.setupReplicationDirect(collection);
      this._isRegistering = false; // Clear registration flag
      return result;
    } catch (error) {
      this._isRegistering = false; // Clear registration flag on error
      throw error;
    }
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
        console.log('Adapter replication stopped');
      } catch (error: any) {
        const isStorageClosed =
          error?.message?.includes('is closed') ||
          error?.message?.includes('closed') ||
          error?.stack?.includes('isClosed');

        if (isStorageClosed) {
          console.log('ℹ️ Storage closed, adapter replication cleanup skipped');
        } else {
          console.warn(
            '⚠️ Error stopping adapter replication:',
            error?.message || error,
          );
        }
      } finally {
        this.adapterReplicationState = undefined;
      }
    }

    // Stop direct replication safely
    if (this.replicationState) {
      try {
        // Check if replication is still active before canceling
        const isActive =
          (this.replicationState as any).active$?.getValue?.() ?? true;

        if (isActive) {
          await this.replicationState.cancel();
          console.log('Direct replication stopped');
        } else {
          console.log(
            'ℹ️ Direct replication already inactive, skipping cancel',
          );
        }
      } catch (error: any) {
        // Handle storage closed error gracefully
        const isStorageClosed =
          error?.message?.includes('is closed') ||
          error?.message?.includes('closed') ||
          error?.stack?.includes('isClosed') ||
          error?.name === 'RxStorageInstanceClosedError';

        if (isStorageClosed) {
          console.log(
            'ℹ️ Storage already closed, direct replication cleanup skipped',
          );
        } else {
          console.warn(
            '⚠️ Error stopping direct replication:',
            error?.message || error,
          );
        }
      } finally {
        // Always clear state even if cancel failed
        this.replicationState = undefined;
      }
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

  /**
   * Get replication status information for monitoring
   */
  getStatus(): {
    useFallbackUrl: boolean;
    isActive: boolean;
    currentUrl: 'primary' | 'fallback';
    errorCount: number;
  } {
    // Check if replication is active
    const isActive =
      (this.replicationState as any)?.active$?.getValue?.() ??
      (!!this.replicationState || !!this.adapterReplicationState);

    return {
      useFallbackUrl: this.useFallbackUrl,
      isActive,
      currentUrl: this.useFallbackUrl ? 'fallback' : 'primary',
      errorCount: this.errorRetryCount,
    };
  }

  /**
   * Get last sync time from replication state
   */
  getLastSyncAt(): Date | undefined {
    // Try to get last sync time from replication state
    if (this.replicationState) {
      // RxDB replication state doesn't directly expose lastSyncAt
      // But we can track it via received$ subscription if needed
      // For now, return undefined and let monitor service track it separately
      return undefined;
    }
    return undefined;
  }

  /**
   * Get replication state for monitoring
   * Returns the underlying replication state object
   */
  getReplicationState(): RxGraphQLReplicationState<T, any> | undefined {
    return this.replicationState;
  }

  /**
   * Check if fallback switch is needed and trigger it
   * Called by ReplicationMonitorService when primary server health check fails
   */
  switchToFallbackIfNeeded(): void {
    const collectionName =
      this.collectionName || this.replicationIdentifier || 'unknown';

    if (!this.useFallbackUrl && this.collection) {
      console.log(
        `\n🔄 [REPLICATION] ${collectionName}: Switching to fallback URL...`,
      );
      // Only switch if not already using fallback and collection is available
      this.switchToFallbackUrl(this.collection)
        .then(() => {
          console.log(
            `✅ [REPLICATION] ${collectionName}: Successfully switched to fallback URL`,
          );
        })
        .catch((error) => {
          console.error(
            `❌ [REPLICATION] ${collectionName}: Failed to switch to fallback URL:`,
            error,
          );
        });
    } else if (this.useFallbackUrl) {
      console.log(
        `ℹ️ [REPLICATION] ${collectionName}: Already using fallback URL`,
      );
    } else {
      console.log(
        `⚠️ [REPLICATION] ${collectionName}: Collection not available, cannot switch`,
      );
    }
  }
}
