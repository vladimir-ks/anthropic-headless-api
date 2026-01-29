# Claude Authentication Pool - Documentation Index

**Status:** ✅ Complete Specification
**Last Updated:** 2026-01-28
**Location:** `anthropic-headless-api/docs/auth-pool/`

---

## 📚 Documentation Overview

This directory contains the **complete specification** for the Claude Authentication Pool module - an intelligent subscription manager that optimizes usage across multiple Claude Pro accounts.

**Key Achievement:** All implementation logic written in **pseudocode** (~2,800 lines) before any real code.

---

## 📖 Reading Order

### **Start Here: Implementation Plan**
**File:** [`IMPLEMENTATION_PLAN_REFACTORED.md`](IMPLEMENTATION_PLAN_REFACTORED.md)

**Purpose:** High-level overview and project roadmap

**Read this if you want:**
- Executive summary
- Architecture overview
- Implementation phases
- Success criteria

**Length:** ~300 lines (concise, no code blocks)

---

### **Deep Dive: Technical Specifications**

#### 1. **Data Source Research**
**File:** [`ANTHROPIC_USAGE_API_RESEARCH.md`](ANTHROPIC_USAGE_API_RESEARCH.md)

**Purpose:** How we get usage data (costs, tokens, weekly limits)

**Key Finding:** Claude CLI JSON output is the PRIMARY data source (not ccusage, not web scraping)

**Read this if you want:**
- Data source comparison (CLI vs Admin API vs Unofficial Web API)
- Claude CLI JSON structure
- Usage tracking strategy

**Length:** ~400 lines

---

#### 2. **Module Architecture**
**File:** [`MODULE_ARCHITECTURE.md`](MODULE_ARCHITECTURE.md)

**Purpose:** System design and module boundaries

**Contains:**
- High-level flow diagrams
- Module responsibilities
- Integration points
- Data flow sequences

**Read this if you want:**
- System architecture overview
- Module interactions
- Public API contracts (interfaces only, no implementation)

**Length:** ~600 lines

---

#### 3. **Data Models**
**File:** [`DATA_MODELS.md`](DATA_MODELS.md)

**Purpose:** All TypeScript interfaces and data contracts

**Contains:**
- Core entities (Subscription, ClientSession, UsageRecord, BlockInfo)
- Request/Response types
- Event types
- Configuration types
- Validation schemas (Zod)

**Read this if you want:**
- Complete type definitions
- Field descriptions
- Validation rules
- State machines

**Length:** ~550 lines

---

#### 4. **Project Structure**
**File:** [`PROJECT_STRUCTURE.md`](PROJECT_STRUCTURE.md)

**Purpose:** Complete directory tree and file organization

**Contains:**
- Full file tree (40 files)
- File descriptions
- Size estimates
- Code statistics
- File creation order

**Read this if you want:**
- Where each module lives
- What each file does
- Dependency graph
- Build order

**Length:** ~700 lines

---

#### 5. **Pseudocode (CRITICAL)**
**File:** [`PSEUDOCODE.md`](PSEUDOCODE.md)

**Purpose:** **ALL implementation logic** in pseudocode (no real TypeScript)

**Contains:**
- Health Calculator algorithm (~300 lines)
- Subscription Manager logic (~400 lines)
- Usage Tracker implementation (~600 lines)
- Allocation Balancer (~700 lines)
- Session Store (~400 lines)
- Notification Manager (~400 lines)
- Middleware (~200 lines)

**Read this if you want:**
- Complete implementation logic
- Algorithm details
- Edge case handling
- Error scenarios

**Length:** ~2,800 lines ⭐

**IMPORTANT:** This is the ONLY place with actual logic. All other docs reference back to this.

---

#### 6. **Integration Plan**
**File:** [`INTEGRATION_PLAN.md`](INTEGRATION_PLAN.md)

**Purpose:** Step-by-step integration with anthropic-headless-api

**Contains:**
- Exact file modifications (before/after)
- Migration steps
- Configuration changes
- Request flow diagrams
- Rollback plan

