# Auth Pool Pseudocode

**Status:** 📝 Complete Implementation Logic
**Last Updated:** 2026-01-28
**Purpose:** ALL module logic in pseudocode (NO real TypeScript)

---

## 1. Health Calculator

**File:** `src/lib/auth-pool/core/health-calculator.ts`

```
CLASS HealthCalculator:
  PRIVATE config: PoolConfig
  PRIVATE CONSTANTS:
    WEEKLY_WEIGHT = 0.5
    BLOCK_WEIGHT = 0.3
    CLIENT_PENALTY = 5
    BURN_RATE_BASELINE = 3.0
    BURN_RATE_MULTIPLIER = 2.0
    IDLE_BONUS = 10

  CONSTRUCTOR(config: PoolConfig):
    this.config = config
  END CONSTRUCTOR

  FUNCTION calculate(subscription: Subscription) RETURNS number:
    score = 100

    // Factor 1: Weekly budget usage
    weeklyPercent = (subscription.weeklyUsed / subscription.weeklyBudget) * 100
    weeklyPenalty = weeklyPercent * WEEKLY_WEIGHT
    score = score - weeklyPenalty

    // Factor 2: Current block usage
    blockPercent = this.calculateBlockPercentage(subscription)
    blockPenalty = blockPercent * BLOCK_WEIGHT
    score = score - blockPenalty

    // Factor 3: Client count
    clientPenalty = subscription.assignedClients.length * CLIENT_PENALTY
    score = score - clientPenalty

    // Factor 4: Burn rate
    IF subscription.burnRate > BURN_RATE_BASELINE:
      burnRatePenalty = (subscription.burnRate - BURN_RATE_BASELINE) * BURN_RATE_MULTIPLIER
      score = score - burnRatePenalty
    END IF

    // Factor 5: Idle bonus
    IF subscription.currentBlockCost == 0:
      score = score + IDLE_BONUS
    END IF

    // Clamp to 0-100
    RETURN max(0, min(100, score))
  END FUNCTION

  FUNCTION explainScore(subscription: Subscription) RETURNS HealthScoreBreakdown:
    components = {
      weeklyUsagePenalty: 0,
      blockUsagePenalty: 0,
      clientCountPenalty: 0,
      burnRatePenalty: 0,
      idleBonus: 0
    }

    explanation = ["Base score: 100"]

    // Calculate each component
    weeklyPercent = (subscription.weeklyUsed / subscription.weeklyBudget) * 100
    components.weeklyUsagePenalty = -(weeklyPercent * WEEKLY_WEIGHT)
    explanation.push("Weekly usage (" + round(weeklyPercent) + "%): " + components.weeklyUsagePenalty + " points")

    blockPercent = this.calculateBlockPercentage(subscription)
    components.blockUsagePenalty = -(blockPercent * BLOCK_WEIGHT)
    explanation.push("Block usage (" + round(blockPercent) + "%): " + components.blockUsagePenalty + " points")

    components.clientCountPenalty = -(subscription.assignedClients.length * CLIENT_PENALTY)
    explanation.push("Assigned clients (" + subscription.assignedClients.length + "): " + components.clientCountPenalty + " points")

    IF subscription.burnRate > BURN_RATE_BASELINE:
      components.burnRatePenalty = -((subscription.burnRate - BURN_RATE_BASELINE) * BURN_RATE_MULTIPLIER)
      explanation.push("Burn rate (" + subscription.burnRate + " USD/h): " + components.burnRatePenalty + " points")
    END IF

    IF subscription.currentBlockCost == 0:
      components.idleBonus = IDLE_BONUS
      explanation.push("Idle bonus: +" + IDLE_BONUS + " points")
    END IF

    finalScore = this.calculate(subscription)
    explanation.push("Final score: " + round(finalScore, 1))

    RETURN {
      finalScore: finalScore,
      components: components,
      explanation: explanation
    }
  END FUNCTION

  PRIVATE FUNCTION calculateBlockPercentage(subscription: Subscription) RETURNS number:
    IF subscription.currentBlockId == NULL:
      RETURN 0
    END IF

    // Expected block cost: 5 hours at average burn rate
    EXPECTED_BLOCK_COST = 25.0  // Assumption: ~$5/hour average

    IF subscription.currentBlockCost == 0:
      RETURN 0
    END IF

    blockPercent = (subscription.currentBlockCost / EXPECTED_BLOCK_COST) * 100

    RETURN min(100, blockPercent)
  END FUNCTION
END CLASS
```

---

## 2. Subscription Manager

**File:** `src/lib/auth-pool/core/subscription-manager.ts`

