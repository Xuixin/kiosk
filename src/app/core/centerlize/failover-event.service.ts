import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { debounceTime, filter, map, scan } from 'rxjs/operators';

export interface FailoverEvent {
  id: string;
  type:
    | 'connection_failure'
    | 'connection_restored'
    | 'server_down'
    | 'server_up'
    | 'manual_trigger';
  source: string; // 'txn', 'device_monitoring', 'device_monitoring_history', 'manual'
  timestamp: number;
  data: {
    retryCount?: number;
    errorCode?: number;
    errorReason?: string;
    url?: string;
    [key: string]: any;
  };
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface FailoverDecision {
  shouldFailover: boolean;
  reason: string;
  confidence: number; // 0-1 scale
  contributingEvents: FailoverEvent[];
  timestamp: number;
}

@Injectable({
  providedIn: 'root',
})
export class FailoverEventService {
  private readonly DEBOUNCE_WINDOW_MS = 5000; // 5 second debounce window
  private readonly EVENT_HISTORY_LIMIT = 100;
  private readonly FAILOVER_THRESHOLD = 0.7; // 70% confidence threshold
  private readonly MAX_DECISION_AGE_MS = 60000; // 1 minute max age for decisions
  private readonly EMERGENCY_FAILOVER_THRESHOLD = 0.9; // 90% confidence for immediate failover

  // Event streams
  private _events = new Subject<FailoverEvent>();
  private _eventHistory = new BehaviorSubject<FailoverEvent[]>([]);
  private _failoverDecisions = new BehaviorSubject<FailoverDecision | null>(
    null,
  );

  // Observables
  readonly events$ = this._events.asObservable();
  readonly eventHistory$ = this._eventHistory.asObservable();
  readonly failoverDecisions$ = this._failoverDecisions.asObservable();

  // Debounced decision stream
  readonly debouncedDecisions$ = this._failoverDecisions.pipe(
    filter((decision) => decision !== null),
    debounceTime(this.DEBOUNCE_WINDOW_MS),
    filter(
      (decision) =>
        decision!.shouldFailover &&
        decision!.confidence >= this.FAILOVER_THRESHOLD,
    ),
  );

  // Emergency failover stream (no debounce for critical situations)
  readonly emergencyDecisions$ = this._failoverDecisions.pipe(
    filter((decision) => decision !== null),
    filter(
      (decision) =>
        decision!.shouldFailover &&
        decision!.confidence >= this.EMERGENCY_FAILOVER_THRESHOLD,
    ),
  );

  constructor() {
    this.initializeEventProcessing();
  }

  /**
   * Initialize event processing pipeline
   */
  private initializeEventProcessing(): void {
    // Process events and maintain history
    this._events
      .pipe(
        scan((history: FailoverEvent[], event: FailoverEvent) => {
          const newHistory = [...history, event];
          // Keep only recent events
          if (newHistory.length > this.EVENT_HISTORY_LIMIT) {
            newHistory.splice(0, newHistory.length - this.EVENT_HISTORY_LIMIT);
          }
          return newHistory;
        }, []),
      )
      .subscribe((history) => {
        this._eventHistory.next(history);
        this.evaluateFailoverDecision(history);
      });

    console.log(
      '🔄 [FailoverEventService] Event processing pipeline initialized',
    );
  }

  /**
   * Emit a failover event
   */
  emitEvent(
    type: FailoverEvent['type'],
    source: string,
    data: FailoverEvent['data'] = {},
    severity: FailoverEvent['severity'] = 'medium',
  ): void {
    const event: FailoverEvent = {
      id: this.generateEventId(),
      type,
      source,
      timestamp: Date.now(),
      data,
      severity,
    };

    console.log(`📡 [FailoverEventService] Event emitted:`, event);
    this._events.next(event);
  }

  /**
   * Evaluate whether failover should be triggered based on event history
   */
  private evaluateFailoverDecision(eventHistory: FailoverEvent[]): void {
    const recentEvents = this.getRecentEvents(eventHistory, 30000); // Last 30 seconds
    const decision = this.calculateFailoverDecision(recentEvents);

    if (decision.shouldFailover) {
      console.log(
        `🚨 [FailoverEventService] Failover decision made:`,
        decision,
      );
    }

    this._failoverDecisions.next(decision);
  }

