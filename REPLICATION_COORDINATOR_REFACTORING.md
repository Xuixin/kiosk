# Replication Coordinator Refactoring - สรุปการทำงาน

## ภาพรวม

การรวมการจัดการ replication lifecycle ทั้งหมดไว้ที่ ReplicationCoordinatorService เพื่อป้องกัน duplicate logic และ race conditions

---

## ปัญหาที่พบ

### 1. การจัดการ replication กระจัดกระจาย

- มีหลายที่ที่จัดการ start/stop/switch replication:
  - `ClientHealthService` - เมื่อ network offline/online
  - `ServerHealthService` - เมื่อ server down
  - `AppComponent` - เมื่อ primary recovery
  - `HomePage` - manual start
- Logic ซ้ำซ้อนในการตรวจสอบ server availability
- Race conditions ระหว่าง services

### 2. Circular Dependency

- `ReplicationCoordinatorService` inject `ServerHealthService`
- `ServerHealthService` inject `ReplicationCoordinatorService`
- สร้าง circular dependency error

### 3. Error เมื่อ cancel replication

- Error: `missing value from map ws://localhost:3001/graphql`
- เกิดจากการ cancel replication ที่ยังไม่ได้ start (`wasStarted = false`)

### 4. Duplicate Operations

- Stop replication ถูกเรียกหลายครั้ง
- Check connection หลัง stop แล้ว
- ServerHealthService พยายาม reconnect แม้ว่า replications จะถูก stop แล้ว

### 5. ปุ่ม manual start ไม่แสดง

- `isBothServersDown` ไม่ถูก update เมื่อ replications stopped

---

## การแก้ไข

### 1. สร้าง ReplicationCoordinatorService

**File:** `src/app/core/Database/services/replication-coordinator.service.ts`

เป็น centralized service ที่จัดการ replication lifecycle ทั้งหมด:

#### Methods:

- `handleNetworkOffline()` - Stop all replications เมื่อ network offline
- `handleNetworkOnline()` - Check servers และ start appropriate replications
- `handlePrimaryServerDown()` - Switch to secondary หรือ stop all
- `handleSecondaryServerDown()` - Switch to primary หรือ stop all
- `handleBothServersDown()` - Stop all replications
- `handlePrimaryRecovery()` - Switch from secondary to primary
- `handleManualStart()` - Manual start จาก UI
- `handleAppDestroy()` - Cleanup เมื่อ app destroy

#### Features:

- `_isProcessing` flag - ป้องกัน concurrent operations
- `_replicationsStopped` flag - Track ว่า replications ถูก stop หรือยัง
- `replicationsStopped$` Observable - Emit state changes สำหรับ components
- `isReplicationsStopped()` - Public method สำหรับ check state

---

### 2. Refactor Services

#### ClientHealthService

**File:** `src/app/core/Database/services/client-health.service.ts`

**เปลี่ยนแปลง:**

- ลบ replication control logic ออก
- เรียก `coordinator.handleNetworkOffline()` และ `coordinator.handleNetworkOnline()` แทน
- เก็บเฉพาะ network monitoring logic

#### ServerHealthService

**File:** `src/app/core/Database/services/server-health.service.ts`

**เปลี่ยนแปลง:**

- ลบ replication control logic ออก
- เรียก `coordinator.handlePrimaryServerDown()` และ `coordinator.handleBothServersDown()` แทน
- เพิ่มการตรวจสอบ `isReplicationsStopped()` ก่อน reconnect
- หยุด reconnect เมื่อ both servers down
- เพิ่ม `startMonitoring()` method สำหรับเริ่ม monitoring หลัง manual start

#### AppComponent

**File:** `src/app/app.component.ts`

**เปลี่ยนแปลง:**

- เรียก `coordinator.handlePrimaryRecovery()` แทน `switchToPrimary()` โดยตรง
- เรียก `coordinator.handleAppDestroy()` แทน `stopReplication()` โดยตรง

#### HomePage

**File:** `src/app/home/home.page.ts`

**เปลี่ยนแปลง:**

- ใช้ `toSignal(replicationCoordinator.replicationsStopped$)` สำหรับ `isBothServersDown`
- เรียก `coordinator.handleManualStart()` แทน `startReplicationsManually()` โดยตรง
- เรียก `serverHealth.startMonitoring()` เมื่อ manual start สำเร็จ
- ลบ `checkServerStatus()` method ที่ไม่จำเป็น

---

### 3. แก้ไข Circular Dependency

**ปัญหา:**

```
ReplicationCoordinatorService → ServerHealthService → ReplicationCoordinatorService
```

**การแก้ไข:**

- ลบ `ServerHealthService` injection ออกจาก `ReplicationCoordinatorService`
- `ReplicationCoordinatorService` ไม่ต้องการ `ServerHealthService` โดยตรง

---

### 4. เพิ่มการตรวจสอบ `wasStarted` ก่อน Cancel

**File:** `src/app/core/Database/replication/services/replication-manager.service.ts`

**Methods ที่แก้ไข:**

- `cancelPrimaryReplications()` - ตรวจสอบ `wasStarted` ก่อน cancel
- `cancelSecondaryReplications()` - ตรวจสอบ `wasStarted` ก่อน cancel
- `stopAllReplicationsGracefully()` - ตรวจสอบ `wasStarted` ก่อน cancel
- `stopReplication()` - ตรวจสอบ `wasStarted` ก่อน cancel

**ผลลัพธ์:**

- ป้องกัน error `missing value from map` เมื่อ cancel replication ที่ยังไม่ได้ start
- Logging ชัดเจนขึ้น

---

### 5. ป้องกัน Duplicate Operations

**File:** `src/app/core/Database/services/replication-coordinator.service.ts`

**การแก้ไข:**

