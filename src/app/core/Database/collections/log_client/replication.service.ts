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
      responseModifier: ReplicationConfigBuilder.createResponseModifier([
        'pullLogClients',
      ]),
      pullModifier: (doc) => {
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
  ): Promise<RxGraphQLReplicationState<LogClientDocument, any> | undefined> {
    const logClientCollection = collection as unknown as RxLogClientCollection;

    if (!this.networkStatus.isOnline()) {
      return undefined;
    }

    this.clientId = await this.identity.getClientId();

    const baseConfig = this.buildReplicationConfig() as any;
    const config = this.applyWebSocketMonitoring(baseConfig);

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
      this.setupReplicationErrorHandler(this.replicationState);

      this.replicationState.received$.subscribe(async (received) => {
        try {
          await logClientCollection.cleanup(0);
        } catch (cleanupError) {
          // Cleanup errors are non-critical, silently ignore
        }
      });

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
      } catch (error: any) {
        console.warn('Initial replication timeout:', error.message || error);
      }
    }
    return this.replicationState;
  }
}
