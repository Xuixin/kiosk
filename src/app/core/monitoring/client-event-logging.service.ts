import { Injectable } from '@angular/core';
// App events not used for now; only network events per requirement
import { Network } from '@capacitor/network';
import { LogClientFacade } from '../Database/facade/log-client.service';
import { NetworkStatusService } from '../Database/network-status.service';
import { ClientIdentityService } from '../identity/client-identity.service';

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

@Injectable({ providedIn: 'root' })
export class ClientEventLoggingService {
  private initialized = false;
  private lastStatus: 'ONLINE' | 'OFFLINE' | undefined;

  constructor(
    private readonly logs: LogClientFacade,
    private readonly networkStatus: NetworkStatusService,
    private readonly identity: ClientIdentityService,
  ) {}

  async init(): Promise<void> {
    if (this.initialized) {
      console.log('⚠️ [ClientEventLogging] Already initialized, skipping');
      return;
    }

    const clientId = await this.identity.getClientId();
    if (!clientId) {
      console.warn('⚠️ [ClientEventLogging] No clientId, returning');
      return;
    }

    const lastLog = await this.logs.getLastByClient(clientId);

    // สร้าง START_APP log ถ้า:
    // 1. ไม่มี log เลย (first time) หรือ
    // 2. log ล่าสุดมี status = 'ONLINE' หรือ meta_data = 'ONLINE'
    // 3. และ log ล่าสุดไม่ใช่ START_APP (กัน refresh ซ้ำ)
    const shouldCreate =
      !lastLog || // ไม่มี log เลย (first time)
      ((lastLog.status === 'ONLINE' || lastLog.meta_data === 'ONLINE') &&
        lastLog.meta_data !== 'START_APP');

    if (shouldCreate) {
      try {
        await this.logs.append({
          client_id: clientId,
          type: this.identity.getClientType() as any,
          status: 'ONLINE',
          meta_data: 'START_APP',
          client_created_at: Date.now().toString(),
        });
        this.lastStatus = 'ONLINE';
        console.log(
          '✅ [ClientEventLogging] Created start_app log on app init',
        );
      } catch (error) {
        console.error(
          '❌ [ClientEventLogging] Error creating start_app log:',
          error,
        );
      }
    } else {
      console.log(
        'ℹ️ [ClientEventLogging] Skipping start_app log creation (conditions not met)',
      );
    }

    this.initialized = true;

    // Only network events; create log only if latest differs
    Network.addListener('networkStatusChange', async (st) => {
      const clientId = await this.identity.getClientId();
      const status: 'ONLINE' | 'OFFLINE' = st.connected ? 'ONLINE' : 'OFFLINE';
      const last = await this.logs.getLastByClient(clientId);
      if (last?.status === status) {
        return; // skip duplicate (e.g., page refresh)
      }
      await this.logs.append({
        client_id: clientId,
        type: this.identity.getClientType() as any,
        status,
        meta_data: status, // meta only ONLINE/OFFLINE
        client_created_at: Date.now().toString(),
      });
      this.lastStatus = status;
    });
  }

  // client id resolved by ClientIdentityService
}
