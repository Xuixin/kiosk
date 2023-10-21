import { Component, computed, effect, signal } from "@angular/core";
import { FlowControllerService } from "../flow-services/flow-controller.service";
import { Flow } from "../types/flow.types";
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
startRegistryWorkflow() {
throw new Error('Method not implemented.');
}
  constructor() {
    console.log("HomePage constructor");
  }
}
