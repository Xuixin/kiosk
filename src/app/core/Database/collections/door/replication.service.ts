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
  ): Promise<RxGraphQLReplicationState<DoorDocument, any> | undefined> {
    if (!this.networkStatus.isOnline()) {
      return undefined;
    }

    const baseConfig = this.buildReplicationConfig() as any;
    const config = this.applyWebSocketMonitoring(baseConfig);

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
      this.setupReplicationErrorHandler(this.replicationState);
    }

    return this.replicationState;
  }
}
