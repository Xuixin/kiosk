import { Injectable } from '@angular/core';
import { replicateGraphQL } from 'rxdb/plugins/replication-graphql';
import { RxGraphQLReplicationState } from 'rxdb/plugins/replication-graphql';
import { RxCollection } from 'rxdb';
import { environment } from 'src/environments/environment';
import { NetworkStatusService } from '../network-status.service';
import { BaseReplicationService } from './base-replication.service';
import { DoorDocument } from '../../schema/door.schema';
import { doorQueryBuilder } from '../query-builder/door-query-builder';

/**
 * Door-specific GraphQL replication service
 * Extends BaseReplicationService for door collection replication
 */
@Injectable({
  providedIn: 'root',
})
export class DoorReplicationService extends BaseReplicationService<DoorDocument> {
  private graphqlEndpoint: string = environment.apiUrl;
  private graphqlWsEndpoint: string = environment.wsUrl;

  constructor(networkStatus: NetworkStatusService) {
    super(networkStatus);
  }

  /**
   * Setup door-specific GraphQL replication
   */
  protected async setupReplication(
    collection: RxCollection,
  ): Promise<RxGraphQLReplicationState<DoorDocument, any> | undefined> {
    console.log('Setting up Door GraphQL replication...');

    // Check if app is online before starting replication
    if (!this.networkStatus.isOnline()) {
      console.log('⚠️ Application is offline - replication setup skipped');
      console.log(
        '📝 Replication will start automatically when connection is restored',
      );
      return undefined;
    }

    this.replicationState = replicateGraphQL<DoorDocument, any>({
      collection: collection as any,
      replicationIdentifier:
        this.replicationIdentifier || 'door-graphql-replication',
      url: {
        http: this.graphqlEndpoint,
        ws: this.graphqlWsEndpoint,
      },

      pull: {
        batchSize: 10,
        queryBuilder: (checkpoint, limit) => {
          console.log('🔵 Pull Door Query - checkpoint:', checkpoint);

          return {
            query: doorQueryBuilder.getPullQuery(),
            variables: {
              input: {
                checkpoint: {
                  id: checkpoint?.id || '',
                  server_updated_at: checkpoint?.server_updated_at || '0',
                },
                limit: limit || 10,
              },
            },
          };
        },

        streamQueryBuilder: (headers) => {
          console.log('🔄 Stream Door Query - headers:', headers);

          return {
            query: doorQueryBuilder.getStreamSubscription() || '',
            variables: {},
          };
        },

        responseModifier: (plainResponse) => {
          console.log('🟢 Door Full Response:', plainResponse);

          const pullData =
            plainResponse.pullDoors ||
            plainResponse.streamDoor ||
            plainResponse;
          const documents = pullData.documents || [];
          const checkpoint = pullData.checkpoint;

          return {
            documents: documents,
            checkpoint: checkpoint,
          };
        },

        modifier: (doc) => {
          // Filter out deleted doors
          if (doc.deleted) {
            return {
              ...doc,
              _deleted: true,
            };
          }
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
                max_persons: doc.max_persons,
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
            query: doorQueryBuilder.getPushMutation(),
            variables: {
              writeRows,
            },
          };
        },

        dataPath: 'data.pushDoors',

        modifier: (doc) => doc,
      },

      live: true,
      retryTime: 60000,
      autoStart: true,
      waitForLeadership: true,
    });

    if (this.replicationState) {
      // Handle replication errors gracefully (server down, network errors, etc.)
      this.replicationState.error$.subscribe((error) => {
        // Log error but don't crash - offline-first approach
        console.warn('⚠️ Door Replication error:', error);
        // RxDB will automatically retry when connection is restored
      });

      this.replicationState.received$.subscribe((received) => {
        console.log('✅ Door Replication received:', received);
      });

      this.replicationState.sent$.subscribe((sent) => {
        console.log('📤 Door Replication sent:', sent);
      });

    
    }

    return this.replicationState;
  }
}
