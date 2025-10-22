import { Injectable, signal, computed, inject, OnDestroy } from '@angular/core';
import { DatabaseService } from '../core/Database/rxdb.service';
import { Subscription } from 'rxjs';

export interface TransactionStats {
  total: number;
  pending: number;
  in: number;
  out: number;
}

@Injectable({
  providedIn: 'root',
})
export class TransactionService implements OnDestroy {
  private readonly databaseService = inject(DatabaseService);
  private subscription?: Subscription;
  private retryCount = 0;
  private maxRetries = 5;

  // Signals for reactive data
  private _transactions = signal<any[]>([]);
  public readonly transactions = this._transactions.asReadonly();

  // Computed signals for statistics
  public readonly stats = computed<TransactionStats>(() => {
    const txns = this._transactions();
    return {
      total: txns.length,
      pending: txns.filter((t) => t.status === 'PENDING').length,
      in: txns.filter((t) => t.status === 'IN').length,
      out: txns.filter((t) => t.status === 'OUT').length,
    };
  });

  // Computed signal for recent transactions (last 5)
  public readonly recentTransactions = computed(() => {
    return this._transactions().slice(0, 5);
  });

  constructor() {
    // ใช้ setTimeout เพื่อให้ database พร้อมก่อน
    setTimeout(() => {
      this.setupReactiveSubscription();
    }, 2000);
  }

  ngOnDestroy() {
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
  }

  private setupReactiveSubscription() {
    try {
      console.log(
        '🔄 Setting up transaction reactive subscription... (attempt:',
        this.retryCount + 1,
        ')',
      );
      console.log('Database service:', this.databaseService);
      console.log('Database instance:', this.databaseService.db);
      console.log('Txn collection:', this.databaseService.db.txn);

      // ตรวจสอบว่า database พร้อมหรือไม่
      if (!this.databaseService.db || !this.databaseService.db.txn) {
        console.error('❌ Database or txn collection not ready, retrying...');
        this.retrySubscription();
        return;
      }

      this.subscription = this.databaseService.db.txn.find().$.subscribe({
        next: (txns) => {
          console.log(
            '🔄 Transaction data updated:',
            txns.length,
            'transactions',
          );
          console.log('Sample transaction:', txns[0]);
          this._transactions.set(txns);
          this.retryCount = 0; // Reset retry count on success
        },
        error: (error) => {
          console.error('❌ Error in transaction subscription:', error);
          this.retrySubscription();
        },
      });

      console.log('✅ Transaction subscription setup completed');
    } catch (error) {
      console.error('❌ Error setting up reactive subscription:', error);
      this.retrySubscription();
    }
  }

  private retrySubscription() {
    if (this.retryCount < this.maxRetries) {
      this.retryCount++;
      console.log(
        '🔄 Retrying subscription in 2 seconds... (attempt:',
        this.retryCount,
        ')',
      );
      setTimeout(() => {
        this.setupReactiveSubscription();
      }, 2000);
    } else {
      console.error('❌ Max retries reached, giving up on subscription');
    }
  }

  // Method to manually refresh data if needed
  async refreshTransactions() {
    try {
      console.log('🔄 Manually refreshing transactions...');
      const txns = await this.databaseService.db.txn.find().exec();
      this._transactions.set(txns);
      console.log('🔄 Manually refreshed transactions:', txns.length);
    } catch (error) {
      console.error('❌ Error refreshing transactions:', error);
    }
  }

  // Method to get transactions by status
  getTransactionsByStatus(status: string) {
    return computed(() =>
      this._transactions().filter((t) => t.status === status),
    );
  }

  // Method to check if service is working
  isServiceWorking() {
    return this.subscription && !this.subscription.closed;
  }
}
