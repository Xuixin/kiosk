// GraphQL Mutation สำหรับ Push Door
export const PUSH_DOOR_MUTATION = `
  mutation PushDoor($writeRows: [DoorInputPushRow!]!) {
    pushDoors(input: $writeRows) {
      id
      name
      server_created_at
      server_updated_at
      client_created_at
      client_updated_at
      deleted
      status
      max_persons
    }
  }
`;

// GraphQL Query สำหรับ Pull Door
export const PULL_DOOR_QUERY = `
  query PullDoors($input: DoorPull!) {
    pullDoors(input: $input) {
      documents {
        id
        name
        max_persons
        status
        client_created_at
        client_updated_at
        server_created_at
        server_updated_at
        deleted
      }
      checkpoint {
        id
        server_updated_at
      }
    }
  }
`;

// GraphQL Subscription สำหรับ Stream Door (Real-time)
export const STREAM_DOOR_SUBSCRIPTION = `
  subscription steamDoor {
    streamDoor {
      documents {
        id
        name
        max_persons
        status
        client_created_at
        client_updated_at
        server_created_at
        server_updated_at
      }
      checkpoint {
        id
        server_updated_at
      }
    }
  }
`;