**Read this if you want:**
- What needs to change in existing API
- How to migrate
- Backward compatibility strategy

**Length:** ~500 lines

---

#### 7. **Testing Strategy**
**File:** [`TESTING_STRATEGY.md`](TESTING_STRATEGY.md)

**Purpose:** Comprehensive test plan (Unit/Integration/E2E)

**Contains:**
- Unit test cases (~1,000 lines of test pseudocode)
- Integration test scenarios
- E2E test flows
- Manual QA scenarios
- Performance benchmarks

**Read this if you want:**
- Complete test coverage plan
- Test case examples
- QA checklist

**Length:** ~800 lines

---

## 🎯 Quick Start Guide

### For Product Managers

**Read:** `IMPLEMENTATION_PLAN_REFACTORED.md`

**You'll learn:**
- What the auth pool does
- Why it's needed
- High-level architecture
- Implementation timeline

**Time:** 10 minutes

---

### For Architects

**Read:** `MODULE_ARCHITECTURE.md` → `DATA_MODELS.md`

**You'll learn:**
- System design
- Module boundaries
- Data flow
- Integration points

**Time:** 30 minutes

---

### For Developers (Implementing)

**Read order:**
1. `IMPLEMENTATION_PLAN_REFACTORED.md` (overview)
2. `MODULE_ARCHITECTURE.md` (design)
3. `DATA_MODELS.md` (types)
4. `PSEUDOCODE.md` (logic) ⭐
5. `PROJECT_STRUCTURE.md` (file organization)
6. `INTEGRATION_PLAN.md` (how to integrate)
7. `TESTING_STRATEGY.md` (test cases)

**Time:** 2-3 hours (thorough understanding)

---

### For QA Engineers

**Read:** `TESTING_STRATEGY.md`

**You'll learn:**
- Test cases
- Manual QA scenarios
- Edge cases
- Performance benchmarks

**Time:** 45 minutes

---

## 📊 Project Statistics

| Metric | Value |
|--------|-------|
| **Documentation Files** | 7 |
| **Total Doc Lines** | ~5,350 |
| **Pseudocode Lines** | ~2,800 |
| **Test Case Lines** | ~1,800 |
| **Implementation Files** | 40 |
| **Estimated Code Lines** | ~7,775 |

---

## 🔑 Key Design Decisions

### ✅ Decision 1: Claude CLI JSON Output (Primary Data Source)

**Original Plan (PRD v2):** Use ccusage CLI tool

**Problem:**
- 17-20 second latency on first run
- External dependency
- Separate polling required

**Corrected Plan:**
- Use Claude CLI JSON output (already in every response)
- Extract `total_cost_usd`, `usage`, `session_id`
- Real-time tracking (no polling)

**Impact:** Eliminated entire ccusage integration, simplified architecture

**Documented in:** `ANTHROPIC_USAGE_API_RESEARCH.md`

---

### ✅ Decision 2: 5-Hour Blocks (Not 24-Hour Days)

**Anthropic's billing model:**
- 5-hour rolling windows (00:00, 05:00, 10:00, 15:00, 20:00 UTC)
- Usage resets every 5 hours
- Weekly totals tracked separately

**Implementation:**
- Track `currentBlockCost` (resets every 5 hours)
- Track `weeklyUsed` (rolling 7-day window)
- Both values used in health scoring

**Documented in:** `PSEUDOCODE.md` (Usage Tracker)

---

### ✅ Decision 3: Periodic Rebalancing

**User Requirement:** "Even if a subscription has not been exhausted, if there are subscriptions with less usage, the system should transition."

**Implementation:**
- Background job every 5 minutes
- Check cost gap between subscriptions
- If gap > $5: move idle clients
- Max 3 clients moved per cycle

**Documented in:** `PSEUDOCODE.md` (Allocation Balancer)

---

### ✅ Decision 4: Safeguards

**Problem:** Overloading subscriptions can trigger rate limits

**Solution:**
- Max 15 clients per subscription
- 85% weekly budget threshold
- Fresh subscriptions: gradual ramp-up (Day 1: 5, Day 2: 10, Day 3+: 15)
- Fallback to API when all subscriptions exceed thresholds

