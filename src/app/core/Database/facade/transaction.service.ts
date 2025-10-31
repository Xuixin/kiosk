import { Injectable, signal, computed, inject, OnDestroy } from '@angular/core';
import { AdapterProviderService } from '../factory/adapter-provider.service';
import { TransactionReplicationService } from '../replication';
import { Subscription } from 'rxjs';

export interface TransactionStats {
  total: number;
  pending: number;
  in: number;
  out: number;
}

/**
 * Transaction Service
 * Manages transaction data and replication sync
 */
@Injectable({
  providedIn: 'root',
})
export class TransactionService implements OnDestroy {
  private readonly adapterProvider = inject(AdapterProviderService);
  private readonly replicationService = inject(TransactionReplicationService);
  private dbSubscription?: Subscription;
  private replicationSubscription?: Subscription;

  // Signals for reactive data
  private _transactions = signal<any[]>([]);
  public readonly transactions = this._transactions.asReadonly();

  // Computed signals for statistics
  public readonly stats = computed<TransactionStats>(() => {
    const txns = this._transactions();
    return {
      total: txns.length,
      pending: txns.filter((t: any) => t.status === 'PENDING').length,
      in: txns.filter((t: any) => t.status === 'IN').length,
      out: txns.filter((t: any) => t.status === 'OUT').length,
    };
  });

  // Computed signal for recent transactions (last 5)
  public readonly recentTransactions = computed(() => {
    return this._transactions().slice(0, 5);
  });

  constructor() {
    // Setup subscriptions after database is ready
    setTimeout(() => {
      this.setupSubscriptions();
    }, 2000);
  }

  ngOnDestroy() {
    if (this.dbSubscription) {
      this.dbSubscription.unsubscribe();
    }
    if (this.replicationSubscription) {
      this.replicationSubscription.unsubscribe();
    }
  }

  /**
   * Setup database and replication subscriptions
   */
  private setupSubscriptions() {
    try {
      console.log('📊 Setting up transaction subscriptions...');

      // Wait for adapter to be ready, then subscribe to collection changes
      this.adapterProvider.waitUntilReady().then(() => {
        const adapter = this.adapterProvider.getAdapter();
        const collection = adapter.getCollection('txn');

        // Subscribe to local database changes using adapter
        this.dbSubscription = collection.find$().subscribe({
          next: (txns) => {
            console.log(
              '📊 Local database updated:',
              txns.length,
              'transactions',
            );
            // Convert to plain objects if needed (adapter should already return plain objects)
            this._transactions.set(txns as any[]);
          },
          error: (error) => {
            console.error('❌ Error in database subscription:', error);
          },
        });
      });

      // Subscribe to replication events if available
      if (this.replicationService.replicationState) {
        this.replicationSubscription =
          this.replicationService.replicationState.received$.subscribe({
            next: (received) => {
              console.log('🔄 Replication received:', received);
              // Refresh transactions when replication receives data
              this.refreshTransactions();
            },
            error: (error) => {
              console.error('❌ Error in replication subscription:', error);
            },
          });
      }

      console.log('✅ Transaction subscriptions setup completed');
    } catch (error) {
      console.error('❌ Error setting up subscriptions:', error);
    }
  }

  /**
   * Find all transactions
   */
  async findAll() {
    try {
      const adapter = this.adapterProvider.getAdapter();
      const collection = adapter.getCollection('txn');
      const txns = await collection.find();
      this._transactions.set(txns as any[]);
      return txns as any[];
    } catch (error) {
      console.error('❌ Error finding all transactions:', error);
      throw error;
    }
  }

  /**
   * Find transaction by ID
   */
  async findById(id: string) {
    try {
      const adapter = this.adapterProvider.getAdapter();
      const collection = adapter.getCollection('txn');
      const txn = await collection.findOne(id);
      return txn as any;
    } catch (error) {
      console.error('❌ Error finding transaction by id:', error);
      throw error;
    }
  }

  /**
   * Find transactions by status
   */
  async findByStatus(status: string) {
    try {
      const adapter = this.adapterProvider.getAdapter();
      const collection = adapter.getCollection('txn');
      const txns = await collection.find({ status } as any);
      return txns as any[];
    } catch (error) {
      console.error('❌ Error finding transactions by status:', error);
      throw error;
    }
  }

  /**
   * Create a new transaction
   */
  async create(transaction: any) {
    try {
      const adapter = this.adapterProvider.getAdapter();
      const collection = adapter.getCollection('txn');
      const txn = await collection.insert(transaction);
      return txn as any;
    } catch (error) {
      console.error('❌ Error creating transaction:', error);
      throw error;
    }
  }

  /**
   * Update an existing transaction
   */
  async update(id: string, updates: Partial<any>) {
    try {
      const adapter = this.adapterProvider.getAdapter();
      const collection = adapter.getCollection('txn');
      const txn = await collection.update(id, updates);
      return txn as any;
    } catch (error) {
      console.error('❌ Error updating transaction:', error);
      throw error;
    }
  }

  /**
   * Delete a transaction
   */
  async delete(id: string) {
    try {
      const adapter = this.adapterProvider.getAdapter();
      const collection = adapter.getCollection('txn');
      const deleted = await collection.delete(id, false); // Soft delete
      return deleted;
    } catch (error) {
      console.error('❌ Error deleting transaction:', error);
      throw error;
    }
  }

  /**
   * Force delete a transaction (permanent removal from database)
   */
  async forceDelete(id: string) {
    try {
      const adapter = this.adapterProvider.getAdapter();
      const collection = adapter.getCollection('txn');
      const deleted = await collection.delete(id, true); // Hard delete
      return deleted;
    } catch (error) {
      console.error('❌ Error force deleting transaction:', error);
      throw error;
    }
  }

  /**
   * Get transactions by status (computed signal version)
   */
  getTransactionsByStatus(status: string) {
    return computed(() =>
      this._transactions().filter((t: any) => t.status === status),
    );
  }

  /**
   * Manually refresh transactions
   */
  async refreshTransactions() {
    try {
      console.log('🔄 Manually refreshing transactions...');
      const adapter = this.adapterProvider.getAdapter();
      const collection = adapter.getCollection('txn');
      const txns = await collection.find();
      this._transactions.set(txns as any[]);
      console.log('✅ Manually refreshed transactions:', txns.length);
      return txns as any[];
    } catch (error) {
      console.error('❌ Error refreshing transactions:', error);
      throw error;
    }
  }
}
