import { Injectable, Signal } from '@angular/core';
import { Observable } from 'rxjs';
import { HandshakeDocument, HandshakeEvent } from './schema';
import { BaseFacadeService } from '../../core/base-facade.service';
import { COLLECTION_NAMES } from '../../core/collection-registry';
import { toSignal } from '@angular/core/rxjs-interop';

/**
 * Service facade for handshake operations
 * Provides reactive access to handshake data
 */
@Injectable({
  providedIn: 'root',
})
export class HandshakeService extends BaseFacadeService<HandshakeDocument> {
  /**
   * Signal containing all handshakes
   * Uses toSignal for automatic reactive updates
   */
  public readonly handshakes: Signal<HandshakeDocument[]> = toSignal(
    this.allHandshakes$,
    { initialValue: [] },
  );

  protected getCollectionName(): string {
    return COLLECTION_NAMES.HANDSHAKE;
  }

  /**
   * No subscriptions needed - using toSignal for reactivity
   */
  protected setupSubscriptions(): void {
    // Handshake service uses toSignal instead of manual subscriptions
  }

  // Reactive queries using adapter
  private get allHandshakes$(): Observable<HandshakeDocument[]> {
    const collection = this.collection;
    if (!collection) {
      return new Observable((observer) => observer.next([]));
    }
    return collection.find$();
  }

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
    const collection = this.collection;
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
    const collection = this.collection;
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
    const collection = this.collection;
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
    const collection = this.collection;
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
