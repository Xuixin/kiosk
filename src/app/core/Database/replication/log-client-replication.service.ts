import { Injectable } from '@angular/core';
import { replicateGraphQL } from 'rxdb/plugins/replication-graphql';
import { RxGraphQLReplicationState } from 'rxdb/plugins/replication-graphql';
import { RxCollection } from 'rxdb';
import { RxLogClientCollection } from '../RxDB.D';
import { LogClientDocument } from '../../schema/log-client.schema';
import { environment } from 'src/environments/environment';
import { NetworkStatusService } from '../network-status.service';
import { BaseReplicationService } from './base-replication.service';
import {
  logClientQueryBuilder,
  PULL_LOG_CLIENT_QUERY,
  //   STREAM_LOG_CLIENT_SUBSCRIPTION,
  PUSH_LOG_CLIENT_MUTATION,
} from '../query-builder/log-client-builder';
import { ClientIdentityService } from '../../identity/client-identity.service';

/**
 * LogClient-specific GraphQL replication service
 * Extends BaseReplicationService for log_client collection replication
 */
@Injectable({
  providedIn: 'root',
})
export class LogClientReplicationService extends BaseReplicationService<LogClientDocument> {
  private graphqlEndpoint: string = environment.apiUrl;
  private graphqlWsEndpoint: string = environment.wsUrl;

  constructor(
    networkStatus: NetworkStatusService,
    private readonly identity: ClientIdentityService,
  ) {
    super(networkStatus);
  }

  /**
   * Setup log-client-specific GraphQL replication
   */
  protected async setupReplication(
    collection: RxCollection,
  ): Promise<RxGraphQLReplicationState<LogClientDocument, any> | undefined> {
    const logClientCollection = collection as unknown as RxLogClientCollection;

    console.log('Setting up LogClient GraphQL replication...');

    if (!this.networkStatus.isOnline()) {
      console.log(
        '⚠️ Application is offline - log-client replication setup skipped',
      );
      console.log(
        '📝 Replication will start automatically when connection is restored',
      );
      return undefined;
    }

    // Get clientId before replication setup (modifier needs synchronous access)
    const clientId = await this.identity.getClientId();

    this.replicationState = replicateGraphQL<LogClientDocument, any>({
      collection: logClientCollection as any,
      replicationIdentifier:
        this.replicationIdentifier || 'log-client-graphql-replication',
      url: {
        http: this.graphqlEndpoint,
        ws: this.graphqlWsEndpoint,
      },
      pull: {
        batchSize: 5,
        queryBuilder: (checkpoint, limit) => {
          return {
            query: PULL_LOG_CLIENT_QUERY,
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
        // streamQueryBuilder: () => {
        //   const subscription = logClientQueryBuilder.getStreamSubscription();
        //   return {
        //     query: subscription || STREAM_LOG_CLIENT_SUBSCRIPTION,
        //     variables: {},
        //   };
        // },
        responseModifier: (plainResponse) => {
          const pullData =
            plainResponse.pullLogClients ||
            plainResponse.streamLogClients ||
            plainResponse;
          const documents = pullData.documents || [];
          const checkpoint = pullData.checkpoint;
          return {
            documents,
            checkpoint,
          };
        },
        modifier: (doc) => {
          // Use the clientId from closure (already awaited above)
          if (doc.client_id === clientId) {
            return doc;
          } else {
            return {
              ...doc,
              _deleted: true,
            };
          }
        },
      },
      push: {
        queryBuilder: (docs) => {
          const writeRows = docs.map((docRow: any) => {
            const doc = docRow.newDocumentState;
            return {
              newDocumentState: {
                id: doc.id,
                client_id: doc.client_id,
                type: doc.type,
                meta_data: doc.meta_data,
                client_created_at:
                  doc.client_created_at || Date.now().toString(),
                server_created_at: doc.server_created_at,
                server_updated_at: doc.server_updated_at,
                deleted: docRow.assumedMasterState === null,
                diff_time_create: doc.diff_time_create || '0',
                status: doc.status,
              },
            };
          });

          return {
            query: PUSH_LOG_CLIENT_MUTATION,
            variables: {
              writeRows,
            },
          };
        },
        dataPath: 'data.pushLogClients',
        modifier: (doc) => doc,
      },
      live: true,
      retryTime: 60000,
      autoStart: true,
      waitForLeadership: true,
    });

    if (this.replicationState) {
      // Handle replication errors gracefully (server down, network errors, etc.)
      this.replicationState.error$.subscribe((error: any) => {
        // Log error but don't crash - offline-first approach
        console.warn('⚠️ LogClient Replication error:', {
          direction: error?.direction,
          error: error?.error || error,
          message: error?.error?.message || error?.message || 'Unknown error',
        });
        // RxDB will automatically retry when connection is restored
      });

      this.replicationState.received$.subscribe(async (received) => {
        console.log('🧹 Cleaning up log client documents');
        try {
          await logClientCollection.cleanup(0);
        } catch (cleanupError) {
          console.warn('⚠️ Cleanup error (non-critical):', cleanupError);
        }
        console.log('✅ LogClient Replication received:', received);
      });

      this.replicationState.sent$.subscribe((sent) => {
        console.log('📤 LogClient Replication sent:', sent);
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
        console.log('✅ Initial log-client replication completed');
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
