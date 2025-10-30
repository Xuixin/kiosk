import { Injectable } from '@angular/core';
import { environment } from 'src/environments/environment';
import { Preferences } from '@capacitor/preferences';

const CLIENT_ID_KEY = 'client_id';

@Injectable({ providedIn: 'root' })
export class ClientIdentityService {
  private cachedId?: string;

  getClientType(): string {
    return (environment as any).clientType || 'KIOSK';
  }

  async getClientId(): Promise<string> {
    if (this.cachedId) return this.cachedId;

    const { value } = await Preferences.get({ key: CLIENT_ID_KEY });
    let id = value;
    if (!id) {
      id = crypto.randomUUID();
      await Preferences.set({ key: CLIENT_ID_KEY, value: id });
    }
    this.cachedId = id;
    return id;
  }
}
