import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
  inject,
} from '@angular/core';
import { interval, Subscription } from 'rxjs';
import {
  ReplicationMonitorService,
  ReplicationStatusInfo,
  BackendServerHealth,
  ServerHealthStatus,
} from '../core/replication-monitor.service';

@Component({
  selector: 'app-replication-monitor',
  standalone: false,
  templateUrl: './replication-monitor.component.html',
  styleUrls: ['./replication-monitor.component.scss'],
})
export class ReplicationMonitorComponent implements OnInit, OnDestroy {
  private readonly monitorService = inject(ReplicationMonitorService);
  private readonly cdr = inject(ChangeDetectorRef);

  replicationStatuses: ReplicationStatusInfo[] = [];
  serverHealth: BackendServerHealth | null = null;
  isCollapsed = true;

  private updateSubscription?: Subscription;

  ngOnInit(): void {
    // Initial load
    this.updateStatus();

    // Update every 2 seconds
    this.updateSubscription = interval(2000).subscribe(() => {
      this.updateStatus();
    });
  }

  ngOnDestroy(): void {
    if (this.updateSubscription) {
      this.updateSubscription.unsubscribe();
    }
  }

  private updateStatus(): void {
    this.replicationStatuses = this.monitorService.getAllReplicationStatus();
    this.serverHealth = this.monitorService.getServerHealth();
    this.cdr.detectChanges();
  }

  toggleCollapse(): void {
    this.isCollapsed = !this.isCollapsed;
  }

  getStatusIcon(status: ServerHealthStatus): string {
    switch (status) {
      case 'online':
        return '🟢';
      case 'degraded':
        return '🟡';
      case 'offline':
        return '🔴';
      default:
        return '⚪';
    }
  }

  getStatusText(status: ServerHealthStatus): string {
    switch (status) {
      case 'online':
        return 'Online';
      case 'degraded':
        return 'Degraded';
      case 'offline':
        return 'Offline';
      default:
        return 'Unknown';
    }
  }

  getUrlTypeIcon(urlType: 'primary' | 'fallback'): string {
    return urlType === 'primary' ? '🔵' : '🟣';
  }

  formatDate(date?: Date): string {
    if (!date) return 'Never';
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleTimeString();
  }
}
