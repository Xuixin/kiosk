import { Injectable } from '@angular/core';
import { DoorDocument } from 'src/app/core/schema/door.schema';

export interface ReceiptViewModel {
  ticketId: string;
  timestamp: string;
  userName: string;
  doors: { id: string; name: string; status?: string }[];
  offlineDoors: { id: string; name: string; status?: string }[];
}

@Injectable({ providedIn: 'root' })
export class ReceiptService {
  build(ctx: any, doors: DoorDocument[], ticketId: string): ReceiptViewModel {
    const selectedIds: string[] = Array.isArray(ctx?.door_permission)
      ? ctx.door_permission
      : typeof ctx?.door_permission === 'string'
        ? String(ctx.door_permission).split(',').filter(Boolean)
        : [];

    const selectedDoors = doors.filter((d) => selectedIds.includes(d.id));
    const offlineDoors = selectedDoors.filter(
      (d) => (d.status || '').toUpperCase() === 'OFFLINE',
    );

    return {
      ticketId,
      timestamp: this.formatTimestamp(new Date()),
      userName: ctx?.user?.name || '',
      doors: selectedDoors.map((d) => ({
        id: d.id,
        name: d.name,
        status: d.status,
      })),
      offlineDoors: offlineDoors.map((d) => ({
        id: d.id,
        name: d.name,
        status: d.status,
      })),
    };
  }

  private formatTimestamp(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  }
}
