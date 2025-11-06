# Refactor Replication Start/Stop to Single Entry Points

## Overview

Add state checking to existing replication methods to prevent duplicate calls. Remove ServerHealthService dependency from replication code and handle WebSocket disconnects directly in replication-helper.ts.

## Current Problem

Multiple entry points cause duplicate calls:

- ServerHealthService -> handlePrimaryServerDown() -> stop
- ClientHealthService -> handleNetworkOffline() -> stop again
- initializeReplications() -> auto-start
- handleNetworkOnline() -> start again

## Solution

Add centralized state checking to existing methods without changing their signatures. This allows gradual migration while preventing duplicate calls.

## Implementation Steps

### 1. ReplicationManagerService - Add State Checking to Existing Methods

**File**: `src/app/core/Database/replication/services/replication-manager.service.ts`

- State tracking already exists: `_isStarted`, `_currentServerType`
- Add state checking to `startPrimary()`:
  - Check if `_isStarted && _currentServerType === 'primary'` - return early
  - Set `_isStarted = true`, `_currentServerType = 'primary'` before calling internal method
  - Update state after successful start

- Add state checking to `startSecondary()`:
  - Check if `_isStarted && _currentServerType === 'secondary'` - return early
  - Set `_isStarted = true`, `_currentServerType = 'secondary'` before calling internal method
  - Update state after successful start

- Add state checking to `switchToPrimary()`:
  - Check if `_isStarted && _currentServerType === 'primary'` - return early
  - Update state: `_isStarted = true`, `_currentServerType = 'primary'`
  - Keep existing switch logic

- Add state checking to `switchToSecondary()`:
  - Check if `_isStarted && _currentServerType === 'secondary'` - return early
  - Update state: `_isStarted = true`, `_currentServerType = 'secondary'`
  - Keep existing switch logic

- Add state checking to `stopReplication()`:
  - Check if `!_isStarted` - return early
  - Set `_isStarted = false`, `_currentServerType = null` after stopping
  - Keep existing stop logic

- Add state checking to `stopAllReplicationsGracefully()`:
  - Check if `!_isStarted` - return early
  - Set `_isStarted = false`, `_currentServerType = null` after stopping
  - Keep existing stop logic

### 2. ReplicationManagerService - Update initializeReplications State

**File**: `src/app/core/Database/replication/services/replication-manager.service.ts`

- After auto-start logic determines which server to use:
  - If primary auto-started: set `_isStarted = true`, `_currentServerType = 'primary'`
  - If secondary auto-started: set `_isStarted = true`, `_currentServerType = 'secondary'`
  - If offline (no auto-start): set `_isStarted = false`, `_currentServerType = null`

### 3. ReplicationHelper - Add WebSocket Event Handlers

**File**: `src/app/core/Database/replication/services/replication-helper.ts`

- Add `ReplicationCoordinatorService` as optional parameter to `setupCollectionReplication()`
- After creating replication, try to access WebSocket and add handlers:
  - Access via `(replication as any).graphQLState?.websocketByUrl` Map
  - Monitor Map.set() to catch new WebSocket connections
  - Add `onclose` handler:
    - Check if `event.code === 1006` (abnormal closure)
    - Determine server type from `config.replicationIdentifier`
    - If primary: call `replicationCoordinator?.handlePrimaryServerDown()` using `queueMicrotask`
    - If secondary: call `replicationCoordinator?.handleSecondaryServerDown()` using `queueMicrotask`
  - Keep existing error$ subscription

### 4. ReplicationManagerService - Pass Coordinator to Helper

**File**: `src/app/core/Database/replication/services/replication-manager.service.ts`

- Lazy inject `ReplicationCoordinatorService` in `initializeReplications()`
- Pass coordinator to `setupCollectionReplication()` calls
- Use injector pattern to avoid circular dependency

### 5. ReplicationCoordinatorService - Use State from Manager

**File**: `src/app/core/Database/services/replication-coordinator.service.ts`

- Update methods to check ReplicationManagerService state before calling:
  - `handleNetworkOffline()`: Check `replicationManager.isStarted()` - if false, return early
  - `handleNetworkOnline()`: Check `replicationManager.isStarted()` and `getCurrentServerType()` - if already started, return early
  - `handlePrimaryServerDown()`: Check `replicationManager.getCurrentServerType()` - if already 'secondary', return early
  - `handleSecondaryServerDown()`: Check `replicationManager.getCurrentServerType()` - if already 'primary', return early
  - `handleBothServersDown()`: Check `replicationManager.isStarted()` - if false, return early
  - `handlePrimaryRecovery()`: Check `replicationManager.getCurrentServerType()` - if already 'primary', return early

### 6. ServerHealthService - Remove Redundant Calls

**File**: `src/app/core/Database/services/server-health.service.ts`

- Keep ServerHealthService for monitoring (as per notes)
- WebSocket disconnect handling is now in replication-helper.ts
- ServerHealthService can still call coordinator, but coordinator will check state

## Files to Modify

1. `src/app/core/Database/replication/services/replication-manager.service.ts` - add state checking to existing methods
2. `src/app/core/Database/replication/services/replication-helper.ts` - add WebSocket handlers
3. `src/app/core/Database/services/replication-coordinator.service.ts` - add state checks before operations

## Notes

- ServerHealthService remains in app.component.ts, home.page.ts, status.component.ts for monitoring - these are not changed
- WebSocket disconnect handling is now in replication-helper.ts WebSocket closed event handler
- State tracking prevents duplicate start/stop calls
- Existing method signatures are preserved - only internal state checking is added
- Auto-start logic in initializeReplications() is kept as-is

### To-dos

- [ ] Add state checking to startPrimary() in ReplicationManagerService
- [ ] Add state checking to startSecondary() in ReplicationManagerService
- [ ] Add state checking to switchToPrimary() in ReplicationManagerService
- [ ] Add state checking to switchToSecondary() in ReplicationManagerService
- [ ] Add state checking to stopReplication() in ReplicationManagerService
- [ ] Add state checking to stopAllReplicationsGracefully() in ReplicationManagerService
- [ ] Update initializeReplications() to set state after auto-start
- [ ] Add WebSocket event handlers in replication-helper.ts setupCollectionReplication()
- [ ] Pass ReplicationCoordinatorService to setupCollectionReplication() in initializeReplications()
- [ ] Add state checks in ReplicationCoordinatorService methods before calling databaseService
