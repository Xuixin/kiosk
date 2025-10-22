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
    console.log('Initial transactions:', this.transactions().length);
    console.log('Initial stats:', this.stats());
  }

  ngOnDestroy() {
    if (this.timeInterval) {
      clearInterval(this.timeInterval);
    }
  }

}
