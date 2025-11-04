import { Injectable, inject, signal, computed } from '@angular/core';
import { environment } from 'src/environments/environment';
import { DatabaseService } from './database.service';
import { DeviceMonitoringHistoryFacade } from '../../collections/device-monitoring-history/facade.service';

export type ServerType = 'primary' | 'secondary';

/**
 * Replication Failover Service
 * Manages automatic failover from primary to secondary server with dynamic checkpoint switching
 */
@Injectable({
  providedIn: 'root',
})
export class ReplicationFailoverService {
  private readonly databaseService = inject(DatabaseService);
  private readonly deviceMonitoringHistoryFacade = inject(
    DeviceMonitoringHistoryFacade,
  );

  // Reactive state using Angular Signals
  private readonly _currentServer = signal<ServerType>('primary');
  private readonly _primaryServerStatus = signal<boolean>(true);
  private readonly _isFailoverActive = signal<boolean>(false);
  private readonly _isSwitching = signal<boolean>(false);

  // Public readonly signals
  public readonly currentServer = this._currentServer.asReadonly();
  public readonly primaryServerStatus = this._primaryServerStatus.asReadonly();
  public readonly isFailoverActive = this._isFailoverActive.asReadonly();
  public readonly isSwitching = this._isSwitching.asReadonly();

  // Computed signals
  public readonly isOnSecondary = computed(
    () => this._currentServer() === 'secondary',
  );

  /**
   * Get current server URLs based on active server
   */
  getCurrentUrls(): { http: string; ws: string } {
    const server = this._currentServer();
    if (server === 'secondary') {
      return {
        http: environment.apiSecondaryUrl || environment.apiUrl,
        ws: environment.wsSecondaryUrl || environment.wsUrl,
      };
    }
    return {
      http: environment.apiUrl,
      ws: environment.wsUrl,
    };
  }

  /**
   * Get primary server URLs
   */
  getPrimaryUrls(): { http: string; ws: string } {
    return {
      http: environment.apiUrl,
      ws: environment.wsUrl,
    };
  }

  /**
   * Get secondary server URLs
   */
  getSecondaryUrls(): { http: string; ws: string } {
    return {
      http: environment.apiSecondaryUrl || environment.apiUrl,
      ws: environment.wsSecondaryUrl || environment.wsUrl,
    };
  }

  /**
   * Stop all active replications
   */
  async stopAllReplications(): Promise<void> {
    console.log('🛑 [Failover] Stopping all replications...');
    try {
      await this.databaseService.stopReplication();
      console.log('✅ [Failover] All replications stopped');
    } catch (error) {
      console.error('❌ [Failover] Error stopping replications:', error);
      throw error;
    }
  }

  /**
   * Restart all replications with specified URLs
   */
  async restartReplicationsWithUrls(urls: {
    http: string;
    ws: string;
  }): Promise<void> {
    console.log(`🔄 [Failover] Restarting replications with URLs:`, urls);
    // This will be implemented in DatabaseService
    // For now, this is a placeholder that will call DatabaseService method
    throw new Error(
      'restartReplicationsWithUrls must be implemented in DatabaseService',
    );
  }

  /**
   * Switch to secondary server
   */
  async switchToSecondary(): Promise<void> {
    if (this._isSwitching()) {
      return;
    }

    if (this._currentServer() === 'secondary') {
      console.log('ℹ️ [Failover] Already on secondary server');
      return;
    }

    try {
      this._isSwitching.set(true);
      await this.stopAllReplications();

      const secondaryUrls = this.getSecondaryUrls();

      await this.databaseService.restartReplicationsWithUrls(secondaryUrls);

      this._currentServer.set('secondary');
      this._isFailoverActive.set(true);

      // Step 5: Start secondary service root
      await this.startSecondaryServiceRoot();

      // Step 6: Log to history
      await this.deviceMonitoringHistoryFacade.appendSecondaryServerOnlineRev(
        secondaryUrls.http,
      );
    } catch (error) {
      console.error('❌ [Failover] Error switching to secondary:', error);
      throw error;
    } finally {
      this._isSwitching.set(false);
    }
  }

  /**
   * Switch back to primary server
   */
  async switchToPrimary(): Promise<void> {
    if (this._isSwitching()) {
      return;
    }

    if (this._currentServer() === 'primary') {
      console.log('ℹ️ [Failover] Already on primary server');
      return;
    }

    try {
      this._isSwitching.set(true);
      // Step 1: Stop all replications from current server
      await this.stopAllReplications();

      // Step 2: Get primary URLs
      const primaryUrls = this.getPrimaryUrls();

      // Step 3: Restart replications with primary URLs
      await this.databaseService.restartReplicationsWithUrls(primaryUrls);

      // Step 4: Update state
      this._currentServer.set('primary');
      this._isFailoverActive.set(false);

      // Step 5: Log to device monitoring history
      await this.deviceMonitoringHistoryFacade.appendPrimaryServerConnectedRev();

      console.log(
        '✅ [Failover] Switch to primary completed with checkpoint switching',
      );
    } catch (error) {
      console.error('❌ [Failover] Error switching to primary:', error);
      throw error;
    } finally {
      this._isSwitching.set(false);
    }
  }

  /**
   * Start secondary service root
   */
  async startSecondaryServiceRoot(): Promise<void> {
    // TODO: Implement actual service root logic on secondary server
  }
}
