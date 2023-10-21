import { CommonModule } from "@angular/common";
import { Component, inject, Input, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { IonicModule } from "@ionic/angular";

import { BaseFlowController } from "../../../base-flow-controller.component";
import { RegistryContextHelper } from "../../../helpers/registry-context.helper";

@Component({
  selector: "app-user-data-form",
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
  styles: [
    `
      .form-container {
        max-width: 500px;
        margin: 0 auto;
        padding: 1rem;
      }

      .form-group {
        margin-bottom: 1.5rem;
      }

      .form-label {
        display: block;
        margin-bottom: 0.5rem;
        font-weight: 500;
        color: #374151;
      }

      .form-input {
        width: 100%;
        padding: 0.75rem;
        border: 2px solid #d1d5db;
        border-radius: 0.5rem;
        font-size: 1rem;
        transition: border-color 0.2s;
      }

      .form-input:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      .form-select {
        width: 100%;
        padding: 0.75rem;
        border: 2px solid #d1d5db;
        border-radius: 0.5rem;
        font-size: 1rem;
        background-color: white;
        transition: border-color 0.2s;
      }

      .form-select:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      .error-message {
        color: #ef4444;
        font-size: 0.875rem;
        margin-top: 0.25rem;
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
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>ข้อมูลผู้ใช้</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="close()">ปิด</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <div class="form-container">
        <div class="form-group">
          <label class="form-label" for="prefix"
            >คำนำหน้า <span class="text-red-500">*</span></label
          >
          <select
            id="prefix"
            class="form-select"
            [(ngModel)]="prefix"
            (ngModelChange)="validateForm()"
          >
            <option value="">เลือกคำนำหน้า</option>
            <option value="นาย">นาย</option>
            <option value="นาง">นาง</option>
            <option value="นางสาว">นางสาว</option>
            <option value="เด็กชาย">เด็กชาย</option>
            <option value="เด็กหญิง">เด็กหญิง</option>
          </select>
          <div *ngIf="errors.prefix" class="error-message">
            {{ errors.prefix }}
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="firstName"
            >ชื่อ <span class="text-red-500">*</span></label
          >
          <input
            id="firstName"
            type="text"
            class="form-input"
            [(ngModel)]="firstName"
            (ngModelChange)="validateForm()"
            placeholder="กรอกชื่อ"
            maxlength="50"
          />
          <div *ngIf="errors.firstName" class="error-message">
            {{ errors.firstName }}
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="lastName"
            >นามสกุล <span class="text-red-500">*</span></label
          >
          <input
            id="lastName"
            type="text"
            class="form-input"
            [(ngModel)]="lastName"
            (ngModelChange)="validateForm()"
            placeholder="กรอกนามสกุล"
            maxlength="50"
          />
          <div *ngIf="errors.lastName" class="error-message">
            {{ errors.lastName }}
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="studentNumber"
            >รหัสนักศึกษา/เลขบัตรประชาชน
            <span class="text-red-500">*</span></label
          >
          <input
            id="studentNumber"
            type="text"
            class="form-input"
            [(ngModel)]="studentNumber"
            (ngModelChange)="validateForm()"
            placeholder="กรอกรหัสนักศึกษาหรือเลขบัตรประชาชน"
            maxlength="13"
          />
          <div *ngIf="errors.studentNumber" class="error-message">
            {{ errors.studentNumber }}
          </div>
        </div>

        <div class="button-group">
          <button type="button" class="btn btn-secondary" (click)="close()">
            ปิดหน้าต่าง
          </button>
          <button
            type="button"
            class="btn btn-primary"
            (click)="saveAndNext()"
            [disabled]="!isValid"
          >
            ถัดไป
          </button>
        </div>
      </div>
    </ion-content>
  `,
})
export class UserDataFormComponent
  extends BaseFlowController
  implements OnInit
{
  @Input() override data: Record<string, any> = {};

  // Form fields
  prefix = "";
  firstName = "";
  lastName = "";
  studentNumber = "";

  // Validation errors
  errors: {
    prefix?: string;
    firstName?: string;
    lastName?: string;
    studentNumber?: string;
  } = {};

  // Form validation state
  isValid = false;

  override ngOnInit() {
    // Load existing data from context
    this.loadExistingData();
    this.validateForm();
  }

  /**
   * Load existing data from context
   */
  private loadExistingData(): void {
    const ctx = this.executionContext() as any;
    if (ctx?.user) {
      const user = ctx.user;

      // Parse name if it exists (รูปแบบ: "คำนำหน้า ชื่อ นามสกุล")
      if (user.name) {
        const nameParts = user.name.trim().split(" ");
        if (nameParts.length >= 3) {
          this.prefix = nameParts[0];
          this.firstName = nameParts[1];
          this.lastName = nameParts.slice(2).join(" ");
        } else if (nameParts.length === 2) {
          this.firstName = nameParts[0];
          this.lastName = nameParts[1];
        } else {
          this.firstName = user.name;
        }
      }

      // Load student_number
      this.studentNumber = user.student_number || "";
    }
  }

  /**
   * Validate form fields
   */
  validateForm(): void {
    const newErrors: typeof this.errors = {};

    // Validate prefix
    if (!this.prefix) {
      newErrors.prefix = "กรุณาเลือกคำนำหน้า";
    }

    // Validate first name
    if (!this.firstName || this.firstName.trim().length === 0) {
      newErrors.firstName = "กรุณากรอกชื่อ";
    } else if (this.firstName.trim().length < 2) {
      newErrors.firstName = "ชื่อต้องมีอย่างน้อย 2 ตัวอักษร";
    }

    // Validate last name
    if (!this.lastName || this.lastName.trim().length === 0) {
      newErrors.lastName = "กรุณากรอกนามสกุล";
    } else if (this.lastName.trim().length < 2) {
      newErrors.lastName = "นามสกุลต้องมีอย่างน้อย 2 ตัวอักษร";
    }

    // Validate student_number (required, ไม่น้อยกว่า 6 หลัก)
    if (!this.studentNumber || this.studentNumber.trim().length === 0) {
      newErrors.studentNumber = "กรุณากรอกรหัสนักศึกษาหรือเลขบัตรประชาชน";
    } else {
      const cleanNumber = this.studentNumber.replace(/[^0-9]/g, "");
      if (cleanNumber.length < 6) {
        newErrors.studentNumber = "ต้องมีอย่างน้อย 6 หลัก";
      }
    }

    this.errors = newErrors;
    this.isValid = Object.keys(newErrors).length === 0;
  }

  /**
   * Save data and proceed to next step
   */
  async saveAndNext(): Promise<void> {
    if (!this.isValid) {
      return;
    }

    try {
      const ctx = this.executionContext() as any;
      const fullName = `${
        this.prefix
      } ${this.firstName.trim()} ${this.lastName.trim()}`;

      const userData = {
        name: fullName,
        student_number: this.studentNumber.trim(),
        register_type: ctx?.user?.register_type || "WALK_IN",
        id_card_base64: ctx?.user?.id_card_base64 || "",
      };

      // Update context
      const updatedCtx = RegistryContextHelper.updateUser(ctx, userData);

      // Proceed to next step
      await this.next(updatedCtx);
    } catch (error) {
      console.error("Error in saveAndNext:", error);
      alert("เกิดข้อผิดพลาดในการบันทึกข้อมูล กรุณาลองใหม่อีกครั้ง");
    }
  }

  /**
   * Close subflow and return to summary
   */
  async close(): Promise<void> {
    try {
      await this.closeSubflow({ cancelled: true });
    } catch (error) {
      console.error("Error closing subflow:", error);
    }
  }
}
