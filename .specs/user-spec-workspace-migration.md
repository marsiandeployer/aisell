# User Specification: Migrate User Workspaces to Project Directory

**Version:** 1.0
**Date:** 2026-02-25
**Status:** Ready for Implementation
**Priority:** Medium
**Estimated Effort:** 2-4 hours

---

## 1. Executive Summary

### Problem Statement
Currently, user workspaces are scattered outside the project directory:
- User workspaces: `/root/aisell/botplatform/group_data/user_{id}/`
- Group workspaces: `/root/aisell/noxonbot/group_data/{chat_id}/` (partially migrated)

This violates the principle: **"Все skills и данные собраны в подпапках ~/aisell, а не разбросаны по серверу"**

### Solution
Migrate all user and group workspaces to unified location: `/root/aisell/botplatform/group_data/`

### Goals
- ✅ Consolidate all project data within `/root/aisell/`
- ✅ Unify user and group workspace structure
- ✅ Maintain functionality (static hosting, bwrap isolation, workspace creation)
- ✅ Clean up legacy paths and backup files

---

## 2. Technical Approach

### Architecture Change

**Before:**
```
/root/
├── aisellusers/              # ❌ Outside project
│   ├── user_9000000000001/
│   └── user_9000000000002/
└── aisell/
    ├── noxonbot/
    │   └── group_data/        # ❌ Old path (noxonbot)
    │       └── -1234567890/
    └── botplatform/
```

**After:**
```
/root/aisell/botplatform/
└── group_data/                # ✅ Unified workspace directory
    ├── user_9000000000001/    # User workspaces
    ├── user_9000000000002/
    └── -1234567890/           # Group workspaces
```

### Migration Strategy

**Hard Cutover** (acceptable for dev server):
1. Stop all services
2. Move data to new location
3. Update all code references
4. Update nginx configuration
5. Restart services
6. Verify functionality

**No backward compatibility** - clean break from old paths.

---

## 3. Implementation Checklist

### Phase 1: Pre-Migration Preparation

- [ ] **Verify disk space**
  ```bash
  du -sh /root/aisell/botplatform/group_data/
  df -h /root/aisell/
  ```

- [ ] **Create target directory**
  ```bash
  mkdir -p /root/aisell/botplatform/group_data
  chmod 755 /root/aisell/botplatform/group_data
  ```

- [ ] **Identify all files to update**
  ```bash
  grep -r "/root/aisell/botplatform/group_data" /root/aisell/ --exclude-dir=node_modules
  ```

### Phase 2: Service Shutdown

- [ ] **Stop PM2 processes on application server (95.217.227.164)**
  ```bash
  pm2 stop all
  pm2 list  # Verify all stopped
  ```

### Phase 3: Data Migration

- [ ] **Move user workspaces**
  ```bash
  # Move all user folders
  mv /root/aisell/botplatform/group_data/user_* /root/aisell/botplatform/group_data/

  # Verify count
  ls /root/aisell/botplatform/group_data/ | grep "^user_" | wc -l  # Should be 122+
  ```

- [ ] **Move legacy group workspaces (if any)**
  ```bash
  # Check for old noxonbot groups
  if [ -d /root/aisell/noxonbot/group_data ]; then
    mv /root/aisell/noxonbot/group_data/* /root/aisell/botplatform/group_data/ 2>/dev/null || true
  fi
  ```

- [ ] **Verify permissions preserved**
  ```bash
  # User dirs should be 0o700
  find /root/aisell/botplatform/group_data/user_* -maxdepth 0 -type d -exec stat -c "%a %n" {} \;

  # CLAUDE.md should be 0o600
  find /root/aisell/botplatform/group_data/user_*/CLAUDE.md -type f -exec stat -c "%a %n" {} \;
  ```

- [ ] **Remove old directory structure**
  ```bash
  rm -rf /root/aisell/botplatform/group_data/
  ```

### Phase 4: Code Changes

#### File: `/root/aisell/botplatform/src/bot.ts`

**Changes Required:** 11 occurrences

