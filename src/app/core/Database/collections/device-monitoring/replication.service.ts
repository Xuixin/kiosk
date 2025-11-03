import { Injectable } from '@angular/core';
import { replicateGraphQL } from 'rxdb/plugins/replication-graphql';
import { RxGraphQLReplicationState } from 'rxdb/plugins/replication-graphql';
import { RxCollection } from 'rxdb';
import { NetworkStatusService } from '../../core/services/network-status.service';
import { BaseReplicationService } from '../../core/base/base-replication.service';
import { DeviceMonitoringDocument } from './schema';
import {
  PUSH_DEVICE_MONITORING_MUTATION,
  PULL_DEVICE_MONITORING_QUERY,
  STREAM_DEVICE_MONITORING_SUBSCRIPTION,
} from './query-builder';
import { ReplicationConfig } from '../../core/adapter';
import {
  ReplicationConfigBuilder,
  ReplicationConfigOptions,
} from '../../core/config/replication-config-builder';
import { environment } from 'src/environments/environment';

/**
 * DeviceMonitoring-specific GraphQL replication service
 * Extends BaseReplicationService for device-monitoring collection replication
 */
@Injectable({
  providedIn: 'root',
})
export class DeviceMonitoringReplicationService extends BaseReplicationService<DeviceMonitoringDocument> {
  constructor(networkStatus: NetworkStatusService) {
    super(networkStatus);
    this.collectionName = 'device_monitoring';
  }

  /**
   * Build replication configuration for adapter
   * Uses ReplicationConfigBuilder to reduce code duplication
   */
  protected buildReplicationConfig(): ReplicationConfig & Record<string, any> {
    const options: ReplicationConfigOptions = {
      collectionName: 'device_monitoring',
      replicationId: this.replicationIdentifier,
      batchSize: 10,
      pullQueryBuilder: (checkpoint, limit) => {
        return {
          query: PULL_DEVICE_MONITORING_QUERY,
          variables: {
            input: {
              checkpoint:
                ReplicationConfigBuilder.buildCheckpointInput(checkpoint),
              limit: limit || 10,
              // Note: No where clause - replication pulls all devices
              // Device filtering by type is done in DeviceApiService for device selection
            },
          },
        };
      },
      streamQueryBuilder: (headers) => {
        return {
          query: STREAM_DEVICE_MONITORING_SUBSCRIPTION,
          variables: {},
        };
      },
      responseModifier: ReplicationConfigBuilder.createResponseModifier([
        'pullDeviceMonitoring',
        'streamDeviceMonitoring',
      ]),
      pullModifier: (doc) => {
        // No deleted field - RxDB uses _deleted internally
        return doc;
      },
      pushQueryBuilder: (docs) => {
        const writeRows = docs.map((docRow) => {
          const doc = docRow.newDocumentState;
          return {
            newDocumentState: {
              id: doc.id,
              name: doc.name,
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
            },
          };
        });
        return {
          query: PUSH_DEVICE_MONITORING_MUTATION,
          variables: {
            writeRows,
          },
        };
      },
      pushDataPath: 'data.pushDeviceMonitoring',
      pushModifier: (doc) => doc,
    };

    return ReplicationConfigBuilder.buildBaseConfig(options);
  }

  /**
   * Setup device-monitoring-specific GraphQL replication (legacy direct method)
   */
  protected async setupReplicationDirectWithUrl(
    collection: RxCollection,
  ): Promise<
    RxGraphQLReplicationState<DeviceMonitoringDocument, any> | undefined
  > {
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
    this.replicationState = replicateGraphQL<DeviceMonitoringDocument, any>(
      replicationOptions,
    );

    if (this.replicationState) {
      this.setupReplicationErrorHandler(this.replicationState);
    }

    return this.replicationState;
  }
}
