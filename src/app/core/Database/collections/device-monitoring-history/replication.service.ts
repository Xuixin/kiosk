import { Injectable } from '@angular/core';
import { replicateGraphQL } from 'rxdb/plugins/replication-graphql';
import { RxGraphQLReplicationState } from 'rxdb/plugins/replication-graphql';
import { RxCollection } from 'rxdb';
import { NetworkStatusService } from '../../core/services/network-status.service';
import { BaseReplicationService } from '../../core/base/base-replication.service';
import { DeviceMonitoringHistoryDocument } from './schema';
import {
  PULL_DEVICE_MONITORING_HISTORY_QUERY,
  PUSH_DEVICE_MONITORING_HISTORY_MUTATION,
  STREAM_DEVICE_MONITORING_HISTORY_SUBSCRIPTION,
} from './query-builder';
import { ClientIdentityService } from '../../../identity/client-identity.service';
import { ReplicationConfig } from '../../core/adapter';
import {
  ReplicationConfigBuilder,
  ReplicationConfigOptions,
} from '../../core/config/replication-config-builder';
import { environment } from 'src/environments/environment';

/**
 * DeviceMonitoringHistory-specific GraphQL replication service
 * Extends BaseReplicationService for device-monitoring-history collection replication
 */
@Injectable({
  providedIn: 'root',
})
export class DeviceMonitoringHistoryReplicationService extends BaseReplicationService<DeviceMonitoringHistoryDocument> {
  private createdBy?: string;

  constructor(
    networkStatus: NetworkStatusService,
    private readonly identity: ClientIdentityService,
  ) {
    super(networkStatus);
    this.collectionName = 'device_monitoring_history';
  }

  /**
   * Build replication configuration for adapter
   * Uses ReplicationConfigBuilder to reduce code duplication
   * Note: pullModifier uses createdBy from property set in setupReplication
   */
  protected buildReplicationConfig(): ReplicationConfig & Record<string, any> {
    const options: ReplicationConfigOptions = {
      collectionName: 'device_monitoring_history',
      replicationId: this.replicationIdentifier,
      batchSize: 10,
      pullQueryBuilder: (checkpoint, limit) => {
        return {
          query: PULL_DEVICE_MONITORING_HISTORY_QUERY,
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
          query: STREAM_DEVICE_MONITORING_HISTORY_SUBSCRIPTION,
          variables: {},
        };
      },
      responseModifier: ReplicationConfigBuilder.createResponseModifier([
        'pullDeviceMonitoringHistory',
        'streamDeviceMonitoringHistory',
      ]),
      pullModifier: (doc) => {
        // Filter by created_by if set (only show history created by this client)
        if (this.createdBy && doc.created_by === this.createdBy) {
          return doc;
        } else if (this.createdBy) {
          // Hide history from other clients
          return {
            ...doc,
            _deleted: true,
          };
        }
        // If createdBy not set yet, show all
        return doc;
      },
      pushQueryBuilder: (docs) => {
        const writeRows = docs.map((docRow) => {
          const doc = docRow.newDocumentState;
          return {
            newDocumentState: {
              id: doc.id,
              device_id: doc.device_id,
              type: doc.type,
              status: doc.status,
              meta_data: doc.meta_data,
              created_by: doc.created_by,
              client_created_at: doc.client_created_at || Date.now().toString(),
              client_updated_at: doc.client_updated_at || Date.now().toString(),
              server_created_at: doc.server_created_at,
              server_updated_at: doc.server_updated_at,
              cloud_created_at: doc.cloud_created_at,
              cloud_updated_at: doc.cloud_updated_at,
              diff_time_create: doc.diff_time_create,
              diff_time_update: doc.diff_time_update,
              // Note: deleted handled by RxDB _deleted, not sent to server
              deleted: doc._deleted,
            },
          };
        });
        return {
          query: PUSH_DEVICE_MONITORING_HISTORY_MUTATION,
          variables: {
            writeRows,
          },
        };
      },
      pushDataPath: 'data.pushDeviceMonitoringHistory',
      pushModifier: (doc) => doc,
    };

    return ReplicationConfigBuilder.buildBaseConfig(options);
  }

  /**
   * Setup device-monitoring-history-specific GraphQL replication (legacy direct method)
   */
  protected async setupReplicationDirectWithUrl(
    collection: RxCollection,
  ): Promise<
    RxGraphQLReplicationState<DeviceMonitoringHistoryDocument, any> | undefined
  > {
    if (!this.networkStatus.isOnline()) {
      return undefined;
    }

    // Get created_by from identity service
    this.createdBy = (await this.identity.getClientId()) || '';

    const baseConfig = this.buildReplicationConfig() as any;
    const config = this.applyWebSocketMonitoring(baseConfig);

    const replicationOptions: any = {
      collection: collection as any,
      replicationIdentifier: this.replicationIdentifier || config.replicationId,
      url: config.url || { http: environment.apiUrl, ws: environment.wsUrl },
      ...config,
    };
    this.replicationState = replicateGraphQL<
      DeviceMonitoringHistoryDocument,
      any
    >(replicationOptions);

    if (this.replicationState) {
      this.setupReplicationErrorHandler(this.replicationState);
    }

    return this.replicationState;
  }
}