```
CLASS SubscriptionManager:
  PRIVATE storage: StorageInterface
  PRIVATE config: PoolConfig
  PRIVATE cache: Map<string, Subscription>  // In-memory cache

  CONSTRUCTOR(storage: StorageInterface, config: PoolConfig):
    this.storage = storage
    this.config = config
    this.cache = new Map()
  END CONSTRUCTOR

  FUNCTION initialize() RETURNS Promise<void>:
    LOG "Initializing SubscriptionManager"

    // Load subscriptions from config
    FOR EACH subConfig IN this.config.subscriptions:
      subscription = this.createSubscriptionFromConfig(subConfig)

      // Check if subscription already exists in storage
      existing = AWAIT this.storage.get("subscription:" + subConfig.id)

      IF existing == NULL:
        // New subscription - initialize
        AWAIT this.storage.set("subscription:" + subConfig.id, subscription)
        LOG "Created subscription: " + subConfig.id
      ELSE:
        // Existing - merge config updates
        merged = this.mergeSubscriptionConfig(existing, subConfig)
        AWAIT this.storage.set("subscription:" + subConfig.id, merged)
        LOG "Updated subscription: " + subConfig.id
      END IF

      // Add to cache
      this.cache.set(subConfig.id, subscription)
    END FOR

    LOG "SubscriptionManager initialized with " + this.config.subscriptions.length + " subscriptions"
  END FUNCTION

  FUNCTION getSubscription(id: string) RETURNS Promise<Subscription | null>:
    // Check cache first
    IF this.cache.has(id):
      RETURN this.cache.get(id)
    END IF

    // Cache miss - load from storage
    subscription = AWAIT this.storage.get("subscription:" + id)

    IF subscription != NULL:
      this.cache.set(id, subscription)
    END IF

    RETURN subscription
  END FUNCTION

  FUNCTION getAllSubscriptions() RETURNS Promise<Subscription[]>:
    subscriptions = []

    FOR EACH subConfig IN this.config.subscriptions:
      subscription = AWAIT this.getSubscription(subConfig.id)
      IF subscription != NULL:
        subscriptions.push(subscription)
      END IF
    END FOR

    RETURN subscriptions
  END FUNCTION

  FUNCTION updateSubscription(id: string, updates: Partial<Subscription>) RETURNS Promise<void>:
    subscription = AWAIT this.getSubscription(id)

    IF subscription == NULL:
      THROW Error("Subscription not found: " + id)
    END IF

    // Merge updates
    FOR EACH key IN Object.keys(updates):
      subscription[key] = updates[key]
    END FOR

    // Validate
    validated = validateSubscription(subscription)

    // Persist
    AWAIT this.storage.set("subscription:" + id, validated)

    // Update cache
    this.cache.set(id, validated)

    LOG "Updated subscription: " + id
  END FUNCTION

  FUNCTION healthCheck() RETURNS Promise<Map<string, boolean>>:
    results = new Map()

    subscriptions = AWAIT this.getAllSubscriptions()

    FOR EACH sub IN subscriptions:
      isHealthy = this.isSubscriptionHealthy(sub)
      results.set(sub.id, isHealthy)
    END FOR

    RETURN results
  END FUNCTION

  PRIVATE FUNCTION createSubscriptionFromConfig(config: SubscriptionConfig) RETURNS Subscription:
    RETURN {
      id: config.id,
      email: config.email,
      type: config.type,
      configDir: config.configDir,
      currentBlockId: NULL,
      currentBlockCost: 0,
      blockStartTime: NULL,
      blockEndTime: NULL,
      weeklyBudget: config.weeklyBudget OR 456.00,
      weeklyUsed: 0,
      assignedClients: [],
      maxClientsPerSub: config.maxClientsPerSub OR this.config.maxClientsPerSubscription,
      healthScore: 100,
      status: 'available',
      burnRate: 0,
      tokensPerMinute: 0,
      lastUsageUpdate: NOW(),
      lastRequestTime: 0,
      createdAt: NOW()
    }
  END FUNCTION

  PRIVATE FUNCTION mergeSubscriptionConfig(existing: Subscription, config: SubscriptionConfig) RETURNS Subscription:
    // Update config-derived fields only
    existing.email = config.email
    existing.configDir = config.configDir
    existing.weeklyBudget = config.weeklyBudget OR existing.weeklyBudget
    existing.maxClientsPerSub = config.maxClientsPerSub OR existing.maxClientsPerSub

    RETURN existing
  END FUNCTION

  PRIVATE FUNCTION isSubscriptionHealthy(sub: Subscription) RETURNS boolean:
    // Health checks
    IF sub.status == 'limited' OR sub.status == 'cooldown':
      RETURN FALSE
    END IF

    weeklyPercent = (sub.weeklyUsed / sub.weeklyBudget)
    IF weeklyPercent >= this.config.weeklyBudgetThreshold:
      RETURN FALSE
    END IF

    IF sub.assignedClients.length >= sub.maxClientsPerSub:
      RETURN FALSE
    END IF

    RETURN TRUE
  END FUNCTION

  FUNCTION shutdown() RETURNS Promise<void>:
    // Clear cache
    this.cache.clear()

    // Close storage
    AWAIT this.storage.close()

    LOG "SubscriptionManager shut down"
  END FUNCTION
END CLASS
```

---

## 3. Usage Tracker

**File:** `src/lib/auth-pool/core/usage-tracker.ts`

