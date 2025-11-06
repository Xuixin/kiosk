/**
 * Replication Manager Service
 * Manages all replication operations (start, stop, switch, initialize)
 */

import { Injectable, inject } from '@angular/core';
import { RxDatabase, RxCollection } from 'rxdb';
import { RxGraphQLReplicationState } from 'rxdb/plugins/replication-graphql';
import { environment } from 'src/environments/environment';
import { ClientIdentityService } from '../../../../services/client-identity.service';
import {
  PRIMARY_IDENTIFIERS,
  SECONDARY_IDENTIFIERS,
  REPLICATION_IDENTIFIERS,
} from '../constants/replication.constants';
import {
  isPrimaryIdentifier,
  isSecondaryIdentifier,
} from '../utils/replication.utils';
import { checkGraphQLConnection } from '../utils/connection.utils';
import { createReplicationConfigs } from '../config/replication.configs';
import {
  setupCollectionReplication,
  ReplicationConfig,
} from './replication-helper';

interface DatabaseCollections {
  transaction: RxCollection;
  devicemonitoring: RxCollection;
  devicemonitoringhistory: RxCollection;
}

@Injectable({
  providedIn: 'root',
})
export class ReplicationManagerService {
  private replicationStates: Map<string, RxGraphQLReplicationState<any, any>> =
    new Map();
  private readonly identity = inject(ClientIdentityService);

  // Optional: ReplicationStateMonitorService (inject lazily to avoid circular dependency)
  private replicationMonitorService: any = null;

  // Event emitter for primary recovery
  private primaryRecoveryListeners: Set<() => void | Promise<void>> = new Set();

  /**
   * Set replication monitor service (called after initialization to avoid circular dependency)
   */
  setReplicationMonitorService(monitorService: any): void {
    this.replicationMonitorService = monitorService;
  }

  /**
   * Notify replication monitor about state changes
   */
  private notifyReplicationMonitor(): void {
    if (this.replicationMonitorService?.notifyStateChange) {
      this.replicationMonitorService.notifyStateChange();
    }
  }

  /**
   * Check connection to GraphQL server
   * Uses shared connection utility
   */
  private async checkConnection(url: string): Promise<boolean> {
    return checkGraphQLConnection(url);
  }

  /**
   * Initialize all 6 replications (primary + secondary for each collection)
   */
  async initializeReplications(
    db: RxDatabase<DatabaseCollections>,
    emitPrimaryRecovery?: () => Promise<void>,
  ): Promise<void> {
    if (!db) {
      throw new Error('Database must be initialized first');
    }

    const primaryAvailable = await this.checkConnection(environment.apiUrl);
    let useSecondary = false;
    let isOffline = false;

    if (!primaryAvailable) {
      // Check secondary server availability
      const secondaryUrl = environment.apiSecondaryUrl || environment.apiUrl;
      const secondaryAvailable = await this.checkConnection(secondaryUrl);

      if (!secondaryAvailable) {
        // Offline mode: Both servers unavailable
        // Don't throw error - allow offline-first operation
        console.log(
          '⚠️ [ReplicationManager] Both primary and secondary servers are unavailable. Operating in offline mode.',
        );
        isOffline = true;
        // Set global flag to indicate offline mode
        (window as any).__USE_SECONDARY_SERVER__ = false;
        (window as any).__IS_OFFLINE_MODE__ = true;

        // Stop any existing replications gracefully before initializing new ones
        if (this.replicationStates.size > 0) {
          console.log(
            '🛑 [ReplicationManager] Stopping existing replications before offline initialization...',
          );
          await this.stopAllReplicationsGracefully();
        }
      } else {
        useSecondary = true;
        // Set global flag for other services to use
        (window as any).__USE_SECONDARY_SERVER__ = true;
        (window as any).__IS_OFFLINE_MODE__ = false;
      }
    } else {
      // Primary is available, clear the flag
      (window as any).__USE_SECONDARY_SERVER__ = false;
      (window as any).__IS_OFFLINE_MODE__ = false;
    }

    const serverId =
      (await this.identity.getClientId()) || environment.serverId;

    // Create replication configs using the config factory
    // Use internal emitPrimaryRecoveryEvent if no external handler provided
    const emitRecovery =
      emitPrimaryRecovery || (() => this.emitPrimaryRecoveryEvent());
    const replicationConfigs = createReplicationConfigs(
      db,
      serverId,
      emitRecovery,
    );

    // Initialize all replications
    for (const config of replicationConfigs) {
      try {
        // Set autoStart based on which server we're using
        if (isOffline) {
          // Offline mode: Disable autoStart for all replications
          // They can be started manually when connection is restored
          config.autoStart = false;
        } else if (useSecondary) {
          // Using secondary server - enable secondary replications, disable primary
          config.autoStart = isSecondaryIdentifier(
            config.replicationIdentifier,
          );
        } else {
          // Using primary server - enable primary replications, disable secondary
          config.autoStart = isPrimaryIdentifier(config.replicationIdentifier);
        }

        const replicationState = setupCollectionReplication(config);
        this.replicationStates.set(
          config.replicationIdentifier,
          replicationState,
        );

        // Log initial active state
        const initialActive =
          (replicationState as any).active$?.getValue?.() ?? false;
        console.log(
          `✅ [ReplicationManager] Replication initialized: ${config.name} (active: ${initialActive})`,
        );
      } catch (error) {
        console.error(
          `❌ [ReplicationManager] Failed to initialize replication: ${config.name}`,
          error,
        );
      }
    }

    // Replications with autoStart: true will start automatically
    // No need to manually call startSecondary() or startPrimary()
    if (isOffline) {
      console.log(
        '⚠️ [ReplicationManager] Operating in offline mode - all replications initialized with autoStart: false',
      );
      console.log(
        '💡 [ReplicationManager] Replications will be started automatically when connection is restored',
      );
    } else if (useSecondary) {
      console.log(
        '✅ [ReplicationManager] Secondary replications initialized with autoStart: true',
      );
    } else {
      console.log(
        '✅ [ReplicationManager] Primary replications initialized with autoStart: true',
      );
    }

    // Notify replication monitor about state changes
    setTimeout(() => this.notifyReplicationMonitor(), 500);
  }

