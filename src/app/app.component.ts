import { Component, OnInit, OnDestroy } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DatabaseService } from './core/Database/core/services/database.service';
import { ReplicationFailoverService } from './core/Database/core/services/replication-failover.service';
import { DeviceMonitoringFacade } from './core/Database/collections/device-monitoring/facade.service';
import { ReplicationStateService } from './core/centerlize/replication-state.service';
import { FailoverEventService } from './core/centerlize/failover-event.service';
import { FailoverMonitoringService } from './core/centerlize/failover-monitoring.service';
import { Subscription } from 'rxjs';
import { filter, map, takeUntil, distinctUntilChanged } from 'rxjs/operators';
import { environment } from 'src/environments/environment';
import { Subject } from 'rxjs';

import 'zone.js/plugins/zone-patch-rxjs';
@Component({
  selector: 'app-root',
  standalone: false,
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
})
export class AppComponent implements OnInit, OnDestroy {
  private deviceWatcherSubscription?: Subscription;
  private failoverEventSubscription?: Subscription;
  private destroy$ = new Subject<void>();

  constructor(
    private databaseService: DatabaseService,
    private failoverService: ReplicationFailoverService,
    private deviceMonitoringFacade: DeviceMonitoringFacade,
    private replicationStateService: ReplicationStateService,
    private failoverEventService: FailoverEventService,
    private failoverMonitoringService: FailoverMonitoringService,
  ) {}

  async ngOnInit() {
    console.log('🚀 App component initialized');

    // Initialize centralized failover system
    this.initializeCentralizedFailoverSystem();

    // Initialize monitoring and logging
    this.initializeMonitoringAndLogging();

    // Setup primary server recovery watcher (legacy fallback)
    this.setupPrimaryServerWatcher();
  }

  ngOnDestroy() {
    // Signal all subscriptions to complete
    this.destroy$.next();
    this.destroy$.complete();

    // Cleanup subscriptions
    this.deviceWatcherSubscription?.unsubscribe();
    this.failoverEventSubscription?.unsubscribe();

    // Stop replications
    this.databaseService.stopReplication();
  }

  /**
   * Initialize centralized failover system
   */
  private initializeCentralizedFailoverSystem(): void {
    console.log(
      '🔄 [AppComponent] Initializing centralized failover system...',
    );

    // Subscribe to failover decisions from the event service
    this.failoverEventSubscription =
      this.failoverEventService.debouncedDecisions$
        .pipe(takeUntil(this.destroy$))
        .subscribe(async (decision) => {
          if (decision && decision.shouldFailover) {
            console.log(
              '🚨 [AppComponent] Failover decision received:',
              decision,
            );

            try {
              // Trigger coordinated failover through the replication state service
              await this.replicationStateService.triggerCoordinatedFailover(
                decision.reason,
              );
            } catch (error) {
              console.error(
                '❌ [AppComponent] Error executing coordinated failover:',
                error,
              );

              // Fallback to direct failover if coordination fails
              try {
                await this.failoverService.switchToSecondary();
              } catch (fallbackError) {
                console.error(
                  '❌ [AppComponent] Fallback failover also failed:',
                  fallbackError,
                );
              }
            }
          }
        });

    // Monitor replication states for debugging - only log when all become inactive
    this.replicationStateService.replicationStatuses$
      .pipe(
        map((statuses) => ({
          inactiveCount: statuses.filter((s) => !s.isActive).length,
          totalCount: statuses.length,
          statuses,
        })),
        distinctUntilChanged(
          (prev, curr) =>
            prev.inactiveCount === curr.inactiveCount &&
            prev.totalCount === curr.totalCount,
        ),
        takeUntil(this.destroy$),
      )
      .subscribe(({ inactiveCount, totalCount, statuses }) => {
        if (inactiveCount === totalCount && totalCount > 0) {
          console.log(
            '📊 [AppComponent] All replications are inactive:',
            statuses,
          );
        }
      });

    // Monitor failover events for logging
    this.failoverEventService.events$
      .pipe(takeUntil(this.destroy$))
      .subscribe((event) => {
        if (event.severity === 'critical' || event.severity === 'high') {
          console.log('🚨 [AppComponent] High priority failover event:', event);
        }
      });

    // Setup global error handling for failover system
    this.setupGlobalFailoverErrorHandling();

    console.log('✅ [AppComponent] Centralized failover system initialized');
  }

