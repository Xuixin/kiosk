import { Injectable } from "@angular/core";
import { NodeComponentRegistryService } from "./node-component-registry.service";

@Injectable({
  providedIn: "root",
})
export class WorkflowPreloadService {
  constructor(private nodeComponentRegistry: NodeComponentRegistryService) {}

  /**
   * Preload all workflow components
   */
  async preloadWorkflowComponents(): Promise<void> {
    try {
      console.log("[WorkflowPreload] Starting component preload...");

      // Preload all registered components
      const componentKeys = [
        "RegistryWalkinSummaryComponent",
        "IdCardCaptureComponent",
        "UserDataFormComponent",
        "DoorPermissionComponent",
      ];

      const preloadPromises = componentKeys.map((key) =>
        this.nodeComponentRegistry
          .get(key)
          .catch((err) =>
            console.warn(`[WorkflowPreload] Failed to preload ${key}:`, err)
          )
      );

      await Promise.all(preloadPromises);

      console.log("[WorkflowPreload] Component preload completed");
    } catch (error) {
      console.error("[WorkflowPreload] Error during preload:", error);
    }
  }

  /**
   * Preload specific component
   */
  async preloadComponent(componentKey: string): Promise<void> {
    try {
      await this.nodeComponentRegistry.get(componentKey);
      console.log(`[WorkflowPreload] Preloaded component: ${componentKey}`);
    } catch (error) {
      console.error(
        `[WorkflowPreload] Failed to preload ${componentKey}:`,
        error
      );
    }
  }
}
