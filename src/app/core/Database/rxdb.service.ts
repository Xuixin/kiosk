import { Injector, Injectable, Signal, untracked } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";

import { environment } from "../../../environments/environment";
import { TXN_SCHEMA } from "../schema/txn.schema";

import { RxReactivityFactory, createRxDatabase } from "rxdb/plugins/core";

import { RxTxnsCollections, RxTxnsDatabase } from "./RxDB.D";

environment.addRxDBPlugins();

const DATABASE_NAME = "kiosk_db";

const collectionsSettings = {
  txn: {
    schema: TXN_SCHEMA as any,
  },
};

async function _create(injector: Injector): Promise<RxTxnsDatabase> {
  environment.addRxDBPlugins();

  console.log("DatabaseService: creating database..");

  const reactivityFactory: RxReactivityFactory<Signal<any>> = {
    fromObservable(obs, initialValue: any) {
      return untracked(() =>
        toSignal(obs, {
          initialValue,
          injector,
        })
      );
    },
  };

  const db = (await createRxDatabase<RxTxnsCollections>({
    name: DATABASE_NAME,
    storage: environment.getRxStorage(),
    multiInstance: environment.multiInstance,
    reactivity: reactivityFactory,
  })) as RxTxnsDatabase;

  console.log("DatabaseService: created database");

  if (environment.multiInstance) {
    db.waitForLeadership().then(() => {
      console.log("isLeader now");
      document.title = "♛ " + document.title;
    });
  }

  console.log("DatabaseService: create collections");

  await db.addCollections(collectionsSettings);

  return db;
}

let initState: null | Promise<any> = null;
let DB_INSTANCE: RxTxnsDatabase;

export async function initDatabase(injector: Injector) {
  if (!injector) {
    throw new Error("initDatabase() injector missing");
  }

  if (!initState) {
    console.log("initDatabase()");
    initState = _create(injector).then((db) => (DB_INSTANCE = db));
  }
  await initState;
}

@Injectable()
export class DatabaseService {
  get db(): RxTxnsDatabase {
    return DB_INSTANCE;
  }
}
