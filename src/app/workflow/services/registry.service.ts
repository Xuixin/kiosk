import { Injectable } from '@angular/core';
import { RegistryContext } from '../helpers/registry-context.helper';

export interface RegistryTransaction {
  id: string;
  user: RegistryContext['user'];
  door_permission: string[];
  register_type: string;
  created_at: string;
  status: 'PENDING' | 'IN' | 'OUT';
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
  private readonly STORAGE_KEY = 'registry_transactions';

  /**
   * บันทึกการลงทะเบียน
   */
  async submitRegistration(ctx: RegistryContext): Promise<SubmitResult> {
    try {
      const transaction: RegistryTransaction = {
        id: this.generateTransactionId(),
        user: ctx.user,
        door_permission: ctx.door_permission,
        register_type: ctx.register_type,
        created_at: new Date().toISOString(),
        status: 'PENDING',
      };

      // บันทึกลง localStorage
      const existingTransactions = await this.getRegistrations();
      const updatedTransactions = [...existingTransactions, transaction];

      localStorage.setItem(
        this.STORAGE_KEY,
        JSON.stringify(updatedTransactions)
      );

      return {
        success: true,
        transaction,
      };
    } catch (error) {
      console.error('Error submitting registration:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * ดึงรายการการลงทะเบียนทั้งหมด
   */
  async getRegistrations(): Promise<RegistryTransaction[]> {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (!stored) {
        return [];
      }
      return JSON.parse(stored);
    } catch (error) {
      console.error('Error getting registrations:', error);
      return [];
    }
  }

  /**
   * ดึงการลงทะเบียนตาม ID
   */
  async getRegistrationById(id: string): Promise<RegistryTransaction | null> {
    const transactions = await this.getRegistrations();
    return transactions.find((t) => t.id === id) || null;
  }

  /**
   * อัพเดทสถานะการลงทะเบียน
   */
  async updateRegistrationStatus(
    id: string,
    status: 'PENDING' | 'IN' | 'OUT'
  ): Promise<boolean> {
    try {
      const transactions = await this.getRegistrations();
      const transactionIndex = transactions.findIndex((t) => t.id === id);

      if (transactionIndex === -1) {
        return false;
      }

      transactions[transactionIndex].status = status;
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(transactions));
      return true;
    } catch (error) {
      console.error('Error updating registration status:', error);
      return false;
    }
  }

  /**
   * ลบการลงทะเบียน
   */
  async deleteRegistration(id: string): Promise<boolean> {
    try {
      const transactions = await this.getRegistrations();
      const filteredTransactions = transactions.filter((t) => t.id !== id);
      localStorage.setItem(
        this.STORAGE_KEY,
        JSON.stringify(filteredTransactions)
      );
      return true;
    } catch (error) {
      console.error('Error deleting registration:', error);
      return false;
    }
  }

  /**
   * สร้าง Transaction ID
   */
  private generateTransactionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 5);
    return `REG-${timestamp}-${random}`.toUpperCase();
  }

  /**
   * ตรวจสอบการเชื่อมต่อ storage
   */
  isStorageReady(): boolean {
    try {
      localStorage.setItem('test', 'test');
      localStorage.removeItem('test');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * ล้างข้อมูลทั้งหมด
   */
  async clearAllRegistrations(): Promise<boolean> {
    try {
      localStorage.removeItem(this.STORAGE_KEY);
      return true;
    } catch (error) {
      console.error('Error clearing registrations:', error);
      return false;
    }
  }
}
