import { Injectable, OnDestroy, signal, computed } from '@angular/core';
import { interval, Subject, Subscription } from 'rxjs';
import { DatabaseService } from '../database.service';
import { environment } from 'src/environments/environment';
import { CollectionRegistry } from './collection-registry';

/**
 * Backend server health status
 */
export type ServerHealthStatus = 'online' | 'offline' | 'degraded';

/**
 * Replication status information
 */
export interface ReplicationStatusInfo {
  collectionName: string;
  displayName: string;
  isActive: boolean; // replication active?
  lastSyncAt?: Date;
  backendServerStatus: {
    primary: ServerHealthStatus; // สถานะ backend server
  };
}

/**
 * Backend server health information
 */
export interface BackendServerHealth {
  primary: {
    url: string;
    status: ServerHealthStatus;
    lastCheckAt?: Date;
    consecutiveFailures: number;
  };
}

/**
 * Replication Monitor Service
 * Tracks status of all replication services and backend server health
 */
@Injectable({
  providedIn: 'root',
})
export class ReplicationMonitorService implements OnDestroy {
  // Server health status (signals for reactivity)
  private readonly _primaryServerHealth = signal<ServerHealthStatus>('online');
  private readonly _primaryConsecutiveFailures = signal<number>(0);
  private readonly _lastHealthCheck = signal<Date | null>(null);

  // Health check configuration
  // Note: WebSocket monitoring uses keepAlive (30s) from graphql-ws for ping/pong
  // HTTP health check is used as backup/secondary mechanism
  private readonly HEALTH_CHECK_INTERVAL = 30000; // 30 seconds (less frequent, keepAlive handles WS)
  private readonly DEGRADED_THRESHOLD = 3; // 3 consecutive failures = degraded
  private readonly OFFLINE_THRESHOLD = 5;

  // Feature flag: Enable/disable HTTP health check (testing WebSocket keepAlive only)
  private readonly ENABLE_HTTP_HEALTH_CHECK = false; // Set to true to re-enable HTTP backup check

  private healthCheckSubscription?: Subscription;
  private readonly serverHealthChanged$ = new Subject<BackendServerHealth>();
  private healthCheckCounter = 0; // Counter for health checks

  // Public observable for server health changes
  readonly serverHealthChanges$ = this.serverHealthChanged$.asObservable();

  constructor(private databaseService: DatabaseService) {
    // Make monitor service globally accessible for WebSocket event notifications
    if (typeof window !== 'undefined') {
      (window as any).__MONITOR_SERVICE__ = this;
    }

    if (this.ENABLE_HTTP_HEALTH_CHECK) {
      this.startHealthCheck();
    } else {
      this.startWebSocketEventMonitoring();
    }
  }

  private startWebSocketEventMonitoring(): void {
    const monitorInterval = setInterval(() => {
      this.updateServerHealthFromReplicationStatus();
    }, 5000);

    (this as any)._wsMonitoringInterval = monitorInterval;
  }

  private updateServerHealthFromReplicationStatus(): void {
    const replicationServices = this.databaseService.getReplicationServices();
    let primaryHealthy = true;

    replicationServices.forEach((service: any, collectionName: string) => {
      if (!service) return;

      const status = service.getStatus?.();
      if (!status) return;

      if (!status.isActive) {
        primaryHealthy = false;
      }
    });

    const currentPrimaryHealth = this._primaryServerHealth();
    const newPrimaryHealth = primaryHealthy ? 'online' : 'offline';

    if (currentPrimaryHealth !== newPrimaryHealth) {
      this._primaryServerHealth.set(newPrimaryHealth);
    }

    this.serverHealthChanged$.next(this.getServerHealth());
  }

  getAllReplicationStatus(): ReplicationStatusInfo[] {
    const statuses: ReplicationStatusInfo[] = [];

    const primaryHealth = this.ENABLE_HTTP_HEALTH_CHECK
      ? this._primaryServerHealth()
      : 'online';

    const collections = CollectionRegistry.getAll();

    for (const metadata of collections) {
      const replicationService = this.databaseService
        .getReplicationServices()
        ?.get(metadata.collectionName);

      if (!replicationService) {
        continue;
      }

      const serviceStatus = replicationService.getStatus?.() || {
        isActive: false,
      };

      const lastSyncAt = replicationService.getLastSyncAt?.();

      statuses.push({
        collectionName: metadata.collectionName,
        displayName: metadata.displayName || metadata.collectionName,
        isActive: serviceStatus.isActive ?? false,
        lastSyncAt,
        backendServerStatus: {
          primary: primaryHealth,
        },
      });
    }

    return statuses;
  }

