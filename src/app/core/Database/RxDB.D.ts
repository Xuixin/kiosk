import type { RxDocument, RxCollection, RxDatabase } from 'rxdb';
import {
  RxTxnDocumentType,
  HandshakeDocument,
  DoorDocument,
  LogClientDocument,
  LogDocument,
  RxLogDocumentType,
} from '../schema';
import { Signal } from '@angular/core';

// orm method for txn
type RxTxnMethods = {
  findAll: () => Promise<RxTxnDocument[]>;
  findById: (id: string) => Promise<RxTxnDocument | null>;
  create: (txn: RxTxnDocumentType) => Promise<RxTxnDocument>;
  update: (txn: RxTxnDocumentType) => Promise<RxTxnDocument>;
};

// orm method for handshake
type RxHandshakeMethods = {
  findAll: () => Promise<RxHandshakeDocument[]>;
  findById: (id: string) => Promise<RxHandshakeDocument | null>;
  findByTxnId: (txn_id: string) => Promise<RxHandshakeDocument[]>;
  create: (handshake: HandshakeDocument) => Promise<RxHandshakeDocument>;
  update: (handshake: HandshakeDocument) => Promise<RxHandshakeDocument>;
};

// orm method for door
type RxDoorMethods = {
  findAll: () => Promise<RxDoorDocument[]>;
  findById: (id: string) => Promise<RxDoorDocument | null>;
  findByStatus: (status: string) => Promise<RxDoorDocument[]>;
  create: (door: DoorDocument) => Promise<RxDoorDocument>;
  update: (door: DoorDocument) => Promise<RxDoorDocument>;
};

export type RxTxnDocument = RxDocument<RxTxnDocumentType, RxTxnMethods>;
export type RxTxnCollection = RxCollection<
  RxTxnDocumentType,
  RxTxnMethods,
  unknown,
  unknown,
  Signal<unknown>
>;

export type RxHandshakeDocument = RxDocument<
  HandshakeDocument,
  RxHandshakeMethods
>;
export type RxHandshakeCollection = RxCollection<
  HandshakeDocument,
  RxHandshakeMethods,
  unknown,
  unknown,
  Signal<unknown>
>;

export type RxDoorDocument = RxDocument<DoorDocument, RxDoorMethods>;
export type RxDoorCollection = RxCollection<
  DoorDocument,
  RxDoorMethods,
  unknown,
  unknown,
  Signal<unknown>
>;

// orm method for log
type RxLogMethods = {
  findAll: () => Promise<RxLogDocument[]>;
  findById: (id: string) => Promise<RxLogDocument | null>;
  create: (log: LogDocument) => Promise<RxLogDocument>;
  update: (log: LogDocument) => Promise<RxLogDocument>;
};

export type RxLogDocument = RxDocument<RxLogDocumentType, RxLogMethods>;
export type RxLogCollection = RxCollection<
  RxLogDocumentType,
  RxLogMethods,
  unknown,
  unknown,
  Signal<unknown>
>;

// orm method for log_client
type RxLogClientMethods = {};

export type RxLogClientRxDocument = RxDocument<
  LogClientDocument,
  RxLogClientMethods
>;
export type RxLogClientCollection = RxCollection<
  LogClientDocument,
  RxLogClientMethods,
  unknown,
  unknown,
  Signal<unknown>
>;

export type RxTxnsCollections = {
  txn: RxTxnCollection;
  handshake: RxHandshakeCollection;
  door: RxDoorCollection;
  log: RxLogCollection;
  log_client: RxLogClientCollection;
};
export type RxTxnsDatabase = RxDatabase<
  RxTxnsCollections,
  unknown,
  unknown,
  Signal<unknown>
>;