  /**
   * Start replications by identifiers (generic method)
   */
  private async startReplicationsByIdentifiers(
    identifiers: readonly string[],
    serverType: 'primary' | 'secondary',
  ): Promise<void> {
    console.log(
      `🔄 [ReplicationManager] Starting ${serverType} replications...`,
    );

    // Check if replication states exist
    if (this.replicationStates.size === 0) {
      console.warn(
        `⚠️ [ReplicationManager] No replication states found, cannot start ${serverType}. Reinitialization needed.`,
      );
      return;
    }

    for (const identifier of identifiers) {
      const state = this.replicationStates.get(identifier);
      if (state) {
        try {
          // Check if replication is already started
          const wasStarted = this.getWasStarted(state);
          const isActive = (state as any).active$?.getValue?.() ?? false;

          // Skip if already started and active
          if (wasStarted && isActive) {
            console.log(
              `⏭️ [ReplicationManager] ${serverType} ${identifier} already started and active, skipping`,
            );
            continue;
          }

          if (serverType === 'secondary' && !isActive) {
            // For secondary, if not active, try start() method first
            if (typeof (state as any).start === 'function') {
              await (state as any).start();
              this.setWasStarted(state, true);
              console.log(
                `✅ [ReplicationManager] Started ${serverType}: ${identifier}`,
              );
            } else {
              // Fallback: use reSync if start() is not available
              state.reSync();
              this.setWasStarted(state, true);
              console.log(
                `✅ [ReplicationManager] Re-synced ${serverType}: ${identifier}`,
              );
            }
          } else {
            // For primary or if secondary is already active, just re-sync
            state.reSync();
            this.setWasStarted(state, true);
            console.log(
              `✅ [ReplicationManager] ${isActive ? 'Re-synced active' : 'Started'} ${serverType}: ${identifier}`,
            );
          }
        } catch (error: any) {
          console.error(
            `❌ [ReplicationManager] Error starting ${serverType} ${identifier}:`,
            error.message,
          );
        }
      } else {
        console.log(
          `⚠️ [ReplicationManager] ${serverType} replication not found: ${identifier}`,
        );
      }
    }
  }

  /**
   * Start secondary replications (without canceling primary)
   * Use this when server is down at runtime - don't cancel inactive primary replications
   */
  async startSecondary(): Promise<void> {
    await this.startReplicationsByIdentifiers(
      SECONDARY_IDENTIFIERS,
      'secondary',
    );
  }

