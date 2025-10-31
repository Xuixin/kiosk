import { Capacitor } from '@capacitor/core';
import { getRxStorageSQLiteTrial } from 'rxdb/plugins/storage-sqlite';
import { getSQLiteBasicsCapacitor } from 'rxdb/plugins/storage-sqlite';
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { addRxPlugin } from 'rxdb';
import { RxDBCleanupPlugin } from 'rxdb/plugins/cleanup';
import { RxDBQueryBuilderPlugin } from 'rxdb/plugins/query-builder';

const sqlite = new SQLiteConnection(CapacitorSQLite);

export const environment = {
  production: false,
  apiUrl: 'http://localhost:10102/graphql',
  wsUrl: 'ws://localhost:10102/graphql',
  apiUrlFallback: 'http://localhost:3001/graphql',
  wsUrlFallback: 'ws://localhost:3001/graphql',
  databaseName: 'kiosk_prod',
  multiInstance: false,
  clientType: 'KIOSK',
  adapterType: 'rxdb' as const, // Database adapter type: 'rxdb' | 'pouchdb' | 'watermelon' | 'server'

  addRxDBPlugins() {
    addRxPlugin(RxDBCleanupPlugin);
    addRxPlugin(RxDBQueryBuilderPlugin);
  },
  getRxStorage() {
    // Check if running on native platform
    if (Capacitor.isNativePlatform()) {
      return getRxStorageSQLiteTrial({
        sqliteBasics: getSQLiteBasicsCapacitor(sqlite, CapacitorSQLite),
      });
    } else {
      // Use IndexedDB for web platform
      return getRxStorageDexie();
    }
  },
};
