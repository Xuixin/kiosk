import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, timer } from 'rxjs';
import { map, distinctUntilChanged } from 'rxjs/operators';
import { ReplicationStateService } from './replication-state.service';
import { FailoverEventService } from './failover-event.service';
import { DatabaseService } from '../Database/core/services/database.service';
import { ReplicationFailoverService } from '../Database/core/services/replication-failover.service';

export interface SystemHealthMetrics {
  timestamp: number;
  replicationHealth: {
    totalServices: number;
    activeServices: number;
    inactiveServices: number;
    errorServices: number;
    services: Array<{
      name: string;
      isActive: boolean;
      isConnected: boolean;
      currentUrl: string;
      error?: string;
    }>;
  };
  failoverState: {
    isFailoverActive: boolean;
    isFailoverInProgress: boolean;
    currentServer: 'primary' | 'secondary';
    lastFailoverTime?: number;
    lastFailoverReason?: string;
  };
  eventMetrics: {
    totalEvents: number;
    recentEvents: number;
    criticalEvents: number;
    eventsByType: Record<string, number>;
    eventsBySource: Record<string, number>;
  };
  performanceMetrics: {
    avgResponseTime?: number;
    connectionUptime: number;
    failoverCount: number;
    lastHealthCheck: number;
  };
}

