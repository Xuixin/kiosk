import { Injectable } from '@angular/core';
import { DatabaseService } from 'src/app/core/Database/rxdb.service';
import { HandshakeDocument, RxTxnDocumentType } from 'src/app/core/schema';
import { HandshakeService } from 'src/app/core/Database/facade';
import { UUIDUtils } from 'src/app/utils/uuid.utils';
import { environment } from 'src/environments/environment';

export interface RegistryTransaction {
  id: string;
  name: string;
  id_card_base64: string;
  student_number: string;
  register_type: string;
  door_permission: string[];
  status: 'PENDING' | 'IN' | 'OUT';
  client_created_at: string;
}

export interface SubmitResult {
  success: boolean;
  transaction?: RegistryTransaction;
  error?: string;
}

@Injectable({
  providedIn: 'root',
})
export class RegistryService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly handshakeService: HandshakeService,
  ) {}

  async submitRegistration(
    registry: RegistryTransaction,
  ): Promise<SubmitResult> {
    try {
      await this.dbService.db.txn.insert({
        id: registry.id,
        name: registry.name,
        id_card_base64: registry.id_card_base64,
        student_number: registry.student_number,
        register_type: registry.register_type,
        door_permission: registry.door_permission,
        status: registry.status,
        client_created_at: registry.client_created_at,
      } as unknown as RxTxnDocumentType);

      const hs_id = UUIDUtils.generatePrefixedId('hs', '-');

      await this.handshakeService.createHandshake({
        id: hs_id,
        transaction_id: registry.id,
        handshake: '',
        events: JSON.stringify(
          {
            type: 'CREATE',
            at: Date.now().toString(),
            actor: environment.clientName,
          },
        ),
      } as unknown as HandshakeDocument);

      return {
        success: true,
        transaction: registry,
      };
    } catch (error) {
      console.error('Error in submitRegistration:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
