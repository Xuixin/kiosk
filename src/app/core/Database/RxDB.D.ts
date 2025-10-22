import type { RxDocument, RxCollection, RxDatabase } from 'rxdb';
import { RxTxnDocumentType } from '../schema/txn.schema';
import { RxDoorDocumentType } from '../schema/door.schema';
import { Signal } from '@angular/core';

// orm method
type RxTxnMethods = {
  findAll: () => Promise<RxTxnDocument[]>;
  findById: (id: string) => Promise<RxTxnDocument | null>;
  create: (txn: RxTxnDocumentType) => Promise<RxTxnDocument>;
  update: (txn: RxTxnDocumentType) => Promise<RxTxnDocument>;
};

export type RxTxnDocument = RxDocument<RxTxnDocumentType, RxTxnMethods>;
export type RxTxnCollection = RxCollection<
  RxTxnDocumentType,
  RxTxnMethods,
  unknown,
  unknown,
  Signal<unknown>
>;

// Door methods
type RxDoorMethods = {
  findAll: () => Promise<RxDoorDocument[]>;
  findById: (id: string) => Promise<RxDoorDocument | null>;
  create: (door: RxDoorDocumentType) => Promise<RxDoorDocument>;
  update: (door: RxDoorDocumentType) => Promise<RxDoorDocument>;
};

export type RxDoorDocument = RxDocument<RxDoorDocumentType, RxDoorMethods>;
export type RxDoorCollection = RxCollection<
  RxDoorDocumentType,
  RxDoorMethods,
  unknown,
  unknown,
  Signal<unknown>
>;

export type RxTxnsCollections = {
  txn: RxTxnCollection;
  door: RxDoorCollection;
};
export type RxTxnsDatabase = RxDatabase<
  RxTxnsCollections,
  unknown,
  unknown,
  Signal<unknown>
>;
