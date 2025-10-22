import { Injectable, inject, OnDestroy } from '@angular/core';
import { DatabaseService } from '../core/Database/rxdb.service';
import { TransactionReplicationService } from '../core/Database/transaction-replication.service';
import { DoorPreferenceService } from './door-preference.service';
import { Subscription } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class DoorCheckpointService implements OnDestroy {
  private databaseService = inject(DatabaseService);
  private transactionReplicationService = inject(TransactionReplicationService);
  private doorPreferenceService = inject(DoorPreferenceService);
  private subscription?: Subscription;
  private isInitialized = false;

  constructor() {
    this.setupCheckpointHandshake();
  }

  /**
   * Setup checkpoint handshake mechanism
   * When transaction replication receives data, update door checkpoint
   */
  private setupCheckpointHandshake() {
    // Wait a bit for replication to be set up
    setTimeout(() => {
      this.initializeHandshake();
    }, 1000);
  }

  /**
   * Initialize the handshake mechanism
   */
  private initializeHandshake() {
    if (this.isInitialized) return;

    if (this.transactionReplicationService.replicationState) {
      this.subscription =
        this.transactionReplicationService.replicationState.received$.subscribe(
          async (received) => {
            console.log(
              '🔄 Transaction received, updating door checkpoint:',
              received,
            );
            await this.updateDoorCheckpoint(received);
          },
        );
      this.isInitialized = true;
      console.log('✅ Door checkpoint handshake initialized');
    } else {
      console.warn('⚠️ Transaction replication not ready, retrying in 2s...');
      setTimeout(() => this.initializeHandshake(), 2000);
    }
  }

  /**
   * Update door checkpoint with transaction checkpoint
   */
  private async updateDoorCheckpoint(transactionData: any) {
    try {
      console.log(
        '🔄 Starting door checkpoint update with data:',
        transactionData,
      );

      const doorId = await this.doorPreferenceService.getDoorId();
      if (!doorId) {
        console.warn('No door ID found, cannot update checkpoint');
        return;
      }

      console.log('🚪 Current door ID:', doorId);

      // Extract checkpoint from transaction data
      // The checkpoint should come from the replication response
      let checkpoint = this.extractCheckpoint(transactionData);

      if (!checkpoint) {
        console.warn('No valid checkpoint found in transaction data');
        return;
      }

      console.log('✅ Extracted checkpoint:', checkpoint);

      // Update door document with new checkpoint
      const doorDoc = await this.databaseService.db.door
        .findOne({
          selector: { id: doorId } as any,
        })
        .exec();

      const now = Date.now().toString();

      if (doorDoc) {
        await this.databaseService.db.door.incrementalUpsert({
          id: doorId,
          client_updated_at: now,
          checkpoint: checkpoint,

          deleted: false,
        } as never);
      }
    } catch (error) {
      console.error('❌ Error updating door checkpoint:', error);
    }
  }

  /**
   * Extract checkpoint from transaction replication data
   */
  private extractCheckpoint(transactionData: any): string | null {
    if (!transactionData || typeof transactionData !== 'object') {
      return null;
    }

    console.log('🔍 Extracting checkpoint from:', transactionData);

    // transactionData is a single document, use server_updated_at directly
    if (transactionData.server_updated_at) {
      console.log(
        '✅ Using server_updated_at as checkpoint:',
        transactionData.server_updated_at,
      );
      return transactionData.server_updated_at;
    }

    // Fallback: try server_created_at if server_updated_at is not available
    if (transactionData.server_created_at) {
      console.log(
        '📅 Using server_created_at as checkpoint:',
        transactionData.server_created_at,
      );
      return transactionData.server_created_at;
    }

    console.warn('⚠️ No valid checkpoint found in transaction data');
    return null;
  }

  /**
   * Manually trigger checkpoint update
   */
  async triggerCheckpointUpdate(checkpoint: string) {
    await this.updateDoorCheckpoint({ checkpoint });
  }

  /**
   * Manually initialize handshake (useful if replication starts later)
   */
  initialize() {
    if (!this.isInitialized) {
      this.initializeHandshake();
    }
  }

  /**
   * Get current door checkpoint
   */
  async getCurrentCheckpoint(): Promise<string | null> {
    try {
      const doorId = await this.doorPreferenceService.getDoorId();
      if (!doorId) return null;

      const doorDoc = await this.databaseService.db.door
        .findOne({
          selector: { id: doorId } as any,
        })
        .exec();

      return doorDoc ? (doorDoc as any).checkpoint : null;
    } catch (error) {
      console.error('Error getting current checkpoint:', error);
      return null;
    }
  }

  /**
   * Cleanup subscription
   */
  ngOnDestroy() {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = undefined;
    }
    this.isInitialized = false;
    console.log('🧹 Door checkpoint service cleaned up');
  }
}
