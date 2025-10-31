import { LogClientDocument } from '../../../../../schema';
import { CreateRxDocument, CreateRxCollection } from '../utils';

/**
 * ORM methods for LogClient collection
 * Empty methods interface - no custom methods needed
 */
export interface RxLogClientMethods {}

export type RxLogClientRxDocument = CreateRxDocument<
  LogClientDocument,
  RxLogClientMethods
>;
export type RxLogClientCollection = CreateRxCollection<
  LogClientDocument,
  RxLogClientMethods
>;
