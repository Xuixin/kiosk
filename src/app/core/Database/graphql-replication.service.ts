// graphql-replication.service.ts
import { Injectable } from "@angular/core";
import { replicateGraphQL } from "rxdb/plugins/replication-graphql";
import { RxGraphQLReplicationState } from "rxdb/plugins/replication-graphql";
import { RxTxnCollection, RxTxnDocument } from "./RxDB.D";
import { RxTxnDocumentType } from "../schema/txn.schema";
import { environment } from "src/environments/environment";

// GraphQL Query และ Mutation
const PULL_QUERY = `
  query PullTxns($lastId: String!, $minUpdatedAt: String!, $limit: Int!) {
    pullTxns(lastId: $lastId, minUpdatedAt: $minUpdatedAt, limit: $limit) {
      documents {
        id
        name
        id_card_base64
        student_number
        register_type
        door_permission
        status
        client_created_at
        client_updated_at
        server_created_at
        server_updated_at
        _deleted
      }
      checkpoint {
        id
        updatedAt
      }
    }
  }
`;

const PUSH_MUTATION = `
  mutation PushTxns($txns: [TxnInput!]!) {
    pushTxns(txns: $txns) {
      id
      name
      id_card_base64
      student_number
      register_type
      door_permission
      status
      client_created_at
      client_updated_at
      server_created_at
      server_updated_at
    }
  }
`;

// ตัวอย่าง GraphQL Types สำหรับ Backend
/*
type Txn {
  id: String!
  name: String!
  id_card_base64: String!
  student_number: String!
  register_type: String!
  door_permission: [String!]!
  status: String!
  client_created_at: String!
  client_updated_at: String
  server_created_at: String
  server_updated_at: String
  _deleted: Boolean
}

input TxnInput {
  id: String!
  name: String!
  id_card_base64: String!
  student_number: String!
  register_type: String!
  door_permission: [String!]!
  status: String!
  client_created_at: String!
  client_updated_at: String
  server_created_at: String
  server_updated_at: String
  _deleted: Boolean
}

type Checkpoint {
  id: String!
  updatedAt: String!
}

type PullTxnsResponse {
  documents: [Txn!]!
  checkpoint: Checkpoint
}

type Query {
  pullTxns(lastId: String!, minUpdatedAt: String!, limit: Int!): PullTxnsResponse!
}

type Mutation {
  pushTxns(txns: [TxnInput!]!): [Txn!]!
}
*/

@Injectable()
export class GraphQLReplicationService {
  private replicationState?: RxGraphQLReplicationState<RxTxnDocumentType, any>;
  private graphqlEndpoint: string = environment.apiUrl;

  constructor() {}

  /**
   * เริ่มต้น GraphQL Replication
   */
  async setupReplication(
    collection: RxTxnCollection
  ): Promise<RxGraphQLReplicationState<RxTxnDocumentType, any>> {
    console.log("Setting up GraphQL replication...");

    this.replicationState = replicateGraphQL<RxTxnDocumentType, any>({
      collection,
      replicationIdentifier: "txn-graphql-replication",
      url: {
        http: this.graphqlEndpoint,
        // ws: 'ws://localhost:4000/graphql', // สำหรับ WebSocket Subscriptions (optional)
      },

      pull: {
        queryBuilder: (checkpoint, limit) => {
          const query = {
            query: PULL_QUERY,
            variables: {
              lastId: checkpoint?.id || "",
              minUpdatedAt: checkpoint?.updatedAt || "0",
              limit: limit || 10,
            },
          };
          return query;
        },

        modifier: (doc) => {
          if (doc.status === "out") {
            return;
          }

          return doc;
        },

        dataPath: "pullTxns.documents",

        responseModifier: (response) => {
          return {
            documents: response.pullTxns.documents,
            checkpoint: response.pullTxns.checkpoint,
          };
        },
      },

      push: {
        queryBuilder: (docs) => {
          const txns = docs.map((docRow) => {
            const doc = docRow.newDocumentState;
            const txnInput = {
              id: doc.id,
              name: doc.name,
              id_card_base64: doc.id_card_base64,
              student_number: doc.student_number,
              register_type: doc.register_type,
              door_permission: doc.door_permission,
              status: doc.status,
              client_created_at: doc.client_created_at,
              client_updated_at: doc.client_updated_at || null,
              server_created_at: doc.server_created_at || null,
              server_updated_at: doc.server_updated_at || null,
              _deleted: docRow.assumedMasterState === null,
            };
            return txnInput;
          });

          return {
            query: PUSH_MUTATION,
            variables: {
              txns,
            },
          };
        },

        dataPath: "pushTxns",

        modifier: (doc) => {
          return doc;
        },
      },

      live: true,
      retryTime: 5000,
      autoStart: true,
      waitForLeadership: true,

      headers: {
        // 'Authorization': 'Bearer YOUR_TOKEN',
      },
    });

    this.replicationState.error$.subscribe((error) => {
      console.error("Replication error:", error);
    });

    this.replicationState.active$.subscribe((active) => {
      console.log("Replication active:", active);
    });

    await this.replicationState.awaitInitialReplication();
    console.log("Initial replication completed");

    return this.replicationState;
  }

  /**
   * หยุด replication
   */
  async stopReplication() {
    if (this.replicationState) {
      await this.replicationState.cancel();
      console.log("Replication stopped");
    }
  }

  /**
   * Sync ข้อมูลด้วยตนเอง
   */
  async manualSync() {
    if (this.replicationState) {
      await this.replicationState.reSync();
      console.log("Manual sync completed");
    }
  }

  /**
   * ดูสถานะ replication
   */
  getReplicationState() {
    return this.replicationState;
  }
}

// การใช้งานใน database.service.ts
/*
import { GraphQLReplicationService } from './graphql-replication.service';

@Injectable()
export class DatabaseService {
  private replicationService?: GraphQLReplicationService;

  get db(): RxTxnsDatabase {
    return DB_INSTANCE;
  }

  async startReplication() {
    if (!this.replicationService) {
      this.replicationService = new GraphQLReplicationService(
        'http://localhost:4000/graphql' // URL ของ GraphQL server
      );
    }
    
    await this.replicationService.setupReplication(this.db.txn);
  }

  async stopReplication() {
    if (this.replicationService) {
      await this.replicationService.stopReplication();
    }
  }
}
*/

// การใช้งานใน component
/*
export class AppComponent implements OnInit {
  constructor(private dbService: DatabaseService) {}

  async ngOnInit() {
    // เริ่ม replication
    await this.dbService.startReplication();

    // ดูสถานะ
    const state = this.dbService['replicationService']?.getReplicationState();
    
    // Subscribe to sync events
    state?.active$.subscribe(active => {
      console.log('Syncing:', active);
    });

    state?.error$.subscribe(error => {
      console.error('Sync error:', error);
    });
  }

  async onManualSync() {
    await this.dbService['replicationService']?.manualSync();
  }

  ngOnDestroy() {
    this.dbService.stopReplication();
  }
}
*/
