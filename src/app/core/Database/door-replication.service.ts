import { Injectable, inject } from '@angular/core';
import { replicateGraphQL } from 'rxdb/plugins/replication-graphql';
import { RxGraphQLReplicationState } from 'rxdb/plugins/replication-graphql';
import { RxDoorCollection, RxDoorDocument } from './RxDB.D';
import { RxDoorDocumentType } from '../schema/door.schema';
import { environment } from 'src/environments/environment';
import {
  PULL_DOOR_QUERY,
  PUSH_DOOR_MUTATION,
  STREAM_DOOR_SUBSCRIPTION,
} from './query-builder/door-query-builder';
import { DoorPreferenceService } from '../../services/door-preference.service';

@Injectable({
  providedIn: 'root',
})
export class DoorReplicationService {
  public replicationState?: RxGraphQLReplicationState<RxDoorDocumentType, any>;
  private graphqlEndpoint: string = environment.apiUrl;
  private graphqlWsEndpoint: string = environment.wsUrl;
  private doorPreferenceService: DoorPreferenceService;

  constructor() {
    this.doorPreferenceService = inject(DoorPreferenceService);
  }

  /**
   * เริ่มต้น GraphQL Replication สำหรับ Door
   */
  async setupReplication(
    collection: RxDoorCollection,
  ): Promise<RxGraphQLReplicationState<RxDoorDocumentType, any>> {
    console.log('Setting up Door GraphQL replication...');

    this.replicationState = replicateGraphQL<RxDoorDocumentType, any>({
      collection,
      replicationIdentifier: 'door-graphql-replication',
      url: {
        http: this.graphqlEndpoint,
        ws: this.graphqlWsEndpoint,
      },

      pull: {
        batchSize: 5,
        queryBuilder: (checkpoint, limit) => {
          console.log('🔵 Door Pull Query - checkpoint:', checkpoint);

          return {
            query: PULL_DOOR_QUERY,
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
          console.log('🔄 Door Stream Query - headers:', headers);

          return {
            query: STREAM_DOOR_SUBSCRIPTION,
            variables: {},
          };
        },

        responseModifier: (plainResponse, requestCheckpoint) => {
          console.log('🟢 Door Full Response:', plainResponse);

          const pullData =
            plainResponse.pullDoors ||
            plainResponse.streamDoor ||
            plainResponse;
          const documents = pullData.documents || [];
          const checkpoint = pullData.checkpoint;

          console.log('📊 Door Pull Summary:', {
            documentsCount: documents.length,
            checkpoint: checkpoint,
            requestCheckpoint: requestCheckpoint,
          });

          return {
            documents: documents,
            checkpoint: checkpoint,
          };
        },

        modifier: (doc) => {
          // For door replication, we'll let the server handle filtering
          // The client will only receive documents for the current door
          console.log('🚪 Processing door document:', doc.id);
          return doc;
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
                checkpoint: doc.checkpoint,
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
            query: PUSH_DOOR_MUTATION,
            variables: {
              writeRows,
            },
          };
        },

        dataPath: 'data.pushDoors',

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
      console.error('Door Replication error:', error);
    });

    // เพิ่ม logging สำหรับ pull events
    this.replicationState.received$.subscribe((received) => {
      console.log('Door Replication received:', received);
    });

    this.replicationState.sent$.subscribe((sent) => {
      console.log('Door Replication sent:', sent);
    });

    await this.replicationState.awaitInitialReplication();
    console.log('Door Initial replication completed');

    return this.replicationState;
  }

  /**
   * หยุด replication
   */
  async stopReplication() {
    if (this.replicationState) {
      await this.replicationState.cancel();
      console.log('Door Replication stopped');
    }
  }
}