  /**
   * Start primary replications (without canceling secondary)
   * Use this when initializing with primary available
   */
  async startPrimary(): Promise<void> {
    await this.startReplicationsByIdentifiers(PRIMARY_IDENTIFIERS, 'primary');
  }

  /**
   * Switch all replications from primary to secondary
   * Use this when server goes down at runtime (after initial startup)
   */
  async switchToSecondary(): Promise<void> {
    console.log(
      '🔄 [ReplicationManager] Switching to secondary replications...',
    );

    // Check if replication states exist
    if (this.replicationStates.size === 0) {
      console.warn(
        '⚠️ [ReplicationManager] No replication states found, cannot switch to secondary. Reinitialization needed.',
      );
      return;
    }

    // Check if secondary replications are already active
    if (this.areReplicationsActiveByIdentifiers(SECONDARY_IDENTIFIERS)) {
      console.log(
        '⏭️ [ReplicationManager] Secondary replications already active, skipping switch',
      );
      return;
    }

    // Cancel all primary replications (only if they are active)
    await this.cancelPrimaryReplications();

    // Wait a bit for cleanup
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Start secondary replications
    await this.startSecondary();

    // Notify replication monitor about state changes
    setTimeout(() => this.notifyReplicationMonitor(), 200);
  }

  /**
   * Switch all replications from secondary back to primary
   * Use this when primary server recovers at runtime
   */
  async switchToPrimary(): Promise<void> {
    console.log('🔄 [ReplicationManager] Switching to primary replications...');

    // Check if replication states exist
    if (this.replicationStates.size === 0) {
      console.warn(
        '⚠️ [ReplicationManager] No replication states found, cannot switch to primary. Reinitialization needed.',
      );
      return;
    }

    // Check if primary replications are already active
    if (this.areReplicationsActiveByIdentifiers(PRIMARY_IDENTIFIERS)) {
      console.log(
        '⏭️ [ReplicationManager] Primary replications already active, skipping switch',
      );
      return;
    }

    // Cancel all secondary replications (only if they are active)
    await this.cancelSecondaryReplications();

    // Wait a bit for cleanup
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Start primary replications
    await this.startPrimary();

    // Notify replication monitor about state changes
    setTimeout(() => this.notifyReplicationMonitor(), 200);
  }