export interface FailoverAlert {
  id: string;
  level: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  message: string;
  timestamp: number;
  source: string;
  data?: any;
  acknowledged?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class FailoverMonitoringService {
  private readonly HEALTH_CHECK_INTERVAL_MS = 5000; // 5 seconds
  private readonly ALERT_HISTORY_LIMIT = 50;
  private readonly METRICS_HISTORY_LIMIT = 100;

  // State streams
  private _currentMetrics = new BehaviorSubject<SystemHealthMetrics | null>(
    null,
  );
  private _metricsHistory = new BehaviorSubject<SystemHealthMetrics[]>([]);
  private _alerts = new BehaviorSubject<FailoverAlert[]>([]);
  private _isMonitoring = new BehaviorSubject<boolean>(false);

  // Observables
  readonly currentMetrics$ = this._currentMetrics.asObservable();
  readonly metricsHistory$ = this._metricsHistory.asObservable();
  readonly alerts$ = this._alerts.asObservable();
  readonly isMonitoring$ = this._isMonitoring.asObservable();

  // Computed observables
  readonly systemHealth$ = this._currentMetrics.pipe(
    map((metrics) => {
      if (!metrics) return 'unknown';

      const { replicationHealth, failoverState } = metrics;

      if (replicationHealth.errorServices > 0) return 'critical';
      if (failoverState.isFailoverInProgress) return 'warning';
      if (replicationHealth.activeServices === 0) return 'critical';
      if (replicationHealth.activeServices < replicationHealth.totalServices)
        return 'warning';

      return 'healthy';
    }),
    distinctUntilChanged(),
  );

  readonly criticalAlerts$ = this._alerts.pipe(
    map((alerts) =>
      alerts.filter(
        (alert) => alert.level === 'critical' && !alert.acknowledged,
      ),
    ),
  );

  constructor(
    private replicationStateService: ReplicationStateService,
    private failoverEventService: FailoverEventService,
    private databaseService: DatabaseService,
    private failoverService: ReplicationFailoverService,
  ) {
    this.initializeMonitoring();
  }

  /**
   * Initialize monitoring system
   */
  private initializeMonitoring(): void {
    console.log(
      '🔍 [FailoverMonitoringService] Initializing monitoring system...',
    );

    // Start health check timer
    timer(0, this.HEALTH_CHECK_INTERVAL_MS).subscribe(() => {
      if (this._isMonitoring.getValue()) {
        this.collectMetrics();
      }
    });

    // Monitor failover events for alerts
    this.failoverEventService.events$.subscribe((event) => {
      this.processEventForAlert(event);
    });

    // Monitor system health changes for alerts
    this.systemHealth$.subscribe((health) => {
      this.processHealthChangeForAlert(health);
    });

    this.startMonitoring();
  }

  /**
   * Start monitoring
   */
  startMonitoring(): void {
    console.log('▶️ [FailoverMonitoringService] Starting monitoring...');
    this._isMonitoring.next(true);

    this.createAlert(
      'info',
      'Monitoring Started',
      'Failover monitoring system is now active',
      'monitoring_service',
    );
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    console.log('⏹️ [FailoverMonitoringService] Stopping monitoring...');
    this._isMonitoring.next(false);

    this.createAlert(
      'info',
      'Monitoring Stopped',
      'Failover monitoring system has been stopped',
      'monitoring_service',
    );
  }

  /**
   * Collect system metrics
   */
  private async collectMetrics(): Promise<void> {
    try {
      const timestamp = Date.now();

      // Get replication health
      const replicationStatuses =
        this.databaseService.getDetailedReplicationStatus();
      const replicationHealth = {
        totalServices: replicationStatuses.length,
        activeServices: replicationStatuses.filter((s) => s.isActive).length,
        inactiveServices: replicationStatuses.filter((s) => !s.isActive).length,
        errorServices: replicationStatuses.filter((s) => s.error).length,
        services: replicationStatuses.map((s) => ({
          name: s.collectionName,
          isActive: s.isActive,
          isConnected: s.isConnected || false,
          currentUrl: s.currentUrl || 'unknown',
          error: s.error,
        })),
      };

      // Get failover state
      const failoverState = this.replicationStateService.failoverState();
      const currentUrls = this.failoverService.getCurrentUrls();
      const isOnSecondary = currentUrls?.http?.includes(':3001') || false;

      const failoverStateMetrics = {
        isFailoverActive: isOnSecondary,
        isFailoverInProgress: failoverState.isFailoverInProgress,
        currentServer: isOnSecondary
          ? ('secondary' as const)
          : ('primary' as const),
        lastFailoverTime: failoverState.lastFailoverTime,
        lastFailoverReason: failoverState.failoverReason,
      };

      // Get event metrics
      const eventStats = this.failoverEventService.getEventStatistics();
      const eventMetrics = {
        totalEvents: eventStats.totalEvents,
        recentEvents: eventStats.recentEvents,
        criticalEvents: Array.from(eventStats.eventsByType.entries())
          .filter(
            ([type]) => type === 'server_down' || type === 'manual_trigger',
          )
          .reduce((sum, [, count]) => sum + count, 0),
        eventsByType: Object.fromEntries(eventStats.eventsByType),
        eventsBySource: Object.fromEntries(eventStats.eventsBySource),
      };

      // Calculate performance metrics
      const performanceMetrics = {
        connectionUptime: this.calculateConnectionUptime(),
        failoverCount: this.calculateFailoverCount(),
        lastHealthCheck: timestamp,
      };

      const metrics: SystemHealthMetrics = {
        timestamp,
        replicationHealth,
        failoverState: failoverStateMetrics,
        eventMetrics,
        performanceMetrics,
      };

      // Update current metrics
      this._currentMetrics.next(metrics);

      // Update metrics history
      const history = this._metricsHistory.getValue();
      const newHistory = [...history, metrics];

      if (newHistory.length > this.METRICS_HISTORY_LIMIT) {
        newHistory.splice(0, newHistory.length - this.METRICS_HISTORY_LIMIT);
      }

      this._metricsHistory.next(newHistory);
    } catch (error) {
      console.error(
        '❌ [FailoverMonitoringService] Error collecting metrics:',
        error,
      );

      this.createAlert(
        'error',
        'Metrics Collection Error',
        `Failed to collect system metrics: ${(error as Error)?.message || 'Unknown error'}`,
        'monitoring_service',
        { error },
      );
    }
  }

  /**
   * Process failover event for alert generation
   */
  private processEventForAlert(event: any): void {
    let alertLevel: FailoverAlert['level'] = 'info';
    let title = 'Failover Event';

    switch (event.severity) {
      case 'critical':
        alertLevel = 'critical';
        title = 'Critical Failover Event';
        break;
      case 'high':
        alertLevel = 'error';
        title = 'High Priority Failover Event';
        break;
      case 'medium':
        alertLevel = 'warning';
        title = 'Failover Warning';
        break;
      case 'low':
        alertLevel = 'info';
        title = 'Failover Information';
        break;
    }

    const message = `${event.type} from ${event.source}: ${JSON.stringify(event.data)}`;

    this.createAlert(alertLevel, title, message, event.source, event);
  }

  /**
   * Process system health change for alert generation
   */
  private processHealthChangeForAlert(health: string): void {
    const previousHealth = this.getPreviousHealth();

    if (health !== previousHealth) {
      let alertLevel: FailoverAlert['level'] = 'info';
      let title = 'System Health Changed';

      switch (health) {
        case 'critical':
          alertLevel = 'critical';
          title = 'System Health Critical';
          break;
        case 'warning':
          alertLevel = 'warning';
          title = 'System Health Warning';
          break;
        case 'healthy':
          alertLevel = 'info';
          title = 'System Health Restored';
          break;
      }

      const message = `System health changed from ${previousHealth} to ${health}`;

      this.createAlert(alertLevel, title, message, 'health_monitor', {
        previousHealth,
        currentHealth: health,
      });
    }
  }

  /**
   * Create and store alert
   */
  private createAlert(
    level: FailoverAlert['level'],
    title: string,
    message: string,
    source: string,
    data?: any,
  ): void {
    const alert: FailoverAlert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      level,
      title,
      message,
      timestamp: Date.now(),
      source,
      data,
      acknowledged: false,
    };

    const alerts = this._alerts.getValue();
    const newAlerts = [alert, ...alerts];

    if (newAlerts.length > this.ALERT_HISTORY_LIMIT) {
      newAlerts.splice(this.ALERT_HISTORY_LIMIT);
    }

    this._alerts.next(newAlerts);

    // Log critical and error alerts
    if (level === 'critical' || level === 'error') {
      console.error(
        `🚨 [FailoverMonitoringService] ${level.toUpperCase()} ALERT: ${title} - ${message}`,
        data,
      );
    } else if (level === 'warning') {
      console.warn(
        `⚠️ [FailoverMonitoringService] WARNING: ${title} - ${message}`,
        data,
      );
    } else {
      console.log(
        `ℹ️ [FailoverMonitoringService] INFO: ${title} - ${message}`,
        data,
      );
    }
  }

