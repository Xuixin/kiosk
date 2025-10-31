import { Injectable } from '@angular/core';
import { replicateGraphQL } from 'rxdb/plugins/replication-graphql';
import { RxGraphQLReplicationState } from 'rxdb/plugins/replication-graphql';
import { RxCollection } from 'rxdb';
import { NetworkStatusService } from '../../network-status.service';
import { BaseReplicationService } from '../../core/base-replication.service';
import { HandshakeDocument } from './schema';
import {
  PUSH_HANDSHAKE_MUTATION,
  PULL_HANDSHAKE_QUERY,
  STREAM_HANDSHAKE_SUBSCRIPTION,
} from './query-builder';
import { ReplicationConfig } from '../../core/adapter';
import {
  ReplicationConfigBuilder,
  ReplicationConfigOptions,
} from '../../core/replication-config-builder';
import { environment } from 'src/environments/environment';

/**
 * Handshake-specific GraphQL replication service
 * Extends BaseReplicationService for handshake collection replication
 */
@Injectable({
  providedIn: 'root',
})
export class HandshakeReplicationService extends BaseReplicationService<HandshakeDocument> {
  constructor(networkStatus: NetworkStatusService) {
    super(networkStatus);
    this.collectionName = 'handshake';
  }

  /**
   * Build replication configuration for adapter
   * Uses ReplicationConfigBuilder to reduce code duplication
   */
  protected buildReplicationConfig(): ReplicationConfig & Record<string, any> {
    const options: ReplicationConfigOptions = {
      collectionName: 'handshake',
      replicationId: this.replicationIdentifier,
      batchSize: 10,
      pullQueryBuilder: (checkpoint, limit) => {
        console.log('🔵 Pull Query - checkpoint:', checkpoint);
        return {
          query: PULL_HANDSHAKE_QUERY,
          variables: {
            input: {
              checkpoint:
                ReplicationConfigBuilder.buildCheckpointInput(checkpoint),
              limit: limit || 10,
            },
          },
        };
      },
      streamQueryBuilder: (headers) => {
        console.log('🔄 Stream Query - headers:', headers);
        return {
          query: STREAM_HANDSHAKE_SUBSCRIPTION,
          variables: {},
        };
      },
      responseModifier: ReplicationConfigBuilder.createResponseModifier([
        'pullHandshake',
        'streamHandshake',
      ]),
      pullModifier: (doc) => doc,
      pushQueryBuilder: (docs) => {
        const writeRows = docs.map((docRow) => {
          const doc = docRow.newDocumentState;
          return {
            newDocumentState: {
              id: doc.id,
              transaction_id: doc.transaction_id || doc.txn_id,
              handshake: doc.handshake || doc.state || '',
              events: doc.events,
              client_created_at: doc.client_created_at || Date.now().toString(),
              client_updated_at: doc.client_updated_at || Date.now().toString(),
              server_created_at: doc.server_created_at,
              server_updated_at: doc.server_updated_at,
              diff_time_create: doc.diff_time_create || '0',
              diff_time_update: doc.diff_time_update || '0',
              deleted: docRow.assumedMasterState === null,
            },
          };
        });
        return {
          query: PUSH_HANDSHAKE_MUTATION,
          variables: {
            writeRows,
          },
        };
      },
      pushDataPath: 'data.pushHandshake',
      pushModifier: (doc) => doc,
    };

    return ReplicationConfigBuilder.buildBaseConfig(options);
  }

  /**
   * Setup handshake-specific GraphQL replication (legacy direct method)
   */
  protected async setupReplicationDirectWithUrl(
    collection: RxCollection,
    useFallback: boolean,
  ): Promise<RxGraphQLReplicationState<HandshakeDocument, any> | undefined> {
    const urlType = useFallback ? 'fallback' : 'primary';
    console.log(
      `Setting up Handshake GraphQL replication (direct mode - ${urlType} URL)...`,
    );

    // Check if app is online before starting replication
    if (!this.networkStatus.isOnline()) {
      console.log('⚠️ Application is offline - replication setup skipped');
      console.log(
        '📝 Replication will start automatically when connection is restored',
      );
      return undefined;
    }

    // Use config with appropriate URL (fallback if needed)
    // Always apply WebSocket monitoring regardless of primary or fallback URL
    const baseConfig = useFallback
      ? this.buildReplicationConfigWithFallback()
      : (this.buildReplicationConfig() as any);
    const config = this.applyWebSocketMonitoring(baseConfig);
    // Ensure url property exists for RxDB replicateGraphQL
    const replicationOptions: any = {
      collection: collection as any,
      replicationIdentifier: this.replicationIdentifier || config.replicationId,
      url: config.url || { http: environment.apiUrl, ws: environment.wsUrl },
      ...config,
    };
    this.replicationState = replicateGraphQL<HandshakeDocument, any>(
      replicationOptions,
    );

    if (this.replicationState) {
      // Setup error handler that will detect server crashes and switch to fallback
      this.setupReplicationErrorHandler(this.replicationState);

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