**Documented in:** `PSEUDOCODE.md` (Allocation Balancer)

---

## 🚀 Implementation Phases

### Phase 1: Foundation (Week 1)
- ✅ Complete specifications (7 documents)
- ⏭️ Write all unit tests (TDD - tests first)

### Phase 2: Core Modules (Week 2)
- ⏭️ Implement storage layer
- ⏭️ Implement core business logic
- ⏭️ Make unit tests pass

### Phase 3: Integration (Week 3)
- ⏭️ Build middleware
- ⏭️ Modify existing API
- ⏭️ Integration tests

### Phase 4: Production Storage (Week 4)
- ⏭️ Cloudflare Durable Objects
- ⏭️ Deploy to Workers
- ⏭️ E2E tests

### Phase 5: Observability (Week 5)
- ⏭️ Monitoring & notifications
- ⏭️ Performance testing
- ⏭️ Security audit

---

## ✅ Completion Checklist

**Documentation (Phase 1):**
- [x] Research complete (ANTHROPIC_USAGE_API_RESEARCH.md)
- [x] Architecture designed (MODULE_ARCHITECTURE.md)
- [x] Data models defined (DATA_MODELS.md)
- [x] Project structure outlined (PROJECT_STRUCTURE.md)
- [x] Pseudocode written (PSEUDOCODE.md - ~2,800 lines)
- [x] Integration plan created (INTEGRATION_PLAN.md)
- [x] Testing strategy documented (TESTING_STRATEGY.md)
- [x] Implementation plan refactored (IMPLEMENTATION_PLAN_REFACTORED.md)

**Implementation (Phase 2-5):**
- [ ] Write all unit tests (TDD)
- [ ] Implement storage layer
- [ ] Implement core modules
- [ ] Build middleware
- [ ] Modify existing API
- [ ] Integration tests
- [ ] Cloudflare Durable Objects
- [ ] E2E tests
- [ ] Monitoring & notifications

---

## 🛠️ Tools & Technologies

**Runtime:**
- Bun (runtime)
- TypeScript (language)
- Cloudflare Workers (deployment)
- Cloudflare Durable Objects (storage)

**Dependencies:**
- Zod (validation)
- YAML (configuration parsing)
- Existing anthropic-headless-api dependencies

**Development:**
- Vitest (testing)
- ESLint + Prettier (linting)
- GitHub Actions (CI/CD)

---

## 📞 Support & Feedback

**Questions?** Review the documentation in reading order (see above)

**Found an issue?** Check the following:
1. Is it addressed in `PSEUDOCODE.md`?
2. Is it covered in `TESTING_STRATEGY.md`?
3. Is it documented in `INTEGRATION_PLAN.md`?

**Still need help?** Create an issue with:
- Which document you reviewed
- What you're trying to understand
- Specific question or concern

---

## 🎓 Learning Path

**Beginner (No prior knowledge):**
1. Read `IMPLEMENTATION_PLAN_REFACTORED.md` (10 min)
2. Read `MODULE_ARCHITECTURE.md` (20 min)
3. Skim `PSEUDOCODE.md` for one module (15 min)

**Intermediate (Some context):**
1. Read `IMPLEMENTATION_PLAN_REFACTORED.md` (10 min)
2. Deep dive `MODULE_ARCHITECTURE.md` + `DATA_MODELS.md` (45 min)
3. Review `PSEUDOCODE.md` for modules you'll implement (1 hour)

**Advanced (Ready to implement):**
1. Review all 7 documents (2-3 hours)
2. Study `PSEUDOCODE.md` thoroughly (1 hour)
3. Review `TESTING_STRATEGY.md` test cases (30 min)

---

## 📝 Document Changelog

**2026-01-28:**
- Initial documentation complete (all 7 files)
- Phase 1 (Foundation) complete
- Ready for Phase 2 (Implementation)

---

**Status:** ✅ **SPECIFICATION COMPLETE - READY FOR IMPLEMENTATION**

**Next Action:** Begin Phase 2 - Write unit tests (TDD)