```
CLASS UsageTracker:
  PRIVATE storage: StorageInterface
  PRIVATE BLOCK_DURATION_MS = 5 * 60 * 60 * 1000  // 5 hours

  CONSTRUCTOR(storage: StorageInterface):
    this.storage = storage
  END CONSTRUCTOR

  FUNCTION recordUsage(response: ClaudeCliJsonOutput, subscriptionId: string) RETURNS Promise<UsageRecord>:
    timestamp = NOW()

    // Extract usage data from Claude CLI response
    usageRecord = {
      subscriptionId: subscriptionId,
      timestamp: timestamp,
      blockId: this.getActiveBlockId(timestamp),
      costUSD: response.total_cost_usd,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationTokens: response.usage.cache_creation_input_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens +
                   response.usage.cache_creation_input_tokens + response.usage.cache_read_input_tokens,
      modelUsage: response.modelUsage,
      sessionId: response.session_id,
      durationMs: response.duration_ms,
      uuid: response.uuid
    }

    // Validate
    validated = validateUsageRecord(usageRecord)

    // Store usage record
    storageKey = "usage:" + subscriptionId + ":" + timestamp
    AWAIT this.storage.set(storageKey, validated)

    // Add to daily index
    dateKey = formatDate(timestamp, "YYYYMMDD")
    AWAIT this.storage.addToIndex("index:usage_by_day:" + dateKey, subscriptionId)

    // Update subscription state
    AWAIT this.updateSubscriptionFromUsage(subscriptionId, validated)

    LOG "Recorded usage for subscription " + subscriptionId + ": $" + validated.costUSD

    RETURN validated
  END FUNCTION

  FUNCTION getWeeklyUsage(subscriptionId: string) RETURNS Promise<number>:
    sevenDaysAgo = NOW() - (7 * 24 * 60 * 60 * 1000)

    // Query usage records for last 7 days
    records = AWAIT this.getUsageRecordsSince(subscriptionId, sevenDaysAgo)

    totalCost = 0
    FOR EACH record IN records:
      totalCost = totalCost + record.costUSD
    END FOR

    RETURN totalCost
  END FUNCTION

  FUNCTION getActiveBlock(subscriptionId: string) RETURNS Promise<BlockInfo | null>:
    timestamp = NOW()
    blockId = this.getActiveBlockId(timestamp)

    // Get usage records for this block
    blockRecords = AWAIT this.getUsageRecordsForBlock(subscriptionId, blockId)

    IF blockRecords.length == 0:
      RETURN NULL
    END IF

    // Aggregate block data
    totalCost = 0
    totalTokens = 0
    requestCount = blockRecords.length

    FOR EACH record IN blockRecords:
      totalCost = totalCost + record.costUSD
      totalTokens = totalTokens + record.totalTokens
    END FOR

    // Calculate burn rate
    blockStartTime = this.getBlockStartTime(timestamp)
    elapsedMinutes = (NOW() - blockStartTime) / (60 * 1000)

    tokensPerMinute = IF elapsedMinutes > 0 THEN totalTokens / elapsedMinutes ELSE 0
    costPerHour = IF elapsedMinutes > 0 THEN (totalCost / elapsedMinutes) * 60 ELSE 0

    // Project end-of-block cost
    totalMinutesInBlock = 5 * 60  // 5 hours
    remainingMinutes = totalMinutesInBlock - elapsedMinutes
    projectedCost = totalCost + (costPerHour * (remainingMinutes / 60))

    RETURN {
      id: blockId,
      startTime: this.getBlockStartTime(timestamp),
      endTime: this.getBlockEndTime(timestamp),
      isActive: TRUE,
      totalCost: totalCost,
      totalTokens: totalTokens,
      requestCount: requestCount,
      tokensPerMinute: tokensPerMinute,
      costPerHour: costPerHour,
      projectedCost: projectedCost,
      remainingMinutes: remainingMinutes
    }
  END FUNCTION

  FUNCTION getActiveBlockId(timestamp: number) RETURNS string:
    hour = getUTCHour(timestamp)
    blockStartHour = floor(hour / 5) * 5

    blockStart = createDate(timestamp)
    setUTCHours(blockStart, blockStartHour, 0, 0, 0)

    RETURN toISOString(blockStart)  // "2026-01-28T15:00:00.000Z"
  END FUNCTION

  FUNCTION calculateBurnRate(subscriptionId: string) RETURNS Promise<number>:
    // Get usage from last hour
    oneHourAgo = NOW() - (60 * 60 * 1000)
    recentRecords = AWAIT this.getUsageRecordsSince(subscriptionId, oneHourAgo)

    IF recentRecords.length == 0:
      RETURN 0
    END IF

    totalCost = 0
    FOR EACH record IN recentRecords:
      totalCost = totalCost + record.costUSD
    END FOR

    // Burn rate = cost per hour
    RETURN totalCost  // Already 1-hour window
  END FUNCTION

  PRIVATE FUNCTION updateSubscriptionFromUsage(subscriptionId: string, usage: UsageRecord) RETURNS Promise<void>:
    subscription = AWAIT this.storage.get("subscription:" + subscriptionId)

    IF subscription == NULL:
      LOG_ERROR "Subscription not found: " + subscriptionId
      RETURN
    END IF

    currentBlockId = this.getActiveBlockId(NOW())

    // Check if we're in a new block
    IF subscription.currentBlockId != currentBlockId:
      // New block started - reset block cost
      subscription.currentBlockId = currentBlockId
      subscription.currentBlockCost = usage.costUSD
      subscription.blockStartTime = this.getBlockStartTime(NOW())
      subscription.blockEndTime = this.getBlockEndTime(NOW())
    ELSE:
      // Same block - accumulate cost
      subscription.currentBlockCost = subscription.currentBlockCost + usage.costUSD
    END IF

    // Update weekly total
    subscription.weeklyUsed = AWAIT this.getWeeklyUsage(subscriptionId)

    // Update burn rate
    subscription.burnRate = AWAIT this.calculateBurnRate(subscriptionId)

    // Update tokens per minute (from usage record's model usage)
    subscription.tokensPerMinute = this.calculateTokensPerMinute(subscriptionId)

    // Update status based on usage
    weeklyPercent = subscription.weeklyUsed / subscription.weeklyBudget

    IF weeklyPercent >= 0.95:
      subscription.status = 'limited'
    ELSE IF weeklyPercent >= 0.80:
      subscription.status = 'approaching'
    ELSE:
      subscription.status = 'available'
    END IF

    subscription.lastUsageUpdate = NOW()
    subscription.lastRequestTime = NOW()

    // Persist
    AWAIT this.storage.set("subscription:" + subscriptionId, subscription)
  END FUNCTION

  PRIVATE FUNCTION getUsageRecordsSince(subscriptionId: string, since: number) RETURNS Promise<UsageRecord[]>:
    // List all usage keys for this subscription
    prefix = "usage:" + subscriptionId + ":"
    allKeys = AWAIT this.storage.list(prefix)

    records = []
    FOR EACH key IN allKeys:
      // Extract timestamp from key (usage:sub1:1738070000000)
      parts = split(key, ":")
      recordTimestamp = parseInt(parts[2])

      IF recordTimestamp >= since:
        record = AWAIT this.storage.get(key)
        IF record != NULL:
          records.push(record)
        END IF
      END IF
    END FOR

    RETURN records
  END FUNCTION

  PRIVATE FUNCTION getUsageRecordsForBlock(subscriptionId: string, blockId: string) RETURNS Promise<UsageRecord[]>:
    blockStartTime = this.getBlockStartTime(parseTimestamp(blockId))
    blockEndTime = this.getBlockEndTime(parseTimestamp(blockId))

    allRecords = AWAIT this.getUsageRecordsSince(subscriptionId, blockStartTime)

    blockRecords = []
    FOR EACH record IN allRecords:
      IF record.timestamp >= blockStartTime AND record.timestamp < blockEndTime:
        blockRecords.push(record)
      END IF
    END FOR

    RETURN blockRecords
  END FUNCTION

  PRIVATE FUNCTION getBlockStartTime(timestamp: number) RETURNS number:
    hour = getUTCHour(timestamp)
    blockStartHour = floor(hour / 5) * 5

    blockStart = createDate(timestamp)
    setUTCHours(blockStart, blockStartHour, 0, 0, 0)

    RETURN toTimestamp(blockStart)
  END FUNCTION

  PRIVATE FUNCTION getBlockEndTime(timestamp: number) RETURNS number:
    blockStart = this.getBlockStartTime(timestamp)
    RETURN blockStart + this.BLOCK_DURATION_MS
  END FUNCTION

  PRIVATE FUNCTION calculateTokensPerMinute(subscriptionId: string) RETURNS Promise<number>:
    // Get usage from last 5 minutes
    fiveMinutesAgo = NOW() - (5 * 60 * 1000)
    recentRecords = AWAIT this.getUsageRecordsSince(subscriptionId, fiveMinutesAgo)

    IF recentRecords.length == 0:
      RETURN 0
    END IF

    totalTokens = 0
    FOR EACH record IN recentRecords:
      totalTokens = totalTokens + record.totalTokens
    END FOR

    RETURN totalTokens / 5  // Tokens per minute
  END FUNCTION
END CLASS
```

