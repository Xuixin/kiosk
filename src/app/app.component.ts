import { Component } from "@angular/core";
import { RouterOutlet } from "@angular/router";

import "zone.js/plugins/zone-patch-rxjs";
@Component({
  selector: "app-root",
  standalone: false,
  templateUrl: "app.component.html",
  styleUrls: ["app.component.scss"],
})
export class AppComponent {
  constructor() {}
}
