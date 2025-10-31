import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { HomePage } from './home.page';

import { HomePageRoutingModule } from './home-routing.module';

// PrimeNG imports
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ToggleButtonModule } from 'primeng/togglebutton';
import { InputTextModule } from 'primeng/inputtext';

// Replication Monitor Component
import { ReplicationMonitorComponent } from '../core/Database/components/replication-monitor.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    HomePageRoutingModule,
    ButtonModule,
    TagModule,
    ToggleButtonModule,
    InputTextModule,
  ],
  declarations: [HomePage, ReplicationMonitorComponent],
  providers: [],
})
export class HomePageModule {}
