import { Injectable, Signal, computed, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { HandshakeDocument, HandshakeEvent } from '../../schema';
import { AdapterProviderService } from '../factory/adapter-provider.service';
import { CollectionAdapter } from '../adapter';
import { toSignal } from '@angular/core/rxjs-interop';

/**
 * Service facade for handshake operations
 * Provides reactive access to handshake data
 */
@Injectable({
  providedIn: 'root',
})
export class HandshakeService {
  private readonly adapterProvider = inject(AdapterProviderService);

  /**
   * Get the handshake collection adapter
   */
  private get handshakeCollection(): CollectionAdapter<HandshakeDocument> | null {
    try {
      if (!this.adapterProvider.isReady()) {
        return null;
      }
      const adapter = this.adapterProvider.getAdapter();
      return adapter.getCollection<HandshakeDocument>('handshake');
    } catch (error) {
      console.warn('Handshake collection not available yet:', error);
      return null;
    }
  }

  // Reactive queries using adapter
  private get allHandshakes$(): Observable<HandshakeDocument[]> {
    const collection = this.handshakeCollection;
    if (!collection) {
      return new Observable((observer) => observer.next([]));
    }
    return collection.find$();
  }

  /**
   * Signal containing all handshakes
   */
  public readonly handshakes: Signal<HandshakeDocument[]> = toSignal(
    this.allHandshakes$,
    { initialValue: [] },
  );

  /**
   * Get all handshakes as observable
   */
  getHandshakes$(): Observable<HandshakeDocument[]> {
    return this.allHandshakes$;
  }

  /**
   * Get handshake by ID
   */
  async getHandshakeById(id: string): Promise<HandshakeDocument | null> {
    const collection = this.handshakeCollection;
    if (!collection) {
      return null;
    }
    const doc = await collection.findOne(id);
    return doc;
  }

  /**
   * Get handshakes by transaction ID
   */
  getHandshakesByTxnId$(txnId: string): Observable<HandshakeDocument[]> {
    const collection = this.handshakeCollection;
    if (!collection) {
      return new Observable((observer) => observer.next([]));
    }
    return collection.find$({ transaction_id: txnId } as any);
  }

  /**
   * Create a new handshake
   */
  async createHandshake(
    handshake: Omit<
      HandshakeDocument,
      'client_created_at' | 'client_updated_at'
    >,
  ): Promise<HandshakeDocument> {
    const collection = this.handshakeCollection;
    if (!collection) {
      throw new Error('Handshake collection not available');
    }

    // Adapter will automatically set timestamps if not provided
    const now = Date.now().toString();
    const newHandshake: Partial<HandshakeDocument> = {
      ...handshake,
      client_created_at: now,
      client_updated_at: now,
    };

    const doc = await collection.insert(newHandshake);
    return doc;
  }

  /**
   * Update handshake
   */
  async updateHandshake(
    id: string,
    updates: Partial<HandshakeDocument>,
  ): Promise<HandshakeDocument> {
    const collection = this.handshakeCollection;
    if (!collection) {
      throw new Error('Handshake collection not available');
    }

    // Adapter will automatically update client_updated_at
    const updatedDoc = await collection.update(id, {
      ...updates,
      client_updated_at: Date.now().toString(),
    });

    return updatedDoc;
  }

  /**
   * Add event to handshake
   */
  async addEvent(
    id: string,
    event: HandshakeEvent,
  ): Promise<HandshakeDocument> {
    const handshake = await this.getHandshakeById(id);
    if (!handshake) {
      throw new Error(`Handshake with id ${id} not found`);
    }

    const updatedEvents = [...handshake.events, event];

    return this.updateHandshake(id, {
      events: JSON.stringify(updatedEvents),
    });
  }
}