  /**
   * Acknowledge alert
   */
  acknowledgeAlert(alertId: string): void {
    const alerts = this._alerts.getValue();
    const updatedAlerts = alerts.map((alert) =>
      alert.id === alertId ? { ...alert, acknowledged: true } : alert,
    );
    this._alerts.next(updatedAlerts);
  }

  /**
   * Clear all acknowledged alerts
   */
  clearAcknowledgedAlerts(): void {
    const alerts = this._alerts.getValue();
    const unacknowledgedAlerts = alerts.filter((alert) => !alert.acknowledged);
    this._alerts.next(unacknowledgedAlerts);
  }

  /**
   * Get system health summary
   */
  getHealthSummary(): Observable<{
    overall: string;
    activeReplications: number;
    totalReplications: number;
    currentServer: string;
    unacknowledgedAlerts: number;
    lastUpdate: number;
  }> {
    return combineLatest([
      this.systemHealth$,
      this._currentMetrics,
      this.criticalAlerts$,
    ]).pipe(
      map(([health, metrics, criticalAlerts]) => ({
        overall: health,
        activeReplications: metrics?.replicationHealth.activeServices || 0,
        totalReplications: metrics?.replicationHealth.totalServices || 0,
        currentServer: metrics?.failoverState.currentServer || 'unknown',
        unacknowledgedAlerts: criticalAlerts.length,
        lastUpdate: metrics?.timestamp || 0,
      })),
    );
  }

  /**
   * Export metrics for external monitoring
   */
  exportMetrics(): SystemHealthMetrics | null {
    return this._currentMetrics.getValue();
  }

  /**
   * Export alerts for external monitoring
   */
  exportAlerts(): FailoverAlert[] {
    return this._alerts.getValue();
  }

  /**
   * Calculate connection uptime (placeholder)
   */
  private calculateConnectionUptime(): number {
    // This would calculate actual uptime based on connection history
    // For now, return a placeholder value
    return Date.now() - (Date.now() - 3600000); // 1 hour placeholder
  }

  /**
   * Calculate failover count (placeholder)
   */
  private calculateFailoverCount(): number {
    // This would count actual failovers from history
    // For now, return based on current state
    const metrics = this._currentMetrics.getValue();
    return metrics?.failoverState.lastFailoverTime ? 1 : 0;
  }

  /**
   * Get previous health state (placeholder)
   */
  private getPreviousHealth(): string {
    // This would track previous health state
    // For now, return a default
    return 'unknown';
  }
}
