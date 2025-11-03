import { CommonModule } from '@angular/common';
import { Component, Input, signal, inject, effect } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { ButtonModule } from 'primeng/button';
import { BaseFlowController } from '../../../base-flow-controller.component';
import { RegistryContextHelper } from '../../../helpers/registry-context.helper';
import { DeviceMonitoringDocument } from '../../../../core/Database/collections/device-monitoring/schema';
import { DeviceMonitoringFacade } from 'src/app/core/Database/collections/device-monitoring';
import { toSignal } from '@angular/core/rxjs-interop';

interface DoorWithSelection extends DeviceMonitoringDocument {
  selected: boolean;
}

@Component({
  selector: 'app-door-permission',
  standalone: true,
  imports: [CommonModule, IonicModule, ButtonModule],
  styles: [],
  templateUrl: 'door-permission.component.html',
})
export class DoorPermissionComponent extends BaseFlowController {
  @Input() override data: Record<string, any> = {};

  private deviceMonitoringFacade = inject(DeviceMonitoringFacade);

  // Door data from device-monitoring collection (type='DOOR')
  doorData = signal<DoorWithSelection[]>([]);

  private doors$ = this.deviceMonitoringFacade.getDoors$();

  // Reactive doors from RxDB (filtered by type='DOOR')
  doorsWithSelection = toSignal(this.doors$, { initialValue: [] });

  constructor() {
    super();
    this.deviceMonitoringFacade.ensureInitialized();
    // Sync doorData with RxDB stream, preserve current selections
    effect(() => {
      const incoming = this.doorsWithSelection();
      this.doorData.update((current: DoorWithSelection[]) => {
        const selectedIds = new Set(
          current.filter((d) => d.selected).map((d) => d.id),
        );
        return incoming.map((door) => ({
          ...door,
          selected: selectedIds.has(door.id),
        }));
      });
    });
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
    return this.doorData().filter((door) => door.selected).length;
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
    return this.doorData()
      .filter((door) => door.selected)
      .map((door) => door.id);
  }

  /**
   * Get selected door names
   */
  getSelectedDoorNames(): string[] {
    return this.doorData()
      .filter((door) => door.selected)
      .map((door) => door.name);
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
