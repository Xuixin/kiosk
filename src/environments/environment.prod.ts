import { Capacitor } from '@capacitor/core';
import { getRxStorageSQLiteTrial } from 'rxdb/plugins/storage-sqlite';
import { getSQLiteBasicsCapacitor } from 'rxdb/plugins/storage-sqlite';
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';

const sqlite = new SQLiteConnection(CapacitorSQLite);

export const environment = {
  production: true,
  apiUrl: 'https://api.yourdomain.com',
  wsUrl: 'wss://api.yourdomain.com',
  databaseName: 'kiosk_prod',
  multiInstance: false,
  addRxDBPlugins() {},
  getRxStorage() {
    return getRxStorageSQLiteTrial({
      sqliteBasics: getSQLiteBasicsCapacitor(sqlite, CapacitorSQLite),
    });
  },
};
