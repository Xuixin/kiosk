import { CommonModule } from "@angular/common";
import { Component, Input, OnInit, signal } from "@angular/core";
import { IonicModule } from "@ionic/angular";

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
  imports: [CommonModule, IonicModule],
  styles: [
    `
      .door-container {
        max-width: 600px;
        margin: 0 auto;
        padding: 1rem;
      }

      .door-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin-bottom: 2rem;
      }

      .door-item {
        display: flex;
        align-items: center;
        padding: 1rem;
        border: 2px solid #e5e7eb;
        border-radius: 0.75rem;
        cursor: pointer;
        transition: all 0.2s;
        background-color: white;
      }

      .door-item:hover {
        border-color: #3b82f6;
        background-color: #f8fafc;
      }

      .door-item.selected {
        border-color: #3b82f6;
        background-color: #eff6ff;
      }

      .door-checkbox {
        margin-right: 1rem;
        width: 1.25rem;
        height: 1.25rem;
        accent-color: #3b82f6;
      }

      .door-info {
        flex: 1;
      }

      .door-name {
        font-weight: 500;
        font-size: 1rem;
        color: #374151;
        margin-bottom: 0.25rem;
      }

      .door-description {
        font-size: 0.875rem;
        color: #6b7280;
      }

      .button-group {
        display: flex;
        gap: 1rem;
        justify-content: flex-end;
        margin-top: 2rem;
      }

      .btn {
        padding: 0.75rem 1.5rem;
        border-radius: 0.5rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
        border: none;
      }

      .btn-primary {
        background-color: #3b82f6;
        color: white;
      }

      .btn-primary:hover:not(:disabled) {
        background-color: #2563eb;
      }

      .btn-primary:disabled {
        background-color: #9ca3af;
        cursor: not-allowed;
      }

      .btn-secondary {
        background-color: #6b7280;
        color: white;
      }

      .btn-secondary:hover {
        background-color: #4b5563;
      }

      .selection-info {
        background-color: #f0f9ff;
        border: 1px solid #0ea5e9;
        border-radius: 0.5rem;
        padding: 1rem;
        margin-bottom: 1rem;
        text-align: center;
      }

      .selection-count {
        font-weight: 600;
        color: #0369a1;
        font-size: 1.125rem;
      }

      .selection-text {
        color: #0c4a6e;
        font-size: 0.875rem;
        margin-top: 0.25rem;
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>เลือกประตูที่ต้องการเข้า</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="close()">ปิด</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <div class="door-container">
        <!-- Selection Info -->
        <div class="selection-info">
          <div class="selection-count">
            เลือกแล้ว {{ getSelectedCount() }} ประตู
          </div>
          <div class="selection-text">
            กรุณาเลือกประตูที่ต้องการเข้า (สามารถเลือกได้หลายประตู)
          </div>
        </div>

        <!-- Door List -->
        <div class="door-list">
          <div
            *ngFor="let door of doors()"
            class="door-item"
            [class.selected]="door.selected"
            (click)="toggleDoor(door)"
          >
            <input
              type="checkbox"
              class="door-checkbox"
              [checked]="door.selected"
              (change)="toggleDoor(door)"
            />
            <div class="door-info">
              <div class="door-name">{{ door.name }}</div>
              <div class="door-description">{{ door.description }}</div>
            </div>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="button-group">
          <button type="button" class="btn btn-secondary" (click)="close()">
            ปิดหน้าต่าง
          </button>
          <button
            type="button"
            class="btn btn-primary"
            (click)="saveAndClose()"
            [disabled]="!hasSelection()"
          >
            เสร็จสิ้น
          </button>
        </div>
      </div>
    </ion-content>
  `,
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