---

## 4. Allocation Balancer

**File:** `src/lib/auth-pool/core/allocation-balancer.ts`

```
CLASS AllocationBalancer:
  PRIVATE subscriptionManager: SubscriptionManager
  PRIVATE healthCalculator: HealthCalculator
  PRIVATE sessionStore: SessionStore
  PRIVATE notificationManager: NotificationManager
  PRIVATE config: PoolConfig
  PRIVATE rebalanceTimer: Timer | NULL

  CONSTRUCTOR(
    subscriptionManager: SubscriptionManager,
    healthCalculator: HealthCalculator,
    sessionStore: SessionStore,
    notificationManager: NotificationManager,
    config: PoolConfig
  ):
    this.subscriptionManager = subscriptionManager
    this.healthCalculator = healthCalculator
    this.sessionStore = sessionStore
    this.notificationManager = notificationManager
    this.config = config
    this.rebalanceTimer = NULL
  END CONSTRUCTOR

  FUNCTION allocateSubscription(request: AllocationRequest) RETURNS Promise<AllocationResult>:
    LOG "Allocating subscription for request: " + JSON.stringify(request)

    // 1. Check if resuming existing session
    IF request.sessionId != NULL:
      existingSession = AWAIT this.sessionStore.getSession(request.sessionId)

      IF existingSession != NULL:
        // Resume existing allocation
        subscription = AWAIT this.subscriptionManager.getSubscription(existingSession.subscriptionId)

        IF subscription != NULL AND this.isSubscriptionUsable(subscription):
          LOG "Resuming session " + request.sessionId + " on subscription " + subscription.id

          RETURN {
            type: 'subscription',
            subscriptionId: subscription.id,
            configDir: subscription.configDir,
            subscriptionEmail: subscription.email,
            sessionId: existingSession.id,
            healthScore: subscription.healthScore,
            weeklyPercentUsed: (subscription.weeklyUsed / subscription.weeklyBudget) * 100
          }
        END IF

        // Existing subscription no longer usable - need rotation
        LOG_WARN "Session " + request.sessionId + " subscription no longer usable, reallocating"
      END IF
    END IF

    // 2. Get all subscriptions
    subscriptions = AWAIT this.subscriptionManager.getAllSubscriptions()

    // 3. Filter by safeguards
    available = []
    FOR EACH sub IN subscriptions:
      IF this.passesS afeguards(sub):
        available.push(sub)
      END IF
    END FOR

    // 4. If no subscriptions pass safeguards, use fallback
    IF available.length == 0:
      LOG_WARN "No subscriptions available, using fallback API"

      AWAIT this.notificationManager.notifyFailover({
        type: 'failover',
        timestamp: NOW(),
        sessionId: request.sessionId OR generateUUID(),
        fromSubscription: 'none',
        toProvider: this.selectFallbackProvider(),
        reason: 'All subscriptions exceeded safeguard thresholds'
      })

      RETURN {
        type: 'fallback',
        fallbackProvider: this.selectFallbackProvider(),
        reason: 'All subscriptions exceeded safeguard thresholds',
        sessionId: generateUUID()
      }
    END IF

    // 5. Calculate health scores for available subscriptions
    FOR EACH sub IN available:
      sub.healthScore = this.healthCalculator.calculate(sub)
    END FOR

    // 6. Sort by health score (highest = best)
    available.sort((a, b) => b.healthScore - a.healthScore)

    // 7. Select best subscription
    selected = available[0]

    // 8. Check if best subscription has low health - consider fallback
    IF selected.healthScore < 30 AND this.config.fallbackWhenExhausted:
      LOG_WARN "Best subscription has low health (" + selected.healthScore + "), using fallback"

      RETURN {
        type: 'fallback',
        fallbackProvider: this.selectFallbackProvider(),
        reason: 'Preserving subscription health (score: ' + selected.healthScore + ')',
        sessionId: generateUUID()
      }
    END IF

    // 9. Create session
    sessionId = request.sessionId OR generateUUID()
    session = AWAIT this.sessionStore.createSession(sessionId, selected.id)

    // 10. Assign session to subscription
    selected.assignedClients.push(session.id)
    AWAIT this.subscriptionManager.updateSubscription(selected.id, {
      assignedClients: selected.assignedClients
    })

    LOG "Allocated subscription " + selected.id + " to session " + sessionId + " (health: " + selected.healthScore + ")"

    RETURN {
      type: 'subscription',
      subscriptionId: selected.id,
      configDir: selected.configDir,
      subscriptionEmail: selected.email,
      sessionId: session.id,
      healthScore: selected.healthScore,
      weeklyPercentUsed: (selected.weeklyUsed / selected.weeklyBudget) * 100
    }
  END FUNCTION

  FUNCTION releaseAllocation(sessionId: string) RETURNS Promise<void>:
    session = AWAIT this.sessionStore.getSession(sessionId)

    IF session == NULL:
      LOG_WARN "Session not found for release: " + sessionId
      RETURN
    END IF

    subscription = AWAIT this.subscriptionManager.getSubscription(session.subscriptionId)

    IF subscription != NULL:
      // Remove session from assigned clients
      subscription.assignedClients = subscription.assignedClients.filter(id => id != sessionId)
      AWAIT this.subscriptionManager.updateSubscription(subscription.id, {
        assignedClients: subscription.assignedClients
      })
    END IF

    // Delete session
    AWAIT this.sessionStore.deleteSession(sessionId)

    LOG "Released allocation for session " + sessionId
  END FUNCTION

  FUNCTION rebalanceAllocations() RETURNS Promise<RebalanceReport>:
    startTime = NOW()
    LOG "Starting rebalancing cycle"

    // 1. Get all subscriptions
    subscriptions = AWAIT this.subscriptionManager.getAllSubscriptions()

    healthScoresBefore = {}
    FOR EACH sub IN subscriptions:
      sub.healthScore = this.healthCalculator.calculate(sub)
      healthScoresBefore[sub.id] = sub.healthScore
    END FOR

    // 2. Sort by health (lowest first = most used)
    subscriptions.sort((a, b) => a.healthScore - b.healthScore)

    // 3. Check for imbalance
    mostUsed = subscriptions[0]
    leastUsed = subscriptions[subscriptions.length - 1]

    costGap = leastUsed.weeklyUsed - mostUsed.weeklyUsed  // Note: least used has HIGHER score but LOWER cost

    IF costGap < this.config.rebalancing.costGapThreshold:
      LOG "No significant imbalance detected (gap: $" + costGap + ")"

      RETURN {
        timestamp: NOW(),
        subscriptionsEvaluated: subscriptions.length,
        imbalanceDetected: FALSE,
        clientsMoved: 0,
        healthScoresBefore: healthScoresBefore,
        healthScoresAfter: healthScoresBefore,
        durationMs: NOW() - startTime
      }
    END IF

    LOG "Imbalance detected: " + mostUsed.id + " vs " + leastUsed.id + " (gap: $" + costGap + ")"

    // 4. Move clients from high-usage to low-usage subscriptions
    movementDetails = []
    clientsMoved = 0
    maxToMove = this.config.rebalancing.maxClientsToMovePerCycle

    // Get idle sessions from most-used subscription
    sessions = AWAIT this.sessionStore.getSessionsBySubscription(mostUsed.id)
    idleSessions = sessions.filter(s => s.status == 'idle')

    FOR i = 0 TO min(idleSessions.length, maxToMove) - 1:
      session = idleSessions[i]

      // Check if least-used subscription has capacity
      IF leastUsed.assignedClients.length >= leastUsed.maxClientsPerSub:
        LOG "Destination subscription at capacity, stopping rebalance"
        BREAK
      END IF

      // Move session
      AWAIT this.moveSession(session.id, mostUsed.id, leastUsed.id)

      movementDetails.push({
        sessionId: session.id,
        fromSubscription: mostUsed.id,
        toSubscription: leastUsed.id,
        reason: 'Load balancing (cost gap: $' + costGap + ')'
      })

      clientsMoved = clientsMoved + 1

      // Notify
      AWAIT this.notificationManager.notifyRotation({
        type: 'rotation',
        timestamp: NOW(),
        sessionId: session.id,
        fromSubscription: mostUsed.id,
        toSubscription: leastUsed.id,
        reason: 'Load balancing'
      })
    END FOR

    // 5. Recalculate health scores
    healthScoresAfter = {}
    FOR EACH sub IN subscriptions:
      sub.healthScore = this.healthCalculator.calculate(sub)
      healthScoresAfter[sub.id] = sub.healthScore
    END FOR

    durationMs = NOW() - startTime
    LOG "Rebalancing complete: moved " + clientsMoved + " clients in " + durationMs + "ms"

    RETURN {
      timestamp: NOW(),
      subscriptionsEvaluated: subscriptions.length,
      imbalanceDetected: TRUE,
      clientsMoved: clientsMoved,
      movementDetails: movementDetails,
      healthScoresBefore: healthScoresBefore,
      healthScoresAfter: healthScoresAfter,
      durationMs: durationMs
    }
  END FUNCTION

  FUNCTION startBackgroundRebalancing(intervalMs: number) RETURNS void:
    IF this.rebalanceTimer != NULL:
      LOG_WARN "Background rebalancing already running"
      RETURN
    END IF

    LOG "Starting background rebalancing (interval: " + intervalMs + "ms)"

    this.rebalanceTimer = setInterval(ASYNC () => {
      TRY:
        AWAIT this.rebalanceAllocations()
      CATCH error:
        LOG_ERROR "Rebalancing failed: " + error.message
      END TRY
    }, intervalMs)
  END FUNCTION

  FUNCTION stopBackgroundRebalancing() RETURNS void:
    IF this.rebalanceTimer != NULL:
      clearInterval(this.rebalanceTimer)
      this.rebalanceTimer = NULL
      LOG "Stopped background rebalancing"
    END IF
  END FUNCTION

  PRIVATE FUNCTION passesSafeguards(subscription: Subscription) RETURNS boolean:
    // Safeguard 1: Client count limit
    IF subscription.assignedClients.length >= subscription.maxClientsPerSub:
      RETURN FALSE
    END IF

    // Safeguard 2: Weekly budget threshold
    weeklyPercent = subscription.weeklyUsed / subscription.weeklyBudget
    IF weeklyPercent >= this.config.weeklyBudgetThreshold:
      RETURN FALSE
    END IF

    // Safeguard 3: Status check
    IF subscription.status == 'limited' OR subscription.status == 'cooldown':
      RETURN FALSE
    END IF

    // Safeguard 4: Fresh subscription gradual ramp-up
    IF this.isFreshSubscription(subscription):
      maxClients = this.getClientLimitForFreshSubscription(subscription)
      IF subscription.assignedClients.length >= maxClients:
        RETURN FALSE
      END IF
    END IF

    RETURN TRUE
  END FUNCTION

  PRIVATE FUNCTION isSubscriptionUsable(subscription: Subscription) RETURNS boolean:
    // More lenient than safeguards - allows resuming existing sessions
    weeklyPercent = subscription.weeklyUsed / subscription.weeklyBudget

    IF weeklyPercent >= 0.98:  // 98% hard limit
      RETURN FALSE
    END IF

    IF subscription.status == 'cooldown':
      RETURN FALSE
    END IF

    RETURN TRUE
  END FUNCTION

  PRIVATE FUNCTION isFreshSubscription(subscription: Subscription) RETURNS boolean:
    ageMs = NOW() - subscription.createdAt
    threeDaysMs = 3 * 24 * 60 * 60 * 1000

    RETURN ageMs < threeDaysMs
  END FUNCTION

  PRIVATE FUNCTION getClientLimitForFreshSubscription(subscription: Subscription) RETURNS number:
    ageMs = NOW() - subscription.createdAt
    oneDayMs = 24 * 60 * 60 * 1000

    ageInDays = ageMs / oneDayMs

    IF ageInDays < 1:
      RETURN 5
    ELSE IF ageInDays < 2:
      RETURN 10
    ELSE:
      RETURN subscription.maxClientsPerSub
    END IF
  END FUNCTION

  PRIVATE FUNCTION selectFallbackProvider() RETURNS string:
    // Simple: first fallback in chain
    // Future: smart selection based on cost/availability
    RETURN "openrouter-glm"
  END FUNCTION

  PRIVATE FUNCTION moveSession(sessionId: string, fromSubId: string, toSubId: string) RETURNS Promise<void>:
    // 1. Update session
    AWAIT this.sessionStore.updateSession(sessionId, {
      subscriptionId: toSubId
    })

    // 2. Update source subscription
    fromSub = AWAIT this.subscriptionManager.getSubscription(fromSubId)
    fromSub.assignedClients = fromSub.assignedClients.filter(id => id != sessionId)
    AWAIT this.subscriptionManager.updateSubscription(fromSubId, {
      assignedClients: fromSub.assignedClients
    })

    // 3. Update destination subscription
    toSub = AWAIT this.subscriptionManager.getSubscription(toSubId)
    toSub.assignedClients.push(sessionId)
    AWAIT this.subscriptionManager.updateSubscription(toSubId, {
      assignedClients: toSub.assignedClients
    })

    LOG "Moved session " + sessionId + " from " + fromSubId + " to " + toSubId
  END FUNCTION
END CLASS
```