  /**
   * Initialize monitoring and logging system
   */
  private initializeMonitoringAndLogging(): void {
    console.log(
      '📊 [AppComponent] Initializing monitoring and logging system...',
    );

    // The monitoring service starts automatically in its constructor
    // Monitor system health for logging - only log when it changes
    this.failoverMonitoringService.systemHealth$
      .pipe(distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe((health) => {
        console.log(`🏥 [AppComponent] System health changed: ${health}`);
      });

    // Monitor critical alerts - only log when count changes
    this.failoverMonitoringService.criticalAlerts$
      .pipe(
        map((alerts) => ({ count: alerts.length, alerts })),
        distinctUntilChanged((prev, curr) => prev.count === curr.count),
        takeUntil(this.destroy$),
      )
      .subscribe(({ count, alerts }) => {
        if (count > 0) {
          console.error(`🚨 [AppComponent] ${count} critical alerts:`, alerts);
        }
      });

    // Log health summary only when it changes
    this.failoverMonitoringService
      .getHealthSummary()
      .pipe(
        // Only emit when there's an actual change in important fields
        distinctUntilChanged(
          (prev, curr) =>
            prev.overall === curr.overall &&
            prev.activeReplications === curr.activeReplications &&
            prev.currentServer === curr.currentServer &&
            prev.unacknowledgedAlerts === curr.unacknowledgedAlerts,
        ),
        takeUntil(this.destroy$),
      )
      .subscribe((summary) => {
        console.log('📈 [AppComponent] Health Summary Changed:', {
          overall: summary.overall,
          replications: `${summary.activeReplications}/${summary.totalReplications}`,
          server: summary.currentServer,
          alerts: summary.unacknowledgedAlerts,
          lastUpdate: new Date(summary.lastUpdate).toISOString(),
        });
      });

    // Setup performance logging
    this.setupPerformanceLogging();

    console.log('✅ [AppComponent] Monitoring and logging system initialized');
  }

  /**
   * Setup performance logging for failover operations
   */
  private setupPerformanceLogging(): void {
    // Monitor failover performance
    // Use the computed signal instead of observable
    const currentState = this.replicationStateService.failoverState();
    if (currentState.lastFailoverTime) {
      const timeSinceFailover = Date.now() - currentState.lastFailoverTime;
      console.log('⏱️ [AppComponent] Failover Performance:', {
        reason: currentState.failoverReason,
        timeSince: `${Math.round(timeSinceFailover / 1000)}s ago`,
        isInProgress: currentState.isFailoverInProgress,
      });
    }

    // Monitor replication performance only when there are errors
    this.replicationStateService.replicationStatuses$
      .pipe(
        map((statuses) => ({
          total: statuses.length,
          active: statuses.filter((s) => s.isActive).length,
          connected: statuses.filter((s) => s.isConnected).length,
          errors: statuses.filter((s) => s.lastError).length,
        })),
        distinctUntilChanged(
          (prev, curr) =>
            prev.active === curr.active &&
            prev.connected === curr.connected &&
            prev.errors === curr.errors,
        ),
        takeUntil(this.destroy$),
      )
      .subscribe((performanceData) => {
        if (performanceData.errors > 0) {
          console.warn(
            '⚠️ [AppComponent] Replication Performance Issues:',
            performanceData,
          );
        }
      });
  }

  /**
   * Setup global error handling for failover events
   */
  private setupGlobalFailoverErrorHandling(): void {
    // Listen for unhandled failover errors
    window.addEventListener('unhandledrejection', (event) => {
      if (
        event.reason?.message?.includes('failover') ||
        event.reason?.message?.includes('replication')
      ) {
        console.error(
          '🚨 [AppComponent] Unhandled failover error:',
          event.reason,
        );

        // Emit a manual failover event as last resort
        this.failoverEventService.emitEvent(
          'manual_trigger',
          'global_error_handler',
          {
            error: event.reason?.message || 'Unknown error',
            timestamp: Date.now(),
          },
          'critical',
        );
      }
    });
  }

  /**
   * Setup global watcher for primary server recovery (legacy fallback)
   * Monitors device status changes in local database
   */
  private setupPrimaryServerWatcher(): void {
    console.log(
      '🔍 [AppComponent] Setting up global primary server watcher...',
    );

    // Watch for changes to the primary server device (environment.serverId)
    this.deviceWatcherSubscription = this.deviceMonitoringFacade
      .getDeviceMonitoring$()
      .pipe(
        map((devices) => devices.find((d) => d.id === environment.serverId)),
        filter((device) => !!device && device.status === 'ONLINE'),
      )
      .subscribe(async (device: any) => {
        if (device) {
          console.log('🎯 [AppComponent] Primary server detected as ONLINE!', {
            id: device.id,
            name: device.name,
            status: device.status,
            meta_data: device.meta_data,
            created_by: device.created_by,
          });

          // Check if we're currently on secondary server
          const currentUrls = this.failoverService.getCurrentUrls();
          if (currentUrls?.http?.includes(':3001')) {
            console.log(
              '✅ [AppComponent] Currently on secondary, switching to primary...',
            );
            await this.failoverService.switchToPrimary();
          } else {
            console.log(
              'ℹ️ [AppComponent] Already on primary server, no action needed',
            );
          }
        }
      });
  }
}
