import { Injectable, computed, inject, signal, Injector } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, combineLatest, BehaviorSubject, timer, of } from 'rxjs';
import {
  map,
  distinctUntilChanged,
  debounceTime,
  switchMap,
  timeout,
  catchError,
  filter,
} from 'rxjs/operators';
import { TransactionReplicationService } from '../Database/collections/txn';
import { DeviceMonitoringReplicationService } from '../Database/collections/device-monitoring';
import { DeviceMonitoringHistoryReplicationService } from '../Database/collections/device-monitoring-history';
import { ReplicationFailoverService } from '../Database/core/services/replication-failover.service';
import { DatabaseService } from '../Database/core/services/database.service';

export interface ReplicationStatus {
  collectionName: string;
  isActive: boolean;
  isConnected: boolean;
  currentUrl?: string;
  lastError?: string;
}

export interface FailoverState {
  isFailoverInProgress: boolean;
  allReplicationsInactive: boolean;
  primaryServerUrl: string;
  secondaryServerUrl: string;
  lastFailoverTime?: number;
  failoverReason?: string;
}

@Injectable({
  providedIn: 'root',
})
export class ReplicationStateService {
  // Signals for reactive state management
  private _failoverInProgress = signal<boolean>(false);
  private _allReplicationsInactive = signal<boolean>(false);
  private _startSecondaryServer = signal<boolean>(false);
  private _failoverState = signal<FailoverState>({
    isFailoverInProgress: false,
    allReplicationsInactive: false,
    primaryServerUrl: 'http://localhost:10102/graphql',
    secondaryServerUrl: 'http://localhost:3001/graphql',
  });

  // Subjects for event coordination
  private _replicationStatuses = new BehaviorSubject<ReplicationStatus[]>([]);
  private _failoverEvents = new BehaviorSubject<{
    type: string;
    source: string;
    data: any;
  }>({ type: 'init', source: 'system', data: {} });

  // Dependencies
  // Use Injector for lazy injection to break circular dependency
  private injector = inject(Injector);
  private deviceStateService = inject(DeviceMonitoringReplicationService);
  private deviceHistoryStateService = inject(
    DeviceMonitoringHistoryReplicationService,
  );
  private failoverService = inject(ReplicationFailoverService);
  private databaseService = inject(DatabaseService);

  // Lazy getter for TransactionReplicationService to break circular dependency
  private get txnStateService(): TransactionReplicationService {
    return this.injector.get(TransactionReplicationService);
  }

  // Computed values
  readonly failoverInProgress = computed(() => this._failoverInProgress());
  readonly allReplicationsInactive = computed(() =>
    this._allReplicationsInactive(),
  );
  readonly failoverState = computed(() => this._failoverState());
  readonly startSecondaryServer = computed(() => this._startSecondaryServer());

  // Observables - convert signals to observables in injection context
  readonly replicationStatuses$ = this._replicationStatuses.asObservable();
  readonly failoverEvents$ = this._failoverEvents.asObservable();
  private readonly startSecondaryServer$ = toObservable(
    this._startSecondaryServer,
  );

  constructor() {
    // Defer initialization to next tick to avoid accessing txnStateService during construction
    setTimeout(() => {
      this.initializeReplicationMonitoring();
      this.setupFailoverCoordination();
    }, 0);
  }

  /**
   * Initialize monitoring of all replication services
   */
  private initializeReplicationMonitoring(): void {
    console.log(
      '🔄 [ReplicationStateService] Initializing replication monitoring...',
    );

    // Monitor all replication services using combineLatest
    const replicationStates$ = combineLatest([
      this.getReplicationStatus('txn', this.txnStateService),
      this.getReplicationStatus('device_monitoring', this.deviceStateService),
      this.getReplicationStatus(
        'device_monitoring_history',
        this.deviceHistoryStateService,
      ),
    ]).pipe(
      debounceTime(1000), // Debounce to prevent rapid updates
      distinctUntilChanged(
        (prev, curr) => JSON.stringify(prev) === JSON.stringify(curr),
      ),
    );

    // Subscribe to combined replication states
    replicationStates$.subscribe((statuses) => {
      this._replicationStatuses.next(statuses);
      this.updateFailoverState(statuses);
    });
  }