  getServerHealth(): BackendServerHealth {
    if (!this.ENABLE_HTTP_HEALTH_CHECK) {
      return {
        primary: {
          url: environment.apiUrl,
          status: this._primaryServerHealth(),
          lastCheckAt: undefined,
          consecutiveFailures: 0,
        },
      };
    }

    return {
      primary: {
        url: environment.apiUrl,
        status: this._primaryServerHealth(),
        lastCheckAt: this._lastHealthCheck() || undefined,
        consecutiveFailures: this._primaryConsecutiveFailures(),
      },
    };
  }

  readonly primaryServerStatus = computed(() => this._primaryServerHealth());

  startHealthCheck(): void {
    if (!this.ENABLE_HTTP_HEALTH_CHECK) {
      return;
    }

    if (this.healthCheckSubscription) {
      return;
    }

    this.checkServerHealth();

    this.healthCheckSubscription = interval(
      this.HEALTH_CHECK_INTERVAL,
    ).subscribe(() => {
      this.checkServerHealth();
    });
  }

  stopHealthCheck(): void {
    if (this.healthCheckSubscription) {
      this.healthCheckSubscription.unsubscribe();
      this.healthCheckSubscription = undefined;
    }
  }

  private async checkServerHealth(): Promise<void> {
    this.healthCheckCounter++;
    const primaryResult = await this.pingServer(environment.apiUrl);

    const primaryHealthy =
      typeof primaryResult === 'boolean'
        ? primaryResult
        : primaryResult.healthy;

    if (primaryHealthy) {
      const prevFailures = this._primaryConsecutiveFailures();
      if (prevFailures > 0) {
        console.log(`Primary server recovered after ${prevFailures} failures`);
      }
      this._primaryConsecutiveFailures.set(0);
      this._primaryServerHealth.set('online');
    } else {
      const failures = this._primaryConsecutiveFailures() + 1;
      this._primaryConsecutiveFailures.set(failures);
      const prevStatus = this._primaryServerHealth();

      if (failures >= this.OFFLINE_THRESHOLD) {
        if (prevStatus !== 'offline') {
          console.error(
            `Primary server OFFLINE (${failures} consecutive failures)`,
          );
        }
        this._primaryServerHealth.set('offline');
      } else if (failures >= this.DEGRADED_THRESHOLD) {
        if (prevStatus !== 'degraded') {
          console.warn(
            `Primary server DEGRADED (${failures} consecutive failures)`,
          );
        }
        this._primaryServerHealth.set('degraded');
      }
    }

    this._lastHealthCheck.set(new Date());
    this.serverHealthChanged$.next(this.getServerHealth());
  }

  private async pingServer(
    url: string,
  ): Promise<{ healthy: boolean; duration: number; error?: string }> {
    const startTime = Date.now();
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: '{ __typename }',
        }),
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });
      const duration = Date.now() - startTime;

      if (response.ok) {
        return { healthy: true, duration };
      } else {
        return { healthy: false, duration, error: `HTTP ${response.status}` };
      }
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const errorMsg = error?.message || error?.name || 'Unknown error';
      return { healthy: false, duration, error: errorMsg };
    }
  }

  handleWebSocketEvent(
    eventType: 'closed' | 'error' | 'connected',
    urlType: 'primary',
    data: any,
  ): void {
    if (this.ENABLE_HTTP_HEALTH_CHECK) {
      return;
    }

    if (urlType === 'primary') {
      if (eventType === 'closed' || eventType === 'error') {
        this._primaryServerHealth.set('offline');
        this._primaryConsecutiveFailures.set(
          this._primaryConsecutiveFailures() + 1,
        );
      } else if (eventType === 'connected') {
        this._primaryServerHealth.set('online');
        this._primaryConsecutiveFailures.set(0);
      }
    }

    this.serverHealthChanged$.next(this.getServerHealth());
  }

  ngOnDestroy(): void {
    this.stopHealthCheck();

    // Stop WebSocket event monitoring if active
    if ((this as any)._wsMonitoringInterval) {
      clearInterval((this as any)._wsMonitoringInterval);
      (this as any)._wsMonitoringInterval = undefined;
    }

    // Clean up global reference
    if (typeof window !== 'undefined') {
      delete (window as any).__MONITOR_SERVICE__;
    }
  }
}
