import { Injectable } from '@angular/core';
import { replicateGraphQL } from 'rxdb/plugins/replication-graphql';
import { RxGraphQLReplicationState } from 'rxdb/plugins/replication-graphql';
import { RxCollection } from 'rxdb';
import { RxTxnCollection } from '../RxDB.D';
import { RxTxnDocumentType } from '../../schema';
import { environment } from 'src/environments/environment';
import { NetworkStatusService } from '../network-status.service';
import { ClientIdentityService } from '../../identity/client-identity.service';
import { BaseReplicationService } from './base-replication.service';
import {
  PUSH_TRANSACTION_MUTATION,
  PULL_TRANSACTION_QUERY,
  STREAM_TRANSACTION_SUBSCRIPTION,
} from '../query-builder/txn-query-builder';

/**
 * Transaction-specific GraphQL replication service
 * Extends BaseReplicationService for transaction collection replication
 */
@Injectable({
  providedIn: 'root',
})
export class TransactionReplicationService extends BaseReplicationService<RxTxnDocumentType> {
  private graphqlEndpoint: string = environment.apiUrl;
  private graphqlWsEndpoint: string = environment.wsUrl;

  constructor(
    networkStatus: NetworkStatusService,
    private readonly identity: ClientIdentityService,
  ) {
    super(networkStatus);
  }

  /**
   * Setup transaction-specific GraphQL replication
   */
  protected async setupReplication(
    collection: RxCollection,
  ): Promise<RxGraphQLReplicationState<RxTxnDocumentType, any> | undefined> {
    const txnCollection = collection as unknown as RxTxnCollection;

    console.log('Setting up Transaction GraphQL replication...');

    // Check if app is online before starting replication
    if (!this.networkStatus.isOnline()) {
      console.log('⚠️ Application is offline - replication setup skipped');
      console.log(
        '📝 Replication will start automatically when connection is restored',
      );
      return undefined;
    }

    this.replicationState = replicateGraphQL<RxTxnDocumentType, any>({
      collection: txnCollection as any,
      replicationIdentifier:
        this.replicationIdentifier || 'txn-graphql-replication',
      url: {
        http: this.graphqlEndpoint,
        ws: this.graphqlWsEndpoint,
      },

      pull: {
        batchSize: 5,
        queryBuilder: (checkpoint, limit) => {
          console.log('🔵 Pull Query - checkpoint:', checkpoint);

          return {
            query: PULL_TRANSACTION_QUERY,
            variables: {
              input: {
                checkpoint: {
                  id: checkpoint?.id || '',
                  server_updated_at: checkpoint?.server_updated_at || '0',
                },
                limit: limit || 5,
              },
            },
          };
        },

        streamQueryBuilder: (headers) => {
          console.log('🔄 Stream Query - headers:', headers);

          return {
            query: STREAM_TRANSACTION_SUBSCRIPTION,
            variables: {},
          };
        },

        responseModifier: (plainResponse, requestCheckpoint) => {
          // plainResponse = { pullTransaction: { documents: [...], checkpoint: {...} } }
          // or { streamTransaction2: { documents: [...], checkpoint: {...} } }

          console.log('🟢 Full Response:', plainResponse);

          const pullData =
            plainResponse.pullTransaction ||
            plainResponse.streamTransaction2 ||
            plainResponse;
          const documents = pullData.documents || [];
          const checkpoint = pullData.checkpoint;

          // const filteredDocs = documents.filter((d: any) => d.status !== 'OUT');

          // ✅ Return ข้อมูลจริง
          return {
            documents: documents,
            checkpoint: checkpoint,
          };
        },

        modifier: (doc) => {
          if (doc.status === 'OUT') {
            return {
              ...doc,
              _deleted: true,
            };
          }

          return {
            ...doc,
            door_permission:
              typeof doc.door_permission === 'string'
                ? doc.door_permission.split(',').map((s: any) => s.trim())
                : doc.door_permission,
          };
        },

        wsOptions: {
          connectionParams: async () => {
            const client_id = await this.identity.getClientId();
            const client_type = this.identity.getClientType();
            return {
              client_id,
              client_type,
              door_id: client_id,
            };
          },

          connectionAckWaitTimeout: 1000,
        },
      },

      push: {
        queryBuilder: (docs) => {
          const writeRows = docs.map((docRow) => {
            const doc = docRow.newDocumentState;
            return {
              newDocumentState: {
                id: doc.id,
                name: doc.name,
                id_card_base64: doc.id_card_base64,
                student_number: doc.student_number,
                register_type: doc.register_type,
                door_permission: Array.isArray(doc.door_permission)
                  ? doc.door_permission.join(',')
                  : doc.door_permission,
                status: doc.status,
                client_created_at:
                  doc.client_created_at || Date.now().toString(),
                client_updated_at:
                  doc.client_updated_at || Date.now().toString(),
                server_created_at: doc.server_created_at,
                server_updated_at: doc.server_updated_at,
                diff_time_create: doc.diff_time_create || '0',
                diff_time_update: doc.diff_time_update || '0',
                deleted: docRow.assumedMasterState === null,
              },
            };
          });

          return {
            query: PUSH_TRANSACTION_MUTATION,
            variables: {
              writeRows,
            },
          };
        },

        dataPath: 'data.pushTransaction',

        modifier: (doc) => {
          return doc;
        },
      },

      live: true,
      retryTime: 60000,
      autoStart: true,
      waitForLeadership: true,

      headers: {
        // 'Authorization': 'Bearer YOUR_TOKEN',
      },
    });

    if (this.replicationState) {
      // Handle replication errors gracefully (server down, network errors, etc.)
      this.replicationState.error$.subscribe(async (err: any) => {
        // Log error but don't crash - offline-first approach
        console.warn('⚠️ Transaction Replication error:', err);

        

  
      });

      // เพิ่ม logging สำหรับ pull events
      this.replicationState.received$.subscribe((received) => {
        console.log('✅ Transaction Replication received:', received);
      });

      this.replicationState.sent$.subscribe((sent) => {
        console.log('📤 Transaction Replication sent:', sent);
      });

      // Wait for initial replication with timeout and error handling
      // This allows app to continue working even if server is down
      try {
        await Promise.race([
          this.replicationState.awaitInitialReplication(),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('Initial replication timeout')),
              10000,
            ),
          ),
        ]);
        console.log('✅ Initial transaction replication completed');
      } catch (error: any) {
        // Server might be down - app continues to work offline
        console.warn(
          '⚠️ Initial replication not completed (server may be down):',
          error.message || error,
        );
        console.log(
          '📝 App will continue working offline. Replication will retry automatically.',
        );
      }
    }

    return this.replicationState;
  }
}
