import { DoorDocument } from '../../../../../schema';
import { CreateRxDocument, CreateRxCollection } from '../utils';

/**
 * ORM methods for Door collection
 */
export interface RxDoorMethods {
  findAll: () => Promise<RxDoorDocument[]>;
  findById: (id: string) => Promise<RxDoorDocument | null>;
  create: (door: DoorDocument) => Promise<RxDoorDocument>;
  update: (door: DoorDocument) => Promise<RxDoorDocument>;
  findByStatus: (status: string) => Promise<RxDoorDocument[]>;
}

export type RxDoorDocument = CreateRxDocument<DoorDocument, RxDoorMethods>;
export type RxDoorCollection = CreateRxCollection<DoorDocument, RxDoorMethods>;
