import { RxLogDocumentType } from '../../../../../schema';
import { CreateRxDocument, CreateRxCollection } from '../utils';

/**
 * ORM methods for Log collection
 */
export interface RxLogMethods {
  findAll: () => Promise<RxLogDocument[]>;
  findById: (id: string) => Promise<RxLogDocument | null>;
  create: (log: RxLogDocumentType) => Promise<RxLogDocument>;
  update: (log: RxLogDocumentType) => Promise<RxLogDocument>;
}

export type RxLogDocument = CreateRxDocument<RxLogDocumentType, RxLogMethods>;
export type RxLogCollection = CreateRxCollection<
  RxLogDocumentType,
  RxLogMethods
>;
