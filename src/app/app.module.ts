import {
  Injector,
  NgModule,
  APP_INITIALIZER,
  CUSTOM_ELEMENTS_SCHEMA,
} from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy } from '@angular/router';
import { HttpClientModule } from '@angular/common/http';

import { IonicModule } from '@ionic/angular';
import {
  IonicRouteStrategy,
  provideIonicAngular,
} from '@ionic/angular/standalone';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';

import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MessageService } from 'primeng/api';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import {
  initDatabase,
  DatabaseService,
} from './core/Database/database.service';
import { AdapterProviderService } from './core/Database/factory';
import { WorkflowPreloadService } from './flow-services/workflow-preload.service';
import Aura from '@primeng/themes/aura';
import { CommonModule } from '@angular/common';
import { ClientEventLoggingService } from './core/monitoring/client-event-logging.service';

@NgModule({
  declarations: [AppComponent],
  imports: [
    BrowserModule,
    IonicModule.forRoot(),
    AppRoutingModule,
    HttpClientModule,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  providers: [
    {
      provide: RouteReuseStrategy,
      useClass: IonicRouteStrategy,
    },
    provideIonicAngular(),
    // * database adapter system
    // AdapterProviderService is providedIn: 'root', but listed here for clarity
    AdapterProviderService,
    // Initialize database using adapter pattern
    // This initializes the database adapter (currently RxDB) with all schemas
    {
      provide: APP_INITIALIZER,
      useFactory: (injector: Injector) => () => initDatabase(injector),
      multi: true,
      deps: [Injector],
    },
    // * client event logging (ensure DB initialized first)
    {
      provide: APP_INITIALIZER,
      useFactory: (injector: Injector, svc: ClientEventLoggingService) => () =>
        (async () => {
          // Wait for DB init (idempotent if already initialized)
          await initDatabase(injector);
          await svc.init();
        })(),
      multi: true,
      deps: [Injector, ClientEventLoggingService],
    },
    // * workflow preload
    {
      provide: APP_INITIALIZER,
      useFactory: (preloadService: WorkflowPreloadService) => () => {
        console.log('🚀 [AppModule] Starting workflow component preload...');
        return preloadService.preloadWorkflowComponents();
      },
      multi: true,
      deps: [WorkflowPreloadService],
    },
    DatabaseService,
    WorkflowPreloadService,
    // * animations
    provideAnimationsAsync(),
    MessageService,
    ConfirmationService,

    // * primeng
    providePrimeNG({
      theme: {
        preset: Aura,
        options: { darkModeSelector: false },
      },
      ripple: true,
      zIndex: {
        modal: 9000, // dialog, sidebar
        overlay: 9500, // dropdown, overlaypanel
        menu: 10000, // overlay menus
        tooltip: 11000, // tooltip
      },
    }),
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
