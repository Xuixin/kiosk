import { Injectable } from '@angular/core';
import { replicateGraphQL } from 'rxdb/plugins/replication-graphql';
import { RxGraphQLReplicationState } from 'rxdb/plugins/replication-graphql';
import { RxCollection } from 'rxdb';
import { RxLogClientCollection } from './types';
import { LogClientDocument } from './schema';
import { NetworkStatusService } from '../../network-status.service';
import { BaseReplicationService } from '../../core/base-replication.service';
import {
  PULL_LOG_CLIENT_QUERY,
  PUSH_LOG_CLIENT_MUTATION,
} from './query-builder';
import { ClientIdentityService } from '../../../identity/client-identity.service';
import { ReplicationConfig } from '../../core/adapter';
import {
  ReplicationConfigBuilder,
  ReplicationConfigOptions,
} from '../../core/replication-config-builder';
import { environment } from 'src/environments/environment';

/**
 * LogClient-specific GraphQL replication service
 * Extends BaseReplicationService for log_client collection replication
 */
@Injectable({
  providedIn: 'root',
})
export class LogClientReplicationService extends BaseReplicationService<LogClientDocument> {
  private clientId?: string;

  constructor(
    networkStatus: NetworkStatusService,
    private readonly identity: ClientIdentityService,
  ) {
    super(networkStatus);
    this.collectionName = 'log_client';
  }

  /**
   * Build replication configuration for adapter
   * Uses ReplicationConfigBuilder to reduce code duplication
   * Note: pullModifier uses clientId from property set in setupReplication
   */
  protected buildReplicationConfig(): ReplicationConfig & Record<string, any> {
    const options: ReplicationConfigOptions = {
      collectionName: 'log_client',
      replicationId: this.replicationIdentifier,
      batchSize: 5,
      pullQueryBuilder: (checkpoint, limit) => {
        return {
          query: PULL_LOG_CLIENT_QUERY,
          variables: {
            input: {
              checkpoint:
                ReplicationConfigBuilder.buildCheckpointInput(checkpoint),
              limit: limit || 5,
            },
          },
        };
      },
      // streamQueryBuilder not used for log_client (commented out)
      responseModifier: ReplicationConfigBuilder.createResponseModifier([
        'pullLogClients',
      ]),
      pullModifier: (doc) => {
        // Filter documents by client_id - only show documents for this client
        // clientId is stored in property and accessed via closure
        if (this.clientId && doc.client_id === this.clientId) {
          return doc;
        } else {
          return {
            ...doc,
            _deleted: true,
          };
        }
      },
      pushQueryBuilder: (docs) => {
        const writeRows = docs.map((docRow: any) => {
          const doc = docRow.newDocumentState;
          return {
            newDocumentState: {
              id: doc.id,
              client_id: doc.client_id,
              type: doc.type,
              meta_data: doc.meta_data,
              client_created_at: doc.client_created_at || Date.now().toString(),
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
      pushDataPath: 'data.pushLogClients',
      pushModifier: (doc) => doc,
    };

    return ReplicationConfigBuilder.buildBaseConfig(options);
  }

  /**
   * Setup log-client-specific GraphQL replication (legacy direct method)
   */
  protected async setupReplicationDirectWithUrl(
    collection: RxCollection,
    useFallback: boolean,
  ): Promise<RxGraphQLReplicationState<LogClientDocument, any> | undefined> {
    const logClientCollection = collection as unknown as RxLogClientCollection;

    const urlType = useFallback ? 'fallback' : 'primary';
    console.log(
      `Setting up LogClient GraphQL replication (direct mode - ${urlType} URL)...`,
    );

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
    this.clientId = await this.identity.getClientId();

    // Use config with appropriate URL (fallback if needed) - clientId accessed via closure
    // Always apply WebSocket monitoring regardless of primary or fallback URL
    const baseConfig = useFallback
      ? this.buildReplicationConfigWithFallback()
      : (this.buildReplicationConfig() as any);
    const config = this.applyWebSocketMonitoring(baseConfig);
    // Ensure url property exists for RxDB replicateGraphQL
    const replicationOptions: any = {
      collection: logClientCollection as any,
      replicationIdentifier: this.replicationIdentifier || config.replicationId,
      url: config.url || { http: environment.apiUrl, ws: environment.wsUrl },
      ...config,
    };
    this.replicationState = replicateGraphQL<LogClientDocument, any>(
      replicationOptions,
    );

    if (this.replicationState) {
      // Setup error handler that will detect server crashes and switch to fallback
      this.setupReplicationErrorHandler(this.replicationState);

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
