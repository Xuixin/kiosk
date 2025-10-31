import {
  Injectable,
  Signal,
  computed,
  inject,
  OnDestroy,
  signal,
} from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import { map } from 'rxjs/operators';
import { DoorDocument } from '../../schema/door.schema';
import { AdapterProviderService } from '../factory/adapter-provider.service';
import { CollectionAdapter } from '../adapter';

/**
 * Door Service facade for door operations
 * Provides reactive access to door data from local RxDB
 */
@Injectable({
  providedIn: 'root',
})
export class DoorFacade implements OnDestroy {
  private readonly adapterProvider = inject(AdapterProviderService);
  private dbSubscription?: Subscription;
  private _initialized = false;

  // Signals for reactive data
  private _doors = signal<DoorDocument[]>([]);
  public readonly doors = this._doors.asReadonly();

  // Computed signals
  public readonly onlineDoors = computed(() => {
    return this._doors().filter((door) => door.status === 'online');
  });

  constructor() {
    console.log('DoorService: Created (lazy initialization)');
  }

  /**
   * Ensure service is initialized - call this before using the service
   * This sets up the database subscriptions
   */
  ensureInitialized(): void {
    if (this._initialized) {
      console.log('DoorService: Already initialized, skipping');
      return;
    }

    console.log('DoorService: Initializing...');
    this._initialized = true;
    this.setupSubscriptions();
  }

  /**
   * Get the door collection adapter (lazy access)
   */
  private get doorCollection(): CollectionAdapter<DoorDocument> | null {
    try {
      if (!this.adapterProvider.isReady()) {
        return null;
      }
      const adapter = this.adapterProvider.getAdapter();
      return adapter.getCollection<DoorDocument>('door');
    } catch (error) {
      console.warn('Door collection not available yet:', error);
      return null;
    }
  }

  ngOnDestroy() {
    if (this.dbSubscription) {
      this.dbSubscription.unsubscribe();
    }
  }

  /**
   * Setup database subscriptions
   */
  private setupSubscriptions() {
    // Wait for adapter to be ready
    this.adapterProvider
      .waitUntilReady()
      .then(() => {
        const collection = this.doorCollection;

        if (!collection) {
          console.warn(
            '🚪 Door collection not ready, will retry when accessed',
          );
          return;
        }

        try {
          console.log('🚪 Setting up door subscriptions...');

          // Subscribe to local database changes using adapter
          this.dbSubscription = collection.find$().subscribe({
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

          console.log('✅ Door subscriptions setup completed');
        } catch (error) {
          console.error('❌ Error setting up door subscriptions:', error);
        }
      })
      .catch((error) => {
        console.error('❌ Error waiting for adapter:', error);
      });
  }

  /**
   * Get all doors as observable
   */
  getDoors$(): Observable<DoorDocument[]> {
    const collection = this.doorCollection;
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
    const collection = this.doorCollection;
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
    const collection = this.doorCollection;
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
    const collection = this.doorCollection;
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
    const collection = this.doorCollection;
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
    const collection = this.doorCollection;
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
    if (!this._initialized) {
      this.ensureInitialized();
    }

    const collection = this.doorCollection;
    if (!collection) {
      console.warn('🚪 Door collection not available yet');
      return [];
    }
    try {
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
    } catch (error) {
      console.error('❌ Error refreshing doors:', error);
      throw error;
    }
  }
}