  /**
   * Setup failover coordination using RxJS (replaces effect to avoid injection context error)
   */
  private setupFailoverCoordination(): void {
    console.log(
      '🔧 [ReplicationStateService] Setting up failover coordination...',
    );

    // Use pre-converted observable from injection context
    this.startSecondaryServer$
      .pipe(
        filter((shouldStart) => shouldStart === true),
        switchMap(() => {
          console.log(
            '🚨 [ReplicationStateService] Secondary server start requested, monitoring for inactive replications...',
          );

          // Get replication active observables
          const repActive$ =
            this.txnStateService.replicationState?.active$ || of(false);
          const deviceActive$ =
            this.deviceStateService.replicationState?.active$ || of(false);
          const deviceHistoryActive$ =
            this.deviceHistoryStateService.replicationState?.active$ ||
            of(false);

          // Wait for all replications to become inactive
          return combineLatest([
            repActive$,
            deviceActive$,
            deviceHistoryActive$,
          ]).pipe(
            filter(
              ([rep, device, deviceHistory]) =>
                !rep && !device && !deviceHistory,
            ), // All inactive
            debounceTime(2000), // Wait 2 seconds to ensure stability
          );
        }),
      )
      .subscribe(async () => {
        console.log(
          '✅ [ReplicationStateService] All replications inactive, triggering failover...',
        );
        await this.executeFailover('Coordinated shutdown completed');
      });

    console.log(
      '✅ [ReplicationStateService] Failover coordination setup completed',
    );
  }

