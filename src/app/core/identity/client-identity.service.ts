import { Injectable } from '@angular/core';
import { environment } from 'src/environments/environment';

const CLIENT_ID_KEY = 'client_id';

@Injectable({ providedIn: 'root' })
export class ClientIdentityService {
  private cachedId?: string;

  getClientType(): string {
    return (environment as any).clientType || 'KIOSK';
  }

  async getClientId(): Promise<string> {
    if (this.cachedId) return this.cachedId;

    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    this.cachedId = id;
    return id;
  }
}
