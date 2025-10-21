import { CommonModule } from "@angular/common";
import { Component, Input, OnInit, signal } from "@angular/core";
import { IonicModule } from "@ionic/angular";
import { ButtonModule } from "primeng/button";

import { BaseFlowController } from "../../../base-flow-controller.component";
import { RegistryContextHelper } from "../../../helpers/registry-context.helper";

interface Door {
  id: string;
  name: string;
  description: string;
  selected: boolean;
}

@Component({
  selector: "app-door-permission",
  standalone: true,
  imports: [CommonModule, IonicModule, ButtonModule],
  styles: [],
  templateUrl: "door-permission.component.html",
})
export class DoorPermissionComponent
  extends BaseFlowController
  implements OnInit
{
  @Input() override data: Record<string, any> = {};

  // Available doors
  doors = signal<Door[]>([
    {
      id: "1",
      name: "ประตู 1 - ทางเข้าหลัก",
      description: "ประตูทางเข้าหลักของอาคาร",
      selected: false,
    },
    {
      id: "2",
      name: "ประตู 2 - ทางเข้าด้านข้าง",
      description: "ประตูทางเข้าด้านข้างของอาคาร",
      selected: false,
    },
    {
      id: "3",
      name: "ประตู 3 - ทางเข้าห้องประชุม",
      description: "ประตูเข้าห้องประชุมใหญ่",
      selected: false,
    },
    {
      id: "4",
      name: "ประตู 4 - ทางเข้าห้องสมุด",
      description: "ประตูเข้าห้องสมุด",
      selected: false,
    },
    {
      id: "5",
      name: "ประตู 5 - ทางเข้าห้องแล็บ",
      description: "ประตูเข้าห้องปฏิบัติการ",
      selected: false,
    },
  ]);

  override ngOnInit() {
    // Load existing selections from context
    this.loadExistingSelections();
  }

  /**
   * Load existing door selections from context
   */
  private loadExistingSelections(): void {
    const ctx = this.executionContext() as any;
    if (ctx?.door_permission && Array.isArray(ctx.door_permission)) {
      const selectedDoorIds = ctx.door_permission;

      this.doors.update((doors) =>
        doors.map((door) => ({
          ...door,
          selected: selectedDoorIds.includes(door.id),
        }))
      );
    }
  }

  /**
   * Toggle door selection
   */
  toggleDoor(door: Door): void {
    this.doors.update((doors) =>
      doors.map((d) => (d.id === door.id ? { ...d, selected: !d.selected } : d))
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
   * Save selections and close subflow
   */
  async saveAndClose(): Promise<void> {
    if (!this.hasSelection()) {
      alert("กรุณาเลือกประตูที่ต้องการเข้าอย่างน้อย 1 ประตู");
      return;
    }

    try {
      const ctx = this.executionContext() as any;
      const selectedDoorIds = this.getSelectedDoorIds();

      // Update context with selected doors
      const updatedCtx = RegistryContextHelper.updateDoorPermission(
        ctx,
        selectedDoorIds
      );

      // Close subflow and return to summary
      await this.closeSubflow(updatedCtx);
    } catch (error) {
      console.error("Error in saveAndClose:", error);
      alert("เกิดข้อผิดพลาดในการบันทึกข้อมูล กรุณาลองใหม่อีกครั้ง");
    }
  }

  /**
   * Close subflow without saving
   */
  async close(): Promise<void> {
    try {
      await this.closeSubflow({ cancelled: true });
    } catch (error) {
      console.error("Error closing subflow:", error);
    }
  }
}
