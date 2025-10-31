import { HandshakeDocument } from './schema';
import { CreateRxDocument, CreateRxCollection } from '../../core/types/utils';

/**
 * ORM methods for Handshake collection
 */
export interface RxHandshakeMethods {
  findAll: () => Promise<RxHandshakeDocument[]>;
  findById: (id: string) => Promise<RxHandshakeDocument | null>;
  create: (handshake: HandshakeDocument) => Promise<RxHandshakeDocument>;
  update: (handshake: HandshakeDocument) => Promise<RxHandshakeDocument>;
  findByTxnId: (txn_id: string) => Promise<RxHandshakeDocument[]>;
}

export type RxHandshakeDocument = CreateRxDocument<
  HandshakeDocument,
  RxHandshakeMethods
>;
export type RxHandshakeCollection = CreateRxCollection<
  HandshakeDocument,
  RxHandshakeMethods
>;
