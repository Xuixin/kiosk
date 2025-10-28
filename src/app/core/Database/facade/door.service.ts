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
import { RxDoorCollection } from '../RxDB.D';
import { DoorDocument } from '../../schema/door.schema';
import { DatabaseService } from '../rxdb.service';

/**
 * Door Service facade for door operations
 * Provides reactive access to door data from local RxDB
 */
// @Injectable({
//   providedIn: 'root',
// })
@Injectable()
export class DoorService implements OnDestroy {
  private readonly dbService = inject(DatabaseService);
  private dbSubscription?: Subscription;
  private _initialized = false;

  // Signals for reactive data
  private _doors = signal<DoorDocument[]>([]);
  public readonly doors = this._doors.asReadonly();

  // Computed signals
  public readonly onlineDoors = computed(() => {
    return this._doors().filter(
      (door) => door.status === 'online' && !door.deleted,
    );
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
   * Get the door collection (lazy access)
   */
  private get doorCollection(): RxDoorCollection | null {
    try {
      return this.dbService.db?.door || null;
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
    const collection = this.doorCollection;

    if (!collection) {
      console.warn('🚪 Door collection not ready, will retry when accessed');
      return;
    }

    try {
      console.log('🚪 Setting up door subscriptions...');

      // Subscribe to local database changes
      this.dbSubscription = collection.find().$.subscribe({
        next: (doors) => {
          console.log('🚪 Local database updated:', doors.length, 'doors');
          console.log(
            '🚪 Door data:',
            doors.map((doc) => ({
              id: doc.id,
              name: doc.name,
              status: doc.status,
              deleted: doc.deleted,
            })),
          );
          // Filter out deleted documents before setting
          const activeDoors = doors.filter((doc) => !doc.deleted);
          this._doors.set(
            activeDoors.map((doc) => doc.toJSON() as DoorDocument),
          );
        },
        error: (error) => {
          console.error('❌ Error in door database subscription:', error);
        },
      });

      console.log('✅ Door subscriptions setup completed');
    } catch (error) {
      console.error('❌ Error setting up door subscriptions:', error);
    }
  }

  /**
   * Get all doors as observable
   */
  getDoors$(): Observable<DoorDocument[]> {
    const collection = this.doorCollection;
    if (!collection) {
      return new Observable((observer) => observer.next([]));
    }
    // Don't use deleted in selector - filter client-side to avoid conflict
    return collection.find().$.pipe(
      map((docs) => docs.filter((doc) => !doc.deleted)),
      map((docs) => docs.map((doc) => doc.toJSON() as DoorDocument)),
    );
  }

  /**
   * Get only online doors as observable
   */
  getOnlineDoors$(): Observable<DoorDocument[]> {
    const collection = this.doorCollection;
    if (!collection) {
      return new Observable((observer) => observer.next([]));
    }
    // Don't use deleted in selector - filter client-side to avoid conflict
    return collection.find({ selector: { status: 'online' } }).$.pipe(
      map((docs) => docs.filter((doc) => !doc.deleted)),
      map((docs) => docs.map((doc) => doc.toJSON() as DoorDocument)),
    );
  }

  /**
   * Get door by ID
   */
  async getDoorById(id: string): Promise<DoorDocument | null> {
    const collection = this.doorCollection;
    if (!collection) {
      return null;
    }
    const doc = await collection.findOne(id).exec();
    return doc ? (doc.toJSON() as DoorDocument) : null;
  }

  /**
   * Get doors by status
   */
  getDoorsByStatus$(status: string): Observable<DoorDocument[]> {
    const collection = this.doorCollection;
    if (!collection) {
      return new Observable((observer) => observer.next([]));
    }
    // Don't use deleted in selector - filter client-side to avoid conflict
    return collection.find({ selector: { status } }).$.pipe(
      map((docs) => docs.filter((doc) => !doc.deleted)),
      map((docs) => docs.map((doc) => doc.toJSON() as DoorDocument)),
    );
  }

  /**
   * Get all doors (for backward compatibility with old API)
   */
  async getDoors(): Promise<DoorDocument[]> {
    const collection = this.doorCollection;
    if (!collection) {
      return [];
    }
    // Don't use deleted in selector - filter client-side to avoid conflict
    const allDocs = await collection.find().exec();
    const docs = allDocs.filter((doc) => !doc.deleted);
    return docs.map((doc) => doc.toJSON() as DoorDocument);
  }

  /**
   * Get online doors (for backward compatibility)
   */
  async getOnlineDoors(): Promise<DoorDocument[]> {
    const collection = this.doorCollection;
    if (!collection) {
      return [];
    }
    // Don't use deleted in selector - filter client-side to avoid conflict
    const allDocs = await collection
      .find({ selector: { status: 'online' } })
      .exec();
    const docs = allDocs.filter((doc) => !doc.deleted);
    return docs.map((doc) => doc.toJSON() as DoorDocument);
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
      const allDoors = await collection.find().exec();
      // Filter out deleted documents
      const doors = allDoors.filter((doc) => !doc.deleted);
      console.log(
        '🔄 Found doors in DB:',
        doors.map((doc) => ({
          id: doc.id,
          name: doc.name,
          status: doc.status,
          deleted: doc.deleted,
        })),
      );
      this._doors.set(doors.map((doc) => doc.toJSON() as DoorDocument));
      console.log('✅ Manually refreshed doors:', doors.length);
      return doors;
    } catch (error) {
      console.error('❌ Error refreshing doors:', error);
      throw error;
    }
  }
}
