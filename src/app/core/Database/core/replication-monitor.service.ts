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
  currentUrl: 'primary' | 'fallback'; // URL ที่ replication ใช้อยู่
  primaryUrl: string; // http://localhost:10102/graphql
  fallbackUrl: string; // http://localhost:3001/graphql
  lastSyncAt?: Date;
  errorCount: number;
  backendServerStatus: {
    primary: ServerHealthStatus; // สถานะ backend server (primary)
    fallback: ServerHealthStatus; // สถานะ backend server (fallback)
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
  fallback: {
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
  private readonly _fallbackServerHealth = signal<ServerHealthStatus>('online');
  private readonly _primaryConsecutiveFailures = signal<number>(0);
  private readonly _fallbackConsecutiveFailures = signal<number>(0);
  private readonly _lastHealthCheck = signal<Date | null>(null);

  // Health check configuration
  private readonly HEALTH_CHECK_INTERVAL = 10000; // 10 seconds
  private readonly DEGRADED_THRESHOLD = 3; // 3 consecutive failures = degraded
  private readonly OFFLINE_THRESHOLD = 5; // 5 consecutive failures = offline

  private healthCheckSubscription?: Subscription;
  private readonly serverHealthChanged$ = new Subject<BackendServerHealth>();
  private healthCheckCounter = 0; // Counter for health checks

  // Public observable for server health changes
  readonly serverHealthChanges$ = this.serverHealthChanged$.asObservable();

  constructor(private databaseService: DatabaseService) {
    this.startHealthCheck();
  }

  /**
   * Get all replication status information
   */
  getAllReplicationStatus(): ReplicationStatusInfo[] {
    const statuses: ReplicationStatusInfo[] = [];
    const primaryHealth = this._primaryServerHealth();
    const fallbackHealth = this._fallbackServerHealth();

    // Get all collections from registry
    const collections = CollectionRegistry.getAll();

    for (const metadata of collections) {
      const replicationService = this.databaseService
        .getReplicationServices()
        ?.get(metadata.collectionName);

      if (!replicationService) {
        continue;
      }

      // Get status from replication service
      const serviceStatus = replicationService.getStatus?.() || {
        useFallbackUrl: false,
        isActive: false,
        currentUrl: 'primary' as const,
        errorCount: 0,
      };

      const lastSyncAt = replicationService.getLastSyncAt?.();

      statuses.push({
        collectionName: metadata.collectionName,
        displayName: metadata.displayName || metadata.collectionName,
        isActive: serviceStatus.isActive ?? false,
        currentUrl: serviceStatus.useFallbackUrl ? 'fallback' : 'primary',
        primaryUrl: environment.apiUrl,
        fallbackUrl: environment.apiUrlFallback || '',
        lastSyncAt,
        errorCount: serviceStatus.errorCount || 0,
        backendServerStatus: {
          primary: primaryHealth,
          fallback: fallbackHealth,
        },
      });
    }

    return statuses;
  }

  /**
   * Get backend server health status
   */
  getServerHealth(): BackendServerHealth {
    return {
      primary: {
        url: environment.apiUrl,
        status: this._primaryServerHealth(),
        lastCheckAt: this._lastHealthCheck() || undefined,
        consecutiveFailures: this._primaryConsecutiveFailures(),
      },
      fallback: {
        url: environment.apiUrlFallback || '',
        status: this._fallbackServerHealth(),
        lastCheckAt: this._lastHealthCheck() || undefined,
        consecutiveFailures: this._fallbackConsecutiveFailures(),
      },
    };
  }

  /**
   * Computed signal for primary server status
   */
  readonly primaryServerStatus = computed(() => this._primaryServerHealth());

  /**
   * Computed signal for fallback server status
   */
  readonly fallbackServerStatus = computed(() => this._fallbackServerHealth());

  /**
   * Start periodic health check
   */
  startHealthCheck(): void {
    if (this.healthCheckSubscription) {
      return; // Already started
    }

    console.log(
      '🔵 [MONITOR] Starting backend server health check (every 10s)',
    );
    console.log(`🔵 [MONITOR] Primary Server: ${environment.apiUrl}`);
    console.log(
      `🔵 [MONITOR] Fallback Server: ${environment.apiUrlFallback || 'Not configured'}`,
    );

    // Perform initial check
    this.checkServerHealth();

    // Start periodic checks
    this.healthCheckSubscription = interval(
      this.HEALTH_CHECK_INTERVAL,
    ).subscribe(() => {
      this.checkServerHealth();
    });
  }

  /**
   * Stop health check
   */
  stopHealthCheck(): void {
    if (this.healthCheckSubscription) {
      console.log('🔵 [MONITOR] Stopping backend server health check');
      this.healthCheckSubscription.unsubscribe();
      this.healthCheckSubscription = undefined;
    }
  }

  /**
   * Check health of both backend servers
   */
  private async checkServerHealth(): Promise<void> {
    this.healthCheckCounter++;
    const checkId = `[CHECK #${this.healthCheckCounter}]`;
    console.log(`\n📊 ${checkId} Starting health check...`);

    const [primaryResult, fallbackResult] = await Promise.all([
      this.pingServer(environment.apiUrl),
      environment.apiUrlFallback
        ? this.pingServer(environment.apiUrlFallback)
        : Promise.resolve({
            healthy: false,
            duration: 0,
            error: 'Not configured',
          }),
    ]);

    const primaryHealthy =
      typeof primaryResult === 'boolean'
        ? primaryResult
        : primaryResult.healthy;
    const fallbackHealthy =
      typeof fallbackResult === 'boolean'
        ? fallbackResult
        : fallbackResult.healthy;

    // Update primary server status first
    if (primaryHealthy) {
      const prevFailures = this._primaryConsecutiveFailures();
      if (prevFailures > 0) {
        console.log(
          `🟢 ${checkId} Primary server recovered! (was ${prevFailures} failures)`,
        );
      }
      this._primaryConsecutiveFailures.set(0);
      this._primaryServerHealth.set('online');
    } else {
      const failures = this._primaryConsecutiveFailures() + 1;
      this._primaryConsecutiveFailures.set(failures);
      const prevStatus = this._primaryServerHealth();

      if (failures >= this.OFFLINE_THRESHOLD) {
        if (prevStatus !== 'offline') {
          console.log(
            `🔴 ${checkId} Primary server is OFFLINE (${failures} consecutive failures)`,
          );
          console.log(
            `🔄 ${checkId} Triggering fallback switch for all replication services...`,
          );
        }
        this._primaryServerHealth.set('offline');
        // Trigger fallback switch for all replications when primary server is offline
        this.triggerFallbackSwitch();
      } else if (failures >= this.DEGRADED_THRESHOLD) {
        if (prevStatus !== 'degraded') {
          console.log(
            `🟡 ${checkId} Primary server is DEGRADED (${failures} consecutive failures)`,
          );
        }
        this._primaryServerHealth.set('degraded');
      } else {
        // Only log on first few failures to avoid spam
        if (failures <= 2) {
          console.log(
            `   ⚠️ Primary server health check failed (${failures}/${this.OFFLINE_THRESHOLD} to offline)`,
          );
        }
      }
    }

    // Update fallback server status
    if (fallbackHealthy) {
      const prevFailures = this._fallbackConsecutiveFailures();
      if (prevFailures > 0) {
        console.log(
          `🟢 ${checkId} Fallback server recovered! (was ${prevFailures} failures)`,
        );
      }
      this._fallbackConsecutiveFailures.set(0);
      this._fallbackServerHealth.set('online');
    } else {
      const failures = this._fallbackConsecutiveFailures() + 1;
      this._fallbackConsecutiveFailures.set(failures);
      const prevStatus = this._fallbackServerHealth();

      if (failures >= this.OFFLINE_THRESHOLD) {
        if (prevStatus !== 'offline') {
          console.log(
            `🔴 ${checkId} Fallback server is OFFLINE (${failures} consecutive failures)`,
          );
        }
        this._fallbackServerHealth.set('offline');
      } else if (failures >= this.DEGRADED_THRESHOLD) {
        if (prevStatus !== 'degraded') {
          console.log(
            `🟡 ${checkId} Fallback server is DEGRADED (${failures} consecutive failures)`,
          );
        }
        this._fallbackServerHealth.set('degraded');
      } else {
        // Only log on first few failures to avoid spam
        if (failures <= 2) {
          console.log(
            `   ⚠️ Fallback server health check failed (${failures}/${this.OFFLINE_THRESHOLD} to offline)`,
          );
        }
      }
    }

    this._lastHealthCheck.set(new Date());

    // Get final health status after all updates
    const health = this.getServerHealth();

    // Log final status summary (single consolidated log)
    const primaryDuration =
      typeof primaryResult === 'object' ? primaryResult.duration : 'N/A';
    const fallbackDuration =
      typeof fallbackResult === 'object' ? fallbackResult.duration : 'N/A';

    console.log(`\n📊 ${checkId} Health Check Summary:`);
    console.log(
      `   ┌─ Primary Server: ${primaryHealthy ? '✅ OK' : '❌ FAILED'} (${primaryDuration}ms) → Status: ${health.primary.status.toUpperCase()}`,
    );
    if (health.primary.consecutiveFailures > 0) {
      console.log(
        `   │  ⚠️ ${health.primary.consecutiveFailures} consecutive failures`,
      );
    }
    console.log(
      `   └─ Fallback Server: ${fallbackHealthy ? '✅ OK' : '❌ FAILED'} (${fallbackDuration}ms) → Status: ${health.fallback.status.toUpperCase()}`,
    );
    if (health.fallback.consecutiveFailures > 0) {
      console.log(
        `      ⚠️ ${health.fallback.consecutiveFailures} consecutive failures`,
      );
    }

    // Emit health change event
    this.serverHealthChanged$.next(health);
  }

  /**
   * Trigger fallback switch for all replication services
   * Called when primary server health check fails
   */
  private triggerFallbackSwitch(): void {
    const replicationServices = this.databaseService.getReplicationServices();
    const serviceCount = replicationServices.size;
    let switchedCount = 0;

    console.log(
      `\n🔄 [FALLBACK] Triggering fallback switch for ${serviceCount} replication service(s)...`,
    );

    replicationServices.forEach((service: any, collectionName: string) => {
      if (service && typeof service.switchToFallbackIfNeeded === 'function') {
        const currentStatus = service.getStatus?.() || {};
        if (!currentStatus.useFallbackUrl) {
          console.log(
            `🔄 [FALLBACK] Switching ${collectionName} to fallback URL...`,
          );
          service.switchToFallbackIfNeeded();
          switchedCount++;
        } else {
          console.log(
            `ℹ️ [FALLBACK] ${collectionName} already using fallback URL, skipping`,
          );
        }
      }
    });

    console.log(
      `✅ [FALLBACK] Fallback switch completed: ${switchedCount}/${serviceCount} service(s) switched`,
    );
  }

  /**
   * Ping backend server using GraphQL introspection query
   * Returns object with health status, duration, and error info
   */
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
      // Connection error, timeout, or server error
      const duration = Date.now() - startTime;
      const errorMsg = error?.message || error?.name || 'Unknown error';
      return { healthy: false, duration, error: errorMsg };
    }
  }

  ngOnDestroy(): void {
    this.stopHealthCheck();
  }
}