  /**
   * Check if any replications in the given identifiers array are active
   */
  private areReplicationsActiveByIdentifiers(
    identifiers: readonly string[],
  ): boolean {
    for (const identifier of identifiers) {
      const state = this.replicationStates.get(identifier);
      if (state) {
        const wasStarted = this.getWasStarted(state);
        if (wasStarted) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Cancel replications by identifiers (generic method)
   */
  private async cancelReplicationsByIdentifiers(
    identifiers: readonly string[],
    serverType: 'primary' | 'secondary',
  ): Promise<void> {
    console.log(
      `🛑 [ReplicationManager] Cancelling ${serverType} replications...`,
    );
    for (const identifier of identifiers) {
      const state = this.replicationStates.get(identifier);
      if (state) {
        await this.cancelSingleReplication(identifier, state);
      } else {
        console.log(
          `ℹ️ [ReplicationManager] ${serverType} replication not found: ${identifier}`,
        );
      }
    }
  }

  /**
   * Cancel all secondary replications (keep primary active)
   * Uses graceful cancellation to handle errors better
   * Checks wasStarted before cancelling to prevent "missing value from map" error
   */
  private async cancelSecondaryReplications(): Promise<void> {
    await this.cancelReplicationsByIdentifiers(
      SECONDARY_IDENTIFIERS,
      'secondary',
    );
  }

  /**
   * Cancel all primary replications (keep secondary active)
   * Uses graceful cancellation to handle errors better
   * Checks wasStarted before cancelling to prevent "missing value from map" error
   */
  private async cancelPrimaryReplications(): Promise<void> {
    await this.cancelReplicationsByIdentifiers(PRIMARY_IDENTIFIERS, 'primary');
  }

  /**
   * Get replication state by identifier
   */
  getReplicationState(
    identifier: string,
  ): RxGraphQLReplicationState<any, any> | null {
    return this.replicationStates.get(identifier) || null;
  }

  /**
   * Get all replication states
   */
  getAllReplicationStates(): Map<string, RxGraphQLReplicationState<any, any>> {
    return this.replicationStates;
  }

  /**
   * Get wasStarted flag from replication state
   */
  private getWasStarted(state: RxGraphQLReplicationState<any, any>): boolean {
    return (state as any).wasStarted ?? false;
  }

  /**
   * Set wasStarted flag on replication state
   */
  private setWasStarted(
    state: RxGraphQLReplicationState<any, any>,
    value: boolean,
  ): void {
    (state as any).wasStarted = value;
  }

  /**
   * Close WebSocket connection for a replication state
   * RxDB replication state may not close websocket on cancel()
   * Tries multiple methods to access and close the WebSocket
   */
  private async closeReplicationWebSocket(
    state: RxGraphQLReplicationState<any, any>,
    identifier: string,
  ): Promise<void> {
    try {
      // Method 1: Try to access wsRef directly
      const wsRef = (state as any).wsRef;
      if (wsRef) {
        const ws = wsRef.get?.() || wsRef;
        if (ws && typeof ws.close === 'function') {
          ws.close(1000, 'Replication cancelled');
          console.log(
            `🔌 [ReplicationManager] Closed WebSocket via wsRef for ${identifier}`,
          );
          return;
        }
      }

      // Method 2: Try to access through graphQLState
      const graphqlState = (state as any).graphQLState;
      if (graphqlState) {
        const wsUrl = state.url?.ws || (state as any).url?.ws;
        if (wsUrl) {
          // Try to get websocket from internal map and close it
          const wsMap = (graphqlState as any).websocketByUrl;
          if (wsMap && wsMap instanceof Map) {
            const ws = wsMap.get(wsUrl);
            if (ws && typeof ws.close === 'function') {
              ws.close(1000, 'Replication cancelled');
              wsMap.delete(wsUrl);
              console.log(
                `🔌 [ReplicationManager] Closed WebSocket via map for ${identifier}`,
              );
              return;
            }
          }
        }
      }

      // Method 3: Try to access through pull stream
      const pullState = (state as any).pullState;
      if (pullState) {
        const stream = pullState.stream;
        if (stream && stream.close) {
          stream.close();
          console.log(
            `🔌 [ReplicationManager] Closed stream for ${identifier}`,
          );
          return;
        }
      }
    } catch (error: any) {
      console.log(
        `⚠️ [ReplicationManager] Error closing WebSocket for ${identifier}:`,
        error.message,
      );
    }
  }

  /**
   * Close WebSocket if needed (wrapper for consistency)
   */
  private async closeReplicationWebSocketIfNeeded(
    state: RxGraphQLReplicationState<any, any>,
    identifier: string,
  ): Promise<void> {
    await this.closeReplicationWebSocket(state, identifier);
  }

  /**
   * Cancel a single replication with all checks and WebSocket closure
   */
  private async cancelSingleReplication(
    identifier: string,
    state: RxGraphQLReplicationState<any, any>,
  ): Promise<void> {
    try {
      const wasStarted = this.getWasStarted(state);
      if (wasStarted) {
        await state.cancel();
        // Close WebSocket explicitly
        await this.closeReplicationWebSocketIfNeeded(state, identifier);
        this.setWasStarted(state, false); // Mark as not started
        console.log(
          `✅ [ReplicationManager] Cancelled replication: ${identifier}`,
        );
      } else {
        console.log(
          `ℹ️ [ReplicationManager] Replication ${identifier} was not started, skipping cancel`,
        );
      }
    } catch (error: any) {
      // Ignore errors if replication is already cancelled or not started
      console.log(
        `⚠️ [ReplicationManager] Error cancelling replication ${identifier} (may already be stopped):`,
        error.message,
      );
    }
  }

  /**
   * Stop all replications gracefully without throwing errors
   * Used when both servers are down - stops all replications without clearing states
   * This allows replications to be restarted manually when servers are available
   * Checks wasStarted before cancelling to prevent "missing value from map" error
   */
  async stopAllReplicationsGracefully(): Promise<void> {
    console.log(
      '🛑 [ReplicationManager] Stopping all replications gracefully (both servers down)...',
    );
    const allStates = Array.from(this.replicationStates.entries());

    if (allStates.length === 0) {
      console.log('ℹ️ [ReplicationManager] No replications to stop');
      return;
    }

    // Cancel all replications using generic helper
    for (const [identifier, state] of allStates) {
      await this.cancelSingleReplication(identifier, state);
    }

    // Don't clear replication states map - we want to keep them for manual restart
    console.log(
      '✅ [ReplicationManager] All replications stopped gracefully (states preserved)',
    );

    // Notify replication monitor about state changes
    this.notifyReplicationMonitor();
  }

  /**
   * Stop all replications (for cleanup on app destroy)
   * Checks wasStarted before cancelling to prevent "missing value from map" error
   */
  async stopReplication(): Promise<void> {
    console.log('🛑 [ReplicationManager] Stopping all replications...');
    const allStates = Array.from(this.replicationStates.entries());

    // Cancel all replications using generic helper
    for (const [identifier, state] of allStates) {
      await this.cancelSingleReplication(identifier, state);
    }

    this.replicationStates.clear();
    console.log('✅ [ReplicationManager] All replications stopped');

    this.notifyReplicationMonitor();
  }

  /**
   * Reinitialize replications (public method for reconnecting after offline)
   * Checks server availability and starts appropriate replications
   */
  async reinitializeReplications(
    db: RxDatabase<DatabaseCollections>,
    emitPrimaryRecovery?: () => Promise<void>,
  ): Promise<void> {
    if (!db) {
      throw new Error('Database must be initialized first');
    }

    // If replication states already exist, clear them first
    if (this.replicationStates.size > 0) {
      console.log(
        '🔄 [ReplicationManager] Clearing existing replication states...',
      );
      this.replicationStates.clear();
    }

    // Reinitialize using the same logic as initial setup
    await this.initializeReplications(db, emitPrimaryRecovery);
    console.log('✅ [ReplicationManager] Replications reinitialized');
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
  async emitPrimaryRecoveryEvent(): Promise<void> {
    console.log(
      `📢 [ReplicationManager] Emitting primary recovery event to ${this.primaryRecoveryListeners.size} listener(s)`,
    );

    const promises = Array.from(this.primaryRecoveryListeners).map((callback) =>
      Promise.resolve(callback()),
    );

    await Promise.all(promises);
    console.log('✅ [ReplicationManager] Primary recovery event handled');
  }

  /**
   * Check if both primary and secondary servers are down
   * Returns true if both servers are unavailable
   */
  async checkBothServersDown(): Promise<boolean> {
    const primaryAvailable = await this.checkConnection(environment.apiUrl);
    if (primaryAvailable) {
      return false; // Primary is available
    }

    const secondaryUrl = environment.apiSecondaryUrl || environment.apiUrl;
    const secondaryAvailable = await this.checkConnection(secondaryUrl);
    return !secondaryAvailable; // Both are down if secondary is also unavailable
  }

  /**
   * Manually start replications based on server availability
   * Returns object with success status and message
   */
  async startReplicationsManually(): Promise<{
    success: boolean;
    message: string;
  }> {
    console.log('🔄 [ReplicationManager] Manual start requested...');

    // Check primary server first
    const primaryAvailable = await this.checkConnection(environment.apiUrl);
    if (primaryAvailable) {
      console.log(
        '✅ [ReplicationManager] Primary server available, starting primary replications...',
      );
      try {
        await this.startPrimary();
        return {
          success: true,
          message: 'เชื่อมต่อกับ Primary Server สำเร็จ',
        };
      } catch (error: any) {
        console.error(
          '❌ [ReplicationManager] Error starting primary replications:',
          error.message,
        );
        return {
          success: false,
          message: 'เกิดข้อผิดพลาดในการเริ่มต้น Primary Replication',
        };
      }
    }

    // Check secondary server
    const secondaryUrl = environment.apiSecondaryUrl || environment.apiUrl;
    const secondaryAvailable = await this.checkConnection(secondaryUrl);
    if (secondaryAvailable) {
      console.log(
        '✅ [ReplicationManager] Secondary server available, starting secondary replications...',
      );
      try {
        await this.startSecondary();
        return {
          success: true,
          message: 'เชื่อมต่อกับ Secondary Server สำเร็จ',
        };
      } catch (error: any) {
        console.error(
          '❌ [ReplicationManager] Error starting secondary replications:',
          error.message,
        );
        return {
          success: false,
          message: 'เกิดข้อผิดพลาดในการเริ่มต้น Secondary Replication',
        };
      }
    }

    // Both servers are still unavailable
    console.log('⚠️ [ReplicationManager] Both servers are still unavailable');
    return {
      success: false,
      message:
        'ไม่สามารถเชื่อมต่อกับทั้ง Primary และ Secondary Server ได้ กรุณาลองใหม่อีกครั้ง',
    };
  }
}