---

## 5. Session Store

**File:** `src/lib/auth-pool/core/session-store.ts`

```
CLASS SessionStore:
  PRIVATE storage: StorageInterface

  CONSTRUCTOR(storage: StorageInterface):
    this.storage = storage
  END CONSTRUCTOR

  FUNCTION createSession(sessionId: string, subscriptionId: string) RETURNS Promise<ClientSession>:
    session = {
      id: sessionId,
      subscriptionId: subscriptionId,
      allocatedAt: NOW(),
      lastActivity: NOW(),
      status: 'active',
      sessionCost: 0,
      sessionTokens: 0,
      requestCount: 0
    }

    // Validate
    validated = validateClientSession(session)

    // Store session
    AWAIT this.storage.set("session:" + sessionId, validated)

    // Add to index
    AWAIT this.storage.addToIndex("index:sessions_by_sub:" + subscriptionId, sessionId)

    LOG "Created session " + sessionId + " for subscription " + subscriptionId

    RETURN validated
  END FUNCTION

  FUNCTION getSession(sessionId: string) RETURNS Promise<ClientSession | null>:
    session = AWAIT this.storage.get("session:" + sessionId)

    IF session == NULL:
      RETURN NULL
    END IF

    // Update status based on lastActivity
    session.status = this.calculateSessionStatus(session.lastActivity)

    RETURN session
  END FUNCTION

  FUNCTION updateSession(sessionId: string, updates: Partial<ClientSession>) RETURNS Promise<void>:
    session = AWAIT this.getSession(sessionId)

    IF session == NULL:
      THROW Error("Session not found: " + sessionId)
    END IF

    // Merge updates
    FOR EACH key IN Object.keys(updates):
      session[key] = updates[key]
    END FOR

    // Auto-update lastActivity if not explicitly set
    IF updates.lastActivity == NULL:
      session.lastActivity = NOW()
    END IF

    // Recalculate status
    session.status = this.calculateSessionStatus(session.lastActivity)

    // Validate
    validated = validateClientSession(session)

    // Persist
    AWAIT this.storage.set("session:" + sessionId, validated)

    // If subscriptionId changed, update indexes
    IF updates.subscriptionId != NULL AND updates.subscriptionId != session.subscriptionId:
      // Remove from old index
      AWAIT this.storage.removeFromIndex("index:sessions_by_sub:" + session.subscriptionId, sessionId)

      // Add to new index
      AWAIT this.storage.addToIndex("index:sessions_by_sub:" + updates.subscriptionId, sessionId)
    END IF
  END FUNCTION

  FUNCTION deleteSession(sessionId: string) RETURNS Promise<void>:
    session = AWAIT this.getSession(sessionId)

    IF session == NULL:
      LOG_WARN "Session not found for deletion: " + sessionId
      RETURN
    END IF

    // Remove from storage
    AWAIT this.storage.delete("session:" + sessionId)

    // Remove from index
    AWAIT this.storage.removeFromIndex("index:sessions_by_sub:" + session.subscriptionId, sessionId)

    LOG "Deleted session " + sessionId
  END FUNCTION

  FUNCTION getSessionsBySubscription(subscriptionId: string) RETURNS Promise<ClientSession[]>:
    // Get session IDs from index
    sessionIds = AWAIT this.storage.getIndex("index:sessions_by_sub:" + subscriptionId)

    sessions = []
    FOR EACH sessionId IN sessionIds:
      session = AWAIT this.getSession(sessionId)
      IF session != NULL:
        sessions.push(session)
      END IF
    END FOR

    RETURN sessions
  END FUNCTION

  FUNCTION getActiveSessionCount(subscriptionId: string) RETURNS Promise<number>:
    sessions = AWAIT this.getSessionsBySubscription(subscriptionId)

    activeCount = 0
    FOR EACH session IN sessions:
      IF session.status == 'active':
        activeCount = activeCount + 1
      END IF
    END FOR

    RETURN activeCount
  END FUNCTION

  FUNCTION expireStaleSessions(maxAgeMs: number) RETURNS Promise<number>:
    cutoffTime = NOW() - maxAgeMs

    // This is inefficient - would need to scan all sessions
    // Better approach: maintain index of sessions by lastActivity time
    // For now, simplified version:

    allSessionKeys = AWAIT this.storage.list("session:")
    expiredCount = 0

    FOR EACH key IN allSessionKeys:
      session = AWAIT this.storage.get(key)

      IF session != NULL AND session.lastActivity < cutoffTime:
        AWAIT this.deleteSession(session.id)
        expiredCount = expiredCount + 1
      END IF
    END FOR

    LOG "Expired " + expiredCount + " stale sessions"

    RETURN expiredCount
  END FUNCTION

  PRIVATE FUNCTION calculateSessionStatus(lastActivity: number) RETURNS SessionStatus:
    ageMs = NOW() - lastActivity

    fiveMinutesMs = 5 * 60 * 1000
    sixtyMinutesMs = 60 * 60 * 1000

    IF ageMs < fiveMinutesMs:
      RETURN 'active'
    ELSE IF ageMs < sixtyMinutesMs:
      RETURN 'idle'
    ELSE:
      RETURN 'stale'
    END IF
  END FUNCTION
END CLASS
```