  /**
   * Get replication status for a specific service
   */
  private getReplicationStatus(
    collectionName: string,
    service: any,
  ): Observable<ReplicationStatus> {
    return timer(0, 2000).pipe(
      // Poll every 2 seconds
      switchMap(() => {
        try {
          const replicationState = service?.replicationState;
          const isActive = replicationState?.active$?.getValue?.() ?? false;
          const currentUrls = service?.currentUrls;

          return of({
            collectionName,
            isActive,
            isConnected: service?.isConnected ?? false,
            currentUrl: currentUrls?.http || 'unknown',
            lastError: undefined,
          });
        } catch (error) {
          return of({
            collectionName,
            isActive: false,
            isConnected: false,
            currentUrl: 'error',
            lastError: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }),
      catchError((error) =>
        of({
          collectionName,
          isActive: false,
          isConnected: false,
          currentUrl: 'error',
          lastError: error?.message || 'Observable error',
        }),
      ),
    );
  }

  /**
   * Update failover state based on replication statuses
   */
  private updateFailoverState(statuses: ReplicationStatus[]): void {
    const primaryServerStatuses = statuses.filter(
      (s) => s.currentUrl?.includes(':10102') || s.currentUrl === 'unknown',
    );

    const allPrimaryInactive = primaryServerStatuses.every((s) => !s.isActive);

    this._allReplicationsInactive.set(allPrimaryInactive);

    const currentState = this._failoverState();
    this._failoverState.set({
      ...currentState,
      allReplicationsInactive: allPrimaryInactive,
    });

    console.log('📊 [ReplicationStateService] Replication status update:', {
      statuses,
      allPrimaryInactive,
      primaryServerStatuses: primaryServerStatuses.length,
    });
  }

  /**
   * Emit failover event from replication services
   */
  emitFailoverEvent(type: string, source: string, data: any): void {
    console.log(
      `🚨 [ReplicationStateService] Failover event: ${type} from ${source}`,
      data,
    );
    this._failoverEvents.next({ type, source, data });

    // If this is a connection failure event, trigger coordinated failover
    if (type === 'connection_failure' && !this._failoverInProgress()) {
      this.triggerCoordinatedFailover(`Connection failure from ${source}`);
    }
  }

  /**
   * Trigger coordinated failover process with timeout and fallback
   */
  async triggerCoordinatedFailover(
    reason: string,
    timeoutMs: number = 10000, // Reduced from 30s to 10s
  ): Promise<void> {
    if (this._failoverInProgress()) {
      console.log(
        '⚠️ [ReplicationStateService] Failover already in progress, skipping',
      );
      return;
    }

    console.log(
      `🔄 [ReplicationStateService] Triggering coordinated failover for reason: ${reason}`,
    );
    console.log(`⏱️ [ReplicationStateService] Timeout set to ${timeoutMs}ms`);

    this._failoverInProgress.set(true);
    this._startSecondaryServer.set(true);

    // Set up timeout fallback
    const timeoutHandle = setTimeout(async () => {
      if (this._failoverInProgress()) {
        console.warn(
          `⚠️ [ReplicationStateService] Coordinated failover timeout after ${timeoutMs}ms, executing fallback...`,
        );
        await this.executeFallbackFailover(
          `Timeout after ${timeoutMs}ms: ${reason}`,
        );
      }
    }, timeoutMs);

    // Store timeout handle for cleanup
    (this as any)._currentFailoverTimeout = timeoutHandle;

    // The effect will handle the rest of the coordination
    console.log(
      '🔄 [ReplicationStateService] Waiting for coordinated shutdown...',
    );
  }

  /**
   * Execute the actual failover after coordination
   */
  private async executeFailover(reason: string): Promise<void> {
    try {
      // Clear timeout if coordination succeeded
      if ((this as any)._currentFailoverTimeout) {
        clearTimeout((this as any)._currentFailoverTimeout);
        (this as any)._currentFailoverTimeout = null;
      }

      console.log(
        '✅ [ReplicationStateService] Executing coordinated failover to secondary server',
      );

      // Use graceful shutdown from database service
      const gracefulSuccess =
        await this.databaseService.gracefulShutdown(10000); // 10 second timeout

      if (gracefulSuccess) {
        console.log(
          '✅ [ReplicationStateService] Graceful shutdown completed, switching to secondary',
        );
      } else {
        console.warn(
          '⚠️ [ReplicationStateService] Graceful shutdown failed, but proceeding with failover',
        );
      }

      await this.failoverService.switchToSecondary();

      // Update failover state
      const currentState = this._failoverState();
      this._failoverState.set({
        ...currentState,
        isFailoverInProgress: false,
        lastFailoverTime: Date.now(),
        failoverReason: reason,
      });

      console.log(
        '🎉 [ReplicationStateService] Coordinated failover completed successfully',
      );
    } catch (error) {
      console.error(
        '❌ [ReplicationStateService] Error during coordinated failover execution:',
        error,
      );

      // Try fallback failover
      await this.executeFallbackFailover(
        `Coordinated failover failed: ${(error as Error)?.message || 'Unknown error'}`,
      );
    } finally {
      this._failoverInProgress.set(false);
      this._startSecondaryServer.set(false);

      // Clean up timeout
      if ((this as any)._currentFailoverTimeout) {
        clearTimeout((this as any)._currentFailoverTimeout);
        (this as any)._currentFailoverTimeout = null;
      }
    }
  }

  /**
   * Execute fallback failover when coordination fails or times out
   */
  private async executeFallbackFailover(reason: string): Promise<void> {
    console.warn(
      '🚨 [ReplicationStateService] Executing fallback failover:',
      reason,
    );

    try {
      console.log(
        '⏱️ [ReplicationStateService] Step 1/4: Force stopping all replications...',
      );
      // Force stop all replications immediately
      await this.databaseService.forceStopAllReplications();

      console.log(
        '⏱️ [ReplicationStateService] Step 2/4: Waiting 2s for cleanup...',
      );
      // Wait a brief moment for cleanup
      await new Promise((resolve) => setTimeout(resolve, 2000));

      console.log(
        '⏱️ [ReplicationStateService] Step 3/4: Switching to secondary server...',
      );
      // Execute direct failover
      await this.failoverService.switchToSecondary();

      console.log(
        '⏱️ [ReplicationStateService] Step 4/4: Updating failover state...',
      );
      // Update failover state
      const currentState = this._failoverState();
      this._failoverState.set({
        ...currentState,
        isFailoverInProgress: false,
        lastFailoverTime: Date.now(),
        failoverReason: `FALLBACK: ${reason}`,
      });

      console.log('🎉 [ReplicationStateService] Fallback failover completed');

      // Log replication status after failover
      setTimeout(() => {
        const statuses = this.getCurrentStatuses();
        console.log(
          '📊 [ReplicationStateService] Post-failover replication status:',
          {
            active: statuses.filter((s) => s.isActive).length,
            total: statuses.length,
            statuses: statuses.map((s) => ({
              collection: s.collectionName,
              active: s.isActive,
              connected: s.isConnected,
              url: s.currentUrl,
            })),
          },
        );
      }, 5000); // Check after 5 seconds
    } catch (error) {
      console.error(
        '❌ [ReplicationStateService] Fallback failover also failed:',
        error,
      );

      // Last resort: reset state and hope for the best
      this._failoverInProgress.set(false);
      this._startSecondaryServer.set(false);

      // Update state to reflect failure
      const currentState = this._failoverState();
      this._failoverState.set({
        ...currentState,
        isFailoverInProgress: false,
        lastFailoverTime: Date.now(),
        failoverReason: `FAILED: ${reason} - ${(error as Error)?.message || 'Unknown error'}`,
      });
    }
  }

  /**
   * Check if coordinated failover should be triggered (with timeout)
   */
  async checkAndTriggerFailover(
    reason: string,
    timeoutMs: number = 30000,
  ): Promise<void> {
    if (this._failoverInProgress()) {
      console.log(
        '⚠️ [ReplicationStateService] Failover already in progress, skipping',
      );
      return;
    }

    console.log(
      `🔄 [ReplicationStateService] Checking failover conditions for reason: ${reason}`,
    );

    this._failoverInProgress.set(true);

    try {
      // Wait for all primary replications to become inactive (with timeout)
      const waitResult = await this.waitForReplicationsInactive(timeoutMs);

      if (waitResult) {
        console.log(
          '✅ [ReplicationStateService] All replications inactive, proceeding with failover',
        );
        await this.failoverService.switchToSecondary();
      } else {
        console.warn(
          '⚠️ [ReplicationStateService] Timeout waiting for replications to become inactive, forcing failover',
        );
        await this.failoverService.switchToSecondary();
      }

      // Update failover state
      const currentState = this._failoverState();
      this._failoverState.set({
        ...currentState,
        isFailoverInProgress: false,
        lastFailoverTime: Date.now(),
        failoverReason: reason,
      });
    } catch (error) {
      console.error(
        '❌ [ReplicationStateService] Error during coordinated failover:',
        error,
      );
    } finally {
      this._failoverInProgress.set(false);
    }
  }

  /**
   * Wait for all replications to become inactive with timeout
   */
  private async waitForReplicationsInactive(
    timeoutMs: number,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const startTime = Date.now();

      const checkInterval = setInterval(() => {
        const currentStatuses = this._replicationStatuses.getValue();
        const primaryStatuses = currentStatuses.filter(
          (s) => s.currentUrl?.includes(':10102') || s.currentUrl === 'unknown',
        );

        const allInactive = primaryStatuses.every((s) => !s.isActive);

        if (allInactive) {
          clearInterval(checkInterval);
          resolve(true);
          return;
        }

        if (Date.now() - startTime > timeoutMs) {
          clearInterval(checkInterval);
          resolve(false);
          return;
        }
      }, 1000); // Check every second
    });
  }

  /**
   * Get current replication statuses
   */
  getCurrentStatuses(): ReplicationStatus[] {
    return this._replicationStatuses.getValue();
  }

  /**
   * Manual failover trigger (for emergency situations)
   */
  async forceFailover(reason: string): Promise<void> {
    console.log(
      `🚨 [ReplicationStateService] Force failover triggered: ${reason}`,
    );
    this._failoverInProgress.set(true);

    try {
      await this.failoverService.switchToSecondary();
    } catch (error) {
      console.error(
        '❌ [ReplicationStateService] Error during force failover:',
        error,
      );
    } finally {
      this._failoverInProgress.set(false);
    }
  }

  /**
   * Reset failover state (for testing or recovery)
   */
  resetFailoverState(): void {
    this._failoverInProgress.set(false);
    this._startSecondaryServer.set(false);
    this._allReplicationsInactive.set(false);
    console.log('🔄 [ReplicationStateService] Failover state reset');
  }
}
