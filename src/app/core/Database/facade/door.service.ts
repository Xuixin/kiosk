import { Injectable, computed, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { DoorDocument } from '../../schema/door.schema';
import { BaseFacadeService } from './base-facade.service';
import { COLLECTION_NAMES } from '../config/collection-registry';

/**
 * Door Service facade for door operations
 * Provides reactive access to door data from local RxDB
 */
@Injectable({
  providedIn: 'root',
})
export class DoorFacade extends BaseFacadeService<DoorDocument> {
  // Signals for reactive data
  private _doors = signal<DoorDocument[]>([]);
  public readonly doors = this._doors.asReadonly();

  // Computed signals
  public readonly onlineDoors = computed(() => {
    return this._doors().filter((door) => door.status === 'online');
  });

  constructor() {
    super();
    console.log('DoorService: Created (lazy initialization)');
  }

  protected getCollectionName(): string {
    return COLLECTION_NAMES.DOOR;
  }

  /**
   * Ensure service is initialized - call this before using the service
   * This sets up the database subscriptions
   */
  ensureInitialized(): void {
    if (this.isInitialized) {
      console.log('DoorService: Already initialized, skipping');
      return;
    }
    super.ensureInitialized();
  }

  /**
   * Setup database subscriptions
   */
  protected setupSubscriptions(): void {
    const collection = this.collection;
    if (!collection) {
      console.warn('🚪 Door collection not ready, will retry when accessed');
      return;
    }

    console.log('🚪 Setting up door subscriptions...');

    // Subscribe to local database changes using adapter
    const subscription = collection.find$().subscribe({
      next: (doors) => {
        console.log('🚪 Local database updated:', doors.length, 'doors');
        console.log(
          '🚪 Door data:',
          doors.map((doc) => ({
            id: doc.id,
            name: doc.name,
            status: doc.status,
            deleted: (doc as any).deleted,
          })),
        );
        // Filter out deleted documents before setting (adapter returns plain objects)
        const activeDoors = doors.filter((doc) => !(doc as any).deleted);
        this._doors.set(activeDoors);
      },
      error: (error) => {
        console.error('❌ Error in door database subscription:', error);
      },
    });

    this.addSubscription(subscription);
  }

  /**
   * Get all doors as observable
   */
  getDoors$(): Observable<DoorDocument[]> {
    const collection = this.collection;
    if (!collection) {
      return new Observable((observer) => observer.next([]));
    }
    // Filter out deleted documents client-side
    return collection
      .find$()
      .pipe(map((docs) => docs.filter((doc) => !(doc as any).deleted)));
  }

  /**
   * Get only online doors as observable
   */
  getOnlineDoors$(): Observable<DoorDocument[]> {
    const collection = this.collection;
    if (!collection) {
      return new Observable((observer) => observer.next([]));
    }
    // Filter by status and exclude deleted documents
    return collection
      .find$({ status: 'online' } as any)
      .pipe(map((docs) => docs.filter((doc) => !(doc as any).deleted)));
  }

  /**
   * Get door by ID
   */
  async getDoorById(id: string): Promise<DoorDocument | null> {
    const collection = this.collection;
    if (!collection) {
      return null;
    }
    const doc = await collection.findOne(id);
    return doc && !(doc as any).deleted ? doc : null;
  }

  /**
   * Get doors by status
   */
  getDoorsByStatus$(status: string): Observable<DoorDocument[]> {
    const collection = this.collection;
    if (!collection) {
      return new Observable((observer) => observer.next([]));
    }
    // Filter by status and exclude deleted documents
    return collection
      .find$({ status } as any)
      .pipe(map((docs) => docs.filter((doc) => !(doc as any).deleted)));
  }

  /**
   * Get all doors (for backward compatibility with old API)
   */
  async getDoors(): Promise<DoorDocument[]> {
    const collection = this.collection;
    if (!collection) {
      return [];
    }
    // Filter out deleted documents client-side
    const allDocs = await collection.find();
    return allDocs.filter((doc) => !(doc as any).deleted);
  }

  /**
   * Get online doors (for backward compatibility)
   */
  async getOnlineDoors(): Promise<DoorDocument[]> {
    const collection = this.collection;
    if (!collection) {
      return [];
    }
    // Filter by status and exclude deleted documents
    const allDocs = await collection.find({ status: 'online' } as any);
    return allDocs.filter((doc) => !(doc as any).deleted);
  }

  /**
   * Manually refresh doors
   */
  async refreshDoors() {
    // Ensure initialized first
    if (!this.isInitialized) {
      this.ensureInitialized();
    }

    const collection = this.collection;
    if (!collection) {
      console.warn('🚪 Door collection not available yet');
      return [];
    }
    console.log('🔄 Manually refreshing doors...');
    const allDoors = await collection.find();
    // Filter out deleted documents (adapter returns plain objects)
    const doors = allDoors.filter((doc) => !(doc as any).deleted);
    console.log(
      '🔄 Found doors in DB:',
      doors.map((doc) => ({
        id: doc.id,
        name: doc.name,
        status: doc.status,
        deleted: (doc as any).deleted,
      })),
    );
    this._doors.set(doors);
    console.log('✅ Manually refreshed doors:', doors.length);
    return doors;
  }
}
