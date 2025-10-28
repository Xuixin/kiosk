import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, signal, computed } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { ButtonModule } from 'primeng/button';

import { BaseFlowController } from '../../../base-flow-controller.component';
import { RegistryContextHelper } from '../../../helpers/registry-context.helper';
import {
  DoorApiService,
  DoorDocument,
} from '../../../../core/Api/grapgql/door.service';

interface DoorWithSelection extends DoorDocument {
  selected: boolean;
}

@Component({
  selector: 'app-door-permission',
  standalone: true,
  imports: [CommonModule, IonicModule, ButtonModule],
  styles: [],
  templateUrl: 'door-permission.component.html',
})
export class DoorPermissionComponent
  extends BaseFlowController
  implements OnInit
{
  @Input() override data: Record<string, any> = {};

  // Door data from API
  private doorData = signal<DoorWithSelection[]>([]);

  // Reactive doors from API
  doors = computed<DoorWithSelection[]>(() => {
    return this.doorData();
  });

  loading = signal<boolean>(false);
  loadError = signal<string | null>(null);

  constructor(private doorApiService: DoorApiService) {
    super();
  }

  async ngOnInit(): Promise<void> {
    console.log('DoorPermissionComponent initialized');

    this.loading.set(true);
    this.loadError.set(null);

    try {
      console.log('🔄 Loading doors from API...');
      const doors = await this.doorApiService.pullDoors();

      // Filter out deleted doors
      const activeDoors = doors.filter((door) => !door.deleted);

      console.log('✅ Loaded doors from API:', activeDoors.length);
      console.log(
        '🚪 Door data:',
        activeDoors.map((d) => ({
          id: d.id,
          name: d.name,
          deleted: d.deleted,
        })),
      );

      // Set initial data
      this.doorData.set(
        activeDoors.map((door) => ({ ...door, selected: false })),
      );
    } catch (error) {
      console.error('❌ Error loading doors from API:', error);
      this.loadError.set('ไม่สามารถโหลดข้อมูลประตูได้');
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Toggle door selection
   */
  toggleDoor(door: DoorWithSelection): void {
    this.doorData.update((doors: DoorWithSelection[]) =>
      doors.map((d: DoorWithSelection) =>
        d.id === door.id ? { ...d, selected: !d.selected } : d,
      ),
    );
  }

  /**
   * Get count of selected doors
   */
  getSelectedCount(): number {
    return this.doors().filter((door) => door.selected).length;
  }

  /**
   * Check if any doors are selected
   */
  hasSelection(): boolean {
    return this.getSelectedCount() > 0;
  }

  /**
   * Get selected door IDs
   */
  getSelectedDoorIds(): string[] {
    return this.doors()
      .filter((door) => door.selected)
      .map((door) => door.id);
  }

  /**
   * Get selected door names
   */
  getSelectedDoorNames(): string[] {
    return this.doors()
      .filter((door) => door.selected)
      .map((door) => door.name);
  }

  /**
   * Retry loading doors from API
   */
  async retryLoadDoors(): Promise<void> {
    await this.ngOnInit();
  }

  /**
   * Save selections and close subflow
   */
  async saveAndClose(): Promise<void> {
    if (!this.hasSelection()) {
      alert('กรุณาเลือกประตูที่ต้องการเข้าอย่างน้อย 1 ประตู');
      return;
    }

    try {
      const ctx = this.executionContext() as any;
      const selectedDoorIds = this.getSelectedDoorIds();

      const updatedCtx = RegistryContextHelper.updateDoorPermission(
        ctx,
        selectedDoorIds,
      );

      await this.closeSubflow(updatedCtx);
    } catch (error) {
      console.error('Error in saveAndClose:', error);
      alert('เกิดข้อผิดพลาดในการบันทึกข้อมูล กรุณาลองใหม่อีกครั้ง');
    }
  }

  /**
   * Close subflow without saving
   */
  async close(): Promise<void> {
    try {
      await this.closeSubflow({ cancelled: true });
    } catch (error) {
      console.error('Error closing subflow:', error);
    }
  }
}
