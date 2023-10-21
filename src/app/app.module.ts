import { Injector, NgModule, APP_INITIALIZER } from "@angular/core";
import { BrowserModule } from "@angular/platform-browser";
import { RouteReuseStrategy } from "@angular/router";

import { IonicModule, IonicRouteStrategy } from "@ionic/angular";

import { AppComponent } from "./app.component";
import { AppRoutingModule } from "./app-routing.module";

import { provideAnimationsAsync } from "@angular/platform-browser/animations/async";
import { MessageService } from "primeng/api";
import { ConfirmationService } from "primeng/api";
import { providePrimeNG } from "primeng/config";
import { initDatabase, DatabaseService } from "./core/Database/rxdb.service";

@NgModule({
  declarations: [AppComponent],
  imports: [BrowserModule, IonicModule.forRoot(), AppRoutingModule],
  providers: [
    {
      provide: RouteReuseStrategy,
      useClass: IonicRouteStrategy,
    },
    // * database
    {
      provide: APP_INITIALIZER,
      useFactory: (injector: Injector) => () => initDatabase(injector),
      multi: true,
      deps: [Injector],
    },
    DatabaseService,
    // * animations
    provideAnimationsAsync(),
    MessageService,
    ConfirmationService,

    // * primeng
    providePrimeNG({
      theme: {
        preset: "aura",
        options: { darkModeSelector: false },
      },
      ripple: true,
    }),
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
