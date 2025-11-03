import { Injectable, inject, signal, computed } from '@angular/core';
import { Observable, interval, from, EMPTY } from 'rxjs';
import { switchMap, catchError, map } from 'rxjs/operators';
import { HttpClient } from '@angular/common/http';
import { environment } from 'src/environments/environment';
import { DatabaseService } from './database.service';
import { DeviceMonitoringHistoryFacade } from '../../collections/device-monitoring-history/facade.service';

export type ServerType = 'primary' | 'secondary';

/**
 * Replication Failover Service
 * Manages automatic failover from primary to secondary server
 * and switches back when primary is restored
 */
@Injectable({
  providedIn: 'root',
})
export class ReplicationFailoverService {
  private readonly databaseService = inject(DatabaseService);
  private readonly deviceMonitoringHistoryFacade = inject(
    DeviceMonitoringHistoryFacade,
  );
  private readonly http = inject(HttpClient);

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

  private monitoringInterval?: any;
  private readonly PRIMARY_HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
  private readonly PRIMARY_HEALTH_CHECK_TIMEOUT = 5000; // 5 seconds

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
      console.log('⚠️ [Failover] Already switching servers, skipping...');
      return;
    }

    if (this._currentServer() === 'secondary') {
      console.log('ℹ️ [Failover] Already on secondary server');
      return;
    }

    try {
      this._isSwitching.set(true);
      console.log('🔄 [Failover] Starting failover to secondary server...');

      // Step 1: Stop all replications
      await this.stopAllReplications();

      // Step 2: Get secondary URLs
      const secondaryUrls = this.getSecondaryUrls();
      console.log('📡 [Failover] Secondary URLs:', secondaryUrls);

      // Step 3: Restart replications with secondary URLs
      await this.databaseService.restartReplicationsWithUrls(secondaryUrls);

      // Step 4: Update state
      this._currentServer.set('secondary');
      this._isFailoverActive.set(true);
      console.log('✅ [Failover] Switched to secondary server');

      // Step 5: Start secondary service root
      await this.startSecondaryServiceRoot();

      // Step 6: Log to history
      await this.deviceMonitoringHistoryFacade.appendSecondaryServerOnlineRev(
        secondaryUrls.http,
      );

      console.log('✅ [Failover] Failover to secondary completed');
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
      console.log('⚠️ [Failover] Already switching servers, skipping...');
      return;
    }

    if (this._currentServer() === 'primary') {
      console.log('ℹ️ [Failover] Already on primary server');
      return;
    }

    try {
      this._isSwitching.set(true);
      console.log('🔄 [Failover] Switching back to primary server...');

      // Step 1: Stop all replications
      await this.stopAllReplications();

      // Step 2: Get primary URLs
      const primaryUrls = this.getPrimaryUrls();
      console.log('📡 [Failover] Primary URLs:', primaryUrls);

      // Step 3: Restart replications with primary URLs
      await this.databaseService.restartReplicationsWithUrls(primaryUrls);

      // Step 4: Update state
      this._currentServer.set('primary');
      this._isFailoverActive.set(false);
      console.log('✅ [Failover] Switched back to primary server');

      console.log('✅ [Failover] Switch to primary completed');
    } catch (error) {
      console.error('❌ [Failover] Error switching to primary:', error);
      throw error;
    } finally {
      this._isSwitching.set(false);
    }
  }

  /**
   * Check primary server health
   */
  async checkPrimaryServerHealth(): Promise<boolean> {
    const primaryUrls = this.getPrimaryUrls();
    const healthCheckUrl = primaryUrls.http.replace('/graphql', '/health');

    try {
      const response = await this.http
        .get(healthCheckUrl, {
          timeout: this.PRIMARY_HEALTH_CHECK_TIMEOUT,
        } as any)
        .toPromise();

      const isHealthy = !!response;
      this._primaryServerStatus.set(isHealthy);
      return isHealthy;
    } catch (error) {
      // If health check fails, try basic GraphQL query
      try {
        const response = await this.http
          .post(
            primaryUrls.http,
            {
              query: '{ __typename }',
            },
            {
              timeout: this.PRIMARY_HEALTH_CHECK_TIMEOUT,
            } as any,
          )
          .toPromise();

        const isHealthy = !!response;
        this._primaryServerStatus.set(isHealthy);
        return isHealthy;
      } catch (graphqlError) {
        console.log(
          '⚠️ [Failover] Primary server health check failed:',
          error,
          graphqlError,
        );
        this._primaryServerStatus.set(false);
        return false;
      }
    }
  }

  /**
   * Start monitoring primary server status
   */
  startMonitoring(): void {
    if (this.monitoringInterval) {
      console.log('ℹ️ [Failover] Monitoring already started');
      return;
    }

    console.log('🔍 [Failover] Starting primary server health monitoring...');

    // Only monitor if we're on secondary
    this.monitoringInterval = setInterval(async () => {
      if (this._currentServer() === 'secondary' && !this._isSwitching()) {
        const isHealthy = await this.checkPrimaryServerHealth();
        console.log(
          `🏥 [Failover] Primary server health: ${isHealthy ? 'HEALTHY' : 'DOWN'}`,
        );

        if (isHealthy) {
          console.log(
            '✅ [Failover] Primary server is back online, switching back...',
          );
          await this.switchToPrimary();
        }
      }
    }, this.PRIMARY_HEALTH_CHECK_INTERVAL);

    console.log('✅ [Failover] Primary server monitoring started');
  }

  /**
   * Stop monitoring primary server status
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
      console.log('🛑 [Failover] Primary server monitoring stopped');
    }
  }

  /**
   * Check primary and switch back if healthy
   */
  async checkPrimaryAndSwitchBack(): Promise<void> {
    if (this._currentServer() === 'primary') {
      return; // Already on primary
    }

    if (this._isSwitching()) {
      return; // Already switching
    }

    const isHealthy = await this.checkPrimaryServerHealth();
    if (isHealthy) {
      console.log('✅ [Failover] Primary server is healthy, switching back...');
      await this.switchToPrimary();
    } else {
      console.log(
        '⚠️ [Failover] Primary server still down, staying on secondary',
      );
    }
  }

  /**
   * Start secondary service root
   * Placeholder for actual service root implementation
   */
  async startSecondaryServiceRoot(): Promise<void> {
    console.log('🚀 [Failover] Starting secondary service root...');
    // TODO: Implement actual service root logic on secondary server
    console.log('✅ [Failover] Secondary service root started (placeholder)');
  }

  /**
   * Cleanup on destroy
   */
  ngOnDestroy(): void {
    this.stopMonitoring();
  }
}
