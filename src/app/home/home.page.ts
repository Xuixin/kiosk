import { Component } from "@angular/core";
import { FlowControllerService } from "../flow-services/flow-controller.service";
import {
  REGISTRY_WALKIN_WORKFLOW,
  REGISTRY_INITIAL_CONTEXT,
} from "../workflow/registry-workflow";

@Component({
  selector: "app-home",
  templateUrl: "home.page.html",
  styleUrls: ["home.page.scss"],
  standalone: false,
})
export class HomePage {
  currentDate = new Date();
  currentTime = new Date();

  constructor(private readonly flowController: FlowControllerService) {
    console.log("HomePage constructor");

    setInterval(() => {
      this.currentTime = new Date();
    }, 60000);
  }

  async startRegistryWorkflow(): Promise<void> {
    console.log("Starting Registry Workflow...");
    await this.flowController.startWorkflow(
      REGISTRY_WALKIN_WORKFLOW,
      undefined,
      REGISTRY_INITIAL_CONTEXT
    );
  }
}
