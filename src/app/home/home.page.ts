import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
  inject,
  computed,
} from '@angular/core';
import { FlowControllerService } from '../flow-services/flow-controller.service';
import { TransactionService } from '../services/transaction.service';
import {
  REGISTRY_WALKIN_WORKFLOW,
  REGISTRY_INITIAL_CONTEXT,
} from '../workflow/registry-workflow';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false,
})
export class HomePage implements OnInit, OnDestroy {
  currentDate = new Date();
  currentTime = new Date();

  // Inject services
  private readonly flowController = inject(FlowControllerService);
  private readonly transactionService = inject(TransactionService);
  private readonly cdr = inject(ChangeDetectorRef);

  // Signals from service
  public readonly transactions = this.transactionService.transactions;
  public readonly stats = this.transactionService.stats;
  public readonly recentTransactions =
    this.transactionService.recentTransactions;

  // Computed properties for template
  public readonly totalCount = computed(() => this.stats().total);
  public readonly pendingCount = computed(() => this.stats().pending);
  public readonly inCount = computed(() => this.stats().in);
  public readonly outCount = computed(() => this.stats().out);

  private timeInterval?: any;

  constructor() {
    console.log('HomePage constructor');

    this.timeInterval = setInterval(() => {
      this.currentTime = new Date();
      this.cdr.detectChanges();
    }, 60000);
  }

  ngOnInit() {
    console.log('HomePage initialized with reactive signals');
    console.log('Transaction service:', this.transactionService);
    console.log('Initial transactions:', this.transactions());
    console.log('Initial stats:', this.stats());
    console.log('Service working:', this.transactionService.isServiceWorking());

    // เรียกใช้ refresh เพื่อทดสอบ
    this.transactionService.refreshTransactions();

    // ตรวจสอบทุก 5 วินาที
    setInterval(() => {
      console.log('Service status check:', {
        working: this.transactionService.isServiceWorking(),
        transactions: this.transactions().length,
        stats: this.stats(),
      });
    }, 5000);
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
}
