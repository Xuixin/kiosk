import { CommonModule } from "@angular/common";
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  Input,
  OnDestroy,
  OnInit,
  signal,
} from "@angular/core";
import { IonicModule } from "@ionic/angular";

import { BaseFlowController } from "../../../base-flow-controller.component";
import { RegistryContextHelper } from "../../../helpers/registry-context.helper";
import { RegistryService } from "../../../services/registry.service";

@Component({
  selector: "app-registry-walkin-summary",
  standalone: true,
  imports: [CommonModule, IonicModule],
  styles: [
    `
      ion-button.back-button {
        --background: transparent;
        --color: #2196f3;
        --border-width: 2px;
        --border-color: #2196f3;
        --border-style: solid;
        --padding-start: 2rem;
        --padding-end: 2rem;
        font-size: 1rem;
        height: 3rem;
      }

      ion-button.submit-button {
        --background: #2196f3;
        --padding-start: 2rem;
        --padding-end: 2rem;
        font-size: 1rem;
        height: 3rem;
      }

      ion-button.submit-button[disabled] {
        --background: #ccc;
      }
    `,
  ],
  templateUrl: "./registry-walkin-summary.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RegistryWalkinSummaryComponent
  extends BaseFlowController
  implements OnInit, AfterViewInit, OnDestroy
{
  @Input() override data: Record<string, any> = {};

  currentDateTime: string = "";
  isInitialLoad: boolean = true;

  // Services
  private registryService = inject(RegistryService);

  // Cache for Object URLs with Blob tracking
  private cachedUrls = new Map<string, { url: string; blob: Blob }>();
  private currentImageUrl = "";
  private lastContextHash = "";

  constructor() {
    super();
    this.updateDateTime();
    setInterval(() => this.updateDateTime(), 1000);

    // Use effect to watch context changes efficiently
    effect(() => {
      const ctx = this.executionContext();
      console.log("[RegistrySummary] Effect triggered - Context changed:", {
        ctx,
      });

      if (ctx) {
        this.updateImageUrl();
      }
    });
  }

  updateDateTime() {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, "0");
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const year = now.getFullYear();
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    this.currentDateTime = `${day}/${month}/${year} ${hours}:${minutes}`;
  }

  override ngOnInit() {
    // เรียกเปิด data collection subflow อัตโนมัติเมื่อเข้ามาครั้งแรก
    if (this.isInitialLoad) {
      this.startDataCollection();
    }

    // Initialize image URL
    this.updateImageUrl();
  }

  async ngAfterViewInit() {
    // Summary is the MAIN page - always visible
  }

  // Get context as RegistryContext
  get registryContext() {
    return this.executionContext() as any;
  }

  // Computed properties to check completion status
  hasIdCard(): boolean {
    return RegistryContextHelper.hasIdCard(this.registryContext);
  }

  hasUserData(): boolean {
    return RegistryContextHelper.hasUserData(this.registryContext);
  }

  hasDoorPermission(): boolean {
    return RegistryContextHelper.hasDoorPermission(this.registryContext);
  }

  isComplete(): boolean {
    return RegistryContextHelper.isComplete(this.registryContext);
  }

  getDoorNames(): string[] {
    return RegistryContextHelper.getDoorNames(this.registryContext);
  }

  /**
   * Update image URL when context changes (with change detection)
   */
  private updateImageUrl(): void {
    // Create a simple hash of the context to detect changes
    const contextHash = this.registryContext?.user?.id_card_base64 || "";

    console.log("[RegistrySummary] updateImageUrl called:", {
      lastHash: this.lastContextHash,
      currentHash: contextHash,
      hasChanged: this.lastContextHash !== contextHash,
      hasIdCard: !!this.registryContext?.user?.id_card_base64,
    });

    // Only update if context actually changed
    if (this.lastContextHash === contextHash) {
      console.log("[RegistrySummary] No change detected, skipping update");
      return;
    }

    console.log("[RegistrySummary] Context changed, updating image URL");
    this.lastContextHash = contextHash;

    const file = RegistryContextHelper.getFileByCategory(
      this.registryContext,
      "id-card"
    );

    if (!file?.file_blob) {
      console.log("[RegistrySummary] No file blob, clearing image URL");
      this.revokeUrl("id-card");
      this.currentImageUrl = "";
      return;
    }

    console.log("[RegistrySummary] Creating new image URL from blob");
    this.currentImageUrl = this.getOrCreateUrl("id-card", file.file_blob);
  }

  /**
   * Get current image URL (stable reference)
   */
  getIdCardImage(): string {
    return this.currentImageUrl;
  }

  /**
   * Get or create cached Object URL (with Blob change detection)
   */
  private getOrCreateUrl(key: string, blob: Blob): string {
    const cached = this.cachedUrls.get(key);

    console.log("[RegistrySummary] getOrCreateUrl called:", {
      key,
      hasCached: !!cached,
      blobSize: blob.size,
      blobType: blob.type,
    });

    // ถ้า Blob เปลี่ยน ต้อง revoke URL เดิมและสร้างใหม่
    if (cached && cached.blob !== blob) {
      console.log("[RegistrySummary] Blob changed, revoking old URL");
      URL.revokeObjectURL(cached.url);
      this.cachedUrls.delete(key);
    }

    // สร้าง URL ใหม่ถ้ายังไม่มี หรือ Blob เปลี่ยน
    if (!this.cachedUrls.has(key)) {
      console.log("[RegistrySummary] Creating new Object URL");
      const url = URL.createObjectURL(blob);
      this.cachedUrls.set(key, { url, blob });
    } else {
      console.log("[RegistrySummary] Using cached URL");
    }

    return this.cachedUrls.get(key)!.url;
  }

  /**
   * Revoke cached URL
   */
  private revokeUrl(key: string): void {
    const cached = this.cachedUrls.get(key);
    if (cached) {
      URL.revokeObjectURL(cached.url);
      this.cachedUrls.delete(key);
    }
  }

  /**
   * Cleanup all URLs on destroy
   */
  override ngOnDestroy() {
    super.ngOnDestroy();
    this.cachedUrls.forEach((cached) => URL.revokeObjectURL(cached.url));
    this.cachedUrls.clear();
  }

  /**
   * Method 1: เริ่มต้น data collection subflow (ใช้เมื่อ init)
   */
  async startDataCollection(): Promise<void> {
    try {
      this.isInitialLoad = false;
      await this.startSubflow("dataCollectionSubflow", this.executionContext());
    } catch (error) {
      console.error("[RegistrySummary] Error starting subflow:", error);
    }
  }

  /**
   * Method 2: เปิด edit subflow สำหรับแก้ไข step ใดๆ (ใช้เมื่อต้องการแก้ไขข้อมูล)
   */
  async jumpToStep(stepId: string): Promise<void> {
    try {
      // เปิด dataCollectionSubflow แต่เริ่มที่ node ที่ระบุ
      await this.startSubflow(
        "dataCollectionSubflow",
        this.executionContext(),
        stepId // ← ส่ง startNodeId
      );
    } catch (error) {
      console.error(
        `[RegistrySummary] Error jumping to step ${stepId}:`,
        error
      );
    }
  }

  async submitRegistration(): Promise<void> {
    try {
      const ctx = this.registryContext;

      // Show loading state
      const loadingAlert = document.createElement("div");
      loadingAlert.innerHTML = `
        <div style="
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: white;
          padding: 2rem;
          border-radius: 8px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          z-index: 10000;
          text-align: center;
          min-width: 300px;
        ">
          <div style="margin-bottom: 1rem;">
            <div style="
              width: 40px;
              height: 40px;
              border: 4px solid #f3f3f3;
              border-top: 4px solid #2196f3;
              border-radius: 50%;
              animation: spin 1s linear infinite;
              margin: 0 auto;
            "></div>
          </div>
          <div style="font-weight: 500; margin-bottom: 0.5rem;">กำลังบันทึกการลงทะเบียน...</div>
          <div style="font-size: 0.875rem; color: #666;">กรุณารอสักครู่</div>
        </div>
        <style>
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      `;
      document.body.appendChild(loadingAlert);

      // Submit to storage
      const result = await this.registryService.submitRegistration(ctx);

      // Remove loading alert
      document.body.removeChild(loadingAlert);

      if (result.success) {
        // Show success message
        const fullName = result.transaction?.user.name || "ไม่ระบุ";
        alert(
          `✅ บันทึกการลงทะเบียนสำเร็จ!\n\nหมายเลข Ticket: ${result.transaction?.id}\nชื่อ: ${fullName}\nสถานะ: ${result.transaction?.status}`
        );

        // Close workflow
        await this.closeWorkflow();
      } else {
        // Show error message
        alert(
          `❌ เกิดข้อผิดพลาดในการบันทึก:\n\n${result.error}\n\nกรุณาลองใหม่อีกครั้ง`
        );
      }
    } catch (error) {
      console.error("Error in submitRegistration:", error);
      alert(
        `❌ เกิดข้อผิดพลาดที่ไม่คาดคิด:\n\n${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  async cancelAndClose(): Promise<void> {
    if (confirm("คุณต้องการกลับหน้าแรกหรือไม่?")) {
      await this.closeWorkflow();
    }
  }

  /**
   * Debug method to check storage connectivity and show stored data
   */
  async checkStorageStatus(): Promise<void> {
    try {
      const registrations = await this.registryService.getRegistrations();
      const storageReady = this.registryService.isStorageReady();

      alert(
        `📊 Storage Status:\n\nTotal Registrations: ${
          registrations.length
        }\nStorage Ready: ${storageReady ? "Yes" : "No"}`
      );
    } catch (error) {
      console.error("Error checking storage status:", error);
      alert(
        `❌ Error checking storage: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }
}
