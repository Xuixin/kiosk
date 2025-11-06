/**
 * Replication Configurations
 * Contains replication config definitions for all collections
 */

import { RxDatabase, RxCollection } from 'rxdb';
import { environment } from 'src/environments/environment';
import {
  pullTransactionQueryBuilder,
  pushTransactionQueryBuilder,
  pullStreamTransactionQueryBuilder,
  pullDeviceMonitoringQueryBuilder,
  pushDeviceMonitoringQueryBuilder,
  pullStreamDeviceMonitoringQueryBuilder,
  pushDeviceMonitoringHistoryQueryBuilder,
} from '../services/query-builder-functions';
import { ReplicationConfig } from '../services/replication-helper';

interface DatabaseCollections {
  transaction: RxCollection;
  devicemonitoring: RxCollection;
  devicemonitoringhistory: RxCollection;
}

/**
 * Create all replication configurations
 * @param db - RxDatabase instance
 * @param serverId - Server ID for replication
 * @param deviceEventFacade - DeviceEventFacade instance for creating device events (optional, not used if not provided)
 * @param emitPrimaryRecoveryFn - Function to emit primary recovery event
 * @returns Array of replication configurations
 */
export function createReplicationConfigs(
  db: RxDatabase<DatabaseCollections>,
  serverId: string,
  deviceEventFacade: any,
  emitPrimaryRecoveryFn: () => Promise<void>,
): ReplicationConfig[] {
  return [
    // Transaction Primary
    {
      name: 'transaction-primary',
      collection: db.transaction,
      pullQueryBuilder: pullTransactionQueryBuilder,
      pushQueryBuilder: pushTransactionQueryBuilder,
      pullStreamQueryBuilder: pullStreamTransactionQueryBuilder,
      checkpointField: 'server_updated_at',
      urls: {
        http: environment.apiUrl,
        ws: environment.wsUrl,
      },
      replicationIdentifier: 'txn-primary-10102',
      serverId: serverId,
    },
    // Transaction Secondary
    {
      name: 'transaction-secondary',
      collection: db.transaction,
      pullQueryBuilder: pullTransactionQueryBuilder,
      pushQueryBuilder: pushTransactionQueryBuilder,
      pullStreamQueryBuilder: pullStreamTransactionQueryBuilder,
      checkpointField: 'cloud_updated_at',
      urls: {
        http: environment.apiSecondaryUrl || environment.apiUrl,
        ws: environment.wsSecondaryUrl || environment.wsUrl,
      },
      replicationIdentifier: 'txn-secondary-3001',
      serverId: serverId,
      autoStart: false, // Don't start until needed
    },
    // Device Monitoring Primary (readOnly - no push)
    {
      name: 'devicemonitoring-primary',
      collection: db.devicemonitoring,
      pullQueryBuilder: pullDeviceMonitoringQueryBuilder,
      // pushQueryBuilder: undefined, // Disabled - DeviceMonitoring is readOnly
      pullStreamQueryBuilder: pullStreamDeviceMonitoringQueryBuilder,
      checkpointField: 'server_updated_at',
      urls: {
        http: environment.apiUrl,
        ws: environment.wsUrl,
      },
      replicationIdentifier: 'device_monitoring-primary-10102',
      serverId: serverId,
    },
    // Device Monitoring Secondary (readOnly - no push)
    {
      name: 'devicemonitoring-secondary',
      collection: db.devicemonitoring,
      pullQueryBuilder: pullDeviceMonitoringQueryBuilder,
      // pushQueryBuilder: undefined, // Disabled - DeviceMonitoring is readOnly
      pullStreamQueryBuilder: pullStreamDeviceMonitoringQueryBuilder,
      checkpointField: 'cloud_updated_at',
      urls: {
        http: environment.apiSecondaryUrl || environment.apiUrl,
        ws: environment.wsSecondaryUrl || environment.wsUrl,
      },
      replicationIdentifier: 'device_monitoring-secondary-3001',
      serverId: serverId,
      autoStart: false, // Don't start until needed
      onReceived: async (docs) => {
        // Check for primary recovery conditions when receiving data from secondary
        // Use queueMicrotask to ensure event emission happens outside replication scope
        // This prevents blocking the replication process
        docs.forEach((doc: any) => {
          if (
            doc.id === environment.serverId &&
            (doc.type === 'SERVER' || doc.type === 'server') &&
            doc.status === 'ONLINE'
          ) {
            console.log(
              '🔄 [ReplicationConfig] Primary server detected as ONLINE, queuing switchToPrimary event',
            );
            // Emit event asynchronously outside replication scope
            // This ensures replication process is not blocked
            queueMicrotask(() => {
              emitPrimaryRecoveryFn().catch((error) => {
                console.error(
                  '❌ [ReplicationConfig] Error emitting primary recovery event:',
                  error,
                );
              });
            });
          }
        });
      },
    },
    // Device Monitoring History Primary (push only - no pull/stream)
    {
      name: 'devicemonitoringhistory-primary',
      collection: db.devicemonitoringhistory,
      // pullQueryBuilder: undefined, // Push only - no pull
      // pullStreamQueryBuilder: undefined, // Push only - no stream
      pushQueryBuilder: pushDeviceMonitoringHistoryQueryBuilder,
      checkpointField: 'server_updated_at',
      urls: {
        http: environment.apiUrl,
        ws: environment.wsUrl,
      },
      replicationIdentifier: 'device_monitoring_history-primary-10102',
      serverId: serverId,
    },
    // Device Monitoring History Secondary (push only - no pull/stream)
    {
      name: 'devicemonitoringhistory-secondary',
      collection: db.devicemonitoringhistory,
      // pullQueryBuilder: undefined, // Push only - no pull
      // pullStreamQueryBuilder: undefined, // Push only - no stream
      pushQueryBuilder: pushDeviceMonitoringHistoryQueryBuilder,
      checkpointField: 'cloud_updated_at',
      urls: {
        http: environment.apiSecondaryUrl || environment.apiUrl,
        ws: environment.wsSecondaryUrl || environment.wsUrl,
      },
      replicationIdentifier: 'device_monitoring_history-secondary-3001',
      serverId: serverId,
      autoStart: false, // Don't start until needed
      // onReceived not needed for push-only replication
    },
  ];
}