- [ ] **Add path constant at top of file (after imports, ~line 20)**
  ```typescript
  // CHANGE: Unified workspace directory for users and groups
  // WHY: Keep all project data within /root/aisell/ (not scattered across server)
  // REF: User request "Все skills и данные собраны в подпапках ~/aisell"
  const WORKSPACES_ROOT = '/root/aisell/botplatform/group_data';
  ```

- [ ] **Update all 11 occurrences** - Replace `/root/aisell/botplatform/group_data` with `${WORKSPACES_ROOT}`

#### File: `/root/aisell/botplatform/src/webchat.ts`

**Changes Required:** 9 occurrences

- [ ] **Add same constant at top**
  ```typescript
  const WORKSPACES_ROOT = '/root/aisell/botplatform/group_data';
  ```

- [ ] **Update all 9 occurrences** - Replace `/root/aisell/botplatform/group_data` with `${WORKSPACES_ROOT}`

#### Delete Backup Files

- [ ] **Remove obsolete backup files**
  ```bash
  rm -f /root/aisell/botplatform/src/webchat.ts.orig
  rm -f /root/aisell/botplatform/src/webchat.ts.backup
  ```

### Phase 5: Documentation Updates

- [ ] **Update all documentation**
  ```bash
  find /root/aisell -name "*.md" -type f -exec sed -i 's|/root/aisell/botplatform/group_data|/root/aisell/botplatform/group_data|g' {} \;
  find /root/aisell/botplatform/tests -type f -exec sed -i 's|/root/aisell/botplatform/group_data|/root/aisell/botplatform/group_data|g' {} \;
  ```

### Phase 6: Nginx Configuration

**Server:** Reverse Proxy (62.109.14.209)
**File:** `/etc/nginx/sites-available/habab.ru`

- [ ] **Update user domain configuration**

  **Change:**
  ```nginx
  # OLD
  root /root/aisell/botplatform/group_data/user_$userid;

  # NEW
  root /root/aisell/botplatform/group_data/user_$userid;
  ```

- [ ] **Test and reload**
  ```bash
  nginx -t && systemctl reload nginx
  ```

### Phase 7: Service Restart

- [ ] **Compile and restart**
  ```bash
  cd /root/aisell/botplatform
  npm run build
  pm2 restart ecosystem.config.js --update-env
  ```

### Phase 8: Testing & Verification

- [ ] **Test 1:** New user onboarding creates workspace in new location
- [ ] **Test 2:** Existing users can access files
- [ ] **Test 3:** Static hosting works (check domains)
- [ ] **Test 4:** Dashboard generation works
- [ ] **Test 5:** Claude CLI executes in correct workspace
- [ ] **Test 6:** Group chats work

### Phase 9: Cleanup

- [ ] **Verify old path removed**
  ```bash
  ls /root/aisell/botplatform/group_data/  # Should error
  ```

- [ ] **Check for remaining references**
  ```bash
  grep -r "aisellusers" /root/aisell/botplatform/src/
  ```

---

## 4. Success Criteria

✅ All workspaces in `/root/aisell/botplatform/group_data/`
✅ No `/root/aisell/botplatform/group_data/` references in code
✅ Backup files deleted
✅ Documentation updated
✅ New users create workspace in new location
✅ Static hosting works
✅ Claude CLI executes correctly

---

## 5. Quick Reference Commands

```bash
# Pre-check
du -sh /root/aisell/botplatform/group_data/ && df -h /root/aisell/

# Migration
pm2 stop all
mkdir -p /root/aisell/botplatform/group_data
mv /root/aisell/botplatform/group_data/user_* /root/aisell/botplatform/group_data/
rm -rf /root/aisell/botplatform/group_data/

# Code updates (do manually in bot.ts and webchat.ts)
# Add: const WORKSPACES_ROOT = '/root/aisell/botplatform/group_data';
# Replace all /root/aisell/botplatform/group_data with ${WORKSPACES_ROOT}

# Restart
cd /root/aisell/botplatform && npm run build
pm2 restart ecosystem.config.js --update-env

# Verify
ls -la /root/aisell/botplatform/group_data/
pm2 logs --lines 50 --nostream
```
