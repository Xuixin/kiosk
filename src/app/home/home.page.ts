import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
  inject,
  computed,
} from '@angular/core';
import { FlowControllerService } from '../flow-services/flow-controller.service';
import { TransactionService } from '../core/Database/collection/txn/facade.service';
import {
  REGISTRY_WALKIN_WORKFLOW,
  REGISTRY_INITIAL_CONTEXT,
} from '../workflow/registry-workflow';
import { ClientIdentityService } from '../services/client-identity.service';
import { ReplicationStateMonitorService } from '../core/Database/replication/services/replication-state-monitor.service';
import { Subscription } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatabaseService } from '../core/Database/services/database.service';

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
  private readonly databaseService = inject(DatabaseService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly identityService = inject(ClientIdentityService);
  private readonly replicationMonitor = inject(ReplicationStateMonitorService);

  // Computed properties for template
  public readonly inCount = computed(() => this.transactionService.stats().in);

  // Replication states
  public readonly replicationStates = toSignal(
    this.replicationMonitor.getStateObservable(),
    { initialValue: this.replicationMonitor.getAllReplicationsState() },
  );

  private timeInterval?: any;
  private replicationSubscription?: Subscription;

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

    // Subscribe to replication state updates
    this.replicationSubscription = this.replicationMonitor
      .getStateObservable()
      .subscribe(() => {
        this.cdr.detectChanges();
      });
  }

  ngOnDestroy() {
    if (this.timeInterval) {
      clearInterval(this.timeInterval);
    }
    if (this.replicationSubscription) {
      this.replicationSubscription.unsubscribe();
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

  clickLog() {
    const a = this.databaseService.getAllReplicationStates();
    console.log(a.values());
  }
}