- เพิ่ม `_replicationsStopped` flag เพื่อ track state
- ตรวจสอบ flag ก่อนดำเนินการในทุก methods
- Emit state changes ผ่าน `replicationsStopped$` Observable
- Clear flag เมื่อ replications started/switched

**File:** `src/app/core/Database/services/server-health.service.ts`

**การแก้ไข:**

- ตรวจสอบ `isReplicationsStopped()` ก่อน reconnect
- หยุด reconnect เมื่อ both servers down
- Cancel pending reconnect timers

---

### 6. เพิ่ม ServerHealthService.startMonitoring()

**File:** `src/app/core/Database/services/server-health.service.ts`

**Method ใหม่:**

```typescript
public startMonitoring(): void {
  // ตรวจสอบ replication state เพื่อดูว่าใช้ primary หรือ secondary
  // Update isUsingSecondary flag
  // Reset reconnect attempts
  // Connect ไปที่ server ที่ถูกต้อง
}
```

**Usage:**

- เรียกเมื่อ manual start สำเร็จ
- ตรวจสอบ replication state เพื่อ connect ไปที่ server ที่ถูกต้อง

---

## Dependency Flow (หลังแก้ไข)

```
ClientHealthService ──┐
                       ├──> ReplicationCoordinatorService ──> DatabaseService ──> ReplicationManagerService
ServerHealthService ───┘
AppComponent ───────────┐
                       ├──> ReplicationCoordinatorService
HomePage ──────────────┘
```

**ไม่มี circular dependency**

---

## File Structure

```
src/app/core/Database/
├── services/
│   ├── replication-coordinator.service.ts (NEW)
│   ├── client-health.service.ts (REFACTORED)
│   ├── server-health.service.ts (REFACTORED)
│   └── database.service.ts (NO CHANGE - facade only)
├── replication/
│   └── services/
│       └── replication-manager.service.ts (UPDATED - wasStarted check)
└── ...
src/app/
├── app.component.ts (REFACTORED)
└── home/
    └── home.page.ts (REFACTORED)
```

---

## Benefits

### 1. Single Source of Truth

- การตัดสินใจ replication lifecycle อยู่ที่ `ReplicationCoordinatorService` เท่านั้น
- Services อื่นๆ เป็น event emitters/requesters

### 2. ลด Duplicate Logic

- ไม่มีการตรวจสอบ server availability ซ้ำ
- Logic อยู่ที่เดียว ง่ายต่อการ maintain

### 3. ป้องกัน Race Conditions

- `_isProcessing` flag ป้องกัน concurrent operations
- `_replicationsStopped` flag ป้องกัน duplicate stop operations

### 4. Error Prevention

- ตรวจสอบ `wasStarted` ก่อน cancel replication
- ป้องกัน error `missing value from map`

### 5. Better State Management

- `replicationsStopped$` Observable สำหรับ reactive state updates
- Components สามารถ subscribe เพื่อแสดง UI ที่ถูกต้อง

### 6. Cleaner Code

- Separation of concerns ชัดเจน
- Services แต่ละตัวมีหน้าที่เฉพาะ
- ง่ายต่อการ test และ debug

---

## Testing Scenarios

### 1. Network Offline/Online

- ✅ Network offline → Stop all replications
- ✅ Network online → Check servers และ start appropriate replications

### 2. Server Failover

- ✅ Primary down → Switch to secondary (ถ้า available)
- ✅ Secondary down → Switch to primary (ถ้า available)
- ✅ Both down → Stop all replications

### 3. Primary Recovery

- ✅ Primary recovered → Switch from secondary to primary

### 4. Manual Start

- ✅ Manual start → Check servers → Start replications → Start ServerHealth monitoring

### 5. App Destroy

- ✅ App destroy → Stop all replications gracefully

---

## Key Learnings

### 1. Centralized Coordination

- การรวม logic ไว้ที่เดียวทำให้ง่ายต่อการ manage และ debug
- Event-based communication ดีกว่า direct method calls

### 2. State Tracking

- ใช้ flags และ observables เพื่อ track state
- Emit state changes เพื่อให้ components รู้สถานะ

### 3. Graceful Error Handling

- ตรวจสอบ state ก่อนดำเนินการ
- Ignore errors ที่ไม่ critical (เช่น cancel ที่ไม่ได้ start)

### 4. Prevent Duplicate Operations

- ใช้ flags เพื่อป้องกัน duplicate operations
- Check flags ก่อนดำเนินการทุกครั้ง

---

## Migration Checklist

- [x] สร้าง ReplicationCoordinatorService
- [x] Refactor ClientHealthService
- [x] Refactor ServerHealthService
- [x] Refactor AppComponent
- [x] Refactor HomePage
- [x] แก้ไข Circular Dependency
- [x] เพิ่ม wasStarted check
- [x] ป้องกัน duplicate operations
- [x] เพิ่ม ServerHealth monitoring เมื่อ manual start
- [x] Test all scenarios

---

## Next Steps (Optional)

1. **Add Unit Tests**
   - Test ReplicationCoordinatorService methods
   - Test error scenarios

2. **Add Monitoring/Logging**
   - Track replication lifecycle events
   - Monitor performance metrics

3. **Add Retry Logic**
   - Retry failed operations with exponential backoff
   - Max retry attempts configuration

4. **Add Health Check Endpoint**
   - Expose health check API
   - Return replication status

---

## Notes

- ทุกการเปลี่ยนแปลงยังคง backward compatible
- DatabaseService ยังคงเป็น facade ที่ delegate ไปที่ ReplicationManagerService
- ReplicationManagerService ยังคงจัดการ replication states ตามปกติ
- Components อื่นๆ ที่ใช้ DatabaseService ยังทำงานได้ตามปกติ

---

**Created:** 2024
**Last Updated:** 2024
