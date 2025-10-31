import { Injectable } from '@angular/core';
import { replicateGraphQL } from 'rxdb/plugins/replication-graphql';
import { RxGraphQLReplicationState } from 'rxdb/plugins/replication-graphql';
import { RxCollection } from 'rxdb';
import { NetworkStatusService } from '../../network-status.service';
import { BaseReplicationService } from '../../core/base-replication.service';
import { DoorDocument } from './schema';
import {
  PUSH_DOOR_MUTATION,
  PULL_DOOR_QUERY,
  STREAM_DOOR_SUBSCRIPTION,
} from './query-builder';
import { ReplicationConfig } from '../../core/adapter';
import {
  ReplicationConfigBuilder,
  ReplicationConfigOptions,
} from '../../core/replication-config-builder';
import { environment } from 'src/environments/environment';

/**
 * Door-specific GraphQL replication service
 * Extends BaseReplicationService for door collection replication
 */
@Injectable({
  providedIn: 'root',
})
export class DoorReplicationService extends BaseReplicationService<DoorDocument> {
  constructor(networkStatus: NetworkStatusService) {
    super(networkStatus);
    this.collectionName = 'door';
  }

  /**
   * Build replication configuration for adapter
   * Uses ReplicationConfigBuilder to reduce code duplication
   */
  protected buildReplicationConfig(): ReplicationConfig & Record<string, any> {
    const options: ReplicationConfigOptions = {
      collectionName: 'door',
      replicationId: this.replicationIdentifier,
      batchSize: 10,
      pullQueryBuilder: (checkpoint, limit) => {
        console.log('🔵 Pull Door Query - checkpoint:', checkpoint);
        return {
          query: PULL_DOOR_QUERY,
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
        console.log('🔄 Stream Door Query - headers:', headers);
        return {
          query: STREAM_DOOR_SUBSCRIPTION,
          variables: {},
        };
      },
      responseModifier: ReplicationConfigBuilder.createResponseModifier([
        'pullDoors',
        'streamDoor',
      ]),
      pullModifier: (doc) => {
        // Filter out deleted doors
        if (doc.deleted) {
          return {
            ...doc,
            _deleted: true,
          };
        }
        return doc;
      },
      pushQueryBuilder: (docs) => {
        const writeRows = docs.map((docRow) => {
          const doc = docRow.newDocumentState;
          return {
            newDocumentState: {
              id: doc.id,
              name: doc.name,
              max_persons: doc.max_persons,
              status: doc.status,
              client_created_at: doc.client_created_at || Date.now().toString(),
              client_updated_at: doc.client_updated_at || Date.now().toString(),
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
      pushDataPath: 'data.pushDoors',
      pushModifier: (doc) => doc,
    };

    return ReplicationConfigBuilder.buildBaseConfig(options);
  }

  /**
   * Setup door-specific GraphQL replication (legacy direct method)
   */
  protected async setupReplicationDirectWithUrl(
    collection: RxCollection,
    useFallback: boolean,
  ): Promise<RxGraphQLReplicationState<DoorDocument, any> | undefined> {
    const urlType = useFallback ? 'fallback' : 'primary';
    console.log(
      `Setting up Door GraphQL replication (direct mode - ${urlType} URL)...`,
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
    this.replicationState = replicateGraphQL<DoorDocument, any>(
      replicationOptions,
    );

    if (this.replicationState) {
      // Setup error handler that will detect server crashes and switch to fallback
      this.setupReplicationErrorHandler(this.replicationState);

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