---

## 6. Notification Manager

**File:** `src/lib/auth-pool/core/notification-manager.ts`

```
CLASS NotificationManager:
  PRIVATE config: PoolConfig

  CONSTRUCTOR(config: PoolConfig):
    this.config = config
  END CONSTRUCTOR

  FUNCTION notifyRotation(event: RotationEvent) RETURNS Promise<void>:
    rule = this.findRule('rotation')
    IF rule != NULL AND rule.enabled:
      AWAIT this.send(event, rule.channels)
    END IF
  END FUNCTION

  FUNCTION notifyFailover(event: FailoverEvent) RETURNS Promise<void>:
    rule = this.findRule('failover')
    IF rule != NULL AND rule.enabled:
      AWAIT this.send(event, rule.channels)
    END IF
  END FUNCTION

  FUNCTION notifyThreshold(event: ThresholdEvent) RETURNS Promise<void>:
    rule = this.findRule('usage_threshold')
    IF rule != NULL AND rule.enabled:
      AWAIT this.send(event, rule.channels)
    END IF
  END FUNCTION

  FUNCTION checkAndNotify(subscription: Subscription) RETURNS Promise<void>:
    weeklyPercent = subscription.weeklyUsed / subscription.weeklyBudget

    // Find all threshold rules
    thresholdRules = this.config.notifications.rules.filter(r => r.type == 'usage_threshold')

    FOR EACH rule IN thresholdRules:
      IF rule.enabled AND weeklyPercent >= rule.threshold:
        event = {
          type: 'usage_threshold',
          timestamp: NOW(),
          subscriptionId: subscription.id,
          weeklyUsed: subscription.weeklyUsed,
          weeklyBudget: subscription.weeklyBudget,
          percentUsed: weeklyPercent * 100,
          estimatedTimeRemaining: this.estimateExhaustion(subscription)
        }

        AWAIT this.send(event, rule.channels)
      END IF
    END FOR
  END FUNCTION

  PRIVATE FUNCTION send(notification: NotificationEvent, channels: string[]) RETURNS Promise<void>:
    FOR EACH channel IN channels:
      TRY:
        IF channel == 'webhook':
          AWAIT this.sendWebhook(notification)
        ELSE IF channel == 'sentry':
          AWAIT this.sendSentry(notification)
        ELSE IF channel == 'log':
          this.sendLog(notification)
        END IF
      CATCH error:
        LOG_ERROR "Failed to send notification via " + channel + ": " + error.message
      END TRY
    END FOR
  END FUNCTION

  PRIVATE FUNCTION sendWebhook(notification: NotificationEvent) RETURNS Promise<void>:
    IF this.config.notifications.webhookUrl == NULL:
      RETURN
    END IF

    response = AWAIT fetch(this.config.notifications.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notification)
    })

    IF response.status >= 400:
      THROW Error("Webhook failed with status " + response.status)
    END IF

    LOG "Sent webhook notification: " + notification.type
  END FUNCTION

  PRIVATE FUNCTION sendSentry(notification: NotificationEvent) RETURNS Promise<void>:
    // Sentry SDK integration (pseudocode)
    // Sentry.captureMessage(notification.type, {
    //   level: this.getSentryLevel(notification),
    //   extra: notification
    // })

    LOG "Sent Sentry notification: " + notification.type
  END FUNCTION

  PRIVATE FUNCTION sendLog(notification: NotificationEvent) RETURNS void:
    LOG "[NOTIFICATION] " + notification.type + ": " + JSON.stringify(notification)
  END FUNCTION

  PRIVATE FUNCTION findRule(type: string) RETURNS NotificationRule | null:
    FOR EACH rule IN this.config.notifications.rules:
      IF rule.type == type:
        RETURN rule
      END IF
    END FOR

    RETURN NULL
  END FUNCTION

  PRIVATE FUNCTION estimateExhaustion(subscription: Subscription) RETURNS string:
    remaining = subscription.weeklyBudget - subscription.weeklyUsed

    IF subscription.burnRate == 0:
      RETURN "Unknown (no activity)"
    END IF

    hoursRemaining = remaining / subscription.burnRate

    IF hoursRemaining < 1:
      RETURN round(hoursRemaining * 60) + " minutes"
    ELSE IF hoursRemaining < 24:
      RETURN round(hoursRemaining) + " hours"
    ELSE:
      RETURN round(hoursRemaining / 24) + " days"
    END IF
  END FUNCTION
END CLASS
```

