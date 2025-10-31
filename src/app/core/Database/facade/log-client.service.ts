import { Injectable, inject } from '@angular/core';
import { AdapterProviderService } from '../factory/adapter-provider.service';
import { CollectionAdapter } from '../adapter';
import { LogClientDocument } from '../../schema/log-client.schema';
import { Observable, map } from 'rxjs';
import { ClientIdentityService } from '../../identity/client-identity.service';

@Injectable({ providedIn: 'root' })
export class LogClientFacade {
  private readonly adapterProvider = inject(AdapterProviderService);
  private readonly identity = inject(ClientIdentityService);

  private get collection(): CollectionAdapter<any> | null {
    try {
      if (!this.adapterProvider.isReady()) {
        return null;
      }
      const adapter = this.adapterProvider.getAdapter();
      // Use 'any' since LogClientDocument doesn't extend BaseDocument (missing client_updated_at)
      // The adapter will work correctly with the actual document structure
      return adapter.getCollection<any>('log_client');
    } catch (error) {
      console.warn('LogClient collection not available yet:', error);
      return null;
    }
  }

  async append(
    entry: Partial<LogClientDocument> & { status: string; meta_data: string },
  ): Promise<void> {
    const collection = this.collection;
    if (!collection) {
      throw new Error('LogClient collection not available');
    }

    const now = Date.now().toString();
    const id = entry.id || crypto.randomUUID();
    const client_id = entry.client_id || (await this.identity.getClientId());
    const doc: Partial<LogClientDocument> = {
      id,
      client_id,
      type: (entry.type as any) || (this.identity.getClientType() as any),
      status: entry.status,
      meta_data: entry.meta_data,
      client_created_at: entry.client_created_at || now,
      server_created_at: (entry.server_created_at as any) ?? '',
      diff_time_create: (entry.diff_time_create as any) ?? '',
      server_updated_at: (entry.server_updated_at as any) ?? '',
    };
    await collection.insert(doc);
  }

  getLogs$(): Observable<LogClientDocument[]> {
    const collection = this.collection;
    if (!collection) {
      return new Observable((observer) => observer.next([]));
    }
    return collection.find$();
  }

  countOfflineEvents$(clientId?: string): Observable<number> {
    const collection = this.collection;
    if (!collection) {
      return new Observable((observer) => observer.next(0));
    }

    const selector = clientId
      ? ({ client_id: clientId, status: 'OFFLINE' } as any)
      : ({ status: 'OFFLINE' } as any);

    return collection.find$(selector).pipe(map((docs) => docs.length));
  }

  async getLastByClient(clientId: string): Promise<LogClientDocument | null> {
    const collection = this.collection;
    if (!collection) {
      return null;
    }

    const result = await collection.query({
      selector: { client_id: clientId } as any,
      sort: [{ field: 'client_created_at', direction: 'desc' }],
      limit: 1,
    });

    return result.documents.length > 0 ? result.documents[0] : null;
  }

  async appendIfChanged(params: {
    client_id: string;
    type?: 'KIOSK' | 'DOOR';
    status: string;
    meta_data: string;
    minGapMs?: number; // default 30000
  }): Promise<boolean> {
    const minGapMs = params.minGapMs ?? 30000;
    const last = await this.getLastByClient(params.client_id);
    const now = Date.now();
    const lastTs = last ? Number(last.client_created_at) : 0;
    const sameStatus = last && last.status === params.status;
    const recent = last && now - lastTs < minGapMs;

    if (sameStatus && recent) return false; // skip duplicate burst
    await this.append({
      client_id: params.client_id,
      type: params.type ?? 'KIOSK',
      status: params.status,
      meta_data: params.meta_data,
      client_created_at: String(now),
    });
    return true;
  }
}
