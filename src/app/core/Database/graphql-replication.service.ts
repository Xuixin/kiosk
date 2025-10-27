// graphql-replication.service.ts
import { Injectable } from '@angular/core';
import { replicateGraphQL } from 'rxdb/plugins/replication-graphql';
import { RxGraphQLReplicationState } from 'rxdb/plugins/replication-graphql';
import { RxTxnCollection, RxTxnDocument } from './RxDB.D';
import { RxTxnDocumentType } from '../schema/txn.schema';
import { environment } from 'src/environments/environment';
import {
  PUSH_TRANSACTION_MUTATION,
  PULL_TRANSACTION_QUERY,
  STREAM_TRANSACTION_SUBSCRIPTION,
} from './query-builder/txn-query-builder';

@Injectable({
  providedIn: 'root',
})
export class GraphQLReplicationService {
  public replicationState?: RxGraphQLReplicationState<RxTxnDocumentType, any>;
  private graphqlEndpoint: string = environment.apiUrl;
  private graphqlWsEndpoint: string = environment.wsUrl;

  constructor() {}

  /**
   * เริ่มต้น GraphQL Replication
   */
  async setupReplication(
    collection: RxTxnCollection,
  ): Promise<RxGraphQLReplicationState<RxTxnDocumentType, any>> {
    console.log('Setting up GraphQL replication...');

    this.replicationState = replicateGraphQL<RxTxnDocumentType, any>({
      collection,
      replicationIdentifier: 'txn-graphql-replication',
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
                  server_created_at: checkpoint?.server_created_at || '0',
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

          console.log('📊 Pull Summary:', {
            documentsCount: documents.length,
            checkpoint: checkpoint,
            requestCheckpoint: requestCheckpoint,
          });

          // ✅ Return ข้อมูลจริง
          return {
            documents: documents,
            checkpoint: checkpoint,
          };
        },

        modifier: (doc) => {
          // // ❌ ถ้า status = 'OUT' จะไม่บันทึก
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

    this.replicationState.error$.subscribe((error) => {
      console.error('Replication error:', error);
    });

    // เพิ่ม logging สำหรับ pull events
    this.replicationState.received$.subscribe((received) => {
      console.log('Replication received:', received);
    });

    this.replicationState.sent$.subscribe((sent) => {
      console.log('Replication sent:', sent);
    });

    await this.replicationState.awaitInitialReplication();
    console.log('Initial replication completed');

    return this.replicationState;
  }

  /**
   * หยุด replication
   */
  async stopReplication() {
    if (this.replicationState) {
      await this.replicationState.cancel();
      console.log('Replication stopped');
    }
  }
}
