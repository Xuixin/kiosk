import { Injectable, signal, computed, inject, OnDestroy } from '@angular/core';
import { DatabaseService } from '../core/Database/rxdb.service';
import { GraphQLReplicationService } from '../core/Database/graphql-replication.service';
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
  private readonly replicationService = inject(GraphQLReplicationService);
  private subscription?: Subscription;
  private replicationSubscription?: Subscription;

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
      this.setupReplicationSubscription();
    }, 2000);
  }

  ngOnDestroy() {
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
    if (this.replicationSubscription) {
      this.replicationSubscription.unsubscribe();
    }
  }

  private setupReplicationSubscription() {
    try {
      console.log('🔄 Setting up replication subscription...');

      // Subscribe to replication received events
      this.replicationSubscription =
        this.replicationService.replicationState?.received$.subscribe({
          next: (received) => {
            console.log('🔄 Replication received:', received);
            this.handleReplicationData(received);
          },
          error: (error) => {
            console.error('❌ Error in replication subscription:', error);
          },
        });

      // Also subscribe to local database changes as backup
      this.subscription = this.databaseService.db.txn.find().$.subscribe({
        next: (txns) => {
          console.log(
            '🔄 Local database updated:',
            txns.length,
            'transactions',
          );
          this._transactions.set(txns);
        },
        error: (error) => {
          console.error('❌ Error in local subscription:', error);
        },
      });

      console.log('✅ Replication subscription setup completed');
    } catch (error) {
      console.error('❌ Error setting up replication subscription:', error);
    }
  }

  private handleReplicationData(received: any) {
    try {
      // received อาจเป็น document เดียวหรือ array ของ documents
      if (Array.isArray(received)) {
        // ถ้าเป็น array ให้อัปเดตทั้งหมด
        this._transactions.set(received);
      } else if (received && typeof received === 'object') {
        // ถ้าเป็น document เดียว ให้เพิ่มหรืออัปเดต
        const currentTxns = this._transactions();
        const existingIndex = currentTxns.findIndex(
          (t) => t.id === received.id,
        );

        if (existingIndex >= 0) {
          // อัปเดต document ที่มีอยู่
          const updatedTxns = [...currentTxns];
          updatedTxns[existingIndex] = received;
          this._transactions.set(updatedTxns);
        } else {
          // เพิ่ม document ใหม่
          this._transactions.set([received, ...currentTxns]);
        }
      }

      console.log(
        '📊 Updated transactions count:',
        this._transactions().length,
      );
    } catch (error) {
      console.error('❌ Error handling replication data:', error);
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
    return (
      (this.subscription && !this.subscription.closed) ||
      (this.replicationSubscription && !this.replicationSubscription.closed)
    );
  }
}
