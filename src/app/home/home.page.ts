import { DeviceMonitoringHistoryDocument } from './../core/Database/collection/device-monitoring-history/schema';
import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
  inject,
  computed,
  signal,
} from '@angular/core';
import { FlowControllerService } from '../flow-services/flow-controller.service';
import { TransactionService } from '../core/Database/collection/txn/facade.service';
import {
  REGISTRY_WALKIN_WORKFLOW,
  REGISTRY_INITIAL_CONTEXT,
} from '../workflow/registry-workflow';
import { ClientIdentityService } from '../services/client-identity.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReplicationCoordinatorService } from '../core/Database/services/replication-coordinator.service';
import { ServerHealthService } from '../core/Database/services/server-health.service';
import { DeviceMonitoringHistoryFacade } from '../core/Database/collection/device-monitoring-history';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false,
})
export class HomePage implements OnInit, OnDestroy {
  currentDate = new Date();
  currentTime = new Date();
  clientName: string = '';

  // Inject services
  private readonly flowController = inject(FlowControllerService);
  private readonly transactionService = inject(TransactionService);
  private readonly deviceMonitoringHistoryFacade = inject(
    DeviceMonitoringHistoryFacade,
  );
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly identityService = inject(ClientIdentityService);
  private readonly replicationCoordinator = inject(
    ReplicationCoordinatorService,
  );
  private readonly serverHealth = inject(ServerHealthService);

  public readonly inCount = computed(() => this.transactionService.stats().in);

  public readonly isStartingReplication = signal<boolean>(false);

  // Check if both servers are down - use coordinator state
  public readonly isBothServersDown = toSignal(
    this.replicationCoordinator.replicationsStopped$,
    { initialValue: false },
  );

  private timeInterval?: any;

  constructor() {
    console.log('HomePage constructor');

    this.timeInterval = setInterval(() => {
      this.currentTime = new Date();
      this.cdr.detectChanges();
    }, 60000);
  }

  async ngOnInit() {
    // Load client name
    const name = await this.identityService.getClientName();
    this.clientName = name || 'ไม่ระบุชื่อ';

    // Load initial transaction data
    try {
      await this.transactionService.findAll();
    } catch (error) {
      console.error('❌ Error loading transactions on HomePage init:', error);
    }
  }

  /**
   * Manually start replications
   * Delegate to coordinator
   */
  async startReplication(): Promise<void> {
    if (this.isStartingReplication()) {
      return; // Already starting
    }

    this.isStartingReplication.set(true);

    try {
      const result = await this.replicationCoordinator.handleManualStart();

      if (!result.success) {
        // Show alert if servers are still unavailable
        alert(result.message);
      } else {
        console.log(
          '🔄 [HomePage] Starting server health monitoring after manual start...',
        );
        setTimeout(() => {
          this.serverHealth.startMonitoring();
        }, 500);
      }
    } catch (error: any) {
      console.error('❌ Error starting replications:', error);
      alert('เกิดข้อผิดพลาดในการเริ่มต้น Replication');
    } finally {
      this.isStartingReplication.set(false);
    }
  }

  ngOnDestroy() {
    if (this.timeInterval) {
      clearInterval(this.timeInterval);
    }
  }

  async startRegistryWorkflow(): Promise<void> {
    console.log('Starting Registry Workflow...');
    await this.flowController.startWorkflow(
      REGISTRY_WALKIN_WORKFLOW,
      undefined,
      REGISTRY_INITIAL_CONTEXT,
    );
  }

  async clickLog() {
    const deviceId = await this.identityService.getClientId();
    if (!deviceId) {
      return;
    }
    const timestamp = Date.now();

    const dataLog = {
      id: `log-${timestamp}-${deviceId}`,
      type: 'ERROR',
      meta_data: JSON.stringify({
        severity: 'CRITICAL',
        message:
          'เกิดข้อผิดพลาดรุนแรงระหว่างการซิงค์ข้อมูล ระบบไม่สามารถทำงานต่อได้',
      }),
      device_id: deviceId,
      status: 'ERROR',
      client_created_at: Date.now().toString(),
    };

    await this.deviceMonitoringHistoryFacade.append(dataLog);
  }
}