  /**
   * Calculate failover decision based on events
   */
  private calculateFailoverDecision(events: FailoverEvent[]): FailoverDecision {
    if (events.length === 0) {
      return {
        shouldFailover: false,
        reason: 'No recent events',
        confidence: 0,
        contributingEvents: [],
        timestamp: Date.now(),
      };
    }

    // Count events by type and source
    const eventCounts = this.analyzeEventPatterns(events);

    // Calculate confidence based on multiple factors
    let confidence = 0;
    const reasons: string[] = [];
    const contributingEvents: FailoverEvent[] = [];

    // Factor 1: Multiple connection failures from different sources
    const failureEvents = events.filter((e) => e.type === 'connection_failure');
    const uniqueFailureSources = new Set(failureEvents.map((e) => e.source));

    if (uniqueFailureSources.size >= 2) {
      confidence += 0.4; // 40% confidence for multiple source failures
      reasons.push(
        `Multiple services reporting failures (${uniqueFailureSources.size} sources)`,
      );
      contributingEvents.push(...failureEvents);
    }

    // Factor 2: High retry counts
    const highRetryEvents = events.filter(
      (e) => e.type === 'connection_failure' && (e.data.retryCount || 0) >= 5,
    );

    if (highRetryEvents.length > 0) {
      confidence += 0.3; // 30% confidence for high retry counts
      reasons.push(
        `High retry counts detected (${highRetryEvents.length} events)`,
      );
      contributingEvents.push(...highRetryEvents);
    }

    // Factor 3: Critical severity events
    const criticalEvents = events.filter((e) => e.severity === 'critical');

    if (criticalEvents.length > 0) {
      confidence += 0.4; // 40% confidence for critical events
      reasons.push(
        `Critical events detected (${criticalEvents.length} events)`,
      );
      contributingEvents.push(...criticalEvents);
    }

    // Factor 4: Server down events
    const serverDownEvents = events.filter((e) => e.type === 'server_down');

    if (serverDownEvents.length > 0) {
      confidence += 0.5; // 50% confidence for server down events
      reasons.push(
        `Server down events detected (${serverDownEvents.length} events)`,
      );
      contributingEvents.push(...serverDownEvents);
    }

    // Factor 5: Manual trigger
    const manualTriggers = events.filter((e) => e.type === 'manual_trigger');

    if (manualTriggers.length > 0) {
      confidence = 1.0; // 100% confidence for manual triggers
      reasons.push('Manual failover triggered');
      contributingEvents.push(...manualTriggers);
    }

    // Cap confidence at 1.0
    confidence = Math.min(confidence, 1.0);

    const shouldFailover = confidence >= this.FAILOVER_THRESHOLD;

    return {
      shouldFailover,
      reason: reasons.join('; '),
      confidence,
      contributingEvents: this.deduplicateEvents(contributingEvents),
      timestamp: Date.now(),
    };
  }

  /**
   * Analyze event patterns for decision making
   */
  private analyzeEventPatterns(events: FailoverEvent[]): Map<string, number> {
    const patterns = new Map<string, number>();

    events.forEach((event) => {
      const key = `${event.type}_${event.source}`;
      patterns.set(key, (patterns.get(key) || 0) + 1);
    });

    return patterns;
  }

  /**
   * Get events from the last N milliseconds
   */
  private getRecentEvents(
    events: FailoverEvent[],
    windowMs: number,
  ): FailoverEvent[] {
    const cutoffTime = Date.now() - windowMs;
    return events.filter((event) => event.timestamp >= cutoffTime);
  }

  /**
   * Remove duplicate events based on ID
   */
  private deduplicateEvents(events: FailoverEvent[]): FailoverEvent[] {
    const seen = new Set<string>();
    return events.filter((event) => {
      if (seen.has(event.id)) {
        return false;
      }
      seen.add(event.id);
      return true;
    });
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    return `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get current event statistics
   */
  getEventStatistics(): {
    totalEvents: number;
    recentEvents: number;
    eventsByType: Map<string, number>;
    eventsBySource: Map<string, number>;
    lastDecision: FailoverDecision | null;
  } {
    const history = this._eventHistory.getValue();
    const recentEvents = this.getRecentEvents(history, 60000); // Last minute

    const eventsByType = new Map<string, number>();
    const eventsBySource = new Map<string, number>();

    history.forEach((event) => {
      eventsByType.set(event.type, (eventsByType.get(event.type) || 0) + 1);
      eventsBySource.set(
        event.source,
        (eventsBySource.get(event.source) || 0) + 1,
      );
    });

    return {
      totalEvents: history.length,
      recentEvents: recentEvents.length,
      eventsByType,
      eventsBySource,
      lastDecision: this._failoverDecisions.getValue(),
    };
  }

  /**
   * Clear event history (for testing or maintenance)
   */
  clearEventHistory(): void {
    this._eventHistory.next([]);
    this._failoverDecisions.next(null);
    console.log('🧹 [FailoverEventService] Event history cleared');
  }

  /**
   * Manually trigger failover evaluation
   */
  triggerManualFailover(reason: string, source: string = 'manual'): void {
    this.emitEvent('manual_trigger', source, { reason }, 'critical');
  }

  /**
   * Get observable for specific event types
   */
  getEventsByType(type: FailoverEvent['type']): Observable<FailoverEvent> {
    return this._events.pipe(filter((event) => event.type === type));
  }

  /**
   * Get observable for specific sources
   */
  getEventsBySource(source: string): Observable<FailoverEvent> {
    return this._events.pipe(filter((event) => event.source === source));
  }
}