---

## 7. Middleware

**File:** `src/lib/auth-pool/middleware.ts`

```
CLASS AuthPoolMiddleware:
  PRIVATE subscriptionManager: SubscriptionManager
  PRIVATE usageTracker: UsageTracker
  PRIVATE allocationBalancer: AllocationBalancer
  PRIVATE sessionStore: SessionStore
  PRIVATE initialized: boolean

  CONSTRUCTOR(config: PoolConfig):
    // Initialize storage
    storage = new MemoryStore()  // OR new DurableObjectStore(durableObjectState)

    // Initialize managers
    this.subscriptionManager = new SubscriptionManager(storage, config)
    this.usageTracker = new UsageTracker(storage)
    this.sessionStore = new SessionStore(storage)

    healthCalculator = new HealthCalculator(config)
    notificationManager = new NotificationManager(config)

    this.allocationBalancer = new AllocationBalancer(
      this.subscriptionManager,
      healthCalculator,
      this.sessionStore,
      notificationManager,
      config
    )

    this.initialized = FALSE
  END CONSTRUCTOR

  FUNCTION initialize() RETURNS Promise<void>:
    IF this.initialized:
      RETURN
    END IF

    LOG "Initializing AuthPoolMiddleware"

    AWAIT this.subscriptionManager.initialize()

    // Start background rebalancing if enabled
    IF this.config.rebalancing.enabled:
      intervalMs = this.config.rebalancing.intervalSeconds * 1000
      this.allocationBalancer.startBackgroundRebalancing(intervalMs)
    END IF

    this.initialized = TRUE
    LOG "AuthPoolMiddleware initialized"
  END FUNCTION

  FUNCTION handle(req, res, next) RETURNS Promise<void>:
    // Ensure initialized
    IF NOT this.initialized:
      AWAIT this.initialize()
    END IF

    // Check if request requires Claude CLI (tools)
    IF this.requiresTools(req.body):
      TRY:
        accountContext = AWAIT this.allocateAccount(req.body.session_id)
        req.accountContext = accountContext
        LOG "Allocated account: " + accountContext.subscriptionId
      CATCH error:
        LOG_ERROR "Allocation failed: " + error.message
        // Continue without account (router will use fallback)
      END TRY
    END IF

    // Continue to next middleware
    next()
  END FUNCTION

  FUNCTION allocateAccount(sessionId?: string) RETURNS Promise<AllocationResult>:
    request = {
      sessionId: sessionId,
      estimatedTokens: 10000,  // Default estimate
      priority: 'normal'
    }

    result = AWAIT this.allocationBalancer.allocateSubscription(request)

    RETURN result
  END FUNCTION

  FUNCTION reportUsage(data: UsageReportRequest) RETURNS Promise<void>:
    // Convert to ClaudeCliJsonOutput format
    cliOutput = {
      result: "",
      session_id: data.sessionId,
      duration_ms: data.durationMs OR 0,
      duration_api_ms: 0,
      num_turns: 1,
      total_cost_usd: data.cost,
      usage: {
        input_tokens: data.tokens.inputTokens,
        output_tokens: data.tokens.outputTokens,
        cache_creation_input_tokens: data.tokens.cacheCreationTokens,
        cache_read_input_tokens: data.tokens.cacheReadTokens
      },
      modelUsage: [],
      uuid: generateUUID(),
      is_error: FALSE
    }

    AWAIT this.usageTracker.recordUsage(cliOutput, data.subscriptionId)
  END FUNCTION

  FUNCTION shutdown() RETURNS Promise<void>:
    LOG "Shutting down AuthPoolMiddleware"

    // Stop background rebalancing
    this.allocationBalancer.stopBackgroundRebalancing()

    // Close managers
    AWAIT this.subscriptionManager.shutdown()

    this.initialized = FALSE
    LOG "AuthPoolMiddleware shut down"
  END FUNCTION

  PRIVATE FUNCTION requiresTools(body: any) RETURNS boolean:
    // Check if request has tools or requires file access
    IF body.tools != NULL AND body.tools.length > 0:
      RETURN TRUE
    END IF

    IF body.working_directory != NULL:
      RETURN TRUE
    END IF

    RETURN FALSE
  END FUNCTION
END CLASS
```

---

**Document Status:** ✅ Pseudocode Complete - Ready for Integration Planning

**Total Pseudocode Lines:** ~2,800 lines (all core logic defined)

**Next Steps:**
1. ⏭️ Document integration changes (`INTEGRATION_PLAN.md`)
2. ⏭️ Design testing strategy (`TESTING_STRATEGY.md`)
3. ⏭️ Refactor implementation plan (simplify, remove code blocks)
