import { Injectable } from '@angular/core';
import { replicateGraphQL } from 'rxdb/plugins/replication-graphql';
import { RxGraphQLReplicationState } from 'rxdb/plugins/replication-graphql';
import { RxCollection } from 'rxdb';
import { environment } from 'src/environments/environment';
import { NetworkStatusService } from '../network-status.service';
import { BaseReplicationService } from './base-replication.service';
import { HandshakeDocument } from '../../schema';
import { handshakeQueryBuilder } from '../query-builder/handshake-query-builder';

/**
 * Handshake-specific GraphQL replication service
 * Extends BaseReplicationService for handshake collection replication
 */
@Injectable({
  providedIn: 'root',
})
export class HandshakeReplicationService extends BaseReplicationService<HandshakeDocument> {
  private graphqlEndpoint: string = environment.apiUrl;
  private graphqlWsEndpoint: string = environment.wsUrl;

  constructor(networkStatus: NetworkStatusService) {
    super(networkStatus);
  }

  /**
   * Setup handshake-specific GraphQL replication
   */
  protected async setupReplication(
    collection: RxCollection,
  ): Promise<RxGraphQLReplicationState<HandshakeDocument, any> | undefined> {
    console.log('Setting up Handshake GraphQL replication...');

    // Check if app is online before starting replication
    if (!this.networkStatus.isOnline()) {
      console.log('⚠️ Application is offline - replication setup skipped');
      console.log(
        '📝 Replication will start automatically when connection is restored',
      );
      return undefined;
    }

    this.replicationState = replicateGraphQL<HandshakeDocument, any>({
      collection: collection as any,
      replicationIdentifier:
        this.replicationIdentifier || 'handshake-graphql-replication',
      url: {
        http: this.graphqlEndpoint,
        ws: this.graphqlWsEndpoint,
      },

      pull: {
        batchSize: 10,
        queryBuilder: (checkpoint, limit) => {
          console.log('🔵 Pull Query - checkpoint:', checkpoint);

          return {
            query: handshakeQueryBuilder.getPullQuery(),
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
          console.log('🔄 Stream Query - headers:', headers);

          return {
            query: handshakeQueryBuilder.getStreamSubscription() || '',
            variables: {},
          };
        },

        responseModifier: (plainResponse) => {
          console.log('🟢 Full Response:', plainResponse);

          const pullData =
            plainResponse.pullHandshake ||
            plainResponse.streamHandshake ||
            plainResponse;
          const documents = pullData.documents || [];
          const checkpoint = pullData.checkpoint;

          return {
            documents: documents,
            checkpoint: checkpoint,
          };
        },

        modifier: (doc) => {
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
                transaction_id: doc.transaction_id || doc.txn_id,
                handshake: doc.handshake || doc.state || '',
                events: doc.events,
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
            query: handshakeQueryBuilder.getPushMutation(),
            variables: {
              writeRows,
            },
          };
        },

        dataPath: 'data.pushHandshake',

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
        console.warn('⚠️ Handshake Replication error:', error);
        // RxDB will automatically retry when connection is restored
      });

      this.replicationState.received$.subscribe((received) => {
        console.log('✅ Handshake Replication received:', received);
      });

      this.replicationState.sent$.subscribe((sent) => {
        console.log('📤 Handshake Replication sent:', sent);
      });

      // Wait for initial replication with timeout and error handling
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
        console.log('✅ Initial handshake replication completed');
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
